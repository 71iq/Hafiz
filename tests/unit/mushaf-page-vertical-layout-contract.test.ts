import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("Mushaf vertical page layout contract", () => {
  it("does not center vertical phone pages into viewport-height item slots", () => {
    const mushafSource = fs.readFileSync(path.join(root, "app/(tabs)/mushaf.tsx"), "utf8");
    const pageMushafSource = fs.readFileSync(path.join(root, "components/mushaf/PageMushaf.tsx"), "utf8");

    expect(mushafSource).not.toContain("centerVerticalOnPhone");
    expect(pageMushafSource).not.toContain("centerVerticalOnPhone");
    expect(pageMushafSource).not.toContain("minPageHeight");
    expect(pageMushafSource).not.toContain("effectiveContainerHeight - (index < pageData.length - 1 ? SEPARATOR_HEIGHT : 0)");
  });
});
