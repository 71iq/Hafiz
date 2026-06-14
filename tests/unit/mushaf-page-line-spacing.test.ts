import { shouldJustifyMushafLine } from "@/lib/mushaf/page-layout";

describe("Mushaf page line spacing", () => {
  it("keeps the third ayah line on page 2 compact", () => {
    expect(shouldJustifyMushafLine(2, 5, false, 8)).toBe(false);
  });

  it("still justifies ordinary multi-word ayah lines", () => {
    expect(shouldJustifyMushafLine(3, 5, false, 7)).toBe(true);
  });

  it("does not justify centered or single-word lines", () => {
    expect(shouldJustifyMushafLine(2, 4, true, 4)).toBe(false);
    expect(shouldJustifyMushafLine(3, 10, false, 1)).toBe(false);
  });
});
