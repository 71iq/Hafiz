import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "components/mushaf/AyahBlock.tsx"), "utf8");

describe("AyahBlock action row contract", () => {
  it("keeps verse action buttons in one horizontally scrollable row", () => {
    expect(source).toContain("ScrollView");
    expect(source).toContain("horizontal");
    expect(source).toContain("showsHorizontalScrollIndicator={false}");
    expect(source).toContain('flexDirection: isRTL ? "row-reverse" : "row"');
    expect(source).toContain("gap: 8");
    expect(source).toContain("flexShrink: 0");
    expect(source).toContain("numberOfLines={1}");
    expect(source).not.toContain('className="mt-1 flex-wrap gap-2"');
  });
});
