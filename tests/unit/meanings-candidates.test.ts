import path from "node:path";
import { MEANINGS_DECK_ID, readDeckReviewSettings, writeDeckReviewSettings } from "@/lib/fsrs/queries";
import { localDateOf } from "@/lib/habit/dates";
import { applyPreset, DEFAULT_HIFZ_PLAN, writeHifzPlan } from "@/lib/hifz/plan";
import { pickMeaningCandidates } from "@/lib/meanings/candidates";
import { loadLemmaIndex, positionKey } from "@/lib/meanings/lemma-index";
import { MEANINGS_SETTING_KEYS, readMeaningsSettings } from "@/lib/meanings/settings";
import { buildDailyQueue, loadDailyReviewQueue } from "@/lib/study/daily-queue";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/** Generated word-meaning candidates (SPEC 3.6) over the bundled word tables. */
let store: OutboxDatabase;
const now = new Date();

beforeEach(async () => {
  store = await openOutboxDatabase();
  store.sql.exec(`ATTACH DATABASE '${path.resolve(__dirname, "../../assets/data/quran.db")}' AS bundled`);
  for (const table of ["quran_text", "surahs", "word_roots", "word_irab", "word_meanings_ar"]) {
    store.sql.exec(`DELETE FROM main.${table}`);
    store.sql.exec(`INSERT INTO main.${table} SELECT * FROM bundled.${table}`);
  }
}, 60_000);

afterEach(async () => {
  jest.restoreAllMocks();
  await store.close();
});

const set = (key: string, value: string) =>
  store.sql
    .prepare("INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)")
    .run(key, value, now.toISOString());
const memorizePage = (page: number) =>
  store.sql
    .prepare(
      `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps,
        lapses, state, last_review, created_at, updated_at) VALUES (?, 'hifz-pages', ?, 30, 5, 1, 30, 0, 3, 0, 2, ?, ?, ?)`,
    )
    .run(
      `page:madani15:${page}`,
      new Date(now.getTime() + 20 * 86_400_000).toISOString(),
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
    );
const pageOf = (surah: number, ayah: number) =>
  (
    store.sql.prepare("SELECT v2_page AS page FROM quran_text WHERE surah = ? AND ayah = ?").get(surah, ayah) as {
      page: number;
    }
  ).page;

it("starts a new English learner on the commonest words, one card per lemma", async () => {
  set(MEANINGS_SETTING_KEYS.language, "en");
  set(MEANINGS_SETTING_KEYS.level, "0");
  const index = await loadLemmaIndex(store.db);
  const picked = await pickMeaningCandidates(store.db, { now, limit: 10 });
  expect(picked).toHaveLength(10);
  expect(picked.every((candidate) => candidate.band === 0)).toBe(true);
  expect(new Set(picked.map((candidate) => candidate.lemmaKey)).size).toBe(10);
  // The first eligible occurrence of each, so the earliest commonest words come first.
  for (const candidate of picked) {
    const entry = index.lemmas.find((lemma) => lemma.key === candidate.lemmaKey)!;
    expect(candidate.position).toEqual(entry.positions.en[0]);
  }
});

it("skips the bands an Arabic reader's level counts as known, and uses one-word Arabic entries", async () => {
  set(MEANINGS_SETTING_KEYS.language, "ar");
  set(MEANINGS_SETTING_KEYS.level, "3");
  const index = await loadLemmaIndex(store.db);
  const picked = await pickMeaningCandidates(store.db, { now, limit: 20 });
  expect(picked).toHaveLength(20);
  expect(picked.every((candidate) => candidate.band >= 3)).toBe(true);
  for (const candidate of picked) {
    const entry = index.lemmas.find((lemma) => lemma.key === candidate.lemmaKey)!;
    expect(
      entry.positions.ar.some(
        (p) =>
          positionKey(p.surah, p.ayah, p.pos) ===
          positionKey(candidate.position.surah, candidate.position.ayah, candidate.position.pos),
      ),
    ).toBe(true);
  }
});

it("keeps to the memorized pages and puts today's review pages first", async () => {
  set(MEANINGS_SETTING_KEYS.language, "en");
  set(MEANINGS_SETTING_KEYS.level, "0");
  await writeHifzPlan(store.db, applyPreset(DEFAULT_HIFZ_PLAN, "maintenance"));
  for (const page of [582, 583, 584]) memorizePage(page);
  set(
    "device_hifz_today_plan",
    JSON.stringify({ date: localDateOf(now), ids: ["page:madani15:584"], newLines: 0, unit: "page" }),
  );
  const picked = await pickMeaningCandidates(store.db, { now, limit: 200 });
  expect(picked.length).toBeGreaterThan(0);
  expect(
    picked.every((candidate) => [582, 583, 584].includes(pageOf(candidate.position.surah, candidate.position.ayah))),
  ).toBe(true);
  const firstOther = picked.findIndex((candidate) => !candidate.today);
  expect(firstOther).toBeGreaterThan(0);
  expect(
    picked.slice(0, firstOther).every((candidate) => pageOf(candidate.position.surah, candidate.position.ayah) === 584),
  ).toBe(true);
});

it("never offers a lemma that already has a word card, even a deleted one", async () => {
  set(MEANINGS_SETTING_KEYS.language, "en");
  set(MEANINGS_SETTING_KEYS.level, "0");
  const [first] = await pickMeaningCandidates(store.db, { now, limit: 1 });
  const { surah, ayah, pos } = first.position;
  store.sql
    .prepare(
      `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps,
        lapses, state, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?)`,
    )
    .run(
      `word:${surah}:${ayah}:${pos}`,
      MEANINGS_DECK_ID,
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
    );
  const after = await pickMeaningCandidates(store.db, { now, limit: 50 });
  expect(after.some((candidate) => candidate.lemmaKey === first.lemmaKey)).toBe(false);
});

it("fills the daily list's meanings share read-only, and a session creates rows only for what it loads", async () => {
  set(MEANINGS_SETTING_KEYS.language, "en");
  await writeDeckReviewSettings(store.db, MEANINGS_DECK_ID, { newCardsLimit: 5, dailyReviewLimit: 20 });
  const queue = await buildDailyQueue(store.db, now);
  expect(queue.perDeck[MEANINGS_DECK_ID]).toBe(5);
  expect(store.sql.prepare("SELECT COUNT(*) AS n FROM study_cards WHERE id LIKE 'word:%'").get()).toEqual({ n: 0 });
  await loadDailyReviewQueue(store.db, now);
  expect(store.sql.prepare("SELECT COUNT(*) AS n FROM study_cards WHERE id LIKE 'word:%'").get()).toEqual({ n: 5 });
  // Created rows are not badge events: generated cards never go through addMeaningCard.
  expect(store.sql.prepare("SELECT COUNT(*) AS n FROM achievement_progress").get()).toEqual({ n: 0 });
  expect(store.sql.prepare("SELECT COUNT(*) AS n FROM achievement_unlocks").get()).toEqual({ n: 0 });
});

it("derives the meaning language, level and rate from the interface language without writing them", async () => {
  set("ui_language", "ar");
  expect(await readMeaningsSettings(store.db)).toEqual({
    language: "ar",
    level: 3,
    stored: { language: false, level: false },
  });
  // Five new word cards a day unless the deck's settings say otherwise.
  expect((await readDeckReviewSettings(store.db, MEANINGS_DECK_ID)).newCardsLimit).toBe(5);
  // Nothing is written: a written default would beat a choice made on another device, and would give
  // a fresh device settings of its own for the account restore to ask about.
  const written = store.sql
    .prepare("SELECT key FROM user_settings WHERE key IN (?, ?, ?)")
    .all(MEANINGS_SETTING_KEYS.language, MEANINGS_SETTING_KEYS.level, `review_settings_${MEANINGS_DECK_ID}`);
  expect(written).toEqual([]);
  // The derived values follow the interface language; a stored choice does not.
  set("ui_language", "en");
  expect(await readMeaningsSettings(store.db)).toMatchObject({ language: "en", level: 0 });
  set(MEANINGS_SETTING_KEYS.language, "ar");
  set("ui_language", "en");
  expect(await readMeaningsSettings(store.db)).toMatchObject({ language: "ar", level: 3, stored: { language: true, level: false } });
});

it("follows the interface the app shows when no interface language is stored", async () => {
  jest.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...new Intl.DateTimeFormat("en-US").resolvedOptions(),
    locale: "ar-SA",
  });
  expect(await readMeaningsSettings(store.db)).toMatchObject({ language: "ar", level: 3 });
});
