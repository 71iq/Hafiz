import type { DatabaseExecutor } from "@/lib/database/types";

/**
 * The lemma index behind generated word-meaning cards (SPEC 3.6): one entry per (lemma, root) pair
 * from `word_roots`, its band by how often it occurs, and the word positions a card may sit on.
 *
 * Positions are word-table positions (the numbering of `word_roots` and `word_translations`), which a
 * card id `word:surah:ayah:position` carries. A position is eligible when it has its own `word_roots`
 * row whose word, reduced to its consonant skeleton, appears inside the `word_irab` word at the same
 * position: that is the check that the two numberings agree there. It drops 88 positions in 15 ayat
 * where they do not. An Arabic card also needs a one-word entry in `word_meanings_ar`, since a card
 * highlights one word; an English card reads `word_translations`, which covers every word.
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
  return text
    .replace(MARKS, "")
    .replace(/[ٱأإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .replace(/[اوي]/g, "");
}

type WordRow = {
  surah: number;
  ayah: number;
  pos: number;
  lemma: string;
  root: string | null;
  text: string;
  irab: string | null;
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
    `SELECT wr.surah, wr.ayah, wr.word_pos AS pos, wr.lemma, wr.root, wr.word_text AS text,
            wi.arabic_word AS irab, wm.word AS arWord, wm.meaning AS arMeaning
       FROM word_roots wr
       LEFT JOIN word_irab wi ON wi.surah = wr.surah AND wi.ayah = wr.ayah AND wi.word_pos = wr.word_pos
       LEFT JOIN word_meanings_ar wm ON wm.surah = wr.surah AND wm.ayah = wr.ayah AND wm.word_pos = wr.word_pos
      WHERE wr.lemma IS NOT NULL AND wr.lemma <> ''
      ORDER BY wr.surah, wr.ayah, wr.word_pos`,
  );
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
    const aligned = row.irab !== null && wordSkeleton(row.irab).includes(wordSkeleton(row.text));
    if (!aligned) return;
    draft.en.push(position);
    const oneWord = !!row.arWord && row.arWord.trim().split(/\s+/).length === 1 && !!row.arMeaning?.trim();
    if (oneWord) draft.ar.push(position);
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
