/* ============================================================
   ORIGNALS icon system — crisp stroke icons (24×24), no emoji.
   ic(name, size, cls) → inline SVG string
   ============================================================ */

const ICONS = {
  spark:   '<path d="M12 2.5l2.3 6.9 7.2 2.6-7.2 2.6L12 21.5l-2.3-6.9-7.2-2.6 7.2-2.6z"/>',
  home:    '<path d="M3 10.5L12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/>',
  store:   '<path d="M4.5 7L6 3h12l1.5 4"/><path d="M4 7h16v2.6a2.6 2.6 0 01-5.2 0 2.7 2.7 0 01-5.4 0A2.6 2.6 0 014 9.6z"/><path d="M5.5 12.5V21h13v-8.5"/><path d="M9.5 21v-5h5v5"/>',
  grid:    '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  search:  '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
  package: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3.3 8.2L12 13l8.7-4.8"/><path d="M12 13v8.5"/>',
  box:     '<rect x="4" y="8" width="16" height="12" rx="1"/><path d="M4 8l2-4h12l2 4"/><path d="M12 8v12"/>',
  bike:    '<circle cx="5.5" cy="17.5" r="3"/><circle cx="18.5" cy="17.5" r="3"/><path d="M5.5 17.5l3.5-7h5.5l4 7"/><path d="M9 10.5L8 8h3"/><path d="M14.5 10.5L13 7h3"/>',
  cycle:   '<circle cx="5.5" cy="17" r="3.4"/><circle cx="18.5" cy="17" r="3.4"/><path d="M5.5 17L9 9h6.5"/><path d="M12 17l-3-8"/><path d="M15.5 9l3 8"/><path d="M8 9H6.5"/>',
  auto:    '<path d="M3 12V8a2 2 0 012-2h8l4.5 6H21v4h-1.5"/><path d="M3 12h14"/><path d="M3 12v4h1.5"/><circle cx="7.5" cy="17" r="2.2"/><circle cx="16" cy="17" r="2.2"/><path d="M9.7 17H14"/>',
  car:     '<path d="M4.5 15.5L6 10h12l1.5 5.5"/><path d="M3.5 15.5h17V19h-2"/><path d="M3.5 15.5V19h2"/><circle cx="7.5" cy="19" r="1.8"/><circle cx="16.5" cy="19" r="1.8"/>',
  van:     '<path d="M2.5 7h11.5l4.5 4h3v6h-2"/><path d="M2.5 7v10h1.7"/><path d="M8.5 17h7"/><circle cx="6.3" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/><path d="M14 7v4h5"/>',
  truck:   '<rect x="2" y="6" width="12" height="10" rx="1"/><path d="M14 9.5h4l3 3V16h-2.2"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M8 18h7"/>',
  walk:    '<circle cx="12.5" cy="4.5" r="2"/><path d="M12.5 9l-1 5-3 6.5"/><path d="M11.5 14l3 2 1 4.5"/><path d="M9 11.5l3.5-3 3 1.5 2 2.5"/>',
  wallet:  '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.2"/>',
  bell:    '<path d="M6 9.5a6 6 0 0112 0c0 4.8 2 6 2 6H4s2-1.2 2-6z"/><path d="M10.3 19.5a2 2 0 003.4 0"/>',
  moon:    '<path d="M20 13.5A8.5 8.5 0 1110.5 4a7 7 0 009.5 9.5z"/>',
  sun:     '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5 5l1.8 1.8M17.2 17.2L19 19M19 5l-1.8 1.8M6.8 17.2L5 19"/>',
  user:    '<circle cx="12" cy="8" r="3.6"/><path d="M5 20.5a7 7 0 0114 0"/>',
  users:   '<circle cx="8.5" cy="9" r="3"/><circle cx="16.5" cy="10" r="2.4"/><path d="M3.5 19.5a5.3 5.3 0 0110 0"/><path d="M14.5 19.5a4.3 4.3 0 016.5-3"/>',
  mic:     '<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0"/><path d="M12 18v3.5"/>',
  sendp:   '<path d="M21.5 2.5L11 13"/><path d="M21.5 2.5l-6.8 19-3.7-8.5-8.5-3.7z"/>',
  pin:     '<path d="M12 21.5s-7.2-6.2-7.2-11.3a7.2 7.2 0 0114.4 0C19.2 15.3 12 21.5 12 21.5z"/><circle cx="12" cy="10" r="2.6"/>',
  clock:   '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l3.2 2"/>',
  check:   '<path d="M4.5 12.5l5 5L19.5 6.5"/>',
  flag:    '<path d="M5.5 21.5V4"/><path d="M5.5 5c4.2-2.2 6.3 2 10.5 0v8c-4.2 2-6.3-2.2-10.5 0"/>',
  shield:  '<path d="M12 2.8l7.5 2.9V12c0 4.6-3.1 7.7-7.5 9.2C7.6 19.7 4.5 16.6 4.5 12V5.7z"/><path d="M9 11.8l2.2 2.2 4-4.5"/>',
  phone:   '<path d="M5 3.5h4L10.8 8 8.5 9.8a12.5 12.5 0 005.7 5.7L16 13.2l4.5 1.8v4a2 2 0 01-2.2 2A17.3 17.3 0 013 5.7 2 2 0 015 3.5z"/>',
  plus:    '<path d="M12 5v14M5 12h14"/>',
  minus:   '<path d="M5 12h14"/>',
  x:       '<path d="M6 6l12 12M18 6L6 18"/>',
  chevl:   '<path d="M14.5 5l-7 7 7 7"/>',
  arrowr:  '<path d="M4 12h15"/><path d="M13 5.5l6.5 6.5-6.5 6.5"/>',
  swap:    '<path d="M8 3.5V19M8 3.5L4.8 6.7M8 3.5l3.2 3.2"/><path d="M16 20.5V5M16 20.5l3.2-3.2M16 20.5l-3.2-3.2"/>',
  receipt: '<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5L10 21l-2-1.5L6 21z"/><path d="M9.5 8h5M9.5 12h5"/>',
  leaf:    '<path d="M5 19.5C5 9.5 13 4 20.5 4 20.5 12.5 15 19.5 5 19.5z"/><path d="M5 19.5c3-5.5 7-9 11-11"/>',
  cross:   '<path d="M9.5 3.5h5v5.5h5.5v5h-5.5v5.5h-5v-5.5H4v-5h5.5z"/>',
  shirt:   '<path d="M8.5 3.5L12 5.5l3.5-2L20 8l-3 2.3V20.5H7V10.3L4 8z"/>',
  plug:    '<path d="M9 2.5V7M15 2.5V7"/><path d="M6.5 7h11l-1.3 5a4.3 4.3 0 01-8.4 0z"/><path d="M12 16.5v5"/>',
  factory: '<path d="M3 21V9.5l6 3.2v-3.2l6 3.2V6.5h6V21z"/><path d="M17 10.5V21"/><path d="M7 17h2M12 17h2"/>',
  flower:  '<path d="M12 3c2.2 3 5.2 3 5.2 6.8a5.2 5.2 0 01-10.4 0C6.8 6 9.8 6 12 3z"/><path d="M12 15v6.5"/><path d="M12 19c-2.2 0-4.2-1-5.2-3M12 19c2.2 0 4.2-1 5.2-3"/>',
  bowl:    '<path d="M4 12.5h16a8 8 0 01-16 0z"/><path d="M9 8.5c0-1.6 1.2-1.6 1.2-3.2M13.8 8.5c0-1.6 1.2-1.6 1.2-3.2"/><path d="M8.5 19.5h7"/>',
  cart:    '<circle cx="9.5" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M3 4h2.6L8 15.5h10l2.5-8H6"/>',
  file:    '<path d="M7 2.5h7.5L19.5 8v13.5H7z"/><path d="M14 2.5V8h5.5"/><path d="M10 13h6M10 16.5h6"/>',
  briefcase:'<rect x="3.5" y="8" width="17" height="12" rx="2"/><path d="M9 8V6a2 2 0 012-2h2a2 2 0 012 2v2"/><path d="M3.5 13h17"/>',
  sofa:    '<path d="M4.5 18v-4.5a2 2 0 012-2h11a2 2 0 012 2V18z"/><path d="M6.5 11.5V8.5a3 3 0 013-3h5a3 3 0 013 3v3"/><path d="M6 18v2M18 18v2"/>',
  weight:  '<path d="M4 9.5v5M8 7v10M16 7v10M20 9.5v5M8 12h8"/>',
  cash:    '<rect x="2.5" y="6.5" width="19" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v4M18 10v4"/>',
  card:    '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/><path d="M6 15h4"/>',
  chart:   '<path d="M5 20v-6M11 20V6M17 20v-9"/><path d="M3 20.5h18"/>',
  camera:  '<rect x="3" y="7" width="18" height="13" rx="2.5"/><circle cx="12" cy="13.2" r="3.5"/><path d="M8.5 7l1.6-2.6h3.8L15.5 7"/>',
  upload:  '<path d="M12 16V4.5M6.5 9.5L12 4l5.5 5.5"/><path d="M4.5 20h15"/>',
  gift:    '<rect x="3.5" y="8" width="17" height="4"/><path d="M5.5 12v8.5h13V12"/><path d="M12 8v12.5"/><path d="M12 8c-1.6-3.2-6.4-2.6-4.8.5M12 8c1.6-3.2 6.4-2.6 4.8.5"/>',
  book:    '<path d="M4.5 5A2.5 2.5 0 017 2.5h12.5V18H7A2.5 2.5 0 004.5 20.5z"/><path d="M4.5 20.5A2.5 2.5 0 017 18h12.5v3.5H7"/>',
  lock:    '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>',
  trash:   '<path d="M4 7h16M9.5 7V4.5h5V7"/><path d="M6.5 7l1 14h9l1-14"/>',
  edit:    '<path d="M4 20h4.5L20.5 8 16 3.5 4 15.5z"/><path d="M13 6.5l4.5 4.5"/>',
  eye:     '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  headset: '<path d="M4.5 13.5a7.5 7.5 0 0115 0"/><rect x="4" y="13.5" width="3.5" height="6" rx="1.5"/><rect x="16.5" y="13.5" width="3.5" height="6" rx="1.5"/><path d="M19.5 19.5a3 3 0 01-3 3H14"/>',
  star:    '<path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.7 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/>'
};

function ic(name, size, cls) {
  const body = ICONS[name] || ICONS.spark;
  return `<svg class="ic ${cls || ''}" width="${size || 18}" height="${size || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
/* nested-in-SVG variant (for map markers) */
function icNested(name, size, color) {
  return `<svg x="${-size / 2}" y="${-size / 2}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color || '#fff'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}
/* icon-or-legacy-emoji (old saved data may hold an emoji char) */
function icOr(val, size) { return ICONS[val] ? ic(val, size) : `<span class="ic-em">${val || ''}</span>`; }

/* domain mappings */
const TYPE_ICON = { all:'grid', organic:'leaf', grocery:'cart', food:'bowl', pharmacy:'cross', fashion:'shirt', electronics:'plug', wholesale:'factory', flowers:'flower' };
const VEH_ICON  = { walk:'walk', cycle:'cycle', bike:'bike', auto:'auto', car:'car', van:'van', truck:'truck' };
const PARCEL_ICON = { tiffin:'bowl', docs:'file', meds:'cross', small:'package', bag:'briefcase', crate:'box', furn:'sofa', heavy:'weight' };
const KIND_ICON = { shop:'store', send:'package', ride:'car' };
const typeIcon   = (t, s) => ic(TYPE_ICON[t] || 'store', s);
const vehIcon    = (v, s) => ic(VEH_ICON[v] || 'bike', s);
const parcelIcon = (p, s) => ic(PARCEL_ICON[p] || 'package', s);
const kindIcon   = (k, s) => ic(KIND_ICON[k] || 'receipt', s);
