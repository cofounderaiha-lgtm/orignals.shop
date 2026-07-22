/* ============================================================
   SUPPLY CHAIN + VIRTUAL INVENTORY (shop owner side)
     manufacturer → wholesaler → retailer (your shop) → customer

   Three things a small shopkeeper actually needs:
     1. What do I have right now, and what's about to run out?
     2. Who do I buy it from, and order it in a few taps.
     3. Did it arrive? (receiving is what creates stock, with a batch)

   Stock is never a number we edit — it is the sum of an append-only
   ledger (supabase/migrations/0005_supply_chain.sql), so it can be
   audited and can't silently drift.
   ============================================================ */
const SUP = { tab: 'stock', data: null, po: null };

function supApi(fn, body) {
  if (typeof CLOUD === 'undefined' || !CLOUD.on) return Promise.resolve(null);
  return cloudFetch('rpc/' + fn, { method: 'POST', body: JSON.stringify(Object.assign({ p_device: S.deviceKey || '' }, body || {})) }).catch(() => null);
}
function supTab(t) { SUP.tab = t; VIEWS.supply([]); }

view('supply', () => {
  if (!S.myShop) { toast('Register your shop first'); go('myshop'); return; }
  const tabs = [['stock', 'Stock'], ['orders', 'My purchases'], ['incoming', 'Incoming orders']];
  $('#view').innerHTML = `
  <div class="page-head"><button class="back" onclick="go('myshop')">${ic('chevl', 16)}</button>
    <div><h1>Stock &amp; supply</h1><small>What you hold · who you buy from · what's arriving</small></div></div>
  <div class="tip-strip">${ic('shield', 13)} Every movement is recorded — purchases in, sales out. Your stock number is the sum of that history, not a figure anyone can type over.</div>
  <div class="chip-row">${tabs.map(t => `<button class="chip ${SUP.tab === t[0] ? 'on' : ''}" onclick="supTab('${t[0]}')">${t[1]}</button>`).join('')}</div>
  <div id="supBody"><div class="empty sm"><span>${ic('package', 26)}</span><b>Loading…</b></div></div>`;
  supLoad();
});

async function supLoad() {
  const box = document.getElementById('supBody'); if (!box) return;
  if (typeof CLOUD === 'undefined' || !CLOUD.on) { box.innerHTML = `<div class="empty sm"><span>${ic('package', 26)}</span><b>Connect to manage stock</b></div>`; return; }

  if (SUP.tab === 'stock') {
    const r = await supApi('stock_levels');
    const items = (r && r.ok && Array.isArray(r.items)) ? r.items : [];
    const low = items.filter(i => i.is_low || i.is_out);
    box.innerHTML = `
      ${low.length ? `<div class="warn-strip">${ic('shield', 13)} <b>${low.length} item${low.length > 1 ? 's' : ''} need restocking</b> — tap Reorder to buy from a wholesaler.</div>` : ''}
      ${items.length ? items.map(i => {
        const on = +i.on_hand || 0;
        const daily = +i.daily_sales || 0;
        const cover = (daily > 0 && on > 0) ? Math.floor(on / daily) : null;
        const state = i.is_out ? 'OUT OF STOCK' : i.is_low ? 'LOW' : 'OK';
        const col = i.is_out ? 'var(--red,#c0392b)' : i.is_low ? '#b45309' : 'var(--ok,#1a7f3c)';
        return `<div class="job-card">
          <div class="job-top"><span class="job-emoji">${ic('package', 18)}</span>
            <div><b>${esc(i.item_name)} <small style="color:${col};font-weight:800">· ${state}</small></b>
              <small>${on} in stock${cover !== null ? ` · about ${cover} day${cover === 1 ? '' : 's'} left at current sales` : ''}</small>
              <small class="dim">in ${(+i.total_in || 0)} · sold ${(+i.total_out || 0)}${i.batch ? ' · batch ' + esc(i.batch) : ''}</small></div></div>
          <div class="btn-pair">
            <button class="btn-main sm" onclick="supReorder('${esc(i.item_name)}')">${ic('cart', 13)} Reorder</button>
            <button class="btn-main sm ghost" onclick="supAdjustSheet('${esc(i.item_name)}')">Correct count</button>
          </div></div>`;
      }).join('')
        : `<div class="empty"><span>${ic('package', 40)}</span><b>No stock recorded yet</b><p>Order stock from a wholesaler below — when you mark it received, it appears here.</p></div>`}
      <button class="btn-main wide" onclick="supReorder('')">${ic('cart', 14)} Order stock from a supplier</button>`;
    return;
  }

  if (SUP.tab === 'orders') {
    const r = await supApi('po_list');
    const rows = (r && r.ok && Array.isArray(r.placed)) ? r.placed : [];
    box.innerHTML = rows.length ? rows.map(p => supPoCard(p, 'buyer')).join('')
      : `<div class="empty"><span>${ic('receipt', 40)}</span><b>No purchases yet</b><p>Stock you order from wholesalers or manufacturers shows up here.</p></div>`;
    return;
  }

  const r = await supApi('po_list');
  const rows = (r && r.ok && Array.isArray(r.received)) ? r.received : [];
  box.innerHTML = `<div class="foot-note sm" style="text-align:left">Orders other shops have placed with you. Accept, then dispatch.</div>` +
    (rows.length ? rows.map(p => supPoCard(p, 'supplier')).join('')
      : `<div class="empty"><span>${ic('store', 40)}</span><b>No incoming orders</b><p>When a retailer orders stock from you, it appears here.</p></div>`);
}

function supPoCard(p, role) {
  const items = Array.isArray(p.items) ? p.items : [];
  const who = role === 'buyer' ? (p.supplier_name || p.supplier_shop) : (p.buyer_name || p.buyer_shop);
  const steps = ['placed', 'accepted', 'dispatched', 'received'];
  const at = steps.indexOf(p.status);
  return `<div class="job-card">
    <div class="job-top"><span class="job-emoji">${ic('truck', 18)}</span>
      <div><b>PO#${p.id} · ${esc(who)}</b>
        <small>${items.map(i => esc(i.name) + ' × ' + (i.qty || 1)).join(' · ')}</small>
        <small class="dim">${money(p.total || 0)}${p.batch ? ' · batch ' + esc(p.batch) : ''} · ${new Date(p.created_at).toLocaleDateString('en-IN')}</small></div>
      <em class="job-pay">${p.status === 'cancelled' ? '<span style="color:var(--red,#c0392b)">cancelled</span>' : esc(p.status)}</em></div>
    ${p.status !== 'cancelled' && at >= 0 ? `<div class="golive-steps">${steps.map((s, i) => `<span class="${i <= at ? 'done' : ''}">${ic(i <= at ? 'check' : 'clock', 11)} ${s}</span>`).join('')}</div>` : ''}
    ${supPoActions(p, role)}</div>`;
}
function supPoActions(p, role) {
  if (p.status === 'received' || p.status === 'cancelled') return '';
  if (role === 'supplier') {
    if (p.status === 'placed') return `<div class="btn-pair">
      <button class="btn-main sm" onclick="supAdvance(${p.id},'accepted')">${ic('check', 13)} Accept order</button>
      <button class="btn-main sm ghost" onclick="supAdvance(${p.id},'cancelled')">Decline</button></div>`;
    if (p.status === 'accepted') return `<button class="btn-main sm wide" onclick="supDispatchSheet(${p.id})">${ic('truck', 13)} Dispatch with batch no.</button>`;
    return '';
  }
  if (p.status === 'dispatched') return `<button class="btn-main sm wide" onclick="supAdvance(${p.id},'received')">${ic('check', 13)} Received — add to my stock</button>`;
  if (p.status === 'placed') return `<button class="btn-main sm ghost wide" onclick="supAdvance(${p.id},'cancelled')">Cancel this order</button>`;
  return '';
}

async function supAdvance(id, status, batch) {
  const r = await supApi('po_advance', { p_id: id, p_status: status, p_batch: batch || '' });
  if (r && r.ok) {
    toast(status === 'received' ? 'Received — stock updated' : status === 'cancelled' ? 'Order cancelled' : 'Marked ' + status);
    if (status === 'received') { SUP.tab = 'stock'; }
    VIEWS.supply([]);
  } else {
    const why = { supplier_only: 'Only the supplier can do that', buyer_only: 'Only the buyer can confirm receipt', already_dispatched: 'Already dispatched — cannot cancel', not_yours: 'That order is not yours' }[r && r.reason];
    toast(why || 'Could not update');
  }
}
function supDispatchSheet(id) {
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Dispatch PO#${id}</h3>
    <p class="foot-note sm" style="text-align:left">Add the batch / lot number. It travels with the goods down the chain, so a purity claim can be traced back to you.</p>
    <input id="poBatch" placeholder="Batch / lot no. — e.g. GH-042" style="${_supFld}"/>
    <button class="btn-main wide" onclick="supAdvance(${id},'dispatched',(document.getElementById('poBatch')||{}).value||'')">${ic('truck', 14)} Dispatch</button>`);
}
const _supFld = 'width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:12px;margin:6px 0;font:inherit;background:var(--card,#fff);color:inherit';

/* ---------- reorder: pick a supplier, build the PO ---------- */
async function supReorder(itemName) {
  const r = await supApi('suppliers_list', { p_q: '', p_tier: '' });
  const list = Array.isArray(r) ? r : [];
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Order stock</h3>
    <p class="foot-note sm" style="text-align:left">Buy from a wholesaler or straight from a manufacturer. Bigger tiers usually mean better rates and a minimum order.</p>
    ${list.length ? list.map(s => `<button class="place-row" onclick="supPoBuilder('${esc(s.id)}','${esc(s.name)}','${esc(itemName || '')}')">
        <span>${ic(s.tier === 'manufacturer' ? 'factory' : 'store', 17)}</span>
        <div><b>${esc(s.name)}</b><small>${esc(s.tier || '')}${s.category ? ' · ' + esc(s.category) : ''}${s.rating ? ' · ★ ' + (+s.rating).toFixed(1) : ''}</small></div><em>Order</em></button>`).join('')
      : `<div class="empty sm"><span>${ic('store', 26)}</span><b>No suppliers listed yet</b><p>Wholesalers and manufacturers appear here as they join.</p></div>`}`);
}
function supPoBuilder(supplierId, supplierName, itemName) {
  SUP.po = { supplier: supplierId, name: supplierName, lines: [{ name: itemName || '', qty: '', price: '' }] };
  supPoRender();
}
function supPoCapture() {
  if (!SUP.po) return;
  SUP.po.lines.forEach((l, i) => {
    const g = id => (document.getElementById(id + i) || {}).value;
    l.name = g('poN') != null ? g('poN') : l.name;
    l.qty = g('poQ') != null ? g('poQ') : l.qty;
    l.price = g('poP') != null ? g('poP') : l.price;
  });
}
function supPoAddLine() { supPoCapture(); SUP.po.lines.push({ name: '', qty: '', price: '' }); supPoRender(); }
function supPoRender() {
  const p = SUP.po;
  const total = p.lines.reduce((a, l) => a + (parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0), 0);
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Order from ${esc(p.name)}</h3>
    ${p.lines.map((l, i) => `<div style="display:flex;gap:6px">
      <input id="poN${i}" placeholder="Item" value="${esc(l.name || '')}" style="${_supFld};flex:2"/>
      <input id="poQ${i}" type="number" inputmode="numeric" placeholder="Qty" value="${esc(l.qty || '')}" style="${_supFld};flex:1"/>
      <input id="poP${i}" type="number" inputmode="numeric" placeholder="Rate ₹" value="${esc(l.price || '')}" style="${_supFld};flex:1"/>
    </div>`).join('')}
    <button class="lnk" onclick="supPoAddLine()">+ Add another item</button>
    <div class="ck-line grand"><span>Order value</span><span>${money(Math.round(total))}</span></div>
    <input id="poNote" placeholder="Note for the supplier (optional)" style="${_supFld}"/>
    <button class="btn-main wide" onclick="supPoSubmit()">${ic('check', 14)} Place order</button>
    <div class="foot-note sm">You pay the supplier on their terms — Orignals doesn't hold this money.</div>`);
}
async function supPoSubmit() {
  supPoCapture();
  const p = SUP.po;
  const items = p.lines
    .filter(l => (l.name || '').trim() && (parseFloat(l.qty) || 0) > 0)
    .map(l => ({ name: l.name.trim(), qty: parseFloat(l.qty) || 0, price: parseFloat(l.price) || 0 }));
  if (!items.length) { toast('Add at least one item with a quantity'); return; }
  const note = (document.getElementById('poNote') || {}).value || '';
  const r = await supApi('po_place', { p_supplier: p.supplier, p_items: items, p_note: note });
  if (r && r.ok) {
    closeSheet(); confettiBurst();
    notify('Purchase order placed', 'PO#' + r.id + ' to ' + p.name + ' · ' + money(r.total));
    toast('Order placed — PO#' + r.id);
    SUP.tab = 'orders'; VIEWS.supply([]);
  } else {
    const why = { not_a_supplier: 'That shop does not sell wholesale', no_shop: 'Register your shop first', self_order: 'You cannot order from yourself', no_items: 'Add at least one item' }[r && r.reason];
    toast(why || 'Could not place the order');
  }
}
function supAdjustSheet(item) {
  sheet(`<div class="sheet-grab"></div><h3 class="sheet-title">Correct stock · ${esc(item)}</h3>
    <p class="foot-note sm" style="text-align:left">Use this for a stock-take, breakage or spoilage. The correction is recorded — it never silently overwrites history.</p>
    <input id="adjQ" type="number" inputmode="numeric" placeholder="Change — e.g. -3 for spoilage, +5 found" style="${_supFld}"/>
    <select id="adjR" style="${_supFld}"><option value="adjust">Stock-take correction</option><option value="waste">Spoilage / breakage</option><option value="return">Customer return</option></select>
    <button class="btn-main wide" onclick="supAdjustSubmit('${esc(item)}')">Record correction</button>`);
}
async function supAdjustSubmit(item) {
  const d = parseFloat((document.getElementById('adjQ') || {}).value);
  const reason = (document.getElementById('adjR') || {}).value || 'adjust';
  if (!d) { toast('Enter a change, like -3 or +5'); return; }
  const r = await supApi('stock_adjust', { p_item: item, p_delta: d, p_reason: reason });
  if (r && r.ok) { closeSheet(); toast('Recorded'); VIEWS.supply([]); }
  else toast('Could not record');
}
