import { deleteUserSetting, writeUserSetting } from "@/lib/database/user-settings";
import { writeAllDecksFilter } from "@/lib/fsrs/smart-decks";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const OLD = "2026-01-01T00:00:00.000Z";
let store: OutboxDatabase;

function setting(key: string) {
  return store.sql.prepare("SELECT value FROM user_settings WHERE key = ?").get(key)?.value;
}

function queued() {
  return store.sql
    .prepare("SELECT operation, row_id FROM sync_queue ORDER BY id")
    .all()
    .map((row) => `${row.operation}:${row.row_id}`);
}

function deckFilterKeys() {
  return store.sql
    .prepare("SELECT key FROM user_settings WHERE key LIKE 'smart_deck_filter_%' ORDER BY key")
    .all()
    .map((row) => String(row.key));
}

beforeEach(async () => {
  store = await openOutboxDatabase();
  store.sql
    .prepare("INSERT INTO user_settings (key, value, updated_at) VALUES ('daily_review_limit', '20', ?)")
    .run(OLD);
});

afterEach(async () => {
  await store.close();
});

describe("RF-172 user setting writes and their upload queue", () => {
  it("rolls back a syncable setting when its queue write fails, then saves and queues it on retry", async () => {
    store.failQueueInsert(1);

    await expect(writeUserSetting(store.db, "daily_review_limit", "30")).rejects.toThrow(
      "Synthetic sync_queue write failure",
    );

    expect(setting("daily_review_limit")).toBe("20");
    expect(queued()).toEqual([]);

    await writeUserSetting(store.db, "daily_review_limit", "30");

    expect(setting("daily_review_limit")).toBe("30");
    expect(queued()).toEqual(["UPDATE:daily_review_limit"]);
  });

  it("keeps a syncable setting when its tombstone queue write fails, then deletes and queues it on retry", async () => {
    store.failQueueInsert(1);

    await expect(deleteUserSetting(store.db, "daily_review_limit")).rejects.toThrow(
      "Synthetic sync_queue write failure",
    );

    expect(setting("daily_review_limit")).toBe("20");
    expect(queued()).toEqual([]);

    await deleteUserSetting(store.db, "daily_review_limit");

    expect(setting("daily_review_limit")).toBeUndefined();
    expect(queued()).toEqual(["DELETE:daily_review_limit"]);
  });

  it("saves local-only settings without queueing an upload", async () => {
    await writeUserSetting(store.db, "device_habit_grace_note_seen", "2026-11-12");
    await deleteUserSetting(store.db, "device_habit_grace_note_seen");
    await writeUserSetting(store.db, "notif_prayer_location", "{}");
    await writeUserSetting(store.db, "theme", "dark");

    expect(setting("theme")).toBe("dark");
    expect(queued()).toEqual([]);
  });

  it("queues the plan, habit and onboarding settings (spec 7.6, ONB-05)", async () => {
    await writeUserSetting(store.db, "onboarding_completed", "true");
    await writeUserSetting(store.db, "hifz_minimum_wird", JSON.stringify({ pages: 1, minutes: 5 }));
    await writeUserSetting(store.db, "habit_week_start", "6");

    expect(queued()).toEqual(["UPDATE:onboarding_completed", "UPDATE:hifz_minimum_wird", "UPDATE:habit_week_start"]);
  });

  it("writes every deck filter or none when a later queue write fails", async () => {
    store.failQueueInsert(3);

    await expect(writeAllDecksFilter(store.db, { type: "all" })).rejects.toThrow("Synthetic sync_queue write failure");

    expect(deckFilterKeys()).toEqual([]);
    expect(queued()).toEqual([]);

    await writeAllDecksFilter(store.db, { type: "all" });

    const keys = deckFilterKeys();
    expect(keys.length).toBeGreaterThan(2);
    expect([...queued()].sort()).toEqual(keys.map((key) => `UPDATE:${key}`).sort());
    expect(new Set(keys.map(setting))).toEqual(new Set([JSON.stringify({ type: "all" })]));
  });
});
