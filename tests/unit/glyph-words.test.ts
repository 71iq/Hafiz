import qcf2 from "@/assets/data/quran-qcf2.json";
import quranData from "@/assets/data/quran-data.json";
import wbw from "@/assets/data/wbw/wbw.json";
import {
  ayahGlyphs,
  glyphsBeforeWord,
  glyphsFromWord,
  glyphsOfMushafWord,
  mushafWordOfGlyph,
  type AyahGlyphs,
} from "@/lib/mushaf/glyph-words";

/** Word splitting as the smart-deck prompts split `text_uthmani`. */
function unicodeWords(text: string): string[] {
  return text
    .replace(/[۞۩﴿﴾0-9٠-٩]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const ayat = quranData.tables.quran_text.map((row, index) => ({
  surah: row.surah,
  ayah: row.ayah,
  words: unicodeWords(row.text_uthmani),
  textQcf2: qcf2[index].code_v2,
}));

function layoutOf(surah: number, ayah: number): { layout: AyahGlyphs; words: string[] } {
  const row = ayat.find((entry) => entry.surah === surah && entry.ayah === ayah)!;
  return { layout: ayahGlyphs(surah, ayah, row.textQcf2, row.words.length)!, words: row.words };
}

describe("glyph layout of every ayah", () => {
  it("has a layout for all 6,236 ayat, in the four known shapes", () => {
    const shapes = { aligned: 0, markFirst: 0, markInside: 0, merged: 0 };
    for (const row of ayat) {
      const layout = ayahGlyphs(row.surah, row.ayah, row.textQcf2, row.words.length);
      expect(layout).not.toBeNull();
      const extra = layout!.glyphs.length - row.words.length;
      if (extra === 0) shapes.aligned += 1;
      else if (extra === -1) shapes.merged += 1;
      else if (layout!.unicodeWords[0].to === 1) shapes.markFirst += 1;
      else shapes.markInside += 1;
    }
    expect(shapes).toEqual({ aligned: 6038, markFirst: 195, markInside: 1, merged: 2 });
  });

  it("counts mushaf words the way the bundled word-by-word table numbers them", () => {
    const wordsPerAyah = new Map<string, number>();
    for (const row of wbw) {
      const key = `${row.surah_number}:${row.ayah_number}`;
      wordsPerAyah.set(key, Math.max(wordsPerAyah.get(key) ?? 0, row.word_number));
    }
    for (const row of ayat) {
      const layout = ayahGlyphs(row.surah, row.ayah, row.textQcf2, row.words.length)!;
      expect([`${row.surah}:${row.ayah}`, layout.mushafWords.length]).toEqual([
        `${row.surah}:${row.ayah}`,
        wordsPerAyah.get(`${row.surah}:${row.ayah}`),
      ]);
    }
  });

  it("covers every glyph exactly once, in order, for Unicode and mushaf words alike", () => {
    for (const row of ayat) {
      const layout = ayahGlyphs(row.surah, row.ayah, row.textQcf2, row.words.length)!;
      for (const ranges of [layout.unicodeWords, layout.mushafWords]) {
        const covered = new Set<number>();
        ranges.forEach((range) => {
          for (let glyph = range.from; glyph <= range.to; glyph += 1) covered.add(glyph);
        });
        expect(covered.size).toBe(layout.glyphs.length);
        expect(ranges[0].from).toBe(0);
        expect(ranges.at(-1)!.to).toBe(layout.glyphs.length - 1);
      }
    }
  });
});

describe("slicing an ayah by words", () => {
  it("keeps the hizb mark with the first word of a quarter's opening ayah", () => {
    const { layout } = layoutOf(2, 26);
    const [mark, first, second] = layout.glyphs;
    expect(glyphsBeforeWord(layout, 1)).toBe(`${mark} ${first}`);
    expect(glyphsBeforeWord(layout, 2)).toBe(`${mark} ${first} ${second}`);
    expect(glyphsFromWord(layout, 1)).toBe([...layout.glyphs.slice(2), layout.marker].join(" "));
  });

  it("keeps the pause mark in 36:52 with the word it follows", () => {
    const { layout, words } = layoutOf(36, 52);
    expect(words).toHaveLength(12);
    expect(layout.glyphs).toHaveLength(13);
    expect(glyphsBeforeWord(layout, 6)).toBe(layout.glyphs.slice(0, 7).join(" "));
    expect(glyphsFromWord(layout, 6)).toBe([...layout.glyphs.slice(7), layout.marker].join(" "));
  });

  it("does not split the one glyph that draws بَعْدَ مَا", () => {
    const { layout, words } = layoutOf(2, 181);
    expect(words.slice(2, 4)).toEqual(["بَعْدَ", "مَا"]);
    expect(glyphsBeforeWord(layout, 3)).toBeNull();
    expect(glyphsFromWord(layout, 3)).toBeNull();
    expect(glyphsBeforeWord(layout, 4)).toBe(layout.glyphs.slice(0, 3).join(" "));
    expect(glyphsFromWord(layout, 4)).toBe([...layout.glyphs.slice(3), layout.marker].join(" "));
  });

  it("returns the whole ayah's glyphs for a prefix of every word", () => {
    const { layout, words } = layoutOf(2, 26);
    expect(glyphsBeforeWord(layout, words.length)).toBe(layout.glyphs.join(" "));
    expect(glyphsBeforeWord(layout, 0)).toBeNull();
    expect(glyphsFromWord(layout, 0)).toBeNull();
  });

  it("returns null for glyph and word counts that match no known layout", () => {
    expect(ayahGlyphs(1, 1, "a b c", 5)).toBeNull();
    expect(ayahGlyphs(1, 1, "a b c d e", 2)).toBeNull();
    // One glyph short is only known for 2:181 and 13:37.
    expect(ayahGlyphs(1, 1, "a b c", 3)).toBeNull();
    expect(ayahGlyphs(1, 1, "", 0)).toBeNull();
  });
});

describe("word table positions and reader glyphs", () => {
  it("maps word table positions past the hizb mark", () => {
    const { layout } = layoutOf(2, 26);
    expect(glyphsOfMushafWord(layout, 1)).toEqual({ from: 0, to: 1 });
    expect(glyphsOfMushafWord(layout, 2)).toEqual({ from: 2, to: 2 });
    // The reader counts the mark as its first glyph: a tap on glyph 2 is word 1.
    expect(mushafWordOfGlyph(layout, 0)).toBe(1);
    expect(mushafWordOfGlyph(layout, 1)).toBe(1);
    expect(mushafWordOfGlyph(layout, 2)).toBe(2);
  });

  it("maps the word tables' own merges in 8:6 and 37:130 to two glyphs", () => {
    const sixth = layoutOf(8, 6).layout;
    expect(sixth.mushafWords).toHaveLength(11);
    expect(glyphsOfMushafWord(sixth, 4)).toEqual({ from: 3, to: 4 });
    expect(mushafWordOfGlyph(sixth, 4)).toBe(4);
    expect(mushafWordOfGlyph(sixth, 5)).toBe(5);
    const elias = layoutOf(37, 130).layout;
    expect(glyphsOfMushafWord(elias, 3)).toEqual({ from: 2, to: 3 });
  });

  it("returns null past the last word", () => {
    const { layout } = layoutOf(1, 1);
    expect(glyphsOfMushafWord(layout, layout.mushafWords.length + 1)).toBeNull();
    expect(mushafWordOfGlyph(layout, layout.glyphs.length)).toBeNull();
  });
});
