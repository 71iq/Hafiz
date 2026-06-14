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

  it("keeps RTL page rows from double-reversing under web ambient direction", () => {
    expectSourceContainsAll("components/reflections/ReflectionCard.tsx", [
      "const rowFlexStyle = {",
      'direction: "ltr" as const',
      'flexDirection: isRTL ? "row-reverse" as const : "row" as const',
      "style={rowFlexStyle}",
      "...rowFlexStyle",
    ]);

    expectSourceContainsAll("components/progress/DefaultDeckProgressChart.tsx", [
      "const rowFlexStyle = {",
      'direction: "ltr" as const',
      'flexDirection: isRTL ? "row-reverse" as const : "row" as const',
      "style={rowFlexStyle}",
      'alignSelf: isRTL ? "flex-end" : "flex-start"',
    ]);

    expectSourceContainsAll("components/progress/SurahProgressList.tsx", [
      "const rowFlexStyle = {",
      'direction: "ltr" as const',
      'flexDirection: isRTL ? "row-reverse" as const : "row" as const',
      "contentContainerStyle={{ gap: 8, ...rowFlexStyle, paddingHorizontal: 1 }}",
      'alignSelf: isRTL ? "flex-end" : "flex-start"',
    ]);

    expectSourceContainsAll("components/profile/ProfileModalContent.tsx", [
      "const mirroredRowStyle = {",
      "const rowFlexStyle = {",
      'direction: "ltr" as const',
      'flexDirection: isWideActivity ? (isRTL ? "row-reverse" as const : "row" as const) : "column" as const',
      "style={mirroredRowStyle}",
    ]);

    expectSourceContainsAll("app/(tabs)/progress.tsx", [
      "const mirroredRowStyle = {",
      'direction: "ltr" as const',
      'flexDirection: isRTL ? "row-reverse" as const : "row" as const',
      "style={mirroredRowStyle}",
      'contentContainerStyle={{ gap: 8, direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row", paddingHorizontal: 1 }}',
    ]);

    expectSourceContainsAll("app/(tabs)/leaderboard.tsx", [
      "export function LeaderboardRow({",
      "isRTL={isRTL}",
      "isRTL: boolean;",
      'direction: "ltr"',
      'flexDirection: isRTL ? "row-reverse" : "row"',
    ]);

    expectSourceContainsAll("components/achievements/PublicBadgesGrid.tsx", [
      'style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}',
    ]);
    expectSourceContainsAll("components/achievements/AchievementBadge.tsx", [
      'style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}',
    ]);
  });

  it("keeps Settings category tabs on the shared ToggleGroup RTL contract", () => {
    expectSourceContainsAll("app/(tabs)/settings.tsx", [
      "function SettingsCategoryTabs({",
      "<ToggleGroup<SettingsCategoryId>",
      'dir={isRTL ? "rtl" : "ltr"}',
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
