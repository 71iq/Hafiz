import { addDays, diffDays, type LocalDate } from "@/lib/habit/dates";
import type { HifzPlan } from "@/lib/hifz/plan";
import { isManzil, type Tier } from "@/lib/hifz/tiers";
import { LINES_PER_PAGE } from "@/lib/hifz/units";

/** A memorized page as the daily plan sees it. */
export type PlanPage = Readonly<{
  cardId: string;
  page: number;
  tier: Tier;
  /** Local date of the last graded review before today, or null if never reviewed before today. */
  lastReviewDate: LocalDate | null;
  /** Reviewed today already. Done pages stay in today's plan and count as progress. */
  reviewedToday: boolean;
  /** The FSRS due date, as a local date. */
  dueDate: LocalDate;
  /** Recall probability now, or null for a page never reviewed. */
  retrievability: number | null;
}>;

export type DailyPlan = Readonly<{
  /** Pages already reviewed today. */
  done: readonly PlanPage[];
  /** Sabqi pages due today, after any page sent back to sabaq for relearning. */
  sabqi: readonly PlanPage[];
  /** Manzil pages kept within the cycle today (SCH-03, SCH-04). */
  floor: readonly PlanPage[];
  /** Manzil pages FSRS wants sooner than the cycle, or that need work (SCH-05). */
  extra: readonly PlanPage[];
  /** Today's review in order: sabqi, then manzil floor, then extras (PLN-04), after trimming. */
  review: readonly PlanPage[];
  /** Pages deferred to a later day by the budget (PLN-01). */
  deferred: readonly PlanPage[];
  reviewMinutes: number;
  /** New memorization today, in lines. 0 when skipped. */
  newLines: number;
  newMinutes: number;
  /** PLN-02: overdue manzil above max(5, 10%) pauses new memorization. */
  backlog: boolean;
  overdueCount: number;
}>;

export type DailyPlanInput = Readonly<{
  pages: readonly PlanPage[];
  plan: Pick<HifzPlan, "newPerDay" | "cycleDays" | "dailyBudgetMin" | "sabqiEvery" | "retention">;
  today: LocalDate;
  /** New memorization is scheduled today (study day, standard or Ottoman method). */
  studyDay: boolean;
  /** Minutes per new page and per review page (PLN-05). */
  minutesPerNewPage: number;
  minutesPerReviewPage: number;
}>;

/** Overdue floor pages older than this are never deferred (PLN-01). */
const NEVER_DEFER_AFTER_DAYS = 3;
/** PLN-03: new memorization below this many lines is skipped for the day. */
const MIN_NEW_LINES = 3;

/** The day a manzil page must be reviewed by (SCH-03): its last review + the cycle, or its due date if never reviewed. */
function floorDate(page: PlanPage, cycleDays: number): LocalDate {
  return page.lastReviewDate ? addDays(page.lastReviewDate, cycleDays) : page.dueDate;
}

function byOldestReview(a: PlanPage, b: PlanPage): number {
  if (a.lastReviewDate === b.lastReviewDate) return a.page - b.page;
  if (a.lastReviewDate === null) return -1;
  if (b.lastReviewDate === null) return 1;
  return a.lastReviewDate < b.lastReviewDate ? -1 : 1;
}

/**
 * The structured wird for today (4.3.1): sabqi first, then ceil(O / C) manzil pages with the oldest
 * last review plus every page past its floor date, then extras FSRS wants sooner, lowest recall
 * first. Within the floor, pages never reviewed come first, in the order chosen, then the rest by
 * lowest recall (SCH-05). The budget trims extras first, then the last floor pages, the strongest,
 * that are not more than 3 days overdue. New memorization fits in what is left and pauses while
 * manzil is far behind.
 */
export function buildDailyPlan(input: DailyPlanInput): DailyPlan {
  const { plan, today } = input;
  const done = input.pages.filter((page) => page.reviewedToday);
  const pages = input.pages.filter((page) => !page.reviewedToday);
  // A page sent back to sabaq after failing sabqi twice is relearned every day, ahead of sabqi.
  const relearn = pages.filter((page) => page.tier === "sabaq").sort((a, b) => a.page - b.page);
  // A page completed through sabaq has no page review yet, and its card is first due the next day
  // (SBQ-02), so it waits for that date like any due card. Later it comes every sabqi_every days.
  const sabqiDue = (page: PlanPage) =>
    page.lastReviewDate ? diffDays(page.lastReviewDate, today) >= plan.sabqiEvery : page.dueDate <= today;
  const sabqi = [
    ...relearn,
    ...pages
      .filter((page) => page.tier === "sabqi" && sabqiDue(page))
      .sort((a, b) => a.page - b.page),
  ];
  const manzil = pages.filter((page) => isManzil(page.tier));
  const manzilTotal = manzil.length + done.filter((page) => isManzil(page.tier)).length;
  const floorOf = (page: PlanPage) => floorDate(page, plan.cycleDays);
  const overdue = manzil.filter((page) => floorOf(page) < today).sort((a, b) => (floorOf(a) < floorOf(b) ? -1 : floorOf(a) > floorOf(b) ? 1 : a.page - b.page));
  // Pages already reviewed today count toward today's share of the cycle.
  const floorCount = Math.max(0, Math.ceil(manzilTotal / plan.cycleDays) - done.filter((page) => isManzil(page.tier)).length);
  const floorIds = new Set(overdue.map((page) => page.cardId));
  const floor = [...overdue];
  for (const page of [...manzil].sort(byOldestReview).slice(0, floorCount)) {
    if (floorIds.has(page.cardId)) continue;
    floor.push(page);
    floorIds.add(page.cardId);
  }
  // SCH-05: priority, not permission. The floor decides which pages; the order is lowest recall
  // first, after the never-reviewed, whose first check keeps its place (a stable sort).
  floor.sort((a, b) => {
    const aNew = a.lastReviewDate === null;
    const bNew = b.lastReviewDate === null;
    if (aNew || bNew) return aNew === bNew ? 0 : aNew ? -1 : 1;
    return (a.retrievability ?? 0) - (b.retrievability ?? 0) || a.page - b.page;
  });
  const extra = manzil
    .filter((page) => !floorIds.has(page.cardId))
    .filter(
      (page) =>
        page.tier === "manzil.needs_work" ||
        page.dueDate <= today ||
        (page.retrievability !== null && page.retrievability < plan.retention),
    )
    .sort((a, b) => {
      if ((a.tier === "manzil.needs_work") !== (b.tier === "manzil.needs_work")) return a.tier === "manzil.needs_work" ? -1 : 1;
      return (a.retrievability ?? 0) - (b.retrievability ?? 0);
    });

  const review: PlanPage[] = [...sabqi, ...floor, ...extra];
  const deferred: PlanPage[] = [];
  const minutesFor = (count: number) => (count + done.length) * input.minutesPerReviewPage;
  let trimmed = false;
  while (minutesFor(review.length) > plan.dailyBudgetMin) {
    let index = -1;
    for (let i = review.length - 1; i >= 0; i -= 1) {
      if (extra.includes(review[i]) && review[i].tier !== "manzil.needs_work") {
        index = i;
        break;
      }
    }
    if (index < 0) {
      for (let i = review.length - 1; i >= 0; i -= 1) {
        const page = review[i];
        if (floor.includes(page) && diffDays(floorOf(page), today) <= NEVER_DEFER_AFTER_DAYS) {
          index = i;
          break;
        }
      }
    }
    if (index < 0) break;
    deferred.push(...review.splice(index, 1));
    trimmed = true;
  }

  const reviewMinutes = minutesFor(review.length);
  const backlog = overdue.length > Math.max(5, 0.1 * manzilTotal);
  let newLines = 0;
  if (input.studyDay && !backlog && !trimmed && plan.newPerDay > 0) {
    const remainingMinutes = Math.max(0, plan.dailyBudgetMin - reviewMinutes);
    const fittingPages = Math.min(plan.newPerDay, remainingMinutes / input.minutesPerNewPage);
    const lines = Math.floor(fittingPages * LINES_PER_PAGE);
    newLines = lines >= MIN_NEW_LINES ? Math.min(lines, Math.round(plan.newPerDay * LINES_PER_PAGE)) : 0;
  }

  return {
    done,
    sabqi,
    floor,
    extra,
    review,
    deferred,
    reviewMinutes,
    newLines,
    newMinutes: (newLines / LINES_PER_PAGE) * input.minutesPerNewPage,
    backlog,
    overdueCount: overdue.length,
  };
}
