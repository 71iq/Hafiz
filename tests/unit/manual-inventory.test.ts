import fs from "node:fs";
import path from "node:path";
import { uiCoverageItems, uiRouteCoverage } from "../ui/ui-manual-matrix";

const root = process.cwd();
const manualMeta = fs.readFileSync(path.join(root, "docs/agent/UI_MANUAL_TESTING_META.md"), "utf8");

const inventoriedSourcePaths = Array.from(
  new Set(
    [...manualMeta.matchAll(/`((?:app|components)\/[^`]+?\.(?:tsx|ts))`/g)]
      .map((match) => match[1])
      .sort()
  )
);

const inventoriedRoutePaths = inventoriedSourcePaths.filter((sourcePath) => sourcePath.startsWith("app/"));
const inventoriedComponentPaths = inventoriedSourcePaths.filter((sourcePath) => sourcePath.startsWith("components/"));

describe("manual UI inventory", () => {
  it("extracts a substantial app/component inventory from the manual meta file", () => {
    expect(inventoriedRoutePaths.length).toBeGreaterThanOrEqual(29);
    expect(inventoriedComponentPaths.length).toBeGreaterThanOrEqual(70);
  });

  test.each(inventoriedSourcePaths)("%s exists in the repo", (sourcePath) => {
    expect(fs.existsSync(path.join(root, sourcePath))).toBe(true);
  });

  it("keeps every manually inventoried route represented in the coverage map", () => {
    expect(uiRouteCoverage.length).toBeGreaterThanOrEqual(inventoriedRoutePaths.length);
  });

  it("keeps every coverage item tied back to the manual meta source", () => {
    for (const item of uiCoverageItems) {
      expect(item.source).toMatch(/^UI_MANUAL_TESTING_META\.md#/);
    }
  });
});
