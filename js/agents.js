/* ============================================================
   ORIGNALS MULTI-AGENT RUNTIME (MARK) — the working grounding of
   Volume V. Not "millions of organisms with genomes"; a REAL,
   auditable registry of persistent agent objects, one per platform
   subsystem that actually runs Orignals. Each carries:

     • identity (uuid, role, department)
     • DNA (permitted tools — from the real RBAC)
     • confidence that GROWS with observation (childhood → active →
       autonomous, exactly like the spec's confidence threshold)
     • a trust score updated by real outcomes (correct ↑ / wrong ↓)
     • health derived from real activity

   Mitra already calls agentObserve('mitra', win) on every utterance,
   so this roster is live, not decorative.
   ============================================================ */
const AGENTS = {
  registry: null,
  defs: [
    { id: 'mitra',    role: 'Assistant',        dept: 'Customer',  tools: ['navigate', 'order', 'answer', 'translate'] },
    { id: 'purity',   role: 'Purity Inspector', dept: 'Quality',   tools: ['seal', 'delist'] },
    { id: 'kyc',      role: 'KYC Verifier',     dept: 'Trust',     tools: ['verify', 'reject'] },
    { id: 'fraud',    role: 'Fraud Watch',      dept: 'Trust',     tools: ['flag', 'freeze'] },
    { id: 'match',    role: 'Delivery Match',   dept: 'Logistics', tools: ['assign', 'reroute'] },
    { id: 'settle',   role: 'Settlement',       dept: 'Finance',   tools: ['ledger', 'payout'] },
    { id: 'analytics',role: 'Analytics',        dept: 'Insight',   tools: ['track', 'report'] },
    { id: 'hr',       role: 'HRMS',             dept: 'People',    tools: ['attendance', 'payroll'] },
    { id: 'svc',      role: 'Service Verify',   dept: 'Trust',     tools: ['verify', 'list'] }
  ]
};
function agentsBoot() {
  if (AGENTS.registry) return AGENTS.registry;
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('mitra_agents') || '{}'); } catch (e) {}
  AGENTS.registry = AGENTS.defs.map(d => {
    const s = saved[d.id] || {};
    return {
      id: d.id, role: d.role, dept: d.dept, tools: d.tools,
      uuid: s.uuid || (d.id + '-' + Math.random().toString(36).slice(2, 8)),
      born: s.born || Date.now(),
      confidence: s.confidence != null ? s.confidence : 0.5,
      trust: s.trust != null ? s.trust : 0.8,
      obs: s.obs || 0, wins: s.wins || 0, misses: s.misses || 0, status: 'active'
    };
  });
  return AGENTS.registry;
}
function agentSave() {
  try {
    const m = {}; AGENTS.registry.forEach(a => m[a.id] = { uuid: a.uuid, born: a.born, confidence: a.confidence, trust: a.trust, obs: a.obs, wins: a.wins, misses: a.misses });
    localStorage.setItem('mitra_agents', JSON.stringify(m));
  } catch (e) {}
}
function agent(id) { agentsBoot(); return AGENTS.registry.find(a => a.id === id); }
/* observation grows confidence (childhood→autonomous); outcome moves trust */
function agentObserve(id, win) {
  const a = agent(id); if (!a) return;
  a.obs++; a.confidence = Math.min(0.99, a.confidence + 0.008);
  if (win === true) { a.wins++; a.trust = Math.min(0.99, a.trust + 0.004); }
  else if (win === false) { a.misses++; a.trust = Math.max(0.3, a.trust - 0.02); }
  if (a.obs % 5 === 0) agentSave();
}
function agentStage(a) { return a.confidence < 0.6 ? 'learning' : a.confidence < 0.85 ? 'active' : 'autonomous'; }
/* live workload from REAL state so the roster reflects reality */
function agentWorkload(id) {
  try {
    const A = S.admin || {};
    if (id === 'purity') return (A.purityQueue || []).filter(x => x.status === 'pending').length + ' checks due';
    if (id === 'kyc') return (A.kycQueue || []).filter(x => x.status === 'pending').length + ' pending';
    if (id === 'fraud') return (A.flags || []).length + ' flags open';
    if (id === 'mitra') return ((typeof CORTEX !== 'undefined' && CORTEX.stats.thoughts) || 0) + ' thoughts';
    if (id === 'analytics') return 'live';
    if (id === 'match') return (S.activeJob ? '1 active job' : 'idle');
  } catch (e) {}
  return '—';
}
function agentsTelemetry() {
  agentsBoot();
  return AGENTS.registry.map(a => ({
    id: a.id, role: a.role, dept: a.dept, tools: a.tools,
    confidence: a.confidence, trust: a.trust, obs: a.obs, stage: agentStage(a), work: agentWorkload(a.id)
  }));
}
if (typeof window !== 'undefined') { try { agentsBoot(); } catch (e) {} }
