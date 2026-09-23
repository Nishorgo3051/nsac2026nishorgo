/*
  PROHORI - the field instrument.

  Three jobs, in the order a responder needs them:
    1. Hold one disaster pack on the device and keep working when the network dies.
    2. Answer: where am I, which routes are under water, where is the nearest shelter.
    3. Send the operator's own observations back: "water here" and "road cut".

  The rule that shapes this whole file: three kinds of information are never mixed.
    SATELLITE   the radar hazard layer, drawn as a blue fill, with its sensor and dates attached.
    REFERENCE   terrain, roads, waterways, shelters - geography, drawn as lines and squares.
    FIELD       what the operator saw, drawn as magenta circles and triangles, stored separately,
                exported separately.
  A field report never becomes part of the satellite layer, and the satellite layer is never
  presented as ground truth.

  No map library and no CDN: both would need a network in exactly the situation this is built for.
  The map is drawn on a canvas from the pack's own coordinates.
*/

const PACK_CACHE = "prohori-pack-v1";
const PACK_KEY = "/__prohori_pack__";          // cache key for whichever pack is loaded
const REPORTS_KEY = "prohori.reports.v1";
const THEME_KEY = "prohori.theme.v1";
const INDEX_URLS = ["../packs/index.json", "packs/index.json"];
const PROBE_EVERY_MS = 20000;
const PROBE_TIMEOUT_MS = 4000;
/* A published build (an artifact page, or a single HTML file sent to somebody) has no packs folder
   to fetch from, so the pack can be embedded in the page instead. The instrument labels it
   "embedded in this page" so nobody mistakes a demonstration copy for a real field install. */
const EMBEDDED = globalThis.PROHORI_PACK || null;

/*
  Two palettes with IDENTICAL meanings. Only luminance changes between them.
  Night mode never uses white: a bright screen at night destroys the operator's dark adaptation
  and turns the phone into a lamp. Every text pair in both palettes was measured with the WCAG
  formula (see index.html); the map marks are also separated by shape, never by colour alone.
*/
const PALETTES = {
  day: {
    paper: "#ffffff", ink: "#000000", dim: "#3d3d3d",
    floodFill: "rgba(26, 78, 216, 0.42)", floodFillFar: "rgba(26, 78, 216, 0.85)", floodEdge: "#1a4ed8",
    report: "#b0005a", reportRing: "#000000",
    fix: "#e05a00", fixRing: "#000000",
    shelter: "#00722c", shelterRing: "#000000",
    road: "#000000", wetCasing: "#000000", wetDash: "#ffffff",
    waterway: "#2e5e5e", admin: "#6b6b6b",
    terrainAlpha: 0.38, halo: "#ffffff",
  },
  night: {
    paper: "#000000", ink: "#ffb000", dim: "#b07a00",
    floodFill: "rgba(77, 124, 255, 0.40)", floodFillFar: "rgba(77, 124, 255, 0.85)", floodEdge: "#4d7cff",
    report: "#ff3d9a", reportRing: "#ffb000",
    fix: "#ff7a1a", fixRing: "#ffb000",
    shelter: "#1faa55", shelterRing: "#000000",
    // The wet-road casing uses the dim amber: at full brightness a DERIVED layer became the
    // loudest mark on the night map, louder than the radar observation it is derived from.
    road: "#9a6a00", wetCasing: "#b07a00", wetDash: "#000000",
    waterway: "#3f7f7f", admin: "#5a4a1a",
    terrainAlpha: 0.22, halo: "#000000",
  },
};

/*
  Declutter by zoom. At district view a phone has about 450 pixels for 55 km, so 1,853 village
  roads and every stream would render as a solid mesh and bury the flood layer. Minor features
  appear as you zoom in; the flood layer, main roads, rivers, wet roads and shelters are always on.
  Thresholds are metres per screen pixel.
*/
const MINOR_ROADS = new Set(["unclassified"]);
const MINOR_WATER = new Set(["stream", "drain"]);
const SHOW_MINOR_BELOW = 25;
const OUTLINE_FLOOD_BELOW = 30;
const LABEL_SHELTERS_BELOW = 6;

const el = (id) => document.getElementById(id);
const canvas = el("map");
const ctx = canvas.getContext("2d");

const state = {
  pack: null,
  terrainImage: null,
  source: null,
  view: { lon: 0, lat: 0, ppd: 1 },        // ppd = device pixels per degree of latitude
  fix: null,                               // {lon, lat, accuracy} from the device GPS
  watching: false,
  reports: [],
  lastId: null,                            // the report the UNDO button would remove
  panel: null,
  deleteAllArmed: false,
  theme: "day",
  link: "checking",                        // offline | nolink | online | checking
  layers: { terrain: true, flood: true, roads: true, wet: true, waterways: true,
            shelters: true, reports: true },
  here: "",
};

const pal = () => PALETTES[state.theme];

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
  // Reports saved before ids existed still need one, so they can be deleted individually.
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

function loadTheme() {
  try {
    state.theme = localStorage.getItem(THEME_KEY) === "night" ? "night" : "day";
  } catch (error) {
    state.theme = "day";
  }
  applyTheme();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  el("chip-theme").textContent = state.theme === "night" ? "DAY" : "NIGHT";
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
  The status strip must tell the truth about connectivity, and navigator.onLine cannot: it only
  knows whether a radio is switched on. A phone on a dead tower, or a laptop whose server has gone,
  still says "online". So when the radio claims a connection, we test it by actually asking for
  something. Any HTTP answer - even 404 - proves the network carried a request; only a thrown error
  or our own service worker's offline reply means the link is gone.

  The probe asks for this page itself with a ?probe= marker, which exists on every host the
  instrument can be served from. The service worker lets probe requests straight through to the
  network instead of answering them from its cache, otherwise the probe would always succeed.
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
    state.link = response.headers.get("X-Prohori-Offline") ? "nolink" : "online";
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

function bearing(from, to) {
  const dx = (to[0] - from[0]) * metresPerDegree(from[1]);
  const dy = (to[1] - from[1]) * 110540;
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const angle = (Math.atan2(dx, dy) * 180) / Math.PI;
  return names[Math.round(((angle + 360) % 360) / 45) % 8];
}

/* Ray casting: is this point inside this ring. Used to say which upazila you are standing in and
   whether the point is on detected water. */
function inRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function shortDate(iso) {
  const when = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(when.getTime())
    ? when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : iso;
}

function ageInDays(iso) {
  const then = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(then) ? Math.round((Date.now() - then) / 86400000) : null;
}

function kmText(metres) {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
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
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach(([lon, lat], i) => {
      const [x, y] = project(lon, lat);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
  }
}

const ROAD_WIDTH = { motorway: 4, trunk: 3.4, primary: 3, secondary: 2.4, tertiary: 1.9,
                     unclassified: 1.3 };

function draw() {
  const ratio = globalThis.devicePixelRatio || 1;
  if (canvas.width !== Math.round(canvas.clientWidth * ratio)) resize();
  const p = pal();
  ctx.fillStyle = p.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state.pack) return;
  const pack = state.pack;
  const mpp = metresPerScreenPixel();
  const detailed = mpp < SHOW_MINOR_BELOW;

  // Terrain first and faint: it is context for where water will run, not the subject.
  if (state.layers.terrain && state.terrainImage && state.terrainImage.complete) {
    const [west, south, east, north] = pack.terrain.bounds;
    const [x0, y0] = project(west, north);
    const [x1, y1] = project(east, south);
    ctx.globalAlpha = p.terrainAlpha;
    ctx.drawImage(state.terrainImage, x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 1;
  }

  // Upazila boundaries: dashed, so they cannot be mistaken for roads or rivers.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const area of pack.areas || []) {
    ringPath(area.rings);
    ctx.setLineDash([6 * ratio, 5 * ratio]);
    ctx.lineWidth = 1.4 * ratio;
    ctx.strokeStyle = p.admin;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (state.layers.waterways) {
    for (const way of pack.context.waterways || []) {
      if (!detailed && MINOR_WATER.has(way.kind)) continue;
      strokeLine(way.coords, (way.kind === "river" ? 2.4 : 1.4) * ratio, p.waterway);
    }
  }

  // SATELLITE OBSERVATION. The only blue on the map, and the only filled area.
  if (state.layers.flood) {
    ringPath((pack.observation.features || []).flatMap((feature) => feature.rings));
    const near = mpp < OUTLINE_FLOOD_BELOW;
    // Far out, most of the 1,159 patches are a single pixel, so a see-through fill disappears and
    // the one layer the instrument exists to carry goes faint. Far: nearly solid. Near: see-through,
    // so the roads and terrain under the water stay readable. The edge is always drawn: it is what
    // guarantees even the smallest patch at least two pixels on screen.
    ctx.fillStyle = near ? p.floodFill : p.floodFillFar;
    ctx.fill();
    ctx.lineWidth = 1.2 * ratio;
    ctx.strokeStyle = p.floodEdge;
    ctx.stroke();
  }

  if (state.layers.roads) {
    for (const road of pack.context.roads || []) {
      if (!detailed && MINOR_ROADS.has(road.kind)) continue;
      strokeLine(road.coords, (ROAD_WIDTH[road.kind] || 1.3) * ratio, p.road);
    }
  }

  // Roads crossing radar-detected water. A DERIVED product, not an observation, so it is drawn as
  // a road with a dashed casing - a shape - rather than in the satellite's blue. Always shown,
  // whatever the zoom: there are only a few dozen, and they answer "which routes are under water".
  if (state.layers.wet) {
    for (const road of pack.context.roads || []) {
      if (!road.wet) continue;
      const width = (ROAD_WIDTH[road.kind] || 1.3) * ratio;
      strokeLine(road.coords, width + 5 * ratio, p.wetCasing);
      strokeLine(road.coords, Math.max(1.8 * ratio, width), p.wetDash, [5 * ratio, 4 * ratio]);
    }
  }

  if (state.layers.shelters) {
    const size = (mpp > 40 ? 6 : 10) * ratio;
    const label = mpp < LABEL_SHELTERS_BELOW;
    ctx.font = `700 ${13 * ratio}px system-ui, sans-serif`;
    for (const shelter of pack.context.shelters || []) {
      const [x, y] = project(shelter.lon, shelter.lat);
      if (x < -20 || y < -20 || x > canvas.width + 20 || y > canvas.height + 20) continue;
      ctx.fillStyle = p.shelter;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      ctx.lineWidth = 1.8 * ratio;
      ctx.strokeStyle = p.shelterRing;
      ctx.strokeRect(x - size / 2, y - size / 2, size, size);
      if (label && shelter.name) {
        ctx.lineWidth = 4 * ratio;
        ctx.strokeStyle = p.halo;             // a halo keeps the name legible over any layer
        ctx.strokeText(shelter.name, x + size, y + 4 * ratio);
        ctx.fillStyle = p.ink;
        ctx.fillText(shelter.name, x + size, y + 4 * ratio);
      }
    }
  }

  // FIELD OBSERVATIONS last, so satellite data can never cover them. Circle = water here,
  // triangle = road cut: distinguishable without seeing colour at all.
  if (state.layers.reports) {
    for (const report of state.reports) {
      const [x, y] = project(report.lon, report.lat);
      const size = 17 * ratio;
      ctx.beginPath();
      if (report.type === "water_here") {
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      } else {
        ctx.moveTo(x, y - size / 2);
        ctx.lineTo(x + size / 2, y + size / 2);
        ctx.lineTo(x - size / 2, y + size / 2);
        ctx.closePath();
      }
      ctx.fillStyle = p.report;
      ctx.fill();
      ctx.lineWidth = 2.6 * ratio;
      ctx.strokeStyle = p.reportRing;
      ctx.stroke();
    }
  }

  if (state.fix) {
    const [x, y] = project(state.fix.lon, state.fix.lat);
    if (state.fix.accuracy) {
      ctx.beginPath();
      ctx.arc(x, y, (state.fix.accuracy / 110540) * state.view.ppd, 0, Math.PI * 2);
      ctx.lineWidth = 2 * ratio;
      ctx.strokeStyle = p.fix;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, 9 * ratio, 0, Math.PI * 2);
    ctx.fillStyle = p.fix;
    ctx.fill();
    ctx.lineWidth = 3 * ratio;
    ctx.strokeStyle = p.fixRing;
    ctx.stroke();
  }

  drawScale(ratio);
}

function drawScale(ratio) {
  const metres = ((120 * ratio) / state.view.ppd) * 110540;
  const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  const pick = steps.find((step) => step >= metres) || steps[steps.length - 1];
  el("scale").hidden = false;
  el("scale").textContent = pick >= 1000 ? `${pick / 1000} km` : `${pick} m`;
  el("scale").style.minWidth = `${Math.round(((pick / 110540) * state.view.ppd) / ratio)}px`;
}

/* ------------------------------------------------------------------ readout */

/*
  The three field questions, in three fixed slots that never move: WHERE, WATER, SHELTER.
  The slots read from the GPS fix when there is one and from the crosshair when there is not,
  because a responder without a fix still has to read the map. Distance and bearing come FIRST in
  the shelter slot, so if a long name is cut off the actionable part survives.
*/
function updateReadout() {
  if (!state.pack) return;
  const pack = state.pack;
  const point = state.fix ? [state.fix.lon, state.fix.lat]
                          : unproject(canvas.width / 2, canvas.height / 2);

  let area = "outside the pack area";
  for (const candidate of pack.areas || []) {
    if (candidate.rings.some((ring) => inRing(ring, point[0], point[1]))) {
      area = candidate.name;
      break;
    }
  }
  state.here = area;

  const from = state.fix ? `GPS ±${Math.round(state.fix.accuracy || 0)} m` : "crosshair";
  el("r-where").textContent = `${area} · ${point[1].toFixed(4)}, ${point[0].toFixed(4)} (${from})`;

  const onWater = (pack.observation.features || []).some((feature) =>
    feature.rings.some((ring) => inRing(ring, point[0], point[1])));
  const observed = shortDate(pack.observation.acquisition_date);
  const water = el("r-water");
  const sub = el("r-water-sub");
  if (onWater) {
    water.textContent = `RADAR SAW OPEN WATER HERE · ${observed}`;
    water.className = "v hit";
    sub.hidden = true;
  } else {
    water.textContent = `None seen by radar · ${observed}`;
    water.className = "v";
    // The limitation appears exactly when it matters: on a spot the radar called dry.
    sub.textContent = "Radar misses water under trees and between buildings. Record what you see.";
    sub.hidden = false;
  }

  let nearest = null;
  for (const shelter of pack.context.shelters || []) {
    const metres = distanceM(point, [shelter.lon, shelter.lat]);
    if (!nearest || metres < nearest.metres) nearest = { shelter, metres };
  }
  el("r-shelter").textContent = nearest
    ? `${kmText(nearest.metres)} ${bearing(point, [nearest.shelter.lon, nearest.shelter.lat])} · ` +
      (nearest.shelter.name ? `${nearest.shelter.name} (${nearest.shelter.kind})`
                            : `unnamed ${nearest.shelter.kind}`)
    : "none in this pack";

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
  if (state.panel === "layers") renderLayers();
  if (state.panel === "source") renderSource();
  if (state.panel === "reports") renderReports();
}

/* Each layer's icon IS its map mark - the same fill, line, dash or shape - so the key can be read
   without telling colours apart. */
function icon(kind) {
  const p = pal();
  const marks = {
    flood: `<rect x="3" y="5" width="22" height="14" fill="${p.floodFill}" stroke="${p.floodEdge}" stroke-width="2"/>`,
    wet: `<line x1="2" y1="12" x2="26" y2="12" stroke="${p.wetCasing}" stroke-width="8"/>` +
         `<line x1="2" y1="12" x2="26" y2="12" stroke="${p.wetDash}" stroke-width="2.5" stroke-dasharray="4 3"/>`,
    roads: `<line x1="2" y1="12" x2="26" y2="12" stroke="${p.road}" stroke-width="3.5"/>`,
    waterways: `<path d="M2 16 Q8 6 14 12 T26 8" fill="none" stroke="${p.waterway}" stroke-width="3"/>`,
    shelters: `<rect x="8" y="6" width="12" height="12" fill="${p.shelter}" stroke="${p.shelterRing}" stroke-width="2"/>`,
    reports: `<circle cx="8" cy="12" r="6" fill="${p.report}" stroke="${p.reportRing}" stroke-width="2"/>` +
             `<path d="M20 5 L26.5 18 L13.5 18 Z" fill="${p.report}" stroke="${p.reportRing}" stroke-width="2"/>`,
    terrain: `<path d="M2 19 L9 8 L14 14 L19 5 L26 19 Z" fill="${p.admin}" stroke="${p.ink}" stroke-width="1.5"/>`,
  };
  return `<svg class="icon" viewBox="0 0 28 24" width="36" height="30" aria-hidden="true">${marks[kind]}</svg>`;
}

function renderLayers() {
  const pack = state.pack;
  const wet = (pack.context.roads || []).filter((road) => road.wet).length;
  const rows = [
    ["flood", "Radar: open water (satellite)", (pack.observation.features || []).length],
    ["wet", "Roads crossing that water (derived)", wet],
    ["roads", "Roads", (pack.context.roads || []).length],
    ["waterways", "Rivers and canals", (pack.context.waterways || []).length],
    ["shelters", "Shelter points", (pack.context.shelters || []).length],
    ["reports", "My field reports", state.reports.length],
    ["terrain", "Terrain", ""],
  ];
  el("panel-layers").innerHTML =
    `<h2>Layers</h2><div class="rows">` +
    rows.map(([key, label, count]) =>
      `<button class="row" data-layer="${key}" aria-pressed="${state.layers[key]}">
         ${icon(key)}<span class="label">${label}</span>
         <span class="count">${count}</span>
         <span class="state">${state.layers[key] ? "ON" : "OFF"}</span>
       </button>`).join("") +
    `</div><p class="plain dim">Village roads and streams appear as you zoom in.
      ${pack.context.attribution}.</p>`;
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
  const age = ageInDays(o.acquisition_date);
  const totals = o.totals || {};
  const event = o.event || {};
  const share = event.reported_flooded_km2
    ? Math.round((100 * totals.flood_km2) / event.reported_flooded_km2) : null;
  const linkWords = {
    online: "online - a request to the network was answered",
    nolink: "radio on, but nothing answers - treat as offline",
    offline: "offline - the radio is off",
    checking: "checking",
  };
  el("panel-source").innerHTML = `
    <h2>Where this information comes from</h2>
    <h3>Hazard layer &mdash; satellite observation</h3>
    <dl class="meta">
      <dt>Hazard</dt><dd>${pack.hazard.label}</dd>
      <dt>Sensor</dt><dd>${o.sensor_detail || o.sensor}</dd>
      <dt>Product</dt><dd>${o.product || "&mdash;"}</dd>
      <dt>Observed</dt><dd>${o.acquisition_date}${age !== null ? ` &mdash; ${age} days ago` : ""}</dd>
      <dt>Baseline</dt><dd>${o.baseline_date}</dd>
      <dt>Detected</dt><dd>${totals.flood_km2} km&sup2; of open water in ${totals.patches} patches</dd>
      <dt>Threshold</dt><dd>${o.threshold} &mdash; ${o.threshold_method}</dd>
      <dt>Source</dt><dd>${o.source}</dd>
      <dt>Method</dt><dd>${o.method}</dd>
    </dl>
    <div class="limit"><b>What this layer cannot see.</b> ${o.limitations}</div>
    <p class="plain">${o.not_ground_truth}</p>
    <h3>The event, and our sanity check</h3>
    <dl class="meta">
      <dt>Event</dt><dd>${event.name || "&mdash;"}</dd>
      <dt>Flood arrived</dt><dd>${event.flood_arrived || "&mdash;"}</dd>
      <dt>River peak</dt><dd>${event.river_peak || "&mdash;"}</dd>
      <dt>Reported</dt><dd>${event.reported_flooded_km2} km&sup2; &mdash; ${event.reported_source}</dd>
    </dl>
    <p class="plain">This layer detects ${totals.flood_km2} km&sup2;${share !== null
      ? `, about ${share}% of that reported figure` : ""}. The spatial pattern matches the event:
      the northern upazilas, hit first by the flash flood off the hills, hold the most water. The
      magnitude does not, for two stated reasons &mdash; this pass was taken on the day the flood
      arrived, not at the peak two days later, and open-water detection misses flooded villages and
      cropland. No accuracy figure is claimed: no validated flood map exists for this event.</p>
    <h3>Terrain &mdash; reference</h3>
    <dl class="meta">
      <dt>Source</dt><dd>${pack.terrain.source}</dd>
      <dt>Elevation</dt><dd>${pack.terrain.elevation_m.min} to ${pack.terrain.elevation_m.max} m</dd>
      <dt>Limits</dt><dd>${pack.terrain.limitations}</dd>
    </dl>
    <h3>Roads, waterways, shelters &mdash; reference</h3>
    <p class="plain">${pack.context.attribution}. ${pack.context.note}</p>
    <p class="plain dim">${pack.context.roads_note || ""}</p>
    <h3>This device</h3>
    <dl class="meta">
      <dt>Pack</dt><dd>${pack.pack_id} &mdash; ${pack.name}</dd>
      <dt>Built</dt><dd>${pack.built_on}</dd>
      <dt>Loaded from</dt><dd>${state.source}</dd>
      <dt>Network</dt><dd>${linkWords[state.link]}</dd>
    </dl>`;
}

function renderReports() {
  const count = state.reports.length;
  const list = count
    ? `<ul class="reports">` + state.reports.map((report, index) => `
        <li><div class="body"><span class="kind">${report.type === "water_here" ? "Water here" : "Road cut"}</span>
          &middot; #${index + 1} &middot; ${report.lat.toFixed(4)}, ${report.lon.toFixed(4)}
          ${report.area ? "&middot; " + report.area : ""}
          <div class="when">${new Date(report.at).toLocaleString()} &middot;
            ${report.accuracy_m ? "GPS &plusmn; " + Math.round(report.accuracy_m) + " m"
                                : "placed at the crosshair"}</div></div>
          <button data-delete="${report.id}" aria-label="Delete report ${index + 1}">Delete</button></li>`).join("")
      + `</ul>`
    : `<p class="plain">No field reports yet. Use the two magenta buttons when you see something the
        satellite layer does not show.</p>`;

  el("panel-reports").innerHTML = `
    <h2>My field observations (${count})</h2>
    <p class="plain">Your own observations, stored on this device. They are kept separate from the
      satellite layer and never merged into it.</p>
    ${list}
    <button class="wide solid" id="export-file">Export for handover</button>
    ${count ? `<button class="wide danger${state.deleteAllArmed ? " armed" : ""}" id="clear-reports">${
      state.deleteAllArmed ? `Tap again to delete all ${count}` : "Delete all reports"}</button>` : ""}
    <div id="export-out"></div>`;

  el("export-file").addEventListener("click", exportReports);
  el("panel-reports").querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteReport(button.dataset.delete));
  });
  const clear = el("clear-reports");
  if (clear) {
    // Two taps, because this destroys every observation on the device and cannot be undone.
    clear.addEventListener("click", () => {
      if (!state.deleteAllArmed) {
        state.deleteAllArmed = true;
        renderReports();
        return;
      }
      state.reports = [];
      state.lastId = null;
      state.deleteAllArmed = false;
      saveReports();
      el("confirm").hidden = true;
      afterReportsChanged();
    });
  }
}

/* ------------------------------------------------------------------ field reports */

function buzz() {
  // A short vibration confirms the tap without the operator having to look. It is not animation,
  // and it works in glare and in a moving boat. Silently skipped where unsupported.
  try {
    if (navigator.vibrate) navigator.vibrate(70);
  } catch (error) { /* not supported */ }
}

function updateCounts() {
  const water = state.reports.filter((report) => report.type === "water_here").length;
  const road = state.reports.filter((report) => report.type === "road_cut").length;
  el("n-water").textContent = `${water} recorded`;
  el("n-road").textContent = `${road} recorded`;
}

function afterReportsChanged() {
  updateCounts();
  draw();
  if (state.panel === "reports" || state.panel === "layers") refreshPanel();
}

function addReport(type) {
  if (!state.pack) return;
  const point = state.fix ? [state.fix.lon, state.fix.lat]
                          : unproject(canvas.width / 2, canvas.height / 2);
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

  // The confirmation stays on screen until the next report or an undo. It is a state, not a toast:
  // nothing times out, so an operator who looked away still finds it when they look back.
  el("confirm-text").innerHTML =
    `${type === "water_here" ? "WATER HERE" : "ROAD CUT"} #${state.reports.length} recorded` +
    `<small>${report.lat.toFixed(4)}, ${report.lon.toFixed(4)}` +
    `${report.area ? " · " + report.area : ""} · ` +
    `${stored ? "stored on this device" : "NOT STORED - this browser refused local storage"}</small>`;
  el("confirm-undo").hidden = false;
  el("confirm").hidden = false;
}

function deleteReport(id) {
  const index = state.reports.findIndex((report) => report.id === id);
  if (index < 0) return null;
  const [removed] = state.reports.splice(index, 1);
  if (state.lastId === id) state.lastId = null;
  saveReports();
  afterReportsChanged();
  return removed;
}

function undoLast() {
  if (!state.lastId) return;
  const removed = deleteReport(state.lastId);
  if (!removed) return;
  buzz();
  el("confirm-text").innerHTML =
    `${removed.type === "water_here" ? "WATER HERE" : "ROAD CUT"} removed` +
    `<small>${state.reports.length} report${state.reports.length === 1 ? "" : "s"} left on this device</small>`;
  el("confirm-undo").hidden = true;
}

/* Export is a file, not an upload. A field team hands observations over the same way it received
   the pack: as a file, through whatever channel exists when connectivity returns. GeoJSON, so any
   GIS or humanitarian system can read it without our software. */
function exportReports() {
  if (!state.reports.length) {
    el("export-out").innerHTML = `<p class="plain">Nothing to export yet.</p>`;
    return;
  }
  const collection = {
    type: "FeatureCollection",
    generator: "Prohori field instrument",
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
  const text = JSON.stringify(collection, null, 2);
  let link = "";
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "application/geo+json" }));
    link = `<a class="wide solid" style="display:grid;place-items:center;text-decoration:none"
      href="${url}" download="prohori-field-reports.geojson">Save the file</a>`;
  } catch (error) {
    link = "";
  }
  // The text box is not decoration: if a browser blocks downloads, as some embedded viewers do,
  // the operator can still copy the observations out by hand. The information has to be able to
  // leave the device one way or another.
  el("export-out").innerHTML = link +
    `<p class="plain">${state.reports.length} observations as GeoJSON. Copy this if the file cannot
      be saved:</p><textarea readonly>${text.replace(/</g, "&lt;")}</textarea>`;
}

/* ------------------------------------------------------------------ position */

function startWatching() {
  if (!navigator.geolocation) {
    el("chip-fix").textContent = "NO GPS";
    return;
  }
  // GPS needs no network. This keeps working in airplane mode, which is the entire point.
  navigator.geolocation.watchPosition(
    (position) => {
      state.fix = { lon: position.coords.longitude, lat: position.coords.latitude,
                    accuracy: position.coords.accuracy };
      status();
      updateReadout();
      draw();
    },
    () => {
      el("chip-fix").textContent = "NO FIX";
      el("chip-fix").className = "chip alert";
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  state.watching = true;
}

/* ------------------------------------------------------------------ status */

function status() {
  const net = el("chip-net");
  const words = { offline: "OFFLINE", nolink: "NO LINK", online: "ONLINE", checking: "CHECKING" };
  net.textContent = words[state.link];
  // Offline is the expected state in the field, not an error, so it is shown inverted rather
  // than red. It must be obvious, not alarming.
  net.className = state.link === "online" || state.link === "checking" ? "chip" : "chip on";

  const pack = el("chip-pack");
  pack.textContent = state.pack ? `PACK ${state.pack.pack_id}` : "NO PACK";
  pack.className = state.pack ? "chip on" : "chip alert";

  const fix = el("chip-fix");
  if (state.fix) {
    fix.textContent = `FIX ±${Math.round(state.fix.accuracy || 0)} m`;
    fix.className = "chip on";
  }

  if (state.pack) {
    const age = ageInDays(state.pack.observation.acquisition_date);
    el("chip-obs").hidden = false;
    el("chip-obs").textContent = `${state.pack.observation.sensor}` +
      (age !== null ? ` · ${age} days old` : "");
  }
  if (state.panel === "source") renderSource();
}

/* ------------------------------------------------------------------ pack loading */

function openPack(text, source) {
  const pack = JSON.parse(text);
  if (!pack.format || !pack.format.startsWith("prohori.pack/")) {
    throw new Error("that file is not a Prohori pack");
  }
  state.pack = pack;
  state.source = source;

  const image = new Image();
  image.onload = draw;            // plain load events: decode() can hang on a data URI
  image.onerror = draw;
  image.src = pack.terrain.image;
  state.terrainImage = image;

  el("gate").hidden = true;
  el("crosshair").hidden = false;
  el("zoom").hidden = false;
  resize();                        // the canvas needs its real size before the view is fitted
  fitTo(pack.coverage.bbox);
  status();
  updateCounts();
  updateReadout();
  draw();
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
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
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
    const mb = (received / 1048576).toFixed(1);
    el("progress").textContent = total
      ? `downloading ${mb} of ${(total / 1048576).toFixed(1)} MB (${Math.floor((100 * received) / total)}%)`
      : `downloading ${mb} MB`;
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

async function boot() {
  loadTheme();
  loadReports();
  updateCounts();
  status();
  globalThis.addEventListener("online", probe);
  globalThis.addEventListener("offline", probe);
  globalThis.addEventListener("resize", () => { resize(); draw(); });
  probe();
  setInterval(probe, PROBE_EVERY_MS);

  if ("serviceWorker" in navigator) {
    // The worker keeps the instrument itself openable with no network. If registration is refused
    // (some embedded browsers refuse it), the pack in Cache Storage still works, so it is not fatal.
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  const stored = await cachedPack();
  if (stored) {
    try {
      openPack(stored, "this device (offline store)");
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
      openPack(text, kept ? "embedded in this page, stored on this device" : "embedded in this page");
      startWatching();
      return;
    } catch (error) {
      /* fall through to the gate and let the operator open a file */
    }
  }

  const card = el("gate-card");
  if (!found || !found.list.length) {
    card.innerHTML =
      `<div class="line"><span>No pack on this device, and no pack list reachable.</span></div>
       <div class="line dim"><span>Open a pack file below, or connect and reload.</span></div>`;
  } else {
    card.innerHTML = found.list.map((entry) => `
      <div class="line"><span><b>${entry.name}</b></span><span>${entry.size_mb} MB</span></div>
      <div class="line"><span>${entry.hazard} &middot; ${entry.sensor} ${entry.acquisition_date}</span>
        <span>${entry.area_km2} km&sup2;</span></div>
      <button class="wide solid" data-pack="${found.base}${entry.file}"
        data-bytes="${Math.round(entry.size_mb * 1048576)}">Download this pack</button>`).join("");
    card.querySelectorAll("[data-pack]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        el("progress").textContent = "starting the download...";
        try {
          const text = await downloadText(button.dataset.pack, Number(button.dataset.bytes));
          el("progress").textContent = "storing the pack on this device...";
          const kept = await cachePack(text);
          openPack(text, kept ? "this device (offline store)" : "downloaded, not stored locally");
          el("progress").textContent = kept ? "" : "warning: this browser refused local storage";
          startWatching();
        } catch (error) {
          button.disabled = false;
          el("progress").textContent = `could not download: ${error.message}`;
        }
      });
    });
  }

  el("pack-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    el("progress").textContent = `reading ${file.name}...`;
    try {
      const text = await file.text();
      const kept = await cachePack(text);
      openPack(text, `file: ${file.name}${kept ? ", stored on this device" : ""}`);
      startWatching();
      el("progress").textContent = "";
    } catch (error) {
      el("progress").textContent = `not a usable pack: ${error.message}`;
    }
  });
}

/* ------------------------------------------------------------------ input */

function bind() {
  let dragging = null;
  canvas.addEventListener("pointerdown", (event) => {
    dragging = { x: event.clientX, y: event.clientY, lon: state.view.lon, lat: state.view.lat };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const ratio = globalThis.devicePixelRatio || 1;
    const squeeze = Math.cos((state.view.lat * Math.PI) / 180);
    state.view.lon = dragging.lon - ((event.clientX - dragging.x) * ratio) / (state.view.ppd * squeeze);
    state.view.lat = dragging.lat + ((event.clientY - dragging.y) * ratio) / state.view.ppd;
    draw();
  });
  canvas.addEventListener("pointerup", () => { dragging = null; updateReadout(); });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 1.25 : 0.8);
  }, { passive: false });

  el("zoom-in").addEventListener("click", () => zoom(1.5));
  el("zoom-out").addEventListener("click", () => zoom(1 / 1.5));
  el("btn-water").addEventListener("click", () => addReport("water_here"));
  el("btn-road").addEventListener("click", () => addReport("road_cut"));
  el("confirm-undo").addEventListener("click", undoLast);
  el("tool-layers").addEventListener("click", () => togglePanel("layers"));
  el("tool-source").addEventListener("click", () => togglePanel("source"));
  el("tool-reports").addEventListener("click", () => togglePanel("reports"));
  el("chip-theme").addEventListener("click", () => {
    state.theme = state.theme === "night" ? "day" : "night";
    try {
      localStorage.setItem(THEME_KEY, state.theme);
    } catch (error) { /* the choice just won't survive a reload */ }
    applyTheme();
    draw();
    refreshPanel();          // layer icons are drawn in the palette's colours
  });
  el("tool-locate").addEventListener("click", () => {
    if (!state.watching) startWatching();
    if (state.fix) {
      state.view.lon = state.fix.lon;
      state.view.lat = state.fix.lat;
      state.view.ppd = Math.max(state.view.ppd, 6000);
      updateReadout();
      draw();
    }
  });
}

function zoom(factor) {
  state.view.ppd = Math.min(Math.max(state.view.ppd * factor, 200), 400000);
  updateReadout();
  draw();
}

bind();
boot();
