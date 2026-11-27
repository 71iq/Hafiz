import { readFileSync } from "node:fs";
import path from "node:path";
import excludedCardsFile from "@/assets/data/mutashabihat/nourquran_hafiz_excluded_cards.json";
import { EXCLUDED_SIMILAR_CARD_IDS, isExcludedSimilarCard } from "@/lib/fsrs/similar-card-exclusions";
import { excludedSimilarCards, sameAnswerAsTail } from "@/lib/fsrs/similar-card-text";

const DATA = path.join(__dirname, "..", "..", "assets", "data");

/**
 * The committed exclusion list is what scripts/build-similar-card-exclusions.mjs computes from the
 * shipped rows and Quran text. When the rows change, rerun the script.
 */
test("the excluded similar-verse cards are the ones the shipped rows give", () => {
  const rowsFile = JSON.parse(readFileSync(path.join(DATA, "mutashabihat", "nourquran_hafiz_rows.json"), "utf8"));
  const quranText: { surah: number; ayah: number; text_uthmani: string; text_clean: string }[] = JSON.parse(
    readFileSync(path.join(DATA, "quran-data.json"), "utf8"),
  ).tables.quran_text;
  const ayat = new Map(
    quranText.map((row) => [`${row.surah}:${row.ayah}`, { textUthmani: row.text_uthmani, textClean: row.text_clean }]),
  );
  const rows = {
    groups: rowsFile.groups.map(([id, kind, cue]: string[]) => ({ id, kind, cue })),
    refs: rowsFile.refs.map(([groupId, sortOrder, surah, ayah, , tail5, preText, similarText]: any[]) => ({
      groupId,
      sortOrder,
      surah,
      ayah,
      tail5,
      preText,
      similarText,
    })),
  };

  const expected = excludedSimilarCards(rows, (surah, ayah) => ayat.get(`${surah}:${ayah}`)).map((card) => card.id);
  expect(excludedCardsFile.cards).toEqual(expected);
  expect([...excludedCardsFile.cards].sort()).toEqual(excludedCardsFile.cards);
  expect(EXCLUDED_SIMILAR_CARD_IDS.size).toBe(expected.length);
  for (const id of expected) expect(isExcludedSimilarCard(id)).toBe(true);
});

test("a similar-verse answer one word longer or shorter than the tail's is the same answer", () => {
  // Both answers end the same ayah, so only their word counts differ.
  expect(sameAnswerAsTail(3, 3)).toBe(true);
  expect(sameAnswerAsTail(3, 4)).toBe(true);
  expect(sameAnswerAsTail(5, 4)).toBe(true);
  expect(sameAnswerAsTail(4, 2)).toBe(false);
  expect(sameAnswerAsTail(2, 4)).toBe(false);
});
