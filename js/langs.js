/* ============================================================
   ORIGNALS WORLD LANGUAGES — Mitra speaks the world.
   • Script detection across ~all major writing systems.
   • Greetings + native names for the major languages so Mitra can
     ACKNOWLEDGE any language, even ones it isn't fully trained in.
   • A 250+ language registry for the super-admin "teach Mitra" panel.
   Partial understanding: detect the language → greet in it → attempt
   intent with the language-agnostic model → log it so an admin can
   train it on demand.
   ============================================================ */

/* Script → representative language. First match wins; order matters
   (Japanese kana before Han; Assamese disambiguated from Bengali). */
const WORLD_SCRIPTS = [
  { re: /[஀-௿]/, code: 'ta',  s: 'Tamil' },
  { re: /[ఀ-౿]/, code: 'te',  s: 'Telugu' },
  { re: /[ಀ-೿]/, code: 'kn',  s: 'Kannada' },
  { re: /[ഀ-ൿ]/, code: 'ml',  s: 'Malayalam' },
  { re: /[઀-૿]/, code: 'gu',  s: 'Gujarati' },
  { re: /[਀-੿]/, code: 'pa',  s: 'Gurmukhi' },
  { re: /[଀-୿]/, code: 'or',  s: 'Odia' },
  { re: /[᱐-᱿]/, code: 'sat', s: 'Ol Chiki' },
  { re: /[඀-෿]/, code: 'si',  s: 'Sinhala' },
  { re: /[ঀ-৿]/, code: 'bn',  s: 'Bengali' },
  { re: /[ऀ-ॿ]/, code: 'hi',  s: 'Devanagari' },
  { re: /[぀-ヿ]/, code: 'ja',  s: 'Japanese' },
  { re: /[가-힯]/, code: 'ko',  s: 'Hangul' },
  { re: /[一-鿿㐀-䶿]/, code: 'zh', s: 'Han' },
  { re: /[฀-๿]/, code: 'th',  s: 'Thai' },
  { re: /[຀-໿]/, code: 'lo',  s: 'Lao' },
  { re: /[ក-៿]/, code: 'km',  s: 'Khmer' },
  { re: /[က-႟]/, code: 'my',  s: 'Myanmar' },
  { re: /[ሀ-፿]/, code: 'am',  s: 'Ethiopic' },
  { re: /[ༀ-࿿]/, code: 'bo',  s: 'Tibetan' },
  { re: /[֐-׿]/, code: 'he',  s: 'Hebrew' },
  { re: /[؀-ۿݐ-ݿࢠ-ࣿ]/, code: 'ar', s: 'Arabic' },
  { re: /[Ѐ-ӿ]/, code: 'ru',  s: 'Cyrillic' },
  { re: /[Ͱ-Ͽἀ-῿]/, code: 'el', s: 'Greek' },
  { re: /[԰-֏]/, code: 'hy',  s: 'Armenian' },
  { re: /[Ⴀ-ჿ]/, code: 'ka',  s: 'Georgian' },
  { re: /[᐀-ᙿ]/, code: 'iu',  s: 'Canadian Syllabics' }
];

/* Greeting + native name for the major languages (for acknowledgement). */
const WORLD_LANGS = {
  en: { name: 'English',   native: 'English',    hello: 'Hello' },
  hi: { name: 'Hindi',     native: 'हिन्दी',      hello: 'नमस्ते' },
  as: { name: 'Assamese',  native: 'অসমীয়া',    hello: 'নমস্কাৰ' },
  bn: { name: 'Bengali',   native: 'বাংলা',      hello: 'নমস্কার' },
  gu: { name: 'Gujarati',  native: 'ગુજરાતી',    hello: 'નમસ્તે' },
  pa: { name: 'Punjabi',   native: 'ਪੰਜਾਬੀ',     hello: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ' },
  ta: { name: 'Tamil',     native: 'தமிழ்',      hello: 'வணக்கம்' },
  te: { name: 'Telugu',    native: 'తెలుగు',     hello: 'నమస్తే' },
  kn: { name: 'Kannada',   native: 'ಕನ್ನಡ',      hello: 'ನಮಸ್ಕಾರ' },
  ml: { name: 'Malayalam', native: 'മലയാളം',    hello: 'നമസ്കാരം' },
  or: { name: 'Odia',      native: 'ଓଡ଼ିଆ',       hello: 'ନମସ୍କାର' },
  sat:{ name: 'Santali',   native: 'ᱥᱟᱱᱛᱟᱲᱤ',    hello: 'ᱨᱟᱲᱟᱲ' },
  ur: { name: 'Urdu',      native: 'اردو',       hello: 'السلام علیکم' },
  si: { name: 'Sinhala',   native: 'සිංහල',      hello: 'ආයුබෝවන්' },
  ne: { name: 'Nepali',    native: 'नेपाली',      hello: 'नमस्ते' },
  ar: { name: 'Arabic',    native: 'العربية',    hello: 'مرحبا' },
  fa: { name: 'Persian',   native: 'فارسی',      hello: 'سلام' },
  he: { name: 'Hebrew',    native: 'עברית',      hello: 'שלום' },
  ru: { name: 'Russian',   native: 'Русский',    hello: 'Здравствуйте' },
  uk: { name: 'Ukrainian', native: 'Українська', hello: 'Привіт' },
  el: { name: 'Greek',     native: 'Ελληνικά',   hello: 'Γεια σας' },
  hy: { name: 'Armenian',  native: 'Հայերեն',    hello: 'Բարեւ' },
  ka: { name: 'Georgian',  native: 'ქართული',    hello: 'გამარჯობა' },
  th: { name: 'Thai',      native: 'ไทย',         hello: 'สวัสดี' },
  lo: { name: 'Lao',       native: 'ລາວ',         hello: 'ສະບາຍດີ' },
  km: { name: 'Khmer',     native: 'ខ្មែរ',       hello: 'សួស្តី' },
  my: { name: 'Burmese',   native: 'မြန်မာ',      hello: 'မင်္ဂလာပါ' },
  am: { name: 'Amharic',   native: 'አማርኛ',       hello: 'ሰላም' },
  bo: { name: 'Tibetan',   native: 'བོད་སྐད',     hello: 'བཀྲ་ཤིས་བདེ་ལེགས' },
  ja: { name: 'Japanese',  native: '日本語',       hello: 'こんにちは' },
  ko: { name: 'Korean',    native: '한국어',       hello: '안녕하세요' },
  zh: { name: 'Chinese',   native: '中文',         hello: '你好' },
  es: { name: 'Spanish',   native: 'Español',    hello: 'Hola' },
  fr: { name: 'French',    native: 'Français',   hello: 'Bonjour' },
  de: { name: 'German',    native: 'Deutsch',    hello: 'Hallo' },
  pt: { name: 'Portuguese',native: 'Português',  hello: 'Olá' },
  it: { name: 'Italian',   native: 'Italiano',   hello: 'Ciao' },
  id: { name: 'Indonesian',native: 'Bahasa',     hello: 'Halo' },
  vi: { name: 'Vietnamese',native: 'Tiếng Việt', hello: 'Xin chào' },
  tr: { name: 'Turkish',   native: 'Türkçe',     hello: 'Merhaba' },
  sw: { name: 'Swahili',   native: 'Kiswahili',  hello: 'Habari' },
  iu: { name: 'Inuktitut', native: 'ᐃᓄᒃᑎᑐᑦ',    hello: 'ᐊᐃ' }
};

/* Detect the language of a message → { code, name, native, hello, script, trained }.
   Latin text may be English or a romanised Indian language; we return 'en' as the
   umbrella and let the language-agnostic model handle intent. */
function mitraLangInfo(text) {
  const s = String(text || '');
  let code = 'en', script = 'Latin';
  for (const sc of WORLD_SCRIPTS) { if (sc.re.test(s)) { code = sc.code; script = sc.s; break; } }
  if (code === 'bn' && /অসম|গাখীৰ|আইতা|মোৰ|কৰোঁ|লাগে/.test(s)) code = 'as';
  const info = WORLD_LANGS[code] || { name: script, native: script, hello: 'Hello' };
  const trainedCodes = (typeof MITRA_LANGS !== 'undefined') ? MITRA_LANGS : { en: 1 };
  return { code, name: info.name, native: info.native, hello: info.hello, script, trained: !!trainedCodes[code] || code === 'en' };
}

/* 250+ language registry — names for the super-admin "teach Mitra" panel.
   Codes we can greet in carry a native+hello above; the rest are ready to
   be trained on demand (add phrases → they graduate to full support). */
const LANG_REGISTRY = 'Assamese,Awadhi,Bengali,Bhili,Bhojpuri,Bodo,Chhattisgarhi,Dogri,English,Garo,Gondi,Gujarati,Haryanvi,Hindi,Ho,Kannada,Kashmiri,Khasi,Kokborok,Konkani,Kutchi,Ladakhi,Magahi,Maithili,Malayalam,Manipuri,Marathi,Marwari,Mizo,Mundari,Nagamese,Nepali,Odia,Punjabi,Rajasthani,Sanskrit,Santali,Sindhi,Tamil,Telugu,Tulu,Urdu,Sinhala,Dhivehi,Dzongkha,Tibetan,'
+ 'Mandarin Chinese,Cantonese,Japanese,Korean,Vietnamese,Thai,Lao,Khmer,Burmese,Indonesian,Malay,Javanese,Sundanese,Tagalog,Cebuano,Ilocano,Hiligaynon,Waray,Kapampangan,Bikol,Mongolian,Uyghur,Kazakh,Kyrgyz,Uzbek,Turkmen,Tajik,Pashto,Dari,Persian,Kurdish,Balochi,'
+ 'Arabic,Hebrew,Amharic,Tigrinya,Oromo,Somali,Swahili,Hausa,Yoruba,Igbo,Fula,Zulu,Xhosa,Shona,Sesotho,Setswana,Kinyarwanda,Kirundi,Luganda,Lingala,Wolof,Bambara,Twi,Ewe,Kongo,Malagasy,'
+ 'Russian,Ukrainian,Belarusian,Polish,Czech,Slovak,Bulgarian,Serbian,Croatian,Bosnian,Slovenian,Macedonian,Romanian,Hungarian,Greek,Albanian,Armenian,Georgian,Azerbaijani,'
+ 'English,Spanish,Portuguese,French,German,Italian,Dutch,Danish,Swedish,Norwegian,Finnish,Icelandic,Irish,Welsh,Scottish Gaelic,Basque,Catalan,Galician,Estonian,Latvian,Lithuanian,Maltese,'
+ 'Quechua,Aymara,Guarani,Nahuatl,Maya,Haitian Creole,Papiamento,'
+ 'Samoan,Tongan,Fijian,Maori,Hawaiian,Tahitian,Chamorro,Tok Pisin,'
+ 'Esperanto,Chichewa,Kanuri,Tiv,Ibibio,Efik,Bemba,Tumbuka,Nyanja,Ganda,Kikuyu,Luo,Kamba,Meru,Sango,Kirghiz,Chuvash,Tatar,Bashkir,Yakut,Buryat,Kalmyk,Ossetian,Chechen,Avar,Lezgian,'
+ 'Frisian,Luxembourgish,Faroese,Sami,Breton,Cornish,Manx,Occitan,Sardinian,Corsican,Romansh,Walloon,'
+ 'Sylheti,Rohingya,Chittagonian,Rangpuri,Surjapuri,Angika,Bundeli,Malvi,Nimadi,Wagdi,Lambadi,Kodava,Beary,Saurashtra,Toda,Kota,Irula,Badaga,Kurukh,Kharia,Korku,Bhumij,Kui,Kuvi,Sora,Juang,Bonda,Didayi,Adi,Apatani,Nyishi,Galo,Mishing,Karbi,Dimasa,Rabha,Tiwa,Deori,Hmar,Paite,Thadou,Kom,Zeme,Liangmai,Tangkhun,Ao,Angami,Sema,Lotha,Konyak,Chang,Phom,Sangtam,Yimchunger,Chakhesang,Pochury,Khiamniungan,Zeliang,Rongmei,Maram,Poumai,Mao,Thangal,Anal,Lamkang,Moyon,Monsang,Chothe,Purum,Aimol,Chiru,Kharam,Koireng,Tarao,Sirmauri,Kinnauri,Lahauli,Pangi,Bhoti,Spiti,Sherpa,Tamang,Gurung,Magar,Rai,Limbu,Newari,Tharu,Bhutia,Lepcha,Toto,Rabha,Koch';

const LANG_LIST = (function () {
  const seen = {}; const out = [];
  LANG_REGISTRY.split(',').forEach(n => { n = n.trim(); const k = n.toLowerCase(); if (n && !seen[k]) { seen[k] = 1; out.push(n); } });
  return out;
})();
function langCount() { return LANG_LIST.length; }
