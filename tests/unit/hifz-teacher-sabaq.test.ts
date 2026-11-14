import { atLocalTime } from "@/lib/habit/dates";
import { startReviewSession } from "@/lib/fsrs/review-sessions";
import { Rating, type Grade } from "@/lib/fsrs/scheduler";
import { DEFAULT_HIFZ_PLAN } from "@/lib/hifz/plan";
import { declareMemorizedPages } from "@/lib/hifz/pages";
import {
  assignedSabaqOpen,
  completeSabaqChunk,
  nextSabaqTarget,
  saveSabaqCleanRun,
  type SabaqTarget,
} from "@/lib/hifz/sabaq";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const TODAY = "2026-11-13";

/**
 * SOC-03: a teacher's next sabaq. The plan memorizes from al-Fatihah, so page 1 is its next page; the
 * teacher can send the lesson elsewhere, and the lesson stays inside the lines they chose.
 */
describe("a teacher's next sabaq (SOC-03)", () => {
  let store: OutboxDatabase;
  const plan = { ...DEFAULT_HIFZ_PLAN, method: "standard" as const, direction: "from_fatiha" as const };
  const pageWords = () => null;

  /**
   * Page 1: the surah name on line 1, then 7 ayat on lines 2 to 8. Page 2: 3 ayat on lines 1 to 3.
   * Every line ends its ayah.
   */
  function seedPages() {
    store.sql.exec(
      "INSERT INTO surahs (number, name_arabic, name_english, ayah_count, revelation_type) VALUES (1, 'الفاتحة', 'Al-Fatihah', 7, 'Meccan')",
    );
    store.sql.exec(
      "INSERT INTO surahs (number, name_arabic, name_english, ayah_count, revelation_type) VALUES (2, 'البقرة', 'Al-Baqarah', 3, 'Medinan')",
    );
    store.sql.exec(
      "INSERT INTO page_lines (page_number, line_number, line_type, is_centered, first_word_id, last_word_id, surah_number) VALUES (1, 1, 'surah_name', 1, NULL, NULL, 1)",
    );
    const ayah = store.sql.prepare(
      "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const line = store.sql.prepare(
      "INSERT INTO page_lines (page_number, line_number, line_type, is_centered, first_word_id, last_word_id, surah_number) VALUES (?, ?, 'ayah', 0, ?, ?, NULL)",
    );
    for (let n = 1; n <= 7; n += 1) {
      ayah.run(1, n, `كلمة${n} أخرى`, `w${n}`, `a${n} b${n} m${n}`, 1);
      const first = (n - 1) * 3 + 1;
      line.run(1, n + 1, first, first + 2);
    }
    for (let n = 1; n <= 3; n += 1) {
      ayah.run(2, n, `قول${n} آخر`, `q${n}`, `c${n} d${n} e${n}`, 2);
      const first = 21 + (n - 1) * 3 + 1;
      line.run(2, n, first, first + 2);
    }
  }

  beforeEach(async () => {
    store = await openOutboxDatabase();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    seedPages();
  });
  afterEach(async () => {
    await store.db.getFirstAsync("SELECT 1");
    await store.close();
    jest.restoreAllMocks();
  });

  /** One lesson as the sabaq screen saves it: step 6's clean run, then the fluent check. */
  async function learn(target: SabaqTarget, rating: Grade, checkAt: Date) {
    const session = startReviewSession("sabaq", { now: new Date(checkAt.getTime() - 10 * 60_000) });
    await saveSabaqCleanRun(store.db, {
      target,
      plan,
      session,
      durationMs: 60_000,
      now: new Date(checkAt.getTime() - 5 * 60_000),
    });
    await completeSabaqChunk(store.db, { target, plan, rating, session, durationMs: 60_000, now: checkAt });
  }

  it("memorizes the assigned lines before the plan's next page, then goes back to the plan", async () => {
    const assigned = { page: 2, fromLine: 2, toLine: 3 };
    const first = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords, assigned }))!;
    expect(first).toMatchObject({ page: 2, fromLine: 2, toLine: 3, assigned: true, completesPage: false });
    expect(first.ayahs).toEqual([
      { surah: 2, ayah: 2 },
      { surah: 2, ayah: 3 },
    ]);
    expect(await assignedSabaqOpen(store.db, assigned)).toBe(true);

    await learn(first, Rating.Good, atLocalTime(TODAY, 9 * 60));
    expect(await assignedSabaqOpen(store.db, assigned)).toBe(false);
    // The assigned lines are memorized; the plan's next page comes back.
    const next = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords, assigned }))!;
    expect(next).toMatchObject({ page: 1, fromLine: 2, toLine: 5, assigned: false });
  });

  it("keeps a lesson inside the assigned lines and the plan's lesson size", async () => {
    // Lines 3 to 8 at three lines a lesson: lines 3 to 5 first, never line 2 before them.
    const assigned = { page: 1, fromLine: 3, toLine: 8 };
    const first = (await nextSabaqTarget(store.db, { plan, wantLines: 3, pageWords, assigned }))!;
    expect(first).toMatchObject({ page: 1, fromLine: 3, toLine: 5, assigned: true });
    await learn(first, Rating.Good, atLocalTime(TODAY, 9 * 60));
    // Lines 6 to 8 next, though the plan's own order would offer line 2.
    const second = (await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords, assigned }))!;
    expect(second).toMatchObject({ page: 1, fromLine: 6, toLine: 8, assigned: true, completesPage: false });
  });

  it("offers assigned lines again after a failed check, as plan lines are", async () => {
    // Part of the page, since step 6 of a page's last lines adds the page to review.
    const assigned = { page: 2, fromLine: 1, toLine: 2 };
    const first = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords, assigned }))!;
    await learn(first, Rating.Again, atLocalTime(TODAY, 9 * 60));
    expect(await assignedSabaqOpen(store.db, assigned)).toBe(true);
    expect(await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords, assigned })).toMatchObject({
      page: 2,
      fromLine: 1,
      toLine: 2,
      assigned: true,
    });
  });

  it("ignores an assignment on a page already memorized, or one with no ayah lines in its range", async () => {
    await declareMemorizedPages(store.db, { pages: [2], cycleDays: 30 });
    const memorized = { page: 2, fromLine: 1, toLine: 3 };
    expect(await assignedSabaqOpen(store.db, memorized)).toBe(false);
    expect(await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords, assigned: memorized })).toMatchObject({
      page: 1,
      assigned: false,
    });
    // Line 1 of page 1 is the surah name.
    const nameOnly = { page: 1, fromLine: 1, toLine: 1 };
    expect(await assignedSabaqOpen(store.db, nameOnly)).toBe(false);
    expect(await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords, assigned: nameOnly })).toMatchObject({
      page: 1,
      fromLine: 2,
      assigned: false,
    });
  });
});
