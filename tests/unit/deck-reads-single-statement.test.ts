import { readDeckReviewSettings } from "@/lib/fsrs/queries";
import { getSmartDeckStats, readSmartDeckFilter, SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const OLD = "2026-01-01T00:00:00.000Z";
let store: OutboxDatabase;

beforeEach(async () => {
  store = await openOutboxDatabase();
});

afterEach(async () => {
  await store.close();
});

function setting(key: string, value: unknown) {
  store.sql
    .prepare("INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)")
    .run(key, typeof value === "string" ? value : JSON.stringify(value), OLD);
}

describe("deck settings and filters are read in one statement each", () => {
  it("reads the shared review settings and a deck's own together, the deck's taking precedence", async () => {
    setting("daily_review_limit", "37");
    setting("flashcard_test_modes", ["translation"]);

    store.statements.length = 0;
    const shared = await readDeckReviewSettings(store.db, "synthetic-deck");
    expect(store.statements).toHaveLength(1);
    expect(shared.dailyReviewLimit).toBe(37);
    expect(shared.testModes).toEqual(["translation"]);

    setting("review_settings_synthetic-deck", { dailyReviewLimit: 12 });
    store.statements.length = 0;
    const own = await readDeckReviewSettings(store.db, "synthetic-deck");
    expect(store.statements).toHaveLength(1);
    expect(own.dailyReviewLimit).toBe(12);
    // A field the deck did not set falls back to the shared setting.
    expect(own.testModes).toEqual(["translation"]);

    setting("review_settings_synthetic-deck", "{not json");
    expect((await readDeckReviewSettings(store.db, "synthetic-deck")).dailyReviewLimit).toBe(37);
    expect((await readDeckReviewSettings(store.db, null)).dailyReviewLimit).toBe(37);
  });

  it("takes a deck's filter first, then the all-decks filter, then the retention deck's, then everything", async () => {
    const read = async () => {
      store.statements.length = 0;
      const filter = await readSmartDeckFilter(store.db, SMART_DECK_IDS.qiraat);
      expect(store.statements).toHaveLength(1);
      return filter;
    };
    expect(await read()).toEqual({ type: "all" });

    setting(`smart_deck_filter_${SMART_DECK_IDS.retention}`, { type: "juz", juzNumbers: [30] });
    expect(await read()).toEqual({ type: "juz", juzNumbers: [30] });

    setting("smart_deck_filter_all_decks", { type: "juz", juzNumbers: [29] });
    expect(await read()).toEqual({ type: "juz", juzNumbers: [29] });

    setting(`smart_deck_filter_${SMART_DECK_IDS.qiraat}`, { type: "juz", juzNumbers: [1] });
    expect(await read()).toEqual({ type: "juz", juzNumbers: [1] });

    // An unreadable deck filter is skipped, as an unset one is.
    setting(`smart_deck_filter_${SMART_DECK_IDS.qiraat}`, "{not json");
    expect(await read()).toEqual({ type: "juz", juzNumbers: [29] });
  });

  it("counts a large deck's new cards from one read of the live card ids", async () => {
    const ayah = store.sql.prepare(
      "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean) VALUES (2, ?, 'synthetic', 'synthetic')",
    );
    for (let number = 1; number <= 900; number++) ayah.run(number);
    const card = store.sql.prepare(
      `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
         reps, lapses, state, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 1, 1, 0, 1, 0, 1, 0, ?, ?, ?, ?)`,
    );
    // One card in this deck and due, and one deleted, which makes its ayah new again.
    card.run("2:1", SMART_DECK_IDS.retention, OLD, 2, OLD, OLD, null);
    card.run("2:3", SMART_DECK_IDS.retention, OLD, 2, OLD, OLD, OLD);

    store.statements.length = 0;
    const stats = await getSmartDeckStats(store.db, SMART_DECK_IDS.retention, { type: "all" });

    // 900 candidates: 2:1 is due, and the other 899 have no live card, so they are new and due.
    expect(stats).toEqual({ total: 900, due: 900, newCount: 899 });
    const liveReads = store.statements.filter((source) => source.startsWith("SELECT id FROM study_cards"));
    expect(liveReads).toEqual(["SELECT id FROM study_cards WHERE deleted_at IS NULL"]);
  });
});
