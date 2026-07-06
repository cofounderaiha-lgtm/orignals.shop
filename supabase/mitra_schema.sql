-- ============================================================
-- MITRA BRAIN BACKEND — our own LLM infra inside Supabase
-- One paste installs everything:
--   tables · seed dataset (121 examples) · feature hasher ·
--   SGD trainer (plpgsql) · pg_cron auto-training every 15 min ·
--   global model that every device downloads on boot
-- Safe to run more than once.
-- ============================================================

-- ---------- tables ----------
create table if not exists mitra_utterances (
  id          bigint generated always as identity primary key,
  device_key  text not null,
  ts          timestamptz not null,
  text        text not null,
  pred        text,
  conf        numeric(4,2),
  label       text,
  src         text,
  unique (device_key, ts)
);
create index if not exists idx_mitra_unlabeled on mitra_utterances(label) where label is null;
create index if not exists idx_mitra_device on mitra_utterances(device_key, ts desc);

create table if not exists mitra_model (
  device_key text primary key,
  version    int,
  trained    int,
  labeled    int,
  accuracy   int,
  updated_at timestamptz not null default now()
);

create table if not exists mitra_global_model (
  id         int primary key default 1 check (id = 1),
  version    int not null default 0,
  w          real[],
  b          real[],
  trained    int not null default 0,
  examples   int not null default 0,
  updated_at timestamptz not null default now()
);

create or replace view mitra_training_set as
  select text, label as intent, src from mitra_utterances where label is not null;

-- ---------- seed dataset (identical to the in-app seed corpus) ----------
insert into mitra_utterances (device_key, ts, text, pred, conf, label, src) values
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '1 seconds', 'order 2 milk', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '2 seconds', 'do kilo aloo dena', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '3 seconds', 'ek packet biscuit dena', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '4 seconds', 'bhaiya paneer dena', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '5 seconds', 'sabun aur tel de do', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '6 seconds', 'get me bread and eggs', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '7 seconds', 'doodh mangwa do', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '8 seconds', 'buy paneer from kirana', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '9 seconds', 'i want biryani', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '10 seconds', 'order chicken biryani for 2', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '11 seconds', 'sabzi chahiye', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '12 seconds', 'get medicines paracetamol', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '13 seconds', 'order a cake', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '14 seconds', 'atta aur chawal mangwa do', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '15 seconds', 'need shampoo and soap', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '16 seconds', 'khana order karo', null, null, 'order_item', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '17 seconds', 'where is my order', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '18 seconds', 'khana kab tak aayega', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '19 seconds', 'kab tak pahunchega mera saman', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '20 seconds', 'kitni der aur lagegi', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '21 seconds', 'order abhi tak nahi aaya', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '22 seconds', 'order kahan hai', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '23 seconds', 'track my delivery', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '24 seconds', 'mera order aa gaya kya', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '25 seconds', 'delivery status', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '26 seconds', 'kitna time lagega order me', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '27 seconds', 'order ka status batao', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '28 seconds', 'is my food coming', null, null, 'track_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '29 seconds', 'cancel my order', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '30 seconds', 'cancel kar do wo order', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '31 seconds', 'biryani wala order cancel karo', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '32 seconds', 'wo wala order hata do', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '33 seconds', 'cancel that food order', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '34 seconds', 'order cancel karo', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '35 seconds', 'cancel the delivery', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '36 seconds', 'mujhe order cancel karna hai', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '37 seconds', 'cancel my booking please', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '38 seconds', 'galti se order ho gaya cancel karo', null, null, 'cancel_order', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '39 seconds', 'book a bike to the station', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '40 seconds', 'cab chahiye airport', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '41 seconds', 'auto book karo', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '42 seconds', 'i need a taxi', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '43 seconds', 'ride to office', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '44 seconds', 'bike se jana hai mall', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '45 seconds', 'ghar jana hai gaadi bhejo', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '46 seconds', 'book cab for 2 people', null, null, 'book_ride', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '47 seconds', 'send this tiffin to grandma', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '48 seconds', 'dawai pahuncha do dadi ke ghar', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '49 seconds', 'ye saman pahunchana hai', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '50 seconds', 'packet drop karwana hai', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '51 seconds', 'parcel bhejna hai', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '52 seconds', 'courier my documents', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '53 seconds', 'send keys to office', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '54 seconds', 'tiffin bhej do dadi ko', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '55 seconds', 'deliver this package to sector 9', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '56 seconds', 'send medicines to my mother', null, null, 'send_parcel', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '57 seconds', 'wallet balance', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '58 seconds', 'kitna paisa hai', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '59 seconds', 'add 200 to wallet', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '60 seconds', 'paise add karo', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '61 seconds', 'show my balance', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '62 seconds', 'wallet me paisa daalo', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '63 seconds', 'withdraw my money', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '64 seconds', 'recharge wallet 500', null, null, 'wallet', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '65 seconds', 'book movie tickets', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '66 seconds', '2 tickets for the 6:30 show', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '67 seconds', 'movie dekhni hai', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '68 seconds', 'film ke ticket book karo', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '69 seconds', 'show me whats playing', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '70 seconds', 'book tickets for tonight', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '71 seconds', 'imax tickets', null, null, 'book_tickets', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '72 seconds', 'my bookings', null, null, 'my_bookings', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '73 seconds', 'show my tickets', null, null, 'my_bookings', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '74 seconds', 'mere tickets dikhao', null, null, 'my_bookings', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '75 seconds', 'meri booking kahan hai', null, null, 'my_bookings', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '76 seconds', 'what did i book', null, null, 'my_bookings', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '77 seconds', 'my reservations', null, null, 'my_bookings', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '78 seconds', 'what should i eat', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '79 seconds', 'bhook lagi hai', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '80 seconds', 'suggest something good', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '81 seconds', 'kuch accha khane ko', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '82 seconds', 'recommend dinner', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '83 seconds', 'kya khau aaj', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '84 seconds', 'i am hungry suggest', null, null, 'recommend', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '85 seconds', 'book a hotel room', null, null, 'hotel_stay', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '86 seconds', 'need a room for 2 nights', null, null, 'hotel_stay', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '87 seconds', 'hotel chahiye', null, null, 'hotel_stay', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '88 seconds', 'stay booking', null, null, 'hotel_stay', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '89 seconds', 'homestay near lake', null, null, 'hotel_stay', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '90 seconds', 'room book karo kal ke liye', null, null, 'hotel_stay', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '91 seconds', '2 bhk flat for rent', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '92 seconds', 'ghar chahiye rent pe', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '93 seconds', 'show me plots', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '94 seconds', 'property near sector 12', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '95 seconds', 'buy a flat', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '96 seconds', 'makaan dekhna hai', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '97 seconds', 'office space commercial', null, null, 'property', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '98 seconds', 'i want to earn', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '99 seconds', 'kamai karni hai', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '100 seconds', 'become delivery partner', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '101 seconds', 'partner banna hai', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '102 seconds', 'job chahiye delivery ki', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '103 seconds', 'earn with my bike', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '104 seconds', 'deliver and earn', null, null, 'earn_partner', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '105 seconds', 'register my shop', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '106 seconds', 'apni shop app pe daalni hai', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '107 seconds', 'store online karna hai', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '108 seconds', 'main bechna chahta hu yahan', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '109 seconds', 'seller banna hai', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '110 seconds', 'meri dukaan online karo', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '111 seconds', 'sell on orignals', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '112 seconds', 'list my store', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '113 seconds', 'dukan kholna hai app pe', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '114 seconds', 'how to sell here', null, null, 'shop_register', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '115 seconds', 'hello', null, null, 'greeting', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '116 seconds', 'hi mitra', null, null, 'greeting', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '117 seconds', 'namaste', null, null, 'greeting', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '118 seconds', 'hey there', null, null, 'greeting', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '119 seconds', 'help me', null, null, 'greeting', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '120 seconds', 'what can you do', null, null, 'greeting', 'seed'),
  ('seed', timestamptz '2026-01-01 00:00:00+00' + interval '121 seconds', 'madad karo', null, null, 'greeting', 'seed')
on conflict (device_key, ts) do nothing;

-- ---------- feature hashing: bit-identical to js/brain.js (FNV-1a 32-bit) ----------
create or replace function mitra_hash(k text, d int) returns int
language plpgsql immutable as $fn$
declare h bigint := 2166136261; i int; c int;
begin
  for i in 1..length(k) loop
    c := ascii(substr(k, i, 1));
    h := (h # c) & 4294967295;
    h := (h * 16777619) & 4294967295;
  end loop;
  return (h % d)::int;
end $fn$;

create or replace function mitra_feat_keys(txt text) returns setof text
language plpgsql immutable as $fn$
declare t text; words text[]; w text; i int; j int;
begin
  t := btrim(regexp_replace(regexp_replace(lower(txt), '[^a-z0-9ऀ-ॿ ]+', ' ', 'g'), '\s+', ' ', 'g'));
  if t = '' then return; end if;
  words := string_to_array(t, ' ');
  foreach w in array words loop
    return next 'w:' || w;
    if length(w) >= 3 then
      for i in 1..length(w) - 2 loop return next 'c:' || substr(w, i, 3); end loop;
    end if;
  end loop;
  for j in 1..coalesce(array_length(words, 1), 0) - 1 loop
    return next 'b:' || words[j] || '_' || words[j + 1];
  end loop;
  return next '_bias';
end $fn$;

-- ---------- the backend trainer: softmax regression, online SGD ----------
create or replace function mitra_train(epochs int default 2) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  d int := 1024; c int := 14; lr real := 0.12;
  intents text[] := array['order_item','track_order','cancel_order','book_ride','send_parcel',
    'wallet','book_tickets','my_bookings','recommend','hotel_stay','property',
    'earn_partner','shop_register','greeting'];
  w real[]; b real[]; ver int;
  ex record; y int; feats int[]; vals real[];
  z real[]; p real[]; mx real; sm real; g real;
  e int; ci int; k int; nk int; ntrain int := 0;
begin
  select coalesce(mg.w, array_fill(0::real, array[d * c])),
         coalesce(mg.b, array_fill(0::real, array[c])),
         coalesce(mg.version, 0)
    into w, b, ver
    from (select 1) q left join mitra_global_model mg on mg.id = 1;

  for e in 1..epochs loop
    for ex in select text, label from mitra_utterances where label is not null order by random() loop
      y := array_position(intents, ex.label);
      continue when y is null;
      select array_agg(idx), array_agg(val) into feats, vals from (
        select mitra_hash(kk, d) as idx, count(*)::real as val
        from mitra_feat_keys(ex.text) kk group by 1) q;
      continue when feats is null;
      nk := array_length(feats, 1);
      z := array_fill(0::real, array[c]);
      for ci in 1..c loop
        z[ci] := b[ci];
        for k in 1..nk loop z[ci] := z[ci] + w[feats[k] * c + ci] * vals[k]; end loop;
      end loop;
      mx := (select max(x) from unnest(z) x);
      sm := 0; p := array_fill(0::real, array[c]);
      for ci in 1..c loop p[ci] := exp(z[ci] - mx); sm := sm + p[ci]; end loop;
      for ci in 1..c loop p[ci] := p[ci] / sm; end loop;
      for ci in 1..c loop
        g := (case when ci = y then 1 else 0 end) - p[ci];
        b[ci] := b[ci] + lr * g;
        for k in 1..nk loop
          w[feats[k] * c + ci] := w[feats[k] * c + ci] + lr * g * vals[k];
        end loop;
      end loop;
      ntrain := ntrain + 1;
    end loop;
  end loop;

  if ntrain > 0 then
    insert into mitra_global_model (id, version, w, b, trained, examples)
    values (1, ver + 1, w, b, ntrain,
      (select count(*) from mitra_utterances where label is not null))
    on conflict (id) do update
      set version = excluded.version, w = excluded.w, b = excluded.b,
          trained = mitra_global_model.trained + excluded.trained,
          examples = excluded.examples, updated_at = now();
  end if;
  return jsonb_build_object('trained_steps', ntrain,
    'model_version', case when ntrain > 0 then ver + 1 else ver end,
    'labeled_examples', (select count(*) from mitra_utterances where label is not null));
end $fn$;

-- backend inference (for future server-side callers / verification)
create or replace function mitra_predict(txt text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  d int := 1024; c int := 14;
  intents text[] := array['order_item','track_order','cancel_order','book_ride','send_parcel',
    'wallet','book_tickets','my_bookings','recommend','hotel_stay','property',
    'earn_partner','shop_register','greeting'];
  w real[]; b real[]; feats int[]; vals real[];
  z real[]; mx real; sm real; ci int; k int; nk int; best int := 1;
begin
  select mg.w, mg.b into w, b from mitra_global_model mg where mg.id = 1;
  if w is null then return jsonb_build_object('error', 'model not trained yet'); end if;
  select array_agg(idx), array_agg(val) into feats, vals from (
    select mitra_hash(kk, d) as idx, count(*)::real as val
    from mitra_feat_keys(txt) kk group by 1) q;
  nk := array_length(feats, 1);
  z := array_fill(0::real, array[c]);
  for ci in 1..c loop
    z[ci] := b[ci];
    for k in 1..nk loop z[ci] := z[ci] + w[feats[k] * c + ci] * vals[k]; end loop;
  end loop;
  mx := (select max(x) from unnest(z) x); sm := 0;
  for ci in 1..c loop z[ci] := exp(z[ci] - mx); sm := sm + z[ci]; end loop;
  for ci in 1..c loop
    z[ci] := z[ci] / sm;
    if z[ci] > z[best] then best := ci; end if;
  end loop;
  return jsonb_build_object('intent', intents[best], 'conf', round(z[best]::numeric, 3));
end $fn$;

-- ---------- automation: the backend trains itself every 15 minutes ----------
create extension if not exists pg_cron;
do $cron$ begin
  perform cron.schedule('mitra-train', '*/15 * * * *', 'select mitra_train(2)');
exception when others then raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $cron$;

-- ---------- security ----------
alter table mitra_utterances   enable row level security;
alter table mitra_model        enable row level security;
alter table mitra_global_model enable row level security;
do $pol$ begin
  create policy p_mu_all on mitra_utterances for all using (true) with check (true);
  create policy p_mm_all on mitra_model for all using (true) with check (true);
  create policy p_mg_read on mitra_global_model for select using (true);
exception when duplicate_object then null;
end $pol$;

-- ---------- first training run, right now ----------
select mitra_train(6);
