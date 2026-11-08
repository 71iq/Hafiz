import { setStudyCardMarked } from "@/lib/fsrs/queries";
import {
  getSmartDeckStats,
  getSmartDeckTodayStats,
  materializeSmartDeckCards,
  SMART_DECK_IDS,
} from "@/lib/fsrs/smart-decks";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const OLD = "2026-01-01T00:00:00.000Z";
let store: OutboxDatabase;

function seedLiveCard(id: string, deckId: string) {
  store.sql
    .prepare(
      `INSERT INTO study_cards
        (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
         last_review, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 12.5, 4.2, 3, 9, 0, 5, 1, 2, ?, ?, ?, NULL)`,
    )
    .run(id, deckId, OLD, OLD, OLD, OLD);
}

function card(id: string) {
  return store.sql.prepare("SELECT deck_id, reps, stability, marked_at FROM study_cards WHERE id = ?").get(id);
}

function queued(id: string) {
  return store.sql
    .prepare("SELECT operation FROM sync_queue WHERE table_name = 'study_cards' AND row_id = ? ORDER BY id")
    .all(id)
    .map((row) => String(row.operation));
}

beforeEach(async () => {
  store = await openOutboxDatabase();
});

afterEach(async () => {
  await store.close();
});

describe("RF-179 card identity during creation", () => {
  it("does not create or upload an empty card for an id that is live in another deck", async () => {
    for (const ayah of [1, 2, 3]) {
      store.sql
        .prepare("INSERT INTO qiraat_encyclopedia (surah, ayah, text) VALUES (2, ?, 'synthetic qiraat')")
        .run(ayah);
    }
    // For example, a row a sync pull committed in another deck after the deck-scoped read.
    seedLiveCard("qiraat:2:1", "synthetic-other-deck");

    await expect(materializeSmartDeckCards(store.db, SMART_DECK_IDS.qiraat, 3, 3)).resolves.toBe(2);

    expect(card("qiraat:2:1")).toEqual({ deck_id: "synthetic-other-deck", reps: 5, stability: 12.5, marked_at: null });
    expect(queued("qiraat:2:1")).toEqual([]);
    expect(queued("qiraat:2:2")).toEqual(["INSERT"]);
    expect(queued("qiraat:2:3")).toEqual(["INSERT"]);
  });

  it("queues each new card once when two materializations of a deck overlap", async () => {
    for (const ayah of [1, 2, 3]) {
      store.sql
        .prepare("INSERT INTO qiraat_encyclopedia (surah, ayah, text) VALUES (2, ?, 'synthetic qiraat')")
        .run(ayah);
    }

    const created = await Promise.all([
      materializeSmartDeckCards(store.db, SMART_DECK_IDS.qiraat, 3, 3),
      materializeSmartDeckCards(store.db, SMART_DECK_IDS.qiraat, 3, 3),
    ]);

    expect(created[0] + created[1]).toBe(3);
    for (const ayah of [1, 2, 3]) expect(queued(`qiraat:2:${ayah}`)).toEqual(["INSERT"]);
  });

  it("keeps a card's progress when an action targets it from another deck", async () => {
    seedLiveCard("2:255", "synthetic-other-deck");

    const marked = await setStudyCardMarked(store.db, SMART_DECK_IDS.retention, "2:255", true);

    expect(card("2:255")).toEqual({
      deck_id: "synthetic-other-deck",
      reps: 5,
      stability: 12.5,
      marked_at: marked.marked_at,
    });
    expect(marked.reps).toBe(5);
    expect(queued("2:255")).toEqual(["UPDATE"]);
  });
});

describe("RF-182 smart-deck stats count only reachable cards", () => {
  beforeEach(() => {
    for (const ayah of [1, 2, 3]) {
      store.sql
        .prepare("INSERT INTO qiraat_encyclopedia (surah, ayah, text) VALUES (2, ?, 'synthetic qiraat')")
        .run(ayah);
    }
    // The session never shows this id from the smart deck: materialization skips a card live elsewhere.
    seedLiveCard("qiraat:2:1", "synthetic-other-deck");
  });

  it("does not count a candidate live in another deck as new or due", async () => {
    await expect(getSmartDeckStats(store.db, SMART_DECK_IDS.qiraat)).resolves.toEqual({
      total: 3,
      due: 2,
      newCount: 2,
    });
  });

  it("does not offer a candidate live in another deck in today's counts", async () => {
    await expect(
      getSmartDeckTodayStats(store.db, SMART_DECK_IDS.qiraat, { limit: 10, newCardsLimit: 10 }),
    ).resolves.toEqual({ total: 3, due: 0, newCount: 2 });
    await expect(materializeSmartDeckCards(store.db, SMART_DECK_IDS.qiraat, 10, 10)).resolves.toBe(2);
  });
});
