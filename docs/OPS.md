# Orignals — Operations Runbook

Launch-day controls. Everything here is already built and live in the
`platform_flags` and `error_log` tables in Supabase.

## Remote kill switches (`platform_flags`, single row id=1)

Every app checks these on boot and applies them without a redeploy. Flip
them from the Supabase SQL editor (or the ops runner) — takes effect on
the next app open for every user.

**Maintenance mode** (freeze the whole app behind a calm "back in a few
minutes" screen):
```sql
update platform_flags set maintenance = true  where id = 1;   -- freeze
update platform_flags set maintenance = false where id = 1;   -- resume
```

**Payments on/off** (instantly stop online payments if the gateway
misbehaves; wallet still works):
```sql
update platform_flags set payments_enabled = false where id = 1;
update platform_flags set payments_enabled = true  where id = 1;
```

**Broadcast a banner** (a dismissible notice strip under the header — e.g.
"Heavy load — orders may be slower than usual"):
```sql
update platform_flags set banner = 'Heavy load — orders may be slower than usual' where id = 1;
update platform_flags set banner = null where id = 1;   -- clear
```

## Error monitoring (`error_log`)

Client errors are captured automatically (deduped, capped per session) and
written to `error_log`. Two ways to watch it:

- **In-app:** Admin → Database → Operations → Recent errors.
- **SQL:**
```sql
select created_at, message, url, count(*) over (partition by message) as seen
from error_log order by created_at desc limit 50;
```
The table self-trims to ~2000 rows.

## DPDP data erasure (`erase_device`)

Users erase their own data from Account → Legal → Your data. It calls
`erase_device(device_key)`, which deletes all personal/device rows and
**de-identifies** payment rows (financial records must be retained). To
run a manual erasure on request:
```sql
select erase_device('<device_key>');
```

## The ops runner

`scratchpad/supa_run.py "<SQL>"` executes any of the above via the
Management API (needs the PAT at `%USERPROFILE%/.orignals/supabase_pat.txt`).
Keep flag changes to single, reviewed statements.
