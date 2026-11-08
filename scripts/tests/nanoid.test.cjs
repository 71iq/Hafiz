const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = process.cwd();
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const copies = Object.keys(lock.packages).filter((name) => name.endsWith("/nanoid"));
assert.ok(copies.length > 0, "No locked nanoid copies were checked");
const variants = [
  "index.cjs",
  "index.js",
  "index.browser.cjs",
  "index.browser.js",
  "async/index.cjs",
  "async/index.js",
  "async/index.browser.cjs",
  "async/index.browser.js",
  "non-secure/index.cjs",
  "non-secure/index.js",
];

const probe = String.raw`
(async () => {
  const assert = require("node:assert/strict");
  const { pathToFileURL } = require("node:url");
  const file = process.argv[1];
  const mode = process.argv[2];
  const value = file.endsWith(".cjs") ? require(file) : await import(pathToFileURL(file).href);
  try {
    if (mode === "normal") {
      assert.equal((await value.nanoid()).length, 21);
      for (const size of [1, 6, 21]) {
        const id = await value.nanoid(size);
        assert.equal(id.length, size);
        assert.match(id, /^[A-Za-z0-9_-]+$/);
        const custom = await value.customAlphabet("abc", size)();
        assert.equal(custom.length, size);
        assert.match(custom, /^[abc]+$/);
      }
      if (value.customRandom) {
        assert.equal(value.customRandom("abc", 6, (size) => new Uint8Array(size))(), "aaaaaa");
      }
    } else {
      // Each input has a fresh process and random pool. Rejecting any RNG call
      // exposes the old invalid-size branch without running an infinite loop.
      const crypto = require("node:crypto");
      function unexpectedRandom() { throw new Error("Invalid size must not request random bytes"); }
      Math.random = unexpectedRandom;
      crypto.randomFillSync = unexpectedRandom;
      crypto.randomFill = unexpectedRandom;
      globalThis.crypto.getRandomValues = unexpectedRandom;
      const cases = {
        "alphabet-default-zero": () => value.customAlphabet("abc", 0)(),
        "alphabet-explicit-zero": () => value.customAlphabet("abc", 21)(0),
        "random-default-zero": () => value.customRandom("abc", 0, unexpectedRandom)(),
        "random-explicit-zero": () => value.customRandom("abc", 21, unexpectedRandom)(0),
        "nanoid-negative": () => value.nanoid(-1),
        "alphabet-default-negative": () => value.customAlphabet("abc", -1)(),
        "alphabet-explicit-negative": () => value.customAlphabet("abc", 21)(-1),
      };
      assert.equal(await cases[mode](), "");
    }
    console.log(JSON.stringify({ ok: true }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.name, message: error.message }));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;

const results = [];
for (const copy of copies) {
  for (const variant of variants) {
    const modes = ["normal", "alphabet-default-zero", "alphabet-explicit-zero"];
    if (!variant.includes("/")) modes.push("random-default-zero", "random-explicit-zero");
    if (variant.startsWith("non-secure/")) {
      modes.push("nanoid-negative", "alphabet-default-negative", "alphabet-explicit-negative");
    }
    for (const mode of modes) {
      const file = path.join(root, copy, variant);
      const child = spawnSync(process.execPath, ["--max-old-space-size=128", "-e", probe, file, mode], {
        cwd: root,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 128 * 1024,
      });
      assert.equal(child.error, undefined, `${file} ${mode}: ${child.error?.message}`);
      assert.equal(child.status, 0, `${file} ${mode}: ${child.stderr}`);
      const group = mode === "normal" ? "normal" : mode.endsWith("negative") ? "negative" : "zero";
      results.push({ copy, variant, mode, group, ...JSON.parse(child.stdout) });
    }
  }
}

for (const group of ["normal", "zero", "negative"]) {
  test(`nanoid ${group} behavior across locked CJS, ESM, browser and async variants`, () => {
    const selected = results.filter((result) => result.group === group);
    assert.ok(selected.length > 0, `No ${group} checks ran`);
    assert.deepEqual(
      selected.filter((result) => !result.ok),
      [],
    );
  });
}
