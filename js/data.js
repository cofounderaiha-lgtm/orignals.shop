/* ============================================================
   OMNY — The Everything Platform (seed data)
   Buy from any shop nearby · Deliver & earn as you pass by
   ============================================================ */

const DB = {

  /* ---------- SHOP CATEGORIES ---------- */
  shopTypes: [
    { id:'all',        name:'All',        emoji:'🧿' },
    { id:'organic',    name:'Organic',    emoji:'🌿' },
    { id:'grocery',    name:'Kirana',     emoji:'🛒' },
    { id:'food',       name:'Food',       emoji:'🍛' },
    { id:'pharmacy',   name:'Pharmacy',   emoji:'💊' },
    { id:'fashion',    name:'Fashion',    emoji:'👗' },
    { id:'electronics',name:'Electronics',emoji:'🔌' },
    { id:'wholesale',  name:'Wholesale',  emoji:'🏭' },
    { id:'flowers',    name:'Flowers',    emoji:'💐' }
  ],

  /* ---------- NEARBY SHOPS (every shop in India can be here) ---------- */
  /* named purity inspectors — every food/organic shop is checked by a real,
     named person; their name is shown on the shop (video-spec trust design) */
  inspectors: [
    { name: 'Rukmini Devi',  area: 'Mukherjee Nagar' },
    { name: 'Arif Khan',     area: 'GTB Nagar' },
    { name: 'S. Lakshmanan', area: 'Model Town' },
    { name: 'Poonam Rawat',  area: 'Hudson Lane' },
    { name: 'Baldev Singh',  area: 'Kingsway Camp' },
    { name: 'Meera Joshi',   area: 'Vijay Nagar' }
  ],

  shops: [
    { id:'sh1', name:'Prakriti Organic Store', type:'organic', emoji:'🌿', grad:['#0F3B21','#1A5632'],
      rating:4.7, ratings:'2.1K', km:0.4, time:12, open:true, delivery:'partner', veg:true,
      offer:'FRESH20 — ₹20 off above ₹149', tag:'Certified organic · Farm direct',
      items:[
        { id:'o1', name:'Organic Tomatoes', qty:'500 g', price:38, mrp:52, emoji:'🍅', veg:true },
        { id:'o2', name:'Desi Cow A2 Milk', qty:'500 ml', price:45, mrp:52, emoji:'🥛', veg:true, bestseller:true },
        { id:'o3', name:'Cold-Pressed Groundnut Oil', qty:'1 L', price:340, mrp:399, emoji:'🫙', veg:true },
        { id:'o4', name:'Organic Jaggery Powder', qty:'500 g', price:95, mrp:120, emoji:'🟤', veg:true },
        { id:'o5', name:'Native Red Rice', qty:'1 kg', price:145, mrp:180, emoji:'🍚', veg:true, bestseller:true },
        { id:'o6', name:'Forest Raw Honey', qty:'250 g', price:260, mrp:320, emoji:'🍯', veg:true },
        { id:'o7', name:'Organic Moong Dal', qty:'500 g', price:92, mrp:110, emoji:'🫘', veg:true },
        { id:'o8', name:'Wood-Pressed Ghee', qty:'250 ml', price:390, mrp:450, emoji:'🧈', veg:true }
      ]},
    { id:'sh2', name:'Sharma Kirana & General', type:'grocery', emoji:'🛒', grad:['#0F3B21','#1A5632'],
      rating:4.4, ratings:'5.4K', km:0.2, time:9, open:true, delivery:'partner', veg:true,
      offer:'Free delivery above ₹199', tag:'Your neighbourhood kirana since 1998',
      items:[
        { id:'k1', name:'Toned Milk', qty:'500 ml', price:29, mrp:31, emoji:'🥛', veg:true, bestseller:true },
        { id:'k2', name:'Farm Eggs', qty:'6 pcs', price:48, mrp:56, emoji:'🥚' },
        { id:'k3', name:'Multigrain Bread', qty:'400 g', price:52, mrp:60, emoji:'🍞', veg:true },
        { id:'k4', name:'Basmati Rice', qty:'1 kg', price:145, mrp:170, emoji:'🌾', veg:true },
        { id:'k5', name:'Whole Wheat Atta', qty:'5 kg', price:240, mrp:270, emoji:'🫓', veg:true, bestseller:true },
        { id:'k6', name:'Sunflower Oil', qty:'1 L', price:135, mrp:155, emoji:'🌻', veg:true },
        { id:'k7', name:'Potato Chips Salted', qty:'80 g', price:30, mrp:35, emoji:'🥔', veg:true },
        { id:'k8', name:'Instant Noodles (4 pack)', qty:'280 g', price:58, mrp:64, emoji:'🍜', veg:true },
        { id:'k9', name:'Iodised Salt', qty:'1 kg', price:24, mrp:28, emoji:'🧂', veg:true },
        { id:'k10', name:'Dish Wash Gel', qty:'500 ml', price:99, mrp:115, emoji:'🧴', veg:true }
      ]},
    { id:'sh3', name:'Biryani Junction', type:'food', emoji:'🍛', grad:['#0F3B21','#1A5632'],
      rating:4.5, ratings:'12K', km:1.1, time:28, open:true, delivery:'partner', veg:false,
      offer:'FOOD50 — ₹50 off above ₹299', tag:'Dum biryani · Kebabs · Since 1996',
      items:[
        { id:'f1', name:'Hyderabadi Chicken Biryani', qty:'Serves 1', price:289, emoji:'🍛', veg:false, bestseller:true, desc:'Slow-cooked dum style with saffron rice.' },
        { id:'f2', name:'Veg Dum Biryani', qty:'Serves 1', price:219, emoji:'🥘', veg:true, desc:'Garden vegetables layered with basmati.' },
        { id:'f3', name:'Mutton Biryani', qty:'Serves 1', price:349, emoji:'🍖', veg:false, bestseller:true, desc:'Tender mutton, whole spices, salan & raita.' },
        { id:'f4', name:'Chicken 65', qty:'8 pcs', price:189, emoji:'🍗', veg:false, desc:'Fiery fried chicken, curry leaves & chilli.' },
        { id:'f5', name:'Phirni', qty:'1 cup', price:99, emoji:'🍮', veg:true, desc:'Chilled rice pudding, cardamom, pistachio.' }
      ]},
    { id:'sh4', name:'Dakshin Tiffins', type:'food', emoji:'🥞', grad:['#0F3B21','#1A5632'],
      rating:4.6, ratings:'15K', km:0.7, time:20, open:true, delivery:'self', veg:true,
      offer:'20% off up to ₹120', tag:'Pure veg · Delivers itself',
      items:[
        { id:'f6', name:'Ghee Podi Dosa', qty:'1 pc', price:149, emoji:'🥞', veg:true, bestseller:true, desc:'Crisp dosa, gunpowder & ghee, chutney trio.' },
        { id:'f7', name:'Idli Sambar', qty:'4 pcs', price:99, emoji:'🍥', veg:true, desc:'Steamed soft idlis with hot sambar.' },
        { id:'f8', name:'Mysore Masala Dosa', qty:'1 pc', price:169, emoji:'🌯', veg:true, bestseller:true, desc:'Red-chutney dosa with potato masala.' },
        { id:'f9', name:'Curd Rice', qty:'Serves 1', price:89, emoji:'🍚', veg:true, desc:'Tempered curd rice with pomegranate.' },
        { id:'f10', name:'Filter Coffee', qty:'180 ml', price:49, emoji:'☕', veg:true, desc:'Frothy decoction coffee, davara set.' }
      ]},
    { id:'sh5', name:'Burger Republic', type:'food', emoji:'🍔', grad:['#0F3B21','#1A5632'],
      rating:4.4, ratings:'10K', km:1.8, time:24, open:true, delivery:'partner', veg:false,
      offer:'Free fries above ₹399', tag:'Smashed patties · Hand-spun shakes',
      items:[
        { id:'f11', name:'Smash Stack Double', qty:'1 pc', price:279, emoji:'🍔', veg:false, bestseller:true, desc:'Two smashed patties, cheddar, house sauce.' },
        { id:'f12', name:'Crispy Paneer Royale', qty:'1 pc', price:219, emoji:'🍔', veg:true, desc:'Crunchy paneer, mint mayo, pickled onion.' },
        { id:'f13', name:'Peri Peri Fries', qty:'Regular', price:129, emoji:'🍟', veg:true, bestseller:true, desc:'Skin-on fries dusted with peri peri.' },
        { id:'f14', name:'Thick Oreo Shake', qty:'400 ml', price:169, emoji:'🥤', veg:true, desc:'Hand-spun shake with crushed cookies.' }
      ]},
    { id:'sh6', name:'Sanjeevani Medicals', type:'pharmacy', emoji:'💊', grad:['#0F3B21','#1A5632'],
      rating:4.8, ratings:'3.2K', km:0.5, time:14, open:true, delivery:'both', veg:true,
      offer:'15% off on wellness', tag:'Licensed pharmacy · Open till 11 pm',
      items:[
        { id:'p1', name:'Paracetamol 650', qty:'15 tabs', price:32, mrp:38, emoji:'💊', bestseller:true },
        { id:'p2', name:'Vitamin C + Zinc', qty:'30 tabs', price:180, mrp:220, emoji:'🍊' },
        { id:'p3', name:'Antiseptic Liquid', qty:'250 ml', price:98, mrp:110, emoji:'🧴' },
        { id:'p4', name:'Digital Thermometer', qty:'1 pc', price:199, mrp:280, emoji:'🌡️' },
        { id:'p5', name:'Band-Aid Strips', qty:'20 pcs', price:45, mrp:55, emoji:'🩹' },
        { id:'p6', name:'ORS Sachets', qty:'5 pcs', price:60, mrp:70, emoji:'🥤' }
      ]},
    { id:'sh7', name:'Threads of Bharat', type:'fashion', emoji:'👗', grad:['#0F3B21','#1A5632'],
      rating:4.5, ratings:'1.8K', km:2.3, time:35, open:true, delivery:'self', veg:true,
      offer:'Flat 30% off festive wear', tag:'Handloom · Local weavers',
      items:[
        { id:'t1', name:'Handloom Cotton Kurta', qty:'M–XXL', price:899, mrp:1400, emoji:'👕', bestseller:true },
        { id:'t2', name:'Ikat Print Saree', qty:'6.3 m', price:1650, mrp:2400, emoji:'🥻', bestseller:true },
        { id:'t3', name:'Kolhapuri Chappals', qty:'UK 6–10', price:749, mrp:1100, emoji:'🩴' },
        { id:'t4', name:'Block-Print Dupatta', qty:'2.4 m', price:499, mrp:750, emoji:'🧣' },
        { id:'t5', name:'Nehru Jacket', qty:'M–XL', price:1299, mrp:1900, emoji:'🧥' }
      ]},
    { id:'sh8', name:'Voltify Electronics', type:'electronics', emoji:'🔌', grad:['#0F3B21','#1A5632'],
      rating:4.3, ratings:'4.6K', km:1.4, time:26, open:true, delivery:'both', veg:true,
      offer:'SAVE100 — ₹100 off above ₹999', tag:'Genuine products · GST billing',
      items:[
        { id:'e1', name:'AeroBuds Pro ANC Earbuds', qty:'1 unit', price:2999, mrp:5999, emoji:'🎧', bestseller:true },
        { id:'e2', name:'Pulse X2 Smartwatch', qty:'1 unit', price:4499, mrp:7999, emoji:'⌚' },
        { id:'e3', name:'65W GaN Fast Charger', qty:'1 unit', price:1299, mrp:2499, emoji:'🔌', bestseller:true },
        { id:'e4', name:'Smart LED Strip 5 m', qty:'1 unit', price:999, mrp:1799, emoji:'🌈' },
        { id:'e5', name:'Bluetooth Speaker 16W', qty:'1 unit', price:1899, mrp:3299, emoji:'🔊' },
        { id:'e6', name:'Power Bank 20000 mAh', qty:'1 unit', price:1599, mrp:2799, emoji:'🔋' }
      ]},
    { id:'sh9', name:'Glaze & Crumb Bakery', type:'food', emoji:'🍰', grad:['#0F3B21','#1A5632'],
      rating:4.7, ratings:'5K', km:0.9, time:18, open:true, delivery:'both', veg:true,
      offer:'Dessert combo at ₹199', tag:'Fresh bakes every 4 hours',
      items:[
        { id:'b1', name:'Belgian Truffle Pastry', qty:'1 pc', price:139, emoji:'🍰', veg:true, bestseller:true, desc:'Dark chocolate layers, truffle ganache.' },
        { id:'b2', name:'Blueberry Cheesecake', qty:'1 slice', price:179, emoji:'🫐', veg:true, desc:'Baked NY style, blueberry compote.' },
        { id:'b3', name:'Choco Lava Cake', qty:'1 pc', price:119, emoji:'🍫', veg:true, desc:'Molten-centre cake, served warm.' },
        { id:'b4', name:'Fresh Fruit Cake 500g', qty:'500 g', price:449, emoji:'🎂', veg:true, bestseller:true, desc:'Seasonal fruits on vanilla sponge.' }
      ]},
    { id:'sh10', name:'Pushpa Flower Mart', type:'flowers', emoji:'💐', grad:['#0F3B21','#1A5632'],
      rating:4.6, ratings:'980', km:0.6, time:15, open:true, delivery:'partner', veg:true,
      offer:'Same-hour delivery', tag:'Temple fresh · Event decor',
      items:[
        { id:'fl1', name:'Marigold Garland', qty:'1 m', price:60, emoji:'🌼', bestseller:true },
        { id:'fl2', name:'Rose Bouquet (12)', qty:'12 stems', price:349, mrp:450, emoji:'🌹', bestseller:true },
        { id:'fl3', name:'Jasmine Gajra', qty:'1 pc', price:40, emoji:'🤍' },
        { id:'fl4', name:'Lotus (5)', qty:'5 stems', price:120, emoji:'🪷' },
        { id:'fl5', name:'Mixed Basket Deluxe', qty:'1 pc', price:799, mrp:999, emoji:'💐' }
      ]},
    { id:'sh11', name:'AgroHarvest Wholesale', type:'wholesale', emoji:'🏭', grad:['#0F3B21','#1A5632'],
      rating:4.4, ratings:'2.1K', km:3.8, time:120, open:true, delivery:'self', veg:true, b2b:true,
      offer:'GST invoice · Credit for regulars', tag:'Bulk grains & spices · MOQ pricing',
      items:[
        { id:'w1', name:'Chana Dal (Sortex)', qty:'per kg', price:74, moq:100, emoji:'🫘', bestseller:true },
        { id:'w2', name:'Turmeric Fingers Salem', qty:'per kg', price:118, moq:50, emoji:'🟡' },
        { id:'w3', name:'Raw Peanuts Bold 80/90', qty:'per kg', price:96, moq:200, emoji:'🥜' },
        { id:'w4', name:'Basmati 1121 Steam', qty:'per kg', price:98, moq:100, emoji:'🌾', bestseller:true },
        { id:'w5', name:'Kashmiri Chilli Whole', qty:'per kg', price:310, moq:25, emoji:'🌶️' }
      ]},
    { id:'sh12', name:'PackWell Traders', type:'wholesale', emoji:'📦', grad:['#0F3B21','#1A5632'],
      rating:4.6, ratings:'1.4K', km:4.5, time:180, open:true, delivery:'both', veg:true, b2b:true,
      offer:'Custom printing available', tag:'Packaging for shops & sellers · MOQ pricing',
      items:[
        { id:'w6', name:'Kraft Paper Bags (printed)', qty:'per pc', price:6.5, moq:500, emoji:'🛍️', bestseller:true },
        { id:'w7', name:'Corrugated Boxes 5-ply', qty:'per pc', price:22, moq:100, emoji:'📦' },
        { id:'w8', name:'Food Containers 500 ml', qty:'per pc', price:4.8, moq:500, emoji:'🥡', bestseller:true },
        { id:'w9', name:'BOPP Tape Rolls', qty:'per pc', price:38, moq:72, emoji:'🎗️' }
      ]},
    { id:'sh13', name:'Green Bowl Co.', type:'food', emoji:'🥗', grad:['#0F3B21','#1A5632'],
      rating:4.5, ratings:'4K', km:1.6, time:21, open:true, delivery:'partner', veg:true,
      offer:'Free smoothie above ₹499', tag:'Salads · Bowls · No refined sugar',
      items:[
        { id:'f15', name:'Buddha Grain Bowl', qty:'Serves 1', price:299, emoji:'🥗', veg:true, bestseller:true, desc:'Quinoa, roasted veg, hummus, seed crunch.' },
        { id:'f16', name:'Grilled Chicken Bowl', qty:'Serves 1', price:349, emoji:'🍗', veg:false, desc:'Herb chicken, brown rice, charred broccoli.' },
        { id:'f17', name:'Berry Blast Smoothie', qty:'400 ml', price:189, emoji:'🫐', veg:true, desc:'Mixed berries, yogurt, chia — no added sugar.' }
      ]},
    { id:'sh14', name:'Kitab Corner', type:'fashion', emoji:'📚', grad:['#0F3B21','#1A5632'],
      rating:4.8, ratings:'760', km:1.2, time:22, open:false, delivery:'self', veg:true,
      offer:'Old books exchange', tag:'Books & stationery · Opens 10 am',
      items:[
        { id:'bk1', name:'The Deep Work Playbook', qty:'Hardcover', price:399, mrp:599, emoji:'📘', bestseller:true },
        { id:'bk2', name:'Atlas of Wild Places', qty:'Hardbound', price:1299, mrp:1899, emoji:'🗺️' },
        { id:'bk3', name:'A5 Dot-Grid Journal', qty:'180 pages', price:249, mrp:350, emoji:'📓' },
        { id:'bk4', name:'Fountain Pen Classic', qty:'1 pc', price:450, mrp:600, emoji:'🖋️' }
      ]}
  ],

  /* ---------- SAVED / POPULAR PLACES ---------- */
  places: [
    { id:'home', name:'Home',            sub:'42 Lakeview Residency, Mukherjee Nagar', icon:'🏠', km:0,   lat:28.7157, lng:77.2085 },
    { id:'work', name:'Office',          sub:'Tower B, Cyber Park, Gurugram',     icon:'💼', km:24.5, lat:28.4995, lng:77.0890 },
    { id:'p1',   name:'Central Mall',    sub:'Select Citywalk, Saket',            icon:'🛍️', km:18.9, lat:28.5285, lng:77.2195 },
    { id:'p2',   name:'City Airport',    sub:'Terminal 3, IGI Airport',           icon:'✈️', km:22.4, lat:28.5562, lng:77.1000 },
    { id:'p3',   name:'Railway Station', sub:'New Delhi Railway Station',         icon:'🚉', km:9.8,  lat:28.6425, lng:77.2205 },
    { id:'p4',   name:'Lakeside Park',   sub:'Naini Lake, Model Town',            icon:'🌳', km:3.4,  lat:28.7025, lng:77.1935 },
    { id:'p5',   name:'Grandma’s House', sub:'Flat 302, Shanti Kunj, GTB Nagar', icon:'👵', km:2.1,  lat:28.6985, lng:77.2075 },
    { id:'p6',   name:'Uni Campus',      sub:'North Campus, Delhi University',    icon:'🎓', km:2.8,  lat:28.6889, lng:77.2094 }
  ],

  /* ---------- VEHICLES (rides + partner network) ---------- */
  vehicles: [
    { id:'walk',  name:'On Foot',  emoji:'🚶', seats:0, base:0,  perKm:0,  eta:0, carry:'Tiffin, documents, small packets', maxKm:2 },
    { id:'cycle', name:'Cycle',    emoji:'🚲', seats:0, base:0,  perKm:0,  eta:0, carry:'Up to 5 kg — bags, parcels',       maxKm:5 },
    { id:'bike',  name:'Bike',     emoji:'🏍️', seats:1, base:15, perKm:6,  eta:2, carry:'Up to 15 kg — food, boxes',         maxKm:30, ride:true, desc:'Beat the traffic' },
    { id:'auto',  name:'Auto',     emoji:'🛺', seats:3, base:25, perKm:9,  eta:3, carry:'Up to 100 kg — crates, appliances', maxKm:30, ride:true, desc:'Fixed fare, no haggling' },
    { id:'car',   name:'Car',      emoji:'🚗', seats:4, base:40, perKm:12, eta:4, carry:'Up to 200 kg — bulk orders',        maxKm:60, ride:true, desc:'Compact & comfy' },
    { id:'van',   name:'Van/Tempo',emoji:'🚐', seats:2, base:90, perKm:21, eta:8, carry:'Up to 750 kg — furniture, stock',   maxKm:100, ride:true, desc:'For the big stuff' },
    { id:'truck', name:'Truck',    emoji:'🚛', seats:2, base:250,perKm:38, eta:15,carry:'750 kg+ — wholesale, shifting',     maxKm:500 }
  ],

  partners: [
    { name:'Rohit Kumar', rating:4.9, trips:4820, car:'Maruti WagonR',  veh:'DL 1C AB 1234' },
    { name:'Sunita P.',   rating:4.8, trips:3204, car:'Honda Activa',   veh:'DL 3S HD 9034' },
    { name:'Amit S.',     rating:4.9, trips:6110, car:'Bajaj RE Auto',  veh:'DL 1R AB 2260' },
    { name:'Farhan M.',   rating:4.7, trips:2141, car:'TVS Jupiter',    veh:'DL 5S QT 7745' },
    { name:'Deepak R.',   rating:4.9, trips:5480, car:'Tata Ace',       veh:'DL 1L ZZ 1180' },
    { name:'Manju N.',    rating:4.8, trips:3890, car:'Hero Splendor',  veh:'DL 9S CD 6412' }
  ],

  /* ---------- PARCEL TYPES (Send Anything) ---------- */
  parcelTypes: [
    { id:'tiffin', name:'Tiffin / Food', emoji:'🍱', fits:['walk','cycle','bike'] },
    { id:'docs',   name:'Documents',     emoji:'📄', fits:['walk','cycle','bike'] },
    { id:'meds',   name:'Medicines',     emoji:'💊', fits:['walk','cycle','bike'] },
    { id:'small',  name:'Small Parcel',  emoji:'📦', fits:['cycle','bike','auto'] },
    { id:'bag',    name:'Bag / Suitcase',emoji:'🧳', fits:['bike','auto','car'] },
    { id:'crate',  name:'Crate / Bulk',  emoji:'🧺', fits:['auto','car','van'] },
    { id:'furn',   name:'Furniture',     emoji:'🪑', fits:['van','truck'] },
    { id:'heavy',  name:'Heavy Load',    emoji:'🏗️', fits:['truck'] }
  ],

  /* ---------- SEED JOBS for the Earn feed ---------- */
  seedJobs: [
    { id:'j1', what:'Tiffin box for grandma', type:'tiffin', from:'42 Lakeview Residency', to:'Shanti Kunj, Sector 9', km:2.1, pay:35, by:'Asha Aunty', note:'Warm lunch — please deliver before 1 pm' },
    { id:'j2', what:'Order #-- · Biryani Junction', type:'small', from:'Biryani Junction', to:'Cyber Park, Phase 3', km:3.4, pay:52, by:'Shop order', note:'2 items · Keep upright' },
    { id:'j3', what:'College documents', type:'docs', from:'Uni Campus, Main Block', to:'Notary Office, MG Road', km:4.2, pay:60, by:'Rahul S.', note:'Envelope, signature needed on delivery' },
    { id:'j4', what:'Medicines for elderly', type:'meds', from:'Sanjeevani Medicals', to:'Green Meadows, Sector 15', km:1.8, pay:30, by:'Shop order', note:'Prescription attached · Priority' },
    { id:'j5', what:'Birthday cake (handle flat)', type:'small', from:'Glaze & Crumb Bakery', to:'Lakeside Park, North Gate', km:2.6, pay:45, by:'Shop order', note:'Fragile! Surprise at 5 pm 🎂' },
    { id:'j6', what:'Fresh flowers garlands', type:'small', from:'Pushpa Flower Mart', to:'Shiva Temple, Old Town', km:1.2, pay:28, by:'Shop order', note:'Morning pooja — before 8 am' },
    { id:'j7', what:'House keys (forgot!)', type:'docs', from:'Tower B, Cyber Park', to:'42 Lakeview Residency', km:8.4, pay:95, by:'Priya M.', note:'Urgent — locked out 🙏' },
    { id:'j8', what:'2 sarees for alteration', type:'bag', from:'Threads of Bharat', to:'Meena Tailors, Sector 4', km:1.5, pay:32, by:'Shop order', note:'Pick from counter 2' },
    { id:'j9', what:'Wholesale rice bags (4 × 25 kg)', type:'crate', from:'AgroHarvest Wholesale', to:'Sharma Kirana, Sector 12', km:3.7, pay:140, by:'Shop order', note:'Need auto/car boot space' },
    { id:'j10', what:'Old sofa to new flat', type:'furn', from:'Green Meadows, Sector 15', to:'Palm Grove, Sector 21', km:5.5, pay:420, by:'Vikram T.', note:'2 people at both ends to help load' },
    { id:'j11', what:'Laptop for repair', type:'small', from:'Voltify Electronics', to:'Tower B, Cyber Park', km:2.9, pay:48, by:'Shop order', note:'Sleeve provided · Handle gently' },
    { id:'j12', what:'Homemade pickle jars (3)', type:'small', from:'Shanti Kunj, Sector 9', to:'Uni Campus Hostel', km:5.8, pay:70, by:'Lakshmi Amma', note:'Glass jars — bubble wrapped' }
  ],

  /* ---------- STORE THEMES (Your Shop) ---------- */
  storeThemes: [
    { id:'mint', name:'Mint Fresh', bg:'#f0fdf4', ink:'#14532d', accent:'#1A5632', desc:'Clean & organic' },
    { id:'noir', name:'Noir Luxe',  bg:'#101014', ink:'#f4f2ee', accent:'#d4af37', desc:'Premium boutique' },
    { id:'sun',  name:'Sunset Pop', bg:'#fff7ed', ink:'#431407', accent:'#f97316', desc:'Warm & playful' }
  ],

  /* ---------- COUPONS ---------- */
  coupons: {
    'FOOD50':  { off:50,  min:299, label:'₹50 off on orders above ₹299' },
    'FRESH20': { off:20,  min:149, label:'₹20 off on orders above ₹149' },
    'SAVE100': { off:100, min:999, label:'₹100 off on orders above ₹999' },
    'RIDE25':  { off:25,  min:99,  label:'₹25 off on rides above ₹99' }
  },

  firstNames: ['Arjun','Meera','Kabir','Ananya','Rohan','Zoya','Ishaan','Diya','Aditya','Sara'],

  /* ---------- REAL PHOTOGRAPHY (online; falls back to brand tile offline) ---------- */
  shopImgs: {
    sh1:'https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&q=60&auto=format&fit=crop',
    sh2:'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=800&q=60&auto=format&fit=crop',
    sh3:'https://images.unsplash.com/photo-1563379091339-03246963d51a?w=800&q=60&auto=format&fit=crop',
    sh4:'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?w=800&q=60&auto=format&fit=crop',
    sh5:'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&q=60&auto=format&fit=crop',
    sh6:'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=800&q=60&auto=format&fit=crop',
    sh7:'https://images.unsplash.com/photo-1445205170230-053b83016050?w=800&q=60&auto=format&fit=crop',
    sh8:'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=800&q=60&auto=format&fit=crop',
    sh9:'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800&q=60&auto=format&fit=crop',
    sh10:'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=800&q=60&auto=format&fit=crop',
    sh11:'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=800&q=60&auto=format&fit=crop',
    sh12:'https://images.unsplash.com/photo-1607166452427-7e4477079cb9?w=800&q=60&auto=format&fit=crop',
    sh13:'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&q=60&auto=format&fit=crop',
    sh14:'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=800&q=60&auto=format&fit=crop'
  },

  /* ---------- MOVIES (invented titles — no real brands) ---------- */
  movies: [
    { id:'mv1', title:'Monsoon Express', genre:'Action · Thriller', lang:'Hindi', cert:'UA', mins:148, rating:8.4, votes:'42K',
      grad:['#0F3B21','#1A5632'], tag:'IMAX · 2D', times:['10:15 AM','1:30 PM','6:30 PM','9:45 PM'],
      about:'A railway cop races a cyclone and a conspiracy across 1,400 km of flooded tracks.' },
    { id:'mv2', title:'Dil Ki Gali', genre:'Romance · Drama', lang:'Hindi', cert:'U', mins:136, rating:7.9, votes:'28K',
      grad:['#0F3B21','#1A5632'], tag:'2D', times:['11:00 AM','2:15 PM','7:00 PM','10:15 PM'],
      about:'Two street food rivals in Old Delhi discover their grandmothers were once best friends.' },
    { id:'mv3', title:'Project Garuda', genre:'Sci-Fi · Adventure', lang:'Hindi · Eng', cert:'UA', mins:162, rating:8.9, votes:'71K',
      grad:['#0F3B21','#1A5632'], tag:'3D · IMAX', times:['9:30 AM','12:45 PM','4:30 PM','8:30 PM'],
      about:'India\'s first deep-space rescue — a lone pilot, a failing station, ninety minutes of orbit left.' },
    { id:'mv4', title:'Chhota Champion', genre:'Family · Sports', lang:'Hindi', cert:'U', mins:124, rating:8.1, votes:'19K',
      grad:['#0F3B21','#1A5632'], tag:'2D', times:['10:00 AM','1:00 PM','5:15 PM','8:00 PM'],
      about:'A 12-year-old kabaddi prodigy takes her village team to the national finals.' },
    { id:'mv5', title:'The Silent Ledger', genre:'Crime · Mystery', lang:'English', cert:'A', mins:141, rating:8.6, votes:'33K',
      grad:['#0F3B21','#1A5632'], tag:'2D · Dolby', times:['12:00 PM','3:30 PM','7:45 PM','10:45 PM'],
      about:'A forensic accountant finds one rupee that shouldn\'t exist — and unravels a billion.' },
    { id:'mv6', title:'Raag & Rhythm', genre:'Musical · Drama', lang:'Tamil · Hindi', cert:'U', mins:152, rating:8.2, votes:'24K',
      grad:['#0F3B21','#1A5632'], tag:'2D', times:['11:30 AM','3:00 PM','6:45 PM','9:30 PM'],
      about:'A classical vocalist and a street rapper are forced to compose one song together.' }
  ],

  /* ---------- EVENTS ---------- */
  events: [
    { id:'ev1', title:'Laugh Riot — Standup Night', cat:'Comedy', venue:'The Attic, MG Road', when:'Sat, 8:00 PM', price:499,
      img:'https://images.unsplash.com/photo-1527224857830-43a7acc85260?w=800&q=60&auto=format&fit=crop', grad:['#0F3B21','#1A5632'],
      about:'90 minutes, 4 comics, zero mercy. Age 16+.' },
    { id:'ev2', title:'Indie Sundowner Concert', cat:'Music', venue:'Lakeside Amphitheatre', when:'Sun, 5:30 PM', price:799,
      img:'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=60&auto=format&fit=crop', grad:['#0F3B21','#1A5632'],
      about:'5 indie bands, open lawns, food trucks by the lake.' },
    { id:'ev3', title:'Big Match — Giant Screening', cat:'Sports', venue:'Grand Stadium, Gate 4', when:'Sat, 7:00 PM', price:299,
      img:'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?w=800&q=60&auto=format&fit=crop', grad:['#0F3B21','#1A5632'],
      about:'The final, on a 60-ft screen, with 5,000 fans.' },
    { id:'ev4', title:'Street Food Carnival', cat:'Food Fest', venue:'Central Mall Grounds', when:'Sat–Sun, 12 PM on', price:199,
      img:'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=60&auto=format&fit=crop', grad:['#0F3B21','#1A5632'],
      about:'60 stalls, 12 states, one entry band. Kids free.' }
  ],

  /* ---------- MEGA CATEGORY DIRECTORY — sell everything ---------- */
  megaCats: [
    { name:'Groceries & Staples', icon:'cart', subs:['Atta & Rice','Oils & Ghee','Dals & Pulses','Spices','Snacks','Beverages'] },
    { name:'Fruits & Vegetables', icon:'leaf', subs:['Fresh Vegetables','Fresh Fruits','Organic Produce','Exotic Veggies','Herbs'] },
    { name:'Food & Restaurants', icon:'bowl', subs:['Biryani','Pizza & Burgers','South Indian','North Indian','Chinese','Desserts'] },
    { name:'Medicines & Wellness', icon:'cross', subs:['OTC Medicines','Vitamins','Devices','Ayurveda','Baby Care','Elder Care'] },
    { name:'Fashion & Apparel', icon:'shirt', subs:['Men','Women','Kids','Handloom & Ethnic','Footwear','Accessories'] },
    { name:'Electronics & Appliances', icon:'plug', subs:['Mobiles & Audio','Wearables','Kitchen Appliances','Lighting','Computers','Accessories'] },
    { name:'Home & Furniture', icon:'sofa', subs:['Furniture','Decor','Kitchenware','Bedding','Storage','Cleaning'] },
    { name:'Books & Stationery', icon:'book', subs:['Books','Notebooks','Pens','Office Supplies','Art & Craft'] },
    { name:'Flowers & Gifting', icon:'flower', subs:['Garlands','Bouquets','Pooja Needs','Gift Baskets','Event Decor'] },
    { name:'Construction Material', icon:'factory', subs:['Cement & Bricks','TMT Bars','Plywood','Paints','Pipes & Fittings','Doors'] },
    { name:'Industrial & Machinery', icon:'weight', subs:['Food Processing','Packaging Machines','Compressors','CNC & Lathe','Printing','Pumps'] },
    { name:'Packaging & Printing', icon:'box', subs:['Boxes & Cartons','Paper Bags','Labels & Tapes','Food Containers','Custom Print'] },
    { name:'Agriculture & Farm', icon:'leaf', subs:['Seeds','Fertilizers','Tools','Irrigation','Grains Bulk','Animal Feed'] },
    { name:'Auto Parts & Service', icon:'car', subs:['Two-wheeler Parts','Car Care','Batteries','Tyres','Lubricants'] },
    { name:'Textiles Wholesale', icon:'shirt', subs:['Cotton Fabric','Rayon & Prints','Denim','Sarees Bulk','Yarn'] },
    { name:'Logistics & Transport', icon:'truck', subs:['Send a Parcel','Bulk Freight','Truck Hire','Packers & Movers','Cold Chain'] }
  ],

  /* ---------- PROPERTY (buy · rent · plots · commercial) ---------- */
  properties: [
    { id:'pr1', kind:'buy', title:'3 BHK Lakeview Apartment', loc:'Sector 12, Lakeview', price:8250000, area:'1,480 sq.ft', bhk:'3 BHK', by:'Owner', verified:true, lat:26.155, lng:91.77,
      img:'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=60&auto=format&fit=crop', tags:['East facing','2 balconies','Covered parking'] },
    { id:'pr2', kind:'rent', title:'2 BHK Semi-furnished Flat', loc:'Palm Grove, Sector 21', price:18500, area:'980 sq.ft', bhk:'2 BHK', by:'Owner', verified:true, lat:26.148, lng:91.78,
      img:'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&q=60&auto=format&fit=crop', tags:['Family preferred','₹40k deposit','Lift + power backup'] },
    { id:'pr3', kind:'buy', title:'4 BHK Independent Villa', loc:'Green Meadows, Sector 15', price:21500000, area:'3,200 sq.ft', bhk:'4 BHK', by:'Dealer', verified:true, lat:26.14, lng:91.75,
      img:'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=60&auto=format&fit=crop', tags:['Private garden','Modular kitchen','Gated society'] },
    { id:'pr4', kind:'plot', title:'Residential Plot 2,400 sq.ft', loc:'Ring Road Extension', price:3600000, area:'2,400 sq.ft', bhk:'Plot', by:'Owner', verified:false, lat:26.13, lng:91.79,
      img:'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=60&auto=format&fit=crop', tags:['Corner plot','Clear title','40 ft road'] },
    { id:'pr5', kind:'rent', title:'1 RK Studio near Uni', loc:'Knowledge Ave, Campus Rd', price:9000, area:'420 sq.ft', bhk:'1 RK', by:'Owner', verified:true, lat:26.16, lng:91.76,
      img:'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=60&auto=format&fit=crop', tags:['Students ok','Furnished','WiFi included'] },
    { id:'pr6', kind:'commercial', title:'Shop Space 650 sq.ft, Main Market', loc:'MG Road, City Centre', price:85000, area:'650 sq.ft', bhk:'Retail', by:'Dealer', verified:true, lat:26.152, lng:91.772,
      img:'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=60&auto=format&fit=crop', tags:['High footfall','Frontage 18 ft','Rent/month'] },
    { id:'pr7', kind:'commercial', title:'Warehouse 8,000 sq.ft + Dock', loc:'Industrial Phase 3', price:220000, area:'8,000 sq.ft', bhk:'Godown', by:'Dealer', verified:true, lat:26.12, lng:91.8,
      img:'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&q=60&auto=format&fit=crop', tags:['Truck access','Power 60 kVA','Rent/month'] },
    { id:'pr8', kind:'plot', title:'Farm Land 1.2 Acre (Organic-ready)', loc:'Village Belt, North', price:5400000, area:'1.2 acre', bhk:'Agri', by:'Owner', verified:true, lat:26.19, lng:91.74,
      img:'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=800&q=60&auto=format&fit=crop', tags:['Borewell','Road touch','Natural farming ready'] }
  ],

  /* ---------- HOTELS & STAYS ---------- */
  hotels: [
    { id:'ht0', name:'Sunlit Studio near DU', loc:'Kingsway Camp · 10 min to campus', price:1800, rating:4.9, ratings:'214', star:4,
      img:'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&q=60&auto=format&fit=crop', amen:['Entire studio','Kitchenette','Washing machine'],
      host:{ name:'Meera Sharma', since:2019 } },
    { id:'ht1', name:'Lakeview Residency Inn', loc:'Sector 12, near lake', price:1499, rating:4.3, ratings:'2.1K', star:3,
      img:'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=60&auto=format&fit=crop', amen:['Free WiFi','AC rooms','Breakfast','Parking'],
      host:{ name:'Rajan Mehta', since:2017 } },
    { id:'ht2', name:'The Cyber Suites', loc:'Cyber Park, Phase 3', price:2899, rating:4.6, ratings:'3.4K', star:4,
      img:'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&q=60&auto=format&fit=crop', amen:['Business desk','Gym','Restaurant','Airport cab'],
      host:{ name:'Cyber Suites Hotels', since:2015 } },
    { id:'ht3', name:'Budget Stay Express', loc:'Railway Station Rd', price:799, rating:4.0, ratings:'5.2K', star:2,
      img:'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&q=60&auto=format&fit=crop', amen:['24×7 check-in','Clean linen','UPI accepted'],
      host:{ name:'Ramesh Yadav', since:2018 } },
    { id:'ht4', name:'Heritage Haveli Stay', loc:'Old Town, Temple Rd', price:3499, rating:4.8, ratings:'980', star:4,
      img:'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&q=60&auto=format&fit=crop', amen:['Courtyard','Home food','Guided walks'],
      host:{ name:'Devika Rathore', since:2016 } },
    { id:'ht5', name:'Transit Pods — Airport', loc:'Terminal 2 walkway', price:999, rating:4.2, ratings:'1.7K', star:3,
      img:'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=800&q=60&auto=format&fit=crop', amen:['Hourly stays','Shower','Luggage locker'],
      host:{ name:'Transit Pods Ltd', since:2022 } },
    { id:'ht6', name:'Green Farms Eco Resort', loc:'Village Belt, North', price:4299, rating:4.7, ratings:'760', star:4,
      img:'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=60&auto=format&fit=crop', amen:['Organic kitchen','Pool','Bonfire','Farm tour'],
      host:{ name:'Baldev & Nirmala Singh', since:2014 } }
  ],

  dineSlots: ['12:30 PM','1:30 PM','7:00 PM','8:00 PM','9:00 PM'],
  seatTiers: [
    { id:'rec', name:'Recliner', rows:['A'], price:450 },
    { id:'prime', name:'Prime', rows:['B','C','D'], price:280 },
    { id:'classic', name:'Classic', rows:['E','F','G','H'], price:180 }
  ]
};
