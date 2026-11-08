import * as fc from "fast-check";
import { groupRootResults, groupTextResults, type RootOccurrence, type TextResult } from "@/lib/search/results";

const text = (surah: number, ayah = 1): TextResult => ({
  surah,
  ayah,
  text_uthmani: `fixture ${surah}:${ayah}`,
  text_en: null,
  name_arabic: `سورة ${surah}`,
  name_english: `Surah ${surah}`,
});
const root = (lemma: string, ayah = 1, word = "fallback"): RootOccurrence => ({
  ...text(2, ayah),
  root: "root",
  lemma,
  word_text: word,
  word_pos: ayah,
});

describe("Consecutive text-result grouping", () => {
  it("has no groups for empty results", () => {
    expect(groupTextResults([])).toEqual([]);
  });
  it("keeps a single original row", () => {
    const row = text(2);
    const groups = groupTextResults([row]);
    expect(groups).toEqual([{ surah: 2, nameArabic: "سورة 2", nameEnglish: "Surah 2", results: [row] }]);
    expect(groups[0].results[0]).toBe(row);
  });
  it("retains order within a surah", () => {
    const rows = [text(2, 7), text(2, 1), text(2, 3)];
    expect(groupTextResults(rows)[0].results).toEqual(rows);
  });
  it("starts a new group at a surah change", () => {
    const rows = [text(2), text(2, 2), text(3)];
    const groups = groupTextResults(rows);
    expect(groups.map((g) => [g.surah, g.results.length])).toEqual([
      [2, 2],
      [3, 1],
    ]);
  });
  it("keeps nonconsecutive repeated surahs separate", () => {
    const rows = [text(2), text(3), text(2, 2)];
    expect(groupTextResults(rows).map((g) => g.surah)).toEqual([2, 3, 2]);
  });
  it("uses first-row metadata for each consecutive group", () => {
    const first = text(2);
    const second = { ...text(2, 2), name_arabic: "different", name_english: "different" };
    expect(groupTextResults([first, second])[0]).toMatchObject({
      nameArabic: first.name_arabic,
      nameEnglish: first.name_english,
    });
  });
  it("retains repeated row references rather than deduplicating", () => {
    const row = text(2);
    const groups = groupTextResults([row, row]);
    expect(groups[0].results).toEqual([row, row]);
  });
  it("does not alter readonly input rows or array order", () => {
    const rows = Object.freeze([Object.freeze(text(3)), Object.freeze(text(2))]);
    const groups = groupTextResults(rows);
    groups[0].results.pop();
    expect(rows).toHaveLength(2);
    expect(rows[0].surah).toBe(3);
  });
  it("conserves row identities and consecutive-group boundaries", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 114 }), { maxLength: 50 }), (surahs) => {
        const rows = surahs.map((surah, i) => Object.freeze(text(surah, i + 1)));
        const groups = groupTextResults(Object.freeze(rows));
        const flattened = groups.flatMap((g) => g.results);
        expect(flattened).toHaveLength(rows.length);
        flattened.forEach((row, i) => expect(row).toBe(rows[i]));
        expect(groups).toHaveLength(surahs.filter((surah, i) => i === 0 || surah !== surahs[i - 1]).length);
        groups.forEach((group, i) => {
          expect(group.results.every((row) => row.surah === group.surah)).toBe(true);
          if (i > 0) expect(group.surah).not.toBe(groups[i - 1].surah);
          expect(group.nameArabic).toBe(group.results[0].name_arabic);
          expect(group.nameEnglish).toBe(group.results[0].name_english);
        });
      }),
      { seed: 190019, numRuns: 500 },
    );
  });
});

describe("Root occurrence grouping", () => {
  it("has no groups for empty results", () => {
    expect(groupRootResults([])).toEqual([]);
  });
  it("retains the original occurrence", () => {
    const row = root("lemma");
    expect(groupRootResults([row])).toEqual([{ lemma: "lemma", occurrences: [row] }]);
    expect(groupRootResults([row])[0].occurrences[0]).toBe(row);
  });
  it("groups equal lemmas even with different roots or words", () => {
    const a = root("lemma");
    const b = { ...root("lemma", 2, "other word"), root: "other root" };
    expect(groupRootResults([a, b])).toEqual([{ lemma: "lemma", occurrences: [a, b] }]);
  });
  it("uses word text only when lemma is empty", () => {
    const a = root("", 1, "word");
    const b = root("word", 2, "other");
    expect(groupRootResults([a, b])).toEqual([{ lemma: "word", occurrences: [a, b] }]);
  });
  it("preserves an empty lemma and word key", () => {
    const row = root("", 1, "");
    expect(groupRootResults([row])[0].lemma).toBe("");
  });
  it("treats whitespace and Arabic diacritics as significant keys", () => {
    expect(groupRootResults([root("رحم"), root("رَحِمَ", 2), root(" رحم", 3)]).map((g) => g.lemma)).toEqual([
      "رحم",
      "رَحِمَ",
      " رحم",
    ]);
  });
  it("supports object-like keys without property collisions", () => {
    expect(
      groupRootResults([root("__proto__"), root("constructor", 2), root("toString", 3)]).map((g) => g.lemma),
    ).toEqual(["__proto__", "constructor", "toString"]);
  });
  it("orders groups by descending occurrence count", () => {
    expect(
      groupRootResults([
        root("one"),
        root("three", 2),
        root("two", 3),
        root("three", 4),
        root("two", 5),
        root("three", 6),
      ]).map((g) => [g.lemma, g.occurrences.length]),
    ).toEqual([
      ["three", 3],
      ["two", 2],
      ["one", 1],
    ]);
  });
  it("retains first-key insertion order when counts tie", () => {
    expect(
      groupRootResults([root("second"), root("first", 2), root("first", 3), root("second", 4)]).map((g) => g.lemma),
    ).toEqual(["second", "first"]);
  });
  it("preserves occurrence input order within each group", () => {
    const rows = [root("a", 9), root("b", 1), root("a", 3)];
    expect(groupRootResults(rows)[0].occurrences).toEqual([rows[0], rows[2]]);
  });
  it("does not deduplicate repeated positions or row references", () => {
    const row = root("a");
    const group = groupRootResults([row, row])[0];
    expect(group.occurrences).toHaveLength(2);
    expect(group.occurrences[0]).toBe(row);
    expect(group.occurrences[1]).toBe(row);
  });
  it("does not change readonly inputs and returns separate group arrays", () => {
    const rows = Object.freeze([Object.freeze(root("a")), Object.freeze(root("b", 2))]);
    const groups = groupRootResults(rows);
    groups[0].occurrences.pop();
    expect(rows).toHaveLength(2);
    expect(rows[0].lemma).toBe("a");
  });
  it("conserves rows, per-key order and stable descending group order", () => {
    const key = fc.constantFrom("", "a", "b", "رحم", "رَحِمَ", "__proto__", "constructor", " ");
    fc.assert(
      fc.property(fc.array(fc.tuple(key, key), { maxLength: 50 }), (entries) => {
        const rows = entries.map(([lemma, word], i) => Object.freeze(root(lemma, i + 1, word)));
        const groups = groupRootResults(Object.freeze(rows));
        expect(groups.reduce((count, group) => count + group.occurrences.length, 0)).toBe(rows.length);
        expect(new Set(groups.map((group) => group.lemma)).size).toBe(groups.length);
        groups.forEach((group, i) => {
          const expected = rows.filter((row) => (row.lemma || row.word_text) === group.lemma);
          expect(group.occurrences).toHaveLength(expected.length);
          group.occurrences.forEach((row, j) => expect(row).toBe(expected[j]));
          if (i > 0) {
            const previous = groups[i - 1];
            expect(previous.occurrences.length).toBeGreaterThanOrEqual(group.occurrences.length);
            if (previous.occurrences.length === group.occurrences.length) {
              expect(rows.findIndex((row) => (row.lemma || row.word_text) === previous.lemma)).toBeLessThan(
                rows.findIndex((row) => (row.lemma || row.word_text) === group.lemma),
              );
            }
          }
        });
      }),
      { seed: 190020, numRuns: 500 },
    );
  });
});
