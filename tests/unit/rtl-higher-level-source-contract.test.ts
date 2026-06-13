import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function expectSourceContainsAll(relativePath: string, expectedSnippets: string[]) {
  const source = read(relativePath);
  for (const snippet of expectedSnippets) {
    expect(source).toContain(snippet);
  }
}

describe("higher-level RTL source contracts", () => {
  it("keeps DropdownMenu placement coordinate-based while menu item rows mirror internally", () => {
    expectSourceContainsAll("components/ui/DropdownMenu.tsx", [
      "left: menuPosition.left",
      'direction: "ltr"',
      'flexDirection: isRTL ? "row-reverse" : "row"',
      'textAlign: isRTL ? "right" : "left"',
      'writingDirection: isRTL ? "rtl" : "ltr"',
    ]);
  });

  it("keeps ActivityHeatmap chronology explicit instead of relying on ambient RTL direction", () => {
    expectSourceContainsAll("components/progress/ActivityHeatmap.tsx", [
      "const renderedWeeks = isRTL ? [...weeks].reverse() : weeks;",
      'style={{ direction: "ltr", alignItems: showSummary ? "stretch" : "center", width: "100%" }}',
      'flexDirection: showSummary ? (isRTL ? "row-reverse" : "row") : "column"',
      "marginLeft: isRTL ? 0 : DAY_LABEL_WIDTH",
      "marginRight: isRTL ? DAY_LABEL_WIDTH : 0",
      'textAlign: isRTL ? "right" : "left"',
      'writingDirection: isRTL ? "rtl" : "ltr"',
    ]);
  });

  it("keeps progress components using logical-start fill alignment without mirror transforms", () => {
    expectSourceContainsAll("components/ui/Progress.tsx", [
      "useUIDirection",
      'alignItems: dir === "rtl" ? "flex-end" : "flex-start"',
      "width: `${Math.min(100, Math.max(0, value))}%`",
    ]);
    expectSourceContainsAll("components/achievements/AchievementProgressBar.tsx", [
      "const { isRTL, themeColors } = useSettings();",
      'alignItems: isRTL ? "flex-end" : "flex-start"',
      "width: `${pct}%`",
    ]);

    for (const relativePath of [
      "components/ui/Progress.tsx",
      "components/achievements/AchievementProgressBar.tsx",
      "components/progress/ActivityHeatmap.tsx",
    ]) {
      const source = read(relativePath);
      expect(source).not.toMatch(/\bscaleX\s*\(\s*-1\s*\)/);
      expect(source).not.toMatch(/\bscaleX\s*:\s*-1\b/);
      expect(source).not.toMatch(/\brotateY\s*\(\s*["']?180deg["']?\s*\)/);
    }
  });
});
