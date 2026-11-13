import fc from "fast-check";
import { addDays, atLocalTime, datesBetween, diffDays, isLocalDate, startOfWeek, weekdayOf } from "@/lib/habit/dates";
import { makeUpCutoffFor } from "@/lib/habit/cutoff";
import { chooseExtras, completeExtra, emptyExtrasState, EXTRAS_PER_DAY, hideExtra, parseExtrasState, type ExtraKind } from "@/lib/habit/extras";
import { findEarnBack } from "@/lib/habit/earn-back";
import { graceBalance } from "@/lib/habit/grace";
import { mergeHabitDays } from "@/lib/habit/merge";
import { isEveOfStreakTier, isStreakMilestone, nextStreakMilestone, streakTier } from "@/lib/habit/milestones";
import { meetsMinimum, minimumProgress, PAGE_UNITS, tallyReviews } from "@/lib/habit/minimum";
import { isMakeUpOpen, planSettlement } from "@/lib/habit/settle";
import { buildHabitSnapshot } from "@/lib/habit/snapshot";
import { computeStreak, countSteadyWeeks, longestStreak, toDayMap } from "@/lib/habit/streak";
import { COUNTS_TOWARD_LENGTH, EARNED_STATUSES, effectiveStatus, type DayStatus, type HabitDay, type HabitDayRow } from "@/lib/habit/types";
import { userState } from "@/lib/habit/user-state";

const TODAY = "2026-11-13";

function day(localDate: string, status: DayStatus = "done", fullMet = false): HabitDay {
  return { localDate, status, fullMet };
}

/** Consecutive days ending on `last`, all with the given status. */
function run(last: string, length: number, status: DayStatus = "done"): HabitDay[] {
  return Array.from({ length }, (_, i) => day(addDays(last, -(length - 1 - i)), status));
}

const cutoff = (missed: string) => makeUpCutoffFor(missed);
const morning = atLocalTime(TODAY, 9 * 60);
const afternoon = atLocalTime(TODAY, 15 * 60);

describe("calendar dates", () => {
  it("adds and diffs whole days across daylight saving and month ends", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 3)).toBe("2026-10-27");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-01-01", "2026-12-31")).toBe(364);
    expect(weekdayOf("2026-11-13")).toBe(5);
    expect(startOfWeek("2026-11-13", 6)).toBe("2026-11-07");
    expect(startOfWeek("2026-11-13", 1)).toBe("2026-11-09");
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("2026-02-28")).toBe(true);
    expect(datesBetween("2026-11-12", "2026-11-11")).toEqual([]);
  });

  it("round-trips addDays and diffDays for any offset", () => {
    fc.assert(
      fc.property(fc.integer({ min: -4000, max: 4000 }), (offset) => {
        const moved = addDays(TODAY, offset);
        return isLocalDate(moved) && diffDays(TODAY, moved) === offset && addDays(moved, -offset) === TODAY;
      }),
    );
  });
});

describe("streak (STR-03)", () => {
  it("shows the alive streak during the at-risk day instead of 0", () => {
    const view = computeStreak(toDayMap(run(addDays(TODAY, -1), 4)), TODAY, { makeUpOpen: false });
    expect(view).toMatchObject({ length: 4, atRisk: true, doneToday: false, todayStatus: null });
  });

  it("counts today once done", () => {
    const view = computeStreak(toDayMap(run(TODAY, 5)), TODAY, { makeUpOpen: false });
    expect(view).toMatchObject({ length: 5, atRisk: false, doneToday: true, startDay: addDays(TODAY, -4) });
  });

  it("is broken after a missed day once the make-up window closes", () => {
    const days = toDayMap(run(addDays(TODAY, -2), 6));
    expect(computeStreak(days, TODAY, { makeUpOpen: false }).length).toBe(0);
    expect(computeStreak(days, TODAY, { makeUpOpen: true })).toMatchObject({ length: 6, makeUpPending: true, atRisk: true });
  });

  it("keeps a grace day another device settled open for make-up until this device's cutoff (STR-07)", () => {
    const graced = [...run(addDays(TODAY, -2), 3), day(addDays(TODAY, -1), "grace")];
    expect(computeStreak(toDayMap(graced), TODAY, { makeUpOpen: true })).toMatchObject({ length: 4, makeUpPending: true, atRisk: true });
    expect(computeStreak(toDayMap(graced), TODAY, { makeUpOpen: false })).toMatchObject({ length: 4, makeUpPending: false });
    // Today's own wird does not count the run twice.
    const doneToday = toDayMap([...graced, day(TODAY)]);
    expect(computeStreak(doneToday, TODAY, { makeUpOpen: true })).toMatchObject({ length: 5, makeUpPending: true, doneToday: true });
    // An excuse or a pause already covers the day, so there is nothing to make up.
    for (const status of ["excused", "paused"] as const) {
      const covered = toDayMap([...run(addDays(TODAY, -2), 3), day(addDays(TODAY, -1), status)]);
      expect(computeStreak(covered, TODAY, { makeUpOpen: true }).makeUpPending).toBe(false);
    }
  });

  it("never counts a day twice, whatever the statuses and make-up window", () => {
    const statuses: DayStatus[] = ["done", "made_up", "earned_back", "excused", "paused", "grace"];
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.record({ offset: fc.integer({ min: -2, max: 20 }), status: fc.constantFrom(...statuses) }), {
          selector: (entry) => entry.offset,
          maxLength: 20,
        }),
        fc.boolean(),
        (entries, makeUpOpen) => {
          const days = toDayMap(entries.map(({ offset, status }) => day(addDays(TODAY, -offset), status)));
          const counted = entries.filter(({ offset, status }) => offset >= 0 && COUNTS_TOWARD_LENGTH[status]).length;
          return computeStreak(days, TODAY, { makeUpOpen }).length <= counted;
        },
      ),
    );
  });

  it("counts excused and grace days but not paused ones", () => {
    const days = toDayMap([
      day(addDays(TODAY, -4)),
      day(addDays(TODAY, -3), "excused"),
      day(addDays(TODAY, -2), "paused"),
      day(addDays(TODAY, -1), "grace"),
      day(TODAY, "made_up"),
    ]);
    expect(computeStreak(days, TODAY, { makeUpOpen: false }).length).toBe(4);
    expect(longestStreak(days, TODAY)).toBe(4);
  });

  it("ignores excused days marked in advance", () => {
    const days = toDayMap([...run(addDays(TODAY, -1), 2), day(addDays(TODAY, 3), "excused")]);
    expect(computeStreak(days, TODAY, { makeUpOpen: false }).length).toBe(2);
    expect(longestStreak(days, TODAY)).toBe(2);
  });

  it("never reports a streak longer than the covered history", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 60 }), { maxLength: 40 }), (offsets) => {
        const days = toDayMap(offsets.map((offset) => day(addDays(TODAY, -offset))));
        const view = computeStreak(days, TODAY, { makeUpOpen: false });
        return view.length <= days.size && view.length <= longestStreak(days, TODAY);
      }),
    );
  });
});

describe("review fixes for streak edges", () => {
  it("keeps yesterday's make-up pending when today is already excused", () => {
    const history = toDayMap([...run(addDays(TODAY, -2), 8), day(TODAY, "excused")]);
    expect(computeStreak(history, TODAY, { makeUpOpen: true })).toMatchObject({ length: 9, makeUpPending: true, todayStatus: "excused" });
    expect(computeStreak(history, TODAY, { makeUpOpen: false })).toMatchObject({ length: 1, makeUpPending: false });
  });

  it("finds the original break when full wirds fall on non-consecutive window days", () => {
    const lastDay = addDays(TODAY, -4);
    const history = toDayMap([
      ...run(lastDay, 8),
      day(addDays(lastDay, 2), "done", true),
      day(addDays(lastDay, 4), "done", true),
    ]);
    const earnBack = findEarnBack(history, TODAY, { makeUpOpen: false });
    expect(earnBack).toMatchObject({ lastDay, succeeded: true, fullDone: 2 });
    expect(earnBack!.restoreDays).toEqual([addDays(lastDay, 1), addDays(lastDay, 3)]);
  });
});

describe("headline order", () => {
  it("shows yesterday's open make-up before today's excuse", () => {
    const days = [...run(addDays(TODAY, -2), 5), day(TODAY, "excused")];
    const snapshot = buildHabitSnapshot({ days, today: TODAY, now: morning, makeUpCutoff: cutoff(addDays(TODAY, -1)), pause: null, goal: null });
    expect(snapshot.headline.kind).toBe("make_up_open");
    const later = buildHabitSnapshot({ days, today: TODAY, now: afternoon, makeUpCutoff: cutoff(addDays(TODAY, -1)), pause: null, goal: null });
    expect(later.headline.kind).toBe("excused_today");
  });
});

describe("grace days (STR-14)", () => {
  it("awards one after the 3rd wird day, then one every 7, holding at most 2", () => {
    const days = (count: number) => toDayMap(run(addDays(TODAY, -1), count));
    expect(graceBalance(days(2), TODAY)).toBe(0);
    expect(graceBalance(days(3), TODAY)).toBe(1);
    expect(graceBalance(days(9), TODAY)).toBe(1);
    expect(graceBalance(days(10), TODAY)).toBe(2);
    expect(graceBalance(days(40), TODAY)).toBe(2);
  });

  it("spends a held grace day and never goes below zero", () => {
    const history = [...run(addDays(TODAY, -2), 3), day(addDays(TODAY, -1), "grace")];
    expect(graceBalance(toDayMap(history), TODAY)).toBe(0);
    expect(graceBalance(toDayMap([day(addDays(TODAY, -1), "grace")]), TODAY)).toBe(0);
  });

  it("does not award for excused or paused days", () => {
    const history = [...run(addDays(TODAY, -1), 5, "excused")];
    expect(graceBalance(toDayMap(history), TODAY)).toBe(0);
  });
});

describe("settle pass (8.4)", () => {
  const base = run(addDays(TODAY, -2), 5);

  it("waits while yesterday can still be made up, then records a grace day at the cutoff", () => {
    expect(planSettlement({ days: base, today: TODAY, now: morning, makeUpCutoffFor: cutoff, pause: null })).toEqual([]);
    expect(isMakeUpOpen({ today: TODAY, now: morning, makeUpCutoffFor: cutoff })).toBe(true);
    expect(planSettlement({ days: base, today: TODAY, now: afternoon, makeUpCutoffFor: cutoff, pause: null })).toEqual([
      { localDate: addDays(TODAY, -1), status: "grace" },
    ]);
  });

  it("uses each held grace day once, oldest missed day first, then stops", () => {
    const history = run(addDays(TODAY, -5), 10);
    expect(planSettlement({ days: history, today: TODAY, now: afternoon, makeUpCutoffFor: cutoff, pause: null })).toEqual([
      { localDate: addDays(TODAY, -4), status: "grace" },
      { localDate: addDays(TODAY, -3), status: "grace" },
    ]);
  });

  it("settles an earlier gap that a later wird day closed off", () => {
    const history = [...run(addDays(TODAY, -4), 4), day(addDays(TODAY, -2))];
    expect(planSettlement({ days: history, today: TODAY, now: morning, makeUpCutoffFor: cutoff, pause: null })).toEqual([
      { localDate: addDays(TODAY, -3), status: "grace" },
    ]);
  });

  it("only spends grace that was held on the day it covers", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { maxLength: 30 }),
        fc.integer({ min: 0, max: 23 * 60 }),
        (offsets, minutes) => {
          const now = atLocalTime(TODAY, minutes);
          const days = offsets.map((offset) => day(addDays(TODAY, -offset)));
          const writes = planSettlement({ days, today: TODAY, now, makeUpCutoffFor: cutoff, pause: null });
          const settled = toDayMap([...days, ...writes.map((write) => day(write.localDate, write.status))]);
          return writes
            .filter((write) => write.status === "grace")
            .every((write) => settled.has(addDays(write.localDate, -1)) && graceBalance(settled, write.localDate) > 0);
        },
      ),
    );
  });

  it("writes nothing without a streak to protect or without grace", () => {
    expect(planSettlement({ days: [], today: TODAY, now: afternoon, makeUpCutoffFor: cutoff, pause: null })).toEqual([]);
    const short = run(addDays(TODAY, -2), 2);
    expect(planSettlement({ days: short, today: TODAY, now: afternoon, makeUpCutoffFor: cutoff, pause: null })).toEqual([]);
  });

  it("records paused days through today and lets a recited day win later", () => {
    const pause = { start: addDays(TODAY, -2), end: addDays(TODAY, 5) };
    const writes = planSettlement({ days: base.slice(0, 3), today: TODAY, now: morning, makeUpCutoffFor: cutoff, pause });
    expect(writes.filter((write) => write.status === "paused").map((write) => write.localDate)).toEqual([
      addDays(TODAY, -2),
      addDays(TODAY, -1),
      TODAY,
    ]);
  });

  it("is idempotent: settling the settled history writes nothing", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { maxLength: 30 }),
        fc.integer({ min: 0, max: 23 * 60 }),
        (offsets, minutes) => {
          const now = atLocalTime(TODAY, minutes);
          const days = offsets.map((offset) => day(addDays(TODAY, -offset)));
          const writes = planSettlement({ days, today: TODAY, now, makeUpCutoffFor: cutoff, pause: null });
          const settled = [...days, ...writes.map((write) => day(write.localDate, write.status))];
          return planSettlement({ days: settled, today: TODAY, now, makeUpCutoffFor: cutoff, pause: null }).length === 0;
        },
      ),
    );
  });
});

describe("earn-back (STR-17)", () => {
  // A 10-day streak ended 3 days ago; the day after it was missed.
  const lastDay = addDays(TODAY, -3);
  const broken = run(lastDay, 10);

  it("opens the day after the make-up cutoff and needs 3 recited days", () => {
    const offer = findEarnBack(toDayMap([...broken, day(addDays(lastDay, 2))]), addDays(lastDay, 2), { makeUpOpen: false });
    expect(offer).toMatchObject({ brokenLength: 10, daysDone: 1, succeeded: false, windowStart: addDays(lastDay, 2) });
  });

  it("restores the missed day on success so the runs join", () => {
    const history = toDayMap([...broken, ...run(addDays(lastDay, 4), 3)]);
    const offer = findEarnBack(history, addDays(lastDay, 4), { makeUpOpen: false });
    expect(offer).toMatchObject({ succeeded: true, restoreDays: [addDays(lastDay, 1)] });
    history.set(addDays(lastDay, 1), day(addDays(lastDay, 1), "earned_back"));
    expect(computeStreak(history, addDays(lastDay, 4), { makeUpOpen: false }).length).toBe(14);
  });

  it("also succeeds with the full wird on 2 days, restoring every missed day", () => {
    const history = toDayMap([...broken, day(addDays(lastDay, 3), "done", true), day(addDays(lastDay, 4), "done", true)]);
    const offer = findEarnBack(history, addDays(lastDay, 4), { makeUpOpen: false });
    expect(offer).toMatchObject({ succeeded: true, restoreDays: [addDays(lastDay, 1), addDays(lastDay, 2)] });
  });

  it("is not offered for short streaks, closed windows or windows that can no longer succeed", () => {
    expect(findEarnBack(toDayMap(run(lastDay, 6)), addDays(lastDay, 2), { makeUpOpen: false })).toBeNull();
    expect(findEarnBack(toDayMap(broken), addDays(lastDay, 5), { makeUpOpen: false })).toBeNull();
    // One window day missed: the full wird on the last 2 days can still restore it.
    expect(findEarnBack(toDayMap(broken), addDays(lastDay, 3), { makeUpOpen: false })).toMatchObject({ succeeded: false });
    // Two window days missed and none full: neither path can finish.
    expect(findEarnBack(toDayMap(broken), addDays(lastDay, 4), { makeUpOpen: false })).toBeNull();
  });

  it("is a make-up, not an earn-back, while yesterday's window is open", () => {
    expect(findEarnBack(toDayMap(broken), addDays(lastDay, 2), { makeUpOpen: true })).toBeNull();
  });
});

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
    created_at: "2026-11-13T08:00:00.000Z",
    updated_at: "2026-11-13T08:00:00.000Z",
    ...overrides,
  };
  return { ...base, status: effectiveStatus(base.earned_status, base.reason) };
}

const excuse = (reason: HabitDayRow["reason"], at: string) =>
  row({ earned_status: null, reason, excuse_updated_at: at, created_at: at, updated_at: at });

describe("habit day merge (DB-02)", () => {
  it("keeps the higher-precedence status and ORs the flags", () => {
    const merged = mergeHabitDays(row({ earned_status: "grace" }), row({ earned_status: "done", minimum_met: 1 }));
    expect(merged).toMatchObject({ status: "done", minimum_met: 1 });
    const flags = mergeHabitDays(
      row({ full_met: 1 }),
      row({ minimum_met: 1, updated_at: "2026-11-13T09:00:00.000Z" }),
    );
    expect(flags).toMatchObject({ full_met: 1, minimum_met: 1, updated_at: "2026-11-13T09:00:00.000Z" });
  });

  it("lets a later withdrawal remove only the excuse", () => {
    const excused = excuse("travel", "2026-11-13T08:00:00.000Z");
    const withdrawn = excuse(null, "2026-11-13T10:00:00.000Z");
    expect(mergeHabitDays(excused, withdrawn)).toMatchObject({ status: null, reason: null });
    expect(mergeHabitDays(row({ earned_status: "done" }), withdrawn)).toMatchObject({ status: "done" });
    expect(mergeHabitDays(mergeHabitDays(row({ earned_status: "paused" }), excused), withdrawn)).toMatchObject({
      status: "paused",
    });
    const olderWithdrawal = excuse(null, "2026-11-13T07:00:00.000Z");
    expect(mergeHabitDays(excused, olderWithdrawal)).toMatchObject({ status: "excused", reason: "travel" });
    // The same instant spelled two ways resolves by reason, as the server merge does.
    const sameInstantWithdrawal = excuse(null, "2026-11-13T12:00:00Z");
    const sameInstantIllness = excuse("illness", "2026-11-13T12:00:00.000Z");
    expect(mergeHabitDays(sameInstantWithdrawal, sameInstantIllness)).toMatchObject({ reason: "illness" });
    expect(mergeHabitDays(sameInstantIllness, sameInstantWithdrawal)).toMatchObject({ reason: "illness" });
  });

  it("shows a recited day over an excuse, and the excuse over a pause or grace day", () => {
    expect(mergeHabitDays(row({ earned_status: "made_up" }), excuse("illness", "2026-11-13T08:00:00.000Z")).status).toBe("made_up");
    expect(mergeHabitDays(row({ earned_status: "grace" }), excuse("illness", "2026-11-13T08:00:00.000Z")).status).toBe("excused");
  });

  it("keeps the later make-up credit so no review counts for two days", () => {
    const a = row({ earned_status: "made_up", credited_through: "2026-11-13T07:00:00.000Z" });
    const b = row({ earned_status: "made_up", credited_through: "2026-11-13T08:00:00.000Z" });
    expect(mergeHabitDays(a, b).credited_through).toBe("2026-11-13T08:00:00.000Z");
  });

  const time = fc.constantFrom("2026-11-13T06:00:00.000Z", "2026-11-13T09:00:00.000Z", "2026-11-13T09:00:00Z");
  const arbitraryRow = fc
    .record({
      earned_status: fc.constantFrom(null, ...EARNED_STATUSES),
      reason: fc.constantFrom(null, "illness", "travel"),
      excuse_updated_at: fc.option(time),
      minimum_met: fc.constantFrom(0, 1),
      full_met: fc.constantFrom(0, 1),
      manzil_cycle_completed: fc.constantFrom(0, 1),
      source_session_id: fc.constantFrom(null, "s1", "s2"),
      credited_through: fc.constantFrom(null, "2026-11-13T07:00:00.000Z", "2026-11-13T08:00:00Z"),
      tz: fc.constantFrom(null, "Asia/Amman", "Europe/Berlin"),
      created_at: time,
      updated_at: time,
    })
    .map((fields) => row({ ...fields, reason: fields.excuse_updated_at === null ? null : fields.reason } as Partial<HabitDayRow>));

  it("is commutative, associative and idempotent, so devices converge in any order", () => {
    fc.assert(
      fc.property(arbitraryRow, arbitraryRow, arbitraryRow, (a, b, c) => {
        expect(mergeHabitDays(a, b)).toEqual(mergeHabitDays(b, a));
        expect(mergeHabitDays(a, a)).toEqual(a);
        expect(mergeHabitDays(mergeHabitDays(a, b), c)).toEqual(mergeHabitDays(a, mergeHabitDays(b, c)));
      }),
    );
  });
});

describe("minimum wird (STR-01)", () => {
  const minimum = { pages: 1, minutes: 5 };

  it("counts ten ayah reviews as one page exactly", () => {
    const reviews = Array.from({ length: 10 }, (_, i) => ({ cardId: `2:${i + 1}`, durationMs: null }));
    const tally = tallyReviews(reviews, { studyCounts: false });
    expect(tally.pageUnits).toBe(PAGE_UNITS);
    expect(meetsMinimum(tally, minimum)).toBe(true);
    expect(meetsMinimum(tallyReviews(reviews.slice(1), { studyCounts: false }), minimum)).toBe(false);
  });

  it("meets the minimum by time, capping each review at 10 minutes", () => {
    const idle = tallyReviews([{ cardId: "2:1", durationMs: 4 * 60 * 60_000 }], { studyCounts: false });
    expect(idle.countedMs).toBe(10 * 60_000);
    expect(meetsMinimum(tallyReviews([{ cardId: "2:1", durationMs: 299_000 }], { studyCounts: false }), minimum)).toBe(false);
    expect(meetsMinimum(tallyReviews([{ cardId: "2:1", durationMs: 300_000 }], { studyCounts: false }), minimum)).toBe(true);
  });

  it("counts meanings only when the user turned that on, and only by time", () => {
    const words = Array.from({ length: 40 }, (_, i) => ({ cardId: `word:2:255:${i + 1}`, durationMs: 10_000 }));
    expect(tallyReviews(words, { studyCounts: false })).toEqual({ pageUnits: 0, countedMs: 0 });
    expect(tallyReviews(words, { studyCounts: true })).toEqual({ pageUnits: 0, countedMs: 400_000 });
  });

  it("counts a page card or a finished sabaq chunk on its own", () => {
    expect(meetsMinimum(tallyReviews([{ cardId: "page:madani15:582", durationMs: 0 }], { studyCounts: false }), minimum)).toBe(true);
    expect(minimumProgress(tallyReviews([{ cardId: "half:madani15:582:a", durationMs: 0 }], { studyCounts: false }), minimum)).toBe(0.5);
  });
});

describe("habit snapshot headlines", () => {
  const input = (days: HabitDay[], now = afternoon) => ({
    days,
    today: TODAY,
    now,
    makeUpCutoff: makeUpCutoffFor(addDays(TODAY, -1)),
    pause: null,
    goal: null,
  });

  it("names one state per day", () => {
    expect(buildHabitSnapshot(input([])).headline).toEqual({ kind: "empty" });
    expect(buildHabitSnapshot(input(run(TODAY, 3))).headline).toEqual({ kind: "done_today", length: 3 });
    expect(buildHabitSnapshot(input(run(addDays(TODAY, -1), 3))).headline).toEqual({ kind: "at_risk", length: 3 });
    expect(buildHabitSnapshot(input(run(addDays(TODAY, -2), 3), morning)).headline).toMatchObject({ kind: "make_up_open", length: 3 });
    expect(buildHabitSnapshot(input(run(addDays(TODAY, -2), 3))).headline).toEqual({ kind: "fresh_start", longest: 3 });
    expect(buildHabitSnapshot(input(run(addDays(TODAY, -3), 9))).headline).toMatchObject({ kind: "earn_back" });
    expect(buildHabitSnapshot(input([...run(addDays(TODAY, -1), 2), day(TODAY, "excused")])).headline).toEqual({
      kind: "excused_today",
      length: 3,
    });
  });

  it("reports goal progress within the current run and the grace days held", () => {
    const snapshot = buildHabitSnapshot({ ...input(run(TODAY, 12)), goal: { target: 7, start: addDays(TODAY, -4) } });
    expect(snapshot.goal).toEqual({ target: 7, done: 5, reached: false });
    expect(snapshot.graceHeld).toBe(2);
    expect(snapshot.recentGraceDay).toBeNull();
  });
});

describe("milestones (STR-23, STR-24)", () => {
  it("marks the fixed milestones and every hundred after a year", () => {
    expect([3, 7, 14, 30, 40, 50, 100, 200, 365, 400, 500].every(isStreakMilestone)).toBe(true);
    expect([1, 2, 8, 41, 300, 366].some(isStreakMilestone)).toBe(false);
    expect(nextStreakMilestone(40)).toBe(50);
    expect(nextStreakMilestone(365)).toBe(400);
    expect(streakTier(6)).toBe(0);
    expect(streakTier(30)).toBe(3);
    expect(isEveOfStreakTier(13)).toBe(true);
  });
});

describe("user state (6.1)", () => {
  const active = (offsets: number[]) => new Set(offsets.map((offset) => addDays(TODAY, -offset)));
  it("follows Duolingo's state definitions", () => {
    expect(userState(new Set(), null, TODAY)).toBe("new");
    expect(userState(active([0]), TODAY, TODAY)).toBe("new");
    expect(userState(active([0, 3]), "2026-01-01", TODAY)).toBe("current");
    expect(userState(active([0, 10]), "2026-01-01", TODAY)).toBe("reactivated");
    expect(userState(active([0, 40]), "2026-01-01", TODAY)).toBe("resurrected");
    expect(userState(active([2]), "2026-01-01", TODAY)).toBe("at_risk_weekly");
    expect(userState(active([12]), "2026-01-01", TODAY)).toBe("at_risk_monthly");
    expect(userState(active([45]), "2026-01-01", TODAY)).toBe("dormant");
  });
});

describe("steady weeks (STR-27)", () => {
  it("counts ended weeks whose 7 days were recited or excused, never grace", () => {
    // 2026-11-07 is a Saturday.
    const full = run("2026-11-13", 7);
    expect(countSteadyWeeks(toDayMap(full), "2026-11-13", 6)).toBe(1);
    expect(countSteadyWeeks(toDayMap(full), "2026-11-12", 6)).toBe(0);
    const withExcuse = [...run("2026-11-12", 6), day("2026-11-13", "excused")];
    expect(countSteadyWeeks(toDayMap(withExcuse), "2026-11-14", 6)).toBe(1);
    const withGrace = [...run("2026-11-12", 6), day("2026-11-13", "grace")];
    expect(countSteadyWeeks(toDayMap(withGrace), "2026-11-14", 6)).toBe(0);
  });
});

describe("wird extras (5.4)", () => {
  const context = (overrides: Partial<Parameters<typeof chooseExtras>[1]> = {}) => ({
    today: TODAY,
    inboxCount: 2,
    hasMemorizedPages: true,
    sabaqToday: true,
    doneToday: new Set<ExtraKind>(),
    ...overrides,
  });

  it("offers at most 2 eligible extras and skips ones that do not apply", () => {
    const state = emptyExtrasState(TODAY);
    expect(chooseExtras(state, context())).toHaveLength(EXTRAS_PER_DAY);
    expect(chooseExtras(state, context({ inboxCount: 0, hasMemorizedPages: false, sabaqToday: false }))).toEqual([]);
    expect(chooseExtras(state, context({ inboxCount: 0, hasMemorizedPages: false }))).toEqual(["deepen"]);
  });

  it("hides an extra for the day and snoozes it for 2 weeks after 3 skips in a row (QST-03)", () => {
    let state = emptyExtrasState(TODAY);
    state = hideExtra(state, "salah");
    expect(chooseExtras(state, context())).not.toContain("salah");
    let next = parseExtrasState(JSON.stringify(state), addDays(TODAY, 1));
    expect(next.hidden).toEqual([]);
    next = hideExtra(hideExtra(next, "salah"), "salah");
    expect(next.snoozedUntil.salah).toBe(addDays(TODAY, 15));
    const later = parseExtrasState(JSON.stringify(next), addDays(TODAY, 10));
    expect(chooseExtras(later, context({ today: addDays(TODAY, 10) }))).not.toContain("salah");
    expect(completeExtra(next, "salah").skips.salah).toBe(0);
  });

  it("starts fresh from a malformed saved state", () => {
    expect(parseExtrasState("{bad", TODAY)).toEqual(emptyExtrasState(TODAY));
  });
});
