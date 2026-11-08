const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { doctor } = require("expo-router/doctor");
const manifest = JSON.parse(
  fs.readFileSync(process.env.HAFIZ_ROUTER_MANIFEST || path.join(__dirname, "../../package.json"), "utf8"),
);
const name = "@react-navigation/bottom-tabs";
const expected = require("expo-router/package.json").dependencies[name];
const formatting = { bold: (text) => text, learnMore: (text) => text };
const findings = (pkg) => doctor(pkg, require.resolve("@react-navigation/native"), formatting);
const withRange = (range) => ({
  ...manifest,
  dependencies: { ...manifest.dependencies, [name]: range },
});
test("project declaration passes the installed Router doctor", () => {
  assert.deepEqual(findings(manifest), []);
});
test("an exact installed-version declaration reproduces the old warning", () => {
  const pinned = require("@react-navigation/bottom-tabs/package.json").version;
  assert.deepEqual(findings(withRange(pinned)), [
    { packageName: name, packageType: "dependencies", expectedVersionOrRange: expected, actualVersion: pinned },
  ]);
});
test("Router's recommended range passes without a diagnostic exclusion", () => {
  assert.deepEqual(findings(withRange(expected)), []);
  assert.equal(manifest.expo?.install?.exclude, undefined);
});
test("Router does not require an absent direct navigation dependency", () => {
  const pkg = withRange(undefined);
  delete pkg.dependencies[name];
  assert.deepEqual(findings(pkg), []);
});
