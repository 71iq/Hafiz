import * as fc from "fast-check";
import { buildLocalReviewCounts, calculateLongestStreak } from "@/lib/fsrs/review-activity";

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const noon = (day: string) => ({ reviewed_at: `${day}T12:00:00` });

describe("local review-date counts", () => {
  it("keeps empty and invalid-only histories empty", () => {
    expect([...buildLocalReviewCounts([])]).toEqual([]);
    expect([...buildLocalReviewCounts([{ reviewed_at: "invalid" }, { reviewed_at: "" }])]).toEqual([]);
  });

  it("counts repeated instants and distinct instants on the same local day", () => {
    expect([
      ...buildLocalReviewCounts([noon("2026-01-02"), noon("2026-01-02"), { reviewed_at: "2026-01-02T23:59:59" }]),
    ]).toEqual([["2026-01-02", 3]]);
  });

  it("retains first-seen day order instead of sorting the map", () => {
    expect([
      ...buildLocalReviewCounts([noon("2026-01-04"), noon("2026-01-02"), noon("2026-01-04"), noon("2026-01-03")]),
    ]).toEqual([
      ["2026-01-04", 2],
      ["2026-01-02", 1],
      ["2026-01-03", 1],
    ]);
  });

  it("ignores invalid rows among valid rows and preserves leap/year boundaries", () => {
    expect([
      ...buildLocalReviewCounts([
        noon("2024-02-29"),
        { reviewed_at: "invalid" },
        noon("2025-12-31"),
        noon("2026-01-01"),
      ]),
    ]).toEqual([
      ["2024-02-29", 1],
      ["2025-12-31", 1],
      ["2026-01-01", 1],
    ]);
  });

  it("does not mutate frozen input rows", () => {
    const row = Object.freeze(noon("2026-01-02"));
    const rows = [row];
    Object.freeze(rows);
    expect([...buildLocalReviewCounts(rows)]).toEqual([["2026-01-02", 1]]);
    expect(rows).toEqual([{ reviewed_at: "2026-01-02T12:00:00" }]);
  });

  it("converts offset timestamps to the process local day", () => {
    const expected = zone === "America/New_York" ? "2025-12-31" : "2026-01-01";
    expect([...buildLocalReviewCounts([{ reviewed_at: "2026-01-01T00:30:00Z" }])]).toEqual([[expected, 1]]);
  });

  it("uses local calendar days across spring and autumn transitions", () => {
    const rows = [
      noon("2026-03-28"),
      noon("2026-03-29"),
      noon("2026-03-30"),
      noon("2026-10-24"),
      noon("2026-10-25"),
      noon("2026-10-26"),
    ];
    expect([...buildLocalReviewCounts(rows)]).toEqual([
      ["2026-03-28", 1],
      ["2026-03-29", 1],
      ["2026-03-30", 1],
      ["2026-10-24", 1],
      ["2026-10-25", 1],
      ["2026-10-26", 1],
    ]);
  });

  it("counts arbitrary repeated local days with stable insertion order", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 5 }), { maxLength: 50 }), (days) => {
        const rows = days.map((day) => noon(`2026-01-0${day}`));
        const expected = [...new Set(days)].map((day) => [
          `2026-01-0${day}`,
          days.filter((other) => other === day).length,
        ]);
        expect([...buildLocalReviewCounts(rows)]).toEqual(expected);
      }),
      { seed: 6301, numRuns: 500 },
    );
  });
});

describe("ordered longest local-date streak", () => {
  it.each([
    { keys: [], expected: 0 },
    { keys: ["2026-01-01"], expected: 1 },
    { keys: ["2026-01-01", "2026-01-02", "2026-01-03"], expected: 3 },
    { keys: ["2026-01-01", "2026-01-03", "2026-01-04", "2026-01-05"], expected: 3 },
    { keys: ["2026-01-01", "2026-01-02", "2026-01-04", "2026-01-05"], expected: 2 },
    { keys: ["2026-01-03", "2026-01-02", "2026-01-01"], expected: 1 },
    { keys: ["2026-01-01", "2026-01-02", "2026-01-02", "2026-01-03"], expected: 2 },
    { keys: ["invalid", "2026-01-01", "2026-01-02"], expected: 2 },
    { keys: ["2026-01-01", "invalid", "2026-01-02"], expected: 1 },
    { keys: ["invalid"], expected: 1 },
    { keys: ["2024-02-28", "2024-02-29", "2024-03-01"], expected: 3 },
    { keys: ["2025-12-31", "2026-01-01"], expected: 2 },
  ])("preserves $keys as $expected", ({ keys, expected }) => {
    const original = [...keys];
    Object.freeze(keys);
    expect(calculateLongestStreak(keys)).toBe(expected);
    expect(keys).toEqual(original);
  });

  it.each([
    ["2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"],
    ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"],
  ])("characterizes the existing DST behavior for %j", (...keys) => {
    // London crosses UTC offset zero. Existing floored local-midnight indexes
    // split this run; changing that policy belongs to the separate repair.
    expect(calculateLongestStreak(keys)).toBe(zone === "Europe/London" ? 2 : 4);
  });

  it("matches an independent longest-run oracle for arbitrary January gaps", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 31, maxLength: 31 }), (mask) => {
        const keys = mask.flatMap((present, index) =>
          present ? [`2026-01-${String(index + 1).padStart(2, "0")}`] : [],
        );
        const expected = Math.max(
          0,
          ...mask
            .map((present) => (present ? "1" : "0"))
            .join("")
            .split("0")
            .map((run) => run.length),
        );
        expect(calculateLongestStreak(keys)).toBe(expected);
      }),
      { seed: 6302, numRuns: 500 },
    );
  });
});
