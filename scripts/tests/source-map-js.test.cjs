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
const { SourceMapConsumer, SourceMapGenerator, SourceNode } = owner("source-map-js");
const leaf = () => ({ version: 3, sources: ["fixture.js"], sourcesContent: ["x"], names: [], mappings: "AAAA" });
const empty = () => ({ ...leaf(), mappings: "" });
const section = (line, column, map = leaf()) => ({ offset: { line, column }, map });
const indexed = (...sections) => ({ version: 3, sections });
const at = (line, column, map = leaf()) => indexed(section(line, column, map));
const consume = (map) => new SourceMapConsumer(map);
const parse = (prev) => postcss.parse("a{}", { from: "/synthetic/input.css", map: { prev } });
const invalid = [
  ["string", "1"],
  ["null", null],
  ["undefined", undefined],
  ["object", {}],
  ["array", []],
  ["boolean", true],
  ["negative", -1],
  ["fraction", 1.5],
  ["NaN", NaN],
  ["infinity", Infinity],
  ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
];

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

for (const field of ["line", "column"]) {
  for (const [label, value] of invalid) {
    test("indexed offset rejects " + field + " " + label, () => {
      const map = at(0, 0);
      map.sections[0].offset[field] = value;
      assert.ok(Object.hasOwn(map.sections[0].offset, field));
      assert.throws(() => consume(map), /Section offset line and column must be non-negative integers/);
    });
  }
}
test("negative infinite column is rejected", () => {
  assert.throws(() => consume(at(0, -Infinity)), /non-negative integers/);
});
test("direct line cap rejects one over the inclusive boundary", () => {
  assert.throws(() => consume(at(10000001, 0)), /must not exceed 10000000/);
});
test("line cap preserves exact boundary, zero and negative zero", () => {
  for (const map of [at(10000000, 0), at(0, 0), at(-0, -0)]) assert.doesNotThrow(() => consume(map));
});
test("column has the safe-integer boundary independently of the line cap", () => {
  assert.doesNotThrow(() => consume(at(0, Number.MAX_SAFE_INTEGER)));
  assert.throws(() => consume(at(Number.MAX_SAFE_INTEGER, 0)), /must not exceed 10000000/);
});
test("nested offsets preserve exact total and reject one over", () => {
  assert.doesNotThrow(() => consume(at(5000000, 0, at(5000000, 0))));
  assert.throws(() => consume(at(5000001, 0, at(5000000, 0))), /including offsets of nested sections/);
});
test("the greatest sibling total propagates through outer sections", () => {
  const siblings = indexed(section(0, 0, at(10000000, 0, empty())), section(1, 0, empty()));
  assert.doesNotThrow(() => consume(at(0, 0, siblings)));
  assert.throws(() => consume(at(1, 0, siblings)), /including offsets of nested sections/);
});
test("later sibling offsets are validated independently", () => {
  assert.throws(() => consume(indexed(section(0, 0), section(1.5, 0))), /non-negative integers/);
  assert.throws(() => consume(indexed(section(0, 0), section(1, "1"))), /non-negative integers/);
});
test("nested child offsets are validated independently", () => {
  assert.throws(() => consume(at(0, 0, at(0, "1"))), /non-negative integers/);
});
test("existing missing-field and ordering errors remain rejected", () => {
  for (const field of ["line", "column"]) {
    const map = at(0, 0);
    delete map.sections[0].offset[field];
    assert.throws(() => consume(map), /required argument/);
  }
  assert.throws(() => consume(at(-Infinity, 0)));
  assert.throws(() => consume(indexed(section(1, 0), section(0, 0))), /ordered and non-overlapping/);
  assert.throws(() => consume(indexed(section(0, 1), section(0, 0))), /ordered and non-overlapping/);
  assert.throws(() => consume({ version: 4, sections: [] }), /Unsupported version/);
  assert.throws(() => consume(indexed({ offset: { line: 0, column: 0 }, url: "unused.map" })), /not implemented/);
});
test("small nested mappings preserve the actual generated position", () => {
  let map = leaf();
  for (let i = 0; i < 5; i++) map = at(1000, 0, map);
  const mappings = [];
  consume(map).eachMapping((mapping) => mappings.push(mapping));
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].generatedLine, 5001);
  assert.equal(mappings[0].generatedColumn, 0);
  assert.equal(mappings[0].source, "fixture.js");
});
test("nested sources are read once per section with preserved values", () => {
  const consumer = consume(at(0, 0, at(0, 0, at(0, 0))));
  const inner = consumer._sections[0].consumer._sections[0].consumer._sections[0].consumer;
  const sources = inner.sources;
  let reads = 0;
  Object.defineProperty(inner, "sources", {
    configurable: true,
    get() {
      reads++;
      return sources;
    },
  });
  try {
    assert.deepEqual(consumer.sources, ["fixture.js"]);
    assert.equal(reads, 1);
  } finally {
    delete inner.sources;
  }
});
test("SourceNode does not invent text beyond a short generated input", () => {
  assert.equal(SourceNode.fromStringWithSourceMap("x", consume(at(8, 0))).toString(), "x");
});
test("SourceNode preserves ordinary multiline generated text", () => {
  const map = { ...leaf(), mappings: "AAAA;AACA", sourcesContent: ["a\nb\n"] };
  assert.equal(SourceNode.fromStringWithSourceMap("a\nb\n", consume(map)).toString(), "a\nb\n");
});
test("generator gaps, sorting, columns, Unicode names and source contents round trip", () => {
  const source = "حافظ.js";
  const name = "حافظ";
  const content = "a\nb\nc\nd";
  const generator = new SourceMapGenerator({ file: "out.js" });
  for (const [line, column, originalLine, originalColumn, label] of [
    [4, 3, 3, 1, name],
    [1, 0, 1, 0, null],
    [4, 0, 2, 0, null],
    [5, 0, 4, 0, null],
  ])
    generator.addMapping({
      generated: { line, column },
      original: { line: originalLine, column: originalColumn },
      source,
      name: label,
    });
  generator.setSourceContent(source, content);
  const encoded = generator.toString();
  assert.ok(encoded.length < 500);
  const consumer = consume(encoded);
  const positions = [];
  consumer.eachMapping((m) =>
    positions.push([m.generatedLine, m.generatedColumn, m.originalLine, m.originalColumn, m.name]),
  );
  assert.deepEqual(positions, [
    [1, 0, 1, 0, null],
    [4, 0, 2, 0, null],
    [4, 3, 3, 1, name],
    [5, 0, 4, 0, null],
  ]);
  assert.deepEqual(consumer.originalPositionFor({ line: 4, column: 3 }), { source, line: 3, column: 1, name });
  const generated = consumer.generatedPositionFor({ source, line: 3, column: 1 });
  assert.equal(generated.line, 4);
  assert.equal(generated.column, 3);
  assert.equal(consumer.sourceContentFor(source), content);
});

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
