import { addDays, weekdayOf, type LocalDate } from "@/lib/habit/dates";
import { isStreakMilestone, streakTier } from "@/lib/habit/milestones";
import { formatDays, formatMinutes, formatNumber, formatPages } from "@/lib/i18n/count";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { formatClockMinutesForDisplay, type DayClock } from "@/lib/notifications/clock";
import type { HabitDay } from "@/lib/habit/types";
import type { HabitProjection } from "@/lib/notifications/habit-projection";
import type {
  WidgetDayMark,
  WidgetEntryContent,
  WidgetFlame,
  WidgetPose,
  WidgetScene,
  WidgetState,
  WidgetTap,
} from "@/lib/widget/types";

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

/** The part of the local day an entry falls in. It picks the sky, not the streak rules. */
export type WidgetBand = "morning" | "day" | "golden" | "dusk" | "night" | "midnight";

const NOON = 12 * 60;
const GOLDEN_HOUR = 16 * 60;
const NIGHT = 22 * 60;
const LAST_HOUR = 23 * 60;

/** Wall-clock minutes at which the band can change, besides the evening start. */
export const WIDGET_BAND_MINUTES: readonly number[] = [NOON, GOLDEN_HOUR, NIGHT, LAST_HOUR];

/** Spec 4.6: the sky follows the local day; the evening start (spec 4.5) opens dusk. */
export function widgetBandAt(at: Date, clock: DayClock, eveningStartsAt: (date: LocalDate) => Date): WidgetBand {
  const minutes = clock.minutesOf(at);
  if (minutes >= LAST_HOUR) return "midnight";
  if (minutes >= NIGHT) return "night";
  if (at.getTime() >= eveningStartsAt(clock.dateOf(at)).getTime()) return "dusk";
  if (minutes >= GOLDEN_HOUR) return "golden";
  if (minutes >= NOON) return "day";
  return "morning";
}

const OPEN_ART: Record<WidgetBand, readonly [WidgetScene, WidgetPose]> = {
  morning: ["morning", "rest"],
  day: ["day", "wave"],
  golden: ["golden", "warm"],
  dusk: ["dusk", "glow"],
  night: ["night", "open_halo"],
  midnight: ["midnight", "glow_halo"],
};

/**
 * Spec 4.6: the scene and Zayt's still. While today is open the sky darkens towards midnight and
 * Zayt's own light grows; urgency never shows on Zayt's face. Done days turn gold, by night too.
 */
export function widgetArt(state: WidgetState, band: WidgetBand): readonly [WidgetScene, WidgetPose] {
  const dark = band === "dusk" || band === "night" || band === "midnight";
  switch (state) {
    case "begin":
    case "fresh_start":
      return dark ? ["night", "glow_halo"] : ["dawn", "wave"];
    case "make_up":
      return ["dawn", "wave"];
    case "open_day":
    case "open_evening":
    case "earn_back_open":
      return OPEN_ART[band];
    case "earn_back_done":
      return dark ? ["radiant_night", "open_halo"] : ["sunrise", "open"];
    case "done":
      return dark ? ["radiant_night", "shimmer_halo"] : ["radiant", "shimmer"];
    case "safe":
      return dark ? ["radiant_night", "warm_halo"] : ["radiant", "warm"];
    case "milestone":
      return ["milestone", "milestone"];
    case "kept":
    case "paused":
      return ["calm", "sit"];
    default: {
      const unknown: never = state;
      throw new Error(`Unknown widget state ${String(unknown)}`);
    }
  }
}

/** Statuses that mean the wird was recited for that day. Grace, excuses and pauses keep a day without it. */
const RECITED: ReadonlySet<HabitDay["status"]> = new Set<HabitDay["status"]>(["done", "made_up", "earned_back"]);

/**
 * Spec 4.7: the week row of the 4 by 2 widget, oldest first and today last. A day with nothing is an
 * empty ring, never a cross: the row shows what was kept, not what was missed.
 */
export function widgetWeek(
  days: readonly HabitDay[],
  today: LocalDate,
  todayLit: boolean,
  language: Language,
): readonly { mark: WidgetDayMark; label: string }[] {
  const statuses = new Map(days.map((day) => [day.localDate, day.status]));
  // Sunday first. Fixed letters rather than Intl, whose narrow weekdays vary by engine.
  const letters = strings[language].widgetWeekdayLetters.split(" ");
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - 6);
    const status = statuses.get(date);
    const mark: WidgetDayMark =
      date === today
        ? status && !RECITED.has(status)
          ? "kept"
          : todayLit
            ? "lit"
            : "open"
        : status === undefined
          ? "empty"
          : RECITED.has(status)
            ? "lit"
            : "kept";
    return { mark, label: letters[weekdayOf(date)] };
  });
}

/** Today already counts towards the streak in these states, so the flame is lit. */
const LIT: ReadonlySet<WidgetState> = new Set<WidgetState>(["earn_back_done", "done", "safe", "milestone", "kept"]);

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

  // The streak as it stands, including 0 before the first wird and after a break (spec 4.2).
  const length = snapshot.streak.length;
  const count = showNumbers ? formatNumber(length, language) : null;
  const flame: WidgetFlame = length === 0 ? "out" : LIT.has(state) ? "lit" : "unlit";
  const band = widgetBandAt(at, clock, input.eveningStartsAt);
  const [scene, pose] = widgetArt(state, band);
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
    scene,
    pose: input.showZayt ? pose : null,
    flame,
    tier: streakTier(length),
    count,
    // With no count and nothing else to say, the line still tells a done day apart.
    line: lineFor(state, band, language, headline, plan.reviewLeft) ?? (count === null ? s.widgetLineDone : null),
    note,
    week: widgetWeek(projection.days, clock.dateOf(at), LIT.has(state) && length > 0, language),
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

/**
 * Spec 4.2: the one short line beside the count. Open days say how much of the day is left; a done
 * day says nothing, because the lit flame and the gold scene already do. `headline` is the spoken
 * headline, reused where it is already short.
 */
function lineFor(
  state: WidgetState,
  band: WidgetBand,
  language: Language,
  headline: string,
  reviewLeft: boolean,
): string | null {
  const s = strings[language];
  switch (state) {
    case "begin":
      return s.widgetLineBegin;
    case "fresh_start":
      return s.widgetFreshStartHeadline;
    case "open_day":
    case "open_evening": {
      const lines: Record<WidgetBand, string> = {
        morning: s.widgetOpenHeadline,
        day: s.widgetLineDay,
        golden: s.widgetLineGolden,
        dusk: s.notifTitleLate,
        night: s.widgetLineNight,
        midnight: s.widgetLineMidnight,
      };
      return lines[band];
    }
    case "make_up":
    case "earn_back_open":
    case "earn_back_done":
    case "kept":
    case "paused":
      return headline;
    case "safe":
      return s.widgetLineSafe;
    case "milestone":
      return reviewLeft ? s.widgetLineSafe : null;
    case "done":
      return null;
    default: {
      const unknown: never = state;
      throw new Error(`Unknown widget state ${String(unknown)}`);
    }
  }
}
