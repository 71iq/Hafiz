import * as fc from "fast-check";
import { formatStepPreview, formatStepText, parseStepText, validateStepText } from "@/lib/fsrs/review-step-text";
import type { SchedulerStep } from "@/lib/fsrs/types";

const fallback: SchedulerStep[] = ["10m", "1d"];

describe("review step-text codec", () => {
  it("formats canonical steps and both Arabic singular/plural units", () => {
    const steps: SchedulerStep[] = ["1m", "2m", "1h", "2h", "1d", "2d", "1.5h"];
    expect(formatStepText(steps)).toBe("1m, 2m, 1h, 2h, 1d, 2d, 1.5h");
    expect(formatStepText(steps, true)).toBe("١ دقيقة، ٢ دقائق، ١ ساعة، ٢ ساعات، ١ يوم، ٢ أيام، ١.٥ ساعات");
    expect(formatStepText([], true)).toBe("");
  });

  it.each<[string, SchedulerStep[]]>([
    ["", []],
    ["  ", []],
    ["1m, bad, 2h", ["1m", "2h"]],
    ["1m 2h", ["1m", "2h"]],
    [" 1 M ، 2 H ", ["1m", "2h"]],
    ["١ دقيقة، ٢ ساعات، ٣ أيام", ["1m", "2h", "3d"]],
    ["۱ ساعة، ۲ دقائق", ["1h", "2m"]],
    ["1.5h", ["1.5h"]],
    ["bad, nope", ["10m", "1d"]],
    ["-1m, .5h, 2s", ["10m", "1d"]],
    ["1 دقيقة 2 ساعات", ["10m", "1d"]],
    ["دقيقتان، ساعتان، يومان", ["2m", "2h", "2d"]],
    ["دقيقتين، ٢ ساعتين، يومين", ["2m", "2h", "2d"]],
    ["دقيقتان ساعتان", ["2m", "2h"]],
  ])("preserves parsing of %j", (input, expected) => {
    expect(parseStepText(input, fallback)).toEqual(expected);
    expect(fallback).toEqual(["10m", "1d"]);
  });

  it("returns an independent fallback array and never mutates supplied steps", () => {
    const original: SchedulerStep[] = ["10m", "1d"];
    const result = parseStepText("unrecognized", original);
    expect(result).toEqual(original);
    expect(result).not.toBe(original);
    result.push("2h");
    expect(original).toEqual(["10m", "1d"]);
    const steps: SchedulerStep[] = ["1m", "2h"];
    formatStepText(steps, true);
    expect(steps).toEqual(["1m", "2h"]);
  });

  const step = fc
    .tuple(fc.integer({ min: 0, max: 100000 }), fc.constantFrom("m", "h", "d"))
    .map(([tenths, unit]): SchedulerStep => `${tenths / 10}${unit}`);

  it("round-trips generated canonical nonnegative steps through either locale", () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        for (const rtl of [false, true]) {
          expect(parseStepText(formatStepText(steps, rtl), fallback)).toEqual(steps);
        }
      }),
      { seed: 117001, numRuns: 500 },
    );
  });

  it("retains ordered valid steps while ignoring generated invalid tokens", () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 30 }), (steps) => {
        const input = steps.flatMap((value, i) => [value, `invalid-${i}`]).join(", ");
        expect(parseStepText(input, fallback)).toEqual(steps);
      }),
      { seed: 117002, numRuns: 500 },
    );
  });
});

describe("strict step-text validation for the settings editor", () => {
  it.each<[string, SchedulerStep[]]>([
    ["", []],
    ["1m, 10m", ["1m", "10m"]],
    ["1m 10m", ["1m", "10m"]],
    ["01m, 1.50h", ["1m", "1.5h"]],
    ["1m, 10m,", ["1m", "10m"]],
    ["١ دقيقة، ١٠ دقائق", ["1m", "10m"]],
    ["1 دقيقة 2 ساعات", ["1m", "2h"]],
    ["دقيقتان ساعتان", ["2m", "2h"]],
  ])("accepts %j", (input, steps) => {
    expect(validateStepText(input)).toEqual({ ok: true, steps });
  });

  it.each(["1m, bad, 2h", "bad", "-1m", ".5h", "2s", "1m 10", "1 2 3"])(
    "reports %j instead of dropping a token",
    (input) => {
      expect(validateStepText(input)).toEqual({ ok: false });
      expect(parseStepText(input, fallback)).not.toEqual([]);
    },
  );

  it("previews what a valid field will save in both locales", () => {
    expect(formatStepPreview(["1m", "10m", "1h", "2d"], "en")).toBe("1 min, 10 min, 1 hour, 2 days");
    expect(formatStepPreview(["1m", "10m"], "ar")).toBe("١ دقيقة، ١٠ دقائق");
  });
});
