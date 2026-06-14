import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "components/mushaf/BookmarksSheet.tsx"), "utf8");

describe("BookmarksSheet RTL contract", () => {
  it("mirrors the whole bookmark row, including ayah badge and delete action", () => {
    expect(source).toContain('direction: "ltr",');
    expect(source).toContain('flexDirection: isRTL ? "row-reverse" : "row",');
    expect(source).toContain("justifyContent: \"space-between\",");
    expect(source).toContain("gap: 10,");
    expect(source).toContain("gap: 12,");
    expect(source).toContain('textAlign: isRTL ? "right" : "left",');
  });
});
