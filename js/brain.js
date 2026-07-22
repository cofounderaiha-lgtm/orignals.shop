/* ============================================================
   MITRA BRAIN — Orignals' own trainable language model (v1)
   ------------------------------------------------------------
   A real, in-browser intent model. Zero API cost. It TRAINS
   itself continuously ("the flywheel"):
     · every utterance is logged as training data
     · the rule engine's matches become weak labels → SGD step
     · admin relabels (human-in-the-loop) → strong labels
     · optional Claude answers distill into it (config.js)
   Architecture: hashing-trick features (word uni/bi-grams +
   char trigrams, EN + Hinglish) → softmax regression, trained
   with online SGD. Weights persist locally + sync to Supabase.
   Dataset exports as JSONL — the exact file you will later use
   to fine-tune a full open-weights model (docs/MITRA-AI.md).
   ============================================================ */

const BRAIN = {
  D: 1024,                       // feature dims (hashing trick)
  LR: 0.15,
  seedVer: 2,                    // bump → clients retrain on new seed (2 = 22-language pack)
  intents: ['order_item', 'track_order', 'cancel_order', 'book_ride', 'send_parcel',
    'wallet', 'book_tickets', 'my_bookings', 'recommend', 'hotel_stay', 'property',
    'earn_partner', 'shop_register', 'greeting'],
  W: null, b: null, version: 0, trained: 0
};

/* ---------- language detection (22 Indian languages, by script) ---------- */
const MITRA_LANGS = {
  hi: 'हिन्दी', as: 'অসমীয়া', bn: 'বাংলা', gu: 'ગુજરાતી', pa: 'ਪੰਜਾਬੀ',
  ta: 'தமிழ்', te: 'తెలుగు', kn: 'ಕನ್ನಡ', ml: 'മലയാളം', or: 'ଓଡ଼ିଆ',
  ur: 'اردو', sat: 'ᱥᱟᱱᱛᱟᱲᱤ', en: 'English'
};
/* Devanagari is shared by Hindi/Marathi/Nepali/Konkani/Maithili/Bodo/Dogri/
   Sanskrit — we return 'hi' as the umbrella for responses. Bengali script
   covers Bengali/Assamese/Manipuri → 'bn'/'as'. */
function mitraDetectLang(text) {
  const s = String(text || '');
  if (/[஀-௿]/.test(s)) return 'ta';       // Tamil
  if (/[ఀ-౿]/.test(s)) return 'te';       // Telugu
  if (/[ಀ-೿]/.test(s)) return 'kn';       // Kannada
  if (/[ഀ-ൿ]/.test(s)) return 'ml';       // Malayalam
  if (/[઀-૿]/.test(s)) return 'gu';       // Gujarati
  if (/[਀-੿]/.test(s)) return 'pa';       // Gurmukhi (Punjabi)
  if (/[଀-୿]/.test(s)) return 'or';       // Odia
  if (/[᱐-᱿]/.test(s)) return 'sat';      // Ol Chiki (Santali)
  if (/[؀-ۿݐ-ݿ]/.test(s)) return 'ur';  // Perso-Arabic (Urdu/Sindhi/Kashmiri)
  if (/[ঀ-৿]/.test(s)) return /অসম|গাখীৰ|আইতা|ক্ত/.test(s) ? 'as' : 'bn';  // Bengali/Assamese
  if (/[ऀ-ॿ]/.test(s)) return 'hi';       // Devanagari umbrella
  return 'en';
}

/* ---------- seed corpus (EN + Hinglish) — the model's birth data ---------- */
const BRAIN_SEED = {
  order_item: ['order 2 milk', 'do kilo aloo dena', 'ek packet biscuit dena', 'bhaiya paneer dena', 'sabun aur tel de do', 'get me bread and eggs', 'doodh mangwa do', 'buy paneer from kirana',
    'i want biryani', 'order chicken biryani for 2', 'sabzi chahiye', 'get medicines paracetamol',
    'order a cake', 'atta aur chawal mangwa do', 'need shampoo and soap', 'khana order karo'],
  track_order: ['where is my order', 'khana kab tak aayega', 'kab tak pahunchega mera saman', 'kitni der aur lagegi', 'order abhi tak nahi aaya', 'order kahan hai', 'track my delivery', 'mera order aa gaya kya',
    'delivery status', 'kitna time lagega order me', 'order ka status batao', 'is my food coming'],
  cancel_order: ['cancel my order', 'cancel kar do wo order', 'biryani wala order cancel karo', 'wo wala order hata do', 'cancel that food order', 'order cancel karo', 'cancel the delivery', 'mujhe order cancel karna hai',
    'cancel my booking please', 'galti se order ho gaya cancel karo'],
  book_ride: ['book a bike to the station', 'cab chahiye airport', 'auto book karo', 'i need a taxi',
    'ride to office', 'bike se jana hai mall', 'ghar jana hai gaadi bhejo', 'book cab for 2 people'],
  send_parcel: ['send this tiffin to grandma', 'dawai pahuncha do dadi ke ghar', 'ye saman pahunchana hai', 'packet drop karwana hai', 'parcel bhejna hai', 'courier my documents',
    'send keys to office', 'tiffin bhej do dadi ko', 'deliver this package to sector 9',
    'send medicines to my mother'],
  wallet: ['wallet balance', 'kitna paisa hai', 'add 200 to wallet', 'paise add karo',
    'show my balance', 'wallet me paisa daalo', 'withdraw my money', 'recharge wallet 500'],
  book_tickets: ['book movie tickets', '2 tickets for the 6:30 show', 'movie dekhni hai',
    'film ke ticket book karo', 'show me whats playing', 'book tickets for tonight', 'imax tickets'],
  my_bookings: ['my bookings', 'show my tickets', 'mere tickets dikhao', 'meri booking kahan hai',
    'what did i book', 'my reservations'],
  recommend: ['what should i eat', 'bhook lagi hai', 'suggest something good', 'kuch accha khane ko',
    'recommend dinner', 'kya khau aaj', 'i am hungry suggest'],
  hotel_stay: ['book a hotel room', 'need a room for 2 nights', 'hotel chahiye', 'stay booking',
    'homestay near lake', 'room book karo kal ke liye'],
  property: ['2 bhk flat for rent', 'ghar chahiye rent pe', 'show me plots', 'property near sector 12',
    'buy a flat', 'makaan dekhna hai', 'office space commercial'],
  earn_partner: ['i want to earn', 'kamai karni hai', 'become delivery partner', 'partner banna hai',
    'job chahiye delivery ki', 'earn with my bike', 'deliver and earn'],
  shop_register: ['register my shop', 'apni shop app pe daalni hai', 'store online karna hai', 'main bechna chahta hu yahan', 'seller banna hai', 'meri dukaan online karo', 'sell on orignals', 'list my store',
    'dukan kholna hai app pe', 'how to sell here'],
  greeting: ['hello', 'hi mitra', 'namaste', 'hey there', 'help me', 'what can you do', 'madad karo']
};

/* ---------- rule mirror: same conditions as mitra.js → weak labels ---------- */
function ruleIntent(t) {
  const has = (...ws) => ws.some(w => t.includes(w));
  if (has('wallet', 'balance', 'paisa', 'paise', 'money', 'withdraw')) return 'wallet';
  if (has('cancel') && has('order', 'booking', 'khana', 'delivery', 'ticket')) return 'cancel_order';
  if (has('my ticket', 'mere ticket', 'my booking', 'meri booking', 'show ticket', 'ticket dikha')) return 'my_bookings';
  if (has('recommend', 'suggest', 'hungry', 'bhook', 'what should i eat', 'kya khau', 'khane ko')) return 'recommend';
  if (has('order aa', 'where is my order', 'track', 'kahan', 'kaha hai', 'status', 'my order', 'mera order')) return 'track_order';
  if (has('ride', 'bike', 'auto', 'cab', 'car ', 'taxi') && !has('order', 'buy ', 'send', 'bhej')) return 'book_ride';
  if (has('earn', 'kamai', 'kamana', ' job', 'partner ban', 'deliver and earn')) return 'earn_partner';
  if (has('my shop', 'register shop', 'dukaan', 'dukan', 'sell on', 'shop khol')) return 'shop_register';
  if (has('send', 'bhej', 'deliver', 'pickup', 'courier', 'parcel', 'tiffin')) return 'send_parcel';
  if (has('movie', 'ticket', 'cinema', 'show ', 'film')) return 'book_tickets';
  if (has('hotel', 'room', 'stay', 'lodge', 'check in')) return 'hotel_stay';
  if (has('property', 'flat', 'plot', ' bhk', 'villa', 'house for', 'rent a ', 'makaan', 'ghar chahiye')) return 'property';
  if (has('hello', 'hi ', 'hey', 'namaste', 'help', 'madad', 'what can')) return 'greeting';
  if (has('order', 'buy', 'get me', 'mangwa', 'chahiye', 'want', 'khareed')) return 'order_item';
  return null;
}

/* canonical re-dispatch phrases: brain routes fallbacks through the rules */
const BRAIN_CANON = {
  order_item: null,                       // keep original text (item search needs it)
  track_order: 'where is my order',
  cancel_order: 'cancel my order',
  book_ride: 'book a ride',
  send_parcel: 'send a parcel',
  wallet: 'wallet balance',
  book_tickets: 'movie tickets',
  my_bookings: 'my bookings',
  recommend: 'what should i eat',
  hotel_stay: 'book a hotel room',
  property: 'property flat',
  earn_partner: 'i want to earn',
  shop_register: 'register my shop',
  greeting: 'hello'
};

/* ---------- features: hashing trick ---------- */
function brainHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % BRAIN.D;
}
function brainFeatures(text) {
  /* keep letters & numbers of EVERY script (all 22 Indian languages +
     Latin), strip only punctuation/symbols. \p{L}\p{N} needs the u flag. */
  let t;
  try { t = String(text).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim(); }
  catch (e) { t = String(text).toLowerCase().replace(/[^a-z0-9ऀ-෿؀-ۿ ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  const f = new Map();
  const bump = k => { const i = brainHash(k); f.set(i, (f.get(i) || 0) + 1); };
  const words = t.split(' ').filter(Boolean);
  words.forEach(w => {
    bump('w:' + w);
    for (let i = 0; i < w.length - 2; i++) bump('c:' + w.slice(i, i + 3));
  });
  for (let i = 0; i < words.length - 1; i++) bump('b:' + words[i] + '_' + words[i + 1]);
  bump('_bias');
  return f;
}

/* ---------- softmax model ---------- */
function brainInit() {
  const C = BRAIN.intents.length;
  BRAIN.W = new Float32Array(BRAIN.D * C);
  BRAIN.b = new Float32Array(C);
  BRAIN.version = 1; BRAIN.trained = 0;
}
function brainScores(f) {
  const C = BRAIN.intents.length, s = new Float64Array(C);
  for (let c = 0; c < C; c++) {
    let z = BRAIN.b[c];
    for (const [i, v] of f) z += BRAIN.W[i * C + c] * v;
    s[c] = z;
  }
  const m = Math.max(...s); let sum = 0;
  for (let c = 0; c < C; c++) { s[c] = Math.exp(s[c] - m); sum += s[c]; }
  for (let c = 0; c < C; c++) s[c] /= sum;
  return s;
}
function brainPredict(text) {
  if (!BRAIN.W) brainLoad();
  const p = brainScores(brainFeatures(text));
  let best = 0, second = 0;
  for (let c = 1; c < p.length; c++) if (p[c] > p[best]) { second = best; best = c; } else if (p[c] > p[second]) second = c;
  return { intent: BRAIN.intents[best], conf: p[best], second: BRAIN.intents[second], p2: p[second] };
}
function brainTrainOne(text, intent, steps) {
  const y = BRAIN.intents.indexOf(intent);
  if (y < 0) return;
  const f = brainFeatures(text), C = BRAIN.intents.length;
  for (let s = 0; s < (steps || 2); s++) {
    const p = brainScores(f);
    for (let c = 0; c < C; c++) {
      const g = (c === y ? 1 : 0) - p[c];
      BRAIN.b[c] += BRAIN.LR * g;
      for (const [i, v] of f) BRAIN.W[i * C + c] += BRAIN.LR * g * v;
    }
  }
  BRAIN.trained++;
}
function brainSeedCorpus() {
  /* base EN/Hinglish + the 22-Indian-language pack (js/brain_ml.js) */
  const merged = {};
  for (const [k, v] of Object.entries(BRAIN_SEED)) merged[k] = v.slice();
  if (typeof BRAIN_SEED_ML !== 'undefined') {
    for (const [k, v] of Object.entries(BRAIN_SEED_ML)) merged[k] = (merged[k] || []).concat(v);
  }
  return merged;
}
function brainSeedTrain(epochs) {
  brainInit();
  const pairs = [];
  for (const [intent, exs] of Object.entries(brainSeedCorpus())) exs.forEach(x => pairs.push([x, intent]));
  for (let e = 0; e < (epochs || 12); e++) {
    for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
    pairs.forEach(([x, y]) => brainTrainOne(x, y, 1));
  }
  brainSave();
}

/* ---------- persistence ---------- */
function brainSave() {
  try {
    localStorage.setItem('mitra_model', JSON.stringify({
      v: BRAIN.version, trained: BRAIN.trained, D: BRAIN.D, intents: BRAIN.intents, seedVer: BRAIN.seedVer,
      W: Array.from(BRAIN.W, x => Math.round(x * 1000) / 1000), b: Array.from(BRAIN.b, x => Math.round(x * 1000) / 1000)
    }));
  } catch (e) { console.warn('[brain] save failed', e); }
  if (typeof cloudQueue === 'function') cloudQueue();
}
function brainLoad() {
  try {
    const m = JSON.parse(localStorage.getItem('mitra_model') || 'null');
    if (m && m.D === BRAIN.D && m.intents.length === BRAIN.intents.length && (m.seedVer || 1) === BRAIN.seedVer) {
      BRAIN.W = Float32Array.from(m.W); BRAIN.b = Float32Array.from(m.b);
      BRAIN.version = m.v; BRAIN.trained = m.trained || 0;
      return;
    }
    /* seed changed (e.g. new language pack) → retrain from the fresh corpus */
  } catch (e) { /* fall through to seed */ }
  brainSeedTrain();
}

/* ---------- the flywheel: utterance log = training dataset ---------- */
function brainLog() {
  try { return JSON.parse(localStorage.getItem('mitra_utterances') || '[]'); } catch (e) { return []; }
}
function brainLogSave(log) {
  localStorage.setItem('mitra_utterances', JSON.stringify(log.slice(-600)));
  if (typeof cloudQueue === 'function') cloudQueue();
}
function brainObserve(text, pred, label, src) {
  const log = brainLog();
  log.push({ ts: Date.now(), text: String(text).slice(0, 200), pred: pred.intent, conf: Math.round(pred.conf * 100) / 100, label: label || null, src: src || 'rules' });
  brainLogSave(log);
  if (label) { brainTrainOne(text, label, label === pred.intent ? 1 : 3); brainSave(); }
}
function brainRelabel(idx, intent) {
  const log = brainLog();
  if (!log[idx]) return;
  log[idx].label = intent; log[idx].src = 'human';
  brainLogSave(log);
  brainTrainOne(log[idx].text, intent, 4); brainSave();
}
function brainStats() {
  const log = brainLog();
  const labeled = log.filter(u => u.label);
  const correct = labeled.filter(u => u.pred === u.label).length;
  const perIntent = {};
  labeled.forEach(u => { perIntent[u.label] = (perIntent[u.label] || 0) + 1; });
  return {
    utterances: log.length, labeled: labeled.length,
    accuracy: labeled.length ? Math.round(correct / labeled.length * 100) : null,
    unknown: log.filter(u => !u.label).length,
    params: BRAIN.D * BRAIN.intents.length + BRAIN.intents.length,
    trained: BRAIN.trained, perIntent
  };
}
function brainRetrain() {
  brainSeedTrain(12);
  brainLog().filter(u => u.label).forEach(u => brainTrainOne(u.text, u.label, 2));
  brainSave();
}
function brainExportJSONL() {
  const rows = [];
  for (const [intent, exs] of Object.entries(brainSeedCorpus())) exs.forEach(x => rows.push({ text: x, intent, src: 'seed' }));
  brainLog().filter(u => u.label).forEach(u => rows.push({ text: u.text, intent: u.label, src: u.src }));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(r => JSON.stringify(r)).join('\n')], { type: 'application/jsonl' }));
  a.download = 'mitra-training-data.jsonl'; a.click();
  toast(rows.length + ' training examples exported (JSONL)');
}

/* ============================================================
   OPTIONAL: Claude escalation for hard queries (config-gated).
   Off by default = zero cost. When configured, unknown queries
   go to Claude, and every answer is logged as training data —
   distilling Claude's understanding into YOUR model over time.
   ============================================================ */
async function brainAskClaude(raw) {
  const cfg = (window.ORIGNALS_CONFIG || {}).llm || {};
  /* ⚠ DISABLED 2026-07-17 — SECURITY.
     This used to call api.anthropic.com FROM THE BROWSER with
     'x-api-key': cfg.apiKey and 'anthropic-dangerous-direct-browser-access'.
     config.js is a public static asset served to every visitor, so the moment
     anyone pasted a real key there (which config.js literally instructed them
     to do) the key was published to the world — readable with one curl, cached
     by the CDN and the service worker, and committed to git history. There is
     no rotation-free recovery from that.
     No key was ever committed, so nothing is burned — this closes the path
     before it can be armed.
     To enable escalation properly: create a Supabase edge function holding
     ANTHROPIC_API_KEY in Deno.env (mirror supabase/functions/razorpay-verify/),
     cap max_tokens + input length + rate, and call THAT from here. Until such a
     function exists, Mitra runs on the on-device brain + rules, which is the
     default and costs nothing. */
  if (!cfg.proxyUrl) return null;
  try {
    const res = await fetch(cfg.proxyUrl, {
      method: 'POST',
      headers: {
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: cfg.model || 'claude-haiku-4-5',
        max_tokens: 400,
        system: 'You are Mitra, the assistant inside Orignals — an Indian everything-app (nearby shops, food, parcels, rides, movie tickets, hotels, property, earn-by-delivering). Reply in the user\'s language (English/Hinglish), warm and brief (max 3 sentences). Classify the request into exactly one intent.',
        output_config: {
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                intent: { type: 'string', enum: BRAIN.intents },
                reply: { type: 'string' }
              },
              required: ['intent', 'reply'],
              additionalProperties: false
            }
          }
        },
        messages: [{ role: 'user', content: raw }]
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.stop_reason === 'refusal') return null;
    const txt = (data.content || []).find(b => b.type === 'text');
    const out = JSON.parse(txt.text);
    brainObserve(raw, brainPredict(raw), out.intent, 'claude');   // distillation
    return out;
  } catch (e) {
    console.warn('[brain] Claude escalation failed:', e.message);
    return null;
  }
}


/* ---------- backend model adoption: every device downloads the
   global brain (trained in Supabase by pg_cron on ALL users' data) ---------- */
async function brainAdoptGlobal() {
  try {
    if (typeof cloudFetch !== 'function' || !CLOUD.on) return;
    const rows = await cloudFetch('mitra_global_model?id=eq.1&select=version,w,b,examples,trained');
    if (!rows || !rows.length || !rows[0].w) return;
    const g = rows[0];
    const seen = parseInt(localStorage.getItem('mitra_global_ver') || '0', 10);
    if (g.version <= seen) return;
    if (g.w.length !== BRAIN.D * BRAIN.intents.length) return;
    if (!BRAIN.W) brainLoad();
    BRAIN.W = Float32Array.from(g.w);
    BRAIN.b = Float32Array.from(g.b);
    BRAIN.version = 100 + g.version;
    localStorage.setItem('mitra_global_ver', String(g.version));
    brainSave();
    console.log('[brain] adopted global model v' + g.version + ' (' + g.examples + ' examples, ' + g.trained + ' steps)');
    /* silent — model updates are internal, never shown to end users */
  } catch (e) { console.warn('[brain] global adopt skipped:', e.message); }
}
