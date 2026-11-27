import { HIFZ_PAGES_DECK_ID, PAGE_COUNT, pageCardId } from "@/lib/hifz/units";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { DECLARED_WHOLE_QURAN_KEY } from "@/lib/study/daily-decks";
import { readKnownSurahs } from "@/lib/study/known-surahs";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

let store: OutboxDatabase;
beforeEach(async () => {
  store = await openOutboxDatabase();
});
afterEach(async () => {
  await store.close();
});

const stamp = "2026-11-01T00:00:00.000Z";
function addCard(id: string, deckId: string, deletedAt: string | null = null, suspendedAt: string | null = null) {
  store.sql
    .prepare(
      `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
       created_at, updated_at, deleted_at, suspended_at) VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?, ?)`,
    )
    .run(id, deckId, stamp, stamp, stamp, deletedAt, suspendedAt);
}

it("leaves related ayahs unrestricted without any memorized pages or live Retention ayahs", async () => {
  addCard("2:5", SMART_DECK_IDS.retention, stamp);
  addCard("2:6:1", SMART_DECK_IDS.retention);
  addCard("3:7bad", SMART_DECK_IDS.retention);
  addCard("word:4:8:1", "meanings");
  addCard("mutashabihat:fixture:0", SMART_DECK_IDS.mutashabihat);
  addCard(pageCardId(602), HIFZ_PAGES_DECK_ID, null, stamp);
  expect(await readKnownSurahs(store.db)).toBeNull();
});

it("includes every surah on a memorized page and every live Retention ayah's surah", async () => {
  store.sql.exec(`INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, v2_page) VALUES
    (105, 1, '', '', 601), (106, 1, '', '', 602), (107, 1, '', '', 602), (108, 1, '', '', 602)`);
  addCard(pageCardId(602), HIFZ_PAGES_DECK_ID);
  addCard("2:10", SMART_DECK_IDS.retention, null, stamp);
  addCard("3:1", SMART_DECK_IDS.retention);
  expect(await readKnownSurahs(store.db)).toEqual(new Set([2, 3, 106, 107, 108]));
});

it.each(["declared", "pages", "badge"])("includes all 114 surahs for a whole-Quran record (%s)", async (source) => {
  if (source === "declared") {
    store.sql
      .prepare("INSERT INTO user_settings (key, value, updated_at) VALUES (?, 'true', ?)")
      .run(DECLARED_WHOLE_QURAN_KEY, stamp);
  } else if (source === "pages") {
    for (let page = 1; page <= PAGE_COUNT; page++) addCard(pageCardId(page), HIFZ_PAGES_DECK_ID);
  } else {
    store.sql
      .prepare("INSERT INTO achievement_unlocks (achievement_id, unlocked_at) VALUES ('quran_complete', ?)")
      .run(stamp);
  }
  expect(await readKnownSurahs(store.db)).toEqual(new Set(Array.from({ length: 114 }, (_, i) => i + 1)));
});
