import fs from "node:fs";
import path from "node:path";
import * as fc from "fast-check";
import { mergeHabitDays } from "@/lib/habit/merge";
import { EARNED_STATUSES, effectiveStatus, type HabitDayRow } from "@/lib/habit/types";

/**
 * supabase/tests/habit-merge-cases.json is the shared contract between lib/habit/merge.ts and the
 * server trigger private.merge_habit_day. This test proves every expected row is what the TypeScript
 * merge returns for each order of its inputs; supabase/tests/learning_consistency.test.sql proves the
 * server returns the same rows. Regenerate with UPDATE_HABIT_MERGE_FIXTURE=1 after a deliberate change.
 *
 * Times mostly use one spelling (".000Z"). The server stores instants, so it never sees the spelling.
 * The excuse register therefore orders by instant, then reason, on both sides, and the spelling only
 * picks which equal string the client keeps; the named "spelled differently" cases pin that down.
 */
const FIXTURE = path.join(process.cwd(), "supabase/tests/habit-merge-cases.json");
const TODAY = "2026-11-13";
const T = (hour: number) => `2026-11-13T${String(hour).padStart(2, "0")}:00:00.000Z`;

type MergeCase = { name: string; rows: HabitDayRow[]; expected: HabitDayRow };

function row(overrides: Partial<HabitDayRow> = {}): HabitDayRow {
  const base: HabitDayRow = {
    local_date: TODAY,
    status: "done",
    earned_status: "done",
    reason: null,
    excuse_updated_at: null,
    minimum_met: 0,
    full_met: 0,
    manzil_cycle_completed: 0,
    source_session_id: null,
    credited_through: null,
    tz: "Asia/Amman",
    created_at: T(8),
    updated_at: T(8),
    ...overrides,
  };
  return { ...base, status: effectiveStatus(base.earned_status, base.reason) };
}

const excuse = (reason: HabitDayRow["reason"], at: string) =>
  row({ earned_status: null, reason, excuse_updated_at: at, created_at: at, updated_at: at });

function mergeAll(rows: HabitDayRow[]): HabitDayRow {
  return rows.slice(1).reduce((merged, next) => mergeHabitDays(merged, next), rows[0]);
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}

const time = fc.constantFrom(T(6), T(9), T(11));
const arbitraryRow = fc
  .record({
    earned_status: fc.constantFrom(null, ...EARNED_STATUSES),
    reason: fc.constantFrom(null, "illness", "travel", "menstruation", "other"),
    excuse_updated_at: fc.option(time),
    minimum_met: fc.constantFrom(0, 1),
    full_met: fc.constantFrom(0, 1),
    manzil_cycle_completed: fc.constantFrom(0, 1),
    source_session_id: fc.constantFrom(null, "s1", "s2"),
    credited_through: fc.constantFrom(null, T(7), T(10)),
    tz: fc.constantFrom(null, "Asia/Amman", "Europe/Berlin"),
    created_at: time,
    updated_at: time,
  })
  .map((fields) =>
    row({ ...fields, reason: fields.excuse_updated_at === null ? null : fields.reason } as Partial<HabitDayRow>),
  );

function buildCases(): MergeCase[] {
  const named: Array<[string, HabitDayRow[]]> = [
    ["higher precedence wins and flags OR", [row({ earned_status: "grace" }), row({ earned_status: "done", minimum_met: 1 })]],
    ["full and minimum flags OR, later update kept", [row({ full_met: 1 }), row({ minimum_met: 1, updated_at: T(9) })]],
    ["manzil cycle flag ORs", [row({ manzil_cycle_completed: 1 }), row({ earned_status: "made_up" })]],
    ["later withdrawal removes the excuse", [excuse("travel", T(8)), excuse(null, T(10))]],
    ["withdrawal keeps a recited day", [row({ earned_status: "done" }), excuse(null, T(10))]],
    ["pause, excuse, then withdrawal", [row({ earned_status: "paused" }), excuse("travel", T(8)), excuse(null, T(10))]],
    ["older withdrawal loses to the excuse", [excuse("travel", T(8)), excuse(null, T(7))]],
    ["recited day shows over an excuse", [row({ earned_status: "made_up" }), excuse("illness", T(8))]],
    ["excuse shows over a grace day", [row({ earned_status: "grace" }), excuse("illness", T(8))]],
    ["excuse shows over a pause", [row({ earned_status: "paused" }), excuse("other", T(9))]],
    ["earned back shows over an excuse", [row({ earned_status: "earned_back" }), excuse("other", T(9))]],
    [
      "later make-up credit kept",
      [
        row({ earned_status: "made_up", credited_through: T(7) }),
        row({ earned_status: "made_up", credited_through: T(8) }),
      ],
    ],
    ["credit kept when only one side has it", [row({ credited_through: T(7) }), row({ credited_through: null })]],
    [
      "equal status ties on session id",
      [
        row({ source_session_id: "s1", tz: "Europe/Berlin" }),
        row({ source_session_id: "s2", tz: "Asia/Amman" }),
      ],
    ],
    ["equal status and session ties on zone", [row({ tz: "Asia/Amman" }), row({ tz: "Europe/Berlin" })]],
    ["null session sorts first", [row({ source_session_id: null, tz: "Europe/Berlin" }), row({ source_session_id: "s1", tz: null })]],
    ["same excuse time ties on reason", [excuse("illness", T(9)), excuse("travel", T(9))]],
    [
      "same instant spelled differently ties on reason",
      [excuse("illness", "2026-11-13T12:00:00Z"), excuse("travel", "2026-11-13T12:00:00.000Z")],
    ],
    [
      "same instant spelled differently, reason before spelling",
      [excuse("travel", "2026-11-13T12:00:00Z"), excuse("illness", "2026-11-13T12:00:00.000Z")],
    ],
    [
      "same instant spelled differently, excuse beats withdrawal",
      [excuse(null, "2026-11-13T12:00:00.000Z"), excuse("other", "2026-11-13T12:00:00Z")],
    ],
    ["nothing recorded stays uncovered", [row({ earned_status: null }), row({ earned_status: null, updated_at: T(9) })]],
    ["earliest creation and latest update", [row({ created_at: T(6), updated_at: T(7) }), row({ created_at: T(9), updated_at: T(11) })]],
    ["identical rows are idempotent", [row({ earned_status: "earned_back", minimum_met: 1 }), row({ earned_status: "earned_back", minimum_met: 1 })]],
  ];
  const pairs = fc.sample(fc.tuple(arbitraryRow, arbitraryRow), { seed: 20261113, numRuns: 40 });
  const triples = fc.sample(fc.tuple(arbitraryRow, arbitraryRow, arbitraryRow), { seed: 1113, numRuns: 12 });
  return [
    ...named.map(([name, rows]) => ({ name, rows })),
    ...pairs.map((rows, i) => ({ name: `generated pair ${i + 1}`, rows })),
    ...triples.map((rows, i) => ({ name: `generated triple ${i + 1}`, rows })),
  ].map(({ name, rows }) => ({ name, rows, expected: mergeAll(rows) }));
}

describe("server habit merge fixture (DB-02)", () => {
  const cases = buildCases();
  if (process.env.UPDATE_HABIT_MERGE_FIXTURE === "1") {
    fs.writeFileSync(FIXTURE, `${JSON.stringify(cases, null, 2)}\n`);
  }
  const fixture: MergeCase[] = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

  it("holds exactly the cases this test builds", () => {
    expect(fixture).toEqual(cases);
  });

  it.each(fixture.map((entry) => [entry.name, entry] as const))("%s: every order merges to the expected row", (_, entry) => {
    for (const order of permutations(entry.rows)) {
      expect(mergeAll(order)).toEqual(entry.expected);
    }
  });
});
