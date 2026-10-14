import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
export const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain",
};
// Production files are delivered byte-for-byte at a gateway-like subpath. The
// worker's Chrome denies loopback HTTP; interception changes transport only.
export async function serveExport(route, root) {
  const url = new URL(route.request().url());
  const path =
    decodeURIComponent(url.pathname).replace(/^\/preview\//, "") ||
    "index.html";
  if (path.includes("..") || path.startsWith("/"))
    return route.fulfill({ status: 404, body: "Not found" });
  try {
    return route.fulfill({
      status: 200,
      body: await readFile(resolve(root, path)),
      contentType: mime[extname(path)] ?? "application/octet-stream",
    });
  } catch {
    return route.fulfill({ status: 404, body: "Not found" });
  }
}
