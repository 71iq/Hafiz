const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = path.resolve(__dirname, "../..");
const cli = fs.realpathSync(path.join(root, "node_modules/.bin/depcruise"));
const fixtureRoot = path.join(root, ".refactor-baseline/boundary-test-fixtures");
fs.mkdirSync(fixtureRoot, { recursive: true });
const configPaths = {
  web: path.join(root, ".dependency-cruiser.cjs"),
  android: path.join(root, ".dependency-cruiser.android.cjs"),
  ios: path.join(root, ".dependency-cruiser.ios.cjs"),
};

function fixture() {
  const directory = fs.mkdtempSync(path.join(fixtureRoot, "run-"));
  const files = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }),
    "app/entry.ts":
      'import "@/lib/select"; import "@/lib/shared"; import "@/lib/cross"; import "@/lib/module"; import "@/lib/public-feature"; import "@/lib/supabase-feature"; import "@/lib/quranXcom-frontend-next/feature"; import "../assets/sentinel"; import "../public/sentinel"; import "../supabase/sentinel";',
    "app/route.ts": "export const route = 1;",
    "components/ui/allowed.ts": 'import "../../lib/child";',
    "lib/select.ts": "export const selected = 1;",
    "lib/select.web.ts": "export const selected = 2;",
    "lib/select.native.ts": "export const selected = 3;",
    "lib/select.android.ts": "export const selected = 4;",
    "lib/select.ios.ts": "export const selected = 5;",
    "lib/shared.ts": "export const value = 1;",
    "lib/shared.native.ts": "export const value = 2;",
    "lib/cross.ts": "export const value = 1;",
    "lib/cross.web.tsx": "export const value = 2;",
    "lib/cross.native.tsx": "export const value = 3;",
    "lib/module.mjs": "export const value = 1;",
    "lib/module.web.mjs": "export const value = 2;",
    "lib/module.native.mjs": "export const value = 3;",
    "lib/public-feature.ts": 'import "./child";',
    "lib/supabase-feature.ts": 'import "./child";',

    "lib/quranXcom-frontend-next/feature.ts": 'import "../child";',
    "lib/child.ts": "export const value = 1;",
    "assets/sentinel.ts": "export const value = 1;",
    "public/sentinel.ts": "export const value = 1;",
    "supabase/sentinel.ts": "export const value = 1;",
  };
  for (const [name, contents] of Object.entries(files)) write(directory, name, contents);
  return directory;
}

function write(directory, name, contents) {
  const target = path.join(directory, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function cruise(directory, platform) {
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "app",
      "components",
      "lib",
      "--config",
      configPaths[platform],
      "--output-type",
      "json",
      "--no-ignore-known",
      "--no-cache",
    ],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  fs.writeFileSync(path.join(directory, "graph.json"), result.stdout || "");
  fs.writeFileSync(path.join(directory, "graph.stderr"), result.stderr || "");
  assert.ifError(result.error);
  assert.ok(result.stdout, result.stderr);
  const gate = spawnSync(
    process.execPath,
    [
      cli,
      "app",
      "components",
      "lib",
      "--config",
      configPaths[platform],
      "--output-type",
      "err",
      "--no-ignore-known",
      "--no-cache",
    ],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  fs.writeFileSync(path.join(directory, "check.log"), (gate.stdout || "") + (gate.stderr || ""));
  assert.ifError(gate.error);
  assert.equal(gate.signal, null);
  return { status: gate.status, graph: JSON.parse(result.stdout) };
}

function dependencies(graph, source) {
  const module = graph.modules.find((entry) => entry.source === source);
  assert.ok(module, `Missing source ${source}`);
  return module.dependencies;
}

for (const platform of ["web", "android", "ios"]) {
  test(`${platform} resolves platform, native fallback, source order and legitimate source names`, () => {
    const directory = fixture();
    const { status, graph } = cruise(directory, platform);
    assert.equal(status, 0);
    assert.deepEqual(graph.summary.violations, []);
    const imports = dependencies(graph, "app/entry.ts");
    function target(name) {
      const dependency = imports.find((entry) => entry.module === name);
      assert.ok(dependency, `Missing dependency ${name}`);
      assert.equal(dependency.couldNotResolve, false);
      return dependency.resolved;
    }
    assert.equal(target("@/lib/select"), `lib/select.${platform}.ts`);
    assert.equal(target("@/lib/shared"), platform === "web" ? "lib/shared.ts" : "lib/shared.native.ts");
    assert.equal(target("@/lib/cross"), "lib/cross.ts");
    assert.equal(target("@/lib/module"), platform === "web" ? "lib/module.web.mjs" : "lib/module.native.mjs");
    for (const source of [
      "lib/public-feature.ts",
      "lib/supabase-feature.ts",
      "lib/quranXcom-frontend-next/feature.ts",
    ]) {
      assert.ok(dependencies(graph, source).some((entry) => entry.resolved === "lib/child.ts"));
    }
    assert.ok(!graph.modules.some((entry) => /^(assets|public|supabase)\//.test(entry.source)));
    const incompatible =
      platform === "web" ? /\.(native|android|ios)\./ : platform === "android" ? /\.(web|ios)\./ : /\.(web|android)\./;
    assert.ok(!graph.modules.some((entry) => incompatible.test(entry.source)));
  });

  test(`${platform} rejects domain and shared UI imports of routes`, () => {
    const directory = fixture();
    write(directory, "lib/illegal.ts", 'import "../app/route";');
    write(directory, "components/ui/illegal.ts", 'import "../../app/route";');
    const { status, graph } = cruise(directory, platform);
    assert.equal(status, 2);
    const rules = graph.summary.violations.map((entry) => entry.rule.name);
    assert.ok(rules.includes("domain-does-not-import-routes"));
    assert.ok(rules.includes("ui-primitives-do-not-import-routes"));
  });

  test(`${platform} rejects a new cycle`, () => {
    const directory = fixture();
    write(directory, "lib/cycle-a.ts", 'import "./cycle-b";');
    write(directory, "lib/cycle-b.ts", 'import "./cycle-a";');
    const { status, graph } = cruise(directory, platform);
    assert.equal(status, 1);
    assert.ok(
      graph.summary.violations.some((entry) => entry.rule.name === "no-cycles" && entry.rule.severity === "error"),
    );
  });

  test(`${platform} rejects an unresolved module`, () => {
    const directory = fixture();
    write(directory, "lib/missing.ts", 'import "./not-existing";');
    const { status, graph } = cruise(directory, platform);
    assert.equal(status, 1);
    assert.ok(graph.summary.violations.some((entry) => entry.rule.name === "no-unresolved"));
  });
}
