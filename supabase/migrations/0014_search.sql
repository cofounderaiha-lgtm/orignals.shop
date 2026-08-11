-- 0014 search — NOT YET APPLIED (written by full-build)
-- ============================================================
-- REAL SEARCH for the hyperlocal marketplace.
--
-- Today search is a client-side substring filter over the in-memory
-- DB.shops array (js/shops.js:66-67, js/mitra.js:105). That cannot:
--   • tolerate typos ('mikl' → milk),
--   • understand India-grocery synonyms (atta = flour, dahi = curd),
--   • rank by real relevance blended with distance + shop rating,
--   • see shops/items registered on OTHER devices (they live only in
--     the cloud tables, never in the local array).
--
-- This migration builds server-side search entirely in Postgres:
--   • pg_trgm            → typo tolerance + prefix autocomplete
--   • FTS (tsvector)     → relevance ranking over item/shop text
--   • a synonyms table   → query expansion for local vocabulary
--   • haversine + rating → hyperlocal ranking (near, well-rated first)
--
-- ANTI-CARGO-CULT / ALGORITHM PROGRESSION:
--   Stage 1 (THIS FILE): lexical — FTS + trigram + synonyms. Correct and
--     fast for hundreds→tens-of-thousands of items on a single Postgres.
--     No external search infra (no Elastic/Meili/vector db): unjustified
--     at this scale and adds ops burden the contract forbids.
--   Stage 2 (later): semantic — pgvector embeddings for "something sweet
--     for kids" → candy/chocolate. TRIGGER to build it: (a) >~50k items
--     OR (b) search_log shows a sustained tail of zero-result natural-
--     language queries AND an embeddings budget exists. Only THEN add a
--     single `vector` column + ivfflat index and blend cosine distance
--     into the score below. Still Postgres-only (pgvector), still no
--     microservice. search_log (created here) is what proves the trigger.
-- ============================================================

create extension if not exists pg_trgm;

-- ---------- India-grocery synonyms (query expansion) ----------
create table if not exists search_synonyms (
  term      text not null,   -- what a user might type (lowercase)
  canonical text not null,   -- the word we actually index on
  primary key (term, canonical)
);
alter table search_synonyms enable row level security;  -- read via definer RPC only

insert into search_synonyms(term, canonical) values
  ('atta','flour'),   ('flour','atta'),
  ('dahi','curd'),    ('curd','dahi'),   ('yogurt','curd'),
  ('doodh','milk'),   ('milk','doodh'),
  ('chawal','rice'),  ('rice','chawal'),
  ('cheeni','sugar'), ('sugar','cheeni'),
  ('namak','salt'),   ('salt','namak'),
  ('aloo','potato'),  ('potato','aloo'),
  ('pyaz','onion'),   ('onion','pyaz'),
  ('tel','oil'),      ('oil','tel'),
  ('anda','egg'),     ('egg','anda'),
  ('paneer','cottage cheese'),
  ('maida','refined flour'),
  ('sabzi','vegetable'), ('subzi','vegetable')
on conflict (term, canonical) do nothing;

-- ---------- append-only query log (fuels the Stage-2 trigger) ----------
create table if not exists search_log (
  id     bigint generated always as identity primary key,
  q      text not null,
  hits   int,
  device text,
  at     timestamptz not null default now()
);
create index if not exists search_log_at_idx on search_log(at desc);
alter table search_log enable row level security;       -- write via definer RPC only

-- ---------- FTS vectors (generated, always in sync) ----------
-- 'english'::regconfig form is IMMUTABLE, so it is valid in a generated column.
alter table shop_items
  add column if not exists search_vec tsvector
  generated always as (to_tsvector('english'::regconfig, coalesce(name,'') || ' ' || coalesce(qty_label,''))) stored;

alter table shops
  add column if not exists search_vec tsvector
  generated always as (to_tsvector('english'::regconfig,
    coalesce(name,'') || ' ' || coalesce(category,'') || ' ' || coalesce(tagline,''))) stored;

-- FTS indexes
create index if not exists idx_items_fts on shop_items using gin (search_vec);
create index if not exists idx_shops_fts on shops     using gin (search_vec);

-- trigram indexes (typo tolerance + prefix autocomplete)
create index if not exists idx_items_name_trgm on shop_items using gin (name gin_trgm_ops);
create index if not exists idx_shops_name_trgm on shops      using gin (name gin_trgm_ops);
create index if not exists idx_shops_cat_trgm  on shops      using gin (category gin_trgm_ops);

-- ---------- helpers ----------
-- haversine distance in km (uniquely named to avoid clobbering any existing fn)
create or replace function search_haversine_km(lat1 double precision, lng1 double precision,
                                                lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 2 * 6371 * asin(sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
  end
$$;

-- expand a query with synonyms: 'atta rice' -> 'atta rice flour chawal'
create or replace function search_expand(p_q text)
returns text language sql stable as $$
  with toks as (
    select t from unnest(string_to_array(lower(trim(coalesce(p_q,''))), ' ')) t where t <> ''
  )
  select string_agg(w, ' ')
  from (
    select t          as w from toks
    union
    select sy.canonical from search_synonyms sy join toks on sy.term      = toks.t
    union
    select sy.term      from search_synonyms sy join toks on sy.canonical = toks.t
  ) u
$$;

-- ---------- MAIN SEARCH RPC ----------
-- Ranks in-stock items in OPEN, non-deleted shops by a blended score:
--   4.0 * FTS relevance          (websearch_to_tsquery over synonym-expanded q)
-- + 3.0 * trigram similarity     (typo tolerance: 'mikl' still scores on 'milk')
-- + 1.5 * proximity 1/(1+km)     (hyperlocal: nearer wins, and breaks ties)
-- + 0.5 * rating/5               (quality nudge)
create or replace function search_items(p_q text, p_lat double precision, p_lng double precision, p_limit int)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_q   text  := trim(coalesce(p_q, ''));
  v_exp text;
  v_tsq tsquery;
  v_lim int   := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_res json;
  v_n   int;
begin
  if v_q = '' then return '[]'::json; end if;

  v_exp := search_expand(v_q);
  begin
    v_tsq := websearch_to_tsquery('english', v_exp);
  exception when others then
    v_tsq := plainto_tsquery('english', v_q);
  end;

  select coalesce(json_agg(row_to_json(r) order by r.score desc, r.km asc nulls last), '[]'::json)
    into v_res
  from (
    select
      it.id, it.name, it.price, it.qty_label, it.in_stock, it.icon,
      s.id  as shop_id, s.name as shop_name, s.category, s.rating,
      s.lat, s.lng, s.addr, s.delivery::text as delivery,
      s.offer_label, s.offer_pct, s.pure_veg, s.photo_url,
      round(search_haversine_km(p_lat, p_lng, s.lat, s.lng)::numeric, 2) as km,
      round((
          ts_rank(it.search_vec, v_tsq) * 4.0
        + greatest(similarity(it.name, v_q), word_similarity(v_q, it.name)) * 3.0
        + case when search_haversine_km(p_lat, p_lng, s.lat, s.lng) is null then 0
               else 1.5 / (1.0 + search_haversine_km(p_lat, p_lng, s.lat, s.lng)) end
        + coalesce(s.rating, 0) / 5.0 * 0.5
      )::numeric, 4) as score
    from shop_items it
    join shops s on s.id = it.shop_id
    where it.in_stock = true
      and s.is_open   = true
      and s.deleted_at is null
      and (
            it.search_vec @@ v_tsq
         or similarity(it.name, v_q)   > 0.2      -- explicit threshold: catches 'mikl'→'milk' (~0.25)
         or word_similarity(v_q, it.name) > 0.3
         or it.name ilike '%' || v_q || '%'
      )
    order by score desc, km asc nulls last
    limit v_lim
  ) r;

  v_n := coalesce(json_array_length(v_res), 0);
  begin
    insert into search_log(q, hits) values (v_q, v_n);   -- best-effort; feeds Stage-2 trigger
  exception when others then null;
  end;

  return v_res;
end $$;
grant execute on function search_items(text, double precision, double precision, int) to anon;

-- ---------- AUTOCOMPLETE RPC ----------
-- Trigram prefix + fuzzy suggestions over item and shop names.
create or replace function search_suggest(p_q text, p_limit int)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_q   text := lower(trim(coalesce(p_q, '')));
  v_lim int  := least(greatest(coalesce(p_limit, 6), 1), 20);
begin
  if v_q = '' then return '[]'::json; end if;
  return coalesce((
    select json_agg(name order by sim desc)
    from (
      select name, max(sim) as sim
      from (
        select it.name, greatest(similarity(it.name, v_q), word_similarity(v_q, it.name)) as sim
        from shop_items it
        join shops s on s.id = it.shop_id
        where s.deleted_at is null
          and (it.name ilike v_q || '%' or it.name % v_q or word_similarity(v_q, it.name) > 0.3)
        union all
        select s.name, greatest(similarity(s.name, v_q), word_similarity(v_q, s.name)) as sim
        from shops s
        where s.deleted_at is null
          and (s.name ilike v_q || '%' or s.name % v_q)
      ) x
      group by name
      order by sim desc
      limit v_lim
    ) y
  ), '[]'::json);
end $$;
grant execute on function search_suggest(text, int) to anon;

-- ============================================================
-- PROOF (inserts temp rows, exercises the RPCs, asserts, cleans up)
-- ============================================================
do $$
declare v jsonb;
begin
  insert into shops(id, name, category, is_open, rating, lat, lng) values
    ('srch_near', 'Test Near Mart', 'grocery', true, 4.5, 28.61, 77.21),
    ('srch_far',  'Test Far Mart',  'grocery', true, 4.5, 28.95, 77.95)
  on conflict (id) do nothing;

  insert into shop_items(id, shop_id, name, price, in_stock) values
    ('srch_near_milk',  'srch_near', 'Milk',              30, true),
    ('srch_far_milk',   'srch_far',  'Milk',              30, true),
    ('srch_near_flour', 'srch_near', 'Aashirvaad Flour',  55, true)
  on conflict (id) do nothing;

  -- 1. typo tolerance: 'mikl' still finds 'milk'
  v := search_items('mikl', 28.6, 77.2, 10)::jsonb;
  assert jsonb_array_length(v) >= 1, 'FAIL: typo "mikl" returned nothing';
  assert exists (select 1 from jsonb_array_elements(v) e where e->>'name' ilike '%milk%'),
         'FAIL: typo "mikl" did not surface Milk';

  -- 2. distance breaks ties: identical items, nearer shop ranks first
  v := search_items('milk', 28.6, 77.2, 10)::jsonb;
  assert (v->0->>'shop_id') = 'srch_near',
         'FAIL: nearer shop not ranked first — distance tie-break broken';

  -- 3. synonym expansion: 'atta' finds 'Aashirvaad Flour'
  v := search_items('atta', 28.6, 77.2, 10)::jsonb;
  assert exists (select 1 from jsonb_array_elements(v) e where e->>'name' ilike '%flour%'),
         'FAIL: synonym "atta" did not find Flour';

  -- 4. autocomplete returns something for a prefix
  v := search_suggest('mil', 6)::jsonb;
  assert jsonb_array_length(v) >= 1, 'FAIL: suggest "mil" returned nothing';

  -- cleanup
  delete from shop_items where id in ('srch_near_milk', 'srch_far_milk', 'srch_near_flour');
  delete from shops      where id in ('srch_near', 'srch_far');
  delete from search_log where q in ('mikl', 'milk', 'atta');

  raise notice 'PASS: typo tolerance, distance tie-break, synonym expansion, and autocomplete all verified';
end $$;

select '0014_search ready' as status;
