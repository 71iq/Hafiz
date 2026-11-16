import fs from "node:fs";
import path from "node:path";

const modal = fs.readFileSync(path.join(process.cwd(), "components/mushaf/AyahDetailModal.tsx"), "utf8");
const wordSheet = fs.readFileSync(path.join(process.cwd(), "components/mushaf/WordDetailSheet.tsx"), "utf8");
const row = fs.readFileSync(path.join(process.cwd(), "components/mushaf/DetailTabRow.tsx"), "utf8");

describe("Detail tab row contract", () => {
  it("keeps detail tabs in one horizontally scrollable, text-labelled row", () => {
    expect(row).toContain("<ScrollView");
    expect(row).toContain("horizontal");
    expect(row).toContain("showsHorizontalScrollIndicator={false}");
    expect(row).toMatch(/direction: isRTL \? "rtl" : "ltr",\s+flexDirection: "row",\s+gap: 8/);
    expect(row).toContain("flexShrink: 0");
    expect(row).toContain("numberOfLines={1}");
    expect(row).toContain('whiteSpace: "nowrap"');
    expect(row).toContain('accessibilityRole="tab"');
    expect(row).toContain("minHeight: 44");
  });

  it("uses the same row in the ayah and word detail sheets", () => {
    expect(modal).toContain("<DetailTabRow");
    expect(wordSheet).toContain("<DetailTabRow");
    expect(modal).not.toContain("EqualApproximately");
    expect(modal).not.toContain("#0d9488");
  });
});
