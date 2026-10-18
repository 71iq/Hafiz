const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = process.cwd();
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const copies = Object.keys(lock.packages).filter((name) => name.endsWith("/js-yaml"));
assert.ok(copies.length > 0, "No locked YAML parser copies were checked");

const probe = String.raw`
(async () => {
  const assert = require("node:assert/strict");
  const { pathToFileURL } = require("node:url");
  const file = process.argv[1];
  const major = Number(process.argv[2]);
  const yaml = file.endsWith(".mjs") ? await import(pathToFileURL(file).href) : require(file);
  const parsers = major === 3 ? ["load", "safeLoad"] : ["load"];
  const results = [];
  function check(group, api, action) {
    try { action(); results.push({ group, api, ok: true }); }
    catch (error) { results.push({ group, api, ok: false, error: error.message }); }
  }
  for (const api of parsers) {
    const load = yaml[api];
    check("semantics", api, () => {
      const value = { title: "نص عربي", flags: [true, false], empty: null, count: 7 };
      const dump = api === "safeLoad" ? yaml.safeDump : yaml.dump;
      assert.deepEqual(load(dump(value)), value);
      assert.deepEqual(load("base: &b { color: blue, n: 1 }\nitem: { <<: *b, n: 2 }\n").item, { color: "blue", n: 2 });
      assert.deepEqual(load("!!omap\n- constructor: 1\n- __proto__: 2\n- toString: 3\n").map(Object.keys), [["constructor"], ["__proto__"], ["toString"]]);
      assert.throws(() => load("!!omap\n- a: 1\n- a: 2\n"), { name: "YAMLException" });
    });
    check("merge-budget", api, () => {
      const source = "a: &a { value: 1 }\nb: { <<: *a }\n";
      assert.deepEqual(load(source, { maxTotalMergeKeys: 2 }).b, { value: 1 });
      assert.throws(() => load(source, { maxTotalMergeKeys: 1 }), /maxTotalMergeKeys/);
      const chain = ["a0: &a0 { k0: 0 }"];
      for (let i = 1; i < 160; i++) chain.push("a" + i + ": &a" + i + " { <<: *a" + (i - 1) + ", k" + i + ": " + i + " }");
      assert.throws(() => load(chain.join("\n")), /maxTotalMergeKeys/);
    });
    check("empty-merge-budget", api, () => {
      const source = "a: &a {}\nb: { <<: [*a, *a, *a] }\n";
      assert.deepEqual(load(source, { maxTotalMergeKeys: 3 }).b, {});
      assert.throws(() => load(source, { maxTotalMergeKeys: 2 }), /maxTotalMergeKeys/);
    });
    check("ordered-map-work", api, () => {
      const count = 64;
      const pairs = Array.from({ length: count }, (_, i) => ({ ["__rf092_" + i]: i }));
      const source = "!!omap\n" + pairs.map((pair, i) => "- __rf092_" + i + ": " + i).join("\n");
      const original = Array.prototype.indexOf;
      let scanned = 0;
      try {
        // Count the real resolver's membership work, avoiding wall-clock assertions.
        Array.prototype.indexOf = function (key, ...args) {
          if (typeof key === "string" && key.startsWith("__rf092_")) scanned += this.length;
          return Reflect.apply(original, this, [key, ...args]);
        };
        assert.deepEqual(load(source), pairs);
      } finally { Array.prototype.indexOf = original; }
      assert.ok(scanned <= count * 4, "Ordered-map membership scanned " + scanned + " entries for " + count + " keys");
    });
  }
  check("semantics", "loadAll", () => {
    const source = "a: 1\n---\nb: [2, 3]\n";
    assert.deepEqual(yaml.loadAll(source), [{ a: 1 }, { b: [2, 3] }]);
    if (major === 3) assert.deepEqual(yaml.safeLoadAll(source), [{ a: 1 }, { b: [2, 3] }]);
  });
  console.log(JSON.stringify(results));
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;

const results = [];
for (const copy of copies) {
  const major = Number(lock.packages[copy].version.split(".")[0]);
  assert.ok(major === 3 || major === 4, `${copy}: review the regression before a YAML major migration`);
  const variants = ["index.js", "dist/js-yaml.js", "dist/js-yaml.min.js"];
  if (major === 4) variants.push("dist/js-yaml.mjs");
  for (const variant of variants) {
    const child = spawnSync(
      process.execPath,
      ["--max-old-space-size=128", "-e", probe, path.join(root, copy, variant), String(major)],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 128 * 1024,
      },
    );
    assert.equal(child.error, undefined, `${copy} ${variant}: ${child.error?.message}`);
    assert.equal(child.status, 0, `${copy} ${variant}: ${child.stderr}`);
    results.push(...JSON.parse(child.stdout).map((result) => ({ copy, variant, ...result })));
  }
}

for (const group of ["semantics", "merge-budget", "empty-merge-budget", "ordered-map-work"]) {
  test(`YAML ${group} across every locked CJS, UMD and supported ESM variant`, () => {
    const selected = results.filter((result) => result.group === group);
    assert.ok(selected.length > 0, `No ${group} checks ran`);
    assert.deepEqual(
      selected.filter((result) => !result.ok),
      [],
    );
  });
}
