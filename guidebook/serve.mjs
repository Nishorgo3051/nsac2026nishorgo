// Serves the guidebook folder so the app and the packs share one origin.
// Node built-ins only.   node serve.mjs   then open http://localhost:8766/app/
//
// To prove the offline claim: load the app, download the region, then stop this server
// (Ctrl+C) and reload the page. The service worker serves the shell and the pack comes
// from the browser's own store.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./", import.meta.url));
const PORT = Number(process.env.PORT ?? 8766);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".geojson": "application/geo+json; charset=utf-8",
  ".png": "image/png", ".webmanifest": "application/manifest+json",
};
// The app's index.html carries no doctype, the same as an Artifact page, so add the wrapper here.
const HEAD = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  + "</head><body>";

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  let relative = normalize(pathname.replace(/^\/+/, ""));
  if (relative === "" || relative === "." || pathname.endsWith("/")) relative = join(relative, "index.html");
  if (relative.startsWith("..")) {
    response.writeHead(403).end();
    return;
  }
  try {
    let body = await readFile(join(ROOT, relative));
    if (relative.endsWith("index.html")) {
      body = Buffer.concat([Buffer.from(HEAD), body, Buffer.from("</body></html>")]);
    }
    response.writeHead(200, {
      "Content-Type": TYPES[extname(relative)] ?? "application/octet-stream",
      "Cache-Control": "no-store",            // the service worker does the caching, not the browser
      "Service-Worker-Allowed": "/",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Guidebook at http://localhost:${PORT}/app/`));
