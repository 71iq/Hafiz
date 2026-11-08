const assert = require("node:assert/strict");
const { test: registerCase } = require("node:test");

const leaf = () => ({ version: 3, sources: ["fixture.js"], sourcesContent: ["x"], names: [], mappings: "AAAA" });
const empty = () => ({ ...leaf(), mappings: "" });
const section = (line, column, map = leaf()) => ({ offset: { line, column }, map });
const indexed = (...sections) => ({ version: 3, sections });
const at = (line, column, map = leaf()) => indexed(section(line, column, map));
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

function registerSourceMapCases(label, { SourceMapConsumer, SourceMapGenerator, SourceNode }) {
  const consume = (map) => new SourceMapConsumer(map);
  const test = (name, action) => registerCase(label + ": " + name, action);
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
  test("generator serializes a tiny line gap with bounded mapping reads", () => {
    const generator = new SourceMapGenerator();
    generator.addMapping({
      generated: { line: 9, column: 0 },
      original: { line: 1, column: 0 },
      source: "fixture.js",
    });
    const mapping = generator._mappings.toArray()[0];
    const original = Object.getOwnPropertyDescriptor(mapping, "generatedLine");
    let reads = 0;
    Object.defineProperty(mapping, "generatedLine", {
      configurable: true,
      get() {
        reads++;
        return original.value;
      },
    });
    let encoded;
    try {
      encoded = generator.toString();
      assert.ok(reads > 0 && reads <= 4, "Expected constant mapping reads, observed " + reads);
    } finally {
      Object.defineProperty(mapping, "generatedLine", original);
    }
    assert.deepEqual(Object.getOwnPropertyDescriptor(mapping, "generatedLine"), original);
    assert.equal(JSON.parse(encoded).mappings, ";;;;;;;;AAAA");
    assert.deepEqual(consume(encoded).originalPositionFor({ line: 9, column: 0 }), {
      source: "fixture.js",
      line: 1,
      column: 0,
      name: null,
    });
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
}

module.exports = { at, registerSourceMapCases };
