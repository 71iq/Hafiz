import {
  canonicalAyahLink,
  formatQuranCopy,
  formatQuranReference,
  withAyahNumber,
  type QuranCopyRange,
} from "@/lib/selection/format";

const baqarah = (ayahStart: number, ayahEnd = ayahStart): QuranCopyRange => ({
  surah: 2,
  surahNameArabic: "البقرة",
  surahNameEnglish: "Al-Baqarah",
  ayahStart,
  ayahEnd,
});

describe("Quran copy and share format", () => {
  it("encloses Unicode text in ornate brackets with an English reference and canonical link", () => {
    const text = withAyahNumber("  ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ  ", 255);
    expect(formatQuranCopy({ text, ranges: [baqarah(255)], language: "en" })).toBe(
      "﴿ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ ٢٥٥﴾\nAl-Baqarah 2:255\nhttps://hafizquran.app/open?surah=2&ayah=255",
    );
  });

  it("writes the reference in Arabic with Arabic-Indic digits while the link keeps ASCII digits", () => {
    const formatted = formatQuranCopy({ text: "قُلْ هُوَ ٱللَّهُ أَحَدٌ ١", ranges: [baqarah(255, 257)], language: "ar" });
    expect(formatted.split("\n")).toEqual([
      "﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ ١﴾",
      "البقرة ٢:٢٥٥-٢٥٧",
      "https://hafizquran.app/open?surah=2&ayah=255",
    ]);
  });

  it("lists every selected range and links to the first ayah", () => {
    const ikhlas: QuranCopyRange = { surah: 112, surahNameArabic: "الإخلاص", surahNameEnglish: "Al-Ikhlas", ayahStart: 4, ayahEnd: 4 };
    const falaq: QuranCopyRange = { surah: 113, surahNameArabic: "الفلق", surahNameEnglish: "Al-Falaq", ayahStart: 1, ayahEnd: 2 };
    const formatted = formatQuranCopy({ text: "a ٤ b ١ c ٢", ranges: [ikhlas, falaq], language: "en" });
    expect(formatted).toContain("Al-Ikhlas 112:4; Al-Falaq 113:1-2");
    expect(formatted.endsWith(canonicalAyahLink(112, 4))).toBe(true);
  });

  it("falls back to the other script when a surah name is missing", () => {
    expect(formatQuranReference({ ...baqarah(1), surahNameEnglish: "" }, "en")).toBe("البقرة 2:1");
    expect(formatQuranReference({ ...baqarah(1), surahNameArabic: "", surahNameEnglish: "" }, "ar")).toBe("٢:١");
  });

  it("never adds an ayah number to empty text", () => {
    expect(withAyahNumber("   ", 3)).toBe("");
  });
});
