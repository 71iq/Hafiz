import { backfillAchievements, recordAchievementEvent, subscribeAchievementUnlocks } from "@/lib/achievements/queries";
import type { AchievementUnlock } from "@/lib/achievements/types";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const OLD = "2026-01-01T00:00:00.000Z";
let store: OutboxDatabase;
let heard: AchievementUnlock[];
let unsubscribe: () => void;

function unlockIds() {
  return store.sql
    .prepare("SELECT achievement_id FROM achievement_unlocks ORDER BY achievement_id")
    .all()
    .map((row) => String(row.achievement_id));
}

function queuedIds() {
  return store.sql
    .prepare("SELECT row_id FROM sync_queue WHERE table_name = 'achievement_unlocks' ORDER BY row_id")
    .all()
    .map((row) => String(row.row_id));
}

function seedDeckAndNote() {
  store.sql
    .prepare("INSERT INTO user_settings (key, value, updated_at) VALUES ('deck_synthetic', ?, ?)")
    .run(JSON.stringify({ id: "synthetic", createdAt: OLD }), OLD);
  store.sql
    .prepare(
      `INSERT INTO private_notes (id, surah, ayah_start, ayah_end, content, created_at, updated_at)
       VALUES ('note-1', 2, 255, 255, 'synthetic note', ?, ?)`,
    )
    .run(OLD, OLD);
}

beforeEach(async () => {
  store = await openOutboxDatabase();
  heard = [];
  unsubscribe = subscribeAchievementUnlocks((unlock) => heard.push(unlock));
});

afterEach(async () => {
  unsubscribe();
  await store.close();
});

describe("RF-173 achievement unlocks and their upload queue", () => {
  it("commits no unlock and notifies nobody when a later unlock's queue write fails, then backfills once", async () => {
    seedDeckAndNote();
    // The deck unlock queues first; fail the note unlock that follows in the same backfill.
    store.failQueueInsert(2);

    await expect(backfillAchievements(store.db, { notify: true })).rejects.toThrow(
      "Synthetic sync_queue write failure",
    );

    expect(unlockIds()).toEqual([]);
    expect(queuedIds()).toEqual([]);
    expect(heard).toEqual([]);

    await backfillAchievements(store.db, { notify: true });

    expect(unlockIds()).toEqual(["first_deck_created", "first_private_note"]);
    expect(queuedIds()).toEqual(["first_deck_created", "first_private_note"]);
    expect(heard.map((unlock) => unlock.achievementId).sort()).toEqual(["first_deck_created", "first_private_note"]);

    await backfillAchievements(store.db, { notify: true });

    expect(queuedIds()).toEqual(["first_deck_created", "first_private_note"]);
    expect(heard).toHaveLength(2);
  });

  it("rolls back an event unlock whose queue write fails and records it on the next event", async () => {
    const event = { type: "mutashabih_pair_reviewed" as const, pairId: "mutashabihat:2:255", reviewedAt: OLD };
    store.failQueueInsert(1);

    await expect(recordAchievementEvent(store.db, event)).rejects.toThrow("Synthetic sync_queue write failure");

    expect(unlockIds()).toEqual([]);
    expect(heard).toEqual([]);

    await recordAchievementEvent(store.db, event);

    expect(unlockIds()).toEqual(["first_mutashabih_pair"]);
    expect(queuedIds()).toEqual(["first_mutashabih_pair"]);
    expect(heard.map((unlock) => unlock.achievementId)).toEqual(["first_mutashabih_pair"]);
  });

  it("writes nothing when a repeated backfill finds every achievement unchanged, then only what changed", async () => {
    seedDeckAndNote();
    const word = store.sql.prepare(
      "INSERT INTO word_roots (surah, ayah, word_pos, word_text) VALUES (?, ?, ?, 'synthetic')",
    );
    for (const [surah, ayah, words] of [
      [2, 282, 3],
      [1, 1, 2],
    ]) {
      for (let position = 1; position <= words; position++) word.run(surah, ayah, position);
    }
    await backfillAchievements(store.db, { notify: false });
    expect(
      store.sql.prepare("SELECT payload FROM achievement_progress WHERE achievement_id = 'longest_ayah_reviewed'").get()
        ?.payload,
    ).toBe(JSON.stringify({ surah: 2, ayah: 282, word_count: 3 }));
    const progress = () =>
      store.sql.prepare("SELECT achievement_id, current_value, updated_at FROM achievement_progress").all();
    const first = progress();
    expect(first.length).toBeGreaterThan(15);

    store.statements.length = 0;
    await backfillAchievements(store.db, { notify: false });

    expect(store.statements.filter((source) => /^\s*(INSERT|UPDATE|DELETE)/i.test(source))).toEqual([]);
    expect(progress()).toEqual(first);
    // The longest ayah is read from its saved progress row instead of counting every word again.
    expect(store.statements.filter((source) => source.includes("FROM word_roots"))).toEqual([]);

    store.sql
      .prepare(
        `INSERT INTO private_notes (id, surah, ayah_start, ayah_end, content, created_at, updated_at)
         VALUES ('note-2', 2, 256, 256, 'second synthetic note', ?, ?)`,
      )
      .run(OLD, OLD);
    store.statements.length = 0;
    await backfillAchievements(store.db, { notify: false });

    const written = store.statements.filter((source) => /^\s*INSERT OR REPLACE INTO achievement_progress/.test(source));
    expect(written).toHaveLength(1);
    const notes = store.sql
      .prepare("SELECT current_value FROM achievement_progress WHERE achievement_id = 'private_notes_10'")
      .get();
    expect(notes?.current_value).toBe(2);
  });

  it("recomputes from the stored rows after a rolled-back backfill", async () => {
    seedDeckAndNote();
    store.failQueueInsert(1);
    await expect(backfillAchievements(store.db, { notify: false })).rejects.toThrow(
      "Synthetic sync_queue write failure",
    );
    expect(store.sql.prepare("SELECT COUNT(*) AS count FROM achievement_progress").get()?.count).toBe(0);

    await backfillAchievements(store.db, { notify: false });

    expect(unlockIds()).toEqual(["first_deck_created", "first_private_note"]);
    expect(
      store.sql
        .prepare("SELECT current_value FROM achievement_progress WHERE achievement_id = 'first_deck_created'")
        .get()?.current_value,
    ).toBe(1);
  });

  it("does not notify during a silent backfill", async () => {
    seedDeckAndNote();

    await backfillAchievements(store.db, { notify: false });

    expect(unlockIds()).toEqual(["first_deck_created", "first_private_note"]);
    expect(heard).toEqual([]);
  });
});
