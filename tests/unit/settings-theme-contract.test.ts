import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "app/(tabs)/settings.tsx"), "utf8");

describe("settings theme layout contract", () => {
  it("keeps theme choices color-driven instead of icon-driven", () => {
    const optionsStart = source.indexOf("const THEME_OPTIONS:");
    const optionsEnd = source.indexOf("const settingsCategories", optionsStart);
    const optionsSource = source.slice(optionsStart, optionsEnd);

    expect(optionsStart).toBeGreaterThan(-1);
    expect(optionsEnd).toBeGreaterThan(optionsStart);
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

  it("offers the four color palettes and the system option", () => {
    const optionsStart = source.indexOf("const THEME_OPTIONS:");
    const optionsEnd = source.indexOf("const settingsCategories", optionsStart);
    const optionsSource = source.slice(optionsStart, optionsEnd);
    const values = [...optionsSource.matchAll(/\{ value: "([^"]+)", label:/g)].map((match) => match[1]);

    expect(values).toEqual(["dark", "beige", "white", "amoled", "system"]);
  });
});
