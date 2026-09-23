/*
  INGITO · ইঙ্গিত - the field instrument.

  A satellite instrument brought down to human scale. It connects two points of view:
    FROM ORBIT   what Sentinel-1's radar measured - the flood water, hatched cyan, with its sensor,
                 dates and limits attached.
    FROM GROUND  what the person standing there records - "water here", "road cut" - in red.
  Between them sits the real piece of Bangladesh: a Sentinel-2 photograph of the district with its
  rivers, villages, roads and shelters, all drawn from the pack on this device.

  Three jobs, in the order a responder needs them:
    1. Hold one disaster pack on the device and keep working when the network dies.
    2. Answer: where am I, which routes are under water, where is the nearest shelter.
    3. Send the operator's own observations back.

  Three kinds of information are never mixed: SATELLITE (the radar layer), REFERENCE (photo,
  terrain, roads, rivers, places, shelters) and FIELD (the operator's reports, stored and exported
  separately). The satellite layer is never presented as ground truth.

  Two native languages. Every word on screen comes from STRINGS below, written separately in
  English and in Bangla - not translated word for word. Bangla uses Bangla numerals; coordinates
  and scientific names (Sentinel-1, C-band) stay as the world writes them.

  No map library and no CDN: both would need a network in exactly the situation this is built for.
*/

const PACK_CACHE = "ingito-pack-v1";
const PACK_KEY = "/__ingito_pack__";          // cache key for whichever pack is loaded
const REPORTS_KEY = "ingito.reports.v1";
const THEME_KEY = "ingito.theme.v2";          // v2: light/dark (v1 stored day/night)
const LANG_KEY = "ingito.lang.v1";
const HINT_KEY = "ingito.hint.radar.v1";
const INDEX_URLS = ["../packs/index.json", "packs/index.json"];
const PROBE_EVERY_MS = 20000;
const PROBE_TIMEOUT_MS = 4000;
const DELETE_ALL_PAUSE_MS = 800;      // "tap again" must be a second decision, not a double tap
const DELETE_ALL_DISARM_MS = 5000;
const GROUND_NEAR_M = 300;            // field reports this close count as "here" in the readout
/* A published build (an artifact page, or a single HTML file sent to somebody) has no packs folder
   to fetch from, so the pack can be embedded in the page instead. */
const EMBEDDED = globalThis.INGITO_PACK || null;
const FONT = '"Anek Bangla", "Noto Sans Bengali", "Nirmala UI", system-ui, sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, "Roboto Mono", monospace';

/*
  The map's materials. ONE palette for both themes: light and dark change the instrument's
  surfaces, never the picture of the Earth or the meaning of a mark. Every meaning is also carried
  by a shape - hatching, a ring, a triangle, a dash - so no reading depends on telling colours apart.
*/
const MAP = {
  ground: "#18241e",                                   // under the photo, and when it is off
  veil: "rgba(6, 14, 10, 0.58)",                       // outside the district: dimmed, not hidden
  flood: "rgba(34, 199, 238, 0.30)", floodFar: "rgba(34, 199, 238, 0.92)",
  floodWash: "#4f9fc4",                                // multiplied into the photo: submerged land
  floodHatch: "rgba(175, 242, 255, 0.7)", floodEdge: "#7fe6ff",
  radarTint: "#cfeefa", radarEdge: "#22c7ee",
  road: "#f3ead2", roadCasing: "rgba(8, 14, 11, 0.82)", roadMinor: "rgba(243, 234, 210, 0.72)",
  wetCasing: "#061519", wetDash: "#7fe6ff",
  river: "rgba(140, 203, 232, 0.9)", riverLabel: "#d6f1ff",
  riverOnPhoto: "rgba(140, 203, 232, 0.3)",            // close up the real river is in the photo
  admin: "rgba(255, 255, 255, 0.78)", adminUnder: "rgba(0, 0, 0, 0.45)",
  grid: "rgba(255, 255, 255, 0.13)", gridLabel: "rgba(255, 255, 255, 0.75)",
  label: "#ffffff", halo: "rgba(5, 12, 9, 0.88)",
  shelter: "#006a4e", shelterEdge: "#ffffff",
  report: "#f42a41", reportEdge: "#ffffff",
  fix: "#f42a41", fixCore: "#ffffff",
  shield: "#10231b",
};

/*
  Declutter by zoom, in metres per screen pixel. At district view 1,853 village roads and every
  stream would bury the flood layer, so detail arrives as you zoom in.
*/
const MINOR_ROADS = new Set(["unclassified"]);
const MINOR_WATER = new Set(["stream", "drain"]);
const SHOW_MINOR_BELOW = 25;
const HATCH_FLOOD_BELOW = 30;
const LABEL_SHELTERS_BELOW = 6;
const PLACE_VISIBLE_BELOW = { city: 400, town: 400, suburb: 45, village: 45, hamlet: 14 };
const PLACE_SIZE = { city: 15, town: 13.5, suburb: 12.5, village: 12.5, hamlet: 11.5 };

/* ------------------------------------------------------------------ the two languages */

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const MONTHS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  bn: ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর",
       "অক্টোবর", "নভেম্বর", "ডিসেম্বর"],
};

const STRINGS = {
  en: {
    where: "Where", water: "Water", shelter: "Shelter", undo: "Undo",
    waterHere: "Water here", roadCut: "Road cut",
    layers: "Layers", source: "Source", reports: "Reports", locate: "Locate",
    lens: "Radar", zoomIn: "Zoom in", zoomOut: "Zoom out",
    toDark: "Switch to dark mode", toLight: "Switch to light mode",
    gateTitle: "Satellite flood map that works with no signal",
    gateSub: "Download it while you still have a connection. After that it needs no network at all: no map tiles, no services, no accounts.",
    looking: "Looking for packs…",
    openFile: "Or open a pack file handed to you by another team",
    keyFlood: "Flood water seen from orbit",
    keyRadar: "Radar view · dark means smooth water · drag the line",
    tele: (date, time, platform) => `${date.toUpperCase()} · ${time} · ${platform.toUpperCase()} · C-BAND SAR`,
    clock: (h, m) => `${String(h).padStart(2, "0")}:${m} UTC+6`,
    net: { online: "Online", nolink: "No link", offline: "Offline", checking: "Checking" },
    recorded: (n) => `${n} recorded`,
    before: (d) => `${d} · before`, during: (d) => `${d} · flood`,
    hint: "See the flood arrive: compare the radar from before and during",
    whoGps: (acc) => `You (GPS ±${acc} m)`, whoCross: "Crosshair (no GPS)",
    outside: "outside the pack area",
    radarWater: "Radar saw water here", radarDry: "Radar saw no water here",
    limitShort: "Radar misses water under trees and between buildings. Record what you see.",
    orbitTag: "Orbit", groundTag: "Ground",
    groundNear: (n) => `${n} of your reports within ${num(GROUND_NEAR_M)} m`,
    groundNone: "Nothing recorded here yet",
    shelterLine: (dist, dir, kind, name) => `${dist} ${dir} · ${kind} (unverified)${name ? ` · ${name}` : ""}`,
    noShelter: "none in this pack",
    dirs: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
    kinds: { mosque: "mosque", school: "school", hospital: "hospital", clinic: "clinic" },
    km: (v) => `${v} km`, m: (v) => `${v} m`,
    noteSaved: (type, n, stored, gps) =>
      `${type.toUpperCase()} #${n} ${stored ? "saved" : "NOT SAVED"}<small>` +
      `${stored ? "" : "this browser refused storage · "}${gps ? "at your GPS position" : "at the crosshair (no GPS)"}</small>`,
    noteRemoved: (type, left) =>
      `${type.toUpperCase()} removed<small>${left} report${left === 1 ? "" : "s"} left on this device</small>`,
    noteNoFix: (problem) =>
      `No GPS fix yet<small>${problem} Until there is one, the readout and every report use the crosshair.</small>`,
    gps: {
      searching: "The GPS is still searching.",
      refused: "Location permission was refused in this browser.",
      unavailable: "The phone cannot work out its position.",
      none: "This device has no GPS.",
    },
    layerNames: {
      photo: (d) => `Satellite photo · ${d}`, flood: "Flood water (radar, from orbit)",
      wet: "Roads crossing that water (calculated)", roads: "Roads", waterways: "Rivers and canals",
      places: "Villages and places", shelters: "Shelter points (unverified)", reports: "My field reports",
      terrain: "Terrain relief",
    },
    on: "On", off: "Off",
    layersNote: "Village roads, streams and small places appear as you zoom in.",
    reportsTitle: (n) => `My field observations (${n})`,
    reportsEmpty: "No field reports yet. When you see water or a cut road that the satellite layer does not show, tap WATER HERE or ROAD CUT.",
    reportsStored: "Stored on this device, kept separate from the satellite layer and never merged into it.",
    atCrosshair: "placed at the crosshair", gpsAcc: (m) => `GPS ± ${m} m`,
    delete: "Delete", deleteAria: (n) => `Delete report ${n}`,
    exportBtn: "Export for handover", saveFile: "Save the file",
    exportCopy: (n) => `${n} observations as GeoJSON. Copy this if the file cannot be saved:`,
    exportNone: "Nothing to export yet.",
    deleteAll: "Delete all reports", deleteAllArmed: (n) => `Tap again to delete all ${n}`,
    downloadPack: "Download this pack",
    noPacks: "No pack on this device, and no pack list reachable.",
    noPacksHelp: "Open a pack file below, or connect and reload.",
    starting: "starting the download…",
    downloading: (mb, total, pct) => total ? `downloading ${mb} of ${total} MB (${pct}%)` : `downloading ${mb} MB`,
    storing: "storing the pack on this device…",
    refusedStorage: "warning: this browser refused local storage",
    couldNot: (msg) => `could not download: ${msg}`,
    reading: (name) => `reading ${name}…`,
    notPack: (msg) => `not a usable pack: ${msg}`,
    loadedFrom: {
      device: "this device (offline store)", embeddedKept: "embedded in this page, stored on this device",
      embedded: "embedded in this page", downloadedNotStored: "downloaded, not stored locally",
      file: (name, kept) => `file: ${name}${kept ? ", stored on this device" : ""}`,
    },
    linkWords: {
      online: "online - a request to the network was answered",
      nolink: "radio on, but nothing answers - treat as offline",
      offline: "offline - the radio is off", checking: "checking",
    },
  },

  bn: {
    where: "অবস্থান", water: "পানি", shelter: "আশ্রয়", undo: "বাতিল",
    waterHere: "এখানে পানি", roadCut: "রাস্তা বন্ধ",
    layers: "লেয়ার", source: "তথ্যসূত্র", reports: "রিপোর্ট", locate: "আমি কোথায়",
    lens: "রাডার", zoomIn: "কাছে আনুন", zoomOut: "দূরে নিন",
    toDark: "অন্ধকার মোডে যান", toLight: "আলো মোডে যান",
    gateTitle: "নেটওয়ার্ক ছাড়াই চলে এমন স্যাটেলাইট বন্যা-মানচিত্র",
    gateSub: "নেটওয়ার্ক থাকতে থাকতেই প্যাকটি নামিয়ে রাখুন। এরপর আর কোনো সংযোগ লাগবে না — না ম্যাপ টাইল, না সার্ভার, না অ্যাকাউন্ট।",
    looking: "প্যাক খোঁজা হচ্ছে…",
    openFile: "অথবা অন্য দলের কাছ থেকে পাওয়া প্যাক ফাইল খুলুন",
    keyFlood: "স্যাটেলাইট থেকে দেখা বন্যার পানি",
    keyRadar: "রাডার ভিউ · কালো মানে স্থির পানি · দাগটি টানুন",
    tele: (date, time, platform) => `${date} · ${time} · ${platform} · C-band রাডার`,
    clock: (h, m) => {
      const period = h < 4 ? "রাত" : h < 12 ? "সকাল" : h < 15 ? "দুপুর" : h < 18 ? "বিকেল" : h < 20 ? "সন্ধ্যা" : "রাত";
      return `${period} ${((h + 11) % 12) + 1}:${m}`;
    },
    net: { online: "অনলাইন", nolink: "নেট পাচ্ছে না", offline: "অফলাইন", checking: "যাচাই হচ্ছে" },
    recorded: (n) => `${n}টি জমা`,
    before: (d) => `${d} · আগে`, during: (d) => `${d} · বন্যা`,
    hint: "বন্যা কীভাবে এলো দেখুন — রাডারের আগের আর বন্যার দিনের ছবি পাশাপাশি",
    whoGps: (acc) => `আপনি (জিপিএস ±${acc} মি)`, whoCross: "নিশানা (জিপিএস নেই)",
    outside: "প্যাকের এলাকার বাইরে",
    radarWater: "রাডারে এখানে পানি ধরা পড়েছে", radarDry: "রাডারে এখানে পানি ধরা পড়েনি",
    limitShort: "গাছপালার নিচে বা ঘরবাড়ির ফাঁকে জমা পানি রাডারে ধরা পড়ে না। নিজের চোখে যা দেখছেন, জানিয়ে দিন।",
    orbitTag: "স্যাটেলাইট", groundTag: "মাঠ",
    groundNear: (n) => `${num(GROUND_NEAR_M)} মিটারের মধ্যে আপনার ${n}টি রিপোর্ট`,
    groundNone: "এখানে এখনো কিছু জানানো হয়নি",
    shelterLine: (dist, dir, kind, name) => `${dist} ${dir} · ${kind} (যাচাই হয়নি)${name ? ` · ${name}` : ""}`,
    noShelter: "এই প্যাকে নেই",
    dirs: ["উত্তরে", "উত্তর-পূর্বে", "পূর্বে", "দক্ষিণ-পূর্বে", "দক্ষিণে", "দক্ষিণ-পশ্চিমে", "পশ্চিমে", "উত্তর-পশ্চিমে"],
    kinds: { mosque: "মসজিদ", school: "স্কুল", hospital: "হাসপাতাল", clinic: "ক্লিনিক" },
    km: (v) => `${v} কিমি`, m: (v) => `${v} মিটার`,
    noteSaved: (type, n, stored, gps) =>
      `${type} #${n} — ${stored ? "জমা হলো" : "জমা হয়নি"}<small>` +
      `${stored ? "" : "এই ব্রাউজার জমা রাখতে দিচ্ছে না · "}${gps ? "আপনার জিপিএস অবস্থানে" : "নিশানার জায়গায় (জিপিএস নেই)"}</small>`,
    noteRemoved: (type, left) => `${type} — বাতিল হলো<small>এই ফোনে আর ${left}টি রিপোর্ট আছে</small>`,
    noteNoFix: (problem) =>
      `এখনো জিপিএস পাওয়া যায়নি<small>${problem} ততক্ষণ অবস্থান আর সব রিপোর্ট নিশানার জায়গা ধরে হবে।</small>`,
    gps: {
      searching: "জিপিএস এখনো খুঁজছে।",
      refused: "এই ব্রাউজারে লোকেশনের অনুমতি দেওয়া হয়নি।",
      unavailable: "ফোন নিজের অবস্থান বের করতে পারছে না।",
      none: "এই যন্ত্রে জিপিএস নেই।",
    },
    layerNames: {
      photo: (d) => `স্যাটেলাইট ছবি · ${d}`, flood: "বন্যার পানি (রাডার, স্যাটেলাইট থেকে)",
      wet: "ওই পানির ওপর দিয়ে যাওয়া রাস্তা (হিসাব করে বের করা)", roads: "রাস্তা", waterways: "নদী ও খাল",
      places: "গ্রাম ও জায়গার নাম", shelters: "আশ্রয়ের জায়গা (যাচাই হয়নি)", reports: "আমার মাঠের রিপোর্ট",
      terrain: "ভূমির উঁচু-নিচু",
    },
    on: "চালু", off: "বন্ধ",
    layersNote: "কাছে গেলে গ্রামের রাস্তা, ছোট খাল আর ছোট জায়গার নাম দেখা যায়।",
    reportsTitle: (n) => `আমার মাঠের পর্যবেক্ষণ (${n})`,
    reportsEmpty: "এখনো কোনো রিপোর্ট নেই। স্যাটেলাইটের মানচিত্রে নেই এমন পানি বা ভাঙা রাস্তা চোখে পড়লে ‘এখানে পানি’ বা ‘রাস্তা বন্ধ’ চাপুন।",
    reportsStored: "এগুলো এই ফোনেই জমা থাকে, স্যাটেলাইটের তথ্যের সঙ্গে কখনো মেশানো হয় না।",
    atCrosshair: "নিশানার জায়গায় বসানো", gpsAcc: (m) => `জিপিএস ± ${m} মিটার`,
    delete: "মুছুন", deleteAria: (n) => `${n} নম্বর রিপোর্ট মুছুন`,
    exportBtn: "হস্তান্তরের ফাইল তৈরি করুন", saveFile: "ফাইলটি সেভ করুন",
    exportCopy: (n) => `${n}টি পর্যবেক্ষণ, GeoJSON ফরম্যাটে। ফাইল সেভ না হলে এটুকু কপি করে নিন:`,
    exportNone: "এক্সপোর্ট করার মতো কিছু এখনো নেই।",
    deleteAll: "সব রিপোর্ট মুছুন", deleteAllArmed: (n) => `সব ${n}টি মুছতে আবার চাপুন`,
    downloadPack: "প্যাকটি নামিয়ে রাখুন",
    noPacks: "এই ফোনে কোনো প্যাক নেই, প্যাকের তালিকাও পাওয়া যাচ্ছে না।",
    noPacksHelp: "নিচে প্যাক ফাইল খুলুন, অথবা নেট চালু করে আবার লোড করুন।",
    starting: "নামানো শুরু হচ্ছে…",
    downloading: (mb, total, pct) => total ? `নামছে: ${total} MB-এর ${mb} MB (${pct}%)` : `নামছে: ${mb} MB`,
    storing: "প্যাকটি ফোনে জমা রাখা হচ্ছে…",
    refusedStorage: "সতর্কতা: এই ব্রাউজার ফোনে জমা রাখতে দিচ্ছে না",
    couldNot: (msg) => `নামানো গেল না: ${msg}`,
    reading: (name) => `${name} পড়া হচ্ছে…`,
    notPack: (msg) => `এটি ব্যবহারযোগ্য প্যাক নয়: ${msg}`,
    loadedFrom: {
      device: "এই ফোন (অফলাইন ভান্ডার)", embeddedKept: "এই পেজের ভেতরেই ছিল, ফোনে জমা রাখা হয়েছে",
      embedded: "এই পেজের ভেতরেই ছিল", downloadedNotStored: "নামানো হয়েছে, ফোনে জমা হয়নি",
      file: (name, kept) => `ফাইল: ${name}${kept ? ", ফোনে জমা রাখা হয়েছে" : ""}`,
    },
    linkWords: {
      online: "অনলাইন — নেটওয়ার্কে পাঠানো অনুরোধের জবাব এসেছে",
      nolink: "রেডিও চালু, কিন্তু কোনো জবাব আসছে না — অফলাইন ধরে নিন",
      offline: "অফলাইন — রেডিও বন্ধ", checking: "যাচাই হচ্ছে",
    },
  },
};

const el = (id) => document.getElementById(id);
const canvas = el("map");
const ctx = canvas.getContext("2d");

const state = {
  pack: null,
  images: {},                              // optical, before, during, terrain
  source: null,                            // {key, file, kept}: where the pack was loaded from
  found: undefined,                        // the pack list, kept so the gate can re-render
  view: { lon: 0, lat: 0, ppd: 1 },        // ppd = device pixels per degree of latitude
  fix: null,                               // {lon, lat, accuracy} from the device GPS
  watching: false,
  gpsProblem: "searching",
  reports: [],
  lastId: null,                            // the report the UNDO button would remove
  note: null,                              // {kind, args, undo}: what the box above the buttons says
  panel: null,
  deleteAllArmed: false,
  theme: "light",
  lang: "en",
  link: "checking",                        // offline | nolink | online | checking
  lens: false,                             // the radar before/after view
  split: 0.5,                              // where the before/after line sits, 0..1 of the width
  layers: { photo: true, terrain: true, flood: true, wet: true, roads: true, waterways: true,
            places: true, shelters: true, reports: true },
  here: "",
};

const S = () => STRINGS[state.lang];
/* Bangla numerals for everything a person reads as a number; coordinates stay as GPS writes them. */
const num = (value) => (state.lang === "bn" ? String(value).replace(/[0-9]/g, (d) => BN_DIGITS[d]) : String(value));

function fmtDate(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y || !m || !d) return String(iso || "");
  return num(`${d} ${MONTHS[state.lang][m - 1]} ${y}`);
}

/* The pass time, in Bangladesh time: the moment the satellite was overhead is something a person
   can picture ("18:04, early evening"), a UTC stamp is not. */
function passClock(utc) {
  const [h, m] = String(utc || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  return num(S().clock((h + 6) % 24, String(m).padStart(2, "0")));
}

function kmText(metres) {
  return metres < 1000 ? S().m(num(Math.round(metres)))
    : S().km(num((metres / 1000).toFixed(1).replace(/\.0$/, "")));
}

function nameIn(item) {
  if (!item) return "";
  return state.lang === "bn" ? item.name_bn || item.name || "" : item.name || item.name_bn || "";
}

function areaName(english) {
  const area = (state.pack?.areas || []).find((candidate) => candidate.name === english);
  return area ? nameIn({ name: area.name, name_bn: area.name_bn }) : english;
}

/* ------------------------------------------------------------------ storage */

/* Reports live in localStorage: small, synchronous, and still there after the phone is restarted
   in a boat with no signal. Every read and write is guarded, because private-mode browsers throw
   instead of returning null. */
function loadReports() {
  try {
    state.reports = JSON.parse(localStorage.getItem(REPORTS_KEY) || "[]");
  } catch (error) {
    state.reports = [];
  }
  state.reports.forEach((report, index) => {
    if (!report.id) report.id = `r${Date.parse(report.at) || 0}-${index}`;
  });
}

function saveReports() {
  try {
    localStorage.setItem(REPORTS_KEY, JSON.stringify(state.reports));
    return true;
  } catch (error) {
    return false;              // the map still shows them, and the operator is told they are unsaved
  }
}

function remembered(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) { /* the choice just won't survive a reload */ }
}

/* The pack is megabytes, too big for localStorage, so it goes into Cache Storage as a Response.
   That survives going offline, closing the browser and restarting the device. */
async function cachePack(text) {
  if (!("caches" in globalThis)) return false;
  try {
    const cache = await caches.open(PACK_CACHE);
    await cache.put(PACK_KEY, new Response(text, { headers: { "Content-Type": "application/json" } }));
    return true;
  } catch (error) {
    return false;
  }
}

async function cachedPack() {
  if (!("caches" in globalThis)) return null;
  try {
    const cache = await caches.open(PACK_CACHE);
    const hit = await cache.match(PACK_KEY);
    return hit ? await hit.text() : null;
  } catch (error) {
    return null;
  }
}

/* ------------------------------------------------------------------ connectivity */

/*
  The status line must tell the truth about connectivity, and navigator.onLine cannot: it only
  knows whether a radio is switched on. So when the radio claims a connection, we test it by
  actually asking for something. Any HTTP answer proves the network carried a request; only a
  thrown error or our own service worker's offline reply means the link is gone. The service
  worker lets ?probe= requests straight through, otherwise the probe would always succeed.
*/
async function probe() {
  if (!navigator.onLine) {
    state.link = "offline";
    status();
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${location.pathname}?probe=${Date.now()}`,
                                 { cache: "no-store", signal: controller.signal });
    state.link = response.headers.get("X-Ingito-Offline") ? "nolink" : "online";
  } catch (error) {
    state.link = "nolink";
  } finally {
    clearTimeout(timer);
  }
  status();
}

/* ------------------------------------------------------------------ projection */

/* Equirectangular, with longitude squeezed by cos(latitude) so shapes are not stretched. Over one
   district the error is far below anything that matters in the field, and it costs no library. */
function project(lon, lat) {
  const { lon: clon, lat: clat, ppd } = state.view;
  const squeeze = Math.cos((clat * Math.PI) / 180);
  return [canvas.width / 2 + (lon - clon) * ppd * squeeze,
          canvas.height / 2 - (lat - clat) * ppd];
}

function unproject(x, y) {
  const { lon: clon, lat: clat, ppd } = state.view;
  const squeeze = Math.cos((clat * Math.PI) / 180);
  return [clon + (x - canvas.width / 2) / (ppd * squeeze),
          clat - (y - canvas.height / 2) / ppd];
}

function fitTo([west, south, east, north]) {
  const squeeze = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const fitLat = canvas.height / Math.max(north - south, 1e-6);
  const fitLon = canvas.width / Math.max((east - west) * squeeze, 1e-6);
  state.view = { lon: (west + east) / 2, lat: (south + north) / 2,
                 ppd: Math.min(fitLat, fitLon) * 0.94 };
}

/*
  Open ON the water. The first thing anyone sees - a responder or a judge - should be the biggest
  body of water the radar found, with the reticle on it, so the readout's first answer is "Radar
  saw water here". The crosshair point is the grid point nearest the patch's middle that is
  actually inside it (a bent patch's middle can be dry land). No flood, or no inside point: show
  the whole pack instead.
*/
const OPEN_SPAN_M = 6000;           // across the shorter side of the map

function openOnWater(pack) {
  const features = pack.observation.features || [];
  if (!features.length) return fitTo(pack.coverage.bbox);
  const ring = features.reduce((a, b) => (b.km2 > a.km2 ? b : a)).rings[0];
  const lons = ring.map((v) => v[0]);
  const lats = ring.map((v) => v[1]);
  const [west, east, south, north] = [Math.min(...lons), Math.max(...lons),
                                      Math.min(...lats), Math.max(...lats)];
  let best = null;
  for (let i = 1; i < 20; i++) {
    for (let j = 1; j < 20; j++) {
      const lon = west + ((east - west) * i) / 20;
      const lat = south + ((north - south) * j) / 20;
      const off = (i - 10) ** 2 + (j - 10) ** 2;
      if ((!best || off < best.off) && inRing(ring, lon, lat)) best = { lon, lat, off };
    }
  }
  if (!best) return fitTo(pack.coverage.bbox);
  state.view = { lon: best.lon, lat: best.lat,
                 ppd: (Math.min(canvas.width, canvas.height) * 110540) / OPEN_SPAN_M };
}

/* Zoom about a point on screen (device pixels), so the ground under a pinch or cursor stays put. */
function zoomAt(factor, x = canvas.width / 2, y = canvas.height / 2) {
  const before = unproject(x, y);
  state.view.ppd = Math.min(Math.max(state.view.ppd * factor, 200), 400000);
  const after = unproject(x, y);
  state.view.lon += before[0] - after[0];
  state.view.lat += before[1] - after[1];
}

function metresPerScreenPixel() {
  return (110540 * (globalThis.devicePixelRatio || 1)) / state.view.ppd;
}

function metresPerDegree(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

function distanceM(a, b) {
  const dx = (a[0] - b[0]) * metresPerDegree((a[1] + b[1]) / 2);
  const dy = (a[1] - b[1]) * 110540;
  return Math.hypot(dx, dy);
}

function bearingIndex(from, to) {
  const dx = (to[0] - from[0]) * metresPerDegree(from[1]);
  const dy = (to[1] - from[1]) * 110540;
  const angle = (Math.atan2(dx, dy) * 180) / Math.PI;
  return Math.round(((angle + 360) % 360) / 45) % 8;
}

/* Ray casting: is this point inside this ring. */
function inRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* A pack can be a file handed over by another team, so every string from it is escaped before it
   goes into the page. A pack must never be able to run code on the operator's phone. */
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function ageInDays(iso) {
  const then = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(then) ? Math.round((Date.now() - then) / 86400000) : null;
}

/* ------------------------------------------------------------------ drawing */

function resize() {
  const ratio = globalThis.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * ratio);
  canvas.height = Math.round(canvas.clientHeight * ratio);
}

function linePath(coords) {
  ctx.beginPath();
  coords.forEach(([lon, lat], i) => {
    const [x, y] = project(lon, lat);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
}

function strokeLine(coords, width, colour, dash) {
  linePath(coords);
  ctx.setLineDash(dash || []);
  ctx.lineWidth = width;
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.setLineDash([]);
}

function ringPath(rings) {
  for (const ring of rings) {
    ring.forEach(([lon, lat], i) => {
      const [x, y] = project(lon, lat);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
  }
}

function drawPicture(image, [west, south, east, north]) {
  if (!image || !image.complete || !image.naturalWidth) return false;
  const [x0, y0] = project(west, north);
  const [x1, y1] = project(east, south);
  ctx.drawImage(image, x0, y0, x1 - x0, y1 - y0);
  return true;
}

/* The flood hatch: fine diagonal lines, the cartographer's sign for "measured, not drawn". The
   pattern is pinned to the ground, so it moves with the map instead of shimmering over it. */
let hatchCache = null;
function hatchPattern(ratio) {
  if (!hatchCache || hatchCache.ratio !== ratio) {
    const size = Math.max(4, Math.round(7 * ratio));
    const tile = document.createElement("canvas");
    tile.width = tile.height = size;
    const g = tile.getContext("2d");
    g.strokeStyle = MAP.floodHatch;
    g.lineWidth = 1.1 * ratio;
    g.beginPath();
    g.moveTo(-1, size + 1); g.lineTo(size + 1, -1);
    g.moveTo(-1, 1); g.lineTo(1, -1);
    g.moveTo(size - 1, size + 1); g.lineTo(size + 1, size - 1);
    g.stroke();
    hatchCache = { ratio, size, pattern: ctx.createPattern(tile, "repeat") };
  }
  const [ox, oy] = project(state.pack.coverage.bbox[0], state.pack.coverage.bbox[3]);
  if (hatchCache.pattern.setTransform) {
    hatchCache.pattern.setTransform(new DOMMatrix().translate(ox % hatchCache.size, oy % hatchCache.size));
  }
  return hatchCache.pattern;
}

const ROAD_WIDTH = { motorway: 4, trunk: 3.6, primary: 3.1, secondary: 2.5, tertiary: 2,
                     unclassified: 1.2 };

function draw() {
  const ratio = globalThis.devicePixelRatio || 1;
  if (canvas.width !== Math.round(canvas.clientWidth * ratio)) resize();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = MAP.ground;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state.pack) return;
  const pack = state.pack;
  const mpp = metresPerScreenPixel();
  const detailed = mpp < SHOW_MINOR_BELOW;
  const lineScale = detailed ? 1 : 0.6;
  const imagery = pack.imagery;
  const splitX = state.split * canvas.width;
  const lens = state.lens && imagery?.radar;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // THE EARTH. In the radar view: the two passes, before on the left of the line, flood on the
  // right, tinted cool so they read as instrument data. Otherwise: the photograph and its relief.
  if (lens) {
    drawPicture(state.images.during, imagery.bounds);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, splitX, canvas.height);
    ctx.clip();
    drawPicture(state.images.before, imagery.bounds);
    ctx.restore();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = MAP.radarTint;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
  } else {
    if (state.layers.photo && imagery) drawPicture(state.images.optical, imagery.bounds);
    if (state.layers.terrain && state.images.terrain) {
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = state.layers.photo && imagery ? 0.55 : 0.9;
      drawPicture(state.images.terrain, pack.terrain.bounds);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // The piece of Earth this pack is about stays bright; everything outside it is dimmed.
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  for (const area of pack.areas || []) ringPath(area.rings);
  ctx.fillStyle = MAP.veil;
  ctx.fill("evenodd");

  drawGraticule(ratio);

  // Upazila boundaries: white dashes on a dark underline, readable on any ground.
  for (const area of pack.areas || []) {
    ctx.beginPath();
    ringPath(area.rings);
    ctx.lineWidth = 2.6 * ratio;
    ctx.strokeStyle = MAP.adminUnder;
    ctx.stroke();
    ctx.setLineDash([6 * ratio, 5 * ratio]);
    ctx.lineWidth = 1.2 * ratio;
    ctx.strokeStyle = MAP.admin;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (!lens && state.layers.waterways) {
    for (const way of pack.context.waterways || []) {
      if (!detailed && MINOR_WATER.has(way.kind)) continue;
      const width = way.kind === "river" ? 2.6 : way.kind === "canal" ? 1.7 : 1.1;
      // Close up over the photograph the line steps back, so the river itself - its real width
      // and bends - is what the eye follows. Far out, the line is the only way to see it.
      strokeLine(way.coords, width * lineScale * ratio,
                 detailed && state.layers.photo && imagery ? MAP.riverOnPhoto : MAP.river);
    }
  }

  if (!lens && state.layers.roads) {
    for (const casing of [true, false]) {
      for (const road of pack.context.roads || []) {
        const minor = MINOR_ROADS.has(road.kind);
        if (minor && !detailed) continue;
        const width = (ROAD_WIDTH[road.kind] || 1.2) * lineScale * ratio;
        if (minor) {
          if (!casing) strokeLine(road.coords, width, MAP.roadMinor);
        } else {
          strokeLine(road.coords, casing ? width + 2 * ratio : width, casing ? MAP.roadCasing : MAP.road);
        }
      }
    }
  }

  // FROM ORBIT: the radar's flood water. The only cyan on the map. In the radar view only its
  // edge is drawn, and only over the flood-day pass it was measured from.
  if (state.layers.flood) {
    const rings = (pack.observation.features || []).flatMap((feature) => feature.rings);
    if (lens) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(splitX, 0, canvas.width - splitX, canvas.height);
      ctx.clip();
      ctx.beginPath();
      ringPath(rings);
      ctx.lineWidth = 1.6 * ratio;
      ctx.strokeStyle = MAP.radarEdge;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.beginPath();
      ringPath(rings);
      if (mpp < HATCH_FLOOD_BELOW) {
        // Close up, the land goes under water: a silty wash MULTIPLIED into the photograph, so
        // the fields and village trees still show through it, the way they show through shallow
        // floodwater. Then the hatch and the edge: the sign that this was measured from orbit.
        if (state.layers.photo && imagery) {
          ctx.globalCompositeOperation = "multiply";
          ctx.fillStyle = MAP.floodWash;
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        } else {
          ctx.fillStyle = MAP.flood;
          ctx.fill();
        }
        ctx.fillStyle = hatchPattern(ratio);
        ctx.fill();
        ctx.lineWidth = 1.4 * ratio;
      } else {
        // Far out most patches are a pixel or two: solid, or the layer the instrument exists to
        // carry would vanish. The edge guarantees even the smallest patch two pixels.
        ctx.fillStyle = MAP.floodFar;
        ctx.fill();
        ctx.lineWidth = 1 * ratio;
      }
      ctx.strokeStyle = MAP.floodEdge;
      ctx.stroke();
    }
  }

  // Roads crossing radar water: DERIVED from the observation, so drawn in its cyan, as dashes.
  if (!lens && state.layers.wet) {
    for (const road of pack.context.roads || []) {
      if (!road.wet) continue;
      const width = (ROAD_WIDTH[road.kind] || 1.2) * lineScale * ratio;
      strokeLine(road.coords, width + 4 * ratio, MAP.wetCasing);
      strokeLine(road.coords, Math.max(1.6 * ratio, width), MAP.wetDash, [5 * ratio, 4 * ratio]);
    }
  }

  if (!lens && state.layers.shelters) {
    const near = mpp <= 40;
    const size = (near ? 13 : 6) * ratio;
    for (const shelter of pack.context.shelters || []) {
      const [x, y] = project(shelter.lon, shelter.lat);
      if (x < -20 || y < -20 || x > canvas.width + 20 || y > canvas.height + 20) continue;
      drawShelter(x, y, size, near, ratio);
    }
  }

  drawLabels(ratio, mpp, lens);

  // FROM THE GROUND, last, so nothing can cover them. Circle = water here, triangle = road cut.
  if (state.layers.reports) {
    for (const report of state.reports) drawReport(report, ratio);
  }
  if (state.fix) drawFix(ratio);
  if (lens) drawDivider(ratio, splitX);
  drawScale(ratio);
}

function drawShelter(x, y, size, near, ratio) {
  const half = size / 2;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - half, y - half, size, size, 3 * ratio);
  else ctx.rect(x - half, y - half, size, size);
  ctx.fillStyle = MAP.shelter;
  ctx.fill();
  ctx.lineWidth = (near ? 1.6 : 1) * ratio;
  ctx.strokeStyle = MAP.shelterEdge;
  ctx.stroke();
  if (near) {                              // a roof: the shape says "shelter" without the colour
    ctx.beginPath();
    ctx.moveTo(x - half * 0.55, y + half * 0.1);
    ctx.lineTo(x, y - half * 0.45);
    ctx.lineTo(x + half * 0.55, y + half * 0.1);
    ctx.moveTo(x - half * 0.32, y + half * 0.05);
    ctx.lineTo(x - half * 0.32, y + half * 0.5);
    ctx.lineTo(x + half * 0.32, y + half * 0.5);
    ctx.lineTo(x + half * 0.32, y + half * 0.05);
    ctx.lineWidth = 1.5 * ratio;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }
}

function drawReport(report, ratio) {
  const [x, y] = project(report.lon, report.lat);
  const s = 10.5 * ratio;
  ctx.beginPath();
  if (report.type === "water_here") {
    ctx.arc(x, y, s, 0, Math.PI * 2);
  } else {
    ctx.moveTo(x, y - s * 1.25);
    ctx.lineTo(x + s * 1.15, y + s * 0.8);
    ctx.lineTo(x - s * 1.15, y + s * 0.8);
    ctx.closePath();
  }
  ctx.fillStyle = MAP.report;
  ctx.fill();
  ctx.lineWidth = 2.4 * ratio;
  ctx.strokeStyle = MAP.reportEdge;
  ctx.stroke();
  ctx.beginPath();                         // the glyph: a wave, or a broken road
  if (report.type === "water_here") {
    ctx.moveTo(x - s * 0.58, y);
    ctx.quadraticCurveTo(x - s * 0.29, y - s * 0.38, x, y);
    ctx.quadraticCurveTo(x + s * 0.29, y + s * 0.38, x + s * 0.58, y);
  } else {
    ctx.moveTo(x - s * 0.6, y + s * 0.2);
    ctx.lineTo(x - s * 0.15, y + s * 0.2);
    ctx.moveTo(x + s * 0.15, y + s * 0.2);
    ctx.lineTo(x + s * 0.6, y + s * 0.2);
  }
  ctx.lineWidth = 1.9 * ratio;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
}

/* The operator: a red ring round a white core, with a second ring at a fixed size. A target, never
   a filled dot, so it cannot be confused with a "water here" report. */
function drawFix(ratio) {
  const [x, y] = project(state.fix.lon, state.fix.lat);
  if (state.fix.accuracy) {
    ctx.beginPath();
    ctx.arc(x, y, (state.fix.accuracy / 110540) * state.view.ppd, 0, Math.PI * 2);
    ctx.lineWidth = 1.2 * ratio;
    ctx.strokeStyle = "rgba(244, 42, 65, 0.7)";
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, 16 * ratio, 0, Math.PI * 2);
  ctx.lineWidth = 2.5 * ratio;
  ctx.strokeStyle = MAP.fix;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 7 * ratio, 0, Math.PI * 2);
  ctx.fillStyle = MAP.fixCore;
  ctx.fill();
  ctx.lineWidth = 3.5 * ratio;
  ctx.strokeStyle = MAP.fix;
  ctx.stroke();
}

/* The before/after line: a white rule with a handle. It is drawn on the map because it is part of
   the map - the boundary between two moments in time. */
function drawDivider(ratio, splitX) {
  const handleY = canvas.height * 0.64;
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(splitX - 2 * ratio, 0, 4 * ratio, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(splitX - 1 * ratio, 0, 2 * ratio, canvas.height);
  ctx.beginPath();
  ctx.arc(splitX, handleY, 19 * ratio, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 2 * ratio;
  ctx.strokeStyle = "#0b2a33";
  ctx.stroke();
  ctx.fillStyle = "#0b2a33";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(splitX + side * 12 * ratio, handleY);
    ctx.lineTo(splitX + side * 5 * ratio, handleY - 6 * ratio);
    ctx.lineTo(splitX + side * 5 * ratio, handleY + 6 * ratio);
    ctx.closePath();
    ctx.fill();
  }
  // The date labels sit either side of the line, but never leave the screen when it is dragged
  // to an edge.
  const cssX = splitX / ratio;
  const cssWidth = canvas.width / ratio;
  const top = `${handleY / ratio + 28}px`;
  const before = el("pill-before");
  const during = el("pill-during");
  before.style.cssText = `left:${Math.max(cssX - 10, before.offsetWidth + 6)}px;top:${top};bottom:auto;transform:translateX(-100%)`;
  during.style.cssText = `left:${Math.min(cssX + 10, cssWidth - during.offsetWidth - 6)}px;top:${top};bottom:auto`;
}

/* A fine latitude/longitude grid with degree-minute labels: the instrument's frame of reference,
   and a quiet reminder that this is a measured surface, not a picture. */
function drawGraticule(ratio) {
  const degPerCssPx = metresPerScreenPixel() / 110540;
  const steps = [1, 2, 5, 10, 15, 30].map((minutes) => minutes / 60);
  const step = steps.find((candidate) => candidate / degPerCssPx >= 110) || 0.5;
  const [west, north] = unproject(0, 0);
  const [east, south] = unproject(canvas.width, canvas.height);
  const lons = [];
  const lats = [];
  for (let lon = Math.ceil(west / step) * step; lon <= east; lon += step) lons.push(lon);
  for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) lats.push(lat);
  ctx.beginPath();
  for (const lon of lons) {
    const [x] = project(lon, 0);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
  }
  for (const lat of lats) {
    const [, y] = project(0, lat);
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
  }
  ctx.lineWidth = 1 * ratio;
  ctx.strokeStyle = MAP.grid;
  ctx.stroke();
  const dm = (value, hemi) => {
    const total = Math.round(Math.abs(value) * 60);
    return `${Math.floor(total / 60)}°${String(total % 60).padStart(2, "0")}′${hemi}`;
  };
  ctx.font = `600 ${10 * ratio}px ${MONO}`;
  ctx.fillStyle = MAP.gridLabel;
  ctx.textAlign = "left";
  for (const lat of lats) {
    const [, y] = project(0, lat);
    ctx.fillText(dm(lat, "N"), 5 * ratio, y - 4 * ratio);
  }
  for (const lon of lons) {
    const [x] = project(lon, 0);
    if (x < 130 * ratio) continue;            // the scale bar lives in that corner
    ctx.fillText(dm(lon, "E"), x + 4 * ratio, canvas.height - 6 * ratio);
  }
}

/* Every name on the map, placed in order of importance; a name that would overlap one already
   placed is skipped rather than drawn on top of it. */
function drawLabels(ratio, mpp, lens) {
  const pack = state.pack;
  const remScale = (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16;
  const bn = state.lang === "bn";
  const boxes = [];
  const free = (box) => box[2] > 0 && box[0] < canvas.width && box[3] > 0 && box[1] < canvas.height &&
    !boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
  const spacing = (px) => { if ("letterSpacing" in ctx) ctx.letterSpacing = bn ? "0px" : `${px}px`; };
  const text = (label, x, y, { size, weight = 600, colour = MAP.label, center = false, track = 0 }) => {
    if (!label) return false;
    const px = size * remScale * ratio;
    ctx.font = `${weight} ${px}px ${FONT}`;
    spacing(track * ratio);
    const width = ctx.measureText(label).width;
    const left = center ? x - width / 2 : x;
    const box = [left - 3 * ratio, y - px, left + width + 3 * ratio, y + px * 0.35];
    if (!free(box)) {
      spacing(0);
      return false;
    }
    boxes.push(box);
    ctx.textAlign = "left";
    ctx.lineWidth = 3.5 * ratio;
    ctx.strokeStyle = MAP.halo;
    ctx.strokeText(label, left, y);
    ctx.fillStyle = colour;
    ctx.fillText(label, left, y);
    spacing(0);
    return true;
  };

  // Upazilas, only from far out, where they are the useful names.
  if (mpp > 40) {
    for (const area of pack.areas || []) {
      const ring = area.rings.reduce((a, b) => (b.length > a.length ? b : a), []);
      if (!ring.length) continue;
      const lon = ring.reduce((s, v) => s + v[0], 0) / ring.length;
      const lat = ring.reduce((s, v) => s + v[1], 0) / ring.length;
      const [x, y] = project(lon, lat);
      const label = bn ? area.name_bn || area.name : area.name.toUpperCase();
      text(label, x, y, { size: 11.5, weight: 700, colour: "rgba(255,255,255,0.9)", center: true, track: 2.2 });
    }
  }

  const places = state.layers.places ? (pack.context.places || []) : [];
  const ranked = [...places].sort((a, b) => (PLACE_SIZE[b.kind] || 0) - (PLACE_SIZE[a.kind] || 0));
  const placeLabel = (place) => {
    if (mpp > (PLACE_VISIBLE_BELOW[place.kind] || 0)) return;
    const [x, y] = project(place.lon, place.lat);
    const big = place.kind === "city" || place.kind === "town";
    if (text(nameIn(place), x + 6 * ratio, y + 4 * ratio, { size: PLACE_SIZE[place.kind] || 12, weight: big ? 700 : 600 })) {
      ctx.beginPath();
      ctx.arc(x, y, 3 * ratio, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 1.5 * ratio;
      ctx.strokeStyle = MAP.halo;
      ctx.stroke();
    }
  };
  ranked.filter((p) => p.kind === "city" || p.kind === "town").forEach(placeLabel);

  // Points along a line that are actually on screen, so a river or highway is named where the
  // operator can see it, not at a midpoint that has scrolled away.
  const margin = 40 * ratio;
  const onScreen = (coords) => {
    const step = Math.max(1, Math.floor(coords.length / 12));
    const points = [];
    for (let i = Math.floor(step / 2); i < coords.length; i += step) {
      const [x, y] = project(coords[i][0], coords[i][1]);
      if (x > margin && y > margin && x < canvas.width - margin && y < canvas.height - margin) points.push([x, y]);
    }
    return points;
  };

  // Rivers by name, once per stretch, in pale blue.
  if (state.layers.waterways) {
    const placed = [];
    for (const way of pack.context.waterways || []) {
      const label = nameIn(way);
      if (!label || !(way.kind === "river" || way.kind === "canal")) continue;
      if (way.kind === "canal" && mpp > 20) continue;
      for (const [x, y] of onScreen(way.coords)) {
        if (placed.some((p) => p.label === label && Math.hypot(p.x - x, p.y - y) < 260 * ratio)) continue;
        if (text(label, x, y, { size: 11.5, weight: 500, colour: MAP.riverLabel, center: true, track: 0.8 })) {
          placed.push({ label, x, y });
        }
      }
    }
  }

  // Highway numbers as small shields: "N1" is how a driver names the Dhaka-Chattogram road.
  if (!lens && state.layers.roads) {
    const shields = [];
    ctx.font = `700 ${10 * remScale * ratio}px ${MONO}`;
    for (const road of pack.context.roads || []) {
      if (!road.ref || !/^[NR]\d/.test(road.ref) || road.coords.length < 2) continue;
      const [x, y] = onScreen(road.coords)[0] || [];
      if (x === undefined) continue;
      if (shields.some((s) => s.ref === road.ref && Math.hypot(s.x - x, s.y - y) < 220 * ratio)) continue;
      const width = ctx.measureText(road.ref).width + 8 * ratio;
      const height = 15 * remScale * ratio;
      const box = [x - width / 2, y - height / 2, x + width / 2, y + height / 2];
      if (!free(box)) continue;
      boxes.push(box);
      shields.push({ ref: road.ref, x, y });
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(box[0], box[1], width, height, 3 * ratio);
      else ctx.rect(box[0], box[1], width, height);
      ctx.fillStyle = MAP.shield;
      ctx.fill();
      ctx.lineWidth = 1.2 * ratio;
      ctx.strokeStyle = MAP.road;
      ctx.stroke();
      ctx.fillStyle = MAP.road;
      ctx.textAlign = "center";
      ctx.fillText(road.ref, x, y + 3.5 * ratio);
      ctx.textAlign = "left";
    }
  }

  ranked.filter((p) => p.kind !== "city" && p.kind !== "town").forEach(placeLabel);

  if (!lens && state.layers.shelters && mpp < LABEL_SHELTERS_BELOW) {
    for (const shelter of pack.context.shelters || []) {
      const [x, y] = project(shelter.lon, shelter.lat);
      text(nameIn(shelter), x + 10 * ratio, y + 4 * ratio, { size: 11.5, weight: 600, colour: "#e8fff4" });
    }
  }
}

function drawScale(ratio) {
  const metres = ((120 * ratio) / state.view.ppd) * 110540;
  const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  // The largest step that fits in 120 px, so the bar never runs under the map buttons.
  const pick = steps.filter((step) => step <= metres).pop() || steps[0];
  el("scale").hidden = false;
  el("scale-text").textContent = kmText(pick);
  el("scale-bar").style.width = `${Math.round(((pick / 110540) * state.view.ppd) / ratio)}px`;
}

/* ------------------------------------------------------------------ readout */

/*
  The three field questions, in three fixed slots that never move: WHERE, WATER, SHELTER. The
  WATER slot is where the two points of view meet: what the radar saw from orbit, and - when the
  operator has recorded something nearby - what was seen from the ground.
*/
function updateReadout() {
  if (!state.pack) return;
  const pack = state.pack;
  const text = S();
  const point = state.fix ? [state.fix.lon, state.fix.lat]
                          : unproject(canvas.width / 2, canvas.height / 2);

  let area = null;
  for (const candidate of pack.areas || []) {
    if (candidate.rings.some((ring) => inRing(ring, point[0], point[1]))) {
      area = candidate;
      break;
    }
  }
  state.here = area ? area.name : "";

  // Whose position this is comes FIRST: without a fix it is the crosshair, not the operator.
  const who = state.fix ? text.whoGps(num(Math.round(state.fix.accuracy || 0))) : text.whoCross;
  const areaLabel = area ? nameIn({ name: area.name, name_bn: area.name_bn }) : text.outside;
  el("r-where").textContent = `${who} · ${areaLabel} · ${point[1].toFixed(4)}, ${point[0].toFixed(4)}`;

  const onWater = (pack.observation.features || []).some((feature) =>
    feature.rings.some((ring) => inRing(ring, point[0], point[1])));
  const nearby = state.reports.filter((report) =>
    distanceM(point, [report.lon, report.lat]) <= GROUND_NEAR_M).length;
  const water = el("r-water");
  water.textContent = onWater ? text.radarWater : text.radarDry;
  water.className = onWater ? "hit" : "";
  // The GROUND line always answers. With reports nearby it counts them; on water with none it
  // says so; on a spot the radar called dry it carries the radar's blind spot - exactly where the
  // person standing there is the only one who can see.
  const ground = el("r-ground");
  ground.textContent = nearby ? text.groundNear(num(nearby)) : onWater ? text.groundNone : text.limitShort;
  ground.className = nearby ? "near" : "";

  let nearest = null;
  for (const shelter of pack.context.shelters || []) {
    const metres = distanceM(point, [shelter.lon, shelter.lat]);
    if (!nearest || metres < nearest.metres) nearest = { shelter, metres };
  }
  // "unverified" comes before the name, so a long name is what gets cut, never the warning.
  el("r-shelter").textContent = nearest
    ? text.shelterLine(kmText(nearest.metres),
                       text.dirs[bearingIndex(point, [nearest.shelter.lon, nearest.shelter.lat])],
                       text.kinds[nearest.shelter.kind] || nearest.shelter.kind, nameIn(nearest.shelter))
    : text.noShelter;

  el("readout").hidden = false;
}

/* ------------------------------------------------------------------ panels */

function togglePanel(name) {
  state.panel = state.panel === name ? null : name;
  state.deleteAllArmed = false;
  el("stage").classList.toggle("panelled", Boolean(state.panel));
  for (const key of ["layers", "source", "reports"]) {
    el(`panel-${key}`).hidden = state.panel !== key;
    el(`tool-${key}`).setAttribute("aria-pressed", String(state.panel === key));
  }
  refreshPanel();
}

function refreshPanel() {
  if (!state.pack) return;
  if (state.panel === "layers") renderLayers();
  if (state.panel === "source") renderSource();
  if (state.panel === "reports") renderReports();
}

/* Each layer's icon IS its map mark, on a scrap of map ground, so the key reads without colour. */
function icon(kind) {
  const marks = {
    photo: `<rect x="3" y="4" width="22" height="16" rx="2" fill="#7a6d5b"/><path d="M3 15c5-4 8 1 12-3s7-1 10-3v11H3z" fill="#3c5a3a"/><path d="M6 20c3-6 6-9 9-16" stroke="#8ccbe8" stroke-width="1.6" fill="none"/>`,
    flood: `<defs><pattern id="ih" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="rgba(34,199,238,0.35)"/><line x1="0" y1="0" x2="0" y2="4" stroke="#a0eeff" stroke-width="1.4"/></pattern></defs><rect x="4" y="6" width="20" height="12" rx="2" fill="url(#ih)" stroke="#7fe6ff" stroke-width="1.6"/>`,
    wet: `<line x1="2" y1="12" x2="26" y2="12" stroke="#061519" stroke-width="7"/><line x1="2" y1="12" x2="26" y2="12" stroke="#7fe6ff" stroke-width="2.4" stroke-dasharray="4 3"/>`,
    roads: `<line x1="2" y1="12" x2="26" y2="12" stroke="rgba(8,14,11,0.9)" stroke-width="6"/><line x1="2" y1="12" x2="26" y2="12" stroke="#f3ead2" stroke-width="3.2"/>`,
    waterways: `<path d="M2 16 Q8 6 14 12 T26 8" fill="none" stroke="#8ccbe8" stroke-width="3"/>`,
    places: `<circle cx="7" cy="13" r="2.6" fill="#fff"/><text x="11" y="16.5" font-size="9" font-weight="700" fill="#fff">${state.lang === "bn" ? "গ্রাম" : "Aa"}</text>`,
    shelters: `<rect x="8" y="5" width="13" height="13" rx="3" fill="#006a4e" stroke="#fff" stroke-width="1.5"/><path d="M11 12l3.5-3.5L18 12M12 11.5v3.5h5v-3.5" stroke="#fff" stroke-width="1.4" fill="none"/>`,
    reports: `<circle cx="8" cy="12" r="5.5" fill="#f42a41" stroke="#fff" stroke-width="1.8"/><path d="M20 5 L26 17 L14 17 Z" fill="#f42a41" stroke="#fff" stroke-width="1.8"/>`,
    terrain: `<path d="M2 19 L9 8 L14 14 L19 6 L26 19 Z" fill="#6f7d74" stroke="#d9e2dc" stroke-width="1.2"/>`,
  };
  return `<svg class="icon" viewBox="0 0 28 24" width="40" height="34" aria-hidden="true"><rect width="28" height="24" rx="5" fill="#18241e"/>${marks[kind]}</svg>`;
}

function renderLayers() {
  const pack = state.pack;
  const text = S();
  const wet = (pack.context.roads || []).filter((road) => road.wet).length;
  const rows = [
    ...(pack.imagery ? [["photo", text.layerNames.photo(fmtDate(pack.imagery.optical.date)), ""]] : []),
    ["flood", text.layerNames.flood, (pack.observation.features || []).length],
    ["wet", text.layerNames.wet, wet],
    ["roads", text.layerNames.roads, (pack.context.roads || []).length],
    ["waterways", text.layerNames.waterways, (pack.context.waterways || []).length],
    ["places", text.layerNames.places, (pack.context.places || []).length],
    ["shelters", text.layerNames.shelters, (pack.context.shelters || []).length],
    ["reports", text.layerNames.reports, state.reports.length],
    ["terrain", text.layerNames.terrain, ""],
  ];
  el("panel-layers").innerHTML =
    `<h2>${text.layers}</h2><div class="rows">` +
    rows.map(([key, label, count]) =>
      `<button class="row" data-layer="${key}" aria-pressed="${state.layers[key]}">
         ${icon(key)}<span class="label">${label}</span>
         <span class="count">${count === "" ? "" : num(count)}</span>
         <span class="state">${state.layers[key] ? text.on : text.off}</span>
       </button>`).join("") +
    `</div><p class="plain dim">${text.layersNote} ${esc(pack.context.attribution)}.</p>`;
  el("panel-layers").querySelectorAll("[data-layer]").forEach((button) => {
    button.addEventListener("click", () => {
      state.layers[button.dataset.layer] = !state.layers[button.dataset.layer];
      renderLayers();
      draw();
    });
  });
}

function renderSource() {
  const pack = state.pack;
  const o = pack.observation;
  const bn = state.lang === "bn";
  const text = S();
  const age = ageInDays(o.acquisition_date);
  const totals = o.totals || {};
  const event = o.event || {};
  const share = event.reported_flooded_km2
    ? Math.round((100 * totals.flood_km2) / event.reported_flooded_km2) : null;
  const img = pack.imagery;
  const when = `${fmtDate(o.acquisition_date)}${o.acquisition_time_utc ? `, ${passClock(o.acquisition_time_utc)}` : ""}`;
  const L = bn ? {
    title: "এই তথ্য কোথা থেকে এলো", flood: "বন্যার পানি — স্যাটেলাইট পর্যবেক্ষণ", sensor: "সেন্সর",
    product: "প্রোডাক্ট", observed: "পর্যবেক্ষণ", baseline: "তুলনার দিন", detected: "শনাক্ত",
    threshold: "থ্রেশহোল্ড", source: "উৎস", method: "পদ্ধতি", ago: (n) => `${num(n)} দিন আগে`,
    detectedText: `${num(esc(totals.flood_km2))} বর্গকিমি খোলা পানি, ${num(esc(totals.patches))}টি টুকরোয়`,
    cannot: "এই স্তর যা দেখতে পায় না।",
    limitation: "রাডার শুধু খোলা, স্থির পানি চিনতে পারে। ধানক্ষেত, গাছপালা বা ঘরবাড়ির মাঝে দাঁড়িয়ে থাকা পানিতে রাডারের সংকেত পানি থেকে দেয়ালে বা গাছে লেগে সোজা ফিরে আসে (double bounce) — তাই সেখানে পানি উজ্জ্বল দেখায়, আর এই পদ্ধতিতে ধরা পড়ে না। ফলে এখানে দেখানো এলাকা আসলের চেয়ে কম, বিশেষ করে যেখানে মানুষ থাকে।",
    notTruth: "এটি মাঠে যাচাই করা তথ্য (ground truth) নয়; স্যাটেলাইটের একটি পরিমাপ। মাঠ থেকে আপনার রিপোর্টই এর ফাঁক পূরণ করে।",
    event: "ঘটনা, আর আমাদের যাচাই", eventName: "ঘটনা", arrived: "বন্যা এলো", peak: "নদীর সর্বোচ্চ উচ্চতা",
    reported: "প্রকাশিত হিসাব",
    sanity: `এই স্তরে শনাক্ত হয়েছে ${num(esc(totals.flood_km2))} বর্গকিমি${share !== null ? `, প্রকাশিত হিসাবের প্রায় ${num(share)}%` : ""}। এলাকার ধরন ঘটনার সঙ্গে মেলে: পাহাড়ি ঢল প্রথমে উত্তরের যে উপজেলাগুলোতে নেমেছিল, পানি সেখানেই সবচেয়ে বেশি। পরিমাণ মেলে না, দুটি কারণে — স্যাটেলাইট এই ছবি নিয়েছিল বন্যা আসার দিন, চূড়ায় পৌঁছানোর দুই দিন আগে; আর খোলা পানি শনাক্তের এই পদ্ধতিতে ডুবে যাওয়া গ্রাম ও ফসলের মাঠ বাদ পড়ে। নির্ভুলতার কোনো হার দাবি করা হচ্ছে না: এই ঘটনার যাচাই করা কোনো বন্যা-মানচিত্র নেই।`,
    photo: "স্যাটেলাইট ছবি — রেফারেন্স", taken: "তোলা হয়েছে", scene: "দৃশ্য", remember: "মনে রাখুন",
    photoNote: "শুকনো মৌসুমের ছবি, বন্যার আগের। এটি বন্যার ছবি নয়।",
    radar: "রাডারের দুটি ছবি",
    radarNote: img ? `রাডার ভিউতে সেই দুটি ছবিই দেখানো হয়, যা থেকে বন্যার স্তর হিসাব করা হয়েছে: ${fmtDate(img.radar.before.date)} আর ${fmtDate(img.radar.during.date)}। রাডারে স্থির পানি কালো দেখায়। ছবিগুলোর উজ্জ্বলতা শুধু দেখানোর জন্য ঠিক করা।` : "",
    terrain: "ভূমির উচ্চতা — রেফারেন্স", elevation: "উচ্চতা",
    elevationText: `${num(esc(pack.terrain.elevation_m.min))} থেকে ${num(esc(pack.terrain.elevation_m.max))} মিটার`,
    limits: "সীমাবদ্ধতা", reference: "রাস্তা, নদী, জায়গা, আশ্রয় — রেফারেন্স",
    shelterNote: "আশ্রয়ের জায়গাগুলো OpenStreetMap থেকে নেওয়া — যাচাই করা আশ্রয়কেন্দ্রের তালিকা নয়। স্কুল বা মসজিদ থাকলেই যে তা খোলা, শুকনো বা পৌঁছানোর মতো, তার নিশ্চয়তা নেই।",
    roadsNote: "বন্যার পানির ওপর দিয়ে যাওয়া রাস্তা চিহ্নিত মানেই চলাচল বন্ধ নয়; আবার চিহ্ন না থাকা রাস্তা খোলা আছে, তাও নিশ্চিত নয়। রাডার পানির গভীরতা বা স্রোত জানে না।",
    device: "এই যন্ত্র", pack: "প্যাক", built: "তৈরি", loaded: "যেখান থেকে লোড", network: "নেটওয়ার্ক",
  } : {
    title: "Where this information comes from", flood: "Flood water — satellite observation",
    sensor: "Sensor", product: "Product", observed: "Observed", baseline: "Baseline", detected: "Detected",
    threshold: "Threshold", source: "Source", method: "Method", ago: (n) => `${n} days ago`,
    detectedText: `${esc(totals.flood_km2)} km² of open water in ${esc(totals.patches)} patches`,
    cannot: "What this layer cannot see.", limitation: esc(o.limitations), notTruth: esc(o.not_ground_truth),
    event: "The event, and our sanity check", eventName: "Event", arrived: "Flood arrived",
    peak: "River peak", reported: "Reported",
    sanity: `This layer detects ${esc(totals.flood_km2)} km²${share !== null ? `, about ${share}% of that reported figure` : ""}. The spatial pattern matches the event: the northern upazilas, hit first by the flash flood off the hills, hold the most water. The magnitude does not, for two stated reasons — this pass was taken on the day the flood arrived, not at the peak two days later, and open-water detection misses flooded villages and cropland. No accuracy figure is claimed: no validated flood map exists for this event.`,
    photo: "Satellite photo — reference", taken: "Taken", scene: "Scene", remember: "Remember",
    photoNote: img ? esc(img.optical.note) : "",
    radar: "The two radar pictures",
    radarNote: img ? `The radar view shows the two passes the flood layer was computed from: ${fmtDate(img.radar.before.date)} and ${fmtDate(img.radar.during.date)}. Radar sees smooth water as dark. Brightness is scaled for display only.` : "",
    terrain: "Terrain — reference", elevation: "Elevation",
    elevationText: `${esc(pack.terrain.elevation_m.min)} to ${esc(pack.terrain.elevation_m.max)} m`,
    limits: "Limits", reference: "Roads, rivers, places, shelters — reference",
    shelterNote: esc(pack.context.note), roadsNote: esc(pack.context.roads_note),
    device: "This device", pack: "Pack", built: "Built", loaded: "Loaded from", network: "Network",
  };

  el("panel-source").innerHTML = `
    <h2>${L.title}</h2>
    <h3>${L.flood}</h3>
    <dl class="meta">
      <dt>${L.sensor}</dt><dd>${esc((o.sensor_detail || o.sensor).replace(/^Sentinel-1\b/, o.platform || "Sentinel-1"))}</dd>
      <dt>${L.product}</dt><dd>${esc(o.product) || "&mdash;"}</dd>
      <dt>${L.observed}</dt><dd>${when}${age !== null ? ` &mdash; ${L.ago(age)}` : ""}</dd>
      <dt>${L.baseline}</dt><dd>${fmtDate(o.baseline_date)}</dd>
      <dt>${L.detected}</dt><dd>${L.detectedText}</dd>
      <dt>${L.threshold}</dt><dd>${esc(o.threshold)} &mdash; ${esc(o.threshold_method)}</dd>
      <dt>${L.source}</dt><dd>${esc(o.source)}</dd>
      <dt>${L.method}</dt><dd>${esc(o.method)}</dd>
    </dl>
    <div class="limit"><b>${L.cannot}</b> ${L.limitation}</div>
    <p class="plain">${L.notTruth}</p>
    <h3>${L.event}</h3>
    <dl class="meta">
      <dt>${L.eventName}</dt><dd>${esc(event.name) || "&mdash;"}</dd>
      <dt>${L.arrived}</dt><dd>${esc(event.flood_arrived) || "&mdash;"}</dd>
      <dt>${L.peak}</dt><dd>${esc(event.river_peak) || "&mdash;"}</dd>
      <dt>${L.reported}</dt><dd>${esc(event.reported_flooded_km2)} km² &mdash; ${esc(event.reported_source)}</dd>
    </dl>
    <p class="plain">${L.sanity}</p>
    ${img ? `<h3>${L.photo}</h3>
    <dl class="meta">
      <dt>${L.sensor}</dt><dd>${esc(img.optical.sensor)} &mdash; ${esc(img.optical.product)}</dd>
      <dt>${L.taken}</dt><dd>${fmtDate(img.optical.date)}, ${passClock(img.optical.time_utc)}</dd>
      <dt>${L.scene}</dt><dd class="mono" style="font-size:0.75rem;word-break:break-all">${esc(img.optical.scene)}</dd>
      <dt>${L.source}</dt><dd>${esc(img.optical.source)}</dd>
      <dt>${L.remember}</dt><dd>${L.photoNote}</dd>
    </dl>
    <h3>${L.radar}</h3><p class="plain">${L.radarNote}</p>` : ""}
    <h3>${L.terrain}</h3>
    <dl class="meta">
      <dt>${L.source}</dt><dd>${esc(pack.terrain.source)}</dd>
      <dt>${L.elevation}</dt><dd>${L.elevationText}</dd>
      <dt>${L.limits}</dt><dd>${esc(pack.terrain.limitations)}</dd>
    </dl>
    <h3>${L.reference}</h3>
    <p class="plain">${esc(pack.context.attribution)}. ${L.shelterNote}</p>
    <p class="plain dim">${L.roadsNote}</p>
    <h3>${L.device}</h3>
    <dl class="meta">
      <dt>${L.pack}</dt><dd>${esc(pack.pack_id)} &mdash; ${esc(bn ? pack.name_bn || pack.name : pack.name)}</dd>
      <dt>${L.built}</dt><dd>${fmtDate(pack.built_on)}</dd>
      <dt>${L.loaded}</dt><dd>${esc(sourceText())}</dd>
      <dt>${L.network}</dt><dd>${text.linkWords[state.link]}</dd>
    </dl>`;
}

function sourceText() {
  const words = S().loadedFrom;
  if (!state.source) return "";
  return state.source.key === "file" ? words.file(state.source.file, state.source.kept) : words[state.source.key];
}

function renderReports() {
  const text = S();
  const count = state.reports.length;
  // Newest first: after an accidental tap, the report to delete is the one at the top.
  const newestFirst = state.reports.map((report, index) => [report, index]).reverse();
  const locale = state.lang === "bn" ? "bn-BD" : "en-GB";
  const list = count
    ? `<ul class="reports">` + newestFirst.map(([report, index]) => `
        <li><div class="body"><span class="kind">${report.type === "water_here" ? text.waterHere : text.roadCut}</span>
          &middot; #${num(index + 1)} &middot; ${report.lat.toFixed(4)}, ${report.lon.toFixed(4)}
          ${report.area ? "&middot; " + esc(areaName(report.area)) : ""}
          <div class="when">${new Date(report.at).toLocaleString(locale)} &middot;
            ${report.accuracy_m ? text.gpsAcc(num(Math.round(report.accuracy_m))) : text.atCrosshair}</div></div>
          <button data-delete="${esc(report.id)}" aria-label="${text.deleteAria(num(index + 1))}">${text.delete}</button></li>`).join("")
      + `</ul>`
    : `<p class="plain">${text.reportsEmpty}</p>`;

  el("panel-reports").innerHTML = `
    <h2>${text.reportsTitle(num(count))}</h2>
    ${list}
    <button class="wide solid" id="export-file">${text.exportBtn}</button>
    <div id="export-out"></div>
    <p class="plain dim">${text.reportsStored}</p>
    ${count ? `<button class="wide danger far${state.deleteAllArmed ? " armed" : ""}" id="clear-reports">${
      state.deleteAllArmed ? text.deleteAllArmed(num(count)) : text.deleteAll}</button>` : ""}`;

  el("export-file").addEventListener("click", exportReports);
  el("panel-reports").querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteReport(button.dataset.delete));
  });
  const clear = el("clear-reports");
  if (clear) {
    // Two separate taps, because this destroys every observation on the device and cannot be
    // undone. A double tap is not a decision, so the second tap only counts after a pause, and a
    // primed button disarms itself rather than wait for a stray thumb.
    clear.addEventListener("click", () => {
      if (!state.deleteAllArmed) {
        const armedAt = Date.now();
        state.deleteAllArmed = armedAt;
        renderReports();
        setTimeout(() => {
          if (state.deleteAllArmed !== armedAt) return;
          state.deleteAllArmed = false;
          if (state.panel === "reports") renderReports();
        }, DELETE_ALL_DISARM_MS);
        return;
      }
      if (Date.now() - state.deleteAllArmed < DELETE_ALL_PAUSE_MS) return;
      state.reports = [];
      state.lastId = null;
      state.deleteAllArmed = false;
      saveReports();
      hideNote();
      afterReportsChanged();
    });
  }
}

/* ------------------------------------------------------------------ field reports */

function buzz() {
  // A short vibration confirms the tap without the operator having to look. Silently skipped
  // where unsupported.
  try {
    if (navigator.vibrate) navigator.vibrate(70);
  } catch (error) { /* not supported */ }
}

function updateCounts() {
  const water = state.reports.filter((report) => report.type === "water_here").length;
  const road = state.reports.filter((report) => report.type === "road_cut").length;
  el("n-water").textContent = S().recorded(num(water));
  el("n-road").textContent = S().recorded(num(road));
}

function afterReportsChanged() {
  updateCounts();
  updateReadout();
  draw();
  if (state.panel === "reports" || state.panel === "layers") refreshPanel();
}

/* The box above the report buttons. It is a state, not a toast: nothing times out, so an operator
   who looked away still finds it. It goes when they tap its words, move the map, or record again.
   It is stored as what it MEANS, so switching language rewrites it in the other language. */
function showNote(kind, args, undo) {
  state.note = { kind, args, undo };
  renderNote();
}

function renderNote() {
  if (!state.note) {
    el("confirm").hidden = true;
    return;
  }
  const text = S();
  const { kind, args, undo } = state.note;
  const typeName = (type) => (type === "water_here" ? text.waterHere : text.roadCut);
  el("confirm-text").innerHTML =
    kind === "saved" ? text.noteSaved(typeName(args.type), num(args.n), args.stored, args.gps)
    : kind === "removed" ? text.noteRemoved(typeName(args.type), num(args.left))
    : text.noteNoFix(text.gps[state.gpsProblem]);
  el("confirm-undo").hidden = !undo;
  el("confirm").hidden = false;
}

function hideNote() {
  state.note = null;
  el("confirm").hidden = true;
}

function addReport(type) {
  if (!state.pack) return;
  if (state.panel) togglePanel(state.panel);      // close it, so the confirmation can be seen
  const point = state.fix ? [state.fix.lon, state.fix.lat]
                          : unproject(canvas.width / 2, canvas.height / 2);
  updateReadout();                                 // so state.here names this exact point
  const report = {
    id: `r${Date.now().toString(36)}${state.reports.length}`,
    type,
    lon: Number(point[0].toFixed(6)),
    lat: Number(point[1].toFixed(6)),
    at: new Date().toISOString(),
    accuracy_m: state.fix ? state.fix.accuracy : null,
    placed: state.fix ? "gps" : "crosshair",
    area: state.here || "",
    pack_id: state.pack.pack_id,
    hazard: state.pack.hazard.type,
    source: "field observation",
  };
  state.reports.push(report);
  state.lastId = report.id;
  const stored = saveReports();
  buzz();
  afterReportsChanged();
  showNote("saved", { type, n: state.reports.length, stored, gps: Boolean(state.fix) }, true);
}

function deleteReport(id) {
  const index = state.reports.findIndex((report) => report.id === id);
  if (index < 0) return null;
  const [removed] = state.reports.splice(index, 1);
  if (state.lastId === id) {       // the box was about this report: it must not say it still exists
    state.lastId = null;
    hideNote();
  }
  saveReports();
  afterReportsChanged();
  return removed;
}

function undoLast() {
  if (!state.lastId) return;
  const removed = deleteReport(state.lastId);
  if (!removed) return;
  buzz();
  showNote("removed", { type: removed.type, left: state.reports.length }, false);
}

/* Export is a file, not an upload. A field team hands observations over the same way it received
   the pack: as a file, through whatever channel exists when connectivity returns. GeoJSON, so any
   GIS or humanitarian system can read it without our software. */
function exportReports() {
  const text = S();
  if (!state.reports.length) {
    el("export-out").innerHTML = `<p class="plain">${text.exportNone}</p>`;
    return;
  }
  const collection = {
    type: "FeatureCollection",
    generator: "Ingito field instrument",
    exported_at: new Date().toISOString(),
    pack_id: state.pack.pack_id,
    note: "Human field observations. NOT satellite-derived. Each feature carries its own time and position.",
    features: state.reports.map((report) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [report.lon, report.lat] },
      properties: {
        id: report.id,
        observation: report.type,
        source: "field observation",
        recorded_at: report.at,
        accuracy_m: report.accuracy_m,
        placed_by: report.placed,
        area: report.area,
        hazard: report.hazard,
        pack_id: report.pack_id,
      },
    })),
  };
  const json = JSON.stringify(collection, null, 2);
  let link = "";
  try {
    const url = URL.createObjectURL(new Blob([json], { type: "application/geo+json" }));
    link = `<a class="wide solid" style="display:grid;place-items:center;text-decoration:none"
      href="${url}" download="ingito-field-reports.geojson">${text.saveFile}</a>`;
  } catch (error) {
    link = "";
  }
  // The text box is not decoration: if a browser blocks downloads, the operator can still copy
  // the observations out by hand. The information has to be able to leave the device.
  el("export-out").innerHTML = link +
    `<p class="plain">${text.exportCopy(num(state.reports.length))}</p><textarea readonly>${json.replace(/</g, "&lt;")}</textarea>`;
}

/* ------------------------------------------------------------------ position */

const GPS_PROBLEMS = { 1: "refused", 2: "unavailable", 3: "searching" };

function startWatching() {
  if (!navigator.geolocation) {                // the WHERE slot already says "no GPS"
    state.gpsProblem = "none";
    return;
  }
  // GPS needs no network. This keeps working in airplane mode, which is the entire point.
  navigator.geolocation.watchPosition(
    (position) => {
      state.fix = { lon: position.coords.longitude, lat: position.coords.latitude,
                    accuracy: position.coords.accuracy };
      updateReadout();
      draw();
    },
    // No fix: the readout keeps reading the crosshair, and Locate says why.
    (error) => { state.gpsProblem = GPS_PROBLEMS[error.code] || "searching"; },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  state.watching = true;
}

/* ------------------------------------------------------------------ the band, language, theme */

function status() {
  const text = S();
  const net = el("chip-net");
  net.textContent = text.net[state.link];
  // Offline is the expected state in the field, not an error: shown bright, not red.
  net.className = state.link === "online" || state.link === "checking" ? "" : "lit";

  const pack = state.pack;
  el("key").hidden = !pack;
  if (pack) {
    const radarView = state.lens && pack.imagery;
    el("key-swatch").className = radarView ? "swatch radar" : "swatch";
    el("key-text").textContent = radarView ? text.keyRadar : text.keyFlood;
    // The pass as telemetry, date FIRST: when a narrow screen cuts the line, it cuts the sensor
    // name, never the day the water was seen.
    const o = pack.observation;
    el("tele").textContent = text.tele(fmtDate(o.acquisition_date), passClock(o.acquisition_time_utc),
                                       o.platform || o.sensor).replace(/ · {2}·/, " ·");
  }
  if (state.panel === "source") renderSource();
}

function applyTheme() {
  const dark = state.theme === "dark";
  document.documentElement.dataset.theme = state.theme;
  el("theme-icon").innerHTML = `<use href="#${dark ? "i-sun" : "i-moon"}"/>`;
  el("theme").setAttribute("aria-label", dark ? S().toLight : S().toDark);
}

/* Switching language rewrites every word on screen, the open panel, the note box and the map's
   own labels - there is no half-translated state. */
function applyLang() {
  const text = S();
  document.documentElement.lang = state.lang;
  document.querySelectorAll("#lang [data-lang]").forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.lang === state.lang)));
  document.querySelectorAll("[data-t]").forEach((node) => { node.textContent = text[node.dataset.t]; });
  el("lens-text").textContent = text.lens;
  el("lens").setAttribute("aria-label", text.lens);
  el("zoom-in").setAttribute("aria-label", text.zoomIn);
  el("zoom-out").setAttribute("aria-label", text.zoomOut);
  el("hint").textContent = text.hint;
  if (state.pack?.imagery) {
    el("pill-before").textContent = text.before(fmtDate(state.pack.imagery.radar.before.date));
    el("pill-during").textContent = text.during(fmtDate(state.pack.imagery.radar.during.date));
  }
  applyTheme();
  updateCounts();
  status();
  updateReadout();
  refreshPanel();
  renderNote();
  if (state.found !== undefined && !el("gate").hidden) renderGate();
  draw();
  if (document.fonts?.ready) document.fonts.ready.then(draw);   // map labels in the new script
}

function setLens(on) {
  state.lens = Boolean(on && state.pack?.imagery);
  el("lens").setAttribute("aria-pressed", String(state.lens));
  el("compare").hidden = !state.lens;
  if (state.lens) {
    el("hint").hidden = true;
    remember(HINT_KEY, "seen");
  }
  status();
  draw();
}

/* ------------------------------------------------------------------ pack loading */

function picture(src) {
  if (!src) return null;
  const image = new Image();
  image.onload = draw;            // plain load events: decode() can hang on a data URI
  image.onerror = draw;
  image.src = src;
  return image;
}

function openPack(text, source) {
  const pack = JSON.parse(text);
  if (!pack.format || !pack.format.startsWith("ingito.pack/")) {
    throw new Error("that file is not an Ingito pack");
  }
  state.pack = pack;
  state.source = source;
  state.images = {
    terrain: picture(pack.terrain?.image),
    optical: picture(pack.imagery?.optical?.image),
    before: picture(pack.imagery?.radar?.before?.image),
    during: picture(pack.imagery?.radar?.during?.image),
  };

  el("gate").hidden = true;
  el("reticle").hidden = false;
  el("controls").hidden = false;
  el("lens").hidden = !pack.imagery;
  el("hint").hidden = !pack.imagery || remembered(HINT_KEY) === "seen";
  resize();                        // the canvas needs its real size before the view is fitted
  openOnWater(pack);
  applyLang();
}

async function listPacks() {
  for (const url of INDEX_URLS) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return { list: (await response.json()).packs || [], base: url.replace("index.json", "") };
      }
    } catch (error) {
      /* offline, or not served next to a packs folder: fall through to the file picker */
    }
  }
  return null;
}

/* Download with a byte count. This is the one moment before deployment when somebody on a poor
   connection must decide whether to keep waiting, so it shows a number, not a spinner. */
async function downloadText(url, expectedBytes) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const total = Number(response.headers.get("Content-Length")) || expectedBytes || 0;
  if (!response.body || !response.body.getReader) return response.text();
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    el("progress").textContent = S().downloading(num((received / 1048576).toFixed(1)),
      total ? num((total / 1048576).toFixed(1)) : "", num(total ? Math.floor((100 * received) / total) : 0));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

function renderGate() {
  const text = S();
  const card = el("gate-card");
  const found = state.found;
  if (!found || !found.list.length) {
    card.innerHTML = `<div class="line"><span>${text.noPacks}</span></div>
       <div class="line dim"><span>${text.noPacksHelp}</span></div>`;
    return;
  }
  card.innerHTML = found.list.map((entry) => `
    <div class="line"><span><b>${esc(entry.name)}</b></span><span>${num(esc(entry.size_mb))} MB</span></div>
    <div class="line dim"><span>${esc(entry.hazard)} &middot; ${esc(entry.sensor)} ${fmtDate(entry.acquisition_date)}</span>
      <span>${num(esc(entry.area_km2))} km²</span></div>
    <button class="wide solid" data-pack="${esc(found.base + entry.file)}"
      data-bytes="${Math.round(entry.size_mb * 1048576)}">${text.downloadPack}</button>`).join("");
  card.querySelectorAll("[data-pack]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      el("progress").textContent = S().starting;
      try {
        const packText = await downloadText(button.dataset.pack, Number(button.dataset.bytes));
        el("progress").textContent = S().storing;
        const kept = await cachePack(packText);
        openPack(packText, { key: kept ? "device" : "downloadedNotStored" });
        el("progress").textContent = kept ? "" : S().refusedStorage;
        startWatching();
      } catch (error) {
        button.disabled = false;
        el("progress").textContent = S().couldNot(error.message);
      }
    });
  });
}

async function boot() {
  loadReports();
  const savedTheme = remembered(THEME_KEY);
  state.theme = savedTheme === "dark" || savedTheme === "light" ? savedTheme
    : (globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  // Bilingual from the first second: a phone set to Bangla opens in Bangla, anything else in
  // English, and the switch is always on screen either way.
  const savedLang = remembered(LANG_KEY);
  state.lang = savedLang === "bn" || savedLang === "en" ? savedLang
    : ((navigator.languages || [navigator.language]).some((code) => /^bn\b/i.test(code || "")) ? "bn" : "en");
  applyLang();

  globalThis.addEventListener("online", probe);
  globalThis.addEventListener("offline", probe);
  globalThis.addEventListener("resize", () => { resize(); draw(); });
  probe();
  setInterval(probe, PROBE_EVERY_MS);

  if ("serviceWorker" in navigator) {
    // The worker keeps the instrument itself openable with no network. If registration is refused
    // (some embedded browsers refuse it), the pack in Cache Storage still works.
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // A published page carries its own pack. If this device holds an OLDER copy of that same pack,
  // the page's copy wins - otherwise an updated page would keep showing last week's pack. A
  // different pack the operator opened by hand is never replaced.
  const superseded = (text) => {
    try {
      const head = JSON.parse(text);
      // built_at is to the second; older packs only carry the day, which still sorts earlier.
      return Boolean(EMBEDDED) && head.pack_id === EMBEDDED.pack_id &&
        String(head.built_at || head.built_on) < String(EMBEDDED.built_at || EMBEDDED.built_on);
    } catch (error) {
      return false;
    }
  };
  const stored = await cachedPack();
  if (stored && !superseded(stored)) {
    try {
      openPack(stored, { key: "device" });
      startWatching();
      return;
    } catch (error) {
      /* a corrupt stored pack must not lock the operator out: fall through to the gate */
    }
  }

  const found = await listPacks();
  if ((!found || !found.list.length) && EMBEDDED) {
    try {
      const text = JSON.stringify(EMBEDDED);
      const kept = await cachePack(text);
      openPack(text, { key: kept ? "embeddedKept" : "embedded" });
      startWatching();
      return;
    } catch (error) {
      /* fall through to the gate and let the operator open a file */
    }
  }

  state.found = found;
  renderGate();
  el("pack-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    el("progress").textContent = S().reading(file.name);
    try {
      const text = await file.text();
      const kept = await cachePack(text);
      openPack(text, { key: "file", file: file.name, kept });
      startWatching();
      el("progress").textContent = "";
    } catch (error) {
      el("progress").textContent = S().notPack(error.message);
    }
  });
}

/* ------------------------------------------------------------------ input */

/*
  One finger pans - or, in the radar view, drags the before/after line when it starts on it.
  Two fingers pinch to zoom about the point between them. Nothing moves on its own.
*/
function bind() {
  const pointers = new Map();
  let gesture = null;
  const at = (event) => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, width: box.width };
  };
  const startPan = (p) => ({ kind: "pan", x: p.x, y: p.y, lon: state.view.lon, lat: state.view.lat });

  canvas.addEventListener("pointerdown", (event) => {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) { /* a pointer already gone must not cost the gesture its second finger */ }
    const p = at(event);
    pointers.set(event.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { kind: "pinch", spread: Math.hypot(a.x - b.x, a.y - b.y) || 1, ppd: state.view.ppd };
    } else if (state.lens && Math.abs(p.x - state.split * p.width) < 30) {
      gesture = { kind: "split" };
    } else {
      gesture = startPan(p);
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    const p = at(event);
    pointers.set(event.pointerId, p);
    const ratio = globalThis.devicePixelRatio || 1;
    if (gesture.kind === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const spread = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const target = (gesture.ppd * spread) / gesture.spread;
      zoomAt(target / state.view.ppd, ((a.x + b.x) / 2) * ratio, ((a.y + b.y) / 2) * ratio);
      hideNote();
      draw();
    } else if (gesture.kind === "split") {
      state.split = Math.min(Math.max(p.x / p.width, 0.03), 0.97);
      draw();
    } else if (gesture.kind === "pan") {
      hideNote();                // moving on: the box steps aside so the reticle is never hidden
      const squeeze = Math.cos((state.view.lat * Math.PI) / 180);
      state.view.lon = gesture.lon - ((p.x - gesture.x) * ratio) / (state.view.ppd * squeeze);
      state.view.lat = gesture.lat + ((p.y - gesture.y) * ratio) / state.view.ppd;
      draw();
    }
  });
  const end = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 1 && gesture?.kind === "pinch") {
      gesture = startPan([...pointers.values()][0]);   // lift one finger: keep panning with the other
    } else if (pointers.size === 0) {
      gesture = null;
      updateReadout();
    }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const box = canvas.getBoundingClientRect();
    const ratio = globalThis.devicePixelRatio || 1;
    zoomAt(event.deltaY < 0 ? 1.25 : 0.8, (event.clientX - box.left) * ratio, (event.clientY - box.top) * ratio);
    updateReadout();
    draw();
  }, { passive: false });

  el("zoom-in").addEventListener("click", () => zoom(1.5));
  el("zoom-out").addEventListener("click", () => zoom(1 / 1.5));
  el("lens").addEventListener("click", () => setLens(!state.lens));
  el("hint").addEventListener("click", () => setLens(true));
  el("btn-water").addEventListener("click", () => addReport("water_here"));
  el("btn-road").addEventListener("click", () => addReport("road_cut"));
  el("confirm-undo").addEventListener("click", undoLast);
  el("confirm-text").addEventListener("click", hideNote);
  el("tool-layers").addEventListener("click", () => togglePanel("layers"));
  el("tool-source").addEventListener("click", () => togglePanel("source"));
  el("tool-reports").addEventListener("click", () => togglePanel("reports"));
  document.querySelectorAll("#lang [data-lang]").forEach((button) => {
    button.addEventListener("click", () => {
      state.lang = button.dataset.lang;
      remember(LANG_KEY, state.lang);
      applyLang();
    });
  });
  el("theme").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    remember(THEME_KEY, state.theme);
    applyTheme();
    refreshPanel();
  });
  el("tool-locate").addEventListener("click", () => {
    if (!state.watching) startWatching();
    if (state.fix) {
      state.view.lon = state.fix.lon;
      state.view.lat = state.fix.lat;
      state.view.ppd = Math.max(state.view.ppd, 6000);
      updateReadout();
      draw();
    } else {
      // A tap that changes nothing looks like a broken button. Say what is happening instead.
      showNote("nofix", {}, false);
    }
  });
}

function zoom(factor) {
  zoomAt(factor);
  updateReadout();
  draw();
}

bind();
boot();
