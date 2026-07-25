import fs from "node:fs";
import path from "node:path";

const settingsSource = fs.readFileSync(path.join(process.cwd(), "app/(tabs)/settings.tsx"), "utf8");
const themeSource = fs.readFileSync(path.join(process.cwd(), "lib/settings/context.tsx"), "utf8");

describe("settings theme layout contract", () => {
  it("keeps theme choices color-driven instead of icon-driven", () => {
    const optionsStart = settingsSource.indexOf("const THEME_OPTIONS:");
    const optionsEnd = settingsSource.indexOf("const settingsCategories", optionsStart);
    const optionsSource = settingsSource.slice(optionsStart, optionsEnd);

    expect(optionsStart).toBeGreaterThan(-1);
    expect(optionsEnd).toBeGreaterThan(optionsStart);
    expect(settingsSource).toContain("getThemeChoiceVisual(option.value, systemTheme, isActive)");
    expect(settingsSource).toContain("backgroundColor: themeVisual.backgroundColor");
    expect(settingsSource).toContain("borderColor: themeVisual.borderColor");
    expect(settingsSource).toContain("<ThemeColorSwatch theme={option.value} selected={isActive}");
    expect(settingsSource).toContain("accessibilityLabel={option.label}");
    expect(settingsSource).toContain("aria-checked={isActive}");
    expect(themeSource).toContain("backgroundColor: THEME_COLORS[palette].surface");
    expect(themeSource).toContain('const palette = theme === "system" ? systemTheme : theme;');
    expect(optionsSource).not.toContain("icon:");
    expect(optionsSource).not.toContain("Moon");
    expect(optionsSource).not.toContain("Sun");
    expect(optionsSource).not.toContain("Clock3");
    expect(optionsSource).not.toContain("Smartphone");
  });

  it("offers the four color palettes and the system option", () => {
    const optionsStart = settingsSource.indexOf("const THEME_OPTIONS:");
    const optionsEnd = settingsSource.indexOf("const settingsCategories", optionsStart);
    const optionsSource = settingsSource.slice(optionsStart, optionsEnd);
    const values = [...optionsSource.matchAll(/\{ value: "([^"]+)", label:/g)].map((match) => match[1]);

    expect(values).toEqual(["dark", "beige", "white", "amoled", "system"]);
  });
});
