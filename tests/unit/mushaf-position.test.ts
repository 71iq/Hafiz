import * as fc from "fast-check";
import { findJuzForAyah, findJuzRangeForAyah, type MushafIndex } from "@/lib/mushaf/position";

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
