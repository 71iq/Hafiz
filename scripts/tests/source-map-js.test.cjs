const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { test } = require("node:test");

const root = process.cwd();
const depsPath = require.resolve("tailwindcss/lib/cli/build/deps.js");
const tailwind = createRequire(depsPath);
const postcss = require(depsPath).loadPostcss();
const owner = createRequire(tailwind.resolve("postcss/package.json"));
const { at, registerSourceMapCases } = require("./source-map-cases.cjs");
const parse = (prev) => postcss.parse("a{}", { from: "/synthetic/input.css", map: { prev } });

test("PostCSS resolves the single reviewed installed source-map-js instance", () => {
  assert.equal(postcss, tailwind("postcss"), "The actual Tailwind loader must select external PostCSS");
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  const copies = Object.entries(lock.packages).filter(([name]) => name.endsWith("/source-map-js"));
  assert.deepEqual(
    copies.map(([name]) => name),
    ["node_modules/source-map-js"],
  );
  assert.equal(owner.resolve("source-map-js"), require.resolve(path.join(root, "node_modules/source-map-js")));
  assert.equal(owner("source-map-js/package.json").version, "1.2.2");
  assert.equal(copies[0][1].version, "1.2.2");
});

registerSourceMapCases("external source-map", owner("source-map-js"));

for (const form of ["object", "JSON"]) {
  const prev = (map) => (form === "JSON" ? JSON.stringify(map) : map);
  for (const [label, map] of [
    ["direct", at(10000001, 0)],
    ["nested", at(5000001, 0, at(5000000, 0))],
    ["negative", at(-1, 0)],
    ["fraction", at(0, 1.5)],
    ["string", at("1", 0)],
    ["null", at(0, null)],
  ]) {
    test("actual PostCSS " + form + " rejects " + label + " previous map", () => {
      assert.throws(() => parse(prev(map)), /Section offset/);
    });
  }
  test("actual PostCSS " + form + " retains valid CSS, origin and source content", () => {
    const result = parse(prev(at(0, 0)));
    assert.equal(result.toString(), "a{}");
    const origin = result.source.input.origin(1, 1);
    assert.equal(origin.line, 1);
    assert.equal(origin.column, 0);
    assert.equal(origin.source, "x");
  });
}
test("raw JSON infinity remains invalid through the actual PostCSS path", () => {
  const text = JSON.stringify(at(0, 0)).replace('"line":0', '"line":1e999');
  assert.throws(() => parse(text), /non-negative integers/);
});
for (const allowed of [false, true]) {
  test("real quicksort preserves behavior with string generation allowed=" + allowed, () => {
    const entry = owner.resolve("source-map-js/lib/quick-sort.js");
    const output = {};
    const context = vm.createContext({ exports: output }, { codeGeneration: { strings: allowed, wasm: false } });
    if (allowed) assert.equal(vm.runInContext("new Function('return 7')()", context, { timeout: 1000 }), 7);
    else
      assert.throws(() => vm.runInContext("new Function('return 7')()", context, { timeout: 1000 }), {
        name: "EvalError",
      });
    vm.runInContext(fs.readFileSync(entry, "utf8"), context, { filename: entry, timeout: 1000 });
    const ascending = (a, b) => a - b;
    for (const values of [
      [3, 1, 2],
      [2, 1, 2, 1],
    ]) {
      const expected = [...values].sort(ascending);
      output.quickSort(values, ascending);
      assert.deepEqual(values, expected);
    }
    const descending = [1, 3, 2];
    output.quickSort(descending, (a, b) => b - a);
    assert.deepEqual(descending, [3, 2, 1]);
    const prefix = [99, 3, 1, 2];
    output.quickSort(prefix, ascending, 1);
    assert.deepEqual(prefix, [99, 1, 2, 3]);
  });
}
