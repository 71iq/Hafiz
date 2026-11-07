import { materializeSmartDeckCards, migrateLegacyRetentionDecks, SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const OLD = "2026-01-01T00:00:00.000Z";
let store: OutboxDatabase;

function count(table: string, where = "1 = 1") {
  return Number(store.sql.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get()?.count);
}

function seedLegacyRetentionCard() {
  store.sql
    .prepare(
      `INSERT INTO study_cards
        (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
         last_review, created_at, updated_at, deleted_at)
       VALUES ('2:255', 'legacy-deck', ?, 0, 0, 0, 0, 0, 0, 0, 0, NULL, ?, ?, NULL)`,
    )
    .run(OLD, OLD, OLD);
  store.sql
    .prepare("INSERT INTO user_settings (key, value, updated_at) VALUES ('deck_legacy-deck', ?, ?)")
    .run(JSON.stringify({ id: "legacy-deck", createdAt: OLD }), OLD);
}

beforeEach(async () => {
  store = await openOutboxDatabase();
});

afterEach(async () => {
  await store.close();
});

describe("RF-178 smart decks and their upload queue", () => {
  it("keeps the legacy deck when a migrated card cannot be queued, then migrates and queues it once", async () => {
    seedLegacyRetentionCard();
    store.failQueueInsert(1);

    await expect(migrateLegacyRetentionDecks(store.db)).rejects.toThrow("Synthetic sync_queue write failure");

    expect(count("study_cards", "id = '2:255' AND deck_id = 'legacy-deck'")).toBe(1);
    expect(count("user_settings", "key = 'deck_legacy-deck'")).toBe(1);
    expect(count("sync_queue")).toBe(0);

    await expect(migrateLegacyRetentionDecks(store.db)).resolves.toBe(1);

    expect(count("study_cards", `id = '2:255' AND deck_id = '${SMART_DECK_IDS.retention}'`)).toBe(1);
    expect(count("user_settings", "key = 'deck_legacy-deck'")).toBe(0);
    expect(count("sync_queue", "table_name = 'study_cards' AND operation = 'UPDATE'")).toBe(1);
    expect(count("sync_queue", "table_name = 'user_settings' AND row_id = 'deck_legacy-deck'")).toBe(1);
  });

  it("keeps the legacy deck setting when its tombstone cannot be queued", async () => {
    seedLegacyRetentionCard();
    // The migrated card queues first; fail the deck setting's tombstone that follows.
    store.failQueueInsert(2);

    await expect(migrateLegacyRetentionDecks(store.db)).rejects.toThrow("Synthetic sync_queue write failure");

    expect(count("study_cards", "deck_id = 'legacy-deck'")).toBe(1);
    expect(count("user_settings", "key = 'deck_legacy-deck'")).toBe(1);
    expect(count("sync_queue")).toBe(0);
  });

  it("creates no smart-deck cards when one cannot be queued, then creates and queues each once", async () => {
    for (const ayah of [1, 2, 3]) {
      store.sql
        .prepare("INSERT INTO qiraat_encyclopedia (surah, ayah, text) VALUES (2, ?, 'synthetic qiraat')")
        .run(ayah);
    }
    store.failQueueInsert(2);

    await expect(materializeSmartDeckCards(store.db, SMART_DECK_IDS.qiraat, 3, 3)).rejects.toThrow(
      "Synthetic sync_queue write failure",
    );

    expect(count("study_cards")).toBe(0);
    expect(count("sync_queue")).toBe(0);

    await expect(materializeSmartDeckCards(store.db, SMART_DECK_IDS.qiraat, 3, 3)).resolves.toBe(3);

    expect(count("study_cards", `deck_id = '${SMART_DECK_IDS.qiraat}'`)).toBe(3);
    expect(count("sync_queue", "table_name = 'study_cards' AND operation = 'INSERT'")).toBe(3);
  });
});
