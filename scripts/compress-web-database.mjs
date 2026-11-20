#!/usr/bin/env node
// Writes a gzip copy beside each SQLite database in the web export. The expo-sqlite web worker
// (patches/expo-sqlite) downloads that copy on a first visit and keeps the database itself as the
// fallback, so the copy must decompress to exactly the exported file.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function databasesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".db"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

export function compressWebDatabases(dist) {
  const written = [];
  for (const database of databasesUnder(path.join(dist, "assets"))) {
    const source = fs.readFileSync(database);
    const compressed = zlib.gzipSync(source, { level: 9 });
    if (sha256(zlib.gunzipSync(compressed)) !== sha256(source)) {
      throw new Error(`The gzip copy of ${database} does not match the database`);
    }
    const temporary = `${database}.gz.tmp`;
    fs.writeFileSync(temporary, compressed);
    fs.renameSync(temporary, `${database}.gz`);
    written.push({ database, bytes: source.length, gzipBytes: compressed.length });
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(process.argv[2] ?? "dist");
  const written = compressWebDatabases(dist);
  if (written.length === 0) {
    console.error(`[compress-web-database] No database found under ${path.join(dist, "assets")}`);
    process.exit(1);
  }
  for (const { database, bytes, gzipBytes } of written) {
    console.log(`[compress-web-database] ${path.relative(dist, database)}.gz ${gzipBytes} bytes (database ${bytes})`);
  }
}
