import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "components/ui/ResponsiveOverlay.tsx"), "utf8");

describe("ResponsiveOverlay phone sheet height contract", () => {
  it("uses a fixed phone sheet height instead of shrink-wrapping changing content", () => {
    expect(source).toContain('activePresentation === "sheet"');
    expect(source).toContain("maxHeight: computedMaxHeight");
    expect(source).toContain('height: activePresentation === "sheet" && isPhone ? computedMaxHeight : undefined');
    expect(source).toContain("[activePresentation, animation, computedMaxHeight, contentWidth, isPhone, resolvedSurfaceColor]");
  });
});
