import { MEANINGS_DECK_ID } from "@/lib/fsrs/queries";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import type { TodayWird } from "@/lib/hifz/pages";
import type { DailyQueue, DailyQueueItem } from "@/lib/study/daily-queue";
import { queueCardCounts, shortfallCards, todayParts } from "@/lib/study/today";

/** Home's Today card parts and header counts (SPEC 3.3), from the daily queue. */
const MUT = SMART_DECK_IDS.mutashabihat;
const TAILS = SMART_DECK_IDS.similarTails;

function wird(
  overrides: Partial<{
    unit: "page" | "ayah";
    todo: number;
    total: number;
    newLines: number;
    linesToday: number;
    backlog: boolean;
  }> = {},
): TodayWird {
  const page = { cardId: "page:madani15:1", tier: "recent" };
  const newLines = overrides.newLines ?? 0;
  const linesToday = overrides.linesToday ?? 0;
  return {
    plan: { unit: overrides.unit ?? "page" },
    daily: { backlog: overrides.backlog ?? false },
    todo: Array.from({ length: overrides.todo ?? 0 }, () => page),
    done: [],
    total: overrides.total ?? overrides.todo ?? 0,
    newLines,
    memorizeLinesToday: linesToday,
    memorizeDoneToday: newLines > 0 && linesToday >= newLines,
  } as unknown as TodayWird;
}

const item = (deckId: string, state: number, virtual = false) =>
  ({ card: { id: `${deckId}:${state}`, deck_id: deckId, state }, settings: {}, virtual }) as unknown as DailyQueueItem;

function queue(overrides: Partial<DailyQueue> = {}): DailyQueue {
  return {
    planCards: [],
    cards: [],
    heldBack: 0,
    streakCards: 10,
    baseBudget: 20,
    budget: 20,
    studiedToday: 0,
    deckIds: [MUT, TAILS, MEANINGS_DECK_ID],
    perDeck: {},
    studiedPerDeck: {},
    leftAtBase: 0,
    ...overrides,
  };
}

describe("todayParts", () => {
  const open = { remediationDue: 0, memorizeOpen: true } as const;

  it("lists review, new lines, then each daily deck with its share of the capped list", () => {
    const parts = todayParts(
      wird({ todo: 2, total: 3, newLines: 7, linesToday: 4 }),
      { remediationDue: 1, memorizeOpen: true },
      queue({ perDeck: { [MUT]: 6, [TAILS]: 4 }, studiedPerDeck: { [MEANINGS_DECK_ID]: 3 } }),
    );
    expect(parts).toEqual([
      { kind: "review", count: 3, unit: "pages", done: false },
      { kind: "memorize", count: 3, done: false },
      { kind: "deck", deckId: MUT, count: 6, done: false },
      { kind: "deck", deckId: TAILS, count: 4, done: false },
      // Studied today and nothing left: a check.
      { kind: "deck", deckId: MEANINGS_DECK_ID, count: 0, done: true },
    ]);
  });

  it("leaves out a deck with nothing left that nothing was studied from today", () => {
    const parts = todayParts(wird(), open, queue({ perDeck: { [MUT]: 2 } }));
    expect(parts).toEqual([{ kind: "deck", deckId: MUT, count: 2, done: false }]);
  });

  it("leaves out new lines the resolver found nowhere to memorize, and keeps a finished lesson", () => {
    const noTarget = { remediationDue: 0, memorizeOpen: false } as const;
    expect(todayParts(wird({ total: 0, newLines: 5 }), noTarget, queue({ deckIds: [] }))).toEqual([]);
    expect(todayParts(wird({ total: 0, newLines: 5, linesToday: 5 }), noTarget, queue({ deckIds: [] }))).toEqual([
      { kind: "memorize", count: 0, done: true },
    ]);
  });

  it("counts an ayah plan's review from Retention's plan cards", () => {
    const parts = todayParts(
      wird({ unit: "ayah" }),
      open,
      queue({ planCards: [item(SMART_DECK_IDS.retention, 2)], deckIds: [] }),
    );
    expect(parts).toEqual([{ kind: "review", count: 1, unit: "ayahs", done: false }]);
  });

  it("checks finished parts, and leaves out review when nothing was scheduled and new lines on a catch-up day", () => {
    expect(todayParts(wird({ todo: 0, total: 4, newLines: 5, linesToday: 5 }), open, queue({ deckIds: [] }))).toEqual([
      { kind: "review", count: 0, unit: "pages", done: true },
      { kind: "memorize", count: 0, done: true },
    ]);
    expect(todayParts(wird({ total: 0, newLines: 5, backlog: true }), open, queue({ deckIds: [] }))).toEqual([]);
  });
});

describe("queueCardCounts", () => {
  it("splits the counter into due and new, counting virtual candidates as new", () => {
    const cards = [item(MUT, 2), item(MUT, 1), item(TAILS, 0), item(TAILS, 0, true)];
    expect(queueCardCounts(queue({ cards }))).toEqual({ total: 4, due: 2, fresh: 2 });
  });
});

describe("shortfallCards", () => {
  it("is the streak's share of cards still needed, at least one", () => {
    expect(shortfallCards(queue(), 0)).toBe(10);
    expect(shortfallCards(queue(), 0.55)).toBe(5);
    expect(shortfallCards(queue(), 0.99)).toBe(1);
    expect(shortfallCards(queue(), 2)).toBe(1);
  });
});
