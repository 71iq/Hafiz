import type { Href } from "expo-router";
import type { AppDatabase } from "@/lib/database/types";
import { diffDays } from "@/lib/habit/dates";
import { loadHabitOverview } from "@/lib/habit/queries";
import { countSecondLooks, hasMemorizeTarget } from "@/lib/hifz/memorize";
import { loadTodayWird, newMemorizationOpen } from "@/lib/hifz/pages";
import { readHifzPlan } from "@/lib/hifz/plan";
import { countDueRemediation } from "@/lib/hifz/remediation";
import { buildDailyQueue, type DailyQueue } from "@/lib/study/daily-queue";

/**
 * The one answer to "what should I study now?" (SPEC 3.1). The Study button, the widget, reminders,
 * the in-app banner, the onboarding finish and the session end screens all ask it, so they always
 * agree. Steps, first that applies:
 *
 * 1. Welcome back: seven or more days since the last wird day, with pages due and today not done.
 * 2. Review: pages, half pages, seams or weak-spot cloze cards due; for a plan that reviews by ayah,
 *    also Retention's cards for today, which open the card session first.
 * 3. Memorize: new lines open and not done with somewhere left to go, or a second look due.
 * 4. Cards: daily cards left inside today's budget.
 * 5. Home: nothing left, no plan, or a read failed.
 */
export type StudyStep =
  | Readonly<{ kind: "welcome_back" | "review" | "memorize" | "cards"; href: Href }>
  | Readonly<{ kind: "home"; reason: "done" | "no_plan" | "failed" }>;

export const DAILY_SESSION_HREF: Href = { pathname: "/flashcards/session", params: { scope: "daily" } };

/**
 * What the resolver saw, for the screens that show more than the next step: Home's Today card, its
 * header and the full-wird check read the same answers, so they cannot disagree with the step.
 */
export type StudyState = Readonly<{
  step: StudyStep;
  queue: DailyQueue | null;
  remediationDue: number;
  /** New lines are open today, not done, and some page in the plan's order is left to memorize. */
  memorizeOpen: boolean;
  /** Second looks due now. */
  secondLooksDue: number;
  /**
   * Plan work left today, from this same read: pages, half pages and seams, the lesson when
   * memorization is open, second looks due, and an ayah plan's Retention cards. Home's full-wird check
   * adds the daily cards left at the base budget, so it waits for exactly what the steps would open.
   */
  planLeft: number;
}>;

const NO_PLAN_WORK = { remediationDue: 0, memorizeOpen: false, secondLooksDue: 0, planLeft: 0 } as const;

export async function loadStudyState(db: AppDatabase, now = new Date()): Promise<StudyState> {
  try {
    const plan = await readHifzPlan(db);
    // Without a plan the daily decks still hold today's cards, and the full wird still waits for them.
    if (!plan)
      return { step: { kind: "home", reason: "no_plan" }, queue: await buildDailyQueue(db, now), ...NO_PLAN_WORK };
    const [wird, remediationDue, habit, queue, looks] = await Promise.all([
      loadTodayWird(db, now),
      countDueRemediation(db, now),
      loadHabitOverview(db, { now }),
      buildDailyQueue(db, now),
      countSecondLooks(db, now).catch(() => ({ due: 0 })),
    ]);
    if (!wird) return { step: { kind: "home", reason: "no_plan" }, queue, ...NO_PLAN_WORK, remediationDue };
    const memorizeOpen = newMemorizationOpen(wird) && !wird.memorizeDoneToday && (await hasMemorizeTarget(db, plan));
    const secondLooksDue = looks.due;
    const planLeft =
      wird.todo.length +
      remediationDue +
      (memorizeOpen ? 1 : 0) +
      secondLooksDue +
      (plan.unit === "ayah" ? queue.planCards.length : 0);

    const lastWirdDay = habit.days.filter((day) => day.localDate <= habit.today).at(-1)?.localDate ?? null;
    const returning =
      wird.todo.length > 0 &&
      !habit.streak.doneToday &&
      lastWirdDay !== null &&
      diffDays(lastWirdDay, habit.today) >= 7;
    const state = (step: StudyStep): StudyState => ({
      step,
      queue,
      remediationDue,
      memorizeOpen,
      secondLooksDue,
      planLeft,
    });
    if (returning) {
      // No level: the screen uses its default support level. Home's card still offers the choice.
      return state({ kind: "welcome_back", href: { pathname: "/hifz/review", params: { mode: "welcome_back" } } });
    }

    if (plan.unit === "ayah" && queue.planCards.length > 0) return state({ kind: "review", href: DAILY_SESSION_HREF });
    if (wird.todo.length + remediationDue > 0) return state({ kind: "review", href: "/hifz/review" });

    if (memorizeOpen || secondLooksDue > 0) return state({ kind: "memorize", href: "/hifz/memorize" });

    if (queue.cards.length > 0) return state({ kind: "cards", href: DAILY_SESSION_HREF });
    return state({ kind: "home", reason: "done" });
  } catch (error) {
    console.warn("[Study] Could not resolve the next step:", error);
    return { step: { kind: "home", reason: "failed" }, queue: null, ...NO_PLAN_WORK };
  }
}

export async function resolveStudy(db: AppDatabase, now = new Date()): Promise<StudyStep> {
  return (await loadStudyState(db, now)).step;
}

/** True when the step opens the daily card session, which a daily session can reload in place. */
export function opensDailySession(step: StudyStep): boolean {
  return step.kind !== "home" && step.href === DAILY_SESSION_HREF;
}

/**
 * What one Study more press opens: one more budget, or fewer when fewer were held back. Zero unless
 * today's capped list is empty, so a press is never spent while cards inside the budget are left
 * (a user without a plan can reach Home's step with cards still unspent).
 */
export function studyMoreCount(queue: DailyQueue | null): number {
  return queue && queue.cards.length === 0 ? Math.min(queue.heldBack, queue.baseBudget) : 0;
}

/** Where a step leads: the step's own route, or Home. */
export function studyStepHref(step: StudyStep): Href {
  return step.kind === "home" ? "/(tabs)/home" : step.href;
}
