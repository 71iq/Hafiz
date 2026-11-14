import { getNextEligibleReviewDate } from "@/lib/fsrs/queries";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

let store: OutboxDatabase;

beforeEach(async () => {
  store = await openOutboxDatabase();
});

afterEach(async () => {
  await store.close();
});

function card(id: string, deckId: string, due: string) {
  store.sql
    .prepare(
      `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
        last_review, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 1, 5, 0, 0, 0, 1, 0, 2, NULL, ?, ?, NULL)`,
    )
    .run(id, deckId, due, due, due);
}

describe("the flashcard summary's next review", () => {
  it("is the earliest flashcard, not a hifz page or a sabaq chunk past its day (SBQ-03)", async () => {
    card("chunk:madani15:5:1-4", "hifz-sabaq", "2026-01-01T00:00:00.000Z");
    card("page:madani15:5", "hifz-pages", "2026-01-02T00:00:00.000Z");
    card("word:2:255:3", "meanings", "2026-02-01T00:00:00.000Z");

    await expect(getNextEligibleReviewDate(store.db)).resolves.toBe("2026-02-01T00:00:00.000Z");
  });
});
