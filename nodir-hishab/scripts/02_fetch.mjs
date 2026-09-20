// Step 2: download only the Kurigram window of each chosen Landsat scene (4 bands) and cache it.
// Source: USGS/NASA Landsat Collection 2 Level-2, served by Microsoft Planetary Computer.
import { fromUrl } from "geotiff";
import proj4 from "proj4";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const TOKEN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2-l2";
const BANDS = ["green", "nir08", "swir16", "qa_pixel"];
const YEARS = [1989, 2000, 2010, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const RES = 30;
const PAD_M = 1500;
const UTM45 = "+proj=utm +zone=45 +datum=WGS84 +units=m +no_defs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const catalogue = JSON.parse(await readFile(new URL("data/scene_catalogue.json", ROOT), "utf8"));
const upazilas = JSON.parse(await readFile(new URL("data/kurigram_upazilas.geojson", ROOT), "utf8"));

// Analysis grid: Kurigram's extent in UTM 45N, padded and snapped to the 30 m Landsat grid.
const toUtm = proj4("EPSG:4326", UTM45);
let [xmin, ymin, xmax, ymax] = [Infinity, Infinity, -Infinity, -Infinity];
for (const f of upazilas.features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) for (const c of ring) {
    const [x, y] = toUtm.forward(c);
    xmin = Math.min(xmin, x); ymin = Math.min(ymin, y); xmax = Math.max(xmax, x); ymax = Math.max(ymax, y);
  }
}
xmin = Math.floor((xmin - PAD_M) / RES) * RES;
ymin = Math.floor((ymin - PAD_M) / RES) * RES;
xmax = Math.ceil((xmax + PAD_M) / RES) * RES;
ymax = Math.ceil((ymax + PAD_M) / RES) * RES;
const W = (xmax - xmin) / RES;
const H = (ymax - ymin) / RES;
console.log(`grid ${W} x ${H} px (${((W * H) / 1e6).toFixed(2)} M px), UTM45 x ${xmin}..${xmax}, y ${ymin}..${ymax}`);

// Candidate scenes for a year, best first: clear (<=2% cloud) scenes nearest 20 Feb, then the rest by cloud.
function candidates(year) {
  const all = (catalogue[year] || []).filter((s) => s.covers && s.path === "138" && s.row === "042" && BANDS.every((b) => s.assets[b]) && s.cloud <= 15);
  const target = Date.UTC(year, 1, 20);
  const clear = all.filter((s) => s.cloud <= 2).sort((a, b) => Math.abs(Date.parse(a.date) - target) - Math.abs(Date.parse(b.date) - target));
  const rest = all.filter((s) => s.cloud > 2).sort((a, b) => a.cloud - b.cloud);
  return [...clear, ...rest];
}

async function exists(u) { try { await stat(u); return true; } catch { return false; } }

async function readWindow(href, token) {
  const tiff = await fromUrl(`${href}?${token}`, { allowFullFile: false, blockSize: 1024 * 1024 });
  const img = await tiff.getImage();
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  const fx = (xmin - ox) / rx;
  const fy = (oy - ymax) / -ry;
  const x0 = Math.round(fx);
  const y0 = Math.round(fy);
  const rasters = await img.readRasters({ window: [x0, y0, x0 + W, y0 + H], fillValue: 0 });
  return { data: rasters[0], epsg: img.geoKeys.ProjectedCSTypeGeoKey, shift: [+(fx - x0).toFixed(3), +(fy - y0).toFixed(3)] };
}

const cacheDir = new URL("data/cache/", ROOT);
await mkdir(cacheDir, { recursive: true });
const metaUrl = new URL("meta.json", cacheDir);
const meta = (await exists(metaUrl)) ? JSON.parse(await readFile(metaUrl, "utf8")) : { scenes: {} };
meta.grid = { xmin, ymin, xmax, ymax, W, H, res: RES, crs: "EPSG:32645" };
meta.source = "Landsat Collection 2 Level-2 (USGS/NASA) via Microsoft Planetary Computer";

for (const year of YEARS) {
  const files = BANDS.map((b) => new URL(`${year}_${b}.bin`, cacheDir));
  if (meta.scenes[year] && (await Promise.all(files.map(exists))).every(Boolean)) {
    console.log(`${year}: cached (${meta.scenes[year].id})`);
    continue;
  }
  let done = false;
  for (const scene of candidates(year).slice(0, 3)) {
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      const t0 = Date.now();
      try {
        const token = (await (await fetch(TOKEN_URL)).json()).token;
        const results = [];
        for (const b of BANDS) results.push(await readWindow(scene.assets[b], token)); // one band at a time
        results.forEach((r, i) => { if (r.epsg !== 32645) throw new Error(`${BANDS[i]} is EPSG:${r.epsg}, expected 32645`); });
        await Promise.all(results.map((r, i) => writeFile(files[i], Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength))));
        meta.scenes[year] = { id: scene.id, date: scene.date, platform: scene.platform, cloud: scene.cloud, shift: results[0].shift, dtype: results[0].data.constructor.name };
        await writeFile(metaUrl, JSON.stringify(meta, null, 1));
        console.log(`${year}: ${scene.id} ${scene.date} cloud ${scene.cloud} shift ${results[0].shift} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        done = true;
      } catch (err) {
        console.log(`${year}: ${scene.id} attempt ${attempt} failed: ${err.message}`);
        await sleep(5000 * attempt);
      }
    }
    if (done) break;
  }
  if (!done) console.log(`${year}: no scene could be downloaded; this year will be skipped`);
}
console.log("done");
