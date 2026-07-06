-- ============================================================
-- MITRA BRAIN — training-data flywheel tables (add-on schema)
-- Run in Supabase → SQL Editor. Safe to run more than once.
-- ============================================================

-- Every Mitra conversation turn = one training example.
create table if not exists mitra_utterances (
  id          bigint generated always as identity primary key,
  device_key  text not null,
  ts          timestamptz not null,
  text        text not null,
  pred        text,                    -- model's predicted intent
  conf        numeric(4,2),            -- prediction confidence 0–1
  label       text,                    -- ground-truth intent (rules/human/claude)
  src         text,                    -- rules | brain | human | claude
  unique (device_key, ts)
);
create index if not exists idx_mitra_unlabeled on mitra_utterances(label) where label is null;
create index if not exists idx_mitra_device on mitra_utterances(device_key, ts desc);

-- Per-device model card: version, size, live accuracy.
create table if not exists mitra_model (
  device_key text primary key,
  version    int,
  trained    int,
  labeled    int,
  accuracy   int,
  updated_at timestamptz not null default now()
);
do $$ begin
  create trigger t_mitra_model_touch before update on mitra_model
    for each row execute function touch_updated_at();
exception when duplicate_object then null; end $$;

-- Aggregate view: the global dataset ready for fine-tuning export.
create or replace view mitra_training_set as
  select text, label as intent, src, count(*) over () as total
  from mitra_utterances where label is not null;

alter table mitra_utterances enable row level security;
alter table mitra_model      enable row level security;
do $$ begin
  create policy p_mu_all on mitra_utterances for all using (true) with check (true);
  create policy p_mm_all on mitra_model for all using (true) with check (true);
exception when duplicate_object then null; end $$;
