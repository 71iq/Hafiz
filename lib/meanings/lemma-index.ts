import type { DatabaseExecutor } from "@/lib/database/types";
import { mushafWordTexts } from "@/lib/mushaf/glyph-words";

/**
 * The lemma index behind generated word-meaning cards (SPEC 3.6): one entry per (lemma, root) pair
 * from `word_roots`, its band by how often it occurs, and the word positions a card may sit on.
 *
 * Positions are word-table positions (the numbering of `word_roots` and `word_translations`), which a
 * card id `word:surah:ayah:position` carries. Both tables count the same words as the text in every
 * ayah, so an English card, which reads `word_translations`, is eligible wherever the word a card
 * highlights (lib/mushaf/glyph-words) holds the `word_roots` stem at that position. `word_irab` is
 * one word behind in ten ayat, such as 5:117 and 23:44, and is not used. An Arabic card also needs a
 * one-word `word_meanings_ar` entry whose word is the highlighted word, letter for letter after
 * spelling differences: a few entries, such as 2:214:4 and 5:117:28, belong to another word.
 *
 * Built once per database and held in memory.
 */

export type MeaningLanguage = "ar" | "en";
export type Band = 0 | 1 | 2 | 3 | 4 | 5;

/** The fewest occurrences for each band, commonest first: band 0 is 70 or more, band 5 is one. */
export const BAND_FLOORS: readonly number[] = [70, 23, 11, 4, 2, 1];
export const MAX_LEVEL = 5;

export type WordPosition = Readonly<{ surah: number; ayah: number; pos: number }>;

export type LemmaEntry = Readonly<{
  /** `lemma|root`: two roots can share one lemma string. */
  key: string;
  lemma: string;
  root: string;
  occurrences: number;
  band: Band;
  /** Eligible positions in mushaf order, per meaning language. */
  positions: Readonly<Record<MeaningLanguage, readonly WordPosition[]>>;
}>;

export type LemmaIndex = Readonly<{
  /** Every pair, commonest first, then by first occurrence. */
  lemmas: readonly LemmaEntry[];
  /** The pair at each word-table position that has a `word_roots` row, eligible or not. */
  lemmaAt: ReadonlyMap<string, LemmaEntry>;
}>;

export function bandOf(occurrences: number): Band {
  const band = BAND_FLOORS.findIndex((floor) => occurrences >= floor);
  return (band === -1 ? MAX_LEVEL : band) as Band;
}

export function positionKey(surah: number, ayah: number, pos: number): string {
  return `${surah}:${ayah}:${pos}`;
}

export function meaningCardIdAt(position: WordPosition): string {
  return `word:${position.surah}:${position.ayah}:${position.pos}`;
}

/** The position a `word:` card id names, or null for another id. */
export function parseMeaningCardId(id: string): WordPosition | null {
  const match = /^word:(\d+):(\d+):(\d+)$/.exec(id);
  return match ? { surah: Number(match[1]), ayah: Number(match[2]), pos: Number(match[3]) } : null;
}

const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/**
 * A word's consonant skeleton: marks and tatweel removed, alef forms and hamza seats unified, and the
 * long vowels dropped, since the Uthmani and standard spellings differ in exactly those letters.
 */
export function wordSkeleton(text: string): string {
  return spelling(text).replace(/[اوي]/g, "");
}

/** Marks and tatweel removed, alef forms and hamza seats unified, bare hamza dropped. */
function spelling(text: string): string {
  return text
    .replace(MARKS, "")
    .replace(/[ٱأإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "");
}

/** Doubled letters joined and spaces removed: Uthmani writes "ٱلَّيْل" where the tables write "اللَّيْل". */
function squashed(text: string): string {
  return text.replace(/\s+/g, "").replace(/(.)\1+/g, "$1");
}

/**
 * Whether two spellings write the same whole word, ignoring the long vowels and hamza seats the
 * Uthmani and standard spellings differ in. A word of only those letters, such as أي or آوى, has no
 * skeleton, so it is compared with them kept.
 */
export function sameWord(a: string, b: string): boolean {
  const skeletonA = squashed(wordSkeleton(a));
  const skeletonB = squashed(wordSkeleton(b));
  if (skeletonA !== "" || skeletonB !== "") return skeletonA === skeletonB;
  const lightA = squashed(spelling(a));
  return lightA !== "" && lightA === squashed(spelling(b));
}

/** Whether a word holds a `word_roots` stem, which leaves out its prefixes and suffixes ("جنود" in "وجنوده"). */
export function holdsStem(word: string, stem: string): boolean {
  const skeleton = squashed(wordSkeleton(stem));
  if (skeleton !== "") return squashed(wordSkeleton(word)).includes(skeleton);
  const light = squashed(spelling(stem));
  return light !== "" && squashed(spelling(word)).includes(light);
}

type WordRow = {
  surah: number;
  ayah: number;
  pos: number;
  lemma: string;
  root: string | null;
  stem: string;
  arWord: string | null;
  arMeaning: string | null;
};

const indexes = new WeakMap<object, Promise<LemmaIndex>>();

/** The index for this database, built on first use. A failed build is not cached. */
export function loadLemmaIndex(db: DatabaseExecutor): Promise<LemmaIndex> {
  const cached = indexes.get(db);
  if (cached) return cached;
  const built = buildLemmaIndex(db).catch((error: unknown) => {
    indexes.delete(db);
    throw error;
  });
  indexes.set(db, built);
  return built;
}

async function buildLemmaIndex(db: DatabaseExecutor): Promise<LemmaIndex> {
  const rows = await db.getAllAsync<WordRow>(
    `SELECT wr.surah, wr.ayah, wr.word_pos AS pos, wr.lemma, wr.root, wr.word_text AS stem,
            wm.word AS arWord, wm.meaning AS arMeaning
       FROM word_roots wr
       LEFT JOIN word_meanings_ar wm ON wm.surah = wr.surah AND wm.ayah = wr.ayah AND wm.word_pos = wr.word_pos
      WHERE wr.lemma IS NOT NULL AND wr.lemma <> ''
      ORDER BY wr.surah, wr.ayah, wr.word_pos`,
  );
  const ayat = new Map(
    (
      await db.getAllAsync<{ surah: number; ayah: number; uthmani: string; qcf2: string }>(
        "SELECT surah, ayah, text_uthmani AS uthmani, text_qcf2 AS qcf2 FROM quran_text",
      )
    ).map((row) => [`${row.surah}:${row.ayah}`, row]),
  );
  // Rows come in mushaf order, so each ayah's highlighted words are worked out once.
  let shownKey = "";
  let shown: string[] = [];
  const shownAt = (surah: number, ayah: number, pos: number): string => {
    const key = `${surah}:${ayah}`;
    if (key !== shownKey) {
      const row = ayat.get(key);
      shownKey = key;
      shown = row ? mushafWordTexts(surah, ayah, row.uthmani ?? "", row.qcf2 ?? "") : [];
    }
    return shown[pos - 1] ?? "";
  };
  type Draft = {
    key: string;
    lemma: string;
    root: string;
    occurrences: number;
    first: number;
    ar: WordPosition[];
    en: WordPosition[];
  };
  const drafts = new Map<string, Draft>();
  const draftAt = new Map<string, Draft>();
  rows.forEach((row, order) => {
    const root = row.root ?? "";
    const key = `${row.lemma}|${root}`;
    let draft = drafts.get(key);
    if (!draft) {
      draft = { key, lemma: row.lemma, root, occurrences: 0, first: order, ar: [], en: [] };
      drafts.set(key, draft);
    }
    draft.occurrences += 1;
    const position = { surah: row.surah, ayah: row.ayah, pos: row.pos };
    draftAt.set(positionKey(row.surah, row.ayah, row.pos), draft);
    const word = shownAt(row.surah, row.ayah, row.pos);
    if (!holdsStem(word, row.stem)) return;
    draft.en.push(position);
    const oneWord = !!row.arWord && row.arWord.trim().split(/\s+/).length === 1 && !!row.arMeaning?.trim();
    if (oneWord && sameWord(word, row.arWord!)) draft.ar.push(position);
  });

  const entries = new Map<Draft, LemmaEntry>();
  for (const draft of drafts.values()) {
    entries.set(draft, {
      key: draft.key,
      lemma: draft.lemma,
      root: draft.root,
      occurrences: draft.occurrences,
      band: bandOf(draft.occurrences),
      positions: { ar: draft.ar, en: draft.en },
    });
  }
  const lemmas = [...drafts.values()]
    .sort((a, b) => b.occurrences - a.occurrences || a.first - b.first)
    .map((draft) => entries.get(draft)!);
  const lemmaAt = new Map<string, LemmaEntry>();
  for (const [key, draft] of draftAt) lemmaAt.set(key, entries.get(draft)!);
  return { lemmas, lemmaAt };
}
