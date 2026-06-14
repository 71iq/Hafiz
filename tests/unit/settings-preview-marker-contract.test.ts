import fs from "node:fs";
import path from "node:path";
import { localizedAyahMarker } from "@/lib/quran/ayah-marker";

const root = process.cwd();

describe("settings Quran preview marker contract", () => {
  it("localizes ayah marker digits and preserves the expected visual bracket order", () => {
    expect(localizedAyahMarker(282, false)).toBe("﴾282﴿");
    expect(localizedAyahMarker(282, true)).toBe("﴿٢٨٢﴾");
  });

  it("does not render the raw QCF marker token in the English settings preview", () => {
    const source = fs.readFileSync(path.join(root, "app/(tabs)/settings.tsx"), "utf8");

    expect(source).toContain('import { localizedAyahMarker } from "@/lib/quran/ayah-marker";');
    expect(source).toContain("const usesLocalizedMarker = isMarker && !isRTL;");
    expect(source).toContain("localizedAyahMarker(SETTINGS_QURAN_PREVIEW_AYAH, false)");
    expect(source).toContain("{displayToken}");
  });
});
