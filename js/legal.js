/* ============================================================
   ORIGNALS LEGAL & COMPLIANCE
   Policies required for an Indian consumer marketplace:
   · Privacy (DPDP Act 2023)  · Terms of Service
   · Refund & Cancellation    · Shipping & Delivery
   · Grievance Redressal (Consumer Protection (E-Commerce) Rules 2020)
   Plus first-run consent and DPDP data export / erasure.
   Placeholders in [SQUARE BRACKETS] are for the registered entity
   to fill once incorporation completes — see docs/COMPLIANCE.md.
   ============================================================ */

const LEGAL_UPDATED = '6 July 2026';
const LEGAL_ENTITY = '[Registered Entity Name Pvt. Ltd.]';
const GRIEVANCE = { name: '[Grievance Officer Name]', email: 'grievance@orignals.shop', phone: '[+91-XXXXXXXXXX]', hours: 'Mon–Sat, 10:00–18:00 IST' };

function legalPage(title, sub, bodyHTML) {
  return `<div class="page-head"><button class="back" onclick="history.length>1?history.back():go('account')">${ic('chevl', 16)}</button>
    <div><h1>${esc(title)}</h1><small>${esc(sub)}</small></div></div>
    <article class="legal">${bodyHTML}
    <p class="legal-foot">Last updated ${LEGAL_UPDATED} · Orignals is operated by ${esc(LEGAL_ENTITY)}. Questions: ${GRIEVANCE.email}</p></article>`;
}

/* ---------- hub ---------- */
view('legal', () => {
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('account')">${ic('chevl', 16)}</button>
    <div><h1>Legal &amp; policies</h1><small>Transparency is part of the promise</small></div></div>
  <div class="trust-row">${ic('shield', 13)} Plain-language policies. Your data is yours — export or erase it any time.</div>
  ${[
    ['legal/privacy', 'lock', 'Privacy Policy', 'What we collect, why, and your DPDP rights'],
    ['legal/terms', 'receipt', 'Terms of Service', 'The agreement for using Orignals'],
    ['legal/refund', 'cash', 'Refund &amp; Cancellation', 'When and how you get your money back'],
    ['legal/shipping', 'truck', 'Shipping &amp; Delivery', 'How delivery works and timelines'],
    ['legal/grievance', 'users', 'Grievance Redressal', 'A named officer, a 48-hour promise'],
    ['legal/data', 'grid', 'Your data', 'Export everything, or erase it for good']
  ].map(r => `<button class="role-row" onclick="go('${r[0]}')">
      <span>${ic(r[1], 20)}</span><div><b>${r[2]}</b><small>${r[3]}</small></div><em>Open</em></button>`).join('')}
  <div class="foot-note">Compliant-by-design with the Digital Personal Data Protection Act 2023 and the Consumer Protection (E-Commerce) Rules 2020.</div>`;
});

/* ---------- Privacy (DPDP Act 2023) ---------- */
view('legal/privacy', () => {
  $('#view').innerHTML = legalPage('Privacy Policy', 'Digital Personal Data Protection Act, 2023', `
    <h3>1. Who we are</h3>
    <p>Orignals ("we", "the platform") is a marketplace connecting buyers, neighbourhood shops, delivery partners, hosts and property owners. We are the Data Fiduciary for the personal data described below.</p>
    <h3>2. What we collect</h3>
    <ul>
      <li><b>You give us:</b> your name, phone number, and delivery address / location, so orders reach you.</li>
      <li><b>Automatically:</b> device identifier, approximate location (only when you allow it), and order/booking history to run the service.</li>
      <li><b>Partners &amp; sellers:</b> KYC documents (ID, vehicle papers, GST/FSSAI) for verification and fraud prevention, and bank details for payouts.</li>
    </ul>
    <h3>3. Why we use it (purpose)</h3>
    <p>Strictly to: fulfil your orders, show nearby shops, match verified partners, process payments and refunds, verify identities to keep everyone safe, and meet legal obligations. We do <b>not</b> sell your personal data. We do not show third-party ad tracking.</p>
    <h3>4. Consent</h3>
    <p>We ask for your consent before you first use the app, and again specifically before accessing your device location. You may withdraw consent at any time from <b>Account → Legal → Your data</b>; withdrawal does not affect processing already done.</p>
    <h3>5. Sharing</h3>
    <p>We share only the minimum needed: your first name and drop location with the assigned delivery partner and shop; payment details with our RBI-regulated payment processor; and information with authorities where the law requires. All processors are bound by contract.</p>
    <h3>6. Storage &amp; security</h3>
    <p>Data is stored on secured servers with row-level access control and encrypted transport (HTTPS). We retain personal data only as long as needed for the service or as required by law (e.g. financial records are kept for the statutory period).</p>
    <h3>7. Your rights (DPDP)</h3>
    <ul>
      <li><b>Access &amp; correction</b> of your data.</li>
      <li><b>Erasure</b> — delete your data (Account → Legal → Your data). Financial records are de-identified and retained only as the law requires.</li>
      <li><b>Grievance</b> — reach our officer (see Grievance Redressal) and, if unresolved, the Data Protection Board of India.</li>
      <li><b>Nomination</b> of another person to exercise your rights in the event of death or incapacity.</li>
    </ul>
    <h3>8. Children</h3>
    <p>Orignals is not for users under 18. We do not knowingly process children's data without verifiable parental consent.</p>
    <h3>9. Changes</h3>
    <p>We will notify material changes in-app. Continued use after a change means you accept the updated policy.</p>`);
});

/* ---------- Terms of Service ---------- */
view('legal/terms', () => {
  $('#view').innerHTML = legalPage('Terms of Service', 'The agreement between you and Orignals', `
    <h3>1. The marketplace</h3>
    <p>Orignals is an intermediary that connects buyers with independent sellers, delivery partners, hosts and property owners. Except where we sell directly, the contract for any item or service is between you and that seller/partner. We are not the manufacturer or seller of listed goods.</p>
    <h3>2. Your account</h3>
    <p>You must be 18+ and provide accurate information. You are responsible for activity on your account and for keeping your login safe. One person, one genuine identity — duplicate or fraudulent accounts are removed.</p>
    <h3>3. Verification &amp; trust</h3>
    <p>Partners and sellers are identity-, and where applicable vehicle- and licence-verified. Purity claims on food are checked by our field/lab process. Providing false documents leads to removal and may be reported to authorities.</p>
    <h3>4. Payments</h3>
    <p>Prices shown are the prices you pay — no hidden surge or fees. Online payments are processed by our RBI-regulated payment partner. The in-app wallet is stored value for use on Orignals and is not a bank deposit; it earns no interest.</p>
    <h3>5. Acceptable use</h3>
    <p>Do not use Orignals for anything illegal, to sell prohibited goods, to harass others, or to game incentives. We may suspend accounts that break these rules or threaten the safety of the community.</p>
    <h3>6. Liability</h3>
    <p>As an intermediary we work hard to keep the platform safe but do not warrant every third-party listing. To the extent permitted by law, our liability for any claim is limited to the value of the specific order concerned. Nothing here limits rights you have under the Consumer Protection Act, 2019.</p>
    <h3>7. Governing law</h3>
    <p>These terms are governed by the laws of India; courts at [City] have jurisdiction, without prejudice to consumer-forum rights.</p>`);
});

/* ---------- Refund & Cancellation ---------- */
view('legal/refund', () => {
  $('#view').innerHTML = legalPage('Refund &amp; Cancellation', 'When and how you get your money back', `
    <h3>1. Cancelling an order</h3>
    <p>You can cancel free of charge <b>before the shop hands the order to a delivery partner</b> (before pickup). The full amount is returned to your Orignals wallet <b>instantly</b>. After pickup, an order can no longer be cancelled, but see refusal below.</p>
    <h3>2. If the shop can't take it</h3>
    <p>If a seller rejects your order, you are refunded in full automatically, with a notification.</p>
    <h3>3. Refusal at the door</h3>
    <p>If an item arrives damaged, wrong, or not as described, refuse it at the door and raise it with Mitra or our grievance officer. Verified cases are refunded.</p>
    <h3>4. Rides &amp; services</h3>
    <p>Rides can be cancelled before the captain arrives at no cost. Once a ride starts it is chargeable for the distance travelled.</p>
    <h3>5. Stays &amp; bookings</h3>
    <p>Free cancellation up to 24 hours before check-in unless a listing states otherwise on its page.</p>
    <h3>6. How money comes back</h3>
    <p>Refunds land in your Orignals wallet instantly. Wallet balance can be withdrawn to your bank/UPI; bank refunds for direct payments follow your bank's timeline (typically 5–7 working days).</p>`);
});

/* ---------- Shipping & Delivery ---------- */
view('legal/shipping', () => {
  $('#view').innerHTML = legalPage('Shipping &amp; Delivery', 'How your order reaches you', `
    <h3>1. Delivery model</h3>
    <p>Each shop chooses to deliver with its own staff or through a verified Orignals partner passing nearby. You see which applies on the shop page and while tracking.</p>
    <h3>2. Timelines</h3>
    <p>Estimated times shown at checkout and on the live map are calculated from the real distance between the shop and your address. Actual time can vary with traffic, weather and shop preparation.</p>
    <h3>3. Serviceable area</h3>
    <p>Nearby shops are shown based on your delivery location. If nothing is available yet in your area, sellers are onboarding — check back soon.</p>
    <h3>4. Handover &amp; safety</h3>
    <p>Deliveries are confirmed with a one-time code (OTP) at pickup and drop. Your phone number is masked; partners cannot see it.</p>`);
});

/* ---------- Grievance Redressal ---------- */
view('legal/grievance', () => {
  $('#view').innerHTML = legalPage('Grievance Redressal', 'Consumer Protection (E-Commerce) Rules, 2020', `
    <div class="trust-row">${ic('shield', 13)} We acknowledge every grievance within <b>48 hours</b> and aim to resolve within <b>30 days</b>.</div>
    <h3>Grievance Officer</h3>
    <div class="card-block">
      <div class="ck-line"><span>Name</span><span><b>${esc(GRIEVANCE.name)}</b></span></div>
      <div class="ck-line"><span>Email</span><span>${esc(GRIEVANCE.email)}</span></div>
      <div class="ck-line"><span>Phone</span><span>${esc(GRIEVANCE.phone)}</span></div>
      <div class="ck-line"><span>Hours</span><span>${esc(GRIEVANCE.hours)}</span></div>
    </div>
    <h3>How to raise an issue</h3>
    <ol>
      <li>Fastest: open <b>Mitra</b> and describe the problem — most order issues resolve in chat.</li>
      <li>For a formal grievance, email the officer above with your order ID and the details.</li>
      <li>You receive an acknowledgement with a ticket number within 48 hours.</li>
    </ol>
    <h3>If still unresolved</h3>
    <p>You may approach the <b>National Consumer Helpline (1915)</b>, your local consumer forum, or — for data matters — the <b>Data Protection Board of India</b>.</p>
    <button class="btn-main wide" onclick="toast('Opening Mitra to log your issue');setTimeout(()=>go('mitra'),500)">Raise an issue with Mitra</button>`);
});

/* ---------- Your data: export & erase (DPDP) ---------- */
view('legal/data', () => {
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('legal')">${ic('chevl', 16)}</button>
    <div><h1>Your data</h1><small>Export everything · erase it for good</small></div></div>
  <div class="trust-row">${ic('lock', 13)} Your data belongs to you. These controls are always available.</div>
  <div class="card-block">
    <h3>${ic('upload', 15)} Export my data</h3>
    <p class="movie-about">Download everything Orignals holds for you on this device — profile, orders, wallet, roles — as a JSON file.</p>
    <button class="btn-main sm" onclick="exportState()">Download my data (JSON)</button>
  </div>
  <div class="card-block">
    <h3>${ic('trash', 15)} Erase my data</h3>
    <p class="movie-about">Permanently delete your personal data from this device and our servers. Financial records required by law are de-identified, not kept against your name. This cannot be undone.</p>
    <button class="btn-main sm ghost red" onclick="eraseMyData()">Erase everything</button>
  </div>
  <div class="foot-note">Under the DPDP Act 2023 you may also nominate someone to exercise these rights on your behalf — contact our grievance officer.</div>`;
});

async function eraseMyData() {
  if (!confirm('Erase ALL your data everywhere? Orders, wallet, shop, listings and profile will be permanently deleted. This cannot be undone.')) return;
  if (!confirm('Final confirmation — this is irreversible. Continue?')) return;
  toast('Erasing your data…');
  try {
    if (typeof CLOUD !== 'undefined' && CLOUD.on && S.deviceKey) {
      await cloudFetch('rpc/erase_device', { method: 'POST', body: JSON.stringify({ p_device: S.deviceKey }) }).catch(() => {});
    }
  } catch (e) { /* proceed with local wipe regardless */ }
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
  toast('Your data has been erased. Thank you for using Orignals.');
  setTimeout(() => location.reload(), 1200);
}

/* ---------- first-run consent ---------- */
function consentGateHTML() {
  return `<div id="consentGate">
    <div class="consent-card">
      <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#1A5632" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12l2.5 2.5L16 9" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h2>Welcome to Orignals</h2>
      <p>We use your name, phone and delivery location <b>only</b> to run your orders, rides and bookings. We never sell your data and show no ad tracking.</p>
      <p class="consent-links">Read our <a onclick="closeConsent();go('legal/privacy')">Privacy Policy</a> and <a onclick="closeConsent();go('legal/terms')">Terms</a>.</p>
      <button class="btn-main wide" onclick="acceptConsent()">I agree — continue</button>
      <button class="btn-main wide ghost" onclick="closeConsent()">Look around first</button>
    </div></div>`;
}
function maybeShowConsent() {
  try {
    if (localStorage.getItem('omny_consent')) return;
    const d = document.createElement('div');
    d.innerHTML = consentGateHTML();
    document.body.appendChild(d.firstChild);
  } catch (e) {}
}
function acceptConsent() {
  try { localStorage.setItem('omny_consent', new Date().toISOString()); } catch (e) {}
  closeConsent();
  toast('Thank you — welcome to Orignals');
}
function closeConsent() { const g = document.getElementById('consentGate'); if (g) g.remove(); }
