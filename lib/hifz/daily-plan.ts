import { addDays, diffDays, type LocalDate } from "@/lib/habit/dates";
import type { HifzPlan } from "@/lib/hifz/plan";
import { isManzil, type Tier } from "@/lib/hifz/tiers";
import { LINES_PER_PAGE } from "@/lib/hifz/units";

export type PlanPage = Readonly<{
  cardId: string;
  page: number;
  tier: Tier;
  lastReviewDate: LocalDate | null;
  reviewedToday: boolean;
  dueDate: LocalDate;
  retrievability: number | null;
}>;

export type DailyPlan = Readonly<{
  done: readonly PlanPage[];
  sabqi: readonly PlanPage[];
  floor: readonly PlanPage[];
  extra: readonly PlanPage[];
  review: readonly PlanPage[];
  deferred: readonly PlanPage[];
  reviewMinutes: number;
  newLines: number;
  newMinutes: number;
  backlog: boolean;
  overdueCount: number;
}>;

export type DailyPlanInput = Readonly<{
  pages: readonly PlanPage[];
  plan: Pick<HifzPlan, "newPerDay" | "cycleDays" | "dailyBudgetMin" | "sabqiEvery" | "retention">;
  today: LocalDate;
  studyDay: boolean;
  minutesPerNewPage: number;
  minutesPerReviewPage: number;
}>;

const NEVER_DEFER_AFTER_DAYS = 3;
const MIN_NEW_LINES = 3;

function floorDate(page: PlanPage, cycleDays: number): LocalDate {
  return page.lastReviewDate ? addDays(page.lastReviewDate, cycleDays) : page.dueDate;
}

function byOldestReview(a: PlanPage, b: PlanPage): number {
  if (a.lastReviewDate === b.lastReviewDate) return a.page - b.page;
  if (a.lastReviewDate === null) return -1;
  if (b.lastReviewDate === null) return 1;
  return a.lastReviewDate < b.lastReviewDate ? -1 : 1;
}

export function buildDailyPlan(input: DailyPlanInput): DailyPlan {
  const { plan, today } = input;
  const done = input.pages.filter((page) => page.reviewedToday);
  const pages = input.pages.filter((page) => !page.reviewedToday);
  const relearn = pages.filter((page) => page.tier === "sabaq").sort((a, b) => a.page - b.page);
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
  const floorCount = Math.max(0, Math.ceil(manzilTotal / plan.cycleDays) - done.filter((page) => isManzil(page.tier)).length);
  const floorIds = new Set(overdue.map((page) => page.cardId));
  const floor = [...overdue];
  for (const page of [...manzil].sort(byOldestReview).slice(0, floorCount)) {
    if (floorIds.has(page.cardId)) continue;
    floor.push(page);
    floorIds.add(page.cardId);
  }
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
