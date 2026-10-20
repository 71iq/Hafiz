import * as fc from "fast-check";
import {
  clampPage,
  fitTypographyToPageWidth,
  computeLineWidth,
  computeVerticalLineMaxWidth,
  getRenderedLineCount,
  buildLayoutOffsets,
} from "@/lib/mushaf/page-layout";

type Geometry = Parameters<typeof buildLayoutOffsets>[0][number];
const layout = (...types: string[]): Geometry => ({ lineLayout: types.map((line_type) => ({ line_type })) });
const options = { numRuns: 500, seed: 170020 };

describe("Mushaf geometry contracts", () => {
  it.each([
    { value: undefined, expected: 1 },
    { value: NaN, expected: 1 },
    { value: Infinity, expected: 1 },
    { value: -Infinity, expected: 1 },
    { value: -4, expected: 1 },
    { value: 0, expected: 1 },
    { value: 1.49, expected: 1 },
    { value: 1.5, expected: 2 },
    { value: 603.6, expected: 604 },
    { value: 999, expected: 604 },
  ])("clamps page $value to $expected", ({ value, expected }) => {
    expect(clampPage(value)).toBe(expected);
  });
  it("keeps the existing custom and empty page-list bounds", () => {
    expect(clampPage(8, 4)).toBe(4);
    expect(clampPage(1, 0)).toBe(1);
  });
  it.each([
    { font: 30, line: 40, width: 0, scale: 10, expected: { fontSize: 30, lineHeight: 40 } },
    { font: 0, line: 40, width: 100, scale: 10, expected: { fontSize: 0, lineHeight: 40 } },
    { font: 30, line: 50, width: 400, scale: 10, expected: { fontSize: 30, lineHeight: 50 } },
    { font: 40, line: 60, width: 400, scale: 10, expected: { fontSize: 40, lineHeight: 60 } },
    { font: 80, line: 120, width: 640, scale: 10, expected: { fontSize: 64, lineHeight: 100 } },
    { font: 80, line: 180, width: 640, scale: 10, expected: { fontSize: 64, lineHeight: 144 } },
  ])("fits font $font/$line to width $width", ({ font, line, width, scale, expected }) => {
    expect(fitTypographyToPageWidth(font, line, width, scale)).toEqual(expected);
  });
  it.each([
    { font: 20, width: -1, max: 600, scale: 10, fill: true, expected: 0 },
    { font: 20, width: 500, max: 600, scale: 10, fill: false, expected: 200 },
    { font: 20, width: 500, max: 600, scale: 10, fill: true, expected: 500 },
    { font: 20, width: 500, max: 300, scale: 10, fill: true, expected: 300 },
    { font: 80, width: 500, max: 600, scale: 10, fill: false, expected: 500 },
    { font: -1, width: 500, max: 600, scale: 10, fill: false, expected: 0 },
    { font: 20, width: 500, max: -1, scale: 10, fill: false, expected: 0 },
  ])("bounds line width for $font/$width/$max/$fill", ({ font, width, max, scale, fill, expected }) => {
    expect(computeLineWidth(font, width, max, scale, fill)).toBe(expected);
  });
  it.each([
    { font: 20, width: 390, compact: true, expected: 390 },
    { font: 20, width: -1, compact: true, expected: -1 },
    { font: 40, width: 1000, compact: false, expected: 680 },
    { font: 100, width: 1200, compact: false, expected: 1000 },
    { font: 40, width: 500, compact: false, expected: 436 },
    { font: 40, width: 50, compact: false, expected: 0 },
  ])("preserves vertical width for $font/$width/$compact", ({ font, width, compact, expected }) => {
    expect(computeVerticalLineMaxWidth(font, width, compact, 10)).toBe(expected);
  });
  it.each([
    { name: "missing lines", page: {}, expected: 15 },
    { name: "empty lines", page: layout(), expected: 15 },
    { name: "ordinary lines", page: layout("surah_name", "basmallah", "ayah"), expected: 3 },
    {
      name: "canonical layout without word override",
      page: { ...layout("ayah"), usePageWords: false, pageWordLineNumbers: [1, 2] },
      expected: 1,
    },
    { name: "word mode with no line-number list", page: { ...layout("ayah"), usePageWords: true }, expected: 1 },
    {
      name: "empty word list with structural lines",
      page: { ...layout("surah_name", "ayah"), usePageWords: true, pageWordLineNumbers: [] },
      expected: 1,
    },
    {
      name: "unknown structural type is retained",
      page: { ...layout("surah_name", "basmallah", "ayah", "other"), usePageWords: true, pageWordLineNumbers: [1, 3] },
      expected: 5,
    },
  ])("counts $name", ({ page, expected }) => {
    expect(getRenderedLineCount(page)).toBe(expected);
  });
  it("has no offsets for no pages", () => {
    expect(buildLayoutOffsets([], 20, 2, 3)).toEqual({ heights: [], offsets: [] });
  });
  it("uses fifteen fallback lines and no trailing separator on the last page", () => {
    expect(buildLayoutOffsets([{}], 10, 2, 3)).toEqual({ heights: [155], offsets: [0] });
    expect(buildLayoutOffsets([{}, {}], 10, 2, 3)).toEqual({ heights: [203, 155], offsets: [0, 203] });
  });
  it("includes structural heights, padding, line multipliers and inter-page separators", () => {
    expect(buildLayoutOffsets([layout("surah_name", "basmallah", "ayah"), {}], 20, 2, 3, 2)).toEqual({
      heights: [186, 605],
      offsets: [0, 186],
    });
  });
  it("uses page-word line count instead of canonical ayah-line count", () => {
    const page = {
      ...layout("surah_name", "basmallah", "ayah", "ayah"),
      usePageWords: true,
      pageWordLineNumbers: [1, 3, 4],
    };
    expect(buildLayoutOffsets([page], 20, 2, 3, 2)).toEqual({ heights: [218], offsets: [0] });
  });
  it("retains zero word lines while rendering structural rows", () => {
    const page = { ...layout("surah_name", "basmallah", "ayah"), usePageWords: true, pageWordLineNumbers: [] };
    expect(buildLayoutOffsets([page], 20, 2, 3, 2)).toEqual({ heights: [98], offsets: [0] });
  });
  it("keeps fractional basmallah heights and counts unknown rows as ordinary height", () => {
    const result = buildLayoutOffsets([layout("basmallah", "other")], 21, 0, 0, 1.5);
    expect(result.heights[0]).toBeCloseTo(21 * 0.85 + 8 + 21 * 1.5, 12);
  });
  it("clamping is integer-bounded and idempotent across numeric inputs", () => {
    fc.assert(
      fc.property(fc.double(), fc.integer({ min: 1, max: 604 }), (value, max) => {
        const result = clampPage(value, max);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(max);
        expect(clampPage(result, max)).toBe(result);
      }),
      options,
    );
  });
  it("font fitting never enlarges a positive font or exceeds available width", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 1, max: 50 }),
        (font, width, scale) => {
          const result = fitTypographyToPageWidth(font, font * 2, width, scale);
          expect(result.fontSize).toBeGreaterThan(0);
          expect(result.fontSize).toBeLessThanOrEqual(font);
          expect(result.fontSize * scale).toBeLessThanOrEqual(width + 1e-8);
          if (result.fontSize < font)
            expect(result.lineHeight).toBeGreaterThanOrEqual(Math.ceil(result.fontSize * 1.55));
        },
      ),
      options,
    );
  });
  it("appending a page retains prefix offsets and adds exactly one separator", () => {
    const page = fc.record({
      lineLayout: fc.array(fc.record({ line_type: fc.constantFrom("ayah", "surah_name", "basmallah", "other") }), {
        maxLength: 8,
      }),
      usePageWords: fc.boolean(),
      pageWordLineNumbers: fc.array(fc.integer({ min: 1, max: 15 }), { maxLength: 8 }),
    });
    fc.assert(
      fc.property(
        fc.array(page, { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 160 }),
        (pages, height) => {
          const old = buildLayoutOffsets(pages, height, 3, 5);
          const next = buildLayoutOffsets([...pages, {}], height, 3, 5);
          expect(next.offsets.slice(0, pages.length)).toEqual(old.offsets);
          expect(next.heights.slice(0, -2)).toEqual(old.heights.slice(0, -1));
          expect(next.heights[pages.length - 1]).toBeCloseTo(old.heights[pages.length - 1] + 48, 9);
          expect(next.offsets[pages.length]).toBeCloseTo(old.heights.reduce((sum, value) => sum + value, 0) + 48, 9);
        },
      ),
      options,
    );
  });
});
