// Step 0: pull Kurigram's upazilas out of the official BBS/OCHA boundary file (HDX COD-AB).
import { readFile, writeFile } from "node:fs/promises";

const src = new URL("../data/raw/boundaries/bgd_admin3.geojson", import.meta.url);
const gj = JSON.parse(await readFile(src, "utf8"));
console.log("features:", gj.features.length, "| crs:", JSON.stringify(gj.crs ?? null));
console.log("property keys:", Object.keys(gj.features[0].properties).join(", "));
console.log("sample:", JSON.stringify(gj.features[0].properties));

const kur = gj.features.filter((f) =>
  Object.entries(f.properties).some(([k, v]) => /adm2|district/i.test(k) && typeof v === "string" && /kurigram/i.test(v))
);
console.log("\nKurigram upazilas:", kur.length);

function eachCoord(geom, fn) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) for (const ring of poly) for (const c of ring) fn(c);
}
const all = [Infinity, Infinity, -Infinity, -Infinity];
for (const f of kur) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  let n = 0;
  eachCoord(f.geometry, ([x, y]) => {
    n++;
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  });
  for (let i = 0; i < 2; i++) { all[i] = Math.min(all[i], b[i]); all[i + 2] = Math.max(all[i + 2], b[i + 2]); }
  const names = Object.entries(f.properties).filter(([k]) => /name|pcode|area/i.test(k)).map(([k, v]) => `${k}=${v}`).join(" | ");
  console.log(`${names} | ${f.geometry.type} | ${n} vertices | bbox ${b.map((v) => v.toFixed(3)).join(",")}`);
}
console.log("\nKurigram bbox:", all.map((v) => v.toFixed(4)).join(", "));

await writeFile(new URL("../data/kurigram_upazilas.geojson", import.meta.url), JSON.stringify({ type: "FeatureCollection", features: kur }));
console.log("wrote data/kurigram_upazilas.geojson");
