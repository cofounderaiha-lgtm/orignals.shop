/* ============================================================
   ORIGNALS COGNITIVE REASONING + PLANNING (Mitra) — the working
   grounding of Volumes III & IV.

   CRE — every action Mitra takes produces an explainable DECISION
   RECORD: goal → constraints checked → evidence → confidence → why.
   CPE — a goal decomposes into a task DAG that runs with dependencies
   and monitoring (the relay logistics is a live example of this).

   Real, auditable, and demoable ("why did you recommend this?").
   ============================================================ */
const REASON = { records: [] };

/* CRE: record an explainable decision */
function reasonDecide(goal, constraints, evidence, confidence) {
  const ok = constraints.every(c => c.ok);
  const rec = { id: Math.random().toString(36).slice(2, 8), ts: Date.now(), goal, constraints, evidence, confidence: Math.round((confidence || 0) * 100) / 100, ok };
  REASON.records.unshift(rec);
  if (REASON.records.length > 80) REASON.records.length = 80;
  return rec;
}
function reasonExplainHTML(rec) {
  return `<div class="foot-note sm" style="text-align:left">
    <b>Why:</b> ${esc(rec.goal)}.<br/>
    ${rec.evidence.map(e => '· ' + esc(e)).join('<br/>')}<br/>
    <b>Checks:</b> ${rec.constraints.map(c => (c.ok ? '✓' : '✗') + ' ' + esc(c.name)).join(' · ')}<br/>
    <b>Confidence:</b> ${Math.round(rec.confidence * 100)}%</div>`;
}

/* CRE applied to an order: goal + constraints + evidence + confidence */
function reasonOrder(shop, item, q, total) {
  const wallet = (S.wallet ? S.wallet.bal : 0);
  const constraints = [
    { name: 'within wallet', ok: wallet >= total },
    { name: 'shop verified', ok: !!(shop && (shop.verified !== false)) },
    { name: 'item available', ok: !!(item && item.open !== false) }
  ];
  const evidence = [
    `${item.name} found at ${shop.name} (${shop.km} km, ★ ${shop.rating})`,
    `price ${money(item.price)} × ${q} = ${money(total)}`,
    (shop.type === 'food' && shop.fresh !== false) ? 'freshness-pledged kitchen' : 'purity-verified seller'
  ];
  const conf = constraints.filter(c => c.ok).length / constraints.length;
  return reasonDecide('order ' + q + ' × ' + item.name, constraints, evidence, conf);
}

/* CPE: decompose a goal into a task DAG (id, label, deps) */
function planDecompose(kind) {
  const P = {
    order: [
      ['find', 'Find the item at a verified shop', []],
      ['check', 'Check price & your wallet', ['find']],
      ['reason', 'Decide (constraints + confidence)', ['check']],
      ['pay', 'Place order & pay', ['reason']],
      ['match', 'Match a delivery partner', ['pay']],
      ['track', 'Live-track to your door', ['match']]
    ],
    relay: [
      ['pickup', 'First-mile pickup (bike)', []],
      ['haul', 'Line-haul (road / rail / air)', ['pickup']],
      ['last', 'Last-mile delivery (bike)', ['haul']]
    ],
    ride: [
      ['route', 'Compute the road route', []],
      ['fare', 'Fare + taxes', ['route']],
      ['match', 'Match a verified captain', ['fare']],
      ['track', 'Live-track the ride', ['match']]
    ]
  };
  return (P[kind] || []).map(t => ({ id: t[0], label: t[1], deps: t[2], status: 'pending' }));
}

/* CPE: run a task DAG respecting dependencies (async stepFn per task) */
async function planRun(tasks, stepFn) {
  const done = {};
  const ready = () => tasks.filter(t => t.status === 'pending' && t.deps.every(d => done[d]));
  let guard = 0;
  while (tasks.some(t => t.status === 'pending') && guard++ < 100) {
    const batch = ready(); if (!batch.length) break;
    await Promise.all(batch.map(async t => {
      t.status = 'running';
      try { await (stepFn ? stepFn(t) : Promise.resolve()); t.status = 'done'; done[t.id] = true; }
      catch (e) { t.status = 'failed'; }
    }));
  }
  return tasks;
}
function reasonTelemetry() {
  const r = REASON.records;
  return { decisions: r.length, passRate: r.length ? Math.round(r.filter(x => x.ok).length / r.length * 100) : 0, recent: r.slice(0, 6) };
}
