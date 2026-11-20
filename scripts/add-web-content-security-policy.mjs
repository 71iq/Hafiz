#!/usr/bin/env node
// Adds a Content-Security-Policy <meta> to every page of the web export.
//
// The signed-in session lives in localStorage, so an injected script could take over an account.
// This policy lets a page run only the export's own script files and the few inline scripts the
// export itself contains, each allowed by its SHA-256. It is generated here rather than set in the
// web server because those hashes change whenever app/+html.tsx or Expo's output changes, and a
// stale server list would block the page's own start-up scripts.
//
// A <meta> policy cannot carry frame-ancestors; deploy/hetzner/Caddyfile sends that header.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const POLICY_META = /<meta http-equiv="Content-Security-Policy"[^>]*>/i;
const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const CHARSET_META = /<meta charset="[^"]*"\s*\/?>/i;

function originOf(url) {
  try {
    const parsed = new URL(url ?? "");
    return parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(html, { supabaseUrl } = {}) {
  const hashes = new Set();
  for (const [, source] of html.matchAll(INLINE_SCRIPT)) {
    hashes.add(`'sha256-${crypto.createHash("sha256").update(source, "utf8").digest("base64")}'`);
  }
  const api = originOf(supabaseUrl);
  const own = ["'self'", ...(api ? [api] : [])];
  return [
    ["default-src", "'self'"],
    // wasm-unsafe-eval compiles the SQLite WebAssembly module; it does not allow eval of script text.
    ["script-src", "'self'", "'wasm-unsafe-eval'", ...hashes],
    // React Native Web writes style attributes into the exported markup.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", ...own, "data:", "blob:"],
    ["font-src", "'self'", "data:"],
    // Recitation plays from Quran Foundation and reciter mirrors, whose hosts the audio lookup returns.
    ["media-src", "'self'", "blob:", "https:"],
    // blob: and data: are the photo a person just picked, read before it is uploaded.
    ["connect-src", ...own, "blob:", "data:"],
    ["worker-src", "'self'", "blob:"],
    ["manifest-src", "'self'"],
    ["frame-src", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
  ]
    .map((directive) => directive.join(" "))
    .join("; ");
}

export function withContentSecurityPolicy(html, options) {
  if (/\son[a-z]+\s*=\s*["']/i.test(html.replace(INLINE_SCRIPT, ""))) {
    throw new Error("The page has an inline event handler, which the policy would block");
  }
  const withoutPolicy = html.replace(POLICY_META, "");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(withoutPolicy, options)}"/>`;
  const charset = CHARSET_META.exec(withoutPolicy);
  if (charset) {
    const end = charset.index + charset[0].length;
    return withoutPolicy.slice(0, end) + meta + withoutPolicy.slice(end);
  }
  const head = /<head[^>]*>/i.exec(withoutPolicy);
  if (!head) throw new Error("The page has no <head> for the policy");
  const end = head.index + head[0].length;
  return withoutPolicy.slice(0, end) + meta + withoutPolicy.slice(end);
}

export function addContentSecurityPolicy(dist, options) {
  const pages = fs
    .readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.join(entry.parentPath, entry.name));
  for (const page of pages) {
    try {
      fs.writeFileSync(page, withContentSecurityPolicy(fs.readFileSync(page, "utf8"), options));
    } catch (error) {
      throw new Error(`${path.relative(dist, page)}: ${error.message}`);
    }
  }
  return pages.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(process.argv[2] ?? "dist");
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const pages = addContentSecurityPolicy(dist, { supabaseUrl });
  if (pages === 0) {
    console.error(`[content-security-policy] No page found under ${dist}`);
    process.exit(1);
  }
  const api = originOf(supabaseUrl);
  console.log(`[content-security-policy] ${pages} pages, API origin ${api ?? "not configured (same origin only)"}`);
}
