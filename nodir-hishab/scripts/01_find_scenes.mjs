// Step 1: find the clearest dry-season Landsat scene for each year over Kurigram.
// Reads catalogue metadata only (small JSON); no imagery is downloaded here.
import { writeFile, mkdir } from "node:fs/promises";

const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const TOKEN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2-l2";
// Generous box around Kurigram district (refined later from the boundary map).
const KURIGRAM_BBOX = [89.35, 25.45, 89.95, 26.25];
const BANDS = ["green", "nir08", "swir16", "qa_pixel"];

async function search(datetime) {
  const items = [];
  let body = { collections: ["landsat-c2-l2"], bbox: KURIGRAM_BBOX, datetime, limit: 100 };
  let url = STAC;
  for (let page = 0; page < 5; page++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`STAC ${res.status}`);
    const json = await res.json();
    items.push(...json.features);
    const next = (json.links || []).find((l) => l.rel === "next");
    if (!next) break;
    url = next.href;
    body = next.body || body;
  }
  return items;
}

// A scene is usable if it fully contains the Kurigram box.
const covers = (b) => b[0] <= KURIGRAM_BBOX[0] && b[1] <= KURIGRAM_BBOX[1] && b[2] >= KURIGRAM_BBOX[2] && b[3] >= KURIGRAM_BBOX[3];

const results = {};
for (let year = 1988; year <= 2026; year++) {
  const items = await search(`${year}-01-01T00:00:00Z/${year}-03-31T23:59:59Z`);
  const usable = items
    .filter((f) => !f.properties.platform.includes("landsat-7") || year < 2003) // skip Landsat 7 stripe years
    .map((f) => ({
      id: f.id,
      date: f.properties.datetime.slice(0, 10),
      platform: f.properties.platform,
      path: f.properties["landsat:wrs_path"],
      row: f.properties["landsat:wrs_row"],
      cloud: f.properties["eo:cloud_cover"],
      cloudLand: f.properties["landsat:cloud_cover_land"],
      covers: covers(f.bbox),
      bbox: f.bbox.map((v) => +v.toFixed(3)),
      epsg: f.properties["proj:epsg"] ?? f.properties["proj:code"],
      assets: Object.fromEntries(BANDS.filter((k) => f.assets[k]).map((k) => [k, f.assets[k].href])),
    }))
    .sort((a, b) => a.cloud - b.cloud);
  results[year] = usable;
  const best = usable.slice(0, 3).map((s) => `${s.date} ${s.platform.replace("landsat-", "L")} ${s.path}/${s.row} cloud ${s.cloud} covers=${s.covers}`);
  console.log(`${year}: ${usable.length} scenes | ${best.join(" || ") || "none"}`);
}

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(new URL("../data/scene_catalogue.json", import.meta.url), JSON.stringify(results, null, 1));

// Estimate transfer size: HEAD the four band files of the clearest recent full-cover scene.
const token = (await (await fetch(TOKEN_URL)).json()).token;
const sample = results[2026].find((s) => s.covers) || results[2025].find((s) => s.covers);
if (sample) {
  let total = 0;
  for (const [band, href] of Object.entries(sample.assets)) {
    const res = await fetch(`${href}?${token}`, { method: "HEAD" });
    const bytes = Number(res.headers.get("content-length"));
    total += bytes;
    console.log(`size ${sample.id} ${band}: ${(bytes / 1e6).toFixed(1)} MB`);
  }
  console.log(`scene total (4 bands): ${(total / 1e6).toFixed(1)} MB; sample bbox ${sample.bbox}`);
}
