#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const phase = process.argv[2];
const project = process.env.UI_PHASE_PROJECT ?? "ui-390-chromium";

const phaseFiles = {
  "provider-boundaries": "tests/e2e/report-only/provider-boundaries.spec.ts",
  "responsive-overflow": "tests/e2e/report-only/responsive-overflow.spec.ts",
  "route-inventory": "tests/e2e/report-only/route-inventory.spec.ts",
  "rtl-ui-contract": "tests/e2e/report-only/rtl-ui-contract.spec.ts",
  "sync-contract": "tests/e2e/report-only/sync-contract.spec.ts",
  "ui-contract": "tests/e2e/report-only/ui-contract.spec.ts",
};

function collectTestResults(suite, results = []) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const lastResult = test.results?.at(-1);
      results.push({
        title: [...(suite.titlePath ?? []), spec.title].filter(Boolean).join(" > "),
        status: lastResult?.status ?? test.outcome ?? "unknown",
      });
    }
  }

  for (const child of suite.suites ?? []) {
    collectTestResults(child, results);
  }

  return results;
}

function summarize(reportPath) {
  if (!fs.existsSync(reportPath)) {
    return { total: 0, passed: 0, failed: 0, skipped: 0, failureRate: 0 };
  }

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const results = [];
  for (const suite of report.suites ?? []) {
    collectTestResults(suite, results);
  }

  const total = results.length;
  const skipped = results.filter((item) => item.status === "skipped").length;
  const passed = results.filter((item) => item.status === "passed").length;
  const failed = total - passed - skipped;
  const denominator = Math.max(1, total - skipped);
  const failureRate = failed / denominator;
  return { total, passed, failed, skipped, failureRate };
}

if (!phase || phase === "--help" || phase === "-h") {
  console.log("Usage: npm run test:ui:phase -- <provider-boundaries|responsive-overflow|route-inventory|rtl-ui-contract|sync-contract|ui-contract|all>");
  process.exit(0);
}

const reportPath = path.join(root, "test-results/playwright/results.json");
fs.rmSync(path.dirname(reportPath), { recursive: true, force: true });

if (process.env.UI_PHASE_SKIP_BUILD !== "1") {
  const build = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:web:test"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

const target =
  phase === "all"
    ? "tests/e2e/report-only"
    : phaseFiles[phase];

if (!target) {
  console.error(`[UI phase] Unknown phase: ${phase}`);
  process.exit(1);
}

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["playwright", "test", target, "--project", project],
  { cwd: root, stdio: "inherit", env: process.env }
);

const summary = summarize(reportPath);
console.log(
  `[UI phase:${phase}] total=${summary.total} passed=${summary.passed} failed=${summary.failed} skipped=${summary.skipped} failureRate=${(summary.failureRate * 100).toFixed(1)}%`
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(0);
