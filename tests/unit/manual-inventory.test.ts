import {
  uiComponentCoverage,
  uiCoverageItems,
  uiFlowCoverage,
  uiRouteCoverage,
} from "../ui/ui-manual-matrix";

describe("manual UI inventory", () => {
  it("extracts a substantial route, component, and flow inventory from the matrix", () => {
    expect(uiRouteCoverage.length).toBeGreaterThanOrEqual(29);
    expect(uiComponentCoverage.length).toBeGreaterThanOrEqual(15);
    expect(uiFlowCoverage.length).toBeGreaterThanOrEqual(25);
  });

  it("keeps every coverage item sourced back to the matrix", () => {
    for (const item of uiCoverageItems) {
      expect(item.source).toMatch(/^ui-manual-matrix#/);
    }
  });
});
