// Step 3: classify each year's image, measure land the rivers took per upazila, and render images for the demo.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import proj4 from "proj4";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

const ROOT = new URL("../", import.meta.url);
const CACHE = new URL("data/cache/", ROOT);
const IMG = new URL("web/img/", ROOT);
await mkdir(IMG, { recursive: true });

// ---- Method constants (every one is shown on the page) ----
const T_WATER = 0.0; // open water: MNDWI above this ...
const T_WATER_GNDVI = 0.0; // ... and green NDVI below this (flooded fields reflect more near-infrared than green; open water doesn't)
const T_SAND_GNDVI = 0.15; // riverbed sand: green NDVI below this ...
// ... and green reflectance above this. Measured on sand beside rivers vs fallow fields far away;
// the older TM/ETM+ sensors read about 0.02 brighter in green over fallow fields than OLI, so they get a higher cut.
const T_SAND_GREEN = { "landsat-5": 0.13, "landsat-7": 0.13, "landsat-8": 0.11, "landsat-9": 0.11 };
const T_VEG = 0.35; // green NDVI above this = vegetated land (used for "new land")
// Tested 3/0.5, 1.5/0.25 and 1/0.1: only 1/0.1 keeps the Dudhkumar, Dharla and Teesta beds in low-water years.
const MIN_BED_KM2 = Number(process.env.MIN_BED_KM2 ?? 1); // a river bed is water + sand connected edge-to-edge, at least this big ...
const MIN_BED_WATER_KM2 = Number(process.env.MIN_BED_WATER_KM2 ?? 0.1); // ... and holding at least this much open water
const MAJORITY = 5; // a change pixel needs at least 5 of its 8 neighbours changed (or already river bed)
const GROW_M_PER_YEAR = 1500; // land taken must connect to the earlier river bed, within this distance per year of gap ...
const GROW_MAX_M = 4500; // ... up to this cap
const PX_HA = 0.09; // one 30 m pixel = 0.09 hectare
const FOCAL_PX = 400; // close-up: 400 x 400 px = 12 x 12 km
const RECENT_FROM = 2014;

const meta = JSON.parse(await readFile(new URL("meta.json", CACHE), "utf8"));
const { W, H, xmin, ymax, res } = meta.grid;
const N = W * H;
const years = Object.keys(meta.scenes).map(Number).sort((a, b) => a - b);
console.log(`grid ${W}x${H}, years ${years.join(",")}`);

// ---- Upazilas: official BBS/OCHA boundaries + the 2019 erosion-assistance list (Annex-1) ----
const INFO = {
  BD55490006: { en: "Bhurungamari", bn: "ভূরুঙ্গামারী", onList: false },
  BD55490009: { en: "Chilmari", bn: "চিলমারী", onList: true, listRivers: "Teesta and Brahmaputra", listRiversBn: "তিস্তা ও ব্রহ্মপুত্র" },
  BD55490052: { en: "Kurigram Sadar", bn: "কুড়িগ্রাম সদর", onList: true, listRivers: "Dharla, Brahmaputra and Dudhkumar", listRiversBn: "ধরলা, ব্রহ্মপুত্র ও দুধকুমার" },
  BD55490061: { en: "Nageshwari", bn: "নাগেশ্বরী", onList: true, listRivers: "Dharla, Brahmaputra and Dudhkumar", listRiversBn: "ধরলা, ব্রহ্মপুত্র ও দুধকুমার" },
  BD55490018: { en: "Phulbari", bn: "ফুলবাড়ী", onList: false },
  BD55490077: { en: "Rajarhat", bn: "রাজারহাট", onList: false },
  BD55490008: { en: "Char Rajibpur", bn: "চর রাজিবপুর", onList: true, listRivers: "Brahmaputra", listRiversBn: "ব্রহ্মপুত্র" },
  BD55490079: { en: "Roumari", bn: "রৌমারী", onList: true, listRivers: "Brahmaputra", listRiversBn: "ব্রহ্মপুত্র" },
  BD55490094: { en: "Ulipur", bn: "উলিপুর", onList: true, listRivers: "Dharla, Brahmaputra and Teesta", listRiversBn: "ধরলা, ব্রহ্মপুত্র ও তিস্তা" },
};

const gj = JSON.parse(await readFile(new URL("data/kurigram_upazilas.geojson", ROOT), "utf8"));
const utmDef = "+proj=utm +zone=45 +datum=WGS84 +units=m +no_defs";
const toUtm = proj4("EPSG:4326", utmDef);
const toPx = ([lon, lat]) => {
  const [x, y] = toUtm.forward([lon, lat]);
  return [(x - xmin) / res, (ymax - y) / res];
};

const zone = new Uint8Array(N);
function fillPolygons(polys, value) {
  const edges = [];
  for (const poly of polys) for (const ring of poly) for (let k = 0; k < ring.length - 1; k++) {
    const [x1, y1] = ring[k];
    const [x2, y2] = ring[k + 1];
    if (y1 !== y2) edges.push(y1 < y2 ? [x1, y1, x2, y2] : [x2, y2, x1, y1]);
  }
  let rmin = Infinity, rmax = -Infinity;
  for (const e of edges) { rmin = Math.min(rmin, e[1]); rmax = Math.max(rmax, e[3]); }
  const xs = [];
  for (let r = Math.max(0, Math.floor(rmin)); r <= Math.min(H - 1, Math.ceil(rmax)); r++) {
    const yc = r + 0.5;
    xs.length = 0;
    for (const [x1, y1, x2, y2] of edges) if (yc >= y1 && yc < y2) xs.push(x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const c1 = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let c = c0; c <= c1; c++) zone[r * W + c] = value;
    }
  }
}

function simplify(points, eps) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    let best = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((by - ay) * points[i][0] - (bx - ax) * points[i][1] + bx * ay - by * ax) / len;
      if (d > best) { best = d; idx = i; }
    }
    if (best > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

const upazilas = gj.features.map((f, i) => {
  const code = f.properties.adm3_pcode;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const pxPolys = polys.map((poly) => poly.map((ring) => ring.map(toPx)));
  fillPolygons(pxPolys, i + 1);
  const d = pxPolys
    .flatMap((poly) => poly.map((ring) => simplify(ring.map(([x, y]) => [x / 2, y / 2]), 0.6)))
    .map((ring) => "M" + ring.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + "Z")
    .join("");
  const [lx, ly] = toPx([f.properties.center_lon, f.properties.center_lat]);
  return { index: i + 1, code, ...INFO[code], areaKm2: +f.properties.area_sqkm.toFixed(1), path: d, label: [+(lx / 2).toFixed(1), +(ly / 2).toFixed(1)] };
});
const Z = upazilas.length;
const zonePx = new Float64Array(Z + 1);
for (let i = 0; i < N; i++) zonePx[zone[i]]++;

// ---- Per-year classification ----
const SCALE = 2.75e-5, OFFSET = -0.2;
async function band(year, name) {
  const buf = await readFile(new URL(`${year}_${name}.bin`, CACHE));
  return new Uint16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const refl = (dn) => Math.max(dn * SCALE + OFFSET, 1e-4);
const tone = (v, hi, dim = 1) => Math.round(255 * Math.min(1, Math.max(0, v / hi)) ** 0.85 * dim);

// class codes: 0 no data, 1 other land (soil, fallow), 2 vegetated land, 3 open water, 4 riverbed-like sand
const CLS = {}, BED = {};
const diagnostics = {};
const queue = new Int32Array(N);
for (const year of years) {
  const [g, n, s, q] = await Promise.all(["green", "nir08", "swir16", "qa_pixel"].map((b) => band(year, b)));
  const sandGreen = T_SAND_GREEN[meta.scenes[year].platform] ?? 0.11;
  const cls = new Uint8Array(N);
  let validDistrict = 0;
  for (let i = 0; i < N; i++) {
    if (q[i] & 0b11111 || g[i] === 0 || s[i] === 0) continue; // fill, dilated cloud, cirrus, cloud, cloud shadow
    const G = refl(g[i]), NIR = refl(n[i]), S = refl(s[i]);
    const mndwi = (G - S) / (G + S);
    const gndvi = (NIR - G) / (NIR + G);
    if (mndwi > T_WATER && gndvi < T_WATER_GNDVI) cls[i] = 3;
    else if (gndvi < T_SAND_GNDVI && G > sandGreen) cls[i] = 4;
    else cls[i] = gndvi > T_VEG ? 2 : 1;
    if (zone[i]) validDistrict++;
  }
  CLS[year] = cls;

  // River bed: water + sand connected edge-to-edge, big enough and holding real open water.
  const label = new Int32Array(N);
  const keep = [false];
  const isBed = (v) => v === 3 || v === 4;
  for (let i = 0; i < N; i++) {
    if (!isBed(cls[i]) || label[i]) continue;
    const id = keep.length;
    let head = 0, tail = 0, water = 0;
    queue[tail++] = i;
    label[i] = id;
    while (head < tail) {
      const p = queue[head++];
      if (cls[p] === 3) water++;
      const c = p % W;
      if (c > 0 && isBed(cls[p - 1]) && !label[p - 1]) { label[p - 1] = id; queue[tail++] = p - 1; }
      if (c < W - 1 && isBed(cls[p + 1]) && !label[p + 1]) { label[p + 1] = id; queue[tail++] = p + 1; }
      if (p >= W && isBed(cls[p - W]) && !label[p - W]) { label[p - W] = id; queue[tail++] = p - W; }
      if (p < N - W && isBed(cls[p + W]) && !label[p + W]) { label[p + W] = id; queue[tail++] = p + W; }
    }
    keep.push(tail * PX_HA >= MIN_BED_KM2 * 100 && water * PX_HA >= MIN_BED_WATER_KM2 * 100);
  }
  const bed = new Uint8Array(N);
  let bedDistrict = 0, waterDistrict = 0;
  for (let i = 0; i < N; i++) {
    if (label[i] && keep[label[i]]) { bed[i] = 1; if (zone[i]) { bedDistrict++; if (cls[i] === 3) waterDistrict++; } }
  }
  BED[year] = bed;

  // False-colour composite at 60 m (shortwave infrared, near infrared, green); outside Kurigram is dimmed.
  const w2 = W >> 1, h2 = H >> 1;
  const rgba = Buffer.alloc(w2 * h2 * 4);
  for (let r = 0; r < h2; r++) for (let c = 0; c < w2; c++) {
    let sr = 0, sn = 0, sg = 0, k = 0, inside = 0;
    for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) {
      const i = (2 * r + dr) * W + 2 * c + dc;
      if (zone[i]) inside++;
      if (!g[i] || !s[i]) continue;
      sr += refl(s[i]); sn += refl(n[i]); sg += refl(g[i]); k++;
    }
    const o = (r * w2 + c) * 4;
    rgba[o + 3] = 255;
    if (!k) { rgba[o] = 22; rgba[o + 1] = 24; rgba[o + 2] = 27; continue; }
    const dim = inside ? 1 : 0.45;
    rgba[o] = tone(sr / k, 0.4, dim); rgba[o + 1] = tone(sn / k, 0.45, dim); rgba[o + 2] = tone(sg / k, 0.2, dim);
  }
  await writeFile(new URL(`k_${year}.jpg`, IMG), jpeg.encode({ data: rgba, width: w2, height: h2 }, 80).data);

  diagnostics[year] = {
    scene: meta.scenes[year].id,
    clearShare: +(validDistrict / (N - zonePx[0])).toFixed(3),
    riverBedKm2: +((bedDistrict * PX_HA) / 100).toFixed(1),
    openWaterKm2: +((waterDistrict * PX_HA) / 100).toFixed(1),
  };
  console.log(year, JSON.stringify(diagnostics[year]));
}

// ---- Change between photo dates ----
// change codes: 1 established land became river bed, 3 river bed became vegetated land
function majority(mask, support, min) {
  const out = new Uint8Array(N);
  for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
    const i = r * W + c;
    if (!mask[i]) continue;
    let nb = 0;
    for (const j of [i - W - 1, i - W, i - W + 1, i - 1, i + 1, i + W - 1, i + W, i + W + 1]) if (mask[j] || support[j]) nb++;
    if (nb >= min) out[i] = 1;
  }
  return out;
}

function compare(k0, k1) {
  const y0 = years[k0], y1 = years[k1];
  const a = CLS[y0], b = CLS[y1], ra = BED[y0], rb = BED[y1];
  // "Established" land: outside the river bed in this photo and in up to two earlier photos (where those were clear).
  const priors = [k0 - 1, k0 - 2].filter((k) => k >= 0).map((k) => ({ c: CLS[years[k]], r: BED[years[k]] }));
  const cand = new Uint8Array(N), gainCand = new Uint8Array(N), stableLand = new Uint8Array(N);
  const bothValid = new Float64Array(Z + 1);
  for (let i = 0; i < N; i++) {
    if (!a[i] || !b[i]) continue;
    bothValid[zone[i]]++;
    const landA = !ra[i];
    const landB = !rb[i];
    if (landA && rb[i]) {
      let established = true;
      for (const p of priors) if (p.c[i] && p.r[i]) { established = false; break; }
      if (established) cand[i] = 1;
    } else if (ra[i] && landB && b[i] === 2) gainCand[i] = 1; // new land only counts once it's green
    if (landA && landB) stableLand[i] = 1;
  }
  const solid = majority(cand, ra, MAJORITY);
  const solidGain = majority(gainCand, stableLand, MAJORITY);

  // Keep only land that connects to the earlier river bed, within a realistic distance.
  const maxSteps = Math.round(Math.min(GROW_MAX_M, GROW_M_PER_YEAR * (y1 - y0)) / res);
  const depth = new Int16Array(N);
  let head = 0, tail = 0;
  for (let i = W; i < N - W; i++) {
    if (!solid[i]) continue;
    if (ra[i - 1] || ra[i + 1] || ra[i - W] || ra[i + W]) { depth[i] = 1; queue[tail++] = i; }
  }
  while (head < tail) {
    const p = queue[head++];
    if (depth[p] >= maxSteps) continue;
    for (const nb of [p - 1, p + 1, p - W, p + W]) {
      if (nb < 0 || nb >= N || !solid[nb] || depth[nb]) continue;
      depth[nb] = depth[p] + 1;
      queue[tail++] = nb;
    }
  }

  const change = new Uint8Array(N);
  const taken = new Float64Array(Z + 1), gained = new Float64Array(Z + 1);
  for (let i = 0; i < N; i++) {
    if (depth[i]) { change[i] = 1; taken[zone[i]]++; }
    else if (solidGain[i]) { change[i] = 3; gained[zone[i]]++; }
  }
  const byUpazila = upazilas.map((u) => ({
    code: u.code,
    lostLandHa: +(taken[u.index] * PX_HA).toFixed(1),
    gainedHa: +(gained[u.index] * PX_HA).toFixed(1),
    coverage: +(bothValid[u.index] / zonePx[u.index]).toFixed(3),
  }));
  return { from: y0, to: y1, annual: y1 - y0 === 1, change, byUpazila };
}

// Map colours: established land taken = red, new green land = teal. Validated for colour-blind separation.
const COLOURS = { 1: [255, 64, 72, 255], 3: [25, 163, 181, 235] };
function overlay(change, x0, y0, w, h, step, districtOnly) {
  const ow = Math.floor(w / step), oh = Math.floor(h / step);
  const png = new PNG({ width: ow, height: oh });
  for (let r = 0; r < oh; r++) for (let c = 0; c < ow; c++) {
    let best = 0;
    for (let dr = 0; dr < step; dr++) for (let dc = 0; dc < step; dc++) {
      const i = (y0 + r * step + dr) * W + x0 + c * step + dc;
      if (districtOnly && !zone[i]) continue;
      const v = change[i];
      if (v === 1) best = 1;
      else if (v === 3 && best !== 1) best = 3;
    }
    if (best) png.data.set(COLOURS[best], (r * ow + c) * 4);
  }
  return PNG.sync.write(png);
}

const periods = [];
const lostYears = new Uint8Array(N);
for (let k = 1; k < years.length; k++) {
  const p = compare(k - 1, k);
  if (p.annual) for (let i = 0; i < N; i++) if (p.change[i] === 1) lostYears[i]++;
  await writeFile(new URL(`d_${p.from}_${p.to}.png`, IMG), overlay(p.change, 0, 0, W, H, 2, true));
  periods.push(p);
  const t = (key) => p.byUpazila.reduce((acc, u) => acc + u[key], 0).toFixed(0);
  console.log(`${p.from}->${p.to}: taken ${t("lostLandHa")} ha, new ${t("gainedHa")} ha | ` + p.byUpazila.map((u) => `${INFO[u.code].en.slice(0, 5)} ${u.lostLandHa.toFixed(0)}`).join(" "));
}
const lastK = years.length - 1;
const last = years[lastK];
const longTerm = compare(0, lastK);
await writeFile(new URL(`d_${longTerm.from}_${longTerm.to}.png`, IMG), overlay(longTerm.change, 0, 0, W, H, 2, true));
const recentK = years.indexOf(RECENT_FROM);
const recent = recentK >= 0 && recentK !== lastK ? compare(recentK, lastK) : null;
if (recent) await writeFile(new URL(`d_${recent.from}_${recent.to}.png`, IMG), overlay(recent.change, 0, 0, W, H, 2, true));
console.log(`${longTerm.from}->${longTerm.to} land now river bed: ` + longTerm.byUpazila.map((u) => `${INFO[u.code].en} ${u.lostLandHa.toFixed(0)}`).join(", "));
if (recent) console.log(`${recent.from}->${recent.to} land now river bed: ` + recent.byUpazila.map((u) => `${INFO[u.code].en} ${u.lostLandHa.toFixed(0)}`).join(", "));

// ---- Close-up: the 12 km square with the most repeated land loss in upazilas NOT on the 2019 list ----
const offList = new Set(upazilas.filter((u) => !u.onList).map((u) => u.index));
const integral = new Float64Array((W + 1) * (H + 1));
for (let r = 0; r < H; r++) {
  let row = 0;
  for (let c = 0; c < W; c++) {
    const i = r * W + c;
    row += offList.has(zone[i]) ? lostYears[i] : 0;
    integral[(r + 1) * (W + 1) + c + 1] = integral[r * (W + 1) + c + 1] + row;
  }
}
let focal = { x: 0, y: 0, score: -1 };
for (let y = 0; y + FOCAL_PX <= H; y += 10) for (let x = 0; x + FOCAL_PX <= W; x += 10) {
  const sc = integral[(y + FOCAL_PX) * (W + 1) + x + FOCAL_PX] - integral[y * (W + 1) + x + FOCAL_PX] - integral[(y + FOCAL_PX) * (W + 1) + x] + integral[y * (W + 1) + x];
  if (sc > focal.score) focal = { x, y, score: sc };
}
focal.x -= focal.x % 2; focal.y -= focal.y % 2; // align with the 60 m map
const focalCounts = new Float64Array(Z + 1);
for (let r = focal.y; r < focal.y + FOCAL_PX; r++) for (let c = focal.x; c < focal.x + FOCAL_PX; c++) {
  const i = r * W + c;
  if (offList.has(zone[i])) focalCounts[zone[i]] += lostYears[i];
}
const focalUpazila = upazilas.reduce((best, u) => (focalCounts[u.index] > focalCounts[best.index] ? u : best), upazilas[0]);
const [flon, flat] = proj4(utmDef, "EPSG:4326", [xmin + (focal.x + FOCAL_PX / 2) * res, ymax - (focal.y + FOCAL_PX / 2) * res]);
console.log(`close-up x ${focal.x} y ${focal.y} (loss mostly in ${focalUpazila.en}), centre ${flat.toFixed(4)}N ${flon.toFixed(4)}E, score ${focal.score}`);

for (const year of years) {
  const [g, n, s] = await Promise.all(["green", "nir08", "swir16"].map((b) => band(year, b)));
  const rgba = Buffer.alloc(FOCAL_PX * FOCAL_PX * 4);
  for (let r = 0; r < FOCAL_PX; r++) for (let c = 0; c < FOCAL_PX; c++) {
    const i = (focal.y + r) * W + focal.x + c;
    const o = (r * FOCAL_PX + c) * 4;
    rgba[o + 3] = 255;
    if (!g[i]) { rgba[o] = 22; rgba[o + 1] = 24; rgba[o + 2] = 27; continue; }
    rgba[o] = tone(refl(s[i]), 0.4); rgba[o + 1] = tone(refl(n[i]), 0.45); rgba[o + 2] = tone(refl(g[i]), 0.2);
  }
  await writeFile(new URL(`f_${year}.jpg`, IMG), jpeg.encode({ data: rgba, width: FOCAL_PX, height: FOCAL_PX }, 84).data);
}
const focalPairs = [periods[periods.length - 1], longTerm, recent].filter(Boolean);
for (const p of focalPairs) await writeFile(new URL(`fd_${p.from}_${p.to}.png`, IMG), overlay(p.change, focal.x, focal.y, FOCAL_PX, FOCAL_PX, 1, false));

// ---- Data for the page ----
const clean = (p) => p && { from: p.from, to: p.to, annual: p.annual, byUpazila: p.byUpazila };
const data = {
  generated: new Date().toISOString().slice(0, 10),
  source: meta.source,
  image: { width: W >> 1, height: H >> 1, metresPerPixel: 60 },
  focal: { x: focal.x / 2, y: focal.y / 2, size: FOCAL_PX / 2, km: (FOCAL_PX * res) / 1000, upazila: focalUpazila.code, center: [+flat.toFixed(4), +flon.toFixed(4)], overlays: focalPairs.map((p) => p.from) },
  scenes: years.map((y) => ({ year: y, id: meta.scenes[y].id, date: meta.scenes[y].date, platform: meta.scenes[y].platform, cloud: meta.scenes[y].cloud })),
  method: { T_WATER, T_WATER_GNDVI, T_SAND_GNDVI, T_SAND_GREEN, T_VEG, MIN_BED_KM2, MIN_BED_WATER_KM2, MAJORITY, GROW_M_PER_YEAR, GROW_MAX_M, pixelHa: PX_HA },
  upazilas: upazilas.map(({ index, ...u }) => u),
  periods: periods.map(clean),
  longTerm: clean(longTerm),
  recent: clean(recent),
  diagnostics,
};
await writeFile(new URL("web/data.js", ROOT), "window.NODIR = " + JSON.stringify(data) + ";\n");
console.log("wrote web/data.js and images");

// ---- Data for the phone app "নদী কতদূর?" ----
const APP = new URL("app/", ROOT);
await mkdir(new URL("data/", APP), { recursive: true });
await mkdir(new URL("img/", APP), { recursive: true });

// Chamfer (3-4) distance to the river bed. One unit = 10 m (3 units per 30 m pixel).
function distanceToBed(bed) {
  const d = new Uint32Array(N).fill(1e9);
  for (let i = 0; i < N; i++) if (bed[i]) d[i] = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c;
    let v = d[i];
    if (v === 0) continue;
    if (c > 0 && d[i - 1] + 3 < v) v = d[i - 1] + 3;
    if (r > 0) {
      if (d[i - W] + 3 < v) v = d[i - W] + 3;
      if (c > 0 && d[i - W - 1] + 4 < v) v = d[i - W - 1] + 4;
      if (c < W - 1 && d[i - W + 1] + 4 < v) v = d[i - W + 1] + 4;
    }
    d[i] = v;
  }
  for (let r = H - 1; r >= 0; r--) for (let c = W - 1; c >= 0; c--) {
    const i = r * W + c;
    let v = d[i];
    if (v === 0) continue;
    if (c < W - 1 && d[i + 1] + 3 < v) v = d[i + 1] + 3;
    if (r < H - 1) {
      if (d[i + W] + 3 < v) v = d[i + W] + 3;
      if (c < W - 1 && d[i + W + 1] + 4 < v) v = d[i + W + 1] + 4;
      if (c > 0 && d[i + W - 1] + 4 < v) v = d[i + W - 1] + 4;
    }
    d[i] = v;
  }
  return d;
}

const prevYear = years[lastK - 1];
const baseYear = years.includes(last - 5) ? last - 5 : years[Math.max(0, lastK - 5)];
const steps30 = (units) => Math.min(255, Math.round(units / 3)); // store distance in 30 m steps, capped at 7.65 km
const distNow = distanceToBed(BED[last]);
const distPrev = distanceToBed(BED[prevYear]);
const distBase = distanceToBed(BED[baseYear]);
const distPng = new PNG({ width: W, height: H });
for (let i = 0; i < N; i++) {
  const o = i * 4;
  distPng.data[o] = steps30(distNow[i]);
  distPng.data[o + 1] = steps30(distPrev[i]);
  distPng.data[o + 2] = steps30(distBase[i]);
  distPng.data[o + 3] = 255;
}
await writeFile(new URL("data/dist.png", APP), PNG.sync.write(distPng, { colorType: 2 }));

// info.png — R: upazila index (0 outside Kurigram); G: yearly comparisons since baseYear in which this spot's land became river bed;
// B: bit flags 1 = river bed now, 2 = land taken in the latest year, 4 = river bed a year ago, 8 = no clear view in the latest photo.
const recentAnnual = periods.filter((p) => p.annual && p.from >= baseYear);
const latestPeriod = periods[periods.length - 1];
const infoPng = new PNG({ width: W, height: H });
for (let i = 0; i < N; i++) {
  let count = 0;
  for (const p of recentAnnual) if (p.change[i] === 1) count++;
  const o = i * 4;
  infoPng.data[o] = zone[i];
  infoPng.data[o + 1] = count;
  infoPng.data[o + 2] = (BED[last][i] ? 1 : 0) | (latestPeriod.change[i] === 1 ? 2 : 0) | (BED[prevYear][i] ? 4 : 0) | (CLS[last][i] ? 0 : 8);
  infoPng.data[o + 3] = 255;
}
await writeFile(new URL("data/info.png", APP), PNG.sync.write(infoPng, { colorType: 2 }));

// Full-detail (30 m) photos for the before/after view.
for (const year of [baseYear, last]) {
  const [g, n, s] = await Promise.all(["green", "nir08", "swir16"].map((b) => band(year, b)));
  const rgba = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    rgba[o + 3] = 255;
    if (!g[i]) { rgba[o] = 22; rgba[o + 1] = 24; rgba[o + 2] = 27; continue; }
    rgba[o] = tone(refl(s[i]), 0.4); rgba[o + 1] = tone(refl(n[i]), 0.45); rgba[o + 2] = tone(refl(g[i]), 0.2);
  }
  await writeFile(new URL(`img/k30_${year}.jpg`, APP), jpeg.encode({ data: rgba, width: W, height: H }, 76).data);
}

// Sample places for testers who aren't in Kurigram: in each unlisted upazila (and Chilmari), the spot that lost land most often
// and still stands 90–600 m from the river bed.
const toLonLat = proj4(utmDef, "EPSG:4326");
const pxToLonLat = (x, y) => toLonLat.forward([xmin + (x + 0.5) * res, ymax - (y + 0.5) * res]);
const samples = [];
for (const u of upazilas.filter((x) => !x.onList || x.en === "Chilmari")) {
  let best = -1, bestI = -1;
  for (let i = 0; i < N; i++) {
    if (zone[i] !== u.index || BED[last][i]) continue;
    const dn = distNow[i];
    if (dn < 9 || dn > 60) continue;
    let count = 0;
    for (const p of recentAnnual) if (p.change[i] === 1) count++;
    const score = count * 1000 - dn;
    if (count && score > best) { best = score; bestI = i; }
  }
  if (bestI < 0) continue;
  const [lon, lat] = pxToLonLat(bestI % W, Math.floor(bestI / W));
  samples.push({ upazila: u.code, lat: +lat.toFixed(5), lon: +lon.toFixed(5) });
}

const [cx, cy] = toUtm.forward([89.6, 25.8]);
const appData = {
  generated: new Date().toISOString().slice(0, 10),
  grid: { W, H, xmin, ymax, res, utmZone: 45 },
  years: { now: last, prev: prevYear, base: baseYear },
  dates: { now: meta.scenes[last].date, prev: meta.scenes[prevYear].date, base: meta.scenes[baseYear].date },
  upazilas: upazilas.map((u) => {
    const rows = recentAnnual.map((p) => p.byUpazila.find((b) => b.code === u.code));
    return { index: u.index, code: u.code, en: u.en, bn: u.bn, onList: u.onList, listRiversBn: u.listRiversBn ?? null, takenHa: Math.round(rows.reduce((a, r) => a + r.lostLandHa, 0)), lossYears: rows.filter((r) => r.lostLandHa >= 5).length, comparisons: rows.length };
  }),
  samples,
  projectionCheck: { lon: 89.6, lat: 25.8, x: +((cx - xmin) / res).toFixed(2), y: +((ymax - cy) / res).toFixed(2) },
};
await writeFile(new URL("data/app.js", APP), "window.NODI_APP = " + JSON.stringify(appData) + ";\n");
console.log(`app data: now ${last}, prev ${prevYear}, base ${baseYear}; samples ${JSON.stringify(samples)}`);
