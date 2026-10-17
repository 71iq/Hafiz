const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = process.cwd();
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const packagePaths = Object.keys(lock.packages).filter((name) => name.endsWith("/brace-expansion"));
assert.ok(packagePaths.length > 0, "No locked brace-expansion copies were checked");

const probe = String.raw`
const assert = require("node:assert/strict");
const value = require(process.argv[1]);
const expand = typeof value === "function" ? value : value.expand;
assert.equal(typeof expand, "function");
const cases = [
  ["x{a,b}y", ["xay", "xby"]],
  ["a{b,c{d,e}}f", ["abf", "acdf", "acef"]],
  ["{01..03}", ["01", "02", "03"]],
  ["file{a,b}/{1..2}.txt", ["filea/1.txt", "filea/2.txt", "fileb/1.txt", "fileb/2.txt"]],
];
for (const [input, expected] of cases) assert.deepEqual(expand(input), expected);
let deep;
try {
  const values = expand("{".repeat(3200) + "a,b" + "}".repeat(3200));
  deep = { ok: Array.isArray(values) && values.every((v) => typeof v === "string"), count: values.length };
} catch (error) {
  deep = { ok: false, error: error.name, message: error.message };
}
console.log(JSON.stringify({ normal: true, deep }));
`;

const results = packagePaths.map((name) => {
  const child = spawnSync(
    process.execPath,
    ["--max-old-space-size=128", "--stack_size=984", "-e", probe, path.join(root, name)],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 128 * 1024,
    },
  );
  assert.equal(child.error, undefined, `${name}: ${child.error?.message}`);
  assert.equal(child.status, 0, `${name}: ${child.stderr}`);
  return { path: name, version: lock.packages[name].version, ...JSON.parse(child.stdout) };
});

test("preserves valid brace expansion through every locked installed copy", () => {
  assert.ok(results.every((result) => result.normal));
});

test("bounds deeply nested brace input in every locked installed copy", () => {
  const failures = results.filter((result) => !result.deep.ok);
  assert.deepEqual(failures, []);
});
