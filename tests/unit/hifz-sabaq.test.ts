import { addDays, atLocalTime, localDateOf } from "@/lib/habit/dates";
import { readHabitDayRow } from "@/lib/habit/queries";
import { declareMemorizedPages, derivePageTiers, loadPageCard, loadPageCards, loadTodayWird } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN, writeHifzPlan } from "@/lib/hifz/plan";
import { countDueRemediation } from "@/lib/hifz/remediation";
import {
  addCoveredSabaqPages,
  completeSabaqChunk,
  countSecondLooks,
  loadSecondLooks,
  newPageOrder,
  nextSabaqTarget,
  saveSabaqCleanRun,
  saveSecondLook,
  type SabaqTarget,
} from "@/lib/hifz/sabaq";
import { REVIEW_LEARN_AHEAD_MS } from "@/lib/fsrs/review-transition";
import { startReviewSession } from "@/lib/fsrs/review-sessions";
import { chunkCardId, PAGE_COUNT, pageCardId, parsePageUnit } from "@/lib/hifz/units";
import { loadRecitationPage } from "@/lib/hifz/page-data";
import * as unitSwitch from "@/lib/hifz/unit-switch";
import { StudyCardDeletedError } from "@/lib/fsrs/card-errors";
import { getDeckTodayStats, loadReviewQueue, readDeckReviewSettings, REVIEW_DECK_IDS } from "@/lib/fsrs/queries";
import { Rating, State, type Grade } from "@/lib/fsrs/scheduler";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { getSmartDeckCandidateCardIds, readSmartDeckFilter, SMART_DECK_IDS, writeAllDecksFilter } from "@/lib/fsrs/smart-decks";
import { filterCoveringSpans, switchToPageReview, UNIT_SWITCH_SUSPENDED_AT } from "@/lib/hifz/unit-switch";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const TODAY = "2026-11-13";

describe("new page order (3.3)", () => {
  it("covers every page once in each order", () => {
    for (const plan of [
      { method: "standard" as const, direction: "juz_amma_first" as const },
      { method: "standard" as const, direction: "from_fatiha" as const },
      { method: "ottoman" as const, direction: "juz_amma_first" as const },
    ]) {
      const order = newPageOrder(plan);
      expect(order).toHaveLength(PAGE_COUNT);
      expect(new Set(order).size).toBe(PAGE_COUNT);
    }
  });

  it("starts Juz 'Amma from its last page, then juz 29, then al-Baqarah", () => {
    const order = newPageOrder({ method: "standard", direction: "juz_amma_first" });
    expect(order.slice(0, 2)).toEqual([604, 603]);
    expect(order[22]).toBe(582);
    expect(order[23]).toBe(581);
    expect(order[42]).toBe(562);
    expect(order[43]).toBe(1);
  });

  it("takes the r-th page from the end of every juz in round r for the Ottoman method", () => {
    const order = newPageOrder({ method: "ottoman", direction: "juz_amma_first" });
    expect(order.slice(0, 3)).toEqual([21, 41, 61]);
    expect(order[29]).toBe(604);
    expect(order[30]).toBe(20);
  });
});

describe("the ayah decks' scope for a page memorized in ayah review (UNIT-02)", () => {
  const span = (surah: number, first: number, last: number, count: number) => ({ surah, first, last, count });

  it("takes in a new surah whole or as the page's range, and grows a range to take the page", () => {
    const filter = { type: "surah" as const, surahs: [2], ranges: [{ surah: 2, ayahStart: 6, ayahEnd: 16 }] };
    expect(filterCoveringSpans(filter, [span(1, 1, 7, 7), span(78, 31, 40, 40)])).toEqual({
      type: "surah",
      surahs: [1, 2, 78],
      ranges: [
        { surah: 2, ayahStart: 6, ayahEnd: 16 },
        { surah: 78, ayahStart: 31, ayahEnd: 40 },
      ],
    });
    expect(filterCoveringSpans(filter, [span(2, 1, 5, 286)])).toEqual({
      type: "surah",
      surahs: [2],
      ranges: [{ surah: 2, ayahStart: 1, ayahEnd: 16 }],
    });
    expect(filterCoveringSpans({ type: "surah", surahs: [78], ranges: [{ surah: 78, ayahStart: 31, ayahEnd: 40 }] }, [span(78, 1, 30, 40)])).toEqual({
      type: "surah",
      surahs: [78],
    });
  });

  it("changes nothing that already covers the page", () => {
    expect(filterCoveringSpans({ type: "surah", surahs: [1] }, [span(1, 1, 7, 7)])).toBeNull();
    expect(filterCoveringSpans({ type: "surah", surahs: [2], ranges: [{ surah: 2, ayahStart: 1, ayahEnd: 16 }] }, [span(2, 6, 16, 286)])).toBeNull();
    expect(filterCoveringSpans({ type: "all" }, [span(1, 1, 7, 7)])).toBeNull();
    expect(filterCoveringSpans({ type: "juz", juzNumbers: [30] }, [span(1, 1, 7, 7)])).toBeNull();
  });
});

describe("sabaq chunks (SBQ-02)", () => {
  let store: OutboxDatabase;
  const plan = { ...DEFAULT_HIFZ_PLAN, method: "standard" as const, direction: "from_fatiha" as const };

  function seedPage() {
    store.sql.exec("INSERT INTO surahs (number, name_arabic, name_english, ayah_count, revelation_type) VALUES (1, 'الفاتحة', 'Al-Fatihah', 7, 'Meccan')");
    store.sql.exec("INSERT INTO page_lines (page_number, line_number, line_type, is_centered, first_word_id, last_word_id, surah_number) VALUES (1, 1, 'surah_name', 1, NULL, NULL, 1)");
    for (let ayah = 1; ayah <= 7; ayah += 1) {
      store.sql
        .prepare("INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (1, ?, ?, ?, ?, 1)")
        .run(ayah, `كلمة${ayah} أخرى`, `w${ayah}`, `a${ayah} b${ayah} m${ayah}`);
      const first = (ayah - 1) * 3 + 1;
      store.sql
        .prepare("INSERT INTO page_lines (page_number, line_number, line_type, is_centered, first_word_id, last_word_id, surah_number) VALUES (1, ?, 'ayah', 0, ?, ?, NULL)")
        .run(ayah + 1, first, first + 2);
    }
  }

  beforeEach(async () => {
    store = await openOutboxDatabase();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    seedPage();
  });
  afterEach(async () => {
    await store.db.getFirstAsync("SELECT 1");
    await store.close();
    jest.restoreAllMocks();
  });

  async function learn(target: SabaqTarget, rating: Grade, checkAt: Date, lessonPlan = plan) {
    const session = startReviewSession("sabaq", { now: new Date(checkAt.getTime() - 10 * 60_000) });
    const cleanRun = await saveSabaqCleanRun(store.db, {
      target,
      plan: lessonPlan,
      session,
      durationMs: 60_000,
      now: new Date(checkAt.getTime() - 5 * 60_000),
    });
    const check = await completeSabaqChunk(store.db, { target, plan: lessonPlan, rating, session, durationMs: 60_000, now: checkAt });
    return { cleanRun, check, session };
  }
  const lookPage = (cardId: string) => {
    const unit = parsePageUnit(cardId);
    if (unit?.kind !== "chunk") throw new Error(`Not a chunk: ${cardId}`);
    return loadRecitationPage(store.db, unit.page, null);
  };
  const count = (sql: string, ...params: string[]) => (store.sql.prepare(sql).get(...params) as { count: number }).count;

  it("chooses the next lines of the first unmemorized page, then adds the page at its last chunk's clean run", async () => {
    const pageWords = () => null;
    const first = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
    expect(first).toMatchObject({ page: 1, fromLine: 2, toLine: 5, completesPage: false });
    expect(first.ayahs.map((ayah) => ayah.ayah)).toEqual([1, 2, 3, 4]);

    const firstSave = await learn(first, Rating.Good, atLocalTime(TODAY, 9 * 60));
    expect(firstSave.cleanRun.pageAdded).toBe(false);
    expect(firstSave.check.pageAdded).toBe(false);
    await writeHifzPlan(store.db, { ...plan, newPerDay: 1, dailyBudgetMin: 240 });
    const wird = (await loadTodayWird(store.db, atLocalTime(TODAY, 9 * 60 + 30)))!;
    expect(wird.sabaqLinesToday).toBe(4);
    expect(wird.sabaqDoneToday).toBe(wird.newLines <= 4 && wird.newLines > 0);
    expect(firstSave.cleanRun.wird.kind).toBe("minimum_met");

    const second = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
    expect(second).toMatchObject({ page: 1, fromLine: 6, toLine: 8, completesPage: true });
    expect(second.linkAyahs.map((ayah) => ayah.ayah)).toEqual([3, 4]);
    const secondSave = await learn(second, Rating.Good, atLocalTime(TODAY, 600));
    expect(secondSave.cleanRun.pageAdded).toBe(true);
    expect(secondSave.check.pageAdded).toBe(false);
    expect(count("SELECT COUNT(*) AS count FROM study_log WHERE card_id = ?", chunkCardId(1, 6, 8))).toBe(2);
    expect(count("SELECT COUNT(*) AS count FROM sync_queue WHERE table_name = 'study_cards' AND operation = 'INSERT' AND row_id = ?", pageCardId(1))).toBe(1);

    const cards = await loadPageCards(store.db, { today: TODAY, plan });
    expect(cards.map((card) => [card.row.id, card.tier])).toEqual([[pageCardId(1), "sabqi"]]);
    const one = await loadPageCard(store.db, pageCardId(1), { today: TODAY, plan });
    expect(one).toMatchObject({ tier: "sabqi", history: { declared: false, firstFluentDate: TODAY } });
    expect(await nextSabaqTarget(store.db, { plan: { ...plan, direction: "from_fatiha" }, wantLines: 4, pageWords })).toBeNull();
    expect(await readHabitDayRow(store.db, TODAY)).toMatchObject({ status: "done" });
  });

  it("does not plan a page completed today for review before its first due date, tomorrow", async () => {
    await writeHifzPlan(store.db, plan);
    const whole = (await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords: () => null }))!;
    expect(whole.completesPage).toBe(true);
    const { cleanRun } = await learn(whole, Rating.Good, atLocalTime(TODAY, 600));
    expect(cleanRun.pageAdded).toBe(true);
    const today = (await loadTodayWird(store.db, atLocalTime(TODAY, 630)))!;
    expect(today.cards.map((card) => [card.row.id, card.tier])).toEqual([[pageCardId(1), "sabqi"]]);
    expect(today.memorizedPages).toBe(1);
    expect(today.daily.sabqi).toEqual([]);
    expect(today.todo).toEqual([]);
    const tomorrow = (await loadTodayWird(store.db, atLocalTime(addDays(TODAY, 1), 9 * 60)))!;
    expect(tomorrow.todo.map((page) => page.cardId)).toEqual([pageCardId(1)]);
  });

  it("in ayah review, sets a completed page aside and gives its ayat ayah cards within the ayah decks' scope (UNIT-02)", async () => {
    const ayahPlan = { ...plan, unit: "ayah" as const };
    await writeHifzPlan(store.db, ayahPlan);
    await writeAllDecksFilter(store.db, { type: "surah", surahs: [2] });
    store.sql
      .prepare(
        `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses,
           state, last_review, created_at, updated_at)
         VALUES ('1:7', ?, '2026-11-20T00:00:00.000Z', 30, 4, 0, 7, 0, 3, 0, 2, '2026-11-10T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      )
      .run(SMART_DECK_IDS.retention);
    const whole = (await nextSabaqTarget(store.db, { plan: ayahPlan, wantLines: 10, pageWords: () => null }))!;
    const now = atLocalTime(TODAY, 600);
    const saved = await saveSabaqCleanRun(store.db, { target: whole, plan: ayahPlan, session: null, durationMs: 600_000, now });
    expect(saved.pageAdded).toBe(true);

    expect(store.sql.prepare("SELECT tier, created_at, suspended_at FROM study_cards WHERE id = ?").get(pageCardId(1))).toEqual({
      tier: "sabqi",
      created_at: now.toISOString(),
      suspended_at: UNIT_SWITCH_SUSPENDED_AT,
    });
    const tomorrow = atLocalTime(addDays(TODAY, 1), 9 * 60);
    expect((await loadTodayWird(store.db, tomorrow))!).toMatchObject({ todo: [], total: 0 });
    expect(await nextSabaqTarget(store.db, { plan: ayahPlan, wantLines: 10, pageWords: () => null })).toBeNull();

    const chunk = store.sql.prepare("SELECT stability, difficulty FROM study_cards WHERE id LIKE 'chunk:%'").get() as { stability: number; difficulty: number };
    const due = atLocalTime(addDays(TODAY, 1), 0).toISOString();
    expect(store.sql.prepare("SELECT id, state, stability, difficulty, due, suspended_at FROM study_cards WHERE deck_id = ? ORDER BY id").all(SMART_DECK_IDS.retention)).toEqual([
      ...[1, 2, 3, 4, 5, 6].map((ayah) => ({ id: `1:${ayah}`, state: State.Review, ...chunk, due, suspended_at: null })),
      { id: "1:7", state: State.Review, stability: 30, difficulty: 4, due: "2026-11-20T00:00:00.000Z", suspended_at: null },
    ]);
    expect(await readSmartDeckFilter(store.db, SMART_DECK_IDS.retention)).toEqual({ type: "surah", surahs: [1, 2] });
    expect(await getSmartDeckCandidateCardIds(store.db, SMART_DECK_IDS.retention)).toEqual([1, 2, 3, 4, 5, 6, 7].map((ayah) => `1:${ayah}`));

    await writeHifzPlan(store.db, plan);
    await store.db.withTransactionAsync(async (tx) => {
      await switchToPageReview(tx, { previousUnit: "ayah", now: atLocalTime(addDays(TODAY, 1), 8 * 60) });
    });
    const pages = (await loadTodayWird(store.db, tomorrow))!;
    expect(pages.todo.map((page) => [page.cardId, page.tier])).toEqual([[pageCardId(1), "sabqi"]]);
  });

  it("keeps a lesson left after step 6: its chunk, the next lines and the day's credit", async () => {
    const pageWords = () => null;
    const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
    const saved = await saveSabaqCleanRun(store.db, { target, plan, session: null, durationMs: 60_000, now: atLocalTime(TODAY, 9 * 60) });
    const id = chunkCardId(1, 2, 5);
    expect(store.sql.prepare("SELECT rating, duration_ms, support_level FROM study_log WHERE card_id = ?").all(id)).toEqual([
      { rating: Rating.Good, duration_ms: 60_000, support_level: 4 },
    ]);
    expect(store.sql.prepare("SELECT deck_id, tier, deleted_at FROM study_cards WHERE id = ?").get(id)).toEqual({ deck_id: "hifz-sabaq", tier: "sabaq", deleted_at: null });
    expect(saved.wird.kind).toBe("minimum_met");
    expect(await readHabitDayRow(store.db, TODAY)).toMatchObject({ status: "done" });
    expect(await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords })).toMatchObject({ fromLine: 6, toLine: 8 });
    expect(await countSecondLooks(store.db, atLocalTime(TODAY, 9 * 60 + 5))).toMatchObject({ due: 0, nextAt: atLocalTime(TODAY, 10 * 60) });
  });

  it("adds the page at the clean run of its last chunk, with the chunk, in one transaction", async () => {
    const whole = (await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords: () => null }))!;
    expect(whole.completesPage).toBe(true);
    store.failQueueInsert(4);
    await expect(saveSabaqCleanRun(store.db, { target: whole, plan, session: null, durationMs: 60_000 })).rejects.toThrow("Synthetic sync_queue write failure");
    expect(count("SELECT COUNT(*) AS count FROM study_cards")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM study_log")).toBe(0);

    const now = atLocalTime(TODAY, 9 * 60);
    const saved = await saveSabaqCleanRun(store.db, { target: whole, plan, session: null, durationMs: 60_000, now });
    expect(saved.pageAdded).toBe(true);
    expect(store.sql.prepare("SELECT tier, created_at FROM study_cards WHERE id = ?").get(pageCardId(1))).toEqual({ tier: "sabqi", created_at: now.toISOString() });
    expect(store.sql.prepare("SELECT reviewed_at FROM study_log WHERE card_id = ?").get(chunkCardId(1, 2, 8))).toEqual({ reviewed_at: now.toISOString() });
  });

  it("keeps the page its last chunk's clean run added when the fluent check fails", async () => {
    const whole = (await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords: () => null }))!;
    const { cleanRun, check } = await learn(whole, Rating.Again, atLocalTime(TODAY, 9 * 60));
    expect(cleanRun.pageAdded).toBe(true);
    expect(check.pageAdded).toBe(false);
    expect(await loadPageCard(store.db, pageCardId(1), { today: TODAY, plan })).toMatchObject({ tier: "sabqi", history: { declared: false, firstFluentDate: TODAY } });
    expect(await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords: () => null })).toBeNull();
  });

  it("offers lines again on the same card after a failed fluent check, and goes on once they pass", async () => {
    const pageWords = () => null;
    const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
    await learn(target, Rating.Again, atLocalTime(TODAY, 9 * 60));
    const again = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
    expect(again).toMatchObject({ page: 1, fromLine: target.fromLine, toLine: target.toLine, completesPage: false });

    await learn(again, Rating.Good, atLocalTime(addDays(TODAY, 1), 9 * 60));
    expect(count("SELECT COUNT(*) AS count FROM study_cards WHERE id LIKE 'chunk:%'")).toBe(1);
    expect(count("SELECT COUNT(*) AS count FROM study_log WHERE card_id = ?", chunkCardId(1, 2, 5))).toBe(4);
    expect(await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords })).toMatchObject({ fromLine: 6, toLine: 8 });
  });

  it("offers a chunk again whose second look failed, though a later chunk on its page passed", async () => {
    const pageWords = () => null;
    const first = (await nextSabaqTarget(store.db, { plan, wantLines: 3, pageWords }))!;
    expect(first).toMatchObject({ fromLine: 2, toLine: 4 });
    const { check } = await learn(first, Rating.Good, atLocalTime(TODAY, 9 * 60));
    const second = (await nextSabaqTarget(store.db, { plan, wantLines: 3, pageWords }))!;
    expect(second).toMatchObject({ fromLine: 5, toLine: 7, completesPage: false });
    await learn(second, Rating.Good, atLocalTime(TODAY, 9 * 60 + 30));

    await saveSecondLook(store.db, { cardId: chunkCardId(1, 2, 4), pageData: await lookPage(chunkCardId(1, 2, 4)), plan, rating: Rating.Again, session: null, durationMs: 60_000, now: check.secondLookAt! });
    expect(await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords })).toMatchObject({ fromLine: 2, toLine: 4, completesPage: false });
    const relearn = new Date((store.sql.prepare("SELECT due FROM study_cards WHERE id = ?").get(chunkCardId(1, 2, 4)) as { due: string }).due);
    await saveSecondLook(store.db, { cardId: chunkCardId(1, 2, 4), pageData: await lookPage(chunkCardId(1, 2, 4)), plan, rating: Rating.Good, session: null, durationMs: 60_000, now: relearn });
    expect(await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords })).toMatchObject({ fromLine: 8, toLine: 8, completesPage: true });
  });

  it("adds no page at step 6 of lines chosen before an earlier chunk's look failed, then adds it when the look passes", async () => {
    const pageWords = () => null;
    const first = (await nextSabaqTarget(store.db, { plan, wantLines: 3, pageWords }))!;
    const { check } = await learn(first, Rating.Good, atLocalTime(TODAY, 9 * 60));
    const last = (await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords }))!;
    expect(last).toMatchObject({ fromLine: 5, toLine: 8, completesPage: true });
    const firstId = chunkCardId(1, first.fromLine, first.toLine);
    await saveSecondLook(store.db, { cardId: firstId, pageData: await lookPage(firstId), plan, rating: Rating.Again, session: null, durationMs: 60_000, now: check.secondLookAt! });

    const stale = await saveSabaqCleanRun(store.db, { target: last, plan, session: null, durationMs: 60_000, now: atLocalTime(TODAY, 10 * 60 + 5) });
    expect(stale.pageAdded).toBe(false);
    expect(count("SELECT COUNT(*) AS count FROM study_cards WHERE id = ?", pageCardId(1))).toBe(0);
    expect(await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords })).toMatchObject({ fromLine: 2, toLine: 4, completesPage: true });

    const relearn = new Date((store.sql.prepare("SELECT due FROM study_cards WHERE id = ?").get(firstId) as { due: string }).due);
    const passed = await saveSecondLook(store.db, { cardId: firstId, pageData: await lookPage(firstId), plan, rating: Rating.Good, session: null, durationMs: 60_000, now: relearn });
    expect(passed.pageAdded).toBe(true);
    expect(store.sql.prepare("SELECT tier FROM study_cards WHERE id = ?").get(pageCardId(1))).toEqual({ tier: "sabqi" });
  });

  it("adds a page that chunks merged from another device completed, dated to its last learning (SBQ-02)", async () => {
    const pageWords = () => null;
    const first = (await nextSabaqTarget(store.db, { plan, wantLines: 3, pageWords }))!;
    const { check } = await learn(first, Rating.Good, atLocalTime(TODAY, 9 * 60));
    const last = (await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords }))!;
    const firstId = chunkCardId(1, first.fromLine, first.toLine);
    await saveSecondLook(store.db, { cardId: firstId, pageData: await lookPage(firstId), plan, rating: Rating.Again, session: null, durationMs: 60_000, now: check.secondLookAt! });
    expect((await saveSabaqCleanRun(store.db, { target: last, plan, session: null, durationMs: 60_000, now: atLocalTime(TODAY, 10 * 60 + 5) })).pageAdded).toBe(false);
    const repass = atLocalTime(TODAY, 10 * 60 + 30).toISOString();
    store.sql
      .prepare(
        `INSERT INTO study_log (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at, local_date, grader, duration_ms)
         VALUES (?, 3, 1, ?, 1, 5, 0, 0, ?, ?, 'self', 60000)`,
      )
      .run(firstId, repass, repass, TODAY);
    expect(count("SELECT COUNT(*) AS count FROM study_cards WHERE id = ?", pageCardId(1))).toBe(0);
    expect(await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords })).toBeNull();

    expect(await addCoveredSabaqPages(store.db, { plan, pageWords })).toBe(1);
    expect(store.sql.prepare("SELECT tier, created_at FROM study_cards WHERE id = ?").get(pageCardId(1))).toEqual({ tier: "sabqi", created_at: repass });
    await writeHifzPlan(store.db, plan);
    expect((await loadTodayWird(store.db, atLocalTime(TODAY, 11 * 60)))!.memorizedPages).toBe(1);
    expect(await addCoveredSabaqPages(store.db, { plan, pageWords })).toBe(0);
  });

  it("dates a recovered page's first review from the completing pass's stored day, after a time-zone change", async () => {
    const pageWords = () => null;
    const first = (await nextSabaqTarget(store.db, { plan, wantLines: 3, pageWords }))!;
    const { check } = await learn(first, Rating.Good, atLocalTime(TODAY, 9 * 60));
    const last = (await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords }))!;
    const firstId = chunkCardId(1, first.fromLine, first.toLine);
    await saveSecondLook(store.db, { cardId: firstId, pageData: await lookPage(firstId), plan, rating: Rating.Again, session: null, durationMs: 60_000, now: check.secondLookAt! });
    expect((await saveSabaqCleanRun(store.db, { target: last, plan, session: null, durationMs: 60_000, now: atLocalTime(TODAY, 10 * 60 + 5) })).pageAdded).toBe(false);
    const repass = atLocalTime(TODAY, 10 * 60 + 30).toISOString();
    store.sql
      .prepare(
        `INSERT INTO study_log (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at, local_date, grader, duration_ms)
         VALUES (?, 3, 1, ?, 1, 5, 0, 0, ?, ?, 'self', 60000)`,
      )
      .run(firstId, repass, repass, addDays(TODAY, -1));
    expect(count("SELECT COUNT(*) AS count FROM study_cards WHERE id = ?", pageCardId(1))).toBe(0);
    expect(await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords })).toBeNull();

    expect(await addCoveredSabaqPages(store.db, { plan, pageWords })).toBe(1);
    expect(store.sql.prepare("SELECT tier, created_at FROM study_cards WHERE id = ?").get(pageCardId(1))).toEqual({ tier: "sabqi", created_at: repass });
    expect(store.sql.prepare("SELECT due FROM study_cards WHERE id = ?").get(pageCardId(1))).toEqual({ due: atLocalTime(TODAY, 0).toISOString() });
  });

  it("in ayah review, leaves the ayah decks' scope as it was when the grade that completes the page fails", async () => {
    const ayahPlan = { ...plan, unit: "ayah" as const };
    await writeHifzPlan(store.db, ayahPlan);
    await writeAllDecksFilter(store.db, { type: "surah", surahs: [2] });
    const whole = (await nextSabaqTarget(store.db, { plan: ayahPlan, wantLines: 10, pageWords: () => null }))!;
    jest.spyOn(unitSwitch, "addSabaqPageToAyahReview").mockRejectedValueOnce(new Error("Synthetic ayah card failure"));
    await expect(saveSabaqCleanRun(store.db, { target: whole, plan: ayahPlan, session: null, durationMs: 60_000 })).rejects.toThrow(
      "Synthetic ayah card failure",
    );
    expect(await readSmartDeckFilter(store.db, SMART_DECK_IDS.retention)).toEqual({ type: "surah", surahs: [2] });
    expect(count("SELECT COUNT(*) AS count FROM study_cards")).toBe(0);
  });

  it("counts a chunk once in its lesson's session, though step 6 and the check both grade it", async () => {
    const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords: () => null }))!;
    const { session } = await learn(target, Rating.Good, atLocalTime(TODAY, 9 * 60));
    expect(store.sql.prepare("SELECT cards_reviewed FROM review_sessions WHERE id = ?").get(session.id)).toEqual({ cards_reviewed: 1 });
  });

  it("creates the chunk and its page at the fluent check when step 6 left no card", async () => {
    const whole = (await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords: () => null }))!;
    const now = atLocalTime(TODAY, 9 * 60);
    const saved = await completeSabaqChunk(store.db, { target: whole, plan, rating: Rating.Good, session: null, durationMs: 60_000, now });
    expect(saved.pageAdded).toBe(true);
    expect(await loadPageCard(store.db, pageCardId(1), { today: TODAY, plan })).toMatchObject({ tier: "sabqi", history: { declared: false, firstFluentDate: TODAY } });
  });

  it("applies two saves of the same chunk queued at once, each from the card the other left", async () => {
    const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords: () => null }))!;
    const id = chunkCardId(target.page, target.fromLine, target.toLine);
    const save = (rating: Grade, minute: number) =>
      completeSabaqChunk(store.db, { target, plan, rating, session: null, durationMs: 60_000, now: atLocalTime(TODAY, 9 * 60 + minute) });
    const [first, second] = await Promise.all([save(Rating.Again, 0), save(Rating.Good, 1)]);
    expect(store.sql.prepare("SELECT COUNT(*) AS count FROM study_log WHERE card_id = ?").get(id)).toEqual({ count: 2 });
    expect(store.sql.prepare("SELECT reps, lapses FROM study_cards WHERE id = ?").get(id)).toEqual({ reps: 2, lapses: 0 });
    expect(second.transition.updatedCard.reps).toBe(first.transition.updatedCard.reps + 1);
  });

  it("counts overlapping chunks passed on two devices once per line", async () => {
    await writeHifzPlan(store.db, { ...plan, newPerDay: 1, dailyBudgetMin: 240 });
    const pass = store.sql.prepare(
      `INSERT INTO study_log (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at, local_date)
       VALUES (?, 3, 1, ?, 1, 5, 0, 0, ?, ?)`,
    );
    const at = atLocalTime(TODAY, 9 * 60).toISOString();
    pass.run(chunkCardId(5, 1, 4), at, at, TODAY);
    pass.run(chunkCardId(5, 1, 6), at, at, TODAY);
    const wird = (await loadTodayWird(store.db, atLocalTime(TODAY, 10 * 60)))!;
    expect(wird.sabaqLinesToday).toBe(6);
    expect(wird.newLines).toBeGreaterThan(6);
    expect(wird.sabaqDoneToday).toBe(false);
  });

  it("leaves no chunk behind when step 6's grade cannot be saved", async () => {
    const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords: () => null }))!;
    store.failQueueInsert(3);
    await expect(saveSabaqCleanRun(store.db, { target, plan, session: null, durationMs: 600_000 })).rejects.toThrow(
      "Synthetic sync_queue write failure",
    );
    expect(store.sql.prepare("SELECT COUNT(*) AS count FROM study_cards WHERE id LIKE 'chunk:%'").get()).toEqual({ count: 0 });
    expect(await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords: () => null })).toMatchObject({ fromLine: target.fromLine });
  });

  describe("page provenance (SBQ-02)", () => {
    const pageWords = () => null;
    const tierOf = async (today = TODAY) => {
      const [all, one, derived] = await Promise.all([
        loadPageCards(store.db, { today, plan }),
        loadPageCard(store.db, pageCardId(1), { today, plan }),
        derivePageTiers(store.db, [pageCardId(1)], { today, plan }),
      ]);
      expect(all.map((card) => card.tier)).toEqual([one?.tier]);
      expect(derived.get(pageCardId(1))).toBe(one?.tier);
      return one;
    };

    it("keeps a page declared after a failed partial chunk on it", async () => {
      const partial = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      expect(partial.completesPage).toBe(false);
      await learn(partial, Rating.Again, atLocalTime(TODAY, 9 * 60));
      await declareMemorizedPages(store.db, { pages: [1], cycleDays: 30, now: atLocalTime(TODAY, 10 * 60) });

      expect(await tierOf()).toMatchObject({ tier: "manzil.unverified", history: { declared: true, firstFluentDate: null } });
    });

    it("keeps a page declared after a passing chunk that did not complete it", async () => {
      const partial = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      await learn(partial, Rating.Good, atLocalTime(TODAY, 9 * 60));
      await declareMemorizedPages(store.db, { pages: [1], cycleDays: 30, now: atLocalTime(addDays(TODAY, 1), 8 * 60) });

      expect(await tierOf(addDays(TODAY, 1))).toMatchObject({ tier: "manzil.unverified", history: { declared: true, firstFluentDate: null } });
    });

    it("derives sabqi from the chunk that completed the page, dated by that chunk's clean run", async () => {
      const day2 = addDays(TODAY, 1);
      const first = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      await learn(first, Rating.Again, atLocalTime(TODAY, 9 * 60));
      await learn(first, Rating.Good, atLocalTime(TODAY, 9 * 60 + 30));
      const last = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      expect(last.completesPage).toBe(true);
      const { cleanRun, check } = await learn(last, Rating.Good, atLocalTime(day2, 2));
      expect(cleanRun.pageAdded).toBe(true);
      expect(check.pageAdded).toBe(false);

      expect(await tierOf(day2)).toMatchObject({ tier: "sabqi", history: { declared: false, firstFluentDate: TODAY } });
      store.sql.prepare("UPDATE study_cards SET deleted_at = ? WHERE id LIKE 'chunk:%'").run(atLocalTime(day2, 10 * 60).toISOString());
      expect(await tierOf(day2)).toMatchObject({ tier: "sabqi", history: { declared: false, firstFluentDate: TODAY } });
    });

    it("starts a page memorized through sabaq from its chunks' ratings, as a review card", async () => {
      const first = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      await learn(first, Rating.Easy, atLocalTime(TODAY, 9 * 60));
      const last = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      const finishedAt = atLocalTime(TODAY, 9 * 60 + 30);
      const session = startReviewSession("sabaq", { now: atLocalTime(TODAY, 9 * 60 + 20) });
      const saved = await saveSabaqCleanRun(store.db, { target: last, plan, session, durationMs: 60_000, now: finishedAt });
      expect(saved.pageAdded).toBe(true);

      const chunks = store.sql
        .prepare("SELECT stability, difficulty FROM study_cards WHERE id LIKE 'chunk:%' AND deleted_at IS NULL")
        .all() as { stability: number; difficulty: number }[];
      expect(chunks).toHaveLength(2);
      const page = store.sql.prepare("SELECT * FROM study_cards WHERE id = ?").get(pageCardId(1)) as unknown as StudyCardRow;
      expect(page).toMatchObject({
        state: State.Review,
        stability: Math.min(...chunks.map((chunk) => chunk.stability)),
        last_review: finishedAt.toISOString(),
        scheduled_days: 1,
        due: atLocalTime(addDays(TODAY, 1), 0).toISOString(),
        tier: "sabqi",
      });
      expect(page.stability).toBeGreaterThan(0);
      expect(page.difficulty).toBeCloseTo((chunks[0].difficulty + chunks[1].difficulty) / 2, 6);
      const upload = store.sql
        .prepare("SELECT data FROM sync_queue WHERE table_name = 'study_cards' AND row_id = ? ORDER BY id DESC LIMIT 1")
        .get(pageCardId(1)) as { data: string };
      expect(JSON.parse(upload.data)).toMatchObject({ state: State.Review, stability: page.stability, last_review: page.last_review });
      expect(await tierOf()).toMatchObject({ tier: "sabqi", history: { declared: false, firstFluentDate: TODAY } });
      await completeSabaqChunk(store.db, { target: last, plan, rating: Rating.Easy, session, durationMs: 60_000, now: atLocalTime(TODAY, 9 * 60 + 35) });
      expect(store.sql.prepare("SELECT * FROM study_cards WHERE id = ?").get(pageCardId(1))).toEqual(page);
    });

    it("treats a sabaq page removed and declared again as declared", async () => {
      const whole = (await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords }))!;
      await learn(whole, Rating.Good, atLocalTime(TODAY, 9 * 60));
      store.sql.prepare("UPDATE study_cards SET deleted_at = ? WHERE id = ?").run(atLocalTime(TODAY, 10 * 60).toISOString(), pageCardId(1));
      await declareMemorizedPages(store.db, { pages: [1], cycleDays: 30, now: atLocalTime(TODAY, 11 * 60) });

      expect(await tierOf()).toMatchObject({ tier: "manzil.unverified", history: { declared: true } });
    });
  });

  describe("second look (SBQ-03)", () => {
    const pageWords = () => null;
    const at = (minutes: number, date = TODAY) => atLocalTime(date, minutes);

    async function passPartialChunk(rating: Grade = Rating.Good) {
      const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      const { check } = await learn(target, rating, at(9 * 60));
      return { id: chunkCardId(1, target.fromLine, target.toLine), lookAt: check.secondLookAt!, saved: check };
    }
    const logCount = (id: string) => count("SELECT COUNT(*) AS count FROM study_log WHERE card_id = ?", id);
    const cardDue = (id: string) => new Date((store.sql.prepare("SELECT due FROM study_cards WHERE id = ?").get(id) as { due: string }).due);

    it("offers a look an hour after a later lesson that learned the chunk again after a failed check", async () => {
      const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      const id = chunkCardId(1, target.fromLine, target.toLine);
      await learn(target, Rating.Again, at(9 * 60));
      const { check } = await learn(target, Rating.Good, at(10 * 60 + 15));
      expect(check.secondLookAt).toEqual(at(11 * 60 + 15));
      expect(await countSecondLooks(store.db, at(10 * 60 + 20))).toMatchObject({ due: 0, nextAt: at(11 * 60 + 15) });
      expect((await loadSecondLooks(store.db, { now: at(11 * 60 + 15), pageWords })).due.map((look) => look.cardId)).toEqual([id]);
    });

    it("resolves a committed check whose look cannot be read afterwards, so the grade is not offered again", async () => {
      const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      const id = chunkCardId(1, target.fromLine, target.toLine);
      const session = startReviewSession("sabaq", { now: at(8 * 60 + 50) });
      await saveSabaqCleanRun(store.db, { target, plan, session, durationMs: 60_000, now: at(8 * 60 + 55) });
      const read = store.db.getAllAsync.bind(store.db);
      jest.spyOn(store.db, "getAllAsync").mockImplementation(((sql: string, params?: unknown) => {
        if (sql.includes("c.buried_until <= ?")) return Promise.reject(new Error("Synthetic read failure"));
        return read(sql, params as never);
      }) as typeof store.db.getAllAsync);
      jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const check = await completeSabaqChunk(store.db, { target, plan, rating: Rating.Good, session, durationMs: 60_000, now: at(9 * 60) });
      expect(check).toMatchObject({ secondLookAt: null, secondLookNow: false });
      expect(logCount(id)).toBe(2);
    });

    it("offers a chunk an hour after its lesson, though the passed check graduated it, and says when before that", async () => {
      const { id, lookAt, saved } = await passPartialChunk();
      expect(localDateOf(new Date(saved.transition.updatedCard.due)) > TODAY).toBe(true);
      expect(lookAt).toEqual(at(10 * 60));

      expect(await loadSecondLooks(store.db, { now: at(9 * 60 + 5), pageWords })).toEqual({ due: [], nextAt: lookAt });
      const looks = await loadSecondLooks(store.db, { now: lookAt, pageWords });
      expect(looks.nextAt).toBeNull();
      expect(looks.due).toHaveLength(1);
      expect(looks.due[0]).toMatchObject({ cardId: id, page: 1, fromLine: 2, toLine: 5 });
      expect([...looks.due[0].lineNumbers]).toEqual([2, 3, 4, 5]);
    });

    it("counts due looks for Home's cue and says when the next is offered", async () => {
      const { lookAt } = await passPartialChunk();
      const offeredAt = new Date(lookAt.getTime() - REVIEW_LEARN_AHEAD_MS);
      expect(await countSecondLooks(store.db, at(9 * 60 + 5))).toEqual({ due: 0, nextAt: lookAt, offeredAt });
      expect(await countSecondLooks(store.db, offeredAt)).toEqual({ due: 1, nextAt: null, offeredAt: null });
      expect((await loadSecondLooks(store.db, { now: offeredAt, pageWords })).due).toHaveLength(1);
    });

    it("saves a graded look as a logged review of the chunk card that counts for the day", async () => {
      const { id, lookAt } = await passPartialChunk();
      const before = store.sql.prepare("SELECT reps, state, due FROM study_cards WHERE id = ?").get(id) as { reps: number; state: number; due: string };
      const result = await saveSecondLook(store.db, { cardId: id, pageData: await lookPage(id), plan, rating: Rating.Good, session: null, durationMs: 90_000, now: lookAt });

      expect(logCount(id)).toBe(3);
      expect(store.sql.prepare("SELECT rating, local_date, duration_ms, support_level FROM study_log WHERE card_id = ? ORDER BY reviewed_at DESC LIMIT 1").get(id)).toEqual({
        rating: Rating.Good,
        local_date: TODAY,
        duration_ms: 90_000,
        support_level: 4,
      });
      const after = store.sql.prepare("SELECT reps, state, due, last_review FROM study_cards WHERE id = ?").get(id) as { reps: number; state: number; due: string; last_review: string };
      expect(after.reps).toBe(before.reps + 1);
      expect(after.last_review).toBe(lookAt.toISOString());
      expect(result.transition.updatedCard.due).toBe(after.due);
      expect(await readHabitDayRow(store.db, TODAY)).toMatchObject({ status: "done" });
      expect(localDateOf(new Date(after.due)) > TODAY).toBe(true);
      expect(await loadSecondLooks(store.db, { now: at(23 * 60), pageWords })).toEqual({ due: [], nextAt: null });
    });

    it("keeps a skipped look for the rest of the day", async () => {
      const { id, lookAt } = await passPartialChunk();
      expect((await loadSecondLooks(store.db, { now: lookAt, pageWords })).due.map((look) => look.cardId)).toEqual([id]);
      expect(logCount(id)).toBe(2);
      expect((await loadSecondLooks(store.db, { now: at(21 * 60), pageWords })).due.map((look) => look.cardId)).toEqual([id]);
    });

    it("does not offer a chunk on a later day, though FSRS has it due then", async () => {
      const { id } = await passPartialChunk();
      const due = cardDue(id);
      expect(localDateOf(due) > TODAY).toBe(true);
      expect(await loadSecondLooks(store.db, { now: due, pageWords })).toEqual({ due: [], nextAt: null });
    });

    it("offers the look an hour after an Easy check too, and only once", async () => {
      const { id, lookAt } = await passPartialChunk(Rating.Easy);
      expect(lookAt).toEqual(at(10 * 60));
      expect(await countSecondLooks(store.db, at(9 * 60 + 5))).toEqual({ due: 0, nextAt: lookAt, offeredAt: new Date(lookAt.getTime() - REVIEW_LEARN_AHEAD_MS) });
      expect((await loadSecondLooks(store.db, { now: lookAt, pageWords })).due.map((look) => look.cardId)).toEqual([id]);

      await saveSecondLook(store.db, { cardId: id, pageData: await lookPage(id), plan, rating: Rating.Good, session: null, durationMs: 90_000, now: lookAt });
      expect(await loadSecondLooks(store.db, { now: at(21 * 60), pageWords })).toEqual({ due: [], nextAt: null });
    });

    it("offers a look an hour after a lesson left at step 6", async () => {
      const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      await saveSabaqCleanRun(store.db, { target, plan, session: startReviewSession("sabaq"), durationMs: 60_000, now: at(9 * 60) });
      expect(await countSecondLooks(store.db, at(9 * 60 + 5))).toMatchObject({ due: 0, nextAt: at(10 * 60) });
      expect((await loadSecondLooks(store.db, { now: at(10 * 60), pageWords })).due.map((look) => look.cardId)).toEqual([chunkCardId(1, 2, 5)]);
    });

    it("brings a look graded Again back with its relearning step the same day", async () => {
      const { id, lookAt } = await passPartialChunk();
      await saveSecondLook(store.db, { cardId: id, pageData: await lookPage(id), plan, rating: Rating.Again, session: null, durationMs: 60_000, now: lookAt });
      const relearn = cardDue(id);
      expect(localDateOf(relearn)).toBe(TODAY);
      expect((await loadSecondLooks(store.db, { now: relearn, pageWords })).due.map((look) => look.cardId)).toEqual([id]);
    });

    it("brings a failed check back with its relearning step the same day, and offers its lines again", async () => {
      const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      const id = chunkCardId(1, target.fromLine, target.toLine);
      const { check } = await learn(target, Rating.Again, at(9 * 60));
      const relearn = cardDue(id);
      expect(relearn.getTime() - at(9 * 60).getTime()).toBeLessThan(REVIEW_LEARN_AHEAD_MS);
      expect(check.secondLookAt).toBeNull();
      expect(check.secondLookNow).toBe(true);
      expect((await loadSecondLooks(store.db, { now: at(9 * 60 + 1), pageWords })).due.map((look) => look.cardId)).toEqual([id]);
      expect(await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords })).toMatchObject({ fromLine: target.fromLine, toLine: target.toLine });

      await saveSecondLook(store.db, { cardId: id, pageData: await lookPage(id), plan, rating: Rating.Good, session: null, durationMs: 60_000, now: relearn });
      const next = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      expect(next).toMatchObject({ fromLine: 6, toLine: 8 });
      const hard = await learn(next, Rating.Hard, at(11 * 60));
      expect(hard.check.secondLookAt).not.toBeNull();
      expect(hard.check.secondLookNow).toBe(false);
      expect((await countSecondLooks(store.db, at(11 * 60 + 1))).nextAt).toEqual(hard.check.secondLookAt);
    });

    it("offers a look on the day a chunk is learned again after a failed check", async () => {
      const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      const id = chunkCardId(1, target.fromLine, target.toLine);
      await learn(target, Rating.Again, at(9 * 60));
      const day2 = addDays(TODAY, 1);
      const { check } = await learn(target, Rating.Good, at(9 * 60, day2));
      expect(check.secondLookAt).toEqual(at(10 * 60, day2));
      expect((await loadSecondLooks(store.db, { now: at(10 * 60, day2), pageWords })).due.map((look) => look.cardId)).toEqual([id]);
    });

    it("promises no second look past today", async () => {
      const late = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      const { check } = await learn(late, Rating.Good, at(23 * 60 + 30));
      expect(check.secondLookAt).toBeNull();
      expect(check.secondLookNow).toBe(false);
    });

    it("does not grade a chunk deleted since the screen loaded", async () => {
      const { id, lookAt } = await passPartialChunk();
      store.sql.prepare("UPDATE study_cards SET deleted_at = ? WHERE id = ?").run(lookAt.toISOString(), id);
      await expect(saveSecondLook(store.db, { cardId: id, pageData: await lookPage(id), plan, rating: Rating.Good, session: null, durationMs: 60_000, now: lookAt })).rejects.toBeInstanceOf(
        StudyCardDeletedError,
      );
      expect(logCount(id)).toBe(2);
      expect(store.sql.prepare("SELECT deleted_at IS NOT NULL AS deleted FROM study_cards WHERE id = ?").get(id)).toEqual({ deleted: 1 });
    });

    it("leaves chunk cards out of every due count and queue once their day is over", async () => {
      await writeHifzPlan(store.db, plan);
      const { id } = await passPartialChunk();
      const tomorrow = at(8 * 60, addDays(TODAY, 1));
      jest.useFakeTimers({ now: tomorrow, doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
      try {
        const counts = async () => {
          const deckStats = [];
          for (const deckId of REVIEW_DECK_IDS) {
            deckStats.push(await getDeckTodayStats(store.db, deckId, await readDeckReviewSettings(store.db, deckId)));
          }
          const wird = (await loadTodayWird(store.db, tomorrow))!;
          return {
            reviewAll: (await loadReviewQueue(store.db)).map((item) => item.card.id).sort(),
            deckStats,
            remediation: await countDueRemediation(store.db, tomorrow),
            wird: [...wird.todo.map((page) => page.cardId), ...wird.done.map((page) => page.cardId), ...wird.cards.map((card) => card.row.id)],
          };
        };
        expect(REVIEW_DECK_IDS).not.toContain("hifz-sabaq");
        const withChunk = await counts();
        expect(withChunk.reviewAll).not.toContain(id);
        expect(withChunk.wird).not.toContain(id);
        expect(withChunk.remediation).toBe(0);
        store.sql.prepare("UPDATE study_cards SET deleted_at = ? WHERE id = ?").run(tomorrow.toISOString(), id);
        expect(await counts()).toEqual(withChunk);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
