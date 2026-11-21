import type { LocalDate } from "@/lib/habit/dates";
import { isStreakMilestone } from "@/lib/habit/milestones";
import { formatDays, formatMinutes, formatNumber, formatPages } from "@/lib/i18n/count";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { formatClockMinutesForDisplay, type DayClock } from "@/lib/notifications/clock";
import type { HabitProjection } from "@/lib/notifications/habit-projection";
import type { WidgetEntryContent, WidgetImage, WidgetMarker, WidgetState, WidgetTap } from "@/lib/widget/types";

/** Spec 4.4: today's plan facts, read once per build. */
export type WidgetPlanFacts = Readonly<{
  /** The local date these facts describe: today at build time. */
  date: LocalDate;
  /** "pages" for page and half-page plans, "ayah" for the ayah unit, "none" without a hifz plan. */
  plan: "pages" | "ayah" | "none";
  /** Review still due today, as Home's reviewLeftToday. Always false for "none" (Home parity). */
  reviewLeft: boolean;
  /** wird.todo.length for "pages", otherwise 0. */
  pagesLeft: number;
  /** max(1, round(wird.remainingMinutes)) when pagesLeft > 0, otherwise 0. */
  minutesLeft: number;
  /** When more review comes due later today, or null. */
  moreDueAt: Date | null;
}>;

export type WidgetCopyInput = Readonly<{
  clock: DayClock;
  eveningStartsAt: (date: LocalDate) => Date;
  plan: WidgetPlanFacts;
  language: "en" | "ar";
  showZayt: boolean;
  showNumbers: boolean;
}>;

type Language = "en" | "ar";

const MARKERS: Record<WidgetState, WidgetMarker> = {
  begin: "begin",
  fresh_start: "begin",
  open_day: "open",
  open_evening: "open",
  make_up: "open",
  earn_back_open: "open",
  earn_back_done: "done",
  done: "done",
  safe: "done",
  milestone: "done",
  kept: "kept",
  paused: "paused",
};

// v1 image values remain readable by older APKs. The current Android renderer uses the
// explicit widget state to refine these base poses and null as the Show Zayt opt-out.
const IMAGES: Record<WidgetState, WidgetImage> = {
  begin: "rest",
  fresh_start: "rest",
  open_day: "rest",
  open_evening: "rest",
  make_up: "rest",
  earn_back_open: "rest",
  earn_back_done: "warm",
  done: "warm",
  safe: "warm",
  milestone: "glow",
  kept: "sit",
  paused: "sit",
};

/** States that show the streak length as their count (spec 4.2). */
const COUNTED: ReadonlySet<WidgetState> = new Set<WidgetState>([
  "open_day",
  "open_evening",
  "make_up",
  "done",
  "safe",
  "milestone",
  "kept",
  "paused",
]);

type Note = "graceUsed" | "plan" | "graceHeld" | "longest";

/**
 * "Feb 3" in English, "٣ فبراير" in Arabic with Arabic-Indic digits. The local date is formatted at
 * UTC midnight in UTC, so the device zone never moves it to another day.
 */
export function formatWidgetDate(date: LocalDate, language: Language): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "ar" ? "ar-u-nu-arab" : "en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** "A. B. C." from parts: each trimmed, a trailing period dropped, empty parts skipped. */
export function joinSentences(parts: readonly (string | null | undefined)[]): string {
  const sentences = parts
    .map((part) => (part ?? "").trim().replace(/\.+$/, "").trim())
    .filter((part) => part.length > 0);
  return sentences.length === 0 ? "" : `${sentences.join(". ")}.`;
}

/**
 * Today's plan facts apply at `at` while it is still their date and no more review has come due.
 * From moreDueAt until midnight review is left for certain, so the plan line is hidden.
 */
function planAt(plan: WidgetPlanFacts, clock: DayClock, at: Date): { valid: boolean; reviewLeft: boolean } {
  if (clock.dateOf(at) !== plan.date) return { valid: false, reviewLeft: false };
  if (plan.moreDueAt && at.getTime() >= plan.moreDueAt.getTime()) return { valid: false, reviewLeft: true };
  return { valid: true, reviewLeft: plan.reviewLeft };
}

/** Spec 4.1: the first match wins, keeping lib/habit's own headline precedence. */
function stateOf(projection: HabitProjection, at: Date, input: WidgetCopyInput, reviewLeft: boolean): WidgetState {
  const { headline, streak } = projection.snapshot;
  switch (headline.kind) {
    case "earn_back":
      return streak.doneToday ? "earn_back_done" : "earn_back_open";
    case "make_up_open":
      return "make_up";
    case "done_today":
      if (isStreakMilestone(headline.length)) return "milestone";
      return reviewLeft ? "safe" : "done";
    case "excused_today":
      return "kept";
    case "paused":
      return "paused";
    case "at_risk":
      return at.getTime() >= input.eveningStartsAt(input.clock.dateOf(at)).getTime() ? "open_evening" : "open_day";
    case "fresh_start":
      return "fresh_start";
    case "empty":
      return "begin";
    default: {
      const unknown: never = headline;
      return unknown;
    }
  }
}

function notesFor(state: WidgetState, reviewLeft: boolean): readonly Note[] {
  switch (state) {
    case "fresh_start":
      return ["longest"];
    case "open_day":
    case "open_evening":
      return ["graceUsed", "plan", "graceHeld"];
    case "make_up":
      return ["plan", "graceHeld"];
    case "earn_back_open":
      return ["plan"];
    case "done":
      return ["graceUsed", "graceHeld"];
    case "safe":
      return ["plan", "graceUsed", "graceHeld"];
    case "milestone":
      return reviewLeft ? ["plan", "graceUsed", "graceHeld"] : ["graceUsed", "graceHeld"];
    default:
      return [];
  }
}

/**
 * Spec 4.2 and 4.3: everything one entry shows, worded in the app language. With Show numbers off
 * the entry carries no streak length, day counts, grace count or plan figures, in text or label.
 */
export function describeWidgetEntry(projection: HabitProjection, at: Date, input: WidgetCopyInput): WidgetEntryContent {
  const { language, showNumbers, clock } = input;
  const s = strings[language];
  const { snapshot } = projection;
  const { headline: h } = snapshot;
  const plan = planAt(input.plan, clock, at);
  const state = stateOf(projection, at, input, plan.reviewLeft);

  const length = "length" in h ? h.length : 0;
  const count = showNumbers && COUNTED.has(state) && length > 0 ? formatNumber(length, language) : null;
  const time = h.kind === "make_up_open" ? formatClockMinutesForDisplay(clock.minutesOf(h.cutoff), language) : "";
  const earnBack = h.kind === "earn_back" ? h.earnBack : null;
  const earnBackValues = earnBack
    ? {
        done: formatNumber(earnBack.daysDone, language),
        n: formatNumber(earnBack.brokenLength, language),
        days: formatDays(earnBack.brokenLength, language),
      }
    : { done: "", n: "", days: "" };
  const doneOrSafeHeadline = plan.reviewLeft ? s.widgetSafeHeadline : s.habitDoneToday;
  const doneOrSafeDetail = plan.reviewLeft ? s.widgetSafeDetail : s.habitCommitted;

  let headline: string;
  let detail: string;
  switch (state) {
    case "begin":
      headline = s.habitBeginToday;
      detail = s.widgetBeginDetail;
      break;
    case "fresh_start":
      headline = s.widgetFreshStartHeadline;
      detail = s.widgetFreshStartDetail;
      break;
    case "open_day":
      headline = s.widgetOpenHeadline;
      detail = s.habitAtRisk;
      break;
    case "open_evening":
      headline = s.notifTitleLate;
      detail = s.widgetEveningDetail;
      break;
    case "make_up":
      headline = interpolate(s.widgetMakeUpHeadline, { time });
      detail = interpolate(s.habitMakeUpOpen, { time });
      break;
    case "earn_back_open":
      headline = showNumbers ? interpolate(s.widgetEarnBackHeadline, earnBackValues) : s.widgetEarnBackHeadlinePlain;
      detail = showNumbers ? interpolate(s.widgetEarnBackDetail, earnBackValues) : s.widgetEarnBackDetailPlain;
      break;
    case "earn_back_done":
      headline = showNumbers
        ? interpolate(s.widgetEarnBackDoneHeadline, earnBackValues)
        : s.widgetEarnBackDoneHeadlinePlain;
      detail = showNumbers ? interpolate(s.widgetEarnBackDoneDetail, earnBackValues) : s.widgetEarnBackDoneDetailPlain;
      break;
    case "done":
      headline = s.habitDoneToday;
      detail = s.habitCommitted;
      break;
    case "safe":
      headline = s.widgetSafeHeadline;
      detail = s.widgetSafeDetail;
      break;
    case "milestone":
      headline = showNumbers
        ? interpolate(s.habitMilestoneTitle, { days: formatDays(length, language) })
        : doneOrSafeHeadline;
      detail = showNumbers ? (plan.reviewLeft ? s.widgetSafeDetail : s.habitDoneToday) : doneOrSafeDetail;
      break;
    case "kept":
      headline = s.widgetKeptHeadline;
      detail = s.widgetKeptDetail;
      break;
    case "paused":
      headline = interpolate(s.widgetPausedHeadline, {
        date: h.kind === "paused" ? formatWidgetDate(h.until, language) : "",
      });
      detail = s.widgetPausedDetail;
      break;
    default: {
      const unknown: never = state;
      throw new Error(`Unknown widget state ${String(unknown)}`);
    }
  }

  const noteText = (note: Note): string | null => {
    switch (note) {
      case "graceUsed":
        return snapshot.recentGraceDay !== null ? s.widgetGraceUsedNote : null;
      case "plan":
        return plan.valid && input.plan.plan === "pages" && input.plan.pagesLeft > 0 && showNumbers
          ? interpolate(s.hifzPagesLeft, {
              pages: formatPages(input.plan.pagesLeft, language),
              minutes: formatMinutes(input.plan.minutesLeft, language),
            })
          : null;
      case "graceHeld":
        return snapshot.graceHeld > 0 && showNumbers
          ? interpolate(s.habitGraceHeld, { n: formatNumber(snapshot.graceHeld, language) })
          : null;
      case "longest":
        return snapshot.longest > 0 && showNumbers
          ? interpolate(s.habitLongest, { days: formatDays(snapshot.longest, language) })
          : null;
    }
  };
  let note: string | null = null;
  for (const candidate of notesFor(state, plan.reviewLeft)) {
    note = noteText(candidate);
    if (note !== null) break;
  }

  const tap: WidgetTap =
    state === "milestone"
      ? plan.reviewLeft
        ? "wird"
        : "home"
      : state === "begin" || state === "earn_back_done" || state === "done" || state === "kept" || state === "paused"
        ? "home"
        : "wird";

  return {
    state,
    marker: MARKERS[state],
    count,
    countCaption: count === null ? null : s.widgetCountCaption,
    headline,
    detail,
    note,
    image: input.showZayt ? IMAGES[state] : null,
    contentDescription: joinSentences([
      s.appName,
      count === null ? null : interpolate(s.habitStreakCount, { days: formatDays(length, language) }),
      headline,
      detail,
      note,
    ]),
    tap,
  };
}
