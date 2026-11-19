import type { LocalDate } from "@/lib/habit/dates";
import type { EarnBack } from "@/lib/habit/earn-back";
import type { HabitHeadline, HabitSnapshot } from "@/lib/habit/snapshot";
import { strings } from "@/lib/i18n/strings";
import { formatMinutes, formatNumber, formatPages } from "@/lib/i18n/count";
import type { DayClock } from "@/lib/notifications/clock";
import type { HabitProjection } from "@/lib/notifications/habit-projection";
import { describeWidgetEntry, formatWidgetDate, joinSentences, type WidgetPlanFacts } from "@/lib/widget/copy";
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
  const length = "length" in headline ? headline.length : 0;
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
): WidgetEntryContent {
  const { projection, at, reviewLeft: stateReviewLeft } = projectionFor(state, values);
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
    eveningStartsAt: (date) => CLOCK.at(date, 21 * 60),
    plan,
    language,
    showZayt: true,
    showNumbers,
  });
  expect(entry.state).toBe(state);
  return entry;
}

const texts = (entry: WidgetEntryContent) =>
  [entry.count, entry.countCaption, entry.headline, entry.detail, entry.note, entry.contentDescription].filter(
    (value): value is string => value !== null,
  );

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
  it("keeps headlines to 30, details to 90 and notes to 40 characters with realistic extremes", () => {
    for (const cutoffMinutes of [0, 11 * 60 + 11, 12 * 60 + 59, 23 * 60 + 59]) {
      for (const until of ["2026-01-01", "2026-09-28", "2026-12-28"]) {
        for (const { language, state, entry } of everyEntry({ ...EXTREME, cutoffMinutes, until })) {
          const where = `${language} ${state}`;
          expect({ where, headline: entry.headline.length <= 30 }).toEqual({ where, headline: true });
          expect({ where, detail: (entry.detail ?? "").length <= 90 }).toEqual({ where, detail: true });
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
      expect({ where, count: entry.count, caption: entry.countCaption }).toEqual({ where, count: null, caption: null });
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
      if (state === "earn_back_open")
        expect([entry.headline, entry.detail]).toEqual([s.widgetEarnBackHeadlinePlain, s.widgetEarnBackDetailPlain]);
      if (state === "earn_back_done")
        expect([entry.headline, entry.detail]).toEqual([
          s.widgetEarnBackDoneHeadlinePlain,
          s.widgetEarnBackDoneDetailPlain,
        ]);
    }
  });

  it("chooses the marker, image and tap of each state (spec 4.2)", () => {
    const expected: Record<WidgetState, [string, string, string]> = {
      begin: ["begin", "rest", "home"],
      fresh_start: ["begin", "rest", "wird"],
      open_day: ["open", "rest", "wird"],
      open_evening: ["open", "rest", "wird"],
      make_up: ["open", "rest", "wird"],
      earn_back_open: ["open", "rest", "wird"],
      earn_back_done: ["done", "warm", "home"],
      done: ["done", "warm", "home"],
      safe: ["done", "warm", "wird"],
      milestone: ["done", "glow", "home"],
      kept: ["kept", "sit", "home"],
      paused: ["paused", "sit", "home"],
    };
    for (const state of WIDGET_STATES) {
      const entry = describe1(state, DISTINCT, "en", true);
      expect([state, entry.marker, entry.image, entry.tap]).toEqual([state, ...expected[state]]);
    }
    expect(describe1("milestone", DISTINCT, "en", true, true).tap).toBe("wird");
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
