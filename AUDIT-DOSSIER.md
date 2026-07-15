# Orignals — Audit Dossier

```json
{
  "repo": "github.com/cofounderaiha-lgtm/orignals.shop",
  "commit_sha": "c6b21a1ba943d6cd2b0d156220fbbca010e8e7cc",
  "generated": "2026-07-12",
  "languages": { "javascript": 9591, "css": 1580, "sql": 2910, "html": 156, "markdown": 582 },
  "total_loc": 14819,
  "file_count": 74,
  "prod_deps": 0,
  "dev_deps": 0,
  "framework": "none — hand-written vanilla ES2020, no build step",
  "rendering": "CSR",
  "backend": "Supabase (Postgres + PostgREST RPC) + 4 Deno edge functions + 1 Vercel serverless fn",
  "database": "Postgres 15 (Supabase, ref wvprqdfhjcammghjwoqj)",
  "hosting": "Vercel (static + rewrites)",
  "test_files": 0,
  "test_coverage_pct": null,
  "llm_providers": ["anthropic (configured OFF — placeholder key)"],
  "payment_gateways": ["razorpay (LIVE keyId)"],
  "loc_by_vertical": {
    "grocery": 1446, "send": 216, "rides": 106, "movies": 511,
    "dining": 0, "property": 322, "services": 105, "mitra": 1505, "shared": 5380
  }
}
```

> **Method note.** Every claim below cites a file I opened. Where I could not
> establish something from code, I wrote `NOT FOUND`. `dining` shows 0 LOC because
> it has no file of its own — it lives inside `js/tickets.js` and is counted there.
> LOC-by-vertical is attributed per-file; files serving several verticals are in
> `shared`.

---

## A. Shape

### Tree (depth 3, build output and `.git` skipped)

```
.
├── api/                  1 Vercel serverless function (track.js)
├── css/                  app.css (500), modules.css (1080)
├── docs/                 8 markdown files + loadtest.js
├── icons/                PNG app icons
├── js/                   30 scripts — the entire application
├── supabase/             26 .sql schema files
│   └── functions/        push-send, razorpay-order, razorpay-verify, razorpay-webhook
├── index.html            156 lines — the whole shell
├── config.js             public runtime config
├── sw.js                 service worker
└── vercel.json           rewrites
```

### LOC

| ext | files | LOC |
|---|---|---|
| .js | 34 | 9,591 |
| .sql | 26 | 2,910 |
| .css | 2 | 1,580 |
| .md | 8 | 582 |
| .html | 1 | 156 |

### Dependencies — the notable finding

**There is no `package.json`.** No npm dependency tree, no lockfile, no build step,
no bundler, no transpiler, no `node_modules`. Confirmed by `find`: `NOT FOUND`.

Consequences the panel should weigh:
- **`npm audit` is not applicable.** There is no dependency graph to audit. The
  supply-chain attack surface is close to zero.
- There is also **no dependency management**: the three third-party libraries are
  loaded from CDNs at runtime, pinned by URL:
  - Leaflet 1.9.4 — `index.html:16-17` (unpkg)
  - Razorpay Checkout — `index.html:18` (`checkout.razorpay.com/v1/checkout.js`, unversioned)
  - `@vladmandic/face-api@1.7.13` — `config.js:42-43` (jsdelivr), lazy-loaded
  - `qrcode-generator` — lazy-loaded in `js/shops.js`
  - Tesseract — lazy-loaded in `js/myshop.js` (menu OCR)
- **Razorpay's checkout script is unversioned** (`/v1/checkout.js`), so the payment
  UI can change under the app without a commit. That is a live third-party dependency
  on the money path.
- No duplicate libraries (no two date libs, no state managers at all — state is one
  global object).

**Package manager:** none. **Node version:** not pinned; Node is used only by me for
`--check`, never at runtime or build. **Build tooling:** none. Deploy = `git push`;
Vercel serves the directory verbatim.

**Where the code runs:** ~9,600 LOC of JavaScript in the browser; ~2,900 LOC of SQL
inside Postgres as RPC functions; ~4 Deno functions on Supabase; 1 Node function on
Vercel (`api/track.js`).

---

## B. Architecture

### How a request becomes a page

There is no server render. `vercel.json` rewrites every non-API, extensionless path
to the shell:

```json
{ "rewrites": [ { "source": "/((?!api/)(?!.*\\.).*)", "destination": "/index.html" } ] }
```

`index.html` ships 30 `<script>` tags and an empty `<main id="view">` (`index.html:91`).
Everything is drawn client-side.

**Rendering — the priority question, answered:**

**This is pure CSR. There is no SSR, no SSG, no prerendering for any route, and none
is configured or bypassed — there is no framework to configure.** The deployed HTML
is a shell; the ₹0 basket and nav labels the panel observed are static markup
(`index.html:71,97`), and every shop, product, price and page is injected by JS after
load.

Implication, stated plainly: **the marketplace is not crawlable.** No shop, item,
price, event, property or service exists in any server-rendered HTML. Google can
execute JS, but content depends on a Supabase RPC round-trip after 30 scripts parse;
Bing/social crawlers/WhatsApp previews will see an empty shell. For a marketplace
whose customer acquisition depends on local search, this is a structural fact, not a
tuning problem.

### Routing

Hand-rolled, `js/core.js:112-129`:
- `view(name, fn)` registers into a `VIEWS` map.
- `currentRoute()` reads **hash first, then pathname** (`core.js:118-121`) — this is
  what lets `/admin` work as a clean URL while the rest of the app uses `#/`.
- `route()` splits on `/`, looks up `VIEWS[name] || VIEWS.home` (`core.js:126-129`) —
  **any unknown route silently renders home.** There is no 404 view.

### State management

One mutable global, `S`, seeded by `defaultState()` and rehydrated from
`localStorage` (`js/core.js:80-99`):

```js
let S;
try { S = Object.assign(defaultState(), JSON.parse(localStorage.getItem(OMNY_KEY)) || {}); }
catch (e) { S = defaultState(); }
```

`save()` writes the whole object back. There is no reducer, no immutability, no
schema/versioning on the persisted blob. **A shape change ships against whatever is
already in a user's localStorage** — `Object.assign` only merges top level, so a
changed nested shape is not migrated.

### Data fetching

`cloudFetch()` in `js/cloud.js` — `fetch` to PostgREST `rpc/<fn>` with the anon key.
No client cache, no dedupe, no retry/backoff, no request cancellation.

### Client/server boundary — what's in the bundle that shouldn't be

The entire admin panel (`js/admin.js`, 906 lines — HRMS, payroll, analytics, fraud
board, Mitra training) **is shipped to every visitor.** It is *server-gated for data*
(every call goes through `adminApi()` → RPC → `_admin_level(token)`), so a normal user
who reads the source learns the admin panel's shape and RPC names but **cannot obtain
data** — the gate is in Postgres, not JS. That is the correct place for it. Still: the
whole product's internal structure is public reading.

### Module dependency graph (text)

```
index.html
 └─ data.js ── icons.js ── config.js
      └─ core.js  (S, save, go, route, money, sheet, walletAdd/Pay, checkoutSheet)
           ├─ cloud.js  (cloudFetch → Supabase RPC)
           ├─ ops.js, auth.js ── face.js, legal.js
           ├─ brain_ml.js → brain.js → langs.js → cortex.js → memory.js → reason.js → agents.js
           ├─ geo.js (Leaflet, OSRM, Nominatim)
           ├─ home.js, shops.js → call.js, send.js, rides.js, tickets.js,
           │  estate.js, services.js, admin.js, earn.js, myshop.js
           └─ mitra.js, account.js
```

**Circular dependencies:** none in the module-loader sense — there are no modules.
Every file is a global script; load order in `index.html` is the only contract. But
there are **circular *call* relationships** across that flat namespace:
- `mitra.js` calls `reorder()` (shops.js) and `go()` (core.js); `shops.js` calls
  `orderChat()` (shops.js) and `callControls()` (call.js); `call.js` calls
  `cloudChatSend()` (cloud.js) and `S`/`toast` (core.js).
- `admin.js:adminHREdit()` uses `_fld`, a `const` declared in **`js/tickets.js`**.
  This works only because tickets.js is loaded first (`index.html:139` before `:142`).
  It is invisible coupling across unrelated verticals.

**Files over 500 lines:**

| file | LOC |
|---|---|
| `css/modules.css` | 1080 |
| `js/admin.js` | 906 |
| `js/myshop.js` | 848 |
| `js/cloud.js` | 679 |
| `js/earn.js` | 607 |
| `js/shops.js` | 598 |
| `js/core.js` | 530 |
| `js/tickets.js` | 511 |
| `js/mitra.js` | 505 |

**The three files that would hurt most to touch:**
1. **`js/core.js`** — defines `S`, `save`, `go`, `route`, `money`, `walletAdd/Pay`,
   `sheet`, `checkoutSheet`, `createOrder`. Every other file depends on it. A change
   to `defaultState()` silently mismatches every existing user's localStorage.
2. **`js/cloud.js`** — the only path to the backend for every vertical.
3. **`js/admin.js`** — 906 lines, 13 tabs, 8 async loaders, all in one render function
   built from a single template literal with inline IIFEs.

---

## C. Data model

56 tables. All schema lives in `supabase/*.sql` (26 files, applied by hand — see §M).

### Representative schema (verbatim, `supabase/analytics_schema.sql:11-34`)

```sql
create table if not exists analytics_events (
  id       bigint generated always as identity primary key,
  ts       timestamptz not null default now(),
  device   text,                 -- anonymous per-browser key
  session  text,                 -- per-visit id
  kind     text not null,        -- 'page' | 'ping' | 'event'
  name     text,                 -- route (page) or event name
  ref      text, role text, uad text, lang text,
  country  text, region text, city text,
  lat double precision, lng double precision,
  val numeric, extra jsonb
);
create index if not exists ana_ts_idx on analytics_events (ts desc);
alter table analytics_events enable row level security;
```

`supabase/verify_schema.sql:9-22`:

```sql
create table if not exists verify_queue (
  id bigint generated always as identity primary key,
  kind text not null,               -- kyc | purity | shop | service
  subject text not null,
  device text, ident text,
  details jsonb default '{}'::jsonb,
  status text default 'pending',    -- pending | verified | rejected
  reviewed_by text,
  created_at timestamptz default now(),
  decided_at timestamptz
);
```

`supabase/admin_schema.sql:12-21` — the RBAC spine:

```sql
create table if not exists admin_users (
  ident text primary key,               -- normalized email or 10-digit phone
  level text not null check (level in ('l1','l2','l3','l4','l5')),
  name text, active boolean not null default true,
  added_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table admin_users enable row level security;   -- RPC-only, no anon access
```

### Multi-vendor isolation — the load-bearing question

**There is no tenant column and no per-merchant RLS policy.** Isolation is enforced
**per-RPC, in SQL, by device key or session token** — not by a table-level tenancy
model.

The enforcement points, verbatim:

`supabase/order_chat.sql:20-24` — the only real ownership predicate in the codebase:

```sql
create or replace function chat_is_participant(p_order text, p_device text)
...
  return exists (select 1 from shop_orders where id = p_order
                   and (buyer_device = p_device or shop_id = 'my_'||substr(p_device,1,12)))
      or exists (select 1 from live_jobs where order_ref = p_order and taken_by = p_device);
```

`supabase/admin_schema.sql:29-33` — the admin gate every staff RPC calls:

```sql
create or replace function _admin_level(p_token text) returns text
language sql security definer set search_path=public as $$
  select a.level from auth_sessions s
  join admin_users a on a.ident = s.ident and a.active
  where s.token = p_token limit 1;
$$;
```

Assessment, plainly: **RLS is enabled on all 56 tables** (verified against
`pg_class.relrowsecurity` — zero tables without it), and no anon role can read tables
directly; everything must pass through a `security definer` RPC (100 of 141 routines
are security-definer). So the *default* is deny. But the merchant boundary itself is
expressed as `shop_id = 'my_'||substr(p_device,1,12)` — **a merchant's identity is
their browser's device key**, not an authenticated account. Anyone who obtains or
guesses a device key inherits that merchant's chat access. There is no `owner_ident`
FK from `shops` to `app_users` enforced at the DB.

### Location model

No PostGIS, no geohash, no spatial index. Plain `double precision` lat/lng columns
(`shop_orders.buyer_lat/lng`, `live_jobs.from_lat/lng`, `analytics_events.lat/lng`).

Distance is computed **client-side** by haversine (`js/geo.js`), and routing calls the
public OSRM demo server; geocoding calls Nominatim (`js/analytics.js:74`,
`js/geo.js`). Serviceability: **NOT FOUND.** There is no zone table, no radius
constraint, no "we don't deliver here" check anywhere. `js/geo.js` will accept any
address in India (or outside it) and the app will quote a fare — the relay engine in
`js/send.js:relayPlan()` happily prices a 2,500 km parcel.

### Orphans, unused columns, hot paths

- `purity_checks` (`shop_id, batch, status, inspector, note, updated_at`) — **0 rows,
  no reader, no writer in any JS file.** Orphaned. See §G.
- `kyc_docs`, `partners` — `partners` has 0 rows; `verify_decide` writes to
  `partners.status` inside a swallow-all exception block (`verify_schema.sql:60-66`)
  because the column may not exist. That is tape.
- `DB.movies` in `js/data.js:347` — dead data, no longer reachable from any nav.
- Indexes exist on the analytics hot path (`ana_ts_idx`, `ana_kind_ts_idx`) and on
  `verify_queue(status, kind, created_at)`. N+1: not applicable — there is no ORM;
  each screen makes one RPC that aggregates server-side.

---

## D. API & auth

There are **no REST endpoints of our own** except one. The API surface is 141 Postgres
functions exposed by PostgREST at `POST /rest/v1/rpc/<name>`, plus:

| method | path | auth | rate limit | validation |
|---|---|---|---|---|
| POST | `/api/track` (Vercel) | none — public beacon | **NOT FOUND** | clamps + `slice()` on every field (`api/track.js:20-36`) |
| POST | supabase fn `razorpay-order` | anon key | NOT FOUND | server-side |
| POST | supabase fn `razorpay-verify` | anon key | NOT FOUND | server-side |
| POST | supabase fn `razorpay-webhook` | **HMAC signature** | NOT FOUND | see §F |
| POST | supabase fn `push-send` | secret | NOT FOUND | — |

RPC auth splits three ways:
1. **Token-gated (staff):** first arg `p_token`; resolved via `_admin_level()`. ~40 fns.
2. **Device-gated (user):** first arg `p_device`; ownership via participant predicates.
3. **Open (anon):** `track_hit`, `service_list`, `verify_submit`, `shops` reads.

**Strip the auth header — what stops me?** The anon key *is* the header; it is public
by design and cannot be stripped in a meaningful sense. So the question becomes: with
the anon key, what can I reach?
- **Tables: nothing.** RLS on all 56, no anon policies.
- **RPCs: only what's granted.** `grant execute ... to anon` is explicit per function.
- **Admin RPCs: nothing without a valid `p_token`** that joins to an `active`
  `admin_users` row. Passing a forged token returns `{ok:false, reason:'forbidden'}`.

**The real hole:** `verify_submit`, `service_register`, `track_hit` and `chat_send`
take `p_device` **from the client**. A device key is a client-generated string
(`S.deviceKey`). Nothing binds it to a session. So an attacker who learns a device key
can impersonate that device to those RPCs (post chat as them, read their chat via
`chat_read`). **IDOR on order chat is possible with a known device key.** Order *data*
itself is mostly localStorage, so `/api/orders/<id>` does not exist to be enumerated.

**Auth:** hand-rolled, `supabase/auth_schema.sql` + `js/auth.js`.
- Password: bcrypt via pgcrypto — `insert ... extensions.crypt(p_pass, extensions.gen_salt('bf'))` (`auth_schema.sql:91`); verify `r.pass_hash <> extensions.crypt(p_pass, r.pass_hash)` (`:104`). Correct.
- Session: **opaque random token**, not JWT — `token text primary key default encode(extensions.gen_random_bytes(24),'hex')` (`auth_schema.sql:17`).
- **Token lives in `localStorage`** (`js/auth.js:10-11`, key `omny_auth`) — readable by any XSS.
- **Expiry: NOT FOUND.** `auth_sessions` has `created_at` and `last_seen` but no `expires_at`, and no RPC deletes old sessions. **Sessions are effectively immortal.**
- **Refresh strategy: NOT FOUND** (not needed — tokens never expire).
- OTP: `otp_challenges` with salted sha256 codes and a 10-minute rate window
  (`auth_schema.sql:52`), attempts counter at `:73`. Only the OTP path is rate-limited.
- **Login brute-force protection: NOT FOUND.** `auth_login` has no attempt counter,
  no lockout, no delay.

**Admin route guard** — `js/admin.js:56-68`, server-checked before render:

```js
view('admin', async args => {
  ...
  let who = { admin: false, signed_in: false, bootstrap: false };
  if (a && a.token) who = await adminApi('admin_whoami', {}) || who;
  ADMIN_WHO = who;
  if (!who.admin) { renderAdminGate(who); return; }
  ADMIN_LEVEL = who.level;
```

A customer typing `/admin` gets the gate screen. Critically, the *data* is gated
server-side too, so bypassing the JS check yields nothing.

**Input validation:** hand-rolled everywhere; no schema library. SQL side uses
`left(coalesce(x,''),N)` truncation and `check` constraints. Client side is
`if (x.length < 5) { toast(...); return; }`.

**CORS:** default Supabase/Vercel. **CSRF:** not applicable — no cookies; auth is a
bearer token in a header.

---

## E. Mitra (the AI layer)

**The single most important finding in this section: the LLM is OFF, and it has no
tools.**

### Provider / model / call site

One call site: `brainAskClaude()` in `js/brain.js:287-325`. It exits immediately
unless a key is configured:

```js
if (!cfg.apiKey || cfg.apiKey.includes('YOUR-')) return null;
```

`config.js:21` ships `apiKey: 'YOUR-ANTHROPIC-API-KEY'` — **so in production this
function returns `null` on the first line and no network call is ever made.**

When enabled it would call `https://api.anthropic.com/v1/messages`, model
`cfg.model || 'claude-haiku-4-5'`, `max_tokens: 400`, **non-streaming**.

### System prompt — verbatim, in full

There is exactly one, `js/brain.js:301`:

```
You are Mitra, the assistant inside Orignals — an Indian everything-app (nearby shops, food, parcels, rides, movie tickets, hotels, property, earn-by-delivering). Reply in the user's language (English/Hinglish), warm and brief (max 3 sentences). Classify the request into exactly one intent.
```

That is the entire prompt. No other system/developer prompt exists in the repo.

### Tool / function definitions — verbatim

**`NOT FOUND`. There are none.** The request body has no `tools` array. The model is
constrained to structured output only (`js/brain.js:303-316`):

```js
output_config: {
  format: {
    type: 'json_schema',
    schema: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: BRAIN.intents },
        reply:  { type: 'string' }
      },
      required: ['intent','reply'],
      additionalProperties: false
    }
  }
}
```

**The model returns two strings. It cannot spend money, place an order, book a seat,
change an address, cancel, or refund. It has no mechanism to.**

What Mitra actually is in production: a rule engine (`ruleIntent()`, `mitraThink()` in
`js/mitra.js`) plus an **on-device classifier** — a hashing-trick softmax over
character n-grams, ~`BRAIN.D` weights in a `Float32Array`, trained in the browser
(`js/brain.js:173-205`). No server, no GPU, no API.

### Human confirmation before irreversible actions

**Yes, and it is the only path.** Every order Mitra can cause is behind an explicit
button. `js/mitra.js:419-430`:

```js
const a = regAction(() => mitraPlaceOrder(shop.id, item.id, q));
...
<button class="mbtn" onclick="runMitraAction(${a})">Confirm — pay ${money(total)} from wallet</button>
```

All three `mitraPlaceOrder` call sites (`mitra.js:378, 410, 426`) are wrapped in
`regAction()` and surfaced as a "Confirm — pay" button. **No code path lets a
classified intent execute a purchase without a click.**

### The exception — and it is a real one

`js/mitra.js:224`, inside the wallet branch:

```js
const amt = Math.min(parseInt(addM[1], 10), 10000);
walletAdd(amt, 'Added via Mitra · UPI');
```

Typing **"add 5000 to wallet"** credits ₹5,000 immediately — **no confirmation, no
payment, no gateway.** `walletAdd` is purely local (`js/core.js:210-214`):

```js
function walletAdd(amt, label) {
  S.wallet.bal += amt;
  S.wallet.txns.unshift({ id: uid(), ts: Date.now(), label, amt });
  save(); refreshChrome();
}
```

The transaction is **labelled `'Added via Mitra · UPI'`** though no UPI transaction
occurred. This is money creation from a chat message, described in the ledger as a
payment. See §F and §J — it is the same finding from three angles.

### Prompt injection surface

**Traced, and the chain is broken — but not by a control.**

Does Mitra read merchant-controlled text? **Yes.** `mitraThink()` matches user text
against shop item names, which merchants type themselves (`js/myshop.js:shopItemSave`,
and cloud shops via `cloudShopsRefresh`). Merchant text → matching → an order button.

Does that text reach a model? **No.** The only LLM call sends `messages: [{ role:
'user', content: raw }]` — **`raw` is the user's message and nothing else.** No shop
name, item name, description, category or review is ever placed in an LLM context.
There is no RAG, no retrieval, no context assembly into a prompt.

So the attack chain *merchant writes text → model reads it → model calls a spending
tool* **does not exist**, for two independent reasons: merchant text never enters a
prompt, and there are no tools. The mitigation is architectural (the model classifies,
the client acts), not a designed guardrail — there is no delimiting, quarantine or
allowlist, because nothing needs one yet. **If anyone later adds retrieval or tools,
that safety comes entirely from this accident and will vanish silently.**

Residual, non-LLM injection: a merchant *can* name an item to win keyword matching
("free milk best cheapest"). That is search gaming, not prompt injection. Rendering is
escaped (`esc(item.name)`), so no XSS.

### PII to third parties

Currently **none** — the LLM is off. If enabled, the only field leaving is the user's
raw message. No phone, address, order history or payment detail is in the request.
Note the user may *type* PII into the message; there is no scrubbing.

### API key exposure — a material design flaw

`js/brain.js:293-296` sets:

```js
'x-api-key': cfg.apiKey,
'anthropic-dangerous-direct-browser-access': 'true'
```

The key comes from `config.js`, which is **served to every browser**. Enabling Mitra's
LLM as designed publishes the Anthropic API key to anyone who opens devtools. It is
not exploited today only because the key is a placeholder. **This is a loaded gun with
the safety on.**

### Cost model

Not measurable — zero calls today, and no per-user limit exists. Modelling the *intended*
path: `max_tokens: 400`, prompt ≈ 80 tokens + user message. At Haiku pricing
(~$1/MTok in, ~$5/MTok out) a call is roughly **$0.002**. The fallback triggers only
when brain confidence `< 0.55` (`js/mitra.js`) — assume ~30% of messages, ~3 messages
per user: **10,000 users/day ≈ 9,000 calls ≈ $18/day ≈ $540/month**, with the key
public so the real ceiling is *whatever an abuser wants it to be*. **Per-user rate
limit or spend cap: NOT FOUND.**

### Failure handling

`js/mitra.js:434-437`: if `brainAskClaude` throws or returns null, the UI shows
`"Hmm, I didn't find that nearby..."`. No retry, no backoff, no error surfaced. A
provider 500 is indistinguishable from "I didn't understand". Acceptable, because the
local brain answers first and the LLM is a fallback to a fallback.

### Evals

**`NOT FOUND`.** No test set, no golden outputs, no regression suite, no offline
scoring, no CI. `brainStats()` (`js/brain.js:251`) computes accuracy **on the model's
own labels** — `labeled.filter(u => u.pred === u.label)` — i.e. it scores the model
against training data it already fit. That is not an eval; it is a mirror. The QA story
is "it looked right in dev."

### Non-determinism

**`temperature` is not set** (`js/brain.js:299-320`) — the API default applies. Output
is constrained by `json_schema`, and parsed with a bare `JSON.parse(txt.text)` inside
the `try` (`brain.js:322`) — malformed JSON throws, is caught, returns `null`, and the
user gets the generic fallback. `data.stop_reason === 'refusal'` is handled (`:320`).
The **local** classifier is fully deterministic.

---

## F. Money

### Gateway and mode

Razorpay. `config.js:28` — `keyId: 'rzp_live_TAZw82EBSPiSJL'`. **LIVE mode, in
production, right now.** Secrets are server-side only, named `RZP_KEY_SECRET` /
`RZP_WEBHOOK_SECRET` (`config.js:26`), values `<REDACTED>` and not in the repo.

Integration points: `supabase/functions/razorpay-order` (create), `razorpay-verify`
(confirm), `razorpay-webhook` (async truth). Client entry: `payViaRazorpay()`
(`js/core.js:434`, `js/account.js:38`).

### The ₹500 in the header — traced

**It is a hardcoded demo number.** `js/core.js:85`, inside `defaultState()`:

```js
wallet: { bal: 500, txns: [{ id: uid(), ts: Date.now(), label: 'Welcome gift 🎉', amt: +500 }] },
```

Every browser that loads orignals.shop is granted ₹500 and a matching "Welcome gift"
ledger entry, **before signup, before consent, before any human is involved.** It is
not a promo record, not a credit issued by a server, not redeemable against anything
real — it is a client-side integer in `localStorage`, and the user can edit it in
devtools. It shows to signed-out visitors because it exists before identity does.

### Is this a stored-value instrument?

**Mechanically, no money is held.** Reported exactly, for the compliance reviewer to
judge:

- **Table:** none. The wallet has **no server-side table.** `wallet_balances` and
  `wallet_txns` exist in `supabase/schema.sql:57` as a view/table, but the app's
  balance is `S.wallet.bal` in `localStorage` (`js/core.js:85`). **The authoritative
  balance is on the user's device.**
- **Ledger:** `S.wallet.txns[]`, client-side, unsigned, unauditable, user-editable.
- **Top-up path (real):** `topupWallet()` → `payViaRazorpay()` → on success
  `walletAdd(a, 'Added via UPI · ' + payId)` (`js/account.js:36-40`). Real money does
  reach Razorpay; the credit is then written **locally**.
- **Top-up path (synthetic #1):** if payment is not configured/fails, the fallback runs
  `walletAdd(a, 'Complimentary credit (pre-launch)')` (`js/account.js:45`) — **the user
  is credited anyway.**
- **Top-up path (synthetic #2):** Mitra, `walletAdd(amt, 'Added via Mitra · UPI')`,
  up to ₹10,000 per message, no payment (`js/mitra.js:224`).
- **Withdrawal path:** `js/earn.js:588-598` collects a UPI ID and amount (min ₹100)
  and calls `notify('Withdrawal successful', money(amt) + ' sent to ' + upi)`. **I
  found no payout API call on this path.** Searching for a payouts integration:
  `NOT FOUND`. The partner is told money was sent.

So: real rupees can flow **in** through Razorpay; the balance that results is a number
on a phone; and the "withdrawal" that flows **out** is a toast. The compliance question
the panel should put to the founders is not "is this a PPI" but "what happens the first
time someone tops up ₹2,000 and asks for it back."

### Order state machine

`js/core.js:createOrder` + `orderStatus()`. States: `placed → packing → picked →
on the way → delivered`, plus `cancelled`. Advance is **time-driven on the client**
(`core.js:364` fires notifications off a timer), with real cloud jobs overlaying real
partner state (`live_jobs.status`: open → taken → picked → done).

**Paths to a stuck order:** the client timer and the cloud job are two clocks with no
reconciliation. If a partner claims a job and never delivers, `live_jobs` stays
`taken`; the buyer's local order keeps advancing on its timer and will display
"delivered" regardless. There is no server-side order truth to fall back to for
non-cloud orders.

### Idempotency

**`NOT FOUND` on the client.** `checkoutSheet`'s pay button has no disabled state and
no in-flight guard I could find; `createOrder` mints `'OM' + rnd(10000,99999)` — a
**random 5-digit id with no uniqueness check**, so collisions are possible at
~1-in-90,000 per pair (birthday collision becomes likely in the low hundreds of
orders). Server side, `shop_orders.id` is a primary key so a duplicate *insert* fails,
and Razorpay dedupes by its own order id. **A double-tap before the sheet closes is
not demonstrably prevented in code.**

### Webhook signature — verified

`supabase/functions/razorpay-webhook/index.ts:11-27` — this one is done properly:

```ts
async function hmacHex(secret: string, msg: string): Promise<string> {
  ... crypto.subtle.importKey("raw", ..., { name: "HMAC", hash: "SHA-256" }, ...)
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
...
  const sig = req.headers.get("x-razorpay-signature") || "";
  const expected = await hmacHex(secret, body);
  if (expected !== sig) return json({ error: "bad signature" }, 401);
```

Signature computed over the **raw body** and compared before any processing. Correct.
(Note: `expected !== sig` is not constant-time; timing attack on an HMAC comparison is
theoretical here but a reviewer will flag it.)

### Refunds / cancellations

Client-side only. `cancelOrder()` → `walletAdd(o.total, 'Refund · ...')` — refunds
**to the local wallet integer**, never to the payment instrument. `cancelScheduled()`
and `cancelTicket()` (90% refund, `js/tickets.js:369-374`) behave the same. **No
Razorpay refund API call exists in the repo.** Money that entered via UPI cannot leave
by any code path I found.

### Race conditions

Balance: `S.wallet.bal += amt` — single-threaded JS on one device, so no race locally,
but **no server authority at all**, so two devices signed into one account each keep
their own balance. Inventory/seats: **there is a real one** —
`supabase/seats_schema.sql` implements seat holds with a DB constraint, and
`releaseSeatHold()` (`js/core.js:183`) frees them. That is the one place the codebase
takes concurrency seriously. `price_bounds` uses `samples` counters for moderation.
**Audit trail:** `analytics_events` + `payments` are append-only and server-side;
the wallet ledger is not.

### Rounding / currency / tax

All money is **integer rupees** — `Math.round()` throughout (`js/rides.js:69`,
`js/send.js:relayPlan`), no floats-as-currency, no paise on the client. Razorpay uses
`amount_paise bigint` server-side (`payments` table) — correct.

Currency display converts by a static rate table (`js/core.js CURRENCIES`) —
`detectCurrency()` forces INR for Asia/Kolkata. GST: computed and displayed
(`js/rides.js:70-72`: `gst = Math.round(fare * 0.05)`; cart: 5% on food), and shown on
a printable invoice (`#/invoice/<id>`). **The GST is arithmetic in the client. There
is no GSTIN on the invoice, no HSN/SAC codes, no tax registration number, and no
server-issued invoice number.**

---

## G. Verification — the brand's load-bearing claim

The homepage asserts (`js/home.js:50`, `:56`): **"Verified by our own people"**, **"No
adulterated ghee. No fake paneer. Every batch purity-tested — Safety · Purity ·
Sustainability."**

Here is what backs them.

### Is there a verification model?

**Partially — and it was added recently, not at the foundation.**

- `verify_queue` (`supabase/verify_schema.sql:9-22`) — real, with states
  `pending | verified | rejected`, `verify_submit` / `verify_pending` / `verify_decide`
  RPCs, L3+ gated. **Rows: 0.**
- `purity_checks` (`shop_id, batch, status, inspector, note, updated_at`) — the table
  exists in `supabase/schema.sql`. **Rows: 0. No JS file reads or writes it.** Orphaned.
- `service_providers.status` (`services_schema.sql:24`) — real, gated, and the
  **only** verification currently enforced against display: `service_list()` returns
  `where status='verified'` only.

### Who sets it?

For services: an L3+ admin via `service_verify()`. Real.
For shops and partners: **nothing.** `verify_decide` attempts to write
`partners.status` inside a swallow-all block (`verify_schema.sql:60-66`) — and
`partners` has 0 rows.

### Is there an admin UI?

Yes — `js/admin.js` tabs `kyc`, `purity`, `svcverify`, driven by `adminVerifyLoad()`
(`admin.js`). They render live from `verify_pending()`. They are currently **empty,
because nothing has ever been submitted.**

### "Purity-tested" — is there a lab result anywhere?

**`NOT FOUND`.**

Searched the full schema for lab/certificate/test-result/document fields backing a
purity claim. There is:
- `purity_checks.batch text` and `.note text` — a batch label and free text. No result
  value, no test type, no lab identity, no test date, no document, no expiry.
- **No file/document upload for a certificate.** Storage bucket `shopimg` exists and
  holds shop/item photos (`shop_menu_schema.sql`) — not certificates.
- No `lab`, `assay`, `adulterant`, `test_result`, `coa` column anywhere in 2,910 lines
  of SQL.

**There is no data model capable of representing a purity test result.**

### Is the "Verified" badge computed, or a constant?

**A constant.** `js/shops.js:41`, in the card every buyer sees:

```js
<div class="shop-line1"><b>${esc(s.name)}</b><span class="vbadge">${ic('check', 9)} VERIFIED</span></div>
```

There is no condition. **Every shop rendered by this component displays "VERIFIED",
unconditionally, regardless of any field.** Seed shops in `js/data.js` carry no
`verified` property at all (the 15 `verified` matches in that file are on
`eventPros`/`venues`, not `shops`). The store page repeats it as prose
(`js/shops.js:167`: "Verified seller · GST registered · FSSAI licensed") — also
unconditional. The freshness pledge I found at `js/shops.js:168` renders for any food
shop where `s.fresh !== false` — i.e. **by default, opt-out, not opt-in.**

### Can a merchant get the badge without a human checking anything?

**Yes. Automatically, in about two minutes, with no review whatsoever.**
`submitShopReg()` (`js/myshop.js:189-199`) writes `S.myShop` and the shop is live;
GST and FSSAI inputs are explicitly **"(optional)"** (`js/myshop.js:85-86`). The
go-live checklist requires an item, a location pin, a payout account and the online
toggle (`js/myshop.js:362-373`) — **it does not require verification, and no human is
notified.**

### The finding, stated plainly

**"Verified by our own people", "No adulterated ghee. No fake paneer" and "Every batch
purity-tested" are copy strings. The "VERIFIED" badge is hardcoded into a template and
shown on every shop. There is no purity test result in the data model, no lab
artefact, no inspector workflow that has ever run, and no gate between a merchant
signing up and their shop displaying the verification badge to buyers.**

The verification *machinery* built recently (`verify_queue`, the admin queues, service
verification) is real, gated and tested — but it is **not connected to the badge**, and
it has **zero rows**. The claim is currently a promise made by CSS, not by data.

---

## H. Frontend & design system

**Design tokens:** yes, real ones — CSS custom properties in `css/app.css`
(`--primary`, `--line`, `--card`, `--mut`, `--grad`, `--leaf-900`, `--disp`). Dark mode
flips them via a `data-theme`/class on root. Mostly disciplined; recent additions
(mine and others) leak ad-hoc hex — e.g. `#b45309`, `#e9f7ee`, `#bfe6cd` inline in
`js/myshop.js` and `js/estate.js`, and `#3457d5` in `css/app.css` `.call-btn.video`.

**Component inventory:** there are no components — there is no component system. UI is
template literals returning HTML strings. "Components" are CSS classes:
`.btn-main` (+ `.sm .wide .ghost .alt .lg .red` modifiers), `.btn-cta`, `.mbtn`,
`.lnk`, `.chip`, `.sortchip`, `.topup`, `.call-round`, `.seg`, `.role-row`,
`.place-row`, `.tier-row`, `.job-card`, `.shop-card`, `.prop-card`, `.event-card`,
`.etile`, `.ck-line`. **Button implementations: at least 7 distinct ones**
(`btn-main`, `btn-cta`, `mbtn`, `lnk`, `chip`, `topup`, `call-round`) with overlapping
purposes. Duplicated card shells: `job-card` / `shop-card` / `prop-card` / `event-card`
are near-identical structures.

**Styling:** two hand-written stylesheets, 1,580 lines, no preprocessor, no utility
framework, no CSS modules. Global namespace; collisions are prevented by convention only.

**Dark mode:** toggle at `index.html:77`, `toggleTheme()` in core. It works on
tokenised surfaces. It **does not** work on the inline hex I listed above — the
freshness pledge (`#e9f7ee`) and the amber payout nudge (`#b45309`) are light-mode
colours painted regardless of theme. The call overlay hardcodes `#0c1512`.

**Responsive:** genuine breakpoints, not a stretched phone — `css/app.css:408` (`min-width:601px`), `:423` (601–800), `:430` (`min-width:1024px`), and grids re-column per breakpoint (`.svc-grid`, `.shop-list`, `.mega-grid`).

**The empty desktop hero — the layout code responsible:** `css/app.css:431`:

```css
@media(min-width:1024px){
  .frame{max-width:min(96vw,1440px);border:none;box-shadow:0 0 80px rgba(19,20,43,.06)}
```

The frame is centred and capped, but the **hero itself is a single left-aligned column**
— `js/home.js:47-56` emits `home-greet`, an `<h1>`, a promise strip and the Mitra bar
with no right-hand content and no two-column desktop treatment. At 1440px the right
half is empty by construction: nothing is positioned there. This is a mobile layout
given more room, not a desktop layout.

**Accessibility — concretely, and it is the weakest area of the frontend:**
- **Icon-only buttons have no accessible name.** `index.html:73-82`: the bell, theme
  and profile buttons have `title=` but **no `aria-label`**; their content is a bare
  `<svg>` with no `<title>`. A screen reader announces "button".
- **The voice input has no ARIA.** Searched `js/mitra.js` for `aria-`: `NOT FOUND`.
  The mic control is a `<button>` with an icon and no label, no `aria-pressed`, no live
  region announcing recognition state.
- **Sheets are not dialogs.** `sheet()` (`js/core.js:173-178`) injects HTML and adds a
  class. There is **no `role="dialog"`, no `aria-modal`, no focus trap, no focus
  restore, no Escape handler.** Keyboard users tab straight out of the checkout sheet
  into the page behind it. **The checkout path is not keyboard-operable to a
  standard.**
- **Focus management:** the only focus calls are `el.focus()` on text inputs
  (`js/auth.js:50`, `:253`). No `:focus-visible` styling I could find.
- **Contrast:** `--primary` `#1A5632` on white ≈ **8.9:1** — passes AA and AAA. The
  risk is inverted usages: white on `#E8A020` (the amber accent, `index.html:60`) ≈
  **2.1:1** — **fails AA** for normal text. `.dim`/`--mut` greys on tinted cards are
  borderline and unmeasured.
- **Alt text:** images are decorative-ish and mostly `alt=""` (`js/shops.js`,
  `js/estate.js:76`) — defensible. Shop cover images (`js/myshop.js:318`) also
  `alt=""`, which loses information.
- Heading order and landmarks: one `<main>`, one `<header>`, `<nav>` — reasonable.

**Bundle / performance:** no bundler, so "chunks" = 30 blocking `<script>` tags in
`index.html:124-155`, **none with `defer` or `async`** except the two CDN libs
(`index.html:17-18`). ~9,600 LOC of JS parses before first meaningful paint. Fonts:
two families from Google Fonts with `display=swap` and preconnect (`index.html:20-22`)
— correct. Images: remote Unsplash URLs with `loading="lazy"` and `onerror` removal
(`js/tickets.js`, `js/estate.js:76`) — no responsive `srcset`, no dimensions (layout
shift), no self-hosting. **Lighthouse: not run — I have no browser in this
environment.** Main-thread block: the 30 synchronous scripts, plus `brainSeedTrain()`
which runs a **12-epoch training loop over the seed corpus in the main thread**
(`js/brain.js:196-205`) whenever the seed version changes.

---

## I. PWA

**Manifest** (`manifest.json`): name/short_name, `display` + `display_override`, `id`,
theme `#1A5632`, PNG icons at 192/256/384/512 + maskable-512 + apple-touch-180,
shortcuts. iOS meta tags at `index.html:11-15`. This part is done properly.

**Service worker** (`sw.js`, cache `orignals-v37`):
- **Precache (`SHELL`, `sw.js:7-15`):** index.html, both CSS, **all 30 JS**,
  manifest, config.js, 4 icons. `install` → `cache.addAll(SHELL)` → `skipWaiting()`;
  `activate` → delete old caches → `clients.claim()` (`sw.js:39-46`).
- **Strategy (`sw.js:58-99`):** map tiles → cache-first, capped at 900 with
  `trimTiles()`. Supabase / Nominatim / Razorpay / Anthropic → **never cached**
  (explicit bypass, `sw.js:74-75`) — correct, money and state stay live. Same-origin
  app shell → **network-first**, cache as fallback. Third-party (unpkg) → cache-first.
- `js/core.js` registers it and reloads once on `controllerchange`.

**Does it actually work offline?** The banner claims "Add to home screen — works
offline" (`js/account.js:120`). Verdict: **partially, and the claim is oversold.**
- What works offline: the shell, all JS/CSS, cached map tiles, and any screen that
  reads only `localStorage` (your orders, wallet, cart, profile, Mitra's on-device
  brain). The network-first fetch falls back to cache, and finally to `index.html`
  (`sw.js:85`), so the app opens.
- What does not: **every Supabase call is bypassed by design**, so shops list, cart
  checkout, chat, admin, analytics, verification, services and payments all fail with
  no queue and no retry. There is **no background sync, no outbox, no mutation
  queue** — `NOT FOUND`. `cloudQueue()` exists in `js/brain.js:236` for training data
  only.
- So: the app *launches* offline and shows your own past data. It cannot *transact*
  offline. "Works offline" is true of the shell, false of the marketplace.

**Install prompt trigger** (`js/core.js`): `beforeinstallprompt` is captured and a
custom banner is shown. I did not find a delay/engagement gate — the banner is
governed by the captured event and a dismissal flag, so it can appear on the first
visit, close to first paint.

---

## J. Behavioural & dark-pattern review

### "Your usual" for logged-out visitors — the panel's premise is **not reproducible in this commit**

`js/home.js:5-18`:

```js
function usualStripHTML() {
  const past = S.orders.filter(o => o.kind === 'shop' && o.shopId && orderDone(o) && !o.cancelled);
  if (!past.length) return '';
  ...
  if (!usual.length) return '';
```

It is built **only** from completed, non-cancelled shop orders in `S.orders`, and
`defaultState()` seeds `orders: []` (`js/core.js:87`). **A genuinely first-time device
gets an empty string — the strip does not render.** There is no hardcoded product array
behind it and no "Desi Cow A2 Milk" constant in `js/home.js`.

**Verdict: real data, not synthetic.** Two honest caveats the panel should hold:
(1) `S.orders` is **device-local, not account-local** — so a *signed-out* but
*returning* visitor who ordered as a guest will correctly see "Your usual" without
being logged in. That is their real history, not a fabrication; and (2) I audit the
code at `c6b21a1`, not whatever build the reviewer saw. If A2 milk appeared for a
fresh visitor, it came from a build I cannot see, or from a device with prior orders.

### The ₹500 balance to a signed-out user — **synthetic, confirmed**

`js/core.js:85` — covered in §F. Every visitor, pre-signup, pre-consent, is granted
₹500 and a `'Welcome gift 🎉'` ledger line. It is a number in `localStorage`.

### Manufactured scarcity — **synthetic, confirmed**

`js/tickets.js:11-12` — this is the clearest dark pattern in the codebase:

```js
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function showAvail(mid, t) { const r = hash(mid + t) % 10; return r < 5 ? 'avail' : r < 8 ? 'fill' : 'full'; }
```

Rendered at `js/tickets.js:168-172` as **"Filling fast"** and **"Almost full"**, with a
legend. **This is a hash of the show id and time string — pure fabrication.** It is not
derived from `seat_bookings` (which is a real table with real holds). A show is
"Almost full" because of its name, deterministically, forever. Clicking a "full" show
toasts *"This show is almost full — pick another"* — a scarcity claim about seats that
were never counted.

Mitigating fact for the panel: **Movies is no longer reachable from the nav** — it was
removed and the section replaced with Events (`js/core.js:452`, `js/home.js:70`). The
code is dormant, but `js/tickets.js` still ships in the bundle and the `seats/` route
still resolves.

### Inflated strike-through pricing — **conditional, source depends on who typed it**

`js/shops.js:148`:

```js
${money(i.price)}${i.mrp ? `<s>${money(i.mrp)}</s><em>${Math.round((1 - i.price / i.mrp) * 100)}% off</em>` : ''}
```

`mrp` is seed data for demo shops (`js/data.js`) and **merchant-entered** for real
shops. Nothing validates that `mrp` was ever a real price. There is a real price
moderation system (`price_bounds`, `price_check` — `supabase/shop_menu_schema.sql`)
that flags outliers on `price`, but **I found no equivalent check on `mrp`** — so the
discount percentage is unpoliced.

### Other patterns

- Countdown timers: **NOT FOUND.**
- "N people viewing": **NOT FOUND.**
- Pre-ticked boxes: **NOT FOUND** — `agree-row` toggles default off (`js/earn.js:42`).
- Roach-motel unsubscribe / confirmshaming: **NOT FOUND.** Cancellation is one tap with
  a plain confirm and a full refund message.
- Testimonial: `js/earn.js:150` — *"I drop 2 tiffins on my way to college… That's ₹1,800
  a month extra." — Ravi K. · cycle partner · 4,820 trips · ★ 4.9*. **This is a
  hardcoded string with a fabricated trip count and rating attributed to a named
  person.** With 0 rows in `partners`, Ravi K. does not exist. That is phantom social
  proof on the recruitment page.
- Seed shops: 14 rows in `shops` with names, ratings (★4.4–4.8) and rating counts —
  demo content presented identically to real merchants, all wearing the hardcoded
  VERIFIED badge.

### Notification badge

**Real.** `notifUnread()` (`js/core.js:207`) counts `S.notifs.filter(n => !n.read)`,
and `#bellDot` reflects it. But `S.notifs` is itself seeded — `defaultState()` gives
`notifs: []`, then boot fires `notify('Welcome to Orignals', '… ₹500 free in your
wallet.')` (`js/core.js:508`) — so a first-time user has exactly one unread, which is
the app talking about the money it invented.

### Consent

`maybeShowConsent()` (`js/legal.js:189`) runs **700 ms after boot** (`js/core.js:507`).
By then the app has already: seeded ₹500, written `localStorage`, generated a device
key, and — via `trackPage()` in `route()` — **sent an analytics beacon to
`/api/track`, which forwards device key, session, page, role, language and Vercel
edge geo (country/region/city/lat/lng) to Supabase** (`api/track.js:19-41`).

**So yes: personal-ish data is collected and transmitted before consent is shown.**
There is a legal hub and a data export/erase page (`js/legal.js:145`,
`view('legal/data')`), which is more than most. Whether rejecting is as easy as
accepting: I could not determine the banner's button symmetry from
`maybeShowConsent()` alone without rendering it — **flagging as an open question.**

### Weighed against "Real. Verified."

The platform's promise is *Real. Verified. Nearby.* Against that standard this section
finds: **an invented ₹500, a hash-generated scarcity signal, a fabricated testimonial
with a fabricated trip count, an unconditional VERIFIED badge, and analytics before
consent.** "Your usual" and the notification badge, notably, are honest. The synthetic
items are not incidental — they sit on the home page, the earn page and the header,
which is exactly where the promise is made.

---

## K. Scope — quantified

| vertical | files | LOC | endpoints (RPC) | tables | real / stub / dead | last commit |
|---|---|---|---|---|---|---|
| grocery (shops + myshop) | 2 | 1,446 | ~12 (`shop_upsert`, `shop_orders_*`, `price_check`, `rate_shop`, `chat_*`) | shops, shop_items, shop_orders, shop_ratings, price_bounds | **real** — cloud orders, chat, ratings, price moderation all wired | 2026-07-12 |
| send (parcels + relay) | 1 | 216 | 3 (`job_post`, `job_claim`, `job_ping`) | live_jobs | **real** (jobs) + relay pricing is **client-only computation**, no carrier integration | 2026-07-12 |
| rides | 1 | 106 | shares `live_jobs` | live_jobs | **partly stub** — fare/route/GST real; captain matching reuses the parcel job board | 2026-07-11 |
| movies/tickets | 1 | 511 | `seats_*` | seat_bookings, tickets | **dead** — removed from nav; seat holds real, availability pills **synthetic** | 2026-07-11 |
| dining | 0 (inside tickets.js) | ~90 | `reservations` | reservations | **real-ish** — reservation writes to cloud, notifies shop | 2026-07-11 |
| property/stays | 1 | 322 | `listing_post`, `lead_post`, `my_leads` | listings, listing_leads, properties | **real** — cross-device listings + enquiries | 2026-07-12 |
| services | 1 | 105 | 5 (`service_register/list/mine/enquire`, `service_verify`) | service_providers, service_enquiries | **real** — the only vertical with enforced verification | 2026-07-12 |
| mitra + cognitive core | 8 | 1,505 | `mitra_train`, `mitra_predict` | mitra_utterances, mitra_model, mitra_global_model | **real but local** — on-device classifier; LLM **off**; cortex/memory/reason/agents are client-side telemetry | 2026-07-12 |
| shared | 16 | 5,380 | ~100 | 40+ | core, cloud, auth, admin, analytics, geo, earn, legal, call, face | 2026-07-12 |

### Genuinely shared vs duplicated

**Genuinely shared (would survive any narrowing):** `core.js` (state, money, routing,
sheets, checkout), `cloud.js`, `auth.js` + `face.js`, `geo.js`, `analytics.js`,
`legal.js`, `icons.js`, `admin.js` (RBAC/HRMS/analytics are vertical-agnostic),
`call.js`, the Mitra stack. That is ~5,400 LOC + ~2,900 LOC of SQL.

**Duplicated across verticals:** the *pattern* rather than the code — each vertical
hand-rolls its own list → card → sheet → `checkoutSheet` flow with a near-identical
card shell (`job-card`/`shop-card`/`prop-card`/`event-card`) and its own local wizard
state object (`SEND`, `RIDE`, `PROP`, `SREG`, `REG`, `_SL`, `_SVC`). There is no shared
list/card/wizard abstraction, so the duplication is in structure and CSS, not in
copy-pasted logic.

### If seven verticals collapsed to one (grocery), what deletes cleanly?

- **Deletes cleanly (~1,260 LOC, ~13% of JS):** `tickets.js` (511, already dead),
  `estate.js` (322), `rides.js` (106), `send.js` (216), `services.js` (105) — plus
  their tables. Each is self-contained behind one route; nothing else imports them.
- **Entangled:** `earn.js` (607) — the partner/delivery layer is *shared* by grocery,
  send and rides; you cannot delete it, you must untangle rides out of it.
  `js/data.js` mixes all verticals' seed data in one object. `admin.js` has per-vertical
  tabs interleaved in one 906-line render. `home.js` and `core.js:452` nav enumerate
  verticals inline. `mitra.js` has a branch per vertical and `MITRA_HELP` enumerates
  all routes.
- **Answer to "what does narrowing cost":** roughly **13% deletes in an afternoon**,
  another ~10% needs surgery in `earn.js`/`data.js`/`admin.js`/`mitra.js`. The
  verticals are **cheap to remove** — they were built additively behind routes. The
  cost of breadth here is not entanglement; it is that ~4,600 LOC of vertical code is
  maintained against ~1 real order.

---

## L. Security

### Secrets in git history

Checked history, not just the tree (`git log --all -p -- config.js`). Findings:

| name | status |
|---|---|
| `apiKey` (Anthropic) | placeholder `YOUR-…` in every revision. **Never a real key committed.** |
| `keyId` = `rzp_live_StUJDjsi0hfYyx` | committed, **superseded** |
| `keyId` = `rzp_live_TAZw82EBSPiSJL` | committed, **current** |
| `supabaseAnonKey` | committed |
| `push.vapidPublic` | committed |
| `RZP_KEY_SECRET`, `RZP_WEBHOOK_SECRET`, VAPID private | **not in repo** — Supabase secrets, `<REDACTED>` |

**Assessment: no key needs to be treated as burned.** Razorpay Key IDs, the Supabase
anon key, and a VAPID *public* key are public-by-design. The one live rotation
(`StUJDjsi0hfYyx` → `TAZw82EBSPiSJL`) appears to be a merchant change, not an incident.
The genuinely dangerous secrets were kept server-side. **This is done correctly.**

The forward-looking risk is §E's: the architecture *invites* an Anthropic key into
`config.js`, which is served publicly. The moment someone fills that field, the key is
burned on the next deploy.

### Injection

- **SQL:** all DB access is via parameterised RPC arguments; every function sets
  `search_path=public` (or `public,extensions`). I found **no dynamic SQL string
  concatenation** anywhere in 2,910 lines. Clean.
- **XSS:** no framework, so **everything is `innerHTML` with template literals** —
  this is the app's largest injection surface. It is defended by a single helper,
  `esc()`, applied by hand at every interpolation. I spot-checked the paths that carry
  attacker-controlled text: shop/item names (`js/shops.js:41,148`), chat messages
  (`js/shops.js:508` — `esc(m.msg)`), service provider fields (`js/services.js`),
  Mitra echoes (`js/mitra.js:423`), stay listings (`js/estate.js`). **All escaped.**
  The risk is not a known hole; it is that **safety depends on a human remembering
  `esc()` on every one of hundreds of interpolations, forever, with no linter and no
  test.** One omission on a merchant-controlled field is stored XSS against buyers.
  `dangerouslySetInnerHTML`: N/A (no React).
- **Template injection:** N/A.

### File uploads

`js/myshop.js` — `pickPhoto()` / `compressImage()` / `shopSetCover()`. Client
compresses to a data URL and `cloudUploadImage()` (`js/cloud.js`) PUTs to Supabase
Storage bucket **`shopimg`**. Type check: the `<input accept="image/*">` and a canvas
re-encode (which effectively strips non-images). Size: bounded by canvas
re-compression, **no explicit byte limit found**. **The bucket is public-read** (it
must be, to render shop photos). Face descriptors go to `face_enrollments` as numbers,
not images. **No server-side MIME/magic-byte validation** — `NOT FOUND`.

### Rate limiting / brute force

- OTP: **yes** — `select count(*) ... where phone=p_phone and created_at>now()-interval '10 minutes'` (`auth_schema.sql:52`) plus an `attempts` counter (`:73`).
- Login: **NOT FOUND.** `auth_login` has no lockout, no attempt counter, no delay.
  Unlimited password guessing against bcrypt, gated only by Supabase's platform limits.
- `track_hit` (public beacon): **NOT FOUND.** Anyone can flood `analytics_events`.
- `verify_submit`, `service_register`: de-dupe only (`verify_schema.sql:29-30`).

### IDOR

The ownership predicate is `chat_is_participant()` (`order_chat.sql:20-24`), keyed on
`p_device` **supplied by the client**. There is no `/api/orders/<id>` to enumerate
(orders are local), so the classic IDOR does not apply. But **`chat_read(p_order,
p_device)` will return an order's chat to anyone who presents that order's buyer
device key** — the device key is the capability, and it is a client-generated string
stored in `localStorage`, never bound to the authenticated session token.

### Dependency vulnerabilities

`npm audit`: **not applicable — no package.json, no dependencies.** The runtime CDN
libraries are pinned by version except **Razorpay's `/v1/checkout.js`, which is
unversioned and executes on the payment page**.

### Security headers

**`NOT FOUND`.** `vercel.json` contains only `rewrites` — no `headers` block. Therefore
**no CSP, no HSTS, no X-Frame-Options, no X-Content-Type-Options, no
Referrer-Policy.** For an app that is ~100% `innerHTML`, **the absence of a CSP is the
single highest-leverage missing control in this audit** — it is the defence-in-depth
that would blunt exactly the XSS class the architecture is most exposed to. The app is
also framable (clickjacking on the checkout sheet).

### SSRF

The client fetches user-influenced URLs only for Nominatim/OSRM with encoded lat/lng
(`js/geo.js`, `js/analytics.js:74`). `api/track.js` fetches **one hardcoded Supabase
URL**. Edge functions call Razorpay's fixed host. **No user-supplied URL is fetched
server-side.** Clean.

### Logging

`console.warn` in `js/brain.js:353`, `console.log` on model adoption (`:350`). No
server log aggregation exists (§M), so there is nowhere for PII to accumulate. Edge
functions return errors as JSON. `payments.raw jsonb` stores the **Razorpay webhook
payload verbatim** — which contains payment metadata and potentially contact fields.
That is the one place to check for card/PII retention; I could not inspect row contents
(0 relevant rows / redaction policy).

---

## M. Ops & instrumentation

**CI/CD:** **`NOT FOUND`.** No `.github/workflows`, no pipeline, no checks. Deploy is
`git push origin main` → Vercel builds (nothing to build) and serves. **There is no
gate between a keystroke and production.** No linter, no formatter, no type checker, no
test run.

**Environments:** **one.** No staging, no preview discipline, no env separation.
`config.js` hardcodes the production Supabase project and a **live** Razorpay key. The
same database serves development and production.

**Migrations:** 26 `.sql` files in `supabase/`, **applied by hand** (this session
applied several via the Management API). There is **no migration runner, no ordering,
no version table, no `down`, no rollback.** Files are idempotent-ish by convention
(`create table if not exists`, `create or replace function`). **Rollback strategy:
NOT FOUND.** Reconstructing the schema from scratch means guessing the correct order of
26 files.

**Error tracking:** **NOT FOUND.** No Sentry, no Bugsnag, no `window.onerror` handler,
no `unhandledrejection` handler. A JS exception is silent — and since 30 scripts share
one global scope with no modules, a top-level throw in one file can leave the app
half-initialised with no report. There is an `error_log` table in the database with no
writer I could find.

**Uptime monitoring / alerting / log aggregation:** **NOT FOUND**, **NOT FOUND**,
**NOT FOUND**. If orignals.shop returns 500 at 2am, nobody is told.

**Backups:** Supabase's managed daily backups apply on the platform tier. **Whether a
restore has ever been tested: no evidence in the repo — assume no.**

**Analytics — the decisive question**

Events that fire (`js/analytics.js`): `page` on every route change (`trackPage` called
from `route()`), `ping` every 20s while visible, and **exactly one** custom event —
`js/core.js:318`:

```js
if (typeof trackEvent === 'function') trackEvent('order', o.total || 0);   // analytics: conversion + GMV
```

Searched all 30 JS files for other `trackEvent(` calls: that is the only one.

> **Can this team currently answer "how many people reached checkout and didn't
> finish"? — No.**

Plainly: there is **no `checkout_started` event, no `add_to_cart`, no
`payment_attempted`, no `payment_failed`, no `signup_started`.** `checkoutSheet()`
(`js/core.js:416`) fires nothing when it opens. The funnel is: *page views* → *order*.
Everything between the basket and the money is invisible. You can see that someone
visited `cart`, and you can see an order if it completed — you cannot distinguish
"never opened checkout" from "opened it and abandoned at payment", which is the single
number that would tell this team what to fix. Server-side, `payments` rows exist for
attempts, but they are not joined to any funnel.

The analytics that *do* exist are unusually good for a pre-launch app — first-party,
RLS-gated, real geography, live map, new-vs-returning, hourly, browser/language
breakdowns (`supabase/analytics_precise.sql`). The instrument is well-built and
pointed at the wrong part of the problem.

**Tests**

**Zero.** `test_files: 0`. No unit, integration, e2e, contract or smoke test in the
repo. `docs/loadtest.js` exists but is a load script, not a test.

- **Is the payment path tested?** **No.**
- **Is the auth path tested?** **No.**
- **Is anything tested?** **No.** The verification evidence in this codebase is
  ad-hoc: scripts written and thrown away against the live database (I did exactly
  this to verify TOTP, HRMS, settlement, verify and fraud during development). Those
  checks are not committed, not repeatable, and not run again. **Every deploy is
  regression-tested by a human clicking.**

---

## N. Compliance & content (India) — presence/absence only

### Legal pages

| page | status | evidence |
|---|---|---|
| Privacy policy | **present** | `view('legal/privacy')`, `js/legal.js:184`; linked `js/account.js` footer |
| Terms | **present** | `view('legal/terms')`, `js/legal.js:184` |
| Refund / cancellation | **present** | `view('legal/refund')`, `js/legal.js:32` |
| Shipping / delivery policy | **present** | `view('legal/shipping')`, `js/legal.js:110` |
| Grievance officer | **present** | `view('legal/grievance')`, `js/legal.js:123` |
| Contact with a real physical address | **UNVERIFIED** | a grievance page exists; I did not find a street address, registered entity name or CIN in `js/legal.js`. **Flagging, not asserting** — the page renders text I did not fully read out. |

So the pages a gateway asks for exist as routes. **The launch-blocker risk is not their
absence but their contents** — specifically whether a real registered address and
entity name appear, which I could not confirm.

### DPDP surface

- **Collected:** name, phone, email/ident, delivery address + GPS lat/lng, device key,
  order history, wallet ledger, chat messages, **face descriptors** (128-float vectors,
  `face_enrollments`), partner govt-ID/DL uploads (`js/earn.js:164` — labelled "masked
  & encrypted"), payment metadata, and analytics (page, geo, browser, language).
- **Stored:** Supabase Postgres (region not asserted in repo — **open question**;
  DPDP/RBI localisation turns on this), plus `localStorage` on device.
- **Retention:** **NOT FOUND.** No TTL, no purge job, no retention policy in any SQL
  file. `analytics_prune(p_token, p_keep_days)` exists (`analytics_schema.sql:115`) but
  is **manual and L5-only** — nothing calls it on a schedule. `auth_sessions` never
  expire. **Data is kept forever by default.**
- **Deletion path:** **present and real** — `view('legal/data')` (`js/legal.js:145`)
  offers export ("Download everything Orignals holds for you on this device") and
  erase ("Permanently delete your personal data from this device and our servers…").
  Note the export is scoped to *this device*.
- **Face data:** biometric data is sensitive under DPDP. It is verified server-side
  (euclidean distance < 0.55) and stored as descriptors, not images —
  `supabase/face_schema.sql`. Consent for biometric enrolment is the enrol button
  itself.
- **Consent ordering:** as established in §J, the analytics beacon fires **before** the
  consent sheet appears.

### Food claims / FSSAI

- **Merchant FSSAI captured?** **Yes, but optional** — `js/myshop.js:86`: *"FSSAI
  licence (optional, for food)"*, stored as `SREG.fssai` → `S.myShop.fssai`
  (`myshop.js:193`).
- **Displayed?** Only as a conditional dash on the owner's own dashboard
  (`js/myshop.js:322`: `${M.fssai ? '· FSSAI ✓' : ''}`). To buyers, the store page
  prints **"Verified seller · GST registered · FSSAI licensed" unconditionally**
  (`js/shops.js:167`) — i.e. **the buyer-facing FSSAI claim is not conditioned on the
  merchant having supplied an FSSAI number.**
- **Any FSSAI number displayed anywhere to a buyer?** **NOT FOUND.**
- **Validated against any registry?** **NOT FOUND.**
- This connects directly to §G: the ghee/paneer/purity claims sit on top of an
  **optional, unvalidated, undisplayed** licence field.

### GST

- **Merchant GSTIN captured?** Yes, **optional** (`js/myshop.js:85`).
- **On invoices?** The invoice view (`#/invoice/<id>`, `js/shops.js`) renders a GST
  **amount** from the client-side `bill` breakdown. **I found no GSTIN, no HSN/SAC, no
  place-of-supply, no CGST/SGST/IGST split, and no sequential government invoice
  number.** It is a receipt that shows a tax line.
- **B2B:** wholesale shops advertise "GST invoice provided" (`js/shops.js:170`).

### Merchant onboarding KYC

`verify_queue` + admin queues exist and are gated (§G). **Zero submissions.** A shop
goes live with no KYC (`js/myshop.js:362-373`).

### Localisation

- **UI i18n: NOT FOUND.** No locale files, no message catalogue, no `t()`. **The entire
  interface is hardcoded English**, with Hinglish sprinkled in copy.
- **Mitra is multilingual, the app is not.** `MITRA_LANGS` (13 scripts, `js/brain.js:28`),
  `BRAIN_SEED_ML` (22-language training pack), `WORLD_SCRIPTS`/`WORLD_LANGS` +
  a 289-entry registry (`js/langs.js`) — these detect and classify **input**, and let
  Mitra greet in-language. Mitra's *replies* are English/Hinglish templates.
- **Hindi support:** input yes, interface no.
- **DB content language:** English (`js/data.js` — `'All'`, `'Organic'`, `'Kirana'`,
  shop and item names in English/transliterated Hindi).

---

## Open Questions

Ten things I could not determine from the code, in rough order of how much they'd
change the panel's read:

1. **What is the ₹500 supposed to be?** A marketing promo the company intends to honour
   (real liability), or demo scaffolding that was never removed? The code cannot
   distinguish "we owe every visitor ₹500" from "this is a placeholder." The answer
   decides whether §F is a compliance question or a cleanup ticket.
2. **Has any real money moved through the LIVE Razorpay key**, and has anyone ever
   withdrawn? There are 9 `payments` rows; I could not read their status/amounts. If a
   real user has ever topped up, the missing payout path (§F) is an active liability.
3. **Do the 14 seeded shops correspond to real businesses that consented to be
   listed?** They carry names, ratings and a VERIFIED badge. If they are invented, that
   is a different finding than if they are real shops pending onboarding.
4. **Where is the Supabase project hosted (region)?** Not asserted anywhere in the repo.
   Data-localisation obligations for payment and personal data turn on this.
5. **Is there a registered legal entity, and does the grievance page carry its real
   name and address?** I found the route, not a verified address. Gateways and the IT
   Rules both hang on this.
6. **Was the Razorpay key rotation (`StUJDjsi0hfYyx` → `TAZw82EBSPiSJL`) routine, or an
   incident response?** History shows the change, not the reason.
7. **Is `partners.status` supposed to exist?** `verify_decide` writes to it inside a
   swallow-all `exception when others then null` block — which means either the column
   is missing, or a real failure is being silently eaten in the KYC approval path.
8. **What is the intended source of truth for an order** — the client timer or
   `live_jobs`? Two clocks currently run with no reconciliation, and the client wins on
   screen.
9. **Does the consent sheet make rejecting as easy as accepting?** I read the trigger,
   not the rendered banner. This is one function (`maybeShowConsent`) away from being a
   DPDP finding either way.
10. **Who is the panel's "our own people"?** The verification claim implies field
    inspectors. `admin_users` has 0 rows besides the founder, and `purity_checks` has
    never been written to. If the inspectors don't exist yet, the copy is aspirational
    and §G is the headline finding of this dossier.

---

### Summary for the reader in a hurry

**What is genuinely real:** the backend (56 tables, 141 RPCs, RLS on everything,
security-definer gates), bcrypt auth, TOTP 2FA verified against the RFC vector,
webhook HMAC verification, seat-hold concurrency, first-party analytics with real
geography, price moderation, the services verification pipeline, cross-device listings
and chat, and an on-device multilingual intent classifier that owes nothing to an API.
For a codebase with no framework, no build and no dependencies, the server-side
discipline is better than the panel will expect.

**What is theatre:** the ₹500 welcome gift, Mitra minting wallet credit labelled "via
UPI", the hash-generated "Filling fast", the fabricated partner testimonial, and — most
consequentially — **the VERIFIED badge, which is a hardcoded string on every shop, and
"every batch purity-tested", which has no data model behind it at all.**

**What is missing:** tests (zero), CI (none), error tracking (none), a CSP (none),
login rate limiting (none), session expiry (none), a refund/payout path (none), and the
funnel events that would let anyone answer why a customer left.

**The gap that matters most:** this is a real platform with ~1 real order. Almost every
finding above is cheap to fix now and expensive to fix after the first thousand users.
