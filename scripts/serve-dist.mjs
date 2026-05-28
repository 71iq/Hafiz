#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const port = Number(process.argv[2] ?? process.env.PORT ?? 8099);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("[serve-dist] dist/index.html not found. Run `npm run build:web` first.");
  process.exit(1);
}

function resolveRequest(url) {
  const parsed = new URL(url ?? "/", `http://localhost:${port}`);
  const decodedPath = decodeURIComponent(parsed.pathname);
  const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = path.join(dist, normalizedPath);

  if (!requestedPath.startsWith(dist)) {
    return path.join(dist, "index.html");
  }

  if (fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()) {
    return requestedPath;
  }

  if (fs.existsSync(path.join(requestedPath, "index.html"))) {
    return path.join(requestedPath, "index.html");
  }

  return path.join(dist, "index.html");
}

const server = http.createServer((request, response) => {
  const filePath = resolveRequest(request.url);
  const extension = path.extname(filePath);
  response.setHeader("Content-Type", mimeTypes[extension] ?? "application/octet-stream");
  fs.createReadStream(filePath)
    .on("error", () => {
      response.statusCode = 500;
      response.end("Internal Server Error");
    })
    .pipe(response);
});

server.listen(port, "localhost", () => {
  console.log(`[serve-dist] http://localhost:${port}`);
});
