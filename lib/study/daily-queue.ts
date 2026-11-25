import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting } from "@/lib/database/user-settings";
import {
  getDeckQueueOptions,
  readDeckReviewSettings,
  type DeckQueueOptions,
  type ReviewQueueItem,
} from "@/lib/fsrs/queries";
import {
  getDueCardsForReview,
  getSmartDeckTodayRows,
  isSmartDeckId,
  materializeSmartCardIds,
  SMART_DECK_IDS,
} from "@/lib/fsrs/smart-decks";
import type { DeckReviewSettings, StudyCardRow } from "@/lib/fsrs/types";
import { localDateOf } from "@/lib/habit/dates";
import { readHabitSettings } from "@/lib/habit/settings";
import { readDailyDeckIds } from "@/lib/study/daily-decks";

/**
 * Today's daily study queue (SPEC 3.2): one read-only function that Home's counter, the Today card,
 * the resolver, the full-wird check and the daily session all use, so the number on Home and the
 * session can never disagree.
 *
 * - Plan cards: for a plan that reviews by ayah, Retention's queue under its own daily limits. They
 *   are plan work, like pages, and stay outside the card budget and the counter.
 * - Daily cards: the daily decks' queues, each under its own limits, in one daily order, cut at what is
 *   left of today's card budget.
 */

/** Ten cards make a page, the weight ayah-size cards carry in the streak tally. */
const CARDS_PER_PAGE = 10;

/** Today's extra budget from Study more, kept on the device and cleared at the day boundary. */
export const DAILY_STUDY_EXTRA_KEY = "device_daily_study_extra";

/** The session deck id that marks a daily session, so the budget knows which reviews it spent. */
export const DAILY_SESSION_DECK_ID = "daily";

export type DailyQueueItem = Readonly<{
  card: StudyCardRow;
  settings: DeckReviewSettings;
  /** A smart-deck candidate with no row yet. The session creates its row before showing it. */
  virtual: boolean;
}>;

export type DailyQueue = Readonly<{
  planCards: readonly DailyQueueItem[];
  cards: readonly DailyQueueItem[];
  /** Daily cards the budget cut held back, which Study more can open. */
  heldBack: number;
  /** Cards that keep the streak: ceil(minimum pages × 10). */
  streakCards: number;
  /** Twice streakCards. */
  baseBudget: number;
  /** baseBudget plus today's Study more presses. */
  budget: number;
  /** Distinct daily cards graded in a daily session today. */
  studiedToday: number;
  /** Today's daily decks in order, for the Today card's parts. */
  deckIds: readonly string[];
  /** Daily cards in `cards` per deck, for the Today card's parts. */
  perDeck: Readonly<Record<string, number>>;
  /** Distinct cards of each daily deck graded in a daily session today, so a finished part shows a check. */
  studiedPerDeck: Readonly<Record<string, number>>;
  /**
   * Daily cards left if the budget were the base budget alone. The full wird waits only for these,
   * so extra budget from Study more never holds it back (SPEC 3.5).
   */
  leftAtBase: number;
}>;

export function streakCardsFor(minimumPages: number): number {
  return Math.max(1, Math.ceil(minimumPages * CARDS_PER_PAGE));
}

/** How many Study more presses today has, from the device key; another day's presses count as none. */
export async function readExtraPresses(db: DatabaseExecutor, today: string): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [
    DAILY_STUDY_EXTRA_KEY,
  ]);
  if (!row?.value) return 0;
  try {
    const parsed = JSON.parse(row.value) as { date?: unknown; presses?: unknown };
    return parsed.date === today && typeof parsed.presses === "number" && parsed.presses > 0
      ? Math.floor(parsed.presses)
      : 0;
  } catch {
    return 0;
  }
}

/** Study more: one more budget for today. Deck limits are not extended. */
export async function addStudyMore(db: AppDatabase, now = new Date()): Promise<void> {
  const today = localDateOf(now);
  const presses = await readExtraPresses(db, today);
  await putUserSetting(db, DAILY_STUDY_EXTRA_KEY, JSON.stringify({ date: today, presses: presses + 1 }));
}

/**
 * Distinct daily-deck cards graded in a daily session today. Plan work, make-up reviews and
 * single-deck sessions from All decks do not spend the budget.
 */
async function readStudiedToday(
  db: DatabaseExecutor,
  today: string,
  deckIds: readonly string[],
): Promise<Map<string, string>> {
  if (deckIds.length === 0) return new Map();
  const rows = await db.getAllAsync<{ card_id: string; deck_id: string }>(
    `SELECT DISTINCT sl.card_id, sc.deck_id
       FROM study_log sl
       JOIN review_sessions rs ON rs.id = sl.session_id
       JOIN study_cards sc ON sc.id = sl.card_id
      WHERE rs.deck_id = ? AND sl.local_date = ? AND sl.makeup_for IS NULL
        AND sc.deck_id IN (${deckIds.map(() => "?").join(", ")})`,
    [DAILY_SESSION_DECK_ID, today, ...deckIds],
  );
  return new Map(rows.map((row) => [row.card_id, row.deck_id]));
}

type DeckQueue = {
  deckId: string;
  settings: DeckReviewSettings;
  learning: DailyQueueItem[];
  reviews: DailyQueueItem[];
  fresh: DailyQueueItem[];
};

const isLearning = (row: StudyCardRow) => row.state === 1 || row.state === 3;
const byDue = (a: DailyQueueItem, b: DailyQueueItem) => a.card.due.localeCompare(b.card.due);

/**
 * One deck's cards for today under its own limits, in the daily order: cards on a learning step,
 * then reviews from the most overdue, then new cards. Deck sort settings apply only to single-deck
 * sessions.
 */
async function deckQueue(db: AppDatabase, deckId: string): Promise<DeckQueue> {
  const settings = await readDeckReviewSettings(db, deckId);
  // Null once the deck's daily limit is spent: then only cards on a learning step come back.
  const options: DeckQueueOptions | null = await getDeckQueueOptions(db, deckId, settings);
  const newCardsLimit = options?.newCardsLimit ?? 0;
  let rows: StudyCardRow[];
  let virtualRows: StudyCardRow[] = [];
  if (isSmartDeckId(deckId)) {
    const today = await getSmartDeckTodayRows(db, deckId, newCardsLimit);
    rows = today.dueRows;
    virtualRows = today.virtualNew;
  } else {
    rows = await getDueCardsForReview(db, deckId, { limit: 0, newCardsLimit: Number.MAX_SAFE_INTEGER });
  }
  const item = (card: StudyCardRow, virtual = false): DailyQueueItem => ({ card, settings, virtual });
  const learning = rows
    .filter(isLearning)
    .map((row) => item(row))
    .sort(byDue);
  const reviews = rows
    .filter((row) => row.state === 2)
    .map((row) => item(row))
    .sort(byDue);
  const fresh = [
    ...rows
      .filter((row) => row.state === 0)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((row) => item(row)),
    ...virtualRows.map((row) => item(row, true)),
  ].slice(0, newCardsLimit);
  // The deck's remaining review limit covers the reviews and new cards it offers today. Cards on a
  // learning step are never held back by it, as in Anki, or a card left mid-step would be stranded.
  let room = options?.limit ?? 0;
  const take = (list: DailyQueueItem[]) => {
    const kept = list.slice(0, Math.max(0, room));
    room -= kept.length;
    return kept;
  };
  return { deckId, settings, learning, reviews: take(reviews), fresh: take(fresh) };
}

/** New cards from the decks in turn, so no deck crowds out the others. */
function interleave(lists: readonly DailyQueueItem[][]): DailyQueueItem[] {
  const out: DailyQueueItem[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i += 1) for (const list of lists) if (list[i]) out.push(list[i]);
  return out;
}

export async function buildDailyQueue(db: AppDatabase, now = new Date()): Promise<DailyQueue> {
  const today = localDateOf(now);
  const [habit, deckIds, presses] = await Promise.all([
    readHabitSettings(db),
    readDailyDeckIds(db),
    readExtraPresses(db, today),
  ]);
  const streakCards = streakCardsFor(habit.minimum.pages);
  const baseBudget = streakCards * 2;
  const budget = baseBudget * (1 + presses);

  const planDeck = habit.retentionCounts ? await deckQueue(db, SMART_DECK_IDS.retention) : null;
  const planCards = planDeck ? [...planDeck.learning, ...planDeck.reviews, ...planDeck.fresh] : [];

  const decks = await Promise.all(deckIds.map((deckId) => deckQueue(db, deckId)));
  const ordered = [
    ...decks.flatMap((deck) => deck.learning).sort(byDue),
    ...decks.flatMap((deck) => deck.reviews).sort(byDue),
    ...interleave(decks.map((deck) => deck.fresh)),
  ];

  const studied = await readStudiedToday(db, today, deckIds);
  // A card already studied today that returns on a learning step spent its place in the budget then.
  let room = Math.max(0, budget - studied.size);
  let roomAtBase = Math.max(0, baseBudget - studied.size);
  const cards: DailyQueueItem[] = [];
  let heldBack = 0;
  let leftAtBase = 0;
  for (const item of ordered) {
    if (studied.has(item.card.id)) {
      cards.push(item);
      leftAtBase += 1;
      continue;
    }
    if (roomAtBase > 0) {
      roomAtBase -= 1;
      leftAtBase += 1;
    }
    if (room > 0) {
      cards.push(item);
      room -= 1;
    } else heldBack += 1;
  }

  const perDeck: Record<string, number> = {};
  for (const item of cards) perDeck[item.card.deck_id] = (perDeck[item.card.deck_id] ?? 0) + 1;
  const studiedPerDeck: Record<string, number> = {};
  for (const deckId of studied.values()) studiedPerDeck[deckId] = (studiedPerDeck[deckId] ?? 0) + 1;
  return {
    planCards,
    cards,
    heldBack,
    streakCards,
    baseBudget,
    budget,
    studiedToday: studied.size,
    deckIds,
    perDeck,
    studiedPerDeck,
    leftAtBase,
  };
}

/**
 * Retention's ayah reviews due now, without new cards, under its own limits: an ayah plan's review
 * (SPEC 3.5). Cards on a learning step count even once the daily limit is spent, as the session still
 * shows them. Home (from the same queue), the wird-left line, the reminders and the widget all read
 * this one count, so none of them says the review is done while another still asks for it.
 */
export async function countAyahReviewsDue(db: AppDatabase): Promise<number> {
  const deck = await deckQueue(db, SMART_DECK_IDS.retention);
  return deck.learning.length + deck.reviews.length;
}

/**
 * The daily session's cards, ready to grade: plan cards first, then daily cards. Only the virtual
 * cards that survived the budget cut get rows, just before the session shows them, so Home's count
 * and an unopened session never create rows. A candidate that is live in another deck is left out.
 */
export async function loadDailyReviewQueue(db: AppDatabase, now = new Date()): Promise<ReviewQueueItem[]> {
  const queue = await buildDailyQueue(db, now);
  const items = [...queue.planCards, ...queue.cards];
  const virtualByDeck = new Map<string, string[]>();
  for (const item of items) {
    if (!item.virtual) continue;
    virtualByDeck.set(item.card.deck_id, [...(virtualByDeck.get(item.card.deck_id) ?? []), item.card.id]);
  }
  const created = new Map<string, StudyCardRow>();
  for (const [deckId, ids] of virtualByDeck) {
    if (!isSmartDeckId(deckId)) continue;
    await materializeSmartCardIds(db, deckId, ids);
    const rows = await db.getAllAsync<StudyCardRow>(
      `SELECT * FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => "?").join(", ")})`,
      [deckId, ...ids],
    );
    for (const row of rows) created.set(row.id, row);
  }
  return items.flatMap((item) => {
    if (!item.virtual) return [{ card: item.card, settings: item.settings }];
    const row = created.get(item.card.id);
    return row ? [{ card: row, settings: item.settings }] : [];
  });
}

/** The decks a daily session reads, for its next-review line: the daily decks, and Retention for an ayah plan. */
export async function readDailySessionDeckIds(db: DatabaseExecutor): Promise<string[]> {
  const [habit, deckIds] = await Promise.all([readHabitSettings(db), readDailyDeckIds(db)]);
  return habit.retentionCounts ? [SMART_DECK_IDS.retention, ...deckIds] : deckIds;
}
