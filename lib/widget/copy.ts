import { addDays, weekdayOf, type LocalDate } from "@/lib/habit/dates";
import { isStreakMilestone, streakTier } from "@/lib/habit/milestones";
import { formatDays, formatMinutes, formatNumber, formatPages } from "@/lib/i18n/count";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { formatClockMinutesForDisplay, type DayClock } from "@/lib/notifications/clock";
import { RECITED_STATUSES, type HabitDay } from "@/lib/habit/types";
import type { HabitProjection } from "@/lib/notifications/habit-projection";
import type {
  WidgetDayMark,
  WidgetEntryContent,
  WidgetFlame,
  WidgetPose,
  WidgetScene,
  WidgetState,
  WidgetTap,
  WidgetUrgencyLevel,
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
  /** When today's wird was finished, or null when it is not done or the time is unknown. */
  todayFinishedAt: Date | null;
}>;

type Language = "en" | "ar";

/**
 * How close the streak is to being lost, from the time left before its deadline: local midnight
 * while today is open, the make-up cutoff while yesterday can still be made up. "none" is a state
 * with nothing at stake today.
 */
export type WidgetUrgency = WidgetUrgencyLevel;

const HOUR = 3_600_000;

/** Hours left at which urgency steps up; for a midnight deadline, 12:00, 16:00, 20:00, 22:00, 23:00. */
export const WIDGET_URGENCY_HOURS: readonly number[] = [12, 8, 4, 2, 1];

/** Spec 4.6: the urgency level `deadline - at` falls in. */
export function widgetUrgencyAt(at: Date, deadline: Date): Exclude<WidgetUrgency, "none"> {
  const left = deadline.getTime() - at.getTime();
  if (left > 12 * HOUR) return "calm";
  if (left > 8 * HOUR) return "steady";
  if (left > 4 * HOUR) return "nudge";
  if (left > 2 * HOUR) return "urgent";
  if (left > HOUR) return "critical";
  return "last";
}

/** The deadline a state counts down to, or null when nothing is at stake today. */
export function widgetDeadline(state: WidgetState, at: Date, clock: DayClock, makeUpCutoff: Date | null): Date | null {
  switch (state) {
    case "open_day":
    case "open_evening":
    case "earn_back_open":
      return clock.at(addDays(clock.dateOf(at), 1), 0);
    case "make_up":
      return makeUpCutoff;
    default:
      return null;
  }
}

type Level = Exclude<WidgetUrgency, "none">;

const LEVELS: readonly Level[] = ["calm", "steady", "nudge", "urgent", "critical", "last"];

/** A finish with this little of the day left earns the relieved face instead of the shimmer. */
const LATE_LEVELS: ReadonlySet<Level> = new Set<Level>(["urgent", "critical", "last"]);

/** The sky for an open day at each level, darkening towards the deadline. */
const OPEN_SCENES: Record<Level, WidgetScene> = {
  calm: "morning",
  steady: "day",
  nudge: "golden",
  urgent: "dusk",
  critical: "night",
  last: "midnight",
};

/**
 * Zayt's still at each level: happy, then eager, impatient, worried, anxious and panicked as the
 * deadline nears (owner decision, 2026-11-21). Night skies take the poses with their own light.
 * Each level offers variants; one is picked per level and day.
 */
const OPEN_POSES: Record<Level, readonly WidgetPose[]> = {
  calm: ["rest", "wave"],
  steady: ["eager", "wave"],
  nudge: ["impatient", "warm"],
  urgent: ["worried", "fretful"],
  critical: ["anxious_halo", "nervous_halo"],
  last: ["panicked_halo", "frantic_halo"],
};

/** The make-up window's dawn turns rose, then red, as the cutoff nears. */
const MAKE_UP_SCENES: Record<Level, WidgetScene> = {
  calm: "dawn",
  steady: "dawn",
  nudge: "dawn",
  urgent: "dawn_rose",
  critical: "dawn_red",
  last: "dawn_red",
};

/** Zayt's faces in the make-up window: the same ladder, without the night halo. */
const MAKE_UP_POSES: Record<Level, readonly WidgetPose[]> = {
  calm: ["wave", "rest"],
  steady: ["eager", "wave"],
  nudge: ["impatient", "warm"],
  urgent: ["worried", "fretful"],
  critical: ["anxious", "nervous"],
  last: ["panicked", "frantic"],
};

/**
 * A stable pick among `count` options for this date and key, so every refresh agrees. FNV-1a with a
 * final mix, so neighbouring dates and keys spread over the options independently; a running
 * character sum would reduce to its parity with two options and flip every level together.
 */
export function widgetVariant(date: LocalDate, key: string, count: number): number {
  let hash = 0x811c9dc5;
  for (const character of `${date}:${key}`) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) % count;
}

/** Zayt's pose at `level`: one per level and day, never the pose the level before showed that day. */
function ladderPose(
  pools: Readonly<Record<Level, readonly WidgetPose[]>>,
  level: Level,
  date: LocalDate,
  key: string,
): WidgetPose {
  let previous: WidgetPose | null = null;
  for (const step of LEVELS) {
    const fresh = pools[step].filter((pose) => pose !== previous);
    const options = fresh.length > 0 ? fresh : pools[step];
    const pose = options[widgetVariant(date, `${key}:${step}`, options.length)];
    if (step === level) return pose;
    previous = pose;
  }
  throw new Error(`Unknown urgency level ${level}`);
}

/** Evening for the done and begin scenes: from the evening start or 20:00, whichever comes first. */
function isEvening(at: Date, clock: DayClock, eveningStartsAt: (date: LocalDate) => Date): boolean {
  return clock.minutesOf(at) >= 20 * 60 || at.getTime() >= eveningStartsAt(clock.dateOf(at)).getTime();
}

/**
 * Spec 4.6: the scene and Zayt's still for a state at this level and time. `finishedLate` is a done
 * day finished with under four hours left, which earns the relieved face.
 */
export function widgetArt(
  state: WidgetState,
  urgency: WidgetUrgency,
  evening: boolean,
  date: LocalDate,
  finishedLate = false,
): readonly [WidgetScene, WidgetPose] {
  const level: Level = urgency === "none" ? "calm" : urgency;
  switch (state) {
    case "begin":
      return evening ? ["night", "glow_halo"] : ["dawn", "wave"];
    case "fresh_start":
      return ["dawn", "lonely"];
    case "make_up":
      return [MAKE_UP_SCENES[level], ladderPose(MAKE_UP_POSES, level, date, "make_up")];
    case "open_day":
    case "open_evening":
    case "earn_back_open":
      return [OPEN_SCENES[level], ladderPose(OPEN_POSES, level, date, "open")];
    case "earn_back_done":
      return evening ? ["radiant_night", "open_halo"] : ["sunrise", "open"];
    case "done":
      if (finishedLate) return ["radiant_night", "relieved_halo"];
      return evening ? ["radiant_night", "shimmer_halo"] : ["radiant", "shimmer"];
    case "safe":
      return evening ? ["radiant_night", "warm_halo"] : ["radiant", "warm"];
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

/**
 * Spec 4.7: the week row of the 4 by 2 widget, oldest first and today last. A recited day is a flame,
 * a day kept by grace, an excuse, a pause or earn-back is a dot, and a day with nothing is an empty
 * ring, never a cross: the row shows what was kept, not what was missed.
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
    // A recorded status wins, so a day recited on another device shows lit even while the headline
    // asks to make up yesterday. Days earned back were restored, not recited (RECITED_STATUSES).
    const mark: WidgetDayMark =
      status !== undefined
        ? RECITED_STATUSES.has(status)
          ? "lit"
          : "kept"
        : date !== today
          ? "empty"
          : todayLit
            ? "lit"
            : "open";
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

/**
 * "A. B? C!" from parts: each trimmed, a trailing period dropped and added back unless the part
 * already ends in a question or exclamation mark, Arabic included. Empty parts are skipped.
 */
export function joinSentences(parts: readonly (string | null | undefined)[]): string {
  return parts
    .map((part) => (part ?? "").trim().replace(/\.+$/, "").trim())
    .filter((part) => part.length > 0)
    .map((part) => (/[?!؟]$/.test(part) ? part : `${part}.`))
    .join(" ");
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
  // Lit once today counts: by the state, or by today's own recitation while yesterday awaits a make-up.
  const todayLit = length > 0 && (LIT.has(state) || snapshot.streak.doneToday);
  const flame: WidgetFlame = length === 0 ? "out" : todayLit ? "lit" : "unlit";
  const date = clock.dateOf(at);
  const deadline = widgetDeadline(state, at, clock, h.kind === "make_up_open" ? h.cutoff : null);
  const urgency: WidgetUrgency = deadline ? widgetUrgencyAt(at, deadline) : "none";
  const [scene, pose] = widgetArt(
    state,
    urgency,
    isEvening(at, clock, input.eveningStartsAt),
    date,
    isFinishedLate(input.todayFinishedAt, date, clock),
  );
  // Loss framing names the streak from the nudge on, when Show numbers is on (owner decision). The
  // number stays on one line with its unit.
  const days = showNumbers && length > 0 ? keepTogether(formatDays(length, language)) : null;
  const time =
    h.kind === "make_up_open" ? keepTogether(formatClockMinutesForDisplay(clock.minutesOf(h.cutoff), language)) : "";
  const earnBack = h.kind === "earn_back" ? h.earnBack : null;
  const earnBackValues = earnBack
    ? {
        done: formatNumber(earnBack.daysDone, language),
        n: formatNumber(earnBack.brokenLength, language),
        days: keepTogether(formatDays(earnBack.brokenLength, language)),
      }
    : { done: "", n: "", days: "" };
  const doneOrSafeHeadline = plan.reviewLeft ? s.widgetSafeHeadline : s.habitDoneToday;
  const doneOrSafeDetail = plan.reviewLeft ? s.widgetSafeDetail : s.habitCommitted;

  let headline: string;
  let detail: string;
  switch (state) {
    case "begin":
      headline = s.widgetLineBegin;
      detail = s.widgetBeginDetail;
      break;
    case "fresh_start": {
      const lines = [s.widgetLineFresh, s.widgetLineFresh2];
      headline = lines[widgetVariant(date, "fresh", lines.length)];
      detail = s.widgetFreshStartDetail;
      break;
    }
    case "open_day":
      headline = openLine(urgency === "none" ? "calm" : urgency, date, s, days);
      detail = s.habitAtRisk;
      break;
    case "open_evening":
      headline = openLine(urgency === "none" ? "calm" : urgency, date, s, days);
      detail = s.widgetEveningDetail;
      break;
    case "make_up":
      headline = interpolate(
        urgency === "urgent" || urgency === "critical" || urgency === "last"
          ? s.widgetLineMakeUpLast
          : s.widgetMakeUpHeadline,
        { time },
      );
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

  // With no count and nothing else to say, the line still tells a done day apart; the label then says
  // it in place of the done headline, which means the same.
  const ownLine = lineFor(state, language, headline, plan.reviewLeft);
  const line = ownLine ?? (count === null ? s.widgetLineDone : null);
  const spokenHeadline = ownLine === null && line !== null ? null : headline === line ? null : headline;

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
    urgency,
    scene,
    pose: input.showZayt ? pose : null,
    flame,
    tier: streakTier(length),
    count,
    line,
    note,
    week: widgetWeek(projection.days, clock.dateOf(at), todayLit, language),
    // The label says the line the screen shows, then the headline when it adds something.
    contentDescription: joinSentences([
      s.appName,
      count === null ? null : interpolate(s.habitStreakCount, { days: formatDays(length, language) }),
      line,
      spokenHeadline,
      detail,
      note,
    ]),
    tap,
  };
}

/** Joins a number and its unit with no-break spaces, so a wrapped line never leaves "days" alone. */
function keepTogether(text: string): string {
  return text.replace(/ /g, "\u00A0");
}

/** Today's wird was finished with under four hours left before midnight. */
function isFinishedLate(finishedAt: Date | null, date: LocalDate, clock: DayClock): boolean {
  if (finishedAt === null || clock.dateOf(finishedAt) !== date) return false;
  return LATE_LEVELS.has(widgetUrgencyAt(finishedAt, clock.at(addDays(date, 1), 0)));
}

/**
 * The open day's line at each level: an invitation while there is time, then the streak at stake as
 * the deadline nears. Each level has two lines; one is picked per level and day.
 */
function openLine(level: Level, date: LocalDate, s: (typeof strings)[Language], days: string | null): string {
  const lines: readonly string[] = (() => {
    switch (level) {
      case "calm":
        return [s.widgetLineCalm, s.widgetOpenHeadline];
      case "steady":
        return [s.widgetLineDay, s.widgetLineSteady];
      case "nudge":
        return days
          ? [interpolate(s.widgetLineNudge, { days }), interpolate(s.widgetLineNudge2, { days })]
          : [s.widgetLineNudgePlain, s.widgetLineNudge2Plain];
      case "urgent":
        return [days ? interpolate(s.widgetLineUrgent, { days }) : s.widgetLineUrgentPlain, s.widgetLineUrgent2];
      case "critical":
        return [s.widgetLineCritical, days ? interpolate(s.widgetLineCritical2, { days }) : s.widgetLineCritical2Plain];
      case "last":
        return [s.widgetLineLast, days ? interpolate(s.widgetLineLast2, { days }) : s.widgetLineLast2Plain];
    }
  })();
  return lines[widgetVariant(date, `line:${level}`, lines.length)];
}

/**
 * Spec 4.2: the one short line beside the count. Open days say how much of the day is left; a done
 * day says nothing, because the lit flame and the gold scene already do. `headline` is the spoken
 * headline, reused where it is already short, so TalkBack reads what the screen shows.
 */
function lineFor(state: WidgetState, language: Language, headline: string, reviewLeft: boolean): string | null {
  const s = strings[language];
  switch (state) {
    case "begin":
    case "fresh_start":
    case "open_day":
    case "open_evening":
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
