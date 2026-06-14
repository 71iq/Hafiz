import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "app/(tabs)/settings.tsx"), "utf8");

describe("settings content list contract", () => {
  it("uses a compact content-specific settings list instead of generic cards", () => {
    const contentStart = source.indexOf('{activeCategory === "content"');
    const accountStart = source.indexOf('{activeCategory === "account"', contentStart);
    const contentSource = source.slice(contentStart, accountStart);

    expect(contentStart).toBeGreaterThan(-1);
    expect(accountStart).toBeGreaterThan(contentStart);
    expect(contentSource).toContain("<ContentSettingsPanel isRTL={isRTL}>");
    expect(contentSource).toContain("<ContentSettingsGroup title={s.readingContentSettingsLabel} isRTL={isRTL}>");
    expect(contentSource).toContain("<ContentSettingsRow");
    expect(contentSource).not.toContain("<Card");
    expect(contentSource).not.toContain("<SectionLabel");
    expect(contentSource).not.toContain("ChevronDown");
  });

  it("keeps content rows horizontal, compact, and explicitly mirrored", () => {
    expect(source).toContain("const CONTENT_SETTINGS_MAX_WIDTH = 720;");
    expect(source).toContain("const CONTENT_SETTINGS_ROW_HEIGHT = 60;");
    expect(source).toContain("maxWidth: CONTENT_SETTINGS_MAX_WIDTH");
    expect(source).toContain("borderRadius: 16");
    expect(source).toContain("borderBottomWidth: showDivider ? StyleSheet.hairlineWidth : 0");
    expect(source).toContain('direction: "ltr"');
    expect(source).toContain('flexDirection: isRTL ? "row-reverse" : "row"');
    expect(source).toContain('textAlign: isRTL ? "right" : "left"');
    expect(source).toContain('textAlign: isRTL ? "left" : "right"');
  });
});
