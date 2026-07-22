/* ============================================================
   ORIGNALS COGNITIVE MEMORY MANAGER (Mitra) — the working grounding
   of Volume II. A layered memory over the user's REAL state, not a
   single vector DB:

     L0 Registers  — hot context read constantly (name, addr, wallet, cart)
     L1 Working    — the current reasoning session's scratch facts
     L2 Episodic   — past orders as episodes (who / what / when / outcome)
     L3 Semantic   — episodes COMPRESSED into patterns ("buys milk weekly")
     Retrieval     — assemble only the relevant context for a goal
     Consolidation — recompute patterns from episodes (idle-time maintenance)

   This makes Mitra personal: "order my usual" retrieves the compressed
   basket. Persistent intelligence lives in this substrate, the model is
   just one consumer of it.
   ============================================================ */
const MEM = { semantic: null, at: 0, working: null };

/* ---- L0: cognitive registers (hot context) ---- */
function memRegisters() {
  return {
    name: (typeof displayName === 'function') ? displayName() : 'Guest',
    addr: (S.user && S.user.addr) ? S.user.addr.name : '',
    earned: (typeof earnedTotal === 'function' ? earnedTotal() : 0),
    cartItems: (S.cart && S.cart.items) ? Object.keys(S.cart.items).length : 0,
    orders: (S.orders || []).length,
    lastIntent: window._mitraLastIntent || null
  };
}

/* ---- L1: working memory for one reasoning session ---- */
function memOpenSession(goal) { MEM.working = { goal, at: Date.now(), facts: {} }; return MEM.working; }
function memNote(k, v) { if (MEM.working) MEM.working.facts[k] = v; }
function memCloseSession() { const w = MEM.working; MEM.working = null; return w; }

/* ---- L2: episodic memory — real past orders become episodes ---- */
function memEpisodes(limit) {
  return (S.orders || []).slice(0, limit || 60).map(o => ({
    id: o.id, when: o.ts || o.placed_at || 0,
    what: (o.items || []).map(i => i.name),
    shop: o.shopId || o.title, total: o.total || 0, kind: o.kind,
    outcome: o.cancelled ? 'cancelled' : (o.rated ? 'rated ' + o.rated : 'delivered')
  }));
}

/* ---- L3: semantic memory — COMPRESS episodes into durable patterns ---- */
function memConsolidate() {
  const freq = {}, shops = {}; let spend = 0, n = 0;
  (S.orders || []).forEach(o => {
    if (o.cancelled) return; n++; spend += o.total || 0;
    (o.items || []).forEach(it => { const k = (it.name || '').toLowerCase().trim(); if (k && !/ride|leg |relay|platform fee|gst/.test(k)) freq[k] = (freq[k] || 0) + (it.q || 1); });
    if (o.shopId) shops[o.shopId] = (shops[o.shopId] || 0) + 1;
  });
  const usual = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  const favShop = Object.entries(shops).sort((a, b) => b[1] - a[1])[0];
  MEM.semantic = { usual, favShop: favShop ? favShop[0] : null, avgSpend: n ? Math.round(spend / n) : 0, orders: n };
  MEM.at = Date.now();
  return MEM.semantic;
}
function memSemantic() { if (!MEM.semantic || (Date.now() - MEM.at) > 60000) memConsolidate(); return MEM.semantic; }
function memUsual() { const s = memSemantic(); return (s && s.usual) || []; }

/* ---- retrieval: assemble ONLY the relevant context for a goal ---- */
function memRetrieve() {
  return { registers: memRegisters(), semantic: memSemantic(), recent: memEpisodes(3) };
}

/* ---- pattern discovery: turn episodes into insights (Vol VII) ---- */
function memInsights() {
  const orders = (S.orders || []).filter(o => !o.cancelled);
  const s = memSemantic();
  const out = [];
  if (s.usual && s.usual.length) out.push(`You most often order <b>${esc(s.usual[0].name)}</b> (${s.usual[0].count}×).`);
  const dow = [0, 0, 0, 0, 0, 0, 0];
  orders.forEach(o => { const d = new Date(o.ts || o.placed_at || Date.now()).getDay(); dow[d]++; });
  const maxD = dow.indexOf(Math.max.apply(null, dow));
  if (orders.length >= 3 && dow[maxD] >= 2) { const nm = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']; out.push(`You order most on <b>${nm[maxD]}s</b>.`); }
  if (s.avgSpend) out.push(`Your typical order is about <b>${money(s.avgSpend)}</b>.`);
  out.push(`<b>${s.orders}</b> order${s.orders === 1 ? '' : 's'} remembered — the more you use Orignals, the smarter I get. 🧠`);
  return out;
}

/* ---- telemetry for the super-admin cognitive panel ---- */
function memTelemetry() {
  const s = memSemantic();
  return { orders: s.orders, usualCount: (s.usual || []).length, avgSpend: s.avgSpend, favShop: s.favShop, top: (s.usual || []).slice(0, 5) };
}
