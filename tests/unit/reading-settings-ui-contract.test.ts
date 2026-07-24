import fs from "fs";
import path from "path";

const source = fs.readFileSync(path.join(process.cwd(), "components/mushaf/ReadingSettingsSheet.tsx"), "utf8");

describe("ReadingSettingsSheet UI contract", () => {
  it("keeps the main reading settings sheet text-first and free of decorative row icons", () => {
    for (const decorativeIcon of [
      "BookOpen",
      "BookOpenText",
      "Info",
      "Monitor",
      "Moon",
      "Palette",
      "Sun",
      "Type",
      "LucideIcon",
    ]) {
      expect(source).not.toContain(decorativeIcon);
    }

    expect(source).not.toContain("function ThemeTile");
    expect(source).not.toContain("icon={<");
    expect(source).not.toContain("icon={");
  });

  it("uses a compact text-only appearance segmented control", () => {
    const appearanceStart = source.indexOf("function ThemeSegmentedControl");
    expect(appearanceStart).toBeGreaterThanOrEqual(0);

    const choiceDialogStart = source.indexOf("function ChoiceDialog");
    const appearanceSource = source.slice(appearanceStart, choiceDialogStart);
    expect(appearanceSource).toContain("options.map");
    expect(appearanceSource).toContain("option.label");
    expect(appearanceSource).toContain("getThemeChoiceVisual(option.value, systemTheme, option.active)");
    expect(appearanceSource).toContain("backgroundColor: themeVisual.backgroundColor");
    expect(appearanceSource).not.toContain("<Check");
    expect(appearanceSource).not.toContain("Icon");
  });

  it("keeps grouped setting rows without a leading icon slot", () => {
    const rowStart = source.indexOf("function SettingsActionRow");
    expect(rowStart).toBeGreaterThanOrEqual(0);

    const rowSource = source.slice(rowStart, source.indexOf("function Divider"));
    expect(rowSource).toContain("title: string");
    expect(rowSource).toContain("trailing: React.ReactNode");
    expect(rowSource).not.toContain("icon:");
    expect(rowSource).not.toContain("{icon}");
  });
});
