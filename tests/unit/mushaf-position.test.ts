import * as fc from "fast-check";
import {
  estimateAyahLineFraction,
  findJuzForAyah,
  findJuzRangeForAyah,
  juzStartPages,
  positionForMode,
  type MushafIndex,
} from "@/lib/mushaf/position";

type Range = MushafIndex["juzRows"][number];
const index = (juzRows: Range[]): MushafIndex => ({
  juzRows,
  hizbRows: [],
  surahByNumber: new Map(),
  pageByNumber: new Map(),
});
const ranges: Range[] = [
  { juz: 3, surah: 2, ayah_start: 1, ayah_end: 5 },
  { juz: 4, surah: 2, ayah_start: 6, ayah_end: 10 },
  { juz: 5, surah: 3, ayah_start: 1, ayah_end: 3 },
];

describe("Juz range matching and reader fallback", () => {
  it.each([
    { surah: 1, ayah: 1, match: undefined, reader: 1 },
    { surah: 2, ayah: 0, match: undefined, reader: 1 },
    { surah: 2, ayah: 1, match: 3, reader: 3 },
    { surah: 2, ayah: 5, match: 3, reader: 3 },
    { surah: 2, ayah: 6, match: 4, reader: 4 },
    { surah: 2, ayah: 10, match: 4, reader: 4 },
    { surah: 2, ayah: 11, match: undefined, reader: 4 },
    { surah: 3, ayah: 0, match: undefined, reader: 4 },
    { surah: 3, ayah: 1, match: 5, reader: 5 },
    { surah: 3, ayah: 3, match: 5, reader: 5 },
    { surah: 3, ayah: 4, match: undefined, reader: 5 },
    { surah: 4, ayah: 1, match: undefined, reader: 5 },
    { surah: NaN, ayah: 1, match: undefined, reader: 1 },
    { surah: 2, ayah: NaN, match: undefined, reader: 1 },
    { surah: 2, ayah: Infinity, match: undefined, reader: 4 },
  ])("keeps exact and fallback policies at $surah:$ayah", ({ surah, ayah, match, reader }) => {
    expect(findJuzRangeForAyah(ranges, surah, ayah)?.juz).toBe(match);
    expect(findJuzForAyah(index(ranges), surah, ayah)).toBe(reader);
  });

  it("has no range for an empty input while the reader defaults to juz one", () => {
    expect(findJuzRangeForAyah([], 1, 1)).toBeUndefined();
    expect(findJuzForAyah(index([]), 1, 1)).toBe(1);
  });

  it("returns the original first matching row even when ranges overlap", () => {
    const first: Range = { juz: 9, surah: 2, ayah_start: 1, ayah_end: 10 };
    const second: Range = { juz: 4, surah: 2, ayah_start: 5, ayah_end: 8 };
    expect(findJuzRangeForAyah([first, second], 2, 6)).toBe(first);
    expect(findJuzRangeForAyah([second, first], 2, 6)).toBe(second);
    expect(findJuzForAyah(index([first, second]), 2, 6)).toBe(9);
  });

  it("preserves the last preceding input row rather than choosing the largest juz", () => {
    const unsorted = [27, 2, 15].map((juz) => ({ juz, surah: 1, ayah_start: 1, ayah_end: 2 }));
    expect(findJuzForAyah(index(unsorted), 2, 1)).toBe(15);
    expect(findJuzRangeForAyah(unsorted, 2, 1)).toBeUndefined();
  });

  it("does not confuse a matching zero juz with a missing range", () => {
    const zero: Range = { juz: 0, surah: 1, ayah_start: 1, ayah_end: 7 };
    expect(findJuzRangeForAyah([zero], 1, 1)).toBe(zero);
    expect(findJuzForAyah(index([zero]), 1, 1)).toBe(0);
  });

  it("accepts readonly rows without changing their values or ordering", () => {
    const frozen = Object.freeze(ranges.map((range) => Object.freeze({ ...range })));
    expect(findJuzRangeForAyah(frozen, 2, 6)).toBe(frozen[1]);
    expect(frozen).toEqual(ranges);
  });

  it("keeps a first match when later overlapping rows are appended", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 114 }),
        fc.integer({ min: 1, max: 286 }),
        fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 20 }),
        (surah, ayah, laterJuz) => {
          const first: Range = { juz: 7, surah, ayah_start: ayah, ayah_end: ayah };
          const later = laterJuz.map((juz) => ({ juz, surah, ayah_start: 1, ayah_end: 286 }));
          expect(findJuzRangeForAyah([first, ...later], surah, ayah)).toBe(first);
          expect(findJuzForAyah(index([first, ...later]), surah, ayah)).toBe(7);
        },
      ),
      { seed: 170017, numRuns: 500 },
    );
  });
});

describe("reader position helpers on the existing mappings", () => {
  const pages = new Map([
    [1, { page: 1, surah_start: 1, ayah_start: 1, surah_end: 1, ayah_end: 7 }],
    [2, { page: 2, surah_start: 2, ayah_start: 1, surah_end: 2, ayah_end: 5 }],
    [42, { page: 42, surah_start: 2, ayah_start: 253, surah_end: 2, ayah_end: 256 }],
  ]);
  const full: MushafIndex = {
    juzRows: [
      { juz: 1, surah: 1, ayah_start: 1, ayah_end: 7 },
      { juz: 1, surah: 2, ayah_start: 1, ayah_end: 141 },
      { juz: 2, surah: 2, ayah_start: 142, ayah_end: 252 },
      { juz: 3, surah: 2, ayah_start: 253, ayah_end: 286 },
    ],
    hizbRows: [],
    surahByNumber: new Map(),
    pageByNumber: pages,
  };

  it("marks the first page of each juz for the rail's long ticks", () => {
    expect(Array.from(juzStartPages(full)).sort((a, b) => a - b)).toEqual([1, 42]);
  });

  it("converts a saved page to its first ayah in verse view and a saved ayah to its page", () => {
    expect(positionForMode(full, { mode: "page", page: 42 }, "verse")).toEqual({ mode: "verse", surah: 2, ayah: 253 });
    expect(positionForMode(full, { mode: "verse", surah: 2, ayah: 255 }, "page")).toEqual({ mode: "page", page: 42 });
    expect(positionForMode(full, { mode: "page", page: 2 }, "page")).toEqual({ mode: "page", page: 2 });
    expect(positionForMode(full, { mode: "page", page: 500 }, "verse")).toBeNull();
  });

  it("places a surah's first ayah at its header line and other ayahs at their own line", () => {
    const ayahs = [
      { surah: 1, ayah: 7, glyphCount: 10 },
      { surah: 2, ayah: 1, glyphCount: 2 },
      { surah: 2, ayah: 2, glyphCount: 8 },
    ];
    const lines = [
      { line_number: 1, line_type: "ayah", first_word_id: 101, last_word_id: 110, surah_number: null },
      { line_number: 2, line_type: "surah_name", first_word_id: null, last_word_id: null, surah_number: 2 },
      { line_number: 3, line_type: "basmallah", first_word_id: null, last_word_id: null, surah_number: 2 },
      { line_number: 4, line_type: "ayah", first_word_id: 111, last_word_id: 115, surah_number: null },
      { line_number: 5, line_type: "ayah", first_word_id: 116, last_word_id: 120, surah_number: null },
    ];
    expect(estimateAyahLineFraction(ayahs, { surah: 2, ayah: 1 }, lines, 100)).toBeCloseTo(1 / 5);
    expect(estimateAyahLineFraction(ayahs, { surah: 2, ayah: 2 }, lines, 100)).toBeCloseTo(3 / 5);
    expect(estimateAyahLineFraction(ayahs, { surah: 2, ayah: 2 })).toBeCloseTo(12 / 20);
    expect(estimateAyahLineFraction(ayahs, { surah: 9, ayah: 1 }, lines, 100)).toBeNull();
  });
});
