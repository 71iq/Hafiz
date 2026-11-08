const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const root = process.cwd();
const config = require(path.join(root, "jest.config.js"));
const ignore = new RegExp(
  config.modulePathIgnorePatterns.map((value) => value.replaceAll("<rootDir>", root)).join("|"),
);

test("excludes generated refactoring evidence from Jest module discovery", () => {
  for (const relative of [
    ".refactor-baseline/package.json",
    ".refactor-baseline/nested/source.js",
    ".ralph/batch.json",
    ".ralph/runs/example/task.json",
  ]) {
    assert.equal(ignore.test(path.join(root, relative)), true, `Generated file must be ignored: ${relative}`);
  }
});

test("keeps source and similarly named directories available to Jest", () => {
  for (const relative of [
    "xrefactor-baseline/package.json",
    "xralph/package.json",
    ".refactor-baseline-source/example.js",
    ".ralph-tools/example.js",
    "tests/unit/startup-language.test.ts",
    "scripts/ralph/control.py",
    "app/_layout.tsx",
    "components/ui/Button.tsx",
    "lib/database/provider.tsx",
    "components/.ralph/example.js",
  ]) {
    assert.equal(ignore.test(path.join(root, relative)), false, `Source must remain visible: ${relative}`);
  }
});
