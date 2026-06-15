import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "app/(tabs)/settings.tsx"), "utf8");

describe("settings theme schedule layout contract", () => {
  it("keeps theme choices color-driven instead of icon-driven", () => {
    const optionsStart = source.indexOf("const THEME_OPTIONS:");
    const updaterStart = source.indexOf("const updateScheduledRule", optionsStart);
    const optionsSource = source.slice(optionsStart, updaterStart);

    expect(optionsStart).toBeGreaterThan(-1);
    expect(updaterStart).toBeGreaterThan(optionsStart);
    expect(source).toContain("const THEME_CHOICE_VISUALS:");
    expect(source).toContain("function getThemeChoiceVisual");
    expect(source).toContain("backgroundColor: themeVisual.backgroundColor");
    expect(source).toContain("borderColor: themeVisual.borderColor");
    expect(optionsSource).not.toContain("icon:");
    expect(optionsSource).not.toContain("Moon");
    expect(optionsSource).not.toContain("Sun");
    expect(optionsSource).not.toContain("Clock3");
    expect(optionsSource).not.toContain("Smartphone");
  });

  it("keeps scheduled theme chips and time controls in the same responsive row", () => {
    const scheduleStart = source.indexOf('{theme === "scheduled"');
    const scheduleEnd = source.indexOf("<SectionLabel>{s.sectionReading}</SectionLabel>", scheduleStart);
    const scheduleSource = source.slice(scheduleStart, scheduleEnd);

    expect(scheduleStart).toBeGreaterThan(-1);
    expect(scheduleEnd).toBeGreaterThan(scheduleStart);
    expect(scheduleSource).toContain("scheduleRuleInline ? (isRTL ? \"row-reverse\" : \"row\") : \"column\"");
    expect(scheduleSource).toContain("scheduledRuleThemeChipBasis");
    expect(scheduleSource).toContain("maxWidth: scheduleRuleInline ? 96 : undefined");
    expect(scheduleSource).toContain("compact");
    expect(scheduleSource).not.toContain("IconComponent");
  });
});
