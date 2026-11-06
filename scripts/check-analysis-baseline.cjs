const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, ".refactor-baseline/dependency-analysis/knip.json"), "utf8"),
);
function normalize(value) {
  if (Array.isArray(value))
    return value.map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["line", "col", "pos"].includes(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)]),
    );
  return value;
}
const result = spawnSync(path.join(root, "node_modules/.bin/knip"), ["--reporter", "json"], {
  cwd: root,
  encoding: "utf8",
  timeout: 120000,
  maxBuffer: 4 * 1024 * 1024,
});
assert.ifError(result.error);
assert.equal(result.status, 1, result.stderr);
assert.deepEqual(
  normalize(JSON.parse(result.stdout)),
  normalize(baseline),
  "Unused-code findings changed; inspect the current source and review the baseline.",
);
console.log("Knip retains the five documented existing issue records; the analysis is not clean.");
