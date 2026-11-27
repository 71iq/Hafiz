import { readFileSync } from "node:fs";
import path from "node:path";
import {
  mutashabihatFront,
  normalizeArabicWords,
  splitQuranWords,
  uthmaniIndexOfPlainWords,
} from "@/lib/fsrs/similar-card-text";

const DATA = path.join(__dirname, "..", "..", "assets", "data");
const quranText: { surah: number; ayah: number; text_uthmani: string; text_clean: string }[] = JSON.parse(
  readFileSync(path.join(DATA, "quran-data.json"), "utf8"),
).tables.quran_text;
const ayat = new Map(quranText.map((row) => [`${row.surah}:${row.ayah}`, row]));

/**
 * The plain text writes a vocative apart from the next word ("يَا أَيُّهَا"), the Uthmani text as one
 * ("يَٰٓأَيُّهَا"), in 363 ayat. Every plain word must land on an Uthmani word, in order, and the last
 * on the last, or a front counted in plain words shows the wrong Uthmani words.
 */
test("every ayah's plain words map onto its Uthmani words, in order and to the last one", () => {
  const wrong: string[] = [];
  for (const row of quranText) {
    const plain = normalizeArabicWords(row.text_clean);
    const index = uthmaniIndexOfPlainWords(plain, row.surah, row.ayah);
    const uthmaniCount = splitQuranWords(row.text_uthmani).length;
    const ordered = index.every((value, i) => i === 0 || value === index[i - 1] || value === index[i - 1] + 1);
    if (index.length !== plain.length || index[0] !== 0 || index.at(-1) !== uthmaniCount - 1 || !ordered) {
      wrong.push(`${row.surah}:${row.ayah}`);
    }
  }
  expect(wrong).toEqual([]);
});

const front = (key: string, preText: string | null, similarText: string) => {
  const row = ayat.get(key)!;
  return {
    sortOrder: 0,
    surah: row.surah,
    ayah: row.ayah,
    textUthmani: row.text_uthmani,
    textClean: row.text_clean,
    preText,
    similarText,
  };
};

test("a front after a vocative ends with the similar words, not one Uthmani word later", () => {
  // 5:2 and 5:8 part after "شَنَـَٔانُ قَوْمٍ": "أَن صَدُّوكُمْ" against "عَلَىٰٓ أَلَّا تَعْدِلُوا۟".
  const similar = "وَلَا يَجْرِمَنَّكُمْ شَنَـَٔانُ قَوْمٍ";
  const first = { ...front("5:2", null, similar), sortOrder: 0 };
  const second = { ...front("5:8", null, similar), sortOrder: 1 };
  for (const ref of [first, second]) {
    const { prefixWordCount } = mutashabihatFront(ref, [first, second]);
    expect(splitQuranWords(ref.textUthmani)[prefixWordCount - 1]).toBe("قَوْمٍ");
  }
});
