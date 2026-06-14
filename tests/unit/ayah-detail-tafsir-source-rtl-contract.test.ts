import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "components/mushaf/AyahDetailModal.tsx"), "utf8");

describe("AyahDetailModal tafsir source row RTL contract", () => {
  it("mirrors the source copy and Sources button as one row in RTL", () => {
    const rowStart = source.indexOf('activeTab === "tafsir"');
    const pickerStart = source.indexOf("{tafsirRows === null", rowStart);
    const rowSource = source.slice(rowStart, pickerStart);

    expect(rowStart).toBeGreaterThan(-1);
    expect(pickerStart).toBeGreaterThan(rowStart);
    expect(rowSource).toContain('style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}');
    expect(rowSource).toContain('className="items-center gap-1.5 rounded-full bg-surface dark:bg-surface-dark px-3 py-2"');
    expect(rowSource).toContain('direction: "ltr",');
    expect(rowSource).toContain('flexDirection: isRTL ? "row-reverse" : "row",');
    expect(rowSource).toContain('textAlign: isRTL ? "right" : "left",');
  });
});
