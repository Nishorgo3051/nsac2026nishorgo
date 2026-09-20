// Diagnostic: how do bare pixels right next to river water (mostly riverbed sand) differ from bare pixels far from water (fallow fields, soil)?
import { readFile } from "node:fs/promises";

const CACHE = new URL("../data/cache/", import.meta.url);
const meta = JSON.parse(await readFile(new URL("meta.json", CACHE), "utf8"));
const { W, H } = meta.grid;
const N = W * H;
const refl = (dn) => Math.max(dn * 2.75e-5 - 0.2, 1e-4);
async function band(y, b) {
  const buf = await readFile(new URL(`${y}_${b}.bin`, CACHE));
  return new Uint16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const pct = (arr, ps) => { const a = Float32Array.from(arr).sort(); return ps.map((p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]?.toFixed(3)); };

// Rajarhat's Teesta reach, roughly: columns/rows of the grid around 25.80N 89.55E
const years = Object.keys(meta.scenes).map(Number).sort((a, b) => a - b);
for (const year of years.filter((y) => [1989, 2010, 2016, 2019, 2020].includes(y))) {
  const [g, n, s, q] = await Promise.all(["green", "nir08", "swir16", "qa_pixel"].map((b) => band(year, b)));
  const valid = new Uint8Array(N), water = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (q[i] & 0b11111 || !g[i] || !s[i]) continue;
    valid[i] = 1;
    const G = refl(g[i]), NIR = refl(n[i]), S = refl(s[i]);
    if ((G - S) / (G + S) > 0 && (NIR - G) / (NIR + G) < 0) water[i] = 1;
  }
  // city-block distance to open water, in pixels (capped at 255)
  const dist = new Uint8Array(N).fill(255);
  for (let i = 0; i < N; i++) if (water[i]) dist[i] = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c;
    if (c > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
    if (r > 0) dist[i] = Math.min(dist[i], dist[i - W] + 1);
  }
  for (let r = H - 1; r >= 0; r--) for (let c = W - 1; c >= 0; c--) {
    const i = r * W + c;
    if (c < W - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
    if (r < H - 1) dist[i] = Math.min(dist[i], dist[i + W] + 1);
  }
  const groups = { near: { b: [], s: [], g: [], v: [] }, far: { b: [], s: [], g: [], v: [] } };
  for (let i = 0; i < N; i += 3) {
    if (!valid[i] || water[i]) continue;
    const G = refl(g[i]), NIR = refl(n[i]), S = refl(s[i]);
    const gndvi = (NIR - G) / (NIR + G);
    if (gndvi > 0.35) continue;
    const key = dist[i] <= 2 ? "near" : dist[i] >= 70 ? "far" : null;
    if (!key) continue;
    const grp = groups[key];
    grp.b.push((G + NIR + S) / 3); grp.s.push(S); grp.g.push(G); grp.v.push(gndvi);
  }
  const P = [10, 25, 50, 75, 90];
  console.log(`\n${year} (${meta.scenes[year].date}) — percentiles ${P.join("/")}`);
  for (const [k, grp] of Object.entries(groups)) {
    console.log(`  ${k.padEnd(4)} n=${grp.b.length}  brightness ${pct(grp.b, P).join(" ")} | swir ${pct(grp.s, P).join(" ")} | green ${pct(grp.g, P).join(" ")} | gndvi ${pct(grp.v, P).join(" ")}`);
  }
}
