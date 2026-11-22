import { diffDays, type LocalDate } from "@/lib/habit/dates";
import type { DeckReviewSettings, SchedulerStep } from "@/lib/fsrs/types";
import type { HifzPlan } from "@/lib/hifz/plan";

/** Spec 3.2 tiers of a memorized page: new lines, recently memorized, and long-term review. */
export type Tier = "new" | "recent" | "long_term" | "long_term.needs_work" | "long_term.unverified";

/**
 * The value each tier is saved as in study_cards.tier, locally and on the server. These are the
 * spec's original Arabic tier names. Released Android versions keep reading and syncing them, and the
 * server's CHECK constraint accepts only them, so they stay as saved values while the code uses plain
 * names. Convert with storedTier and tierFromStored at the database boundary.
 */
const STORED_TIER = {
  new: "sabaq",
  recent: "sabqi",
  long_term: "manzil",
  "long_term.needs_work": "manzil.needs_work",
  "long_term.unverified": "manzil.unverified",
} as const satisfies Record<Tier, string>;
export type StoredTier = (typeof STORED_TIER)[Tier];
export const STORED_TIERS = Object.values(STORED_TIER) as [StoredTier, ...StoredTier[]];

export function storedTier(tier: Tier): StoredTier {
  return STORED_TIER[tier];
}

/** The tier a saved study_cards.tier value names, or null for an empty or unknown value. */
export function tierFromStored(value: string | null | undefined): Tier | null {
  const entry = Object.entries(STORED_TIER).find(([, stored]) => stored === value);
  return entry ? (entry[0] as Tier) : null;
}

export type GradeEvent = Readonly<{ date: LocalDate; rating: 1 | 2 | 3 | 4 }>;

export type PageHistory = Readonly<{
  /** The day the page passed its fluent check in a new memorization session; absent for declared pages. */
  firstFluentDate: LocalDate | null;
  /** Declared memorized at onboarding or in My memorization, not memorized in the app. */
  declared: boolean;
  /**
   * UNIT-02: the page card started from the schedules of its reviewed ayah cards when the user
   * switched to page review, and has no grades of its own yet. Those ayah reviews verify it.
   */
  fromAyahReviews?: boolean;
  /** Graded reviews of the page card, oldest first. */
  grades: readonly GradeEvent[];
}>;

function needsWork(grades: readonly GradeEvent[]): boolean {
  const lastAgain = grades.map((grade) => grade.rating).lastIndexOf(1);
  if (lastAgain < 0) return false;
  const after = grades.slice(lastAgain + 1);
  for (let i = 1; i < after.length; i += 1) {
    if (after[i - 1].rating >= 3 && after[i].rating >= 3) return false;
  }
  return true;
}

/**
 * TIER-01: a page's tier is a pure function of its review history and the plan (8.6), replayed in
 * date order so a decision made on one day is not undone by a later ordinary grade.
 * - Declared pages are long-term, unverified until their first graded review (ONB-04). A page made from
 *   reviewed ayah cards (UNIT-02) is long-term from the start, since those reviews verified it.
 * - A page memorized in the app is recent from its fluent check. It graduates to long-term once it is
 *   recent_days old and its last 3 grades in this recent period are Good or better. Two Again grades
 *   in a row while recent send it back to the new tier; the next Good grade passes it again and starts a new
 *   recent period from that day.
 * - Once long-term, a page stays long-term: it needs work from its last Again until two Good or better
 *   grades in a row.
 */
export function tierFor(history: PageHistory, today: LocalDate, plan: Pick<HifzPlan, "recentDays">): Tier {
  const { grades } = history;
  if (history.declared || history.fromAyahReviews) {
    if (grades.length === 0) return history.fromAyahReviews ? "long_term" : "long_term.unverified";
    return needsWork(grades) ? "long_term.needs_work" : "long_term";
  }
  if (!history.firstFluentDate) return "new";
  type State = { kind: "recent"; since: LocalDate; grades: GradeEvent[] } | { kind: "new" } | { kind: "long_term"; grades: GradeEvent[] };
  const graduates = (state: { since: LocalDate; grades: GradeEvent[] }, on: LocalDate) => {
    const lastThree = state.grades.slice(-3);
    return diffDays(state.since, on) >= plan.recentDays && lastThree.length === 3 && lastThree.every((grade) => grade.rating >= 3);
  };
  let state: State = { kind: "recent", since: history.firstFluentDate, grades: [] };
  for (const grade of grades) {
    if (grade.date < history.firstFluentDate) continue;
    // A page that reached recent_days with its last 3 grades Good graduated that day, before this
    // grade, so the grade is a long-term review. Otherwise a lapse after time-based graduation would be
    // replayed as recent and could send the page back to the new tier.
    if (state.kind === "recent" && graduates(state, grade.date)) state = { kind: "long_term", grades: [] };
    if (state.kind === "long_term") {
      state.grades.push(grade);
    } else if (state.kind === "new") {
      if (grade.rating >= 3) state = { kind: "recent", since: grade.date, grades: [grade] };
    } else {
      const previous = state.grades[state.grades.length - 1];
      state.grades.push(grade);
      if (grade.rating === 1 && previous?.rating === 1) state = { kind: "new" };
      else if (graduates(state, grade.date)) state = { kind: "long_term", grades: [] };
    }
  }
  if (state.kind === "recent") return graduates(state, today) ? "long_term" : "recent";
  if (state.kind === "new") return "new";
  return needsWork(state.grades) ? "long_term.needs_work" : "long_term";
}

export function isLongTerm(tier: Tier): boolean {
  return tier === "long_term" || tier === "long_term.needs_work" || tier === "long_term.unverified";
}

const NEW_LEARNING: SchedulerStep[] = ["10m", "1h"];
const SHORT_RELEARNING: SchedulerStep[] = ["10m"];
const LONG_TERM_RELEARNING: SchedulerStep[] = ["10m", "1d"];

/**
 * SCH-02, SCH-03: the scheduling policy for a page card by tier. Long-term pages may come sooner than
 * the cycle but never later, by capping the interval at cycle_days rather than moving due dates.
 * Recent pages are reviewed daily while in recent.
 */
export function pagePolicy(tier: Tier, plan: Pick<HifzPlan, "cycleDays" | "retention">, base: DeckReviewSettings): DeckReviewSettings {
  switch (tier) {
    case "new":
      return { ...base, requestRetention: 0.95, maximumInterval: 3, learningSteps: NEW_LEARNING, relearningSteps: SHORT_RELEARNING };
    case "recent":
      return { ...base, requestRetention: 0.95, maximumInterval: 1, learningSteps: NEW_LEARNING, relearningSteps: SHORT_RELEARNING };
    case "long_term":
    case "long_term.needs_work":
    case "long_term.unverified":
      return {
        ...base,
        requestRetention: plan.retention,
        maximumInterval: plan.cycleDays,
        learningSteps: [],
        relearningSteps: LONG_TERM_RELEARNING,
      };
  }
}
