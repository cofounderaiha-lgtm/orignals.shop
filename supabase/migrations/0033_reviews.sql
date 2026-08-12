-- ============================================================
-- 0033 — REVIEWS & REPUTATION  (⚠ FROZEN — validated locally)
--   Written 2026-08-12. Directive §32: reputation for shops/products/mitras with
--   VERIFIED-purchase, one-review-per-order, anti-spam (rate limit), moderation, and a
--   reputation score that ranking can use (verified reviews weighted). A review is
--   "verified" only when the device genuinely bought + received from that subject.
-- ============================================================
create table if not exists reviews (
  id           bigint generated always as identity primary key,
  subject_type text not null,               -- shop | product | mitra
  subject_id   text not null,
  device_key   text not null,
  order_ref    text,
  stars        int not null check (stars between 1 and 5),
  body         text,
  verified_purchase boolean not null default false,
  status       text not null default 'published',   -- published | flagged | removed
  created_at   timestamptz not null default now()
);
create index if not exists rev_subject_idx on reviews(subject_type, subject_id, status);
create index if not exists rev_device_idx  on reviews(device_key, created_at desc);
-- one review per (device, subject, order)
create unique index if not exists rev_once on reviews(device_key, subject_type, subject_id, coalesce(order_ref,''));
alter table reviews enable row level security;
drop policy if exists rev_read on reviews;
create policy rev_read on reviews for select using (status = 'published');   -- published reviews are public

create or replace function review_add(p_device text, p_subject_type text, p_subject_id text, p_order text, p_stars int, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare v_verified boolean := false; v_recent int;
begin
  if coalesce(p_stars,0) < 1 or p_stars > 5 then return json_build_object('ok', false, 'reason', 'bad_stars'); end if;
  if p_subject_type not in ('shop','product','mitra') then return json_build_object('ok', false, 'reason', 'bad_subject'); end if;

  -- anti-spam: cap reviews per device per day
  select count(*) into v_recent from reviews where device_key = p_device and created_at > now() - interval '1 day';
  if v_recent >= 10 then return json_build_object('ok', false, 'reason', 'rate_limited'); end if;

  -- verified purchase: for a shop, a delivered order from THIS device to THIS shop
  if p_subject_type = 'shop' and coalesce(p_order,'') <> '' then
    v_verified := exists (select 1 from shop_orders where id = p_order and buyer_device = p_device
                          and shop_id = p_subject_id and status = 'done');
  end if;

  insert into reviews(subject_type, subject_id, device_key, order_ref, stars, body, verified_purchase)
  values (p_subject_type, p_subject_id, p_device, nullif(p_order,''), p_stars, left(coalesce(p_body,''),1000), v_verified)
  on conflict (device_key, subject_type, subject_id, coalesce(order_ref,'')) do nothing;
  if not found then return json_build_object('ok', false, 'reason', 'already_reviewed'); end if;
  return json_build_object('ok', true, 'verified', v_verified);
end $$;
grant execute on function review_add(text, text, text, text, int, text) to anon;

-- reputation a ranking layer can consume (verified reviews weighted)
create or replace function reputation(p_subject_type text, p_subject_id text)
returns json language sql security definer set search_path = public stable as $$
  select json_build_object(
    'count',          count(*),
    'avg',            coalesce(round(avg(stars), 2), 0),
    'verified_count', count(*) filter (where verified_purchase),
    'verified_avg',   coalesce(round(avg(stars) filter (where verified_purchase), 2), 0),
    -- ranking score: verified reviews weighted 2x, lightly smoothed toward 3.5 for low n
    'score', coalesce(round(
       (sum(stars * case when verified_purchase then 2 else 1 end) + 3.5 * 3)
       / nullif(sum(case when verified_purchase then 2 else 1 end) + 3, 0), 3), 3.5),
    'distribution', json_build_object(
       '5', count(*) filter (where stars=5), '4', count(*) filter (where stars=4),
       '3', count(*) filter (where stars=3), '2', count(*) filter (where stars=2),
       '1', count(*) filter (where stars=1)))
  from reviews where subject_type = p_subject_type and subject_id = p_subject_id and status = 'published';
$$;
grant execute on function reputation(text, text) to anon;

create or replace function subject_reviews(p_subject_type text, p_subject_id text, p_limit int)
returns json language sql security definer set search_path = public stable as $$
  select coalesce(json_agg(json_build_object('stars', stars, 'body', body, 'verified', verified_purchase, 'at', created_at) order by created_at desc), '[]'::json)
  from (select * from reviews where subject_type = p_subject_type and subject_id = p_subject_id and status = 'published'
        order by created_at desc limit least(greatest(coalesce(p_limit,20),1),50)) r;
$$;
grant execute on function subject_reviews(text, text, int) to anon;

-- admin moderation (L4+)
create or replace function review_moderate(p_token text, p_review bigint, p_status text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_status not in ('published','flagged','removed') then return json_build_object('ok', false, 'reason', 'bad_status'); end if;
  update reviews set status = p_status where id = p_review;
  return json_build_object('ok', found);
end $$;
grant execute on function review_moderate(text, bigint, text) to anon;

-- ---------- proof (expect PASS) ----------
do $$
declare v_shop text := _my_shop('revdev0000001'); v_dev text := 'rev_buyer_001'; r json;
begin
  delete from reviews where subject_id = v_shop; delete from shop_orders where id='RV_O1'; delete from shops where id=v_shop;
  insert into shops(id,name,category) values (v_shop,'Review Mart','grocery');
  insert into shop_orders(id,shop_id,buyer_device,items,total,status) values ('RV_O1',v_shop,v_dev,'[]'::jsonb,100,'done');

  -- a review tied to a genuine delivered order is VERIFIED
  r := review_add(v_dev, 'shop', v_shop, 'RV_O1', 5, 'Great');
  assert (r->>'ok')='true' and (r->>'verified')='true', 'FAIL: verified review';

  -- same device + same order → cannot review twice
  r := review_add(v_dev, 'shop', v_shop, 'RV_O1', 1, 'again');
  assert (r->>'ok')='false' and (r->>'reason')='already_reviewed', 'FAIL: duplicate review allowed';

  -- a different device with NO order → unverified but allowed
  r := review_add('other_dev_99', 'shop', v_shop, null, 3, 'ok');
  assert (r->>'ok')='true' and (r->>'verified')='false', 'FAIL: unverified review';

  -- bad stars rejected
  assert (review_add('x','shop',v_shop,null,9,'bad')->>'ok')='false', 'FAIL: bad stars accepted';

  -- reputation: 2 reviews (5 verified, 3 unverified); verified_avg = 5
  r := reputation('shop', v_shop);
  assert (r->>'count')::int = 2, 'FAIL: rep count';
  assert (r->>'verified_count')::int = 1, 'FAIL: verified count';
  assert (r->>'verified_avg')::numeric = 5, 'FAIL: verified_avg';

  -- moderation (L4+ only)
  assert (review_moderate('__nope__', 1, 'removed')->>'ok')='false', 'FAIL: non-admin moderated';

  delete from reviews where subject_id = v_shop; delete from shop_orders where id='RV_O1'; delete from shops where id=v_shop;
  raise notice 'PASS: reviews — verified purchase, one-per-order, unverified allowed, reputation (verified-weighted), moderation gated';
end $$;

select 'reviews & reputation ready' as status;
