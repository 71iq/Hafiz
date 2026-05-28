import {
  getCoverageByPhase,
  getCoverageByStatus,
  uiComponentCoverage,
  uiCoverageItems,
  uiFlowCoverage,
  uiRouteCoverage,
} from "../ui/ui-manual-matrix";

const runnablePhases = [
  "route-smoke",
  "navigation-settings-rtl-theme",
  "mushaf-reader",
  "search-deeplinks-overlays",
  "flashcards-home-progress",
  "community-auth-online",
];

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

  test.each(runnablePhases)("%s owns at least one coverage item", (phase) => {
    expect(getCoverageByPhase(phase).length).toBeGreaterThan(0);
  });

  it("keeps routes, components, and flows represented separately", () => {
    expect(uiRouteCoverage.every((item) => item.tags.includes("route"))).toBe(true);
    expect(uiComponentCoverage.every((item) => item.tags.includes("component"))).toBe(true);
    expect(uiFlowCoverage.every((item) => item.tags.includes("flow"))).toBe(true);
  });

  it("keeps live environment checks out of strict local verification", () => {
    for (const item of getCoverageByStatus("live-env")) {
      expect(item.tags).toEqual(expect.arrayContaining(["supabase"]));
      expect(item.status).not.toBe("strict");
    }
  });
});
