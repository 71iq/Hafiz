import * as fc from "fast-check";
import { addDays, type LocalDate } from "@/lib/habit/dates";
import type { DayStatus, HabitDay, HabitPause } from "@/lib/habit/types";
import type { DayClock } from "@/lib/notifications/clock";
import { createHabitProjector, replayHabit, type HabitProjectionInput } from "@/lib/notifications/habit-projection";
import { comebackCadence, planNotifications, type PlannerInput } from "@/lib/notifications/planner";
import { DEFAULT_REMINDER_PREFS } from "@/lib/notifications/types";
import type { DayPrayerTimes } from "@/lib/prayer/times";

/** A fixed UTC+3 clock, so results do not depend on the machine's zone. */
const OFFSET_MS = 3 * 60 * 60_000;
const CLOCK: DayClock = {
  at: (date, minutes) => new Date(Date.parse(`${date}T00:00:00Z`) + minutes * 60_000 - OFFSET_MS),
  dateOf: (at) => new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10),
  minutesOf: (at) => {
    const local = new Date(at.getTime() + OFFSET_MS);
    return local.getUTCHours() * 60 + local.getUTCMinutes();
  },
  weekdayOf: (date) => new Date(`${date}T00:00:00Z`).getUTCDay(),
};

const TODAY: LocalDate = "2026-11-12";

/** Dhuhr moves a little each day, so make-up cutoffs differ from the 12:30 fallback. */
function prayerTimes(date: LocalDate): DayPrayerTimes {
  const drift = Number(date.slice(8, 10)) % 7;
  const at = (minutes: number) => CLOCK.at(date, minutes + drift);
  return { fajr: at(290), sunrise: at(370), dhuhr: at(705), asr: at(890), maghrib: at(1020), isha: at(1110) };
}

function projectionInput(days: readonly HabitDay[], pause: HabitPause | null, withPrayers: boolean): HabitProjectionInput {
  return { habit: { days, pause }, clock: CLOCK, prayers: withPrayers ? prayerTimes : () => null };
}

/** The last `count` days through yesterday, with an occasional excused day. */
function longHistory(count: number): HabitDay[] {
  return Array.from({ length: count }, (_, index) => ({
    localDate: addDays(TODAY, index - count),
    status: index % 97 === 50 ? ("excused" as const) : ("done" as const),
    fullMet: index % 5 === 0,
  }));
}

function plannerInput(days: HabitDay[]): PlannerInput {
  return {
    now: CLOCK.at(TODAY, 3 * 60),
    clock: CLOCK,
    prefs: { ...DEFAULT_REMINDER_PREFS, types: { ...DEFAULT_REMINDER_PREFS.types, late_reminder: true, friday_kahf: true } },
    prayers: prayerTimes,
    isRamadan: () => false,
    isRamadanStart: () => false,
    habit: { days, pause: null },
    minimum: { pages: 1, minutes: 5 },
    weekStart: 1,
    backoff: 0,
    delivered: [],
    remindLater: null,
    groupPending: null,
    facts: () => ({}),
    random: () => 0,
  };
}

/** Every instant a plan asks about, plus the edges of the make-up window. */
function instantsFor(date: LocalDate): Date[] {
  return [0, 5 * 60 + 20, 10 * 60 + 35, 12 * 60 + 29, 12 * 60 + 31, 19 * 60, 23 * 60 + 15, 23 * 60 + 59].map((minutes) =>
    CLOCK.at(date, minutes),
  );
}

function expectSameAsReplay(input: HabitProjectionInput, from: LocalDate, dates: readonly LocalDate[], instants: (date: LocalDate) => Date[]) {
  const project = createHabitProjector(input, from);
  for (const date of dates) {
    for (const at of instants(date)) {
      const fast = project(date, at);
      const full = replayHabit(input, date, at);
      expect({ date, at, snapshot: fast.snapshot }).toEqual({ date, at, snapshot: full.snapshot });
      for (const ramadanStart of [false, true]) {
        expect(comebackCadence(fast.days, date, CLOCK.weekdayOf(date), ramadanStart)).toEqual(
          comebackCadence(full.days, date, CLOCK.weekdayOf(date), ramadanStart),
        );
      }
    }
  }
}

describe("incremental habit projection", () => {
  it("plans over five years of history well under 100 ms", () => {
    const input = plannerInput(longHistory(5 * 365));
    for (let run = 0; run < 3; run += 1) planNotifications(input);
    const times: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const start = performance.now();
      planNotifications(input);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(100);
  });

  it("matches the full replay for long streaks, a broken long streak, a pause and grace across the cut", () => {
    const yesterday = addDays(TODAY, -1);
    const cases: { days: HabitDay[]; pause: HabitPause | null }[] = [
      { days: longHistory(400), pause: null },
      // A 400-day streak broke three days ago; two days recited since, one with the full wird.
      {
        days: [
          ...longHistory(403).slice(0, 400),
          { localDate: yesterday, status: "done", fullMet: true },
          { localDate: TODAY, status: "done", fullMet: false },
        ],
        pause: null,
      },
      // A pause that started before the window and runs past today.
      { days: longHistory(200).filter((day) => day.localDate < addDays(TODAY, -40)), pause: { start: addDays(TODAY, -45), end: addDays(TODAY, 3) } },
      // Missed days on both sides of the cut, covered by grace.
      { days: longHistory(120).filter((day) => ![-30, -31, -32, -60].some((offset) => day.localDate === addDays(TODAY, offset))), pause: null },
      // Only paused days reach the cut: the run continues but adds nothing.
      { days: Array.from({ length: 60 }, (_, index) => ({ localDate: addDays(TODAY, index - 70), status: "paused" as const, fullMet: false })), pause: null },
    ];
    const dates = Array.from({ length: 8 }, (_, offset) => addDays(TODAY, offset));
    for (const { days, pause } of cases) {
      for (const withPrayers of [false, true]) expectSameAsReplay(projectionInput(days, pause, withPrayers), TODAY, dates, instantsFor);
    }
  });

  const statusArb = fc.constantFrom<DayStatus>("done", "done", "done", "made_up", "excused", "grace", "paused", "earned_back");
  const segmentArb = fc.record({
    gap: fc.integer({ min: 0, max: 4 }),
    length: fc.integer({ min: 1, max: 70 }),
    pattern: fc.array(statusArb, { minLength: 1, maxLength: 4 }),
    fullEvery: fc.integer({ min: 0, max: 3 }),
  });
  const historyArb = fc.record({
    segments: fc.array(segmentArb, { maxLength: 6 }),
    /** Where the history ends relative to today; positive values leave future excused days. */
    endOffset: fc.integer({ min: -9, max: 2 }),
    pause: fc.option(fc.record({ start: fc.integer({ min: -60, max: 6 }), length: fc.integer({ min: -2, max: 20 }) }), { nil: null }),
    withPrayers: fc.boolean(),
    dateOffset: fc.integer({ min: 0, max: 7 }),
    minutes: fc.array(fc.integer({ min: 0, max: 24 * 60 - 1 }), { minLength: 1, maxLength: 3 }),
  });

  type Segment = { gap: number; length: number; pattern: DayStatus[]; fullEvery: number };

  function buildHistory(segments: readonly Segment[], endOffset: number) {
    const result: HabitDay[] = [];
    let cursor = addDays(TODAY, endOffset);
    for (const segment of [...segments].reverse()) {
      for (let index = segment.length - 1; index >= 0; index -= 1) {
        const status = segment.pattern[index % segment.pattern.length];
        // Future days can only be excused.
        if (cursor <= TODAY || status === "excused") {
          result.push({ localDate: cursor, status, fullMet: segment.fullEvery > 0 && index % segment.fullEvery === 0 });
        }
        cursor = addDays(cursor, -1);
      }
      cursor = addDays(cursor, -segment.gap);
    }
    return result.reverse();
  }

  it("matches the full replay on generated histories", () => {
    fc.assert(
      fc.property(historyArb, (scenario) => {
        const days = buildHistory(scenario.segments, scenario.endOffset);
        const pause = scenario.pause
          ? { start: addDays(TODAY, scenario.pause.start), end: addDays(TODAY, scenario.pause.start + scenario.pause.length) }
          : null;
        const input = projectionInput(days, pause, scenario.withPrayers);
        const date = addDays(TODAY, scenario.dateOffset);
        expectSameAsReplay(input, TODAY, [TODAY, date], (day) => [
          ...scenario.minutes.map((minutes) => CLOCK.at(day, minutes)),
          CLOCK.at(day, 12 * 60 + 29),
          CLOCK.at(day, 12 * 60 + 31),
        ]);
      }),
      { numRuns: 300 },
    );
  });

  it("falls back to the full replay before its start date", () => {
    const input = projectionInput(longHistory(90), null, false);
    const project = createHabitProjector(input, TODAY);
    const earlier = addDays(TODAY, -3);
    expect(project(earlier, CLOCK.at(earlier, 9 * 60))).toEqual(replayHabit(input, earlier, CLOCK.at(earlier, 9 * 60)));
  });
});
