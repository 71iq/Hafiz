import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test.describe("report-only UI contract checks", () => {
  test("package scripts expose every planned runner", () => {
    const pkg = JSON.parse(read("package.json"));
    for (const scriptName of [
      "test:unit",
      "test:e2e:smoke",
      "test:ui:phase",
      "test:ui:baseline",
      "verify:quick",
      "verify:web",
    ]) {
      expect(pkg.scripts[scriptName]).toBeTruthy();
    }
  });

  test("not-found route does not contain hardcoded English-only visible copy", () => {
    const source = read("app/+not-found.tsx");
    expect(source).not.toContain("This screen doesn't exist.");
    expect(source).not.toContain("Go to home screen!");
    expect(source).not.toContain("Oops!");
  });

  test("QA readiness route does not contain hardcoded English-only visible copy", () => {
    const source = read("app/qa-ready.tsx");
    expect(source).not.toContain("QA Readiness");
    expect(source).not.toContain("Wait for ready before starting screenshot capture.");
  });
});
