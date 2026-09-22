/*
  PROHORI - the field instrument.

  Three jobs, in the order a responder needs them:
    1. Hold one disaster pack on the device and keep working when the network dies.
    2. Answer: where am I, which routes are under water, where is the nearest shelter.
    3. Send the operator's own observations back: "water here" and "road cut".

  The rule that shapes this whole file: three kinds of information are never mixed.
    SATELLITE   the radar hazard layer, drawn in blue, with its sensor and dates attached.
    REFERENCE   terrain, roads, waterways, shelters - geography, drawn in black, grey and green.
    FIELD       what the operator saw, drawn in magenta, stored separately, exported separately.
  A field report never becomes part of the satellite layer, and the satellite layer is never
  presented as ground truth.

  No map library and no CDN: both would need a network in exactly the situation this is built for.
  The map is drawn on a canvas from the pack's own coordinates.
*/

const PACK_CACHE = "prohori-pack-v1";
const PACK_KEY = "/__prohori_pack__";          // cache key for whichever pack is loaded
const REPORTS_KEY = "prohori.reports.v1";
const INDEX_URLS = ["../packs/index.json", "packs/index.json"];
/* A published build (an artifact page, or a single HTML file mailed to somebody) has no packs
   folder to fetch from, so the pack can be embedded in the page instead. The instrument labels it
   "embedded in this page" so nobody mistakes a demonstration copy for a real field install. */
const EMBEDDED = globalThis.PROHORI_PACK || null;

const el = (id) => document.getElementById(id);
const canvas = el("map");
const ctx = canvas.getContext("2d");

const state = {
  pack: null,
  terrainImage: null,
  source: null,
  view: { lon: 0, lat: 0, ppd: 1 },        // ppd = screen pixels per degree of latitude
  fix: null,                               // {lon, lat, accuracy} from the device GPS
  watching: false,
  reports: [],
  panel: null,
  layers: { terrain: true, flood: true, roads: true, wet: true, waterways: true,
            shelters: true, reports: true },
  here: "",
};

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
}

function saveReports() {
  try {
    localStorage.setItem(REPORTS_KEY, JSON.stringify(state.reports));
    return true;
  } catch (error) {
    return false;              // the map still shows them, and the operator is told they are unsaved
  }
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

/* ------------------------------------------------------------------ drawing */

function resize() {
  const ratio = globalThis.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * ratio);
  canvas.height = Math.round(canvas.clientHeight * ratio);
}

function strokeLine(coords, width, colour) {
  ctx.beginPath();
  coords.forEach(([lon, lat], i) => {
    const [x, y] = project(lon, lat);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.lineWidth = width;
  ctx.strokeStyle = colour;
  ctx.stroke();
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
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state.pack) return;
  const pack = state.pack;

  // Terrain first and faint: it is context for where water will run, not the subject.
  if (state.layers.terrain && state.terrainImage && state.terrainImage.complete) {
    const [west, south, east, north] = pack.terrain.bounds;
    const [x0, y0] = project(west, north);
    const [x1, y1] = project(east, south);
    ctx.globalAlpha = 0.38;
    ctx.drawImage(state.terrainImage, x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 1;
  }

  ctx.lineJoin = "round";
  for (const area of pack.areas || []) {
    ringPath(area.rings);
    ctx.lineWidth = 1.2 * ratio;
    ctx.strokeStyle = "#8a8a8a";
    ctx.stroke();
  }

  if (state.layers.waterways) {
    for (const way of pack.context.waterways || []) {
      strokeLine(way.coords, (way.kind === "river" ? 2.2 : 1.2) * ratio, "#0a6b8a");
    }
  }

  // SATELLITE OBSERVATION. Blue means radar here, and nothing else is ever blue.
  if (state.layers.flood) {
    ringPath((pack.observation.features || []).flatMap((feature) => feature.rings));
    ctx.fillStyle = "rgba(26, 78, 216, 0.42)";
    ctx.fill();
    ctx.lineWidth = 1 * ratio;
    ctx.strokeStyle = "#1a4ed8";
    ctx.stroke();
  }

  if (state.layers.roads) {
    for (const road of pack.context.roads || []) {
      strokeLine(road.coords, (ROAD_WIDTH[road.kind] || 1.3) * ratio, "#000000");
    }
    // Roads crossing detected water, drawn over the black so they read as road-plus-water rather
    // than as a separate feature. Deliberately never labelled "impassable" - see the Source panel.
    if (state.layers.wet) {
      for (const road of pack.context.roads || []) {
        if (road.wet) {
          strokeLine(road.coords, ((ROAD_WIDTH[road.kind] || 1.3) + 1.8) * ratio, "#1a4ed8");
        }
      }
    }
  }

  if (state.layers.shelters) {
    const size = 9 * ratio;
    for (const shelter of pack.context.shelters || []) {
      const [x, y] = project(shelter.lon, shelter.lat);
      ctx.fillStyle = "#00722c";
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      ctx.lineWidth = 1.6 * ratio;
      ctx.strokeStyle = "#000000";
      ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    }
  }

  // FIELD OBSERVATIONS last, so satellite data can never cover them, and in magenta so they can
  // never be mistaken for it. Circle = water here. Triangle = road cut.
  if (state.layers.reports) {
    for (const report of state.reports) {
      const [x, y] = project(report.lon, report.lat);
      const size = 15 * ratio;
      ctx.beginPath();
      if (report.type === "water_here") {
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      } else {
        ctx.moveTo(x, y - size / 2);
        ctx.lineTo(x + size / 2, y + size / 2);
        ctx.lineTo(x - size / 2, y + size / 2);
        ctx.closePath();
      }
      ctx.fillStyle = "#d6006e";
      ctx.fill();
      ctx.lineWidth = 2.2 * ratio;
      ctx.strokeStyle = "#000000";
      ctx.stroke();
    }
  }

  if (state.fix) {
    const [x, y] = project(state.fix.lon, state.fix.lat);
    if (state.fix.accuracy) {
      ctx.beginPath();
      ctx.arc(x, y, (state.fix.accuracy / 110540) * state.view.ppd, 0, Math.PI * 2);
      ctx.lineWidth = 2 * ratio;
      ctx.strokeStyle = "#e05a00";
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, 8 * ratio, 0, Math.PI * 2);
    ctx.fillStyle = "#e05a00";
    ctx.fill();
    ctx.lineWidth = 2.5 * ratio;
    ctx.strokeStyle = "#000000";
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

/* The three field questions answered in one box: where am I, is there water here, where is the
   nearest shelter. It reads from the GPS fix when there is one and from the crosshair when there
   is not, because a responder without a fix still has to read the map. */
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

  const onWater = (pack.observation.features || []).some((feature) =>
    feature.rings.some((ring) => inRing(ring, point[0], point[1])));

  let nearest = null;
  for (const shelter of pack.context.shelters || []) {
    const metres = distanceM(point, [shelter.lon, shelter.lat]);
    if (!nearest || metres < nearest.metres) nearest = { shelter, metres };
  }
  const shelterText = nearest
    ? `${nearest.shelter.name ? nearest.shelter.name + " (" + nearest.shelter.kind + ")"
                              : "unnamed " + nearest.shelter.kind} ` +
      `${nearest.metres < 1000 ? Math.round(nearest.metres) + " m"
                               : (nearest.metres / 1000).toFixed(1) + " km"} ` +
      bearing(point, [nearest.shelter.lon, nearest.shelter.lat])
    : "none in this pack";

  el("readout").hidden = false;
  el("readout").innerHTML =
    `${state.fix ? "Your position" : "Crosshair"}: ${point[1].toFixed(4)}, ${point[0].toFixed(4)}` +
    ` &middot; ${area}<br>` +
    (onWater
      ? `<span class="hit">Radar saw open water here</span> on ${pack.observation.acquisition_date}<br>`
      : `No open water seen here by radar on ${pack.observation.acquisition_date}<br>`) +
    `Nearest shelter point: ${shelterText}` +
    `<div class="note">Radar sees open water only. Water under trees or between buildings does not` +
    ` show. Use Water here or Road cut to record what you can see.</div>`;
  state.here = area;
}

/* ------------------------------------------------------------------ panels */

function togglePanel(name) {
  state.panel = state.panel === name ? null : name;
  for (const key of ["layers", "source", "reports"]) {
    el(`panel-${key}`).hidden = state.panel !== key;
    el(`tool-${key}`).setAttribute("aria-pressed", String(state.panel === key));
  }
  if (state.panel === "layers") renderLayers();
  if (state.panel === "source") renderSource();
  if (state.panel === "reports") renderReports();
}

function renderLayers() {
  const pack = state.pack;
  const wet = (pack.context.roads || []).filter((road) => road.wet).length;
  const rows = [
    ["flood", "Radar: open water", "#1a4ed8", (pack.observation.features || []).length],
    ["wet", "Roads crossing that water", "#1a4ed8", wet],
    ["roads", "Roads", "#000000", (pack.context.roads || []).length],
    ["waterways", "Rivers and canals", "#0a6b8a", (pack.context.waterways || []).length],
    ["shelters", "Shelter points", "#00722c", (pack.context.shelters || []).length],
    ["reports", "My field reports", "#d6006e", state.reports.length],
    ["terrain", "Terrain", "#8a8a8a", ""],
  ];
  el("panel-layers").innerHTML =
    `<h2>Layers</h2><div class="rows">` +
    rows.map(([key, label, colour, count]) =>
      `<button class="row" data-layer="${key}" aria-pressed="${state.layers[key]}">
         <span class="swatch" style="background:${colour}"></span>
         <span>${label}</span><span class="count">${count}</span>
       </button>`).join("") +
    `</div><p class="plain dim">Blue is satellite radar. Magenta is what you recorded. ` +
    `${pack.context.attribution}.</p>`;
  el("panel-layers").querySelectorAll("[data-layer]").forEach((button) => {
    button.addEventListener("click", () => {
      state.layers[button.dataset.layer] = !state.layers[button.dataset.layer];
      renderLayers();
      draw();
    });
  });
}

function ageInDays(dateText) {
  const then = Date.parse(dateText + "T00:00:00Z");
  return Number.isFinite(then) ? Math.round((Date.now() - then) / 86400000) : null;
}

function renderSource() {
  const pack = state.pack;
  const o = pack.observation;
  const age = ageInDays(o.acquisition_date);
  const totals = o.totals || {};
  const event = o.event || {};
  const share = event.reported_flooded_km2
    ? Math.round((100 * totals.flood_km2) / event.reported_flooded_km2) : null;
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
      magnitude does not match, for two stated reasons &mdash; this pass was taken on the day the
      flood arrived, not at the peak two days later, and open-water detection misses flooded
      villages and cropland. No accuracy figure is claimed: no validated flood map exists for this
      event to measure against.</p>
    <h3>Terrain &mdash; reference</h3>
    <dl class="meta">
      <dt>Source</dt><dd>${pack.terrain.source}</dd>
      <dt>Elevation</dt><dd>${pack.terrain.elevation_m.min} to ${pack.terrain.elevation_m.max} m</dd>
      <dt>Limits</dt><dd>${pack.terrain.limitations}</dd>
    </dl>
    <h3>Roads, waterways, shelters &mdash; reference</h3>
    <p class="plain">${pack.context.attribution}. ${pack.context.note}</p>
    <p class="plain dim">${pack.context.roads_note || ""}</p>
    <h3>This pack</h3>
    <dl class="meta">
      <dt>Pack</dt><dd>${pack.pack_id} &mdash; ${pack.name}</dd>
      <dt>Built</dt><dd>${pack.built_on}</dd>
      <dt>Loaded from</dt><dd>${state.source}</dd>
    </dl>`;
}

function renderReports() {
  const list = state.reports.length
    ? `<ul class="reports">` + state.reports.map((report, index) => `
        <li><span class="kind">${report.type === "water_here" ? "Water here" : "Road cut"}</span>
          &mdash; ${report.lat.toFixed(4)}, ${report.lon.toFixed(4)}
          ${report.area ? "&middot; " + report.area : ""}
          <div class="when">${new Date(report.at).toLocaleString()} &middot;
            ${report.accuracy_m ? "GPS &plusmn; " + Math.round(report.accuracy_m) + " m"
                                : "placed on the map"} &middot; #${index + 1}</div></li>`).join("")
      + `</ul>`
    : `<p class="plain">No field reports yet. Use the two magenta buttons when you see something the
        satellite layer does not show.</p>`;

  el("panel-reports").innerHTML = `
    <h2>My field observations (${state.reports.length})</h2>
    <p class="plain">Your own observations, stored on this device. They are kept separate from the
      satellite layer and never merged into it.</p>
    ${list}
    <button class="wide solid" id="export-file">Export for handover</button>
    <button class="wide" id="clear-reports">Delete all reports</button>
    <div id="export-out"></div>`;

  el("export-file").addEventListener("click", exportReports);
  el("clear-reports").addEventListener("click", () => {
    if (!state.reports.length) return;
    state.reports = [];
    saveReports();
    renderReports();
    draw();
  });
}

/* ------------------------------------------------------------------ field reports */

function addReport(type) {
  if (!state.pack) return;
  const point = state.fix ? [state.fix.lon, state.fix.lat]
                          : unproject(canvas.width / 2, canvas.height / 2);
  const report = {
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
  const stored = saveReports();
  draw();

  el("readout").hidden = false;
  el("readout").innerHTML =
    `<b>${type === "water_here" ? "WATER HERE" : "ROAD CUT"} recorded</b> at ` +
    `${report.lat.toFixed(4)}, ${report.lon.toFixed(4)}` +
    `${report.area ? " &middot; " + report.area : ""}<br>` +
    `${stored ? "Stored on this device" : "NOT stored: this browser refused local storage"}` +
    `${navigator.onLine ? "" : " &middot; no network needed"}` +
    `<div class="note">Observation ${state.reports.length}. Tap Reports to see or export them.</div>`;
  if (state.panel === "reports") renderReports();
  if (state.panel === "layers") renderLayers();
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
  net.textContent = navigator.onLine ? "ONLINE" : "OFFLINE";
  net.className = navigator.onLine ? "chip" : "chip on";

  const pack = el("chip-pack");
  pack.textContent = state.pack ? `PACK ${state.pack.pack_id}` : "NO PACK";
  pack.className = state.pack ? "chip on" : "chip alert";

  const fix = el("chip-fix");
  if (state.fix) {
    fix.textContent = `FIX ${state.fix.lat.toFixed(3)} ${state.fix.lon.toFixed(3)}`;
    fix.className = "chip on";
  }

  if (state.pack) {
    const age = ageInDays(state.pack.observation.acquisition_date);
    el("chip-obs").hidden = false;
    el("chip-obs").textContent =
      `${state.pack.observation.sensor} ${state.pack.observation.acquisition_date}` +
      (age !== null ? ` (${age}d old)` : "");
  }
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

async function boot() {
  loadReports();
  status();
  globalThis.addEventListener("online", status);
  globalThis.addEventListener("offline", status);
  globalThis.addEventListener("resize", () => { resize(); draw(); });

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
      <button class="wide solid" data-pack="${found.base}${entry.file}">Download this pack</button>`).join("");
    card.querySelectorAll("[data-pack]").forEach((button) => {
      button.addEventListener("click", async () => {
        el("progress").textContent = "downloading the pack...";
        try {
          const response = await fetch(button.dataset.pack, { cache: "no-store" });
          const text = await response.text();
          const kept = await cachePack(text);
          openPack(text, kept ? "this device (offline store)" : "downloaded, not stored locally");
          el("progress").textContent = kept ? "" : "warning: this browser refused local storage";
          startWatching();
        } catch (error) {
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
  el("tool-layers").addEventListener("click", () => togglePanel("layers"));
  el("tool-source").addEventListener("click", () => togglePanel("source"));
  el("tool-reports").addEventListener("click", () => togglePanel("reports"));
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
