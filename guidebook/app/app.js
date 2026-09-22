"use strict";
/*
 * Guidebook field client.
 *
 * Offline is the architecture, not a switch. The app fetches a region pack once, stores every
 * file in Cache Storage, and from then on reads only from that store. Kill the server and
 * reload: the service worker returns the shell and the pack comes from the cache.
 *
 * Nothing here invents data. Each layer draws what the pack contains and shows the pack's own
 * provenance. A layer the pipeline has not produced yet stays switched off and says why.
 */

const PACK_ID = "chattogram-south";
const BASES = [`../packs/${PACK_ID}/`, `pack/`];   // local layout first, then the published layout
const CACHE = "guidebook-pack-v1";
const EMBEDDED = globalThis.GUIDEBOOK_PACK || null;

const el = (id) => document.getElementById(id);
const canvas = el("map");
const ctx = canvas.getContext("2d");

const state = {
  mode: "field",
  base: null,          // the base URL that answered
  source: null,        // where the pack came from: this device, the network, or the page itself
  manifest: null,
  region: null,        // GeoJSON FeatureCollection
  change: null,        // GeoJSON, once the NISAR pipeline has produced it
  terrain: null,       // Image
  on: { terrain: true, region: true, change: true },
  view: { lon: 0, lat: 0, ppd: 1 },     // ppd = screen pixels per degree of latitude
  fix: null,           // {lon, lat, accuracy} from the device GPS
  selected: null,
};

/* ------------------------------------------------------------------ storage */

async function cacheGet(name) {
  if (!("caches" in globalThis)) return null;
  try {
    const cache = await caches.open(CACHE);
    for (const base of BASES) {
      const hit = await cache.match(base + name);
      if (hit) return hit;
    }
  } catch { /* storage blocked: the caller falls back */ }
  return null;
}

async function fetchFrom(name) {
  for (const base of state.base ? [state.base] : BASES) {
    try {
      const response = await fetch(base + name, { cache: "no-store" });
      if (response.ok) {
        state.base = base;
        return response;
      }
    } catch { /* try the next base, then fall back to what is embedded */ }
  }
  return null;
}

/* ------------------------------------------------------------------ geometry */

function project(lon, lat) {
  const { lon: lon0, lat: lat0, ppd } = state.view;
  const squeeze = Math.cos((lat0 * Math.PI) / 180);
  return [canvas.width / 2 + (lon - lon0) * ppd * squeeze, canvas.height / 2 - (lat - lat0) * ppd];
}

function unproject(x, y) {
  const { lon: lon0, lat: lat0, ppd } = state.view;
  const squeeze = Math.cos((lat0 * Math.PI) / 180);
  return [lon0 + (x - canvas.width / 2) / (ppd * squeeze), lat0 - (y - canvas.height / 2) / ppd];
}

function fitTo([west, south, east, north]) {
  const squeeze = Math.cos((((south + north) / 2) * Math.PI) / 180);
  state.view = {
    lon: (west + east) / 2,
    lat: (south + north) / 2,
    ppd: 0.92 * Math.min(canvas.width / ((east - west) * squeeze), canvas.height / (north - south)),
  };
}

function eachRing(geometry, visit) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) for (const ring of polygon) visit(ring);
}

function inside(geometry, lon, lat) {
  let hit = false;
  eachRing(geometry, (ring) => {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
  });
  return hit;
}

/* ------------------------------------------------------------------ drawing */

function tracePolygons(features) {
  ctx.beginPath();
  for (const feature of features) {
    eachRing(feature.geometry, (ring) => {
      ring.forEach(([lon, lat], i) => {
        const [x, y] = project(lon, lat);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath();
    });
  }
}

function resize() {
  const ratio = globalThis.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * ratio);
  canvas.height = Math.round(canvas.clientHeight * ratio);
}

function draw() {
  const ratio = globalThis.devicePixelRatio || 1;
  if (canvas.width !== Math.round(canvas.clientWidth * ratio)) resize();
  ctx.fillStyle = "#050708";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const terrain = state.manifest?.layers.find((l) => l.id === "terrain");
  if (state.on.terrain && state.terrain?.complete && terrain?.bounds_lonlat) {
    const [west, south, east, north] = terrain.bounds_lonlat;
    const [x0, y0] = project(west, north);
    const [x1, y1] = project(east, south);
    ctx.drawImage(state.terrain, x0, y0, x1 - x0, y1 - y0);
  }

  if (state.on.region && state.region) {
    for (const feature of state.region.features) {
      const chosen = feature === state.selected;
      tracePolygons([feature]);
      ctx.fillStyle = chosen ? "rgba(76, 201, 230, 0.13)" : "rgba(76, 201, 230, 0.03)";
      ctx.fill();
      ctx.strokeStyle = chosen ? "#4cc9e6" : "rgba(76, 201, 230, 0.5)";
      ctx.lineWidth = (chosen ? 2 : 1) * ratio;
      ctx.stroke();
    }
  }

  if (state.on.change && state.change) {
    tracePolygons(state.change.features);
    ctx.fillStyle = "rgba(96, 165, 250, 0.55)";
    ctx.fill();
    ctx.strokeStyle = "#93c5fd";
    ctx.lineWidth = ratio;
    ctx.stroke();
  }

  if (state.fix) {
    const [x, y] = project(state.fix.lon, state.fix.lat);
    if (state.fix.accuracy) {
      ctx.beginPath();
      ctx.arc(x, y, (state.fix.accuracy / 110540) * state.view.ppd, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(227, 163, 60, 0.12)";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, 5 * ratio, 0, Math.PI * 2);
    ctx.fillStyle = "#e3a33c";
    ctx.fill();
    ctx.strokeStyle = "#0a0d0f";
    ctx.lineWidth = 2 * ratio;
    ctx.stroke();
  }

  drawScale(ratio);
}

function drawScale(ratio) {
  const bar = el("scalebar");
  const metresPerPixel = 110540 / (state.view.ppd * ratio);
  const target = 90 * ratio * metresPerPixel;
  const step = [100, 200, 500, 1000, 2000, 5000, 10000, 20000].find((s) => s >= target) || 50000;
  bar.hidden = false;
  bar.querySelector("span").textContent = step >= 1000 ? `${step / 1000} km` : `${step} m`;
  bar.querySelector("div").style.width = `${step / metresPerPixel / ratio}px`;
}

/* ------------------------------------------------------------------ panels */

function layerButton(layer) {
  const ready = layer.status === "ready" && (layer.id !== "change" || Boolean(state.change));
  const swatches = { terrain: "#7b8a91", region: "#4cc9e6", change: "#60a5fa" };
  return `<button class="layer" data-layer="${layer.id}" aria-pressed="${ready && state.on[layer.id]}" ${ready ? "" : "disabled"}>
    <span class="swatch" style="background:${swatches[layer.id] || "#888"}"></span>
    <span class="label">${layer.title}</span>
    <span class="state">${ready ? (state.on[layer.id] ? "on" : "off") : "pending"}</span>
  </button>`;
}

function provenance(layer) {
  const rows = [["Source", layer.source], ["Product", layer.product],
                ["Acquired", layer.acquisition_date], ["Baseline", layer.baseline_date],
                ["File", layer.from_file], ["Method", layer.method], ["Limitations", layer.limitations]];
  return `<h3>${layer.title}</h3><dl class="meta">${rows.filter(([, value]) => value)
    .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`).join("")}</dl>`;
}

function panels() {
  const side = el("side");
  side.hidden = false;
  const pack = state.manifest;
  const terrain = pack.layers.find((l) => l.id === "terrain");
  const change = pack.layers.find((l) => l.id === "change");

  if (state.mode === "field") {
    const here = state.selected?.properties;
    side.innerHTML = `
      <div class="card">
        <h2>Layers</h2>
        <div class="layers">${pack.layers.map(layerButton).join("")}</div>
      </div>
      <div class="card">
        <h2>Here</h2>
        <dl class="meta">
          <dt>Position</dt><dd class="num">${state.fix ? `${state.fix.lat.toFixed(4)}, ${state.fix.lon.toFixed(4)}` : "no GPS fix"}</dd>
          <dt>Accuracy</dt><dd class="num">${state.fix?.accuracy ? `± ${Math.round(state.fix.accuracy)} m` : "—"}</dd>
          <dt>Area</dt><dd>${here ? here.adm3_name : "tap the map"}</dd>
        </dl>
        <p class="note">Elevation in this pack runs ${terrain.elevation_m.min} to ${terrain.elevation_m.max} m. GPS needs no network, and neither does this map.</p>
      </div>`;
  } else {
    side.innerHTML = `
      <div class="card">
        <h2>Earth observation</h2>
        <div class="layers">${pack.layers.filter((l) => l.id !== "region").map(layerButton).join("")}</div>
        ${change.status === "ready" ? "" : `<p class="note"><b style="color:var(--warn)">NISAR layer not in this pack.</b> ${change.status.replace("pending: ", "")}. Nothing stands in for it: an empty layer is honest, invented water is not.</p>`}
      </div>
      <div class="card">
        <h2>What changed</h2>
        ${state.change ? `<dl class="meta">
          <dt>Flood pass</dt><dd class="num">${change.acquisition_date}</dd>
          <dt>Baseline pass</dt><dd class="num">${change.baseline_date}</dd>
          <dt>New open water</dt><dd class="num">${change.flooded_km2} km²</dd>
          <dt>Share of region</dt><dd class="num">${(100 * change.flooded_km2 / pack.coverage.area_km2).toFixed(1)}%</dd>
          <dt>Patches</dt><dd class="num">${change.patches}</dd>
          <dt>Threshold</dt><dd class="num">${Number(change.threshold).toFixed(2)}</dd>
        </dl>
        <p class="note">Blue areas are pixels that turned from land to open water between those two NISAR passes. ${change.limitations}</p>`
          : `<p class="note">Once the NISAR pair is processed, this compares a baseline pass with a flood pass and marks pixels that turned from land to open water.</p>`}
      </div>
      <div class="card">
        <h2>Provenance</h2>
        ${pack.layers.map(provenance).join("")}
        <p class="note">Pack built ${pack.built_on} · ${pack.coverage.area_km2} km² · ${pack.coverage.places.join(", ")}</p>
      </div>`;
  }
  side.querySelectorAll("[data-layer]").forEach((button) => {
    button.addEventListener("click", () => {
      state.on[button.dataset.layer] = !state.on[button.dataset.layer];
      panels();
      draw();
    });
  });
}

function status() {
  const net = el("pill-net");
  net.className = `pill ${navigator.onLine ? "on" : "off"}`;
  net.lastElementChild.textContent = navigator.onLine ? "online" : "offline";

  const pack = el("pill-pack");
  pack.className = `pill ${state.manifest ? "on" : ""}`;
  pack.lastElementChild.textContent = state.manifest ? "pack ready" : "no pack";

  const fix = el("pill-fix");
  fix.className = `pill ${state.fix ? "on" : ""}`;
  fix.lastElementChild.textContent = state.fix
    ? `${state.fix.lat.toFixed(3)} ${state.fix.lon.toFixed(3)}` : "no fix";

  el("f-pack").textContent = state.manifest
    ? `${state.manifest.name} · ${state.manifest.pack_id}` : "no pack loaded";
  el("f-source").textContent = state.source ? `pack from ${state.source}` : "—";
}

/* ------------------------------------------------------------------ loading */

async function readLayer(name, { asImage = false } = {}) {
  const response = (await cacheGet(name)) || (await fetchFrom(name));
  if (!response) return null;
  if (!asImage) return response.json();
  const image = new Image();
  const source = URL.createObjectURL(await response.blob());
  // Plain load events, not decode(): some embedded browsers never settle decode() on a blob URL,
  // and a picture that fails to load must not stop the rest of the pack from opening.
  await new Promise((done) => {
    image.onload = done;
    image.onerror = done;
    image.src = source;
  });
  return image;
}

function show() {
  el("gate").hidden = true;
  el("crosshair").hidden = false;
  resize();     // the canvas must have its real size before the view is fitted to the region
  fitTo(state.manifest.coverage.bbox_lonlat);
  panels();
  status();
  draw();
}

async function openPack(source) {
  state.source = source;
  state.manifest = await readLayer("manifest.json");
  state.region = await readLayer("region.geojson");
  state.terrain = await readLayer("terrain.png", { asImage: true });
  const change = state.manifest.layers.find((l) => l.id === "change");
  if (change.status === "ready") state.change = await readLayer(change.file);
  show();
}

function useEmbedded() {
  state.source = "embedded in this page";
  state.manifest = EMBEDDED.manifest;
  state.region = EMBEDDED.region;
  state.change = EMBEDDED.change || null;
  const image = new Image();
  image.onload = draw;
  image.src = EMBEDDED.terrain;
  state.terrain = image;
  show();
}

async function preview() {
  const manifest = (await readLayer("manifest.json")) || EMBEDDED?.manifest;
  if (!manifest) {
    el("progress").textContent = "region pack unreachable, and none embedded in this page";
    return null;
  }
  el("r-name").textContent = manifest.name;
  el("r-size").textContent = `${manifest.coverage.area_km2} km²`;
  el("r-meta").innerHTML = `
    <dt>Places</dt><dd>${manifest.coverage.places.join(", ")}</dd>
    <dt>Built</dt><dd class="num">${manifest.built_on}</dd>`;
  el("r-contents").innerHTML = manifest.layers.map((layer) =>
    `<li><span class="${layer.status === "ready" ? "tick" : "pend"}">${layer.status === "ready" ? "✓" : "○"}</span>
     <span>${layer.title}${layer.status === "ready" ? "" : " <small>(pending)</small>"}</span></li>`).join("");
  return manifest;
}

async function download(manifest) {
  el("download").disabled = true;
  const files = ["manifest.json",
                 ...manifest.layers.filter((l) => l.status === "ready").map((l) => l.file)];
  if (!("caches" in globalThis) || !state.base) {
    el("progress").textContent = "no local store here, so using the copy embedded in this page";
    useEmbedded();
    return;
  }
  try {
    const cache = await caches.open(CACHE);
    for (const [index, name] of files.entries()) {
      el("progress").textContent = `storing ${name} (${index + 1} of ${files.length})`;
      await cache.add(new Request(state.base + name, { cache: "reload" }));
    }
    el("progress").textContent = "region available offline";
    await openPack("this device (offline store)");
  } catch (error) {
    el("progress").textContent = `local store refused (${error.name}); using the embedded copy`;
    useEmbedded();
  }
}

/* ------------------------------------------------------------------ input */

function bind() {
  let dragging = null;
  const ratio = () => globalThis.devicePixelRatio || 1;

  canvas.addEventListener("pointerdown", (event) => {
    dragging = { x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (event) => {
    el("crosshair").textContent = unproject(event.offsetX * ratio(), event.offsetY * ratio())
      .map((value, i) => `${value.toFixed(4)}${i ? " E" : " N"}`).reverse().join("  ");
    if (!dragging) return;
    const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y;
    const squeeze = Math.cos((state.view.lat * Math.PI) / 180);
    state.view.lon -= (dx * ratio()) / (state.view.ppd * squeeze);
    state.view.lat += (dy * ratio()) / state.view.ppd;
    dragging = { x: event.clientX, y: event.clientY, moved: dragging.moved || Math.abs(dx) + Math.abs(dy) > 3 };
    draw();
  });
  canvas.addEventListener("pointerup", (event) => {
    if (dragging && !dragging.moved && state.region) {
      const [lon, lat] = unproject(event.offsetX * ratio(), event.offsetY * ratio());
      state.selected = state.region.features.find((f) => inside(f.geometry, lon, lat)) || null;
      panels();
      draw();
    }
    dragging = null;
    canvas.classList.remove("dragging");
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.view.ppd *= Math.exp(-event.deltaY * 0.0015);
    draw();
  }, { passive: false });

  for (const mode of ["field", "earth"]) {
    el(`mode-${mode}`).addEventListener("click", () => {
      state.mode = mode;
      el("mode-field").setAttribute("aria-pressed", String(mode === "field"));
      el("mode-earth").setAttribute("aria-pressed", String(mode === "earth"));
      if (state.manifest) panels();
    });
  }
  addEventListener("resize", () => { resize(); draw(); });
  addEventListener("online", status);
  addEventListener("offline", status);
}

async function boot() {
  bind();
  status();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js")
      .then(() => { el("f-sw").textContent = "service worker: active"; })
      .catch((error) => { el("f-sw").textContent = `service worker: unavailable (${error.name})`; });
  } else {
    el("f-sw").textContent = "service worker: not supported here";
  }

  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
      ({ coords }) => {
        state.fix = { lon: coords.longitude, lat: coords.latitude, accuracy: coords.accuracy };
        status();
        if (state.manifest) panels();
        draw();
      },
      () => { el("pill-fix").lastElementChild.textContent = "gps unavailable"; },
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
  }

  if (await cacheGet("manifest.json")) {          // already stored: this is the offline path
    await openPack("this device (offline store)");
    return;
  }
  const manifest = await preview();
  el("download").addEventListener("click", () => download(manifest));
}

boot();
