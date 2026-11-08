const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const probe = path.resolve(__dirname, "../ralph/check-security-dependencies.cjs");
const root = path.resolve(__dirname, "../..");
const reactNative = createRequire(require.resolve("react-native/package.json"));
const devtools = createRequire(reactNative.resolve("react-devtools-core/package.json"));
const quoteDirectory = path.dirname(devtools.resolve("shell-quote/package.json"));
const cliDirectory = path.dirname(require.resolve("supabase/package.json"));

function makeCore(directory, patched) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ name: "react-devtools-core", version: "6.1.5" }),
  );
  const quote = path.join(directory, "node_modules/shell-quote");
  fs.mkdirSync(path.dirname(quote), { recursive: true });
  if (patched) {
    fs.symlinkSync(quoteDirectory, quote, "dir");
  } else {
    fs.mkdirSync(quote);
    fs.writeFileSync(
      path.join(quote, "package.json"),
      JSON.stringify({ name: "shell-quote", version: "0.0.0", main: "index.js" }),
    );
    fs.writeFileSync(path.join(quote, "index.js"), 'throw new Error("Competing fixture code must not execute");\n');
  }
}

function inspect({ rootPatched, nestedPatched, blockedParent = false }) {
  const reports = path.join(root, ".refactor-baseline");
  fs.mkdirSync(reports, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(reports, "rf088-owner-fixture-"));
  const source = path.join(fixture, "scripts/ralph/check-security-dependencies.cjs");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.copyFileSync(probe, source);
  const modules = path.join(fixture, "node_modules");
  const owner = path.join(modules, "react-native");
  fs.mkdirSync(owner, { recursive: true });
  fs.writeFileSync(
    path.join(owner, "package.json"),
    JSON.stringify({
      name: "react-native",
      version: "0.83.10",
      dependencies: { "react-devtools-core": "^6.1.5" },
      ...(blockedParent ? { exports: {} } : {}),
    }),
  );
  makeCore(path.join(modules, "react-devtools-core"), rootPatched);
  if (nestedPatched !== undefined) makeCore(path.join(owner, "node_modules/react-devtools-core"), nestedPatched);
  fs.symlinkSync(cliDirectory, path.join(modules, "supabase"), "dir");
  const result = spawnSync(process.execPath, [source], {
    cwd: fixture,
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 128 * 1024,
  });
  assert.equal(result.error, undefined);
  return { ...result, fixture };
}

function expectSuccess(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /installer archive API passed/);
  const reports = path.join(result.fixture, ".refactor-baseline");
  const completed = fs.readdirSync(reports).filter((name) => name.startsWith("security-dependencies-"));
  assert.equal(completed.length, 1);
  assert.equal(
    fs.readFileSync(path.join(reports, completed[0], "output/supabase"), "utf8"),
    "Harmless installer API fixture.\n",
  );
}

test("checks the nested React Native devtools owner despite a competing root package", () => {
  expectSuccess(inspect({ rootPatched: false, nestedPatched: true }));
});

test("rejects the nested owner's wrong quote version despite a patched root package", () => {
  const result = inspect({ rootPatched: true, nestedPatched: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /0\.0\.0/);
  assert.match(result.stderr, /1\.12\.0/);
  assert.doesNotMatch(result.stderr, /Competing fixture code/);
  assert.equal(result.stdout, "");
});

test("supports React Native's normal hoisted dependency", () => {
  expectSuccess(inspect({ rootPatched: true }));
});

test("fails at an inaccessible React Native owner rather than using the root target", () => {
  const result = inspect({ rootPatched: true, nestedPatched: true, blockedParent: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /react-native/);
  assert.match(result.stderr, /exports/);
  assert.equal(result.stdout, "");
});
