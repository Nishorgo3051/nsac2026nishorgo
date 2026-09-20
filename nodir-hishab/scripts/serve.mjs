// Tiny static server for previewing web/ locally (Node built-ins only).
// Wraps index.html in the same doctype/head skeleton the Artifact host adds at publish time.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const PORT = Number(process.env.PORT ?? 8765);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png" };
const SKELETON_START = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>';

createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const rel = normalize(pathname === "/" ? "index.html" : pathname).replace(/^[/\\]+/, "");
  if (rel.startsWith("..")) {
    res.writeHead(403).end();
    return;
  }
  try {
    let body = await readFile(join(ROOT, rel));
    if (rel === "index.html") body = Buffer.concat([Buffer.from(SKELETON_START), body, Buffer.from("</body></html>")]);
    res.writeHead(200, { "Content-Type": TYPES[extname(rel)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Serving ${ROOT} at http://localhost:${PORT}`));
