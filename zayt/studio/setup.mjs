import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const studio = path.dirname(fileURLToPath(import.meta.url)),
  repo = path.resolve(studio, "../.."),
  cache = path.resolve(process.env.ZAYT_CACHE || path.join(os.homedir(), ".cache/hafiz-zayt-studio"));
if (cache === repo || cache.startsWith(repo + path.sep)) throw Error("Studio cache must be outside the checkout");
if (process.version !== "v24.18.0") throw Error("Use Node v24.18.0 for the pinned capture environment");
fs.mkdirSync(cache, { recursive: true });
const lock = fs.readFileSync(path.join(studio, "toolchain.lock.json"));
fs.writeFileSync(path.join(cache, "package-lock.json"), lock);
fs.writeFileSync(
  path.join(cache, "package.json"),
  JSON.stringify({ private: true, ...JSON.parse(lock).packages[""] }, null, 2),
);
const run = (program, args) => execFileSync(program, args, { cwd: cache, stdio: "inherit" });
run("npm", ["ci", "--no-audit", "--no-fund"]);
run(path.join(cache, "node_modules/.bin/playwright"), ["install", "chromium", "--only-shell"]);
const archive = "libwebp-1.6.0-linux-x86-64.tar.gz";
run("curl", [
  "-fLsS",
  "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/" + archive,
  "-o",
  archive,
]);
const digest = crypto
  .createHash("sha256")
  .update(fs.readFileSync(path.join(cache, archive)))
  .digest("hex");
if (digest !== "1c5ffab71efecefa0e3c23516c3a3a1dccb45cc310ae1095c6f14ae268e38067")
  throw Error("libwebp checksum mismatch");
run("tar", ["xzf", archive]);
