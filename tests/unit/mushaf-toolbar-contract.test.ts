import fs from "fs";
import path from "path";

describe("Mushaf toolbar contract", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "app/(tabs)/mushaf.tsx"), "utf8");

  it("keeps the inactive auto-scroll entry icon visually consistent with other toolbar icons", () => {
    expect(source).toContain('const toolbarIconColor = isDark ? "#737373" : "#8B8178";');
    expect(source.match(/<ScanLine size=\{16\} color=\{toolbarIconColor\} \/>/g)).toHaveLength(2);
    expect(source).not.toContain('<ScanLine size={16} color="#0d9488" />');
  });

  it("keeps the page view toggle compact when the chevron menu is visible", () => {
    expect(source).toContain("const pageMenuSlotWidth = compact ? 30 : 32;");
    expect(source).toContain('direction: "ltr",');
    expect(source).not.toContain('{showPageMenu && <View pointerEvents="none" style={{ width: pageMenuSlotWidth }} />}');
    expect(source).not.toContain("minWidth: showPageMenu ? (compact ? 132 : 144) : undefined,");
    expect(source).toContain("flexShrink: 0,");
    expect(source).toContain("width: pageMenuSlotWidth,");
    expect(source).toContain('writingDirection: isRTL ? "rtl" : "ltr",');
  });
});
