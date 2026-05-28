import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const root = process.cwd();
const scannedRoots = ["app", "components", "lib"];
const ignoredFiles = new Set([
  "lib/database/sync-queue.ts",
]);

function walkFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolute));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(absolute);
    }
  }

  return files;
}

function lineNumberAt(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

test.describe("report-only sync contracts", () => {
  test("all enqueueSync calls are non-blocking and explicitly catch console.warn", () => {
    const violations: string[] = [];

    for (const scannedRoot of scannedRoots) {
      for (const file of walkFiles(path.join(root, scannedRoot))) {
        const relativePath = path.relative(root, file);
        if (ignoredFiles.has(relativePath)) continue;

        const source = fs.readFileSync(file, "utf8");
        for (const match of source.matchAll(/\benqueueSync\s*\(/g)) {
          const statementEnd = source.indexOf(";", match.index);
          const statement = source.slice(match.index, statementEnd === -1 ? undefined : statementEnd + 1);
          if (!statement.includes(".catch(console.warn)")) {
            violations.push(`${relativePath}:${lineNumberAt(source, match.index)} ${statement.split("\n")[0].trim()}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
