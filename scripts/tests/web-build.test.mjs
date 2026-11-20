import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { compressWebDatabases } from "../compress-web-database.mjs";
import {
  addContentSecurityPolicy,
  contentSecurityPolicy,
  withContentSecurityPolicy,
} from "../add-web-content-security-policy.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function temporaryExport(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hafiz-web-build-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const hashOf = (source) => `'sha256-${crypto.createHash("sha256").update(source, "utf8").digest("base64")}'`;
const directive = (policy, name) =>
  policy
    .split("; ")
    .find((entry) => entry.startsWith(`${name} `))
    ?.split(" ")
    .slice(1);

const THEME_SCRIPT = `(function () { document.documentElement.dataset.theme = "dark"; })();`;
const HYDRATE_SCRIPT = "globalThis.__EXPO_ROUTER_HYDRATE__=true;";
const PAGE = [
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Synthetic</title>`,
  `<script>${THEME_SCRIPT}</script><style id="react-native-stylesheet">a{color:red}</style>`,
  `<script type="module">${HYDRATE_SCRIPT}</script>`,
  `<script src="/_expo/static/js/web/entry-0.js" defer></script></head>`,
  `<body><div id="root" style="display:flex"></div></body></html>`,
].join("");

test("the gzip copy of each exported database decompresses to exactly that database", (t) => {
  const dist = temporaryExport(t);
  const data = path.join(dist, "assets/assets/data");
  fs.mkdirSync(data, { recursive: true });
  const database = crypto.randomBytes(300_000);
  fs.writeFileSync(path.join(data, "quran.0123.db"), database);
  fs.writeFileSync(path.join(data, "notes.json"), "{}");

  const written = compressWebDatabases(dist);

  assert.equal(written.length, 1);
  assert.equal(written[0].bytes, database.length);
  const copy = fs.readFileSync(path.join(data, "quran.0123.db.gz"));
  assert.equal(written[0].gzipBytes, copy.length);
  assert.deepEqual(zlib.gunzipSync(copy), database);
  assert.deepEqual(fs.readdirSync(data).sort(), ["notes.json", "quran.0123.db", "quran.0123.db.gz"]);
});

test("an export without a database writes nothing", (t) => {
  const dist = temporaryExport(t);
  assert.deepEqual(compressWebDatabases(dist), []);
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  assert.deepEqual(compressWebDatabases(dist), []);
});

test("the policy allows the page's own inline scripts by hash and no other inline script", () => {
  const policy = contentSecurityPolicy(PAGE);

  assert.deepEqual(directive(policy, "script-src"), [
    "'self'",
    "'wasm-unsafe-eval'",
    hashOf(THEME_SCRIPT),
    hashOf(HYDRATE_SCRIPT),
  ]);
  assert.ok(!policy.includes("'unsafe-eval'"));
  assert.ok(!directive(policy, "script-src").includes("'unsafe-inline'"));
  assert.deepEqual(directive(policy, "object-src"), ["'none'"]);
  assert.deepEqual(directive(policy, "base-uri"), ["'self'"]);
  assert.deepEqual(directive(policy, "frame-src"), ["'none'"]);
});

test("only the configured HTTPS API origin is added for requests and images", () => {
  const configured = contentSecurityPolicy(PAGE, { supabaseUrl: "https://api.synthetic.example/rest/v1?x=1" });
  assert.deepEqual(directive(configured, "connect-src"), ["'self'", "https://api.synthetic.example", "blob:", "data:"]);
  assert.deepEqual(directive(configured, "img-src"), ["'self'", "https://api.synthetic.example", "data:", "blob:"]);

  for (const supabaseUrl of [
    undefined,
    "",
    "YOUR_PROJECT_URL",
    "http://api.synthetic.example",
    "javascript:alert(1)",
  ]) {
    assert.deepEqual(directive(contentSecurityPolicy(PAGE, { supabaseUrl }), "connect-src"), [
      "'self'",
      "blob:",
      "data:",
    ]);
  }
  const local = contentSecurityPolicy(PAGE, { supabaseUrl: "http://127.0.0.1:54321" });
  assert.ok(directive(local, "connect-src").includes("http://127.0.0.1:54321"));
});

test("the policy is the first thing after the charset and a second run changes nothing", () => {
  const once = withContentSecurityPolicy(PAGE, { supabaseUrl: "https://api.synthetic.example" });

  assert.ok(
    once.startsWith(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta http-equiv="Content-Security-Policy" content="default-src 'self'; `,
    ),
  );
  assert.ok(once.indexOf("Content-Security-Policy") < once.indexOf("<script"));
  assert.equal(once.match(/Content-Security-Policy/g).length, 1);
  assert.equal(withContentSecurityPolicy(once, { supabaseUrl: "https://api.synthetic.example" }), once);
  assert.equal(once.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ""), PAGE);
});

test("a page without a charset gets the policy at the start of its head, and a page with an inline handler is refused", () => {
  const bare = "<html><head><title>x</title></head><body></body></html>";
  assert.ok(withContentSecurityPolicy(bare).startsWith(`<html><head><meta http-equiv="Content-Security-Policy"`));
  assert.throws(() => withContentSecurityPolicy("<html><body></body></html>"), /no <head>/);
  assert.throws(
    () => withContentSecurityPolicy(PAGE.replace(`<div id="root"`, `<div onclick="go()" id="root"`)),
    /inline event handler/,
  );
  // Script text that merely mentions a handler attribute is not markup.
  assert.doesNotThrow(() => withContentSecurityPolicy(PAGE.replace(THEME_SCRIPT, `var t = ' onload="x"';`)));
});

test("every page of an export gets its policy", (t) => {
  const dist = temporaryExport(t);
  fs.mkdirSync(path.join(dist, "auth"), { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), PAGE);
  fs.writeFileSync(path.join(dist, "auth/login.html"), PAGE.replace(THEME_SCRIPT, "var other = 1;"));
  fs.writeFileSync(path.join(dist, "robots.txt"), "User-agent: *\n");

  assert.equal(addContentSecurityPolicy(dist, {}), 2);

  assert.ok(fs.readFileSync(path.join(dist, "index.html"), "utf8").includes(hashOf(THEME_SCRIPT)));
  const login = fs.readFileSync(path.join(dist, "auth/login.html"), "utf8");
  assert.ok(login.includes(hashOf("var other = 1;")) && !login.includes(hashOf(THEME_SCRIPT)));
  assert.equal(fs.readFileSync(path.join(dist, "robots.txt"), "utf8"), "User-agent: *\n");
});

test("Metro bundles import each icon's own module, and Jest keeps the package import", () => {
  const babel = require("@babel/core");
  const source = [
    `import { BookOpen, type LucideIcon, X as Close, createLucideIcon, NotAnIcon } from "lucide-react-native";`,
    `import type { LucideProps } from "lucide-react-native";`,
    `export const icons: LucideIcon[] = [BookOpen, Close]; export const more = [createLucideIcon, NotAnIcon];`,
    `export type Props = LucideProps;`,
  ].join("\n");
  // jest-expo transforms with the caller name "metro" too; only the environment tells them apart.
  const transform = (envName) =>
    babel.transformSync(source, {
      filename: path.join(root, "components/Synthetic.tsx"),
      caller: { name: "metro", platform: "web", supportsStaticESM: true },
      envName,
      babelrc: false,
      configFile: path.join(root, "babel.config.js"),
    }).code;
  const icons = path.join(root, "node_modules/lucide-react-native/dist/esm");

  const bundled = transform("production");
  for (const file of ["icons/book-open.js", "icons/x.js", "createLucideIcon.js"]) {
    assert.ok(bundled.includes(JSON.stringify(path.join(icons, file))), `${file} is imported directly`);
    assert.ok(fs.existsSync(path.join(icons, file)));
  }
  // A name the package entry does not re-export stays on the package import.
  assert.match(bundled, /import\s*\{\s*NotAnIcon\s*\}\s*from\s*"lucide-react-native"/);
  assert.equal(bundled.match(/from\s*"lucide-react-native"/g).length, 1);

  const tested = transform("test");
  assert.ok(!tested.includes(icons));
  assert.match(tested, /"lucide-react-native"/);
});

test("Metro bundles the English-only module where zod re-exports all its locales", () => {
  const { resolver } = require(path.join(root, "metro.config.js"));
  const elsewhere = { type: "sourceFile", filePath: "/synthetic/elsewhere.js" };
  const context = (originModulePath) => ({ originModulePath, resolveRequest: () => elsewhere });
  const shim = path.join(root, "scripts/metro-zod-locales.mjs");
  const zod = path.join(root, "node_modules/zod/v4");

  for (const origin of ["classic/external.js", "core/index.js"]) {
    // These are the files that re-export the locale index; a zod upgrade that moves them fails here.
    assert.match(
      fs.readFileSync(path.join(zod, origin), "utf8"),
      /export \* as locales from "\.\.\/locales\/index\.js";/,
    );
    assert.deepEqual(resolver.resolveRequest(context(path.join(zod, origin)), "../locales/index.js", "web"), {
      type: "sourceFile",
      filePath: shim,
    });
  }
  assert.equal(
    resolver.resolveRequest(context(path.join(zod, "classic/external.js")), "../locales/en.js", "web"),
    elsewhere,
  );
  assert.equal(resolver.resolveRequest(context(path.join(root, "lib/x.ts")), "../locales/index.js", "web"), elsewhere);
  assert.ok(fs.existsSync(path.join(zod, "locales/en.js")));
  assert.match(fs.readFileSync(shim, "utf8"), /export \{ default as en \} from "zod\/v4\/locales\/en";/);
});
