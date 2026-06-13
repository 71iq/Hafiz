import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const quranDisplayFiles = [
  "components/mushaf/MushafPage.tsx",
  "components/mushaf/AyahBlock.tsx",
  "components/flashcards/Qcf2AyahText.tsx",
  "components/mushaf/PageMushaf.tsx",
];

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function expectSourceContainsAll(relativePath: string, expectedSnippets: string[]) {
  const source = read(relativePath);
  for (const snippet of expectedSnippets) {
    expect(source).toContain(snippet);
  }
}

describe("Quran RTL source invariants", () => {
  it("keeps QCF/Pua word containers protected from Arabic UI double reversal", () => {
    for (const relativePath of [
      "components/mushaf/MushafPage.tsx",
      "components/mushaf/AyahBlock.tsx",
      "components/flashcards/Qcf2AyahText.tsx",
    ]) {
      expectSourceContainsAll(relativePath, [
        'direction: "ltr"',
        'flexDirection: "row-reverse"',
      ]);
    }
  });

  it("keeps Quran display on bundled page fonts instead of system Arabic fonts", () => {
    expectSourceContainsAll("components/mushaf/MushafPage.tsx", [
      "quranPageFontName",
      "quranPageFontPaletteStyle",
      "quranPageMarkerFontPaletteStyle",
      "fontFamily={fontFamily}",
    ]);
    expectSourceContainsAll("components/mushaf/AyahBlock.tsx", [
      "quranPageFontName",
      "quranPageFontPaletteStyle",
      "quranPageMarkerFontPaletteStyle",
      "fontFamily={fontFamily}",
    ]);
    expectSourceContainsAll("components/flashcards/Qcf2AyahText.tsx", [
      "quranPageFontName",
      "quranPageFontPaletteStyle",
      "quranPageMarkerFontPaletteStyle",
      "fontFamily,",
    ]);
  });

  it("keeps PageMushaf assigning page-font content by v2_page and text_qcf2", () => {
    expectSourceContainsAll("components/mushaf/PageMushaf.tsx", [
      "Build page data using v2_page assignments.",
      "SELECT surah, ayah, text_qcf2, v2_page FROM quran_text ORDER BY surah, ayah",
      "if (!a.v2_page) continue;",
      "ayahsByPage.get(a.v2_page)",
      "textQcf2: a.text_qcf2 ?? \"\"",
      "<MushafPage",
    ]);
  });

  it("keeps Quran display files free of horizontal mirror transforms", () => {
    const forbiddenPatterns = [
      /\bscaleX\s*\(\s*-1\s*\)/,
      /\bscaleX\s*:\s*-1\b/,
      /\brotateY\s*\(\s*["']?180deg["']?\s*\)/,
      /\bmatrix\s*\(\s*-1\s*,/,
    ];

    const violations: string[] = [];

    for (const relativePath of quranDisplayFiles) {
      const source = read(relativePath);
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(source)) {
          violations.push(`${relativePath} matches ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps copy/share behavior tied to Uthmani text, not QCF display glyphs", () => {
    expectSourceContainsAll("components/mushaf/AyahBlock.tsx", [
      "fetchUthmaniRange",
      "formatForCopy(text, surahName, surah, ayah, ayah)",
    ]);
    expect(read("components/mushaf/AyahBlock.tsx")).not.toContain("formatForCopy(textQcf2");
    expect(read("components/mushaf/AyahBlock.tsx")).not.toContain("formatForCopy(wordTokens");
  });
});

