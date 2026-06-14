import fs from "fs";
import path from "path";

describe("PageViewNavigationSheet icon contract", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "components/mushaf/PageViewNavigationSheet.tsx"), "utf8");

  it("uses matching vertical and horizontal movement icons for page navigation modes", () => {
    expect(source).toContain("MoveVertical");
    expect(source).toContain("MoveHorizontal");
    expect(source).toContain('{ value: "vertical", label: s.pageScrollVertical, icon: MoveVertical }');
    expect(source).toContain('{ value: "horizontal", label: s.pageScrollHorizontal, icon: MoveHorizontal }');
    expect(source).not.toContain("AlignJustify");
  });
});
