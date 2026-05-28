import { formatForCopy } from "@/lib/selection/format";

describe("selection copy formatting", () => {
  it("formats a single ayah with human text and web deep link", () => {
    const formatted = formatForCopy("  الحمد لله رب العالمين  ", "Al-Fatihah", 1, 2, 2);

    expect(formatted).toBe(
      "\"الحمد لله رب العالمين\"\n[Al-Fatihah : 2]\nhttps://hafizquran.app/open?surah=1&ayah=2"
    );
  });

  it("formats an ayah range without changing the selected text", () => {
    const formatted = formatForCopy("قل هو الله أحد\nالله الصمد", "Al-Ikhlas", 112, 1, 2);

    expect(formatted).toContain("[Al-Ikhlas : 1-2]");
    expect(formatted).toContain("https://hafizquran.app/open?surah=112&ayah=1");
    expect(formatted.startsWith("\"قل هو الله أحد\nالله الصمد\"")).toBe(true);
  });
});
