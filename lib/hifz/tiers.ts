import { diffDays, type LocalDate } from "@/lib/habit/dates";
import type { DeckReviewSettings, SchedulerStep } from "@/lib/fsrs/types";
import type { HifzPlan } from "@/lib/hifz/plan";

/** Spec 3.2 tiers of a memorized page. */
export const TIERS = ["sabaq", "sabqi", "manzil", "manzil.needs_work", "manzil.unverified"] as const;
export type Tier = (typeof TIERS)[number];

export type GradeEvent = Readonly<{ date: LocalDate; rating: 1 | 2 | 3 | 4 }>;

export type PageHistory = Readonly<{
  /** The day the page passed its fluent check in a sabaq session; absent for declared pages. */
  firstFluentDate: LocalDate | null;
  /** Declared memorized at onboarding or in My memorization, not memorized in the app. */
  declared: boolean;
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
 * TIER-01: a page's tier is a pure function of its review history and the plan (8.6).
 * - Declared pages are manzil, unverified until their first graded review (ONB-04).
 * - A page memorized in the app is sabqi for sabqi_days after its fluent check, and until its last
 *   3 grades are Good or better; failing sabqi twice in a row sends it back to sabaq.
 * - A manzil page needs work from its last Again until two Good or better grades in a row.
 */
export function tierFor(history: PageHistory, today: LocalDate, plan: Pick<HifzPlan, "sabqiDays">): Tier {
  const { grades } = history;
  if (history.declared) {
    if (grades.length === 0) return "manzil.unverified";
    return needsWork(grades) ? "manzil.needs_work" : "manzil";
  }
  if (!history.firstFluentDate) return "sabaq";
  const sinceFluent = grades.filter((grade) => grade.date >= history.firstFluentDate!);
  const lastTwo = sinceFluent.slice(-2);
  const lastThree = sinceFluent.slice(-3);
  const settled = lastThree.length === 3 && lastThree.every((grade) => grade.rating >= 3);
  const inSabqi = diffDays(history.firstFluentDate, today) < plan.sabqiDays || !settled;
  if (inSabqi) {
    if (lastTwo.length === 2 && lastTwo.every((grade) => grade.rating === 1)) return "sabaq";
    return "sabqi";
  }
  return needsWork(sinceFluent) ? "manzil.needs_work" : "manzil";
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
