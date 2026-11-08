// Inspect each native dependency graph. The upstream verifier reports duplicates with exit 0.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const expo = createRequire(require.resolve("expo/package.json"));
const metadataPath = expo.resolve("expo-modules-autolinking/package.json");
const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const bin = metadata.bin?.["expo-modules-autolinking"];
assert.equal(typeof bin, "string", "Autolinking CLI entry is missing");
const cli = path.resolve(path.dirname(metadataPath), bin);
const failures = [];

for (const platform of ["android", "ios"]) {
  const report = JSON.parse(
    execFileSync(process.execPath, [cli, "verify", "--platform", platform, "--json"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    }),
  );
  const groups = ["reactNativeProjectConfig", "searchPaths", "dependencies", "duplicates"];
  for (const group of groups) assert.ok(Array.isArray(report[group]), `${platform}: missing ${group} array`);
  const names = new Set(groups.flatMap((group) => report[group].map((entry) => entry.name)));
  for (const name of ["expo", "expo-sqlite", "react-native"]) {
    assert.ok(names.has(name), `${platform}: expected dependency ${name} is missing`);
  }
  for (const duplicate of report.duplicates) failures.push(`${platform}: duplicate ${duplicate.name}`);
  console.log(`${platform}: ${names.size} modules, ${report.duplicates.length} duplicate groups`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
for (const group of ["dependencies", "devDependencies"]) {
  if (Object.hasOwn(manifest[group] ?? {}, "expo-modules-core"))
    failures.push(`Remove direct ${group}.expo-modules-core`);
}
assert.equal(failures.length, 0, failures.join("; "));
console.log("Both native dependency graphs have no duplicates or direct expo-modules-core dependency.");
