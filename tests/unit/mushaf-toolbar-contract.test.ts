import fs from "fs";
import path from "path";

describe("Mushaf toolbar contract", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "app/(tabs)/mushaf.tsx"), "utf8");

  it("keeps the inactive auto-scroll entry icon visually consistent with other toolbar icons", () => {
    expect(source).toContain('const toolbarIconColor = isDark ? "#737373" : "#8B8178";');
    expect(source.match(/<ScanLine size=\{16\} color=\{toolbarIconColor\} \/>/g)).toHaveLength(2);
    expect(source).not.toContain('<ScanLine size={16} color="#0d9488" />');
  });
});
