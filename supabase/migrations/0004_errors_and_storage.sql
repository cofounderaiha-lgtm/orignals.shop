-- ============================================================
-- WEEK1 TASK 5 — two confirmed leaks. Each verified by direct
-- inspection of the LIVE database (not from a report).
--
-- (A) recent_errors() leaked error URLs to anyone.
--     Verified: pg_get_functiondef shows SECURITY DEFINER with NO admin
--     gate, and harden_rls.sql:59 does `grant execute ... to anon`.
--     It returns the last 12 error messages AND URLs. URLs in this app
--     can contain the device key, which is a bearer token
--     (snapshot_restore(p_device) returns a user's whole account state).
--     So this could hand out credentials, not just noise.
--     Fix: require a token, gate on admin_rank >= 4.
--
-- (B) storage bucket `shopimg` accepted ANY file type.
--     Verified live: public = true, allowed_mime_types = NULL (= any),
--     file_size_limit = 3000000, and a policy "shopimg upload" granting
--     INSERT. A public, unauthenticated, any-MIME bucket on your own
--     domain is a free file host — and whatever lands there is your
--     legal problem.
--     Fix: restrict allowed_mime_types to images, keep the 3MB cap.
--     SAFE: js/cloud.js:466 always uploads with Content-Type image/jpeg,
--     so the legitimate shop-photo path is unaffected.
--
-- NOT fixed here, and deliberately so — my own check found these are
-- already safe, contrary to the earlier audit:
--   price_bounds : RLS enabled, ZERO policies  -> anon cannot write it
--   payments     : ZERO policies               -> deny-all already
-- ============================================================

-- ---------- (A) gate the error log ----------
drop function if exists recent_errors();

create or replace function recent_errors(p_token text)
returns table(created_at timestamptz, message text, url text)
language plpgsql stable security definer set search_path=public as $$
begin
  if admin_rank(_admin_level(p_token)) < 4 then
    return;                      -- not staff: empty set, no leak, no hint
  end if;
  return query
    select e.created_at, e.message, e.url
    from error_log e order by e.created_at desc limit 12;
end $$;

grant execute on function recent_errors(text) to anon;

-- ---------- (B) images only in the public bucket ----------
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp'],
       file_size_limit    = 3000000
 where id = 'shopimg';

-- ---- proof ----
select 'recent_errors is admin-gated' as check,
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='recent_errors'
           and pg_get_function_identity_arguments(p.oid) = 'p_token text'
           and pg_get_functiondef(p.oid) like '%admin_rank%')
       then 'YES — PASS' else 'NO — FAIL' end as result
union all
select 'ungated recent_errors() removed',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='recent_errors'
           and pg_get_function_identity_arguments(p.oid) = '')
       then 'STILL PRESENT — FAIL' else 'REMOVED — PASS' end
union all
select 'shopimg mime allowlist',
       coalesce((select array_to_string(allowed_mime_types,',') from storage.buckets where id='shopimg'),'ANY — FAIL');
