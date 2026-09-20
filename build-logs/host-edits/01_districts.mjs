// Step 1: turn the official district boundaries (BBS/OCHA via HDX) into a light SVG map of Bangladesh.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const SRC = new URL("../../nodir-hishab/data/raw/boundaries/bgd_admin2.geojson", import.meta.url);
const OUT = new URL("../data/", import.meta.url);
await mkdir(OUT, { recursive: true });

const gj = JSON.parse(await readFile(SRC, "utf8"));
console.log("districts:", gj.features.length, "| keys:", Object.keys(gj.features[0].properties).join(", "));

// Equirectangular projection scaled for Bangladesh's latitude, so shapes aren't squashed.
const LAT0 = 23.7;
const K = Math.cos((LAT0 * Math.PI) / 180);
const BOX = { lonMin: 88.0, lonMax: 92.7, latMin: 20.55, latMax: 26.65 };
const SCALE = 160; // SVG units per degree of latitude
const project = ([lon, lat]) => [(lon - BOX.lonMin) * K * SCALE, (BOX.latMax - lat) * SCALE];
const width = (BOX.lonMax - BOX.lonMin) * K * SCALE;
const height = (BOX.latMax - BOX.latMin) * SCALE;

// Douglas–Peucker on an open polyline (distinct endpoints).
function simplifyLine(points, eps) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
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

// A closed ring starts and ends on the same vertex, which collapses plain Douglas–Peucker to nothing.
// Split it at the vertex farthest from the start and simplify the two halves.
function simplifyRing(ring, eps) {
  const pts = ring.slice(0, -1);
  if (pts.length < 4) return ring;
  let far = 1, farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  const first = simplifyLine(pts.slice(0, far + 1), eps);
  const second = simplifyLine([...pts.slice(far), pts[0]], eps);
  return [...first, ...second.slice(1)];
}

const districts = gj.features.map((f) => {
  const p = f.properties;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const d = polys
    .flatMap((poly) => poly.map((ring) => simplifyRing(ring.map(project), 0.35)))
    .filter((ring) => ring.length >= 4)
    .map((ring) => "M" + ring.slice(0, -1).map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + "Z")
    .join("");
  return {
    code: p.adm2_pcode,
    en: p.adm2_name,
    division: p.adm1_name,
    lat: +p.center_lat.toFixed(4),
    lon: +p.center_lon.toFixed(4),
    path: d,
  };
});

const empty = districts.filter((x) => !x.path).map((x) => x.en);
if (empty.length) throw new Error(`districts with no outline: ${empty.join(", ")}`);

const out = { box: BOX, lat0: LAT0, scale: SCALE, width: +width.toFixed(1), height: +height.toFixed(1), districts };
const json = JSON.stringify(out);
await writeFile(new URL("districts.json", OUT), json);
const vertices = districts.reduce((n, x) => n + (x.path.match(/L/g) || []).length + 1, 0);
console.log(`wrote districts.json: ${(json.length / 1024).toFixed(0)} KB, ${vertices} vertices, viewBox ${out.width} x ${out.height}`);
