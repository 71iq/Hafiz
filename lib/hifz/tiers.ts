import { diffDays, type LocalDate } from "@/lib/habit/dates";
import type { DeckReviewSettings, SchedulerStep } from "@/lib/fsrs/types";
import type { HifzPlan } from "@/lib/hifz/plan";

/** Spec 3.2 tiers of a memorized page. */
const TIERS = ["sabaq", "sabqi", "manzil", "manzil.needs_work", "manzil.unverified"] as const;
export type Tier = (typeof TIERS)[number];

export type GradeEvent = Readonly<{ date: LocalDate; rating: 1 | 2 | 3 | 4 }>;

export type PageHistory = Readonly<{
  /** The day the page passed its fluent check in a sabaq session; absent for declared pages. */
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
 * - Declared pages are manzil, unverified until their first graded review (ONB-04). A page made from
 *   reviewed ayah cards (UNIT-02) is manzil from the start, since those reviews verified it.
 * - A page memorized in the app is sabqi from its fluent check. It graduates to manzil once it is
 *   sabqi_days old and its last 3 grades in this sabqi period are Good or better. Two Again grades
 *   in a row while sabqi send it back to sabaq; the next Good grade passes it again and starts a new
 *   sabqi period from that day.
 * - Once manzil, a page stays manzil: it needs work from its last Again until two Good or better
 *   grades in a row.
 */
export function tierFor(history: PageHistory, today: LocalDate, plan: Pick<HifzPlan, "sabqiDays">): Tier {
  const { grades } = history;
  if (history.declared || history.fromAyahReviews) {
    if (grades.length === 0) return history.fromAyahReviews ? "manzil" : "manzil.unverified";
    return needsWork(grades) ? "manzil.needs_work" : "manzil";
  }
  if (!history.firstFluentDate) return "sabaq";
  type State = { kind: "sabqi"; since: LocalDate; grades: GradeEvent[] } | { kind: "sabaq" } | { kind: "manzil"; grades: GradeEvent[] };
  const graduates = (state: { since: LocalDate; grades: GradeEvent[] }, on: LocalDate) => {
    const lastThree = state.grades.slice(-3);
    return diffDays(state.since, on) >= plan.sabqiDays && lastThree.length === 3 && lastThree.every((grade) => grade.rating >= 3);
  };
  let state: State = { kind: "sabqi", since: history.firstFluentDate, grades: [] };
  for (const grade of grades) {
    if (grade.date < history.firstFluentDate) continue;
    // A page that reached sabqi_days with its last 3 grades Good graduated that day, before this
    // grade, so the grade is a manzil review. Otherwise a lapse after time-based graduation would be
    // replayed as sabqi and could send the page back to sabaq.
    if (state.kind === "sabqi" && graduates(state, grade.date)) state = { kind: "manzil", grades: [] };
    if (state.kind === "manzil") {
      state.grades.push(grade);
    } else if (state.kind === "sabaq") {
      if (grade.rating >= 3) state = { kind: "sabqi", since: grade.date, grades: [grade] };
    } else {
      const previous = state.grades[state.grades.length - 1];
      state.grades.push(grade);
      if (grade.rating === 1 && previous?.rating === 1) state = { kind: "sabaq" };
      else if (graduates(state, grade.date)) state = { kind: "manzil", grades: [] };
    }
  }
  if (state.kind === "sabqi") return graduates(state, today) ? "manzil" : "sabqi";
  if (state.kind === "sabaq") return "sabaq";
  return needsWork(state.grades) ? "manzil.needs_work" : "manzil";
}

export function isManzil(tier: Tier): boolean {
  return tier === "manzil" || tier === "manzil.needs_work" || tier === "manzil.unverified";
}

const SABAQ_LEARNING: SchedulerStep[] = ["10m", "1h"];
const SHORT_RELEARNING: SchedulerStep[] = ["10m"];
const MANZIL_RELEARNING: SchedulerStep[] = ["10m", "1d"];

/**
 * SCH-02, SCH-03: the scheduling policy for a page card by tier. Manzil pages may come sooner than
 * the cycle but never later, by capping the interval at cycle_days rather than moving due dates.
 * Sabqi pages are reviewed daily while in sabqi.
 */
export function pagePolicy(tier: Tier, plan: Pick<HifzPlan, "cycleDays" | "retention">, base: DeckReviewSettings): DeckReviewSettings {
  switch (tier) {
    case "sabaq":
      return { ...base, requestRetention: 0.95, maximumInterval: 3, learningSteps: SABAQ_LEARNING, relearningSteps: SHORT_RELEARNING };
    case "sabqi":
      return { ...base, requestRetention: 0.95, maximumInterval: 1, learningSteps: SABAQ_LEARNING, relearningSteps: SHORT_RELEARNING };
    case "manzil":
    case "manzil.needs_work":
    case "manzil.unverified":
      return {
        ...base,
        requestRetention: plan.retention,
        maximumInterval: plan.cycleDays,
        learningSteps: [],
        relearningSteps: MANZIL_RELEARNING,
      };
  }
}
