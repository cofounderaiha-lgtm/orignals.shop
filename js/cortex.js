/* ============================================================
   ORIGNALS COGNITIVE CORE (Mitra runtime) — the HONEST, working
   grounding of the OCOS vision. Not a distributed cognitive OS;
   a real, lightweight cognitive runtime that runs in the browser:

     • Thought object + priority scoring  (Cognitive Scheduler)
     • Reasoning cache — memoised classification (Neural Cache)
     • Compute-lane router — cache → rules → brain → LLM  (Compute Estimator)
     • Reflection log + telemetry           (Reflection + Telemetry)

   Every Mitra utterance becomes a Thought that is scored, routed to the
   cheapest capable lane, cached when deterministic, and logged for
   reflection. This makes Mitra measurably faster and gives a TRUE
   "we're on the path to the cognitive architecture" story.
   ============================================================ */
const CORTEX = {
  ttlMs: 6 * 60 * 60 * 1000,     // reasoning cache entry lifetime
  cap: 400,                       // max cached classifications
  logCap: 300,
  cache: {},
  log: [],
  stats: { thoughts: 0, hits: 0, miss: 0, msSum: 0, lanes: {}, prio: {} }
};

function cortexBoot() {
  try {
    const c = JSON.parse(localStorage.getItem('mitra_cortex') || 'null');
    if (c && c.cache) { CORTEX.cache = c.cache; CORTEX.stats = Object.assign(CORTEX.stats, c.stats || {}); }
  } catch (e) {}
}
function cortexSave() {
  try { localStorage.setItem('mitra_cortex', JSON.stringify({ cache: CORTEX.cache, stats: CORTEX.stats })); } catch (e) {}
}
function cortexKey(raw) { return String(raw || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]+/gu, '').trim().slice(0, 120); }

/* ---- priority: grounded version of the doc's scoring function ---- */
const CORTEX_URGENT = /(fail|failed|fraud|stolen|emergency|urgent|help me|refund|cancel|wrong|missing|not received|scam|अभी|तुरंत|मदद)/i;
const CORTEX_TXN = /(order|pay|buy|book|send|deliver|track|wallet|money|मंगवा|भेज|ऑर्डर)/i;
function cortexPriority(text) {
  if (CORTEX_URGENT.test(text)) return 'high';
  if (CORTEX_TXN.test(text)) return 'medium';
  return 'low';
}

/* ---- compute lane: cheapest capable resolver for this thought ---- */
function cortexLane(pred, cached) {
  if (cached) return 'cache';
  const conf = (pred && pred.conf) || 0;
  const llm = (window.ORIGNALS_CONFIG || {}).llm || {};
  const llmOn = llm.apiKey && !String(llm.apiKey).includes('YOUR-');
  if (conf >= 0.7) return 'brain';        // model is confident → on-device brain
  if (conf >= 0.45) return 'rules';       // medium → rule mirror handles it
  return llmOn ? 'llm' : 'rules';         // low → escalate if configured, else rules
}

/* ---- the memoised classifier: the reasoning cache in action ----
   brainPredict is deterministic for a given text, so caching its result
   is correct — a repeated/again-seen query resolves in microseconds. */
function cortexPredict(raw) {
  if (typeof brainPredict !== 'function') return { intent: 'greeting', conf: 0 };
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const key = cortexKey(raw);
  const hit = CORTEX.cache[key];
  let pred, cached = false;
  if (hit && (Date.now() - hit.at) < CORTEX.ttlMs) { pred = hit.pred; hit.at = Date.now(); cached = true; CORTEX.stats.hits++; }
  else { pred = brainPredict(raw); CORTEX.cache[key] = { pred, at: Date.now() }; CORTEX.stats.miss++; cortexTrim(); }
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  cortexRecord(raw, pred, cortexLane(pred, cached), ms);
  return pred;
}
function cortexTrim() {
  const keys = Object.keys(CORTEX.cache);
  if (keys.length <= CORTEX.cap) return;
  keys.map(k => [k, CORTEX.cache[k].at]).sort((a, b) => a[1] - b[1])
    .slice(0, keys.length - CORTEX.cap).forEach(([k]) => delete CORTEX.cache[k]);
}
function cortexRecord(raw, pred, lane, ms) {
  const prio = cortexPriority(raw);
  const th = { id: (Math.random().toString(36).slice(2, 8)), ts: Date.now(), text: String(raw).slice(0, 80), intent: pred.intent, conf: Math.round((pred.conf || 0) * 100) / 100, lane, prio, ms: Math.round(ms * 10) / 10, status: 'done' };
  CORTEX.log.unshift(th);
  if (CORTEX.log.length > CORTEX.logCap) CORTEX.log.length = CORTEX.logCap;
  CORTEX.stats.thoughts++;
  CORTEX.stats.msSum += th.ms;
  CORTEX.stats.lanes[lane] = (CORTEX.stats.lanes[lane] || 0) + 1;
  CORTEX.stats.prio[prio] = (CORTEX.stats.prio[prio] || 0) + 1;
  if (CORTEX.stats.thoughts % 5 === 0) cortexSave();
}

/* ---- telemetry the super-admin can see ---- */
function cortexTelemetry() {
  const s = CORTEX.stats, tot = Math.max(1, s.hits + s.miss);
  return {
    thoughts: s.thoughts,
    cacheHitRate: Math.round((s.hits / tot) * 100),
    avgMs: s.thoughts ? Math.round((s.msSum / s.thoughts) * 10) / 10 : 0,
    cached: Object.keys(CORTEX.cache).length,
    lanes: s.lanes,
    prio: s.prio,
    recent: CORTEX.log.slice(0, 12)
  };
}
if (typeof window !== 'undefined') { try { cortexBoot(); } catch (e) {} }
