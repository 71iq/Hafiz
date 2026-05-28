#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const reportPath = path.join(root, "test-results/playwright/results.json");
const summaryPath = path.join(root, "test-results/ui-baseline-summary.json");
const project = process.env.UI_BASELINE_PROJECT ?? "ui-390-chromium";
const minimumFailureRate = Number(process.env.UI_BASELINE_MIN_FAILURE_RATE ?? 0.3);

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

function summarize() {
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

  return {
    total,
    passed,
    failed,
    skipped,
    failureRate,
    minimumFailureRate,
    thresholdMet: failureRate >= minimumFailureRate,
    failures: results.filter((item) => item.status !== "passed" && item.status !== "skipped"),
  };
}

fs.rmSync(path.dirname(reportPath), { recursive: true, force: true });

if (process.env.UI_BASELINE_SKIP_BUILD !== "1") {
  const build = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:web:test"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["playwright", "test", "tests/e2e/report-only", "--project", project],
  { cwd: root, stdio: "inherit", env: process.env }
);

if (!fs.existsSync(reportPath)) {
  console.error("[UI baseline] Playwright did not write a JSON report.");
  process.exit(result.status ?? 1);
}

const summary = summarize();
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(
  `[UI baseline] total=${summary.total} passed=${summary.passed} failed=${summary.failed} skipped=${summary.skipped} failureRate=${(summary.failureRate * 100).toFixed(1)}%`
);
console.log(`[UI baseline] thresholdMet=${summary.thresholdMet}`);
console.log(`[UI baseline] summary=${path.relative(root, summaryPath)}`);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(0);
