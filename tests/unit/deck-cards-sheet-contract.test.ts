import fs from "fs";
import path from "path";

describe("DeckCardsSheet layout contract", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "components/flashcards/DeckCardsSheet.tsx"), "utf8");

  it("keeps filter chips and table rows mirrored explicitly in RTL", () => {
    expect(source).toContain("const rowFlexStyle: ViewStyle = {");
    expect(source).toContain('direction: "ltr",');
    expect(source).toContain('flexDirection: isRTL ? "row-reverse" : "row",');
    expect(source).toContain('style={{ ...rowFlexStyle, flexWrap: "wrap" }}');
    expect(source).toContain("<DeckCardsHeader isRTL={isRTL} s={s} rowFlexStyle={rowFlexStyle} />");
    expect(source).toContain("rowFlexStyle={rowFlexStyle}");
  });

  it("keeps the cards table full width while preserving horizontal overflow on narrow screens", () => {
    expect(source).toContain('style={{ width: "100%" }}');
    expect(source).toContain('contentContainerStyle={{ flexGrow: 1, minWidth: "100%" }}');
    expect(source).toContain('style={{ minWidth: 620, width: "100%" }}');
  });
});
