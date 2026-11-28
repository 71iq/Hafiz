import { HIFZ_PAGES_DECK_ID, PAGE_COUNT, pageCardId } from "@/lib/hifz/units";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { DECLARED_WHOLE_QURAN_KEY } from "@/lib/study/daily-decks";
import { readMemorizedAyahs, recordMemorizedPortion } from "@/lib/hifz/memorized-ayahs";
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

it("returns no ayahs without a declaration or memorization record", async () => {
  addCard("2:5", SMART_DECK_IDS.retention, stamp);
  addCard("2:6:1", SMART_DECK_IDS.retention);
  addCard("3:7bad", SMART_DECK_IDS.retention);
  addCard("word:4:8:1", "meanings");
  addCard("mutashabihat:fixture:0", SMART_DECK_IDS.mutashabihat);
  addCard(pageCardId(602), HIFZ_PAGES_DECK_ID, null, stamp);
  addCard("2:11", SMART_DECK_IDS.retention);
  expect(await readMemorizedAyahs(store.db)).toEqual(new Set());
});

it("includes exact ayahs on a memorized page and reviewed Retention ayahs", async () => {
  store.sql.exec(`INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, v2_page) VALUES
    (105, 1, '', '', 601), (106, 1, '', '', 602), (107, 1, '', '', 602), (108, 1, '', '', 602)`);
  addCard(pageCardId(602), HIFZ_PAGES_DECK_ID);
  addCard("2:10", SMART_DECK_IDS.retention, null, stamp);
  addCard("3:1", SMART_DECK_IDS.retention);
  store.sql.exec("UPDATE study_cards SET reps = 1 WHERE id IN ('2:10', '3:1')");
  expect(await readMemorizedAyahs(store.db)).toEqual(new Set(["2:10", "3:1", "106:1", "107:1", "108:1"]));
});

it.each(["declared", "pages", "badge"])("recognizes the whole Quran (%s)", async (source) => {
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
  expect(await readMemorizedAyahs(store.db)).toBeNull();
});

it("honors the declared juz boundary and keeps a declaration through an empty plan edit", async () => {
  store.sql.exec(`INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, v2_page) VALUES
    (2, 141, '', '', 21), (2, 142, '', '', 22), (3, 1, '', '', 50);
    INSERT INTO juz_map (juz, surah, ayah_start, ayah_end) VALUES (1, 2, 1, 141)`);
  await recordMemorizedPortion(store.db, [3], [1]);
  await recordMemorizedPortion(store.db, [], []);
  expect(await readMemorizedAyahs(store.db)).toEqual(new Set(["2:141", "3:1"]));
});
