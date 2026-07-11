/* ============================================================
   MITRA — talk to the platform like a friend.
   "order 2 milk" · "send tiffin to grandma" · "book a bike"
   Understands simple English + Hinglish. Voice in, voice out.
   Fully offline intent engine — no external service.
   ============================================================ */

let MSGS = [];            // session transcript
let MITRA_ACTIONS = [];   // action registry for reply buttons

/* Hinglish → item/intent dictionary */
const HINDI = {
  doodh: 'milk', dudh: 'milk', anda: 'egg', ande: 'egg', chawal: 'rice', atta: 'atta',
  sabzi: 'vegetable', tamatar: 'tomato', pyaz: 'onion', dawai: 'medicine', dava: 'medicine',
  phool: 'flower', phul: 'flower', mithai: 'pastry', roti: 'bread', double_roti: 'bread',
  makhan: 'butter', ghee: 'ghee', shahad: 'honey', namak: 'salt', tel: 'oil', chini: 'jaggery',
  kela: 'banana', seb: 'apple', paneer: 'paneer', chai: 'coffee', kapde: 'kurta', joota: 'chappal'
};
const NUM_WORDS = { one: 1, ek: 1, two: 2, do: 2, three: 3, teen: 3, four: 4, char: 4, five: 5, paanch: 5, six: 6, dozen: 12 };

view('mitra', () => {
  $('#view').innerHTML = `
  <div class="mitra-shell">
    <div class="mitra-head">
      <button class="back" onclick="go('home')">${ic('chevl', 16)}</button>
      <span class="mitra-orb big">${ic('spark', 20)}</span>
      <div><h1>Mitra</h1><small>The platform's own intelligence · speaks your language</small></div>
      <button class="lnk" id="voiceTgl" onclick="S.voiceOut=!S.voiceOut;save();$('#voiceTgl').textContent=S.voiceOut?'Voice on':'Voice off'">${S.voiceOut ? 'Voice on' : 'Voice off'}</button>
    </div>
    <div class="mitra-msgs" id="mMsgs"></div>
    <div class="mitra-chips" id="mChips"></div>
    <div class="mitra-inrow">
      <button class="mic" id="micBtn" onclick="micStart()" title="Speak">${ic('mic', 18)}</button>
      <input id="mIn" placeholder="Type or speak — 'order 2 milk'…" onkeydown="if(event.key==='Enter')mitraSend()"/>
      <button class="msend" onclick="mitraSend()">${ic('sendp', 16)}</button>
    </div>
  </div>`;
  if (!MSGS.length) {
    mitraReply(`Namaste ${esc(isGuest() ? 'there' : displayName())}! I'm <b>Mitra</b> — this platform's own intelligence, in 22 Indian languages. Tell me what you need, or ask me <b>where anything is</b> and I'll take you there.<br/><br/>
      Try: <i>"order milk and bread"</i> · <i>"where is my wallet?"</i> · <i>"how do I register my shop?"</i> · <i>"take me to admin"</i> · <i>"doodh mangwa do"</i>`,
      ['Order milk and bread', 'Where is my wallet?', 'How do I register my shop?', 'Book a ride', 'Get a document made']);
  } else renderMsgs();
});

/* ---------- chat plumbing ---------- */
function renderMsgs() {
  const box = $('#mMsgs'); if (!box) return;
  box.innerHTML = MSGS.map(m => `<div class="msg ${m.who}">${m.html}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}
function setChips(chips) {
  const c = $('#mChips'); if (!c) return;
  c.innerHTML = (chips || []).map(t => `<button class="chip" onclick="$('#mIn').value='${esc(t.replace(/[^\w\s₹]/g, '').trim())}';mitraSend()">${esc(t)}</button>`).join('');
}
function mitraReply(html, chips, spoken) {
  MSGS.push({ who: 'm', html });
  renderMsgs(); setChips(chips);
  if (S.voiceOut && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(spoken || html.replace(/<[^>]+>/g, ' ').slice(0, 180));
    u.lang = 'en-IN'; speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
}
function mitraSend() {
  const inp = $('#mIn'); const text = inp.value.trim(); if (!text) return;
  inp.value = '';
  MSGS.push({ who: 'u', html: esc(text) });
  renderMsgs(); setChips([]);
  MSGS.push({ who: 'm typing', html: '<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>' });
  renderMsgs();
  setTimeout(() => { MSGS.pop(); mitraThink(text); }, 650 + Math.random() * 500);
}
function regAction(fn) { MITRA_ACTIONS.push(fn); return MITRA_ACTIONS.length - 1; }
function runMitraAction(i) { const fn = MITRA_ACTIONS[i]; if (fn) fn(); }

/* ---------- voice input ---------- */
let _rec = null;
function micStart() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice needs Chrome/Edge — please type instead', '🎙️'); return; }
  if (_rec) { try { _rec.stop(); } catch (e) {} }
  _rec = new SR(); _rec.lang = 'en-IN'; _rec.interimResults = false;
  _rec.onresult = e => { $('#mIn').value = e.results[0][0].transcript; mitraSend(); };
  _rec.onend = () => $('#micBtn') && $('#micBtn').classList.remove('listening');
  _rec.onerror = () => toast('Could not hear you — try again or type', '🎙️');
  _rec.start(); $('#micBtn').classList.add('listening');
  toast('Listening… speak now', '🎙️');
}

/* ---------- the intent engine ---------- */
function norm(text) {
  let t = ' ' + text.toLowerCase().replace(/[^\w\s₹]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  for (const [h, en] of Object.entries(HINDI)) t = t.replace(new RegExp('\\b' + h + '\\b', 'g'), en);
  return t;
}
function extractQty(t) {
  const m = t.match(/\b(\d{1,2})\b/); if (m) return Math.min(parseInt(m[1], 10), 20);
  for (const [w, n] of Object.entries(NUM_WORDS)) if (t.includes(' ' + w + ' ')) return n;
  return 1;
}
function matchPlace(t) {
  const map = { grandma: 'p5', granny: 'p5', dadi: 'p5', nani: 'p5', airport: 'p2', station: 'p3', railway: 'p3', mall: 'p1', park: 'p4', lake: 'p4', office: 'work', work: 'work', home: 'home', ghar: 'home', college: 'p6', campus: 'p6', university: 'p6' };
  for (const [w, id] of Object.entries(map)) if (t.includes(w)) return DB.places.find(p => p.id === id);
  return null;
}
function searchItems(t) {
  const words = t.split(' ').filter(w => w.length > 2 && !['the','and','for','from','order','buy','get','want','need','some','please','mangwa','chahiye','karo','kar'].includes(w));
  const hits = [];
  DB.shops.forEach(s => s.items.forEach(i => {
    const name = i.name.toLowerCase();
    let score = 0;
    words.forEach(w => { if (name.includes(w)) score += w.length; });
    if (score) hits.push({ shop: s, item: i, score: score - s.km * 0.5 });
  }));
  return hits.sort((a, b) => b.score - a.score);
}

/* ============================================================
   MITRA UNIVERSAL NAVIGATOR — every section, explained + reachable.
   "If they can't locate any section they can just ask Mitra."
   Keywords include EN + Hindi/Hinglish; the brain generalises the rest.
   ============================================================ */
const MITRA_HELP = [
  { route: 'shops', title: 'Shops nearby', help: 'Browse every shop near you and order — or just tell me what to buy and I\'ll order it.', tips: ['Order 2 milk', 'Find a pharmacy'],
    kw: ['shop', 'shops', 'store', 'kirana', 'grocery', 'nearby', 'dukaan', 'दुकान', 'shops kaha', 'shop kaha'] },
  { route: 'send', title: 'Send Anything', help: 'Send a parcel, tiffin or documents — a verified partner passing by carries it.', tips: ['Send a tiffin', 'Courier documents'],
    kw: ['send', 'parcel', 'courier', 'tiffin', 'bhej', 'भेज', 'deliver something'] },
  { route: 'ride', title: 'Rides', help: 'Book a bike, auto or car — fixed fare, no surge, live map with directions.', tips: ['Book a bike', 'Auto to the station'],
    kw: ['ride', 'rides', 'bike', 'auto', 'cab', 'taxi', 'gaadi', 'गाड़ी'] },
  { route: 'tickets', title: 'Events', help: 'Find events near you — society melas to national summits — book a seat, hire a planner, or book a venue.', tips: ['Events this weekend', 'Book an event planner'],
    kw: ['event', 'events', 'ticket', 'concert', 'show', 'planner', 'venue', 'wedding', 'expo', 'इवेंट', 'कार्यक्रम'] },
  { route: 'services', title: 'Services', help: 'Hire verified professionals — tuition, plumbing, electrical, healthcare, design, accounting and more, across all sectors. Or offer your own service and get expertise-verified.', tips: ['Find a tutor', 'Offer my service'],
    kw: ['service', 'services', 'tutor', 'tuition', 'plumber', 'electrician', 'carpenter', 'freelance', 'professional', 'consultant', 'repair', 'नौकर', 'सेवा'] },
  { route: 'tickets/dining', title: 'Dining', help: 'Reserve a table at restaurants near you — 20% off the bill.', tips: ['Reserve a table'],
    kw: ['dining', 'restaurant', 'table', 'reserve', 'reservation'] },
  { route: 'estate', title: 'Property & Stays', help: 'Buy, rent or list property, and book verified stays — with real maps & documents.', tips: ['2 BHK for rent', 'Book a hotel'],
    kw: ['property', 'flat', 'rent', 'plot', 'hotel', 'stay', 'room', 'makaan', 'मकान', 'real estate', 'house'] },
  { route: 'earn', title: 'Earn', help: 'Earn on your route — deliver, ride, sell products, or offer a service.', tips: ['I want to earn', 'Become a partner'],
    kw: ['earn', 'deliver and earn', 'partner', 'job', 'kamai', 'कमाई', 'work'] },
  { route: 'myshop', title: 'Your Shop', help: 'Put your shop online free — import your whole menu, add photos, choose delivery.', tips: ['Register my shop'],
    kw: ['my shop', 'register shop', 'sell', 'list my', 'dukaan online', 'become a seller', 'add my menu'] },
  { route: 'papers', title: 'Papers & Verification', help: 'Get ANY document made — GST, FSSAI, birth, death, marriage, PAN, passport, licences, property papers.', tips: ['Get a GST number', 'Death certificate'],
    kw: ['document', 'documents', 'certificate', 'gst', 'fssai', 'licence', 'license', 'birth', 'death', 'marriage', 'passport', 'pan card', 'driving licence', 'papers', 'dastavez'] },
  { route: 'wallet', title: 'Wallet', help: 'Your one wallet for everything — add money, see history, withdraw.', tips: ['Add 500 to wallet', 'Wallet balance'],
    kw: ['wallet', 'balance', 'add money', 'top up', 'topup', 'paisa', 'पैसा'] },
  { route: 'orders', title: 'Orders', help: 'Track and manage every order, ride and booking in one place.', tips: ['Track my order'],
    kw: ['orders', 'my order', 'my orders', 'track', 'order status'] },
  { route: 'account', title: 'Profile & Account', help: 'Your profile, currency, language, roles and security settings.', tips: ['Change currency', 'Sign in'],
    kw: ['profile', 'account', 'settings', 'my account', 'currency', 'language', 'setting'] },
  { route: 'facelock', title: 'Security & Face lock', help: 'Sign in, set a face lock (2FA), and turn on delivery alerts.', tips: ['Enable face lock'],
    kw: ['security', 'face lock', 'face', '2fa', 'password', 'alerts', 'notifications'] },
  { route: 'login', title: 'Sign in / Register', help: 'Create your account or sign in — secures your wallet, orders and shop.', tips: [],
    kw: ['sign in', 'signin', 'log in', 'login', 'register', 'create account', 'sign up'] },
  { route: 'legal', title: 'Legal & policies', help: 'Privacy, terms, refunds, and our grievance officer.', tips: [],
    kw: ['privacy', 'terms', 'refund', 'grievance', 'policy', 'legal', 'complaint'] },
  { route: 'papers', title: 'List a service', help: 'Any professional — tutor, salon, repair, consultant, team or firm — can offer a service after verifying expertise. Open Earn → Services.', tips: [],
    kw: ['tuition', 'tutor', 'service', 'services', 'freelance', 'consultant', 'skill', 'professional'] },
  { route: 'admin', title: 'Admin panel', help: 'Staff & admin control — you see only what your level permits. Super Admin sees everything, including my controls.', tips: [],
    kw: ['admin', 'super admin', 'control panel', 'dashboard', 'staff', 'team', 'employees', 'manage'] }
];
function mitraNavigate(t) {
  /* only trigger on explicit "find/where/how/open/take me" phrasing so
     transactional asks ("order milk") still transact */
  const wants = /\b(where|how do i|how to|how can|open|take me|go to|navigate|find|show me|reach|locate)\b/.test(t)
    || /(kaha|kahan|कहाँ|कहां|kaise|कैसे|khol|खोल|dikha|दिखा|le chalo|ले चलो)/.test(t);
  if (!wants) return null;
  for (const h of MITRA_HELP) {
    /* PRIVACY: the admin panel is invisible to regular users. Mitra never
       navigates there, names it, or hints it exists unless the server has
       confirmed this person is staff. No user/other-user data is ever exposed. */
    if (h.route === 'admin' && !window.__isStaff) continue;
    if (h.kw.some(k => t.includes(k))) return h;
  }
  return null;
}

function mitraThink(raw) {
  const t = norm(raw);
  const has = (...ws) => ws.some(w => t.includes(w));

  /* — Mitra Brain: every utterance observed; rule matches become
     training labels (the flywheel). Skipped on internal re-dispatch. — */
  const _pred = brainPredict(raw);
  if (!window._brainHop) brainObserve(raw, _pred, ruleIntent(t), 'rules');

  /* — UNIVERSAL NAVIGATOR / HELP: nobody is ever lost. If they ask
     "where is X / how do I X / take me to X / open X", Mitra explains
     it and takes them there. Works in every language. — */
  const nav = mitraNavigate(t);
  if (nav) {
    const a = regAction(() => go(nav.route));
    mitraReply(`<b>${esc(nav.title)}</b> — ${esc(nav.help)}<br/><button class="mbtn" onclick="runMitraAction(${a})">Open ${esc(nav.title)}</button>`,
      nav.tips || ['What else can you do?'], nav.help);
    return;
  }

  /* — wallet — */
  if (has('wallet', 'balance', 'paisa', 'paise', 'money')) {
    const addM = t.match(/(?:add|dal|put|load)[^\d]*(\d+)/);
    if (addM) {
      const amt = Math.min(parseInt(addM[1], 10), 10000);
      walletAdd(amt, 'Added via Mitra · UPI');
      mitraReply(`Done! ✅ Added <b>${money(amt)}</b> to your wallet.<br/>New balance: <b>${money(S.wallet.bal)}</b> 👛`, ['Order milk 🥛', 'Book a ride 🏍️'], `Added ${amt} rupees. New balance ${S.wallet.bal} rupees`);
    } else {
      const a = regAction(() => go('wallet'));
      mitraReply(`Your wallet has <b>${money(S.wallet.bal)}</b> 👛<br/><button class="mbtn" onclick="runMitraAction(${a})">Open wallet</button>`, ['Add 200 to wallet', 'Show my orders 🧾'], `Your wallet has ${S.wallet.bal} rupees`);
    }
    return;
  }

  /* — cancel order — */
  if (has('cancel') && has('order', 'booking', 'khana', 'delivery')) {
    const cand = activeOrders().filter(o => canCancel(o));
    if (cand.length) {
      const o = cand[0];
      cancelOrder(o.id);
      mitraReply(`Done — cancelled <b>${esc(o.title)}</b>.<br/>${money(o.total)} refunded to your wallet instantly. \u{1F44D}`, ['Show my orders \u{1F9FE}', 'Order something else'], 'Cancelled and refunded ' + o.total + ' rupees');
    } else {
      mitraReply(`Nothing I can cancel right now — orders can only be cancelled <b>before pickup</b>. Rides and picked-up orders are locked.`, ['Show my orders \u{1F9FE}']);
    }
    return;
  }

  /* — my tickets — */
  if (has('my ticket', 'mere ticket', 'my booking', 'meri booking', 'show ticket', 'ticket dikha')) {
    const n = (S.tickets || []).length + (S.bookings || []).length + (S.stays || []).length;
    const a = regAction(() => go('tickets/mine'));
    mitraReply(n ? `You have <b>${n}</b> booking${n > 1 ? 's' : ''} \u2B50<br/><button class="mbtn" onclick="runMitraAction(${a})">Open my bookings</button>`
      : `No bookings yet — movies, events, tables and stays all land here.`, n ? ['Show my orders \u{1F9FE}'] : ['Book movie tickets \u2B50']);
    return;
  }

  /* — recommend — */
  if (has('recommend', 'suggest', 'hungry', 'bhook', 'what should i eat', 'kya khau', 'kya khau', 'khane ko')) {
    const picks = [];
    [...DB.shops].filter(s => s.type === 'food' && s.open).sort((a, b) => a.km - b.km).slice(0, 4)
      .forEach(s => { const it = s.items.find(x => x.bestseller) || s.items[0]; if (it) picks.push({ s, it }); });
    picks.sort((a, b) => b.s.rating - a.s.rating);
    const top = picks.slice(0, 2);
    if (top.length) {
      const btns = top.map(p => {
        const a = regAction(() => { cartSet(p.s.id, p.it.id, 1); go('cart'); });
        return `<button class="mbtn" onclick="runMitraAction(${a})">${esc(p.it.name)} · ${money(p.it.price)}</button>`;
      }).join(' ');
      mitraReply(`Nearby favourites right now:<br/>` + top.map(p => `<b>${esc(p.it.name)}</b> at ${esc(p.s.name)} — ★${p.s.rating}, ${p.s.km} km`).join('<br/>') + `<br/>${btns}`,
        ['Veg only options', 'Show all food shops'], 'I suggest ' + top[0].it.name + ' from ' + top[0].s.name);
    } else {
      mitraReply('Food shops are closed right now — try the kirana for snacks?', ['Show all shops']);
    }
    return;
  }

  /* — track orders — */
  if (has('order aa', 'where is my order', 'track', 'kahan', 'kaha hai', 'status', 'my order', 'mera order')) {
    const act = activeOrders();
    if (act.length) {
      const o = act[0]; const f = orderStatus(o);
      const a = regAction(() => go('track/' + o.id));
      mitraReply(`${f.e} <b>${esc(f.t)}</b><br/>${esc(o.title)} · ${o.id}<br/><button class="mbtn" onclick="runMitraAction(${a})">Track live</button>`, ['Show all orders 🧾'], f.t + ' for ' + o.title);
    } else {
      const a = regAction(() => go('orders'));
      mitraReply(`No live orders right now.<br/><button class="mbtn" onclick="runMitraAction(${a})">See past orders</button>`, ['Order milk 🥛', 'Book a bike 🏍️']);
    }
    return;
  }

  /* — ride — */
  if (has('ride', 'bike', 'auto', 'cab', 'car ', 'taxi') && !has('order', 'buy ', 'send', 'bhej')) {
    const vMap = { bike: 'bike', moto: 'bike', auto: 'auto', rick: 'auto', cab: 'car', taxi: 'car', car: 'car', van: 'van', tempo: 'van' };
    let veh = null;
    for (const [w, id] of Object.entries(vMap)) if (t.includes(w)) { veh = id; break; }
    const place = matchPlace(t);
    if (veh || has('ride', 'taxi')) {
      rideReset(); if (place) RIDE.to = place; if (veh) RIDE.veh = veh;
      const a = regAction(() => go('ride'));
      const v = veh ? DB.vehicles.find(x => x.id === veh) : null;
      if (place && v) {
        const km = Math.max(Math.abs(place.km - RIDE.from.km), 1.2);
        mitraReply(`${v.emoji} <b>${v.name} to ${esc(place.name)}</b> — about <b>${money(Math.round(kmFare(v, km)))}</b>, ${km.toFixed(1)} km.<br/><button class="mbtn" onclick="runMitraAction(${a})">Confirm & book</button>`, ['Book it', 'Change to auto 🛺'], `${v.name} to ${place.name}, around ${Math.round(kmFare(v, km))} rupees. Shall I book?`);
      } else {
        mitraReply(`🏍️ Sure — where to? I've opened the ride booker for you.<br/><button class="mbtn" onclick="runMitraAction(${a})">Choose destination</button>`, ['Bike to the station', 'Auto to the mall']);
      }
      return;
    }
  }

  /* — earn / shop intents (before "send", since "deliver" overlaps) — */
  if (has('earn', 'kamai', 'kamana', ' job', 'partner ban', 'deliver and earn')) {
    const a0 = regAction(() => setMode('earn'));
    mitraReply(`💸 Great! In <b>Earn mode</b> you see jobs on your path — carry a tiffin, drop a parcel, get paid instantly.<br/><button class="mbtn" onclick="runMitraAction(${a0})">Open Earn mode</button>`, ['Register as partner']);
    return;
  }
  if (has('my shop', 'register shop', 'dukaan', 'dukan', 'sell on', 'shop khol')) {
    const a0 = regAction(() => go('myshop'));
    mitraReply(`Let's put your dukaan online — free, 2-minute form, and <b>you choose</b> who delivers: you, or nearby partners.<br/><button class="mbtn" onclick="runMitraAction(${a0})">Register my shop</button>`, ['Open my shop dashboard']);
    return;
  }

  /* — send parcel — */
  if (has('send', 'bhej', 'deliver', 'pickup', 'courier', 'parcel', 'tiffin')) {
    const typeMap = { tiffin: 'tiffin', food: 'tiffin', lunch: 'tiffin', khana: 'tiffin', document: 'docs', paper: 'docs', file: 'docs', key: 'docs', medicine: 'meds', dawai: 'meds', parcel: 'small', packet: 'small', box: 'small', bag: 'bag', suitcase: 'bag', furniture: 'furn', sofa: 'furn', cake: 'small', flower: 'small' };
    let pt = 'small';
    for (const [w, id] of Object.entries(typeMap)) if (t.includes(w)) { pt = id; break; }
    const place = matchPlace(t);
    sendReset(); SEND.type = pt; SEND.step = place ? 3 : 2; if (place) SEND.to = place;
    const ptObj = DB.parcelTypes.find(p => p.id === pt);
    const a = regAction(() => go('send'));
    mitraReply(`${ptObj.emoji} Sending <b>${ptObj.name}</b>${place ? ` to <b>${esc(place.name)}</b>` : ''} — a verified partner passing by will carry it.<br/><button class="mbtn" onclick="runMitraAction(${a})">${place ? 'Pick partner & pay' : 'Choose drop point'}</button>`, ['Send medicines 💊', 'Send documents 📄'], `Sending ${ptObj.name}${place ? ' to ' + place.name : ''}. A nearby partner will carry it.`);
    return;
  }

  /* — events, planners & venues — */
  if (has('event', 'ticket', 'concert', 'show ', 'planner', 'venue', 'wedding', 'expo', 'mela')) {
    const ev = DB.events.find(e => t.includes(e.title.toLowerCase().split(' ')[0].toLowerCase()) || t.includes((e.cat || '').toLowerCase()));
    const a = regAction(() => go('tickets'));
    mitraReply(ev
      ? `<b>${esc(ev.title)}</b> — ${esc(ev.cat)} · ${esc(ev.venue)}, ${esc(ev.when)}. ${ev.price ? 'From ' + money(ev.price) : 'Free entry'}.<br/><button class="mbtn" onclick="runMitraAction(${a})">Open events</button>`
      : `Everything happening around you — society melas to national summits. You can also hire a verified event planner or book a venue.<br/><button class="mbtn" onclick="runMitraAction(${a})">Open events</button>`,
      ['Events this weekend', 'Book an event planner']);
    return;
  }
  /* — hotels & stays — */
  if (has('hotel', 'room', 'stay', 'lodge', 'check in')) {
    const a = regAction(() => go('estate/hotels'));
    const h = DB.hotels[0];
    mitraReply(`Verified stays near you from <b>${money(DB.hotels.reduce((m, x) => Math.min(m, x.price), 9e9))}/night</b> — e.g. ${esc(h.name)} (★ ${h.rating}).<br/><button class="mbtn" onclick="runMitraAction(${a})">See hotels &amp; book</button>`, ['Book a hotel', 'Homestays']);
    return;
  }
  /* — property — */
  if (has('property', 'flat', 'plot', '1 bhk', '2 bhk', '3 bhk', 'villa', 'house for', 'rent a ', 'makaan', 'ghar chahiye')) {
    const kind = has('rent') ? 'rent' : has('plot', 'land') ? 'plot' : has('shop space', 'office', 'commercial', 'warehouse') ? 'commercial' : 'buy';
    const a = regAction(() => go('estate/' + kind));
    mitraReply(`GPS-pinned, document-verified listings — zero fake properties.<br/><button class="mbtn" onclick="runMitraAction(${a})">Open ${kind === 'buy' ? 'buy' : kind} listings</button>`, ['Post my property free']);
    return;
  }
  /* — cancel latest order — */
  if (has('cancel')) {
    const act = activeOrders()[0];
    if (act && orderStage(act) === 0) {
      const a = regAction(() => {
        S.orders = S.orders.filter(x => x.id !== act.id);
        walletAdd(act.total, 'Refund · ' + act.title);
        save(); refreshChrome();
        mitraReply(`Cancelled &amp; <b>${money(act.total)}</b> refunded to your wallet instantly. Balance: ${money(S.wallet.bal)}.`, ['Order something else']);
      });
      mitraReply(`<b>${esc(act.title)}</b> (${act.id}) hasn't been confirmed yet — I can cancel with a full instant refund.<br/><button class="mbtn" onclick="runMitraAction(${a})">Yes, cancel &amp; refund</button>`, ['Keep the order']);
    } else if (act) {
      mitraReply(`${esc(act.title)} is already ${orderStatus(act).t.toLowerCase()} — too far to cancel now. You can refuse at the door and I'll refund.`, ['Track my order']);
    } else mitraReply(`Nothing live to cancel right now.`, ['Show my orders']);
    return;
  }
  /* — recommend — */
  if (has('recommend', 'suggest', 'best ', 'kuch accha')) {
    const tops = DB.shops.flatMap(s => s.items.filter(i => i.bestseller).map(i => ({ s, i }))).slice(0, 3);
    mitraReply(`People around you love these purity-verified picks:<br/>` + tops.map(x => {
      const a = regAction(() => mitraPlaceOrder(x.s.id, x.i.id, 1));
      return `<button class="mbtn ghost" onclick="runMitraAction(${a})"><b>${esc(x.i.name)}</b> · ${money(x.i.price)} — ${esc(x.s.name)}</button>`;
    }).join(''), ['Order the first one']);
    return;
  }

  /* — help — */
  if (has('hello', 'hi ', 'hey', 'namaste', 'help', 'madad', 'what can')) {
    mitraReply(`I can do it all, friend! 🧿<br/>• <b>Order anything</b> — "order 2 milk", "doodh mangwa do"<br/>• <b>Send anything</b> — "send tiffin to grandma"<br/>• <b>Book rides</b> — "bike to the airport"<br/>• <b>Wallet</b> — "add 200 to wallet"<br/>• <b>Earn</b> — "I want to earn"<br/>• <b>Your shop</b> — "register my dukaan"`, ['Order milk 🥛', 'Send tiffin 🍱', 'Book a ride 🏍️', 'I want to earn 💸']);
    return;
  }

  /* — multi-item order: "milk and bread" — */
  const parts = t.split(/\band\b|,|\baur\b/).map(x => x.trim()).filter(x => x.length > 2);
  if (parts.length > 1) {
    const seen = {};
    const multi = parts.map(p => searchItems(p)[0]).filter(h => h && !seen[h.item.id] && (seen[h.item.id] = 1));
    if (multi.length > 1) {
      const sameShop = multi.every(h => h.shop.id === multi[0].shop.id);
      if (sameShop) {
        const shop = multi[0].shop;
        const a = regAction(() => {
          S.cart = { shopId: shop.id, items: {} };
          multi.forEach(h => S.cart.items[h.item.id] = 1);
          save(); refreshChrome(); go('cart');
        });
        mitraReply(`Found all of it at <b>${esc(shop.name)}</b> (${shop.km} km):<br/>` +
          multi.map(h => `• ${esc(h.item.name)} — ${money(h.item.price)}`).join('<br/>') +
          `<br/><button class="mbtn" onclick="runMitraAction(${a})">Put everything in basket</button>`,
          ['Open basket'], `Found everything at ${shop.name}.`);
      } else {
        mitraReply(`Found them at different shops — confirm each:<br/>` + multi.map(h => {
          const a = regAction(() => mitraPlaceOrder(h.shop.id, h.item.id, 1));
          return `<button class="mbtn ghost" onclick="runMitraAction(${a})"><b>${esc(h.item.name)}</b> · ${money(h.item.price)} — ${esc(h.shop.name)}, ${h.shop.km} km</button>`;
        }).join(''), ['Order the first one']);
      }
      return;
    }
  }

  /* — order an item (the big one) — */
  const hits = searchItems(t);
  if (hits.length) {
    const { shop, item } = hits[0];
    const q = extractQty(t);
    const sub = item.price * q;
    const fee = sub >= 199 ? 0 : (shop.delivery === 'self' ? 15 : 25);
    const total = sub + fee;
    const a = regAction(() => mitraPlaceOrder(shop.id, item.id, q));
    const b = regAction(() => { S.cart = { shopId: shop.id, items: { [item.id]: q } }; save(); refreshChrome(); go('cart'); });
    const alt = hits.slice(1, 3).filter(h => h.item.id !== item.id);
    mitraReply(
      `Found it! <b>${esc(item.name)}</b> (${esc(item.qty)})<br/>
       from <b>${esc(shop.name)}</b> — ${shop.km} km away, ★ ${shop.rating}, purity-verified<br/>
       <span class="mprice">${q} × ${money(item.price)} + ${fee ? money(fee) + ' delivery' : 'FREE delivery'} = <b>${money(total)}</b></span><br/>
       <button class="mbtn" onclick="runMitraAction(${a})">Confirm — pay ${money(total)} from wallet</button>
       <button class="mbtn ghost" onclick="runMitraAction(${b})">Put in basket instead</button>
       ${alt.length ? `<small class="malt">Also found: ${alt.map(h => esc(h.item.name) + ' @ ' + esc(h.shop.name)).join(' · ')}</small>` : ''}`,
      ['Confirm', 'Order something else'],
      `Found ${item.name} from ${shop.name}, total ${total} rupees. Confirm to order.`);
    return;
  }

  /* — Mitra Brain fallback: the model routes what the rules missed — */
  if (!window._brainHop && _pred.conf >= 0.55 && BRAIN_CANON[_pred.intent]) {
    brainObserve(raw, _pred, _pred.intent, 'brain');
    window._brainHop = true;
    try { mitraThink(BRAIN_CANON[_pred.intent]); } finally { window._brainHop = false; }
    return;
  }

  /* — Claude escalation (config-gated; answers distill into the brain) — */
  const _llm = (window.ORIGNALS_CONFIG || {}).llm || {};
  if (!window._brainHop && _llm.apiKey && !String(_llm.apiKey).includes('YOUR-')) {
    mitraReply(`Thinking…`, []);
    brainAskClaude(raw).then(out => {
      if (out) {
        const canon = BRAIN_CANON[out.intent];
        mitraReply(esc(out.reply) + (canon ? `<br/><button class="mbtn" onclick="window._brainHop=true;try{mitraThink('${canon}')}finally{window._brainHop=false}">Do it for me</button>` : ''),
          ['Help'], out.reply);
      } else {
        mitraReply(`Hmm, I didn't find that nearby. Try simpler words like <i>"milk"</i>, <i>"biryani"</i>, <i>"medicine"</i> — or say <i>"help"</i>.`, ['Help', 'Order bread']);
      }
    });
    return;
  }

  /* — fallback — language-aware. If the message is in a language Mitra isn't
     fully trained in yet, greet in that language, say it's learning, and still
     help. The utterance is already logged (brainObserve) for on-demand training. */
  const _li = (typeof mitraLangInfo === 'function') ? mitraLangInfo(raw) : null;
  if (_li && !_li.trained && _li.code !== 'en') {
    mitraReply(`<b>${esc(_li.hello)}</b> 🙏 I can see you're writing in <b>${esc(_li.name)}</b> <small class="dim">(${esc(_li.native)})</small>. I understand a little, and I'm learning to speak it fully — I've noted this so my team can train me in ${esc(_li.name)}. For now, tell me in a few words or English and I'll do it: <i>"order milk"</i>, <i>"book a ride"</i>, <i>"send a parcel"</i>.`,
      ['Help', 'Order milk', 'Book a ride'], _li.hello);
    return;
  }
  mitraReply(`Hmm, I didn't find that nearby. Try simpler words like <i>"milk"</i>, <i>"biryani"</i>, <i>"medicine"</i>, <i>"flowers"</i> — or say <i>"help"</i> to see everything I can do. <small class="malt">(Every question teaches Mitra Brain — it gets smarter daily.)</small>`,
    ['Help', 'Order bread', 'Send a parcel']);
}

/* assistant places the order end-to-end */
function mitraPlaceOrder(shopId, itemId, q) {
  const shop = findShop(shopId); const item = findItem(shop, itemId);
  const sub = item.price * q;
  const fee = sub >= 199 ? 0 : (shop.delivery === 'self' ? 15 : 25);
  const total = sub + fee;
  if (S.wallet.bal < total) {
    mitraReply(`Your wallet has only <b>${money(S.wallet.bal)}</b> — this needs <b>${money(total)}</b>. Say <i>"add ${Math.ceil((total - S.wallet.bal) / 50) * 50} to wallet"</i> and I'll top it up. 👛`, [`Add ${Math.ceil((total - S.wallet.bal) / 50) * 50} to wallet`]);
    return;
  }
  walletPay(total, 'Order · ' + shop.name + ' (via Mitra)');
  const o = createOrder({
    kind: 'shop', flow: shop.delivery === 'self' ? 'shop_self' : 'shop_partner',
    km: +shop.km || undefined,
    title: shop.name + ' · ' + item.name, emoji: shop.emoji, shopId: shop.id,
    items: [{ name: item.name, emoji: item.emoji, q, price: item.price }],
    total, addr: S.user.addr
  });
  confettiBurst();
  const a = regAction(() => go('track/' + o.id));
  mitraReply(`🎉 Ordered! <b>${esc(item.name)} × ${q}</b> from ${esc(shop.name)}.<br/>Paid ${money(total)} from wallet · balance ${money(S.wallet.bal)}.<br/>${shop.delivery === 'self' ? 'The shop delivers it itself' : 'A nearby partner will carry it to you'}<br/><button class="mbtn" onclick="runMitraAction(${a})">📍 Track it live</button>`,
    ['Track my order 📍', 'Order something else'],
    `Ordered ${item.name} from ${shop.name}. ${total} rupees paid from wallet.`);
}
