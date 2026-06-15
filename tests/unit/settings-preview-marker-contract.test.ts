import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("settings Quran preview marker contract", () => {
  it("uses the Quran-font marker token and marker palette in every UI language", () => {
    const source = fs.readFileSync(path.join(root, "app/(tabs)/settings.tsx"), "utf8");

    expect(source).toContain("const isMarker = index === quranPreview.tokens.length - 1;");
    expect(source).toContain("fontFamily: previewFontFamily");
    expect(source).toContain("...(isMarker ? previewMarkerFontPaletteStyle : previewFontPaletteStyle)");
    expect(source).toContain("{token}");
    expect(source).not.toContain("localizedAyahMarker");
    expect(source).not.toContain("usesLocalizedMarker");
    expect(source).not.toContain("displayToken");
    expect(source).not.toContain("Math.max(14, fontSize * 0.62)");
  });
});
