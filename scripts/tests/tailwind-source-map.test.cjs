const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const { test } = require("node:test");
const { at, registerSourceMapCases } = require("./source-map-cases.cjs");

const filename = require.resolve("tailwindcss/peers/index.js");
const source = fs.readFileSync(filename, "utf8");
// Append exports only. The complete installed vendor implementation stays intact.
const exposure = `
module.exports.__sourceMapProof = {
  library: require_source_map(),
  consumer: require_source_map_consumer,
  generator: require_source_map_generator,
  node: require_source_node,
  sort: require_quick_sort,
  cssTrees: [require_sourceMap, require_sourceMap2]
};
`;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(source + exposure, filename);
const proof = loaded.exports.__sourceMapProof;
const library = proof.library;
const tailwindOwner = Module.createRequire(require.resolve("tailwindcss/package.json"));
const postcssOwner = Module.createRequire(tailwindOwner.resolve("postcss/package.json"));
const external = postcssOwner("source-map-js");
registerSourceMapCases("bundled source-map", library);

test("bundled constructors, cache and helper interoperability remain separate from external modules", () => {
  for (const name of ["SourceMapConsumer", "SourceMapGenerator", "SourceNode"])
    assert.notEqual(library[name], external[name]);
  assert.equal(proof.consumer(), proof.consumer());
  assert.equal(proof.generator(), proof.generator());
  assert.equal(proof.node(), proof.node());
  assert.equal(proof.sort(), proof.sort());
  assert.equal(library.SourceMapConsumer, proof.consumer().SourceMapConsumer);
  assert.equal(library.SourceMapGenerator, proof.generator().SourceMapGenerator);
  assert.equal(library.SourceNode, proof.node().SourceNode);
  const generator = new library.SourceMapGenerator();
  generator.addMapping({ generated: { line: 1, column: 0 }, original: { line: 1, column: 0 }, source: "fixture.js" });
  generator.setSourceContent("fixture.js", "حافظ");
  const consumer = new library.SourceMapConsumer(generator.toString());
  assert.ok(consumer instanceof library.SourceMapConsumer);
  assert.equal(library.SourceNode.fromStringWithSourceMap("حافظ", consumer).toString(), "حافظ");
});

test("actual public bundled PostCSS rejects invalid previous maps and preserves valid results", () => {
  const postcss = require(filename).lazyPostcss();
  const parse = (prev) => postcss.parse("a{}", { from: "/synthetic/input.css", map: { prev } });
  for (const previous of [at(10000001, 0), at(5000001, 0, at(5000000, 0)), at("1", 0), at(0, -1)]) {
    for (const prev of [previous, JSON.stringify(previous)]) assert.throws(() => parse(prev), /Section offset/);
  }
  for (const prev of [at(0, 0), JSON.stringify(at(0, 0))]) {
    const result = parse(prev);
    assert.equal(result.toString(), "a{}");
    const origin = result.source.input.origin(1, 1);
    assert.equal(origin.line, 1);
    assert.equal(origin.column, 0);
    assert.equal(origin.source, "x");
  }
});

for (const [index, factory] of proof.cssTrees.entries()) {
  test("direct css-tree generator caller " + index + " retains actual bundled mapping behavior", () => {
    let css = "";
    const handlers = factory().generateSourceMap({
      node(node) {
        this.emit(node.value);
      },
      emit(value) {
        css += value;
      },
      result() {
        return css;
      },
    });
    handlers.node({
      type: "Declaration",
      value: "color:red",
      loc: { source: "fixture.css", start: { line: 1, column: 1 } },
    });
    handlers.emit("\n");
    handlers.node({
      type: "Declaration",
      value: "حافظ:x",
      loc: { source: "fixture.css", start: { line: 3, column: 2 } },
    });
    const result = handlers.result();
    assert.equal(result.css, "color:red\nحافظ:x");
    assert.ok(result.map instanceof library.SourceMapGenerator);
    assert.notEqual(result.map.constructor, external.SourceMapGenerator);
    result.map.setSourceContent("fixture.css", "color:red\n\n حافظ:x");
    const consumer = new library.SourceMapConsumer(result.map.toString());
    assert.deepEqual(consumer.originalPositionFor({ line: 2, column: 0 }), {
      source: "fixture.css",
      line: 3,
      column: 1,
      name: null,
    });
    assert.equal(consumer.sourceContentFor("fixture.css"), "color:red\n\n حافظ:x");
  });
}

for (const allowed of [false, true]) {
  test("actual bundled sorter stays in its VM realm, strings allowed=" + allowed, () => {
    const common = { exports: {} };
    const hostRequire = Module.createRequire(filename);
    const required = [];
    const context = vm.createContext(
      {
        module: common,
        exports: common.exports,
        process,
        Buffer,
        console,
        __filename: filename,
        __dirname: path.dirname(filename),
        require(name) {
          assert.ok(Module.isBuiltin(name), "The bundled parser must not delegate to a host library: " + name);
          required.push(name);
          return hostRequire(name);
        },
      },
      { codeGeneration: { strings: allowed, wasm: false } },
    );
    if (allowed) assert.equal(vm.runInContext("new Function('return 7')()", context, { timeout: 1000 }), 7);
    else
      assert.throws(() => vm.runInContext("new Function('return 7')()", context, { timeout: 1000 }), {
        name: "EvalError",
      });
    vm.runInContext(source + exposure, context, { filename, timeout: 2000 });
    const sort = common.exports.__sourceMapProof.sort().quickSort;
    const ascending = (a, b) => a - b;
    for (const values of [
      [3, 1, 2],
      [2, 1, 2, 1],
    ]) {
      const expected = [...values].sort(ascending);
      sort(values, ascending);
      assert.deepEqual(values, expected);
    }
    const values = [1, 3, 2];
    sort(values, (a, b) => b - a);
    assert.deepEqual(values, [3, 2, 1]);
    const prefix = [99, 3, 1, 2];
    sort(prefix, ascending, 1);
    assert.deepEqual(prefix, [99, 1, 2, 3]);
    assert.ok(required.every(Module.isBuiltin));
  });
}

test("real bundled cssnano keeps normal CSS minification and small source maps", async () => {
  const peers = require(filename);
  const postcss = peers.lazyPostcss();
  const result = await postcss([peers.lazyCssnano()()]).process("a { color: #ff0000; margin: 0px 0px; }", {
    from: "/synthetic/input.css",
    map: { inline: false },
  });
  assert.equal(result.css.replace(/\n\/\*# sourceMappingURL=.*?\*\//, ""), "a{color:red;margin:0}");
  const consumer = new library.SourceMapConsumer(result.map.toString());
  const position = consumer.originalPositionFor({ line: 1, column: 0 });
  assert.equal(position.line, 1);
  assert.equal(position.column, 0);
});
