import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "components/notes/PrivateNotesSection.tsx"), "utf8");

describe("PrivateNotesSection RTL contract", () => {
  it("mirrors the notes header and note rows without ambient RTL double reversal", () => {
    expect(source).toContain('className="mb-3 items-center justify-between"');
    expect(source).toContain('style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}');
    expect(source).toContain('className="items-center gap-1 rounded-full bg-primary-accent px-3 py-1.5"');
    expect(source).toContain('className="items-start gap-3"');
    expect(source).toContain('textAlign: isRTL ? "right" : "left"');
    expect(source).toContain('writingDirection: isRTL ? "rtl" : "ltr"');
  });
});
