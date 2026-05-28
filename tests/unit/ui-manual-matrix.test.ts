import {
  getCoverageByPhase,
  getCoverageByStatus,
  uiCoverageItems,
  uiRouteCoverage,
} from "../ui/ui-manual-matrix";

describe("UI manual coverage matrix", () => {
  it("keeps coverage IDs unique", () => {
    const ids = uiCoverageItems.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("assigns every coverage item to a runnable phase and source section", () => {
    for (const item of uiCoverageItems) {
      expect(item.phase).toMatch(/^[a-z0-9-]+$/);
      expect(item.source).toContain("UI_MANUAL_TESTING_META.md#");
      expect(item.tags.length).toBeGreaterThan(0);
    }
  });

  it("keeps route smoke coverage for the full route inventory", () => {
    expect(uiRouteCoverage.length).toBeGreaterThanOrEqual(29);
    expect(uiRouteCoverage.some((item) => item.id === "route.mushaf")).toBe(true);
    expect(uiRouteCoverage.some((item) => item.id === "route.flashcard-session")).toBe(true);
    expect(uiRouteCoverage.some((item) => item.id === "route.profile-public")).toBe(true);
  });

  it("separates strict default checks from report-only baseline work", () => {
    expect(getCoverageByStatus("strict").length).toBeGreaterThan(0);
    expect(getCoverageByStatus("report-only").length).toBeGreaterThan(0);
    expect(getCoverageByPhase("mushaf-reader").length).toBeGreaterThan(0);
  });
});
