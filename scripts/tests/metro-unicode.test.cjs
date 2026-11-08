const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { test } = require("node:test");

const root = process.cwd();
const rootRequire = createRequire(path.join(root, "package.json"));
const config = rootRequire("./metro.config.js");
// Follow the same dependency owner as Expo instead of assuming a hoisted minifier.
const expoOwner = createRequire(rootRequire.resolve("expo/metro-config"));
const configOwner = createRequire(expoOwner.resolve("@expo/metro-config/package.json"));
const facadeOwner = createRequire(configOwner.resolve("@expo/metro/metro-transform-worker"));
const workerOwner = createRequire(facadeOwner.resolve("metro-transform-worker"));
const imported = workerOwner(config.transformer.minifierPath);
const minify = typeof imported === "function" ? imported : imported.default;
const sample = {
  arabic: "نص عربي للاختبار",
  marks: "ي\u0651",
  astral: "\u{1f4d6}",
  privateUse: "\uE000\uFDF2",
  separators: "\u2028\u2029",
  escapes: '\"\\\n\r\t',
  literalEscape: "\\u0641",
};

async function minifyJson(json, filename) {
  return minify({
    code: `module.exports=${json};`,
    filename,
    map: null,
    reserved: [],
    config: config.transformer.minifierConfig,
  });
}

function evaluate(code) {
  const module = { exports: null };
  vm.runInNewContext(code, { module }, { timeout: 5000 });
  return module.exports;
}

const fixture = minifyJson(JSON.stringify(sample), "unicode-fixture.js");

test("the configured minifier preserves Unicode and escaped string values", async () => {
  const result = evaluate((await fixture).code);
  assert.deepEqual(Object.keys(result).sort(), Object.keys(sample).sort());
  for (const [key, value] of Object.entries(sample)) assert.equal(result[key], value, key);
});

test("Arabic literals remain Unicode instead of expanding to ASCII escape sequences", async () => {
  assert.ok((await fixture).code.includes(sample.arabic), "ASCII expansion can exceed the native bundle string limit");
});

test("representative protected JSON keeps every parsed value through the configured minifier", async () => {
  const fingerprint = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  for (const name of ["quran-data.json", "quran-qcf2.json", "zilal.json"]) {
    const json = fs.readFileSync(path.join(root, "assets/data", name), "utf8");
    const expected = fingerprint(JSON.parse(json));
    const emitted = await minifyJson(json, name);
    assert.equal(fingerprint(evaluate(emitted.code)), expected, `${name}: parsed content changed`);
  }
});
