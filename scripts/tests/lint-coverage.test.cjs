const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const test = require("node:test");
const { ESLint } = require("eslint");
const options = process.env.HAFIZ_LINT_CONFIG
  ? { overrideConfigFile: path.resolve(process.env.HAFIZ_LINT_CONFIG) }
  : {};
const eslint = new ESLint(options);
const expected = {
  "react-hooks/config": 2,
  "react-hooks/error-boundaries": 2,
  "react-hooks/gating": 2,
  "react-hooks/globals": 2,
  "react-hooks/incompatible-library": 1,
  "react-hooks/set-state-in-render": 2,
  "react-hooks/static-components": 2,
  "react-hooks/unsupported-syntax": 1,
  "react-hooks/use-memo": 2,
};
for (const file of [
  "app/_layout.tsx",
  "lib/settings/context.tsx",
  "scripts/ralph/check-security-dependencies.cjs",
  "tests/unit/theme-color-swatch.test.tsx",
]) {
  test(`retains active compiler checks for ${file}`, async () => {
    assert.ok(fs.existsSync(path.resolve(file)), `Missing representative file ${file}`);
    assert.equal(await eslint.isPathIgnored(file), false);
    const config = await eslint.calculateConfigForFile(file);
    assert.ok(config);
    for (const [rule, severity] of Object.entries(expected)) assert.equal(config.rules[rule]?.[0], severity, rule);
  });
}
test("conditional hooks still fail", async () => {
  const [result] = await eslint.lintText(
    'import {useState} from "react"; export function Bad({enabled}:{enabled:boolean}) { if(enabled) useState(0); return null; }',
    { filePath: "components/ui/LintCoverageProbe.tsx" },
  );
  assert.ok(result.messages.some((m) => m.ruleId === "react-hooks/rules-of-hooks" && m.severity === 2));
});
test("unconditional render updates still fail", async () => {
  const [result] = await eslint.lintText(
    'import {useState} from "react"; export function Bad(){ const [count,setCount]=useState(0); setCount(1); return count; }',
    { filePath: "components/ui/LintCoverageProbe.tsx" },
  );
  assert.ok(result.messages.some((m) => m.ruleId === "react-hooks/set-state-in-render" && m.severity === 2));
});
test("a valid component passes", async () => {
  const [result] = await eslint.lintText(
    'import {useState} from "react"; export function Good(){ const [count]=useState(0); return count; }',
    { filePath: "components/ui/LintCoverageProbe.tsx" },
  );
  assert.equal(result.errorCount, 0);
});

test("excludes generated browser reports while retaining source checks", async () => {
  for (const file of ["test-results/playwright/html/trace/assets/report.js", "playwright-report/assets/report.js"]) {
    assert.equal(await eslint.isPathIgnored(file), true, file);
  }
  for (const file of ["lib/database/provider.tsx", "tests/e2e/database-bridge.spec.ts"]) {
    assert.equal(await eslint.isPathIgnored(file), false, file);
  }
});
