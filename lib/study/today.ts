import { newMemorizationOpen, type TodayWird } from "@/lib/hifz/pages";
import type { DailyQueue } from "@/lib/study/daily-queue";

/**
 * Home's view of today's study (SPEC 3.3), derived from the resolver's daily queue so the counter, the
 * Today card and the session never disagree.
 */

/** One line of the Today card: plan review, new lines, or a daily deck. */
export type TodayPart = Readonly<
  | { kind: "review"; count: number; unit: "pages" | "ayahs"; done: boolean }
  | { kind: "memorize"; count: number; done: boolean }
  | { kind: "deck"; deckId: string; count: number; done: boolean }
>;

/**
 * Today's parts in order: review (pages and remediation, or Retention's ayat for an ayah plan), new
 * lines, then each daily deck. Deck counts come from the capped list, so they add up to the counter.
 * A part with nothing scheduled today is left out rather than shown as done: new lines with nowhere
 * left to memorize, or a deck with no cards left that nothing was studied from today.
 */
export function todayParts(
  wird: TodayWird,
  plan: Readonly<{ remediationDue: number; memorizeOpen: boolean }>,
  queue: DailyQueue,
): TodayPart[] {
  const { remediationDue, memorizeOpen } = plan;
  const parts: TodayPart[] = [];
  if (wird.plan.unit === "ayah") {
    const count = queue.planCards.length;
    parts.push({ kind: "review", count, unit: "ayahs", done: count === 0 });
  } else if (wird.total > 0 || remediationDue > 0) {
    const count = wird.todo.length + remediationDue;
    parts.push({ kind: "review", count, unit: "pages", done: count === 0 });
  }
  // memorizeOpen is the resolver's answer: open, not done, and some page left in the plan's order.
  if (newMemorizationOpen(wird) && (wird.memorizeDoneToday || memorizeOpen)) {
    // The lines still left of today's allocation, at least one while the lesson is not done.
    const count = wird.memorizeDoneToday ? 0 : Math.max(1, wird.newLines - wird.memorizeLinesToday);
    parts.push({ kind: "memorize", count, done: wird.memorizeDoneToday });
  }
  for (const deckId of queue.deckIds) {
    const count = queue.perDeck[deckId] ?? 0;
    if (count === 0 && !queue.studiedPerDeck[deckId]) continue;
    parts.push({ kind: "deck", deckId, count, done: count === 0 });
  }
  return parts;
}

/** The counter's "N due · M new" line, from the same capped list. */
export function queueCardCounts(queue: DailyQueue): { total: number; due: number; fresh: number } {
  const fresh = queue.cards.filter((item) => item.virtual || item.card.state === 0).length;
  return { total: queue.cards.length, due: queue.cards.length - fresh, fresh };
}

/**
 * Cards still needed for today's minimum when nothing else is left: what the streak's share of the
 * budget would still take, from today's progress toward the minimum. At least one while it is not met.
 */
export function shortfallCards(queue: DailyQueue, minimumProgress: number): number {
  const left = Math.ceil(queue.streakCards * (1 - Math.min(1, Math.max(0, minimumProgress))));
  return Math.max(1, left);
}
