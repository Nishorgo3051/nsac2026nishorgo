// Serves the ingito folder so the app and the packs share one origin, which is what lets the
// service worker and the pack cache behave the way they will on a real device.
//
//   node serve.mjs        then open http://localhost:8767/app/
//
// To prove the offline claim: open the app, download the pack, then stop this server (Ctrl+C) and
// reload the page. The shell comes from the service worker and the pack from the browser's own
// store. Node built-ins only - nothing to install before a demonstration.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./", import.meta.url));
const PORT = Number(process.env.PORT ?? 8767);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".geojson": "application/geo+json; charset=utf-8",
  ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
// The app's index.html carries no doctype or head, so the same file can also be published as an
// artifact page. Add the wrapper here instead.
// The manifest and icon make the instrument installable: on a phone it goes on the home screen
// with its own icon and opens full screen, like any other app. The flag green colours the phone's
// own status bar.
const HEAD = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  + '<meta name="theme-color" content="#006a4e">'
  + '<link rel="manifest" href="manifest.webmanifest">'
  + '<link rel="icon" href="icon.svg" type="image/svg+xml">'
  + '<link rel="apple-touch-icon" href="icon-192.png">'
  + "</head><body>";

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  let relative = normalize(pathname.replace(/^\/+/, ""));
  if (relative === "" || relative === "." || pathname.endsWith("/")) {
    relative = join(relative, "index.html");
  }
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
      // Lets the instrument show "downloading 1.4 of 3.2 MB" instead of a bare "downloading".
      "Content-Length": body.length,
      "Cache-Control": "no-store",          // the service worker does the caching, not the browser
      "Service-Worker-Allowed": "/",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Ingito at http://localhost:${PORT}/app/`));
