import { z } from "zod";

/**
 * Importer for the QUL "Mutashabihat ul Quran" export (spec 4.7.1). The data is NOT bundled: its
 * licence is unclear, so it waits for written permission from Tarteel (D-1, D-4). This turns the
 * export into rows for mutashabih_phrases and mutashabih_occurrences, so adding the file later is
 * the only step left. Word positions are QUL's 1-based word positions, which match Hafiz's
 * surah:ayah:word locations.
 */

const range = z.tuple([z.number().int(), z.number().int()]);
const verseKey = z.string().regex(/^\d{1,3}:\d{1,3}$/);

const phraseSchema = z.object({
  surahs: z.number().int().optional(),
  ayahs: z.number().int().optional(),
  count: z.number().int().optional(),
  source: z.object({ key: verseKey, from: z.number().int(), to: z.number().int() }),
  ayah: z.record(verseKey, z.array(range)),
});

const qulPhrasesSchema = z.record(z.string().regex(/^\d+$/), phraseSchema);

export type PhraseRow = Readonly<{ id: number; lengthWords: number; sourceKey: string; sourceFrom: number; sourceTo: number; ayahs: number; count: number }>;
export type OccurrenceRow = Readonly<{ phraseId: number; surah: number; ayah: number; wordFrom: number; wordTo: number }>;
export type ImportIssue = Readonly<{ phraseId: number; key: string; reason: "out_of_range" | "unknown_ayah" | "reversed" }>;

export type QulImport = Readonly<{ phrases: PhraseRow[]; occurrences: OccurrenceRow[]; issues: ImportIssue[] }>;

function splitKey(key: string): { surah: number; ayah: number } {
  const [surah, ayah] = key.split(":").map(Number);
  return { surah, ayah };
}

/**
 * MUT-08 recompute count and ayahs from the ayah map; MUT-09 drop duplicate ranges within an ayah;
 * MUT-10 add the source ayah to its own phrase when missing; MUT-11 reject ranges outside the
 * ayah's word count (or reversed), reporting each one.
 */
export function importQulPhrases(rawPhrases: unknown, wordCount: (key: string) => number | null): QulImport {
  const phrases = qulPhrasesSchema.parse(rawPhrases);
  const phraseRows: PhraseRow[] = [];
  const occurrences: OccurrenceRow[] = [];
  const issues: ImportIssue[] = [];
  for (const [idText, phrase] of Object.entries(phrases).sort(([a], [b]) => Number(a) - Number(b))) {
    const id = Number(idText);
    const ranges = new Map<string, [number, number][]>();
    for (const [key, list] of Object.entries(phrase.ayah)) ranges.set(key, [...list]);
    const sourceRanges = ranges.get(phrase.source.key) ?? [];
    if (!sourceRanges.some(([from, to]) => from === phrase.source.from && to === phrase.source.to)) {
      ranges.set(phrase.source.key, [...sourceRanges, [phrase.source.from, phrase.source.to]]);
    }
    let count = 0;
    let ayahs = 0;
    for (const [key, list] of [...ranges.entries()].sort(([a], [b]) => {
      const left = splitKey(a);
      const right = splitKey(b);
      return left.surah - right.surah || left.ayah - right.ayah;
    })) {
      const words = wordCount(key);
      if (words === null) {
        issues.push({ phraseId: id, key, reason: "unknown_ayah" });
        continue;
      }
      const seen = new Set<string>();
      let kept = 0;
      for (const [from, to] of list) {
        if (from > to) {
          issues.push({ phraseId: id, key, reason: "reversed" });
          continue;
        }
        if (from < 1 || to > words) {
          issues.push({ phraseId: id, key, reason: "out_of_range" });
          continue;
        }
        const rangeKey = `${from}-${to}`;
        if (seen.has(rangeKey)) continue;
        seen.add(rangeKey);
        const { surah, ayah } = splitKey(key);
        occurrences.push({ phraseId: id, surah, ayah, wordFrom: from, wordTo: to });
        kept += 1;
      }
      if (kept > 0) {
        ayahs += 1;
        count += kept;
      }
    }
    phraseRows.push({
      id,
      lengthWords: phrase.source.to - phrase.source.from + 1,
      sourceKey: phrase.source.key,
      sourceFrom: phrase.source.from,
      sourceTo: phrase.source.to,
      ayahs,
      count,
    });
  }
  return { phrases: phraseRows, occurrences, issues };
}
