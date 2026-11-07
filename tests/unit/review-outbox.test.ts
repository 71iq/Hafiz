import { persistReviewTransition } from "@/lib/fsrs/persist-review";
import { addMeaningCard, deleteStudyCard, setStudyCardMarked, setStudyCardSuspended } from "@/lib/fsrs/queries";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { calculateReviewTransition } from "@/lib/fsrs/review-transition";
import { Rating } from "@/lib/fsrs/scheduler";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const DECK = "synthetic-deck";
const CARD = "2:255";
let store: OutboxDatabase;

function count(table: string, where = "1 = 1") {
  return Number(store.sql.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get()?.count);
}

function card(): StudyCardRow | undefined {
  return store.sql.prepare("SELECT * FROM study_cards WHERE id = ?").get(CARD) as StudyCardRow | undefined;
}

/** Wait for detached post-commit work, such as achievement events, to leave the owner queue. */
async function settle() {
  await store.db.getFirstAsync("SELECT 1");
}

beforeEach(async () => {
  store = await openOutboxDatabase();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await settle();
  await store.close();
  jest.restoreAllMocks();
});

describe("RF-177 reviews, card actions and their upload queue", () => {
  it("saves neither the card nor its review log when the log's queue write fails, and notifies nobody", async () => {
    const original = await setStudyCardMarked(store.db, DECK, CARD, false);
    const queuedBefore = count("sync_queue");
    const heard = jest.fn();
    const unsubscribe = subscribeReviewActivity(heard);
    const transition = calculateReviewTransition({ card: original, rating: Rating.Good, reviewedAt: new Date() });
    // The card update queues first; fail the review log's queue write that follows.
    store.failQueueInsert(2);

    await expect(persistReviewTransition({ db: store.db, cardId: CARD, transition })).rejects.toThrow(
      "Synthetic sync_queue write failure",
    );

    expect(card()?.reps).toBe(original.reps);
    expect(count("study_log")).toBe(0);
    expect(count("sync_queue")).toBe(queuedBefore);
    expect(heard).not.toHaveBeenCalled();

    await persistReviewTransition({ db: store.db, cardId: CARD, transition });

    expect(card()?.reps).toBe(transition.updatedCard.reps);
    expect(count("study_log")).toBe(1);
    expect(count("sync_queue", "table_name = 'study_log'")).toBe(1);
    expect(heard).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not revive a card that was deleted while it was being graded (RF-181)", async () => {
    const loaded = await setStudyCardMarked(store.db, DECK, CARD, false);
    // For example, a sync pull or another tab deletes the card during the session.
    await deleteStudyCard(store.db, DECK, CARD);
    const queuedBefore = count("sync_queue");
    const transition = calculateReviewTransition({ card: loaded, rating: Rating.Good, reviewedAt: new Date() });

    await expect(persistReviewTransition({ db: store.db, cardId: CARD, transition })).rejects.toThrow(
      "This card was deleted",
    );

    expect(card()?.deleted_at).toEqual(expect.any(String));
    expect(count("study_log")).toBe(0);
    expect(count("sync_queue")).toBe(queuedBefore);
  });

  it("creates no card when a first card action cannot be queued", async () => {
    // A first action creates the card row, then updates it; fail the update's queue write.
    store.failQueueInsert(2);

    await expect(setStudyCardSuspended(store.db, DECK, CARD, true)).rejects.toThrow(
      "Synthetic sync_queue write failure",
    );

    expect(card()).toBeUndefined();
    expect(count("sync_queue")).toBe(0);

    const suspended = await setStudyCardSuspended(store.db, DECK, CARD, true);

    expect(card()?.suspended_at).toBe(suspended.suspended_at);
    expect(count("sync_queue", "table_name = 'study_cards'")).toBe(2);
  });

  it("keeps a card when its deletion cannot be queued", async () => {
    await setStudyCardMarked(store.db, DECK, CARD, true);
    store.failQueueInsert(1);

    await expect(deleteStudyCard(store.db, DECK, CARD)).rejects.toThrow("Synthetic sync_queue write failure");

    expect(card()?.deleted_at).toBeNull();

    await deleteStudyCard(store.db, DECK, CARD);

    expect(card()?.deleted_at).toEqual(expect.any(String));
    expect(count("sync_queue", "operation = 'DELETE'")).toBe(1);
  });

  it("saves neither the meanings deck nor its card when the card cannot be queued", async () => {
    // The new meanings deck setting queues first; fail the card's queue write that follows.
    store.failQueueInsert(2);

    await expect(addMeaningCard(store.db, 2, 255, 1)).rejects.toThrow("Synthetic sync_queue write failure");

    expect(count("study_cards")).toBe(0);
    expect(count("user_settings", "key = 'deck_meanings'")).toBe(0);
    expect(count("sync_queue")).toBe(0);

    await expect(addMeaningCard(store.db, 2, 255, 1)).resolves.toEqual({ created: true });
    await settle();

    expect(count("study_cards")).toBe(1);
    expect(count("user_settings", "key = 'deck_meanings'")).toBe(1);
    expect(count("sync_queue", "table_name IN ('study_cards', 'user_settings')")).toBe(2);
  });
});
