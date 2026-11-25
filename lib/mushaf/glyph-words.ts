/**
 * Which page-font glyphs of an ayah draw which words.
 *
 * `text_qcf2` holds the ayah's page-font glyphs, then its end marker. Three numberings meet on it:
 * - glyphs, as the reader and the page layout count them, marks included;
 * - mushaf words, as the word tables (`word_translations`, `word_roots`, `word_meanings_ar`,
 *   `word_irab`) and meaning card ids count them: no marks, and "بَعْدَ مَا" as one word;
 * - Unicode words of `text_uthmani`, split on spaces, where "بَعْدَ مَا" is two.
 *
 * Drawing every glyph of the 6,236 ayat in its page font gave exactly four layouts:
 * - one glyph per word: 6,038 ayat;
 * - glyph 0 is the hizb-quarter mark ۞, then one glyph per word: 195 ayat;
 * - 36:52, where glyph 6 is a pause mark over the end of "مَّرْقَدِنَا";
 * - 2:181 and 13:37, where one glyph draws "بَعْدَ مَا", Unicode words 3 and 4, and 8 and 9.
 * An ayah that matches none of them returns null, and callers keep their Unicode fallback.
 *
 * The word tables follow the glyphs except in 8:6 and 37:130, where they count "بَعْدَ مَا" and
 * "إِلْ يَاسِينَ" as one word that the page font draws as two glyphs.
 */

/** Ayat whose extra mark glyph is not glyph 0, by "surah:ayah": the glyph index of the mark. */
const MARK_GLYPH: Readonly<Record<string, number>> = { "36:52": 6 };
/** Ayat where one glyph draws two Unicode words, by "surah:ayah": the first word's index. */
const MERGED_WORDS: Readonly<Record<string, number>> = { "2:181": 2, "13:37": 7 };
/** Ayat where the word tables count two glyphs as one word, by "surah:ayah": the first glyph's word index. */
const TABLE_MERGED_WORDS: Readonly<Record<string, number>> = { "8:6": 3, "37:130": 2 };

/** Join two neighbouring ranges into one mushaf word, for the word tables' own merges. */
function withTableMerge(ranges: readonly GlyphRange[], key: string): readonly GlyphRange[] {
  const merged = TABLE_MERGED_WORDS[key];
  if (merged === undefined || merged + 1 >= ranges.length) return ranges;
  return [
    ...ranges.slice(0, merged),
    { from: ranges[merged].from, to: ranges[merged + 1].to },
    ...ranges.slice(merged + 2),
  ];
}

export type GlyphRange = Readonly<{ from: number; to: number }>;

export type AyahGlyphs = Readonly<{
  /** The page-font glyphs without the end marker. */
  glyphs: readonly string[];
  /** The end-of-ayah marker glyph. */
  marker: string;
  /** For each Unicode word of `text_uthmani`, the glyphs that draw it, inclusive. */
  unicodeWords: readonly GlyphRange[];
  /** For each mushaf word (position 1 is index 0), the glyphs that draw it, inclusive. */
  mushafWords: readonly GlyphRange[];
}>;

function splitGlyphTokens(textQcf2: string): string[] {
  return textQcf2.split(/\s+/).filter(Boolean);
}

/** The Unicode words of `text_uthmani`, split as the card prompts split it. */
function uthmaniWords(textUthmani: string): string[] {
  return textUthmani
    .replace(/[۞۩﴿﴾0-9٠-٩]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The number of Unicode words in `text_uthmani`, split as the card prompts split it. */
export function uthmaniWordCount(textUthmani: string): number {
  return uthmaniWords(textUthmani).length;
}

/**
 * The Unicode text of each mushaf word of an ayah (position 1 is index 0): the words a card
 * highlights by word-table position, as `Qcf2AyahText` maps them. With no known layout, position n is
 * Unicode word n, as that component's fallback draws it.
 */
export function mushafWordTexts(surah: number, ayah: number, textUthmani: string, textQcf2: string): string[] {
  const words = uthmaniWords(textUthmani);
  const layout = ayahGlyphs(surah, ayah, textQcf2, words.length);
  if (!layout) return words;
  return layout.mushafWords.map((range) =>
    words
      .filter((_, i) => layout.unicodeWords[i].from >= range.from && layout.unicodeWords[i].to <= range.to)
      .join(" "),
  );
}

/**
 * The glyph layout of one ayah, or null when its glyph and word counts match none of the known
 * layouts. `unicodeWordCount` is the number of words in `text_uthmani` split on spaces.
 */
export function ayahGlyphs(surah: number, ayah: number, textQcf2: string, unicodeWordCount: number): AyahGlyphs | null {
  const tokens = splitGlyphTokens(textQcf2);
  if (tokens.length < 2 || unicodeWordCount < 1) return null;
  const glyphs = tokens.slice(0, -1);
  const marker = tokens[tokens.length - 1];
  const key = `${surah}:${ayah}`;
  const ranges: GlyphRange[] = [];

  if (glyphs.length === unicodeWordCount) {
    for (let i = 0; i < unicodeWordCount; i++) ranges.push({ from: i, to: i });
    return { glyphs, marker, unicodeWords: ranges, mushafWords: withTableMerge(ranges, key) };
  }

  if (glyphs.length === unicodeWordCount + 1) {
    // A mark at glyph 0 opens the first word; a mark inside the ayah sits over the end of the word before it.
    const mark = MARK_GLYPH[key] ?? 0;
    for (let i = 0; i < unicodeWordCount; i++) {
      const glyph = i < mark ? i : i + 1;
      const from = mark === 0 && i === 0 ? 0 : glyph;
      const to = mark > 0 && glyph === mark - 1 ? mark : glyph;
      ranges.push({ from, to });
    }
    return { glyphs, marker, unicodeWords: ranges, mushafWords: withTableMerge(ranges, key) };
  }

  const merged = MERGED_WORDS[key];
  if (glyphs.length === unicodeWordCount - 1 && merged !== undefined && merged + 1 < unicodeWordCount) {
    for (let i = 0; i < unicodeWordCount; i++) {
      const glyph = i <= merged ? i : i - 1;
      ranges.push({ from: glyph, to: glyph });
    }
    const mushafWords = glyphs.map((_, glyph) => ({ from: glyph, to: glyph }));
    return { glyphs, marker, unicodeWords: ranges, mushafWords };
  }

  return null;
}

/**
 * The glyphs that draw the first `wordCount` Unicode words, or null when that boundary falls inside
 * one glyph ("بَعْدَ" without "مَا").
 */
export function glyphsBeforeWord(layout: AyahGlyphs, wordCount: number): string | null {
  const words = layout.unicodeWords;
  if (wordCount <= 0 || wordCount > words.length) return null;
  const last = words[wordCount - 1];
  if (wordCount < words.length && words[wordCount].from <= last.to) return null;
  return layout.glyphs.slice(0, last.to + 1).join(" ");
}

/**
 * The glyphs from Unicode word `wordIndex` to the end of the ayah, with the end marker, or null
 * when that boundary falls inside one glyph.
 */
export function glyphsFromWord(layout: AyahGlyphs, wordIndex: number): string | null {
  const words = layout.unicodeWords;
  if (wordIndex <= 0 || wordIndex >= words.length) return null;
  if (words[wordIndex].from <= words[wordIndex - 1].to) return null;
  return [...layout.glyphs.slice(words[wordIndex].from), layout.marker].join(" ");
}

/** The glyph indexes that draw mushaf word `position` (1-based, as in the word tables), or null. */
export function glyphsOfMushafWord(layout: AyahGlyphs, position: number): GlyphRange | null {
  return layout.mushafWords[position - 1] ?? null;
}

/**
 * The Unicode word of `text_uthmani` (1-based, split on spaces) whose glyphs include a glyph counted
 * the way the reader counts, marks included: the first of two words one glyph draws. Null for the end
 * marker or out of range.
 */
export function unicodeWordOfGlyph(layout: AyahGlyphs, glyphIndex: number): number | null {
  const index = layout.unicodeWords.findIndex((range) => glyphIndex >= range.from && glyphIndex <= range.to);
  return index < 0 ? null : index + 1;
}

/**
 * The mushaf word position (1-based, as in the word tables) that a glyph belongs to, for a glyph
 * index counted the way the reader counts, marks included. Null for the end marker or out of range.
 */
export function mushafWordOfGlyph(layout: AyahGlyphs, glyphIndex: number): number | null {
  const index = layout.mushafWords.findIndex((range) => glyphIndex >= range.from && glyphIndex <= range.to);
  return index < 0 ? null : index + 1;
}
