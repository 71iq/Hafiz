import type { LocalDate } from "@/lib/habit/dates";
import type { EarnBack } from "@/lib/habit/earn-back";
import type { HabitHeadline, HabitSnapshot } from "@/lib/habit/snapshot";
import { strings } from "@/lib/i18n/strings";
import { formatMinutes, formatNumber, formatPages } from "@/lib/i18n/count";
import type { DayClock } from "@/lib/notifications/clock";
import type { HabitProjection } from "@/lib/notifications/habit-projection";
import {
  describeWidgetEntry,
  formatWidgetDate,
  joinSentences,
  widgetBandAt,
  widgetWeek,
  type WidgetBand,
  type WidgetPlanFacts,
} from "@/lib/widget/copy";
import { WIDGET_STATES, type WidgetEntryContent, type WidgetState } from "@/lib/widget/types";

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
const D: LocalDate = "2026-11-23";
const EVENING_STARTS = (date: LocalDate) => CLOCK.at(date, 21 * 60);
const MORNING = CLOCK.at(D, 9 * 60);
const EVENING = CLOCK.at(D, 21 * 60);

type Values = Readonly<{
  length: number;
  longest: number;
  graceHeld: number;
  graceUsed: boolean;
  brokenLength: number;
  daysDone: number;
  cutoffMinutes: number;
  until: LocalDate;
  pagesLeft: number;
  minutesLeft: number;
}>;

/** The longest realistic values: a streak of 9999 days, the whole mushaf left, a late cutoff, December. */
const EXTREME: Values = {
  length: 9999,
  longest: 9999,
  graceHeld: 2,
  graceUsed: true,
  brokenLength: 9999,
  daysDone: 2,
  cutoffMinutes: 12 * 60 + 59,
  until: "2026-12-28",
  pagesLeft: 604,
  minutesLeft: 3020,
};

/** Values that cannot appear by accident, for the Show numbers check. */
const DISTINCT: Values = {
  length: 4321,
  longest: 8765,
  graceHeld: 2,
  graceUsed: true,
  brokenLength: 5432,
  daysDone: 2,
  cutoffMinutes: 12 * 60 + 30,
  until: "2026-11-25",
  pagesLeft: 37,
  minutesLeft: 185,
};

function earnBack(values: Values): EarnBack {
  return {
    brokenLength: values.brokenLength,
    lastDay: "2026-11-20",
    windowStart: "2026-11-22",
    windowEnd: "2026-11-24",
    daysDone: values.daysDone,
    fullDone: 0,
    succeeded: false,
    restoreDays: [],
  };
}

/** A projection whose snapshot leads to `state` at `at`, with `values` in every field the copy reads. */
function projectionFor(
  state: WidgetState,
  values: Values,
): { projection: HabitProjection; at: Date; reviewLeft: boolean } {
  const milestoneLength = values.length >= 400 ? Math.floor(values.length / 100) * 100 : 7;
  const headlines: Record<WidgetState, HabitHeadline> = {
    begin: { kind: "empty" },
    fresh_start: { kind: "fresh_start", longest: values.longest },
    open_day: { kind: "at_risk", length: values.length },
    open_evening: { kind: "at_risk", length: values.length },
    make_up: { kind: "make_up_open", length: values.length, cutoff: CLOCK.at(D, values.cutoffMinutes) },
    earn_back_open: { kind: "earn_back", earnBack: earnBack(values) },
    earn_back_done: { kind: "earn_back", earnBack: earnBack(values) },
    done: { kind: "done_today", length: values.length === 7 ? 8 : values.length },
    safe: { kind: "done_today", length: values.length === 7 ? 8 : values.length },
    milestone: { kind: "done_today", length: milestoneLength },
    kept: { kind: "excused_today", length: values.length },
    paused: { kind: "paused", length: values.length, until: values.until },
  };
  const headline = headlines[state];
  // While earning back, the new run counts the days recited since the break; today is one of them once done.
  const length = "length" in headline ? headline.length : state === "earn_back_done" ? values.daysDone : 0;
  const snapshot: HabitSnapshot = {
    today: D,
    streak: {
      length,
      startDay: length > 0 ? "2000-01-01" : null,
      lastCoveredDay: length > 0 ? D : null,
      todayStatus: state === "earn_back_done" || headline.kind === "done_today" ? "done" : null,
      doneToday: state === "earn_back_done" || headline.kind === "done_today",
      atRisk: headline.kind === "at_risk",
      makeUpPending: headline.kind === "make_up_open",
    },
    headline,
    longest: values.longest,
    graceHeld: values.graceHeld,
    recentGraceDay: values.graceUsed ? "2026-11-22" : null,
    goal: null,
    nextMilestone: 10_000,
    tier: 6,
  };
  return {
    projection: { snapshot, days: [] },
    at: state === "open_evening" ? EVENING : MORNING,
    reviewLeft: state === "safe",
  };
}

function describe1(
  state: WidgetState,
  values: Values,
  language: "en" | "ar",
  showNumbers: boolean,
  reviewLeft?: boolean,
  atMinutes?: number,
): WidgetEntryContent {
  const { projection, at: stateAt, reviewLeft: stateReviewLeft } = projectionFor(state, values);
  const at = atMinutes === undefined ? stateAt : CLOCK.at(D, atMinutes);
  const plan: WidgetPlanFacts = {
    date: D,
    plan: "pages",
    reviewLeft: reviewLeft ?? stateReviewLeft,
    pagesLeft: values.pagesLeft,
    minutesLeft: values.minutesLeft,
    moreDueAt: null,
  };
  const entry = describeWidgetEntry(projection, at, {
    clock: CLOCK,
    eveningStartsAt: EVENING_STARTS,
    plan,
    language,
    showZayt: true,
    showNumbers,
  });
  expect(entry.state).toBe(state);
  return entry;
}

const texts = (entry: WidgetEntryContent) =>
  [entry.count, entry.line, entry.note, entry.contentDescription].filter((value): value is string => value !== null);

/** Every state, both languages, Show numbers on and off, and for milestones both review-left cases. */
function* everyEntry(values: Values) {
  for (const language of ["en", "ar"] as const) {
    for (const showNumbers of [true, false]) {
      for (const state of WIDGET_STATES) {
        const reviewCases = state === "milestone" ? [false, true] : [undefined];
        for (const reviewLeft of reviewCases) {
          yield { language, showNumbers, state, entry: describe1(state, values, language, showNumbers, reviewLeft) };
        }
      }
    }
  }
}

describe("widget copy rules (spec 4.3)", () => {
  it("keeps lines to 30 and notes to 40 characters with realistic extremes", () => {
    for (const cutoffMinutes of [0, 11 * 60 + 11, 12 * 60 + 59, 23 * 60 + 59]) {
      for (const until of ["2026-01-01", "2026-09-28", "2026-12-28"]) {
        for (const { language, state, entry } of everyEntry({ ...EXTREME, cutoffMinutes, until })) {
          const where = `${language} ${state}`;
          expect({ where, line: (entry.line ?? "").length <= 30 }).toEqual({ where, line: true });
          expect({ where, note: (entry.note ?? "").length <= 40 }).toEqual({ where, note: true });
          expect(entry.count === null || entry.count.length <= 12).toBe(true);
          expect(entry.contentDescription.length).toBeLessThanOrEqual(400);
        }
      }
    }
  });

  it("never names an excuse, leaves no placeholder and uses each language's digits", () => {
    for (const values of [EXTREME, DISTINCT]) {
      for (const { language, state, entry } of everyEntry(values)) {
        for (const text of texts(entry)) {
          const where = `${language} ${state}: ${text}`;
          expect({ where, excuse: /excus|عذر|معذور|illness|travel|menstruation|مرض|سفر|حيض/i.test(text) }).toEqual({
            where,
            excuse: false,
          });
          expect({ where, placeholder: text.includes("{{") }).toEqual({ where, placeholder: false });
          const wrongDigits = language === "ar" ? /[0-9]/ : /[٠-٩]/;
          expect({ where, wrongDigits: wrongDigits.test(text) }).toEqual({ where, wrongDigits: false });
        }
      }
    }
  });

  it("keeps every figure out of the text and label when Show numbers is off", () => {
    for (const { language, showNumbers, state, entry } of everyEntry(DISTINCT)) {
      if (showNumbers) continue;
      const s = strings[language];
      const where = `${language} ${state}: ${texts(entry).join(" | ")}`;
      expect({ where, count: entry.count }).toEqual({ where, count: null });
      expect({ where, line: entry.line !== null }).toEqual({ where, line: true });
      for (const text of texts(entry)) {
        expect({ where, length: text.includes(formatNumber(DISTINCT.length, language)) }).toEqual({
          where,
          length: false,
        });
        expect({ where, longest: text.includes(formatNumber(DISTINCT.longest, language)) }).toEqual({
          where,
          longest: false,
        });
        expect({ where, broken: text.includes(formatNumber(DISTINCT.brokenLength, language)) }).toEqual({
          where,
          broken: false,
        });
        expect({ where, pages: text.includes(formatPages(DISTINCT.pagesLeft, language)) }).toEqual({
          where,
          pages: false,
        });
        expect({ where, minutes: text.includes(formatMinutes(DISTINCT.minutesLeft, language)) }).toEqual({
          where,
          minutes: false,
        });
      }
      expect(
        entry.note === null ||
          ![s.habitGraceHeld.split("{{")[0], s.habitLongest.split("{{")[0]].some((prefix) =>
            entry.note!.startsWith(prefix),
          ),
      ).toBe(true);
      if (state === "earn_back_open") {
        expect(entry.line).toBe(s.widgetEarnBackHeadlinePlain);
        expect(entry.contentDescription).toContain(s.widgetEarnBackDetailPlain);
      }
      if (state === "earn_back_done") {
        expect(entry.line).toBe(s.widgetEarnBackDoneHeadlinePlain);
        expect(entry.contentDescription).toContain(s.widgetEarnBackDoneDetailPlain);
      }
    }
  });

  it("chooses the scene, Zayt, flame and tap of each state by day (spec 4.2, 4.6)", () => {
    const expected: Record<WidgetState, [string, string, string, string]> = {
      begin: ["dawn", "wave", "out", "home"],
      fresh_start: ["dawn", "wave", "out", "wird"],
      open_day: ["morning", "rest", "unlit", "wird"],
      open_evening: ["dusk", "glow", "unlit", "wird"],
      make_up: ["dawn", "wave", "unlit", "wird"],
      earn_back_open: ["morning", "rest", "out", "wird"],
      earn_back_done: ["sunrise", "open", "lit", "home"],
      done: ["radiant", "shimmer", "lit", "home"],
      safe: ["radiant", "warm", "lit", "wird"],
      milestone: ["milestone", "milestone", "lit", "home"],
      kept: ["calm", "sit", "lit", "home"],
      paused: ["calm", "sit", "unlit", "home"],
    };
    for (const state of WIDGET_STATES) {
      const entry = describe1(state, DISTINCT, "en", true);
      expect([state, entry.scene, entry.pose, entry.flame, entry.tap]).toEqual([state, ...expected[state]]);
    }
    expect(describe1("milestone", DISTINCT, "en", true, true).tap).toBe("wird");
  });

  it("darkens the sky of an open day towards midnight while Zayt's light grows, and turns a done night gold", () => {
    const at = (minutes: number) =>
      describe1(minutes >= 21 * 60 ? "open_evening" : "open_day", DISTINCT, "en", true, undefined, minutes);
    const rows = [
      [9 * 60, "morning", "rest", strings.en.widgetOpenHeadline],
      [12 * 60, "day", "wave", strings.en.widgetLineDay],
      [16 * 60, "golden", "warm", strings.en.widgetLineGolden],
      [22 * 60, "night", "open_halo", strings.en.widgetLineNight],
      [23 * 60 + 30, "midnight", "glow_halo", strings.en.widgetLineMidnight],
    ] as const;
    for (const [minutes, scene, pose, line] of rows) {
      const entry = at(minutes);
      expect([minutes, entry.scene, entry.pose, entry.line]).toEqual([minutes, scene, pose, line]);
    }
    const dusk = describe1("open_evening", DISTINCT, "en", true);
    expect([dusk.scene, dusk.pose, dusk.line]).toEqual(["dusk", "glow", strings.en.notifTitleLate]);
    const doneLate = describe1("done", DISTINCT, "en", true, undefined, 22 * 60 + 30);
    expect([doneLate.scene, doneLate.pose, doneLate.flame]).toEqual(["radiant_night", "shimmer_halo", "lit"]);
    const beginLate = describe1("begin", DISTINCT, "en", true, undefined, 21 * 60 + 30);
    expect([beginLate.scene, beginLate.pose]).toEqual(["night", "glow_halo"]);
  });

  it("shows a zero streak as 0 with an unlit flame, in each language's digits", () => {
    for (const state of ["begin", "fresh_start"] as const) {
      const english = describe1(state, DISTINCT, "en", true);
      const arabic = describe1(state, DISTINCT, "ar", true);
      expect([state, english.count, arabic.count, english.flame, english.tier]).toEqual([state, "0", "٠", "out", 0]);
      expect(english.line).not.toBeNull();
    }
    expect(describe1("begin", DISTINCT, "en", true).line).toBe(strings.en.widgetLineBegin);
  });

  it("drops the words a lit flame already says, and keeps a line when numbers are hidden", () => {
    expect(describe1("done", DISTINCT, "en", true).line).toBeNull();
    expect(describe1("milestone", DISTINCT, "en", true).line).toBeNull();
    expect(describe1("milestone", DISTINCT, "en", true, true).line).toBe(strings.en.widgetLineSafe);
    expect(describe1("done", DISTINCT, "en", false).line).toBe(strings.en.widgetLineDone);
    expect(describe1("done", DISTINCT, "en", true).contentDescription).toContain(strings.en.habitDoneToday);
  });

  it("gives the lit flame the streak's stage and leaves Zayt out when Show Zayt is off", () => {
    expect(describe1("done", { ...DISTINCT, length: 6 }, "en", true).tier).toBe(0);
    expect(describe1("done", { ...DISTINCT, length: 31 }, "en", true).tier).toBe(3);
    expect(describe1("done", { ...DISTINCT, length: 401 }, "en", true).tier).toBe(6);
    const { projection, at } = projectionFor("done", DISTINCT);
    const plain = describeWidgetEntry(projection, at, {
      clock: CLOCK,
      eveningStartsAt: EVENING_STARTS,
      plan: { date: D, plan: "none", reviewLeft: false, pagesLeft: 0, minutesLeft: 0, moreDueAt: null },
      language: "en",
      showZayt: false,
      showNumbers: true,
    });
    expect([plain.pose, plain.scene]).toEqual([null, "radiant"]);
  });
});

describe("the widget's sky bands (spec 4.6)", () => {
  const band = (minutes: number, eveningMinutes = 21 * 60): WidgetBand =>
    widgetBandAt(CLOCK.at(D, minutes), CLOCK, (date) => CLOCK.at(date, eveningMinutes));

  it("moves through the local day at noon, 16:00, the evening start, 22:00 and 23:00", () => {
    expect(
      [
        0,
        11 * 60 + 59,
        12 * 60,
        15 * 60 + 59,
        16 * 60,
        20 * 60 + 59,
        21 * 60,
        21 * 60 + 59,
        22 * 60,
        22 * 60 + 59,
        23 * 60,
        23 * 60 + 59,
      ].map((m) => band(m)),
    ).toEqual([
      "morning",
      "morning",
      "day",
      "day",
      "golden",
      "golden",
      "dusk",
      "dusk",
      "night",
      "night",
      "midnight",
      "midnight",
    ]);
  });

  it("lets an early evening start open dusk before 16:00, and a late one skip dusk", () => {
    expect(band(15 * 60, 14 * 60 + 30)).toBe("dusk");
    expect(band(22 * 60 + 20, 22 * 60 + 45)).toBe("night");
    expect(band(21 * 60 + 50, 22 * 60 + 45)).toBe("golden");
  });
});

describe("the 4 by 2 widget's week row (spec 4.7)", () => {
  const day = (localDate: LocalDate, status: "done" | "made_up" | "earned_back" | "excused" | "paused" | "grace") => ({
    localDate,
    status,
    fullMet: false,
  });

  it("marks recited days lit, grace, excuses and pauses kept, and nothing as an empty ring", () => {
    const week = widgetWeek(
      [
        day("2026-11-17", "done"),
        day("2026-11-18", "grace"),
        day("2026-11-20", "made_up"),
        day("2026-11-21", "excused"),
      ],
      D,
      false,
      "en",
    );
    expect(week.map((entry) => entry.mark)).toEqual(["lit", "kept", "empty", "lit", "kept", "empty", "open"]);
    expect(week.map((entry) => entry.label).join("")).toBe("TWTFSSM");
  });

  it("lights today once it counts, keeps an excused today, and writes Arabic weekday letters", () => {
    expect(widgetWeek([], D, true, "en")[6].mark).toBe("lit");
    expect(widgetWeek([day(D, "excused")], D, true, "en")[6].mark).toBe("kept");
    expect(
      widgetWeek([], D, false, "ar")
        .map((entry) => entry.label)
        .join(""),
    ).toBe("ثرخجسحن");
  });
});

describe("widget copy helpers", () => {
  it("formats the pause date in the interface language, on the stored local date", () => {
    expect(formatWidgetDate("2026-11-25", "en")).toBe("Nov 25");
    expect(formatWidgetDate("2026-11-25", "ar")).toMatch(/^٢٥ /);
    expect(formatWidgetDate("2026-01-01", "en")).toBe("Jan 1");
  });

  it("joins sentences with one period each", () => {
    expect(joinSentences(["Hafiz", " Streak: 12 days ", "Done.", null, "", "Note"])).toBe(
      "Hafiz. Streak: 12 days. Done. Note.",
    );
    expect(joinSentences([])).toBe("");
  });
});
