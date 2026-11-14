import { addDays, atLocalTime } from "@/lib/habit/dates";
import { readHabitDayRow } from "@/lib/habit/queries";
import { declareMemorizedPages, derivePageTiers, loadPageCard, loadPageCards, loadTodayWird } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN, writeHifzPlan } from "@/lib/hifz/plan";
import { countDueRemediation } from "@/lib/hifz/remediation";
import { completeSabaqChunk, countSecondLooks, loadSecondLooks, newPageOrder, nextSabaqTarget, saveSecondLook } from "@/lib/hifz/sabaq";
import { REVIEW_LEARN_AHEAD_MS } from "@/lib/fsrs/review-transition";
import { chunkCardId, PAGE_COUNT, pageCardId } from "@/lib/hifz/units";
import { StudyCardDeletedError } from "@/lib/fsrs/card-errors";
import { getDeckTodayStats, loadReviewQueue, readDeckReviewSettings, REVIEW_DECK_IDS } from "@/lib/fsrs/queries";
import { Rating, type Grade } from "@/lib/fsrs/scheduler";
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
    // Juz 30 has 23 pages and juz 29 has 20.
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

describe("sabaq chunks (SBQ-02)", () => {
  let store: OutboxDatabase;
  const plan = { ...DEFAULT_HIFZ_PLAN, method: "standard" as const, direction: "from_fatiha" as const };

  /** Page 1 with 7 ayat over lines 2 to 8, line 1 the surah name; each line ends its ayah. */
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

  it("chooses the next lines of the first unmemorized page, then adds the page once its last chunk passes", async () => {
    const pageWords = () => null;
    const first = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
    expect(first).toMatchObject({ page: 1, fromLine: 2, toLine: 5, completesPage: false });
    expect(first.ayahs.map((ayah) => ayah.ayah)).toEqual([1, 2, 3, 4]);

    const now = atLocalTime(TODAY, 9 * 60);
    const firstSave = await completeSabaqChunk(store.db, { target: first, plan, rating: Rating.Good, session: null, durationMs: 600_000, now });
    expect(firstSave).toMatchObject({ pageAdded: false });
    // One chunk covers 4 lines, so a larger daily allocation is not done yet.
    await writeHifzPlan(store.db, { ...plan, newPerDay: 1, dailyBudgetMin: 240 });
    const wird = (await loadTodayWird(store.db, atLocalTime(TODAY, 9 * 60 + 30)))!;
    expect(wird.sabaqLinesToday).toBe(4);
    expect(wird.sabaqDoneToday).toBe(wird.newLines <= 4 && wird.newLines > 0);
    expect(firstSave.wird.kind).toBe("minimum_met");

    const second = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
    expect(second).toMatchObject({ page: 1, fromLine: 6, toLine: 8, completesPage: true });
    expect(second.linkAyahs.map((ayah) => ayah.ayah)).toEqual([3, 4]);
    const secondSave = await completeSabaqChunk(store.db, { target: second, plan, rating: Rating.Good, session: null, durationMs: 600_000, now: atLocalTime(TODAY, 600) });
    expect(secondSave.pageAdded).toBe(true);

    const cards = await loadPageCards(store.db, { today: TODAY, plan });
    expect(cards.map((card) => [card.row.id, card.tier])).toEqual([[pageCardId(1), "sabqi"]]);
    // A grade's own read of the page, limited to its chunks, sees the same sabaq history.
    const one = await loadPageCard(store.db, pageCardId(1), { today: TODAY, plan });
    expect(one).toMatchObject({ tier: "sabqi", history: { declared: false, firstFluentDate: TODAY } });
    expect(await nextSabaqTarget(store.db, { plan: { ...plan, direction: "from_fatiha" }, wantLines: 4, pageWords })).toBeNull();
    expect(await readHabitDayRow(store.db, TODAY)).toMatchObject({ status: "done" });
  });

  it("does not add the page when the fluent check of its last chunk fails", async () => {
    const target = (await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords: () => null }))!;
    expect(target.completesPage).toBe(true);
    const result = await completeSabaqChunk(store.db, { target, plan, rating: Rating.Again, session: null, durationMs: 60_000 });
    expect(result.pageAdded).toBe(false);

    // The failed check is offered again on the same chunk card, and passing it adds the page.
    const again = (await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords: () => null }))!;
    expect(again).toMatchObject({ page: 1, fromLine: target.fromLine, toLine: target.toLine, completesPage: true });
    const passed = await completeSabaqChunk(store.db, {
      target: again,
      plan,
      rating: Rating.Good,
      session: null,
      durationMs: 60_000,
      now: new Date(Date.now() + 60_000),
    });
    expect(passed.pageAdded).toBe(true);
    expect(store.sql.prepare("SELECT COUNT(*) AS count FROM study_cards WHERE id LIKE 'chunk:%'").get()).toEqual({ count: 1 });
    expect(await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords: () => null })).toBeNull();
  });

  it("applies two saves of the same chunk queued at once, each from the card the other left", async () => {
    const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords: () => null }))!;
    const id = chunkCardId(target.page, target.fromLine, target.toLine);
    const save = (rating: Grade, minute: number) =>
      completeSabaqChunk(store.db, { target, plan, rating, session: null, durationMs: 60_000, now: atLocalTime(TODAY, 9 * 60 + minute) });
    // Both read the chunk before either transaction runs; neither may calculate from that read.
    const [first, second] = await Promise.all([save(Rating.Again, 0), save(Rating.Good, 1)]);
    expect(store.sql.prepare("SELECT COUNT(*) AS count FROM study_log WHERE card_id = ?").get(id)).toEqual({ count: 2 });
    expect(store.sql.prepare("SELECT reps, lapses FROM study_cards WHERE id = ?").get(id)).toEqual({ reps: 2, lapses: 0 });
    expect(second.transition.updatedCard.reps).toBe(first.transition.updatedCard.reps + 1);
  });

  it("counts overlapping chunks passed on two devices once per line", async () => {
    await writeHifzPlan(store.db, { ...plan, newPerDay: 1, dailyBudgetMin: 240 });
    // Lines 1-4 on one device and 1-6 on another cover 6 lines of page 5, not 10.
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

  it("leaves no chunk behind when the grade cannot be saved", async () => {
    const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords: () => null }))!;
    // Queue order inside the grade: the new chunk card, its update, the review log, then the wird day.
    store.failQueueInsert(3);
    await expect(
      completeSabaqChunk(store.db, { target, plan, rating: Rating.Good, session: null, durationMs: 600_000 }),
    ).rejects.toThrow("Synthetic sync_queue write failure");
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
      await completeSabaqChunk(store.db, { target: partial, plan, rating: Rating.Again, session: null, durationMs: 60_000, now: atLocalTime(TODAY, 9 * 60) });
      await declareMemorizedPages(store.db, { pages: [1], cycleDays: 30, now: atLocalTime(TODAY, 10 * 60) });

      expect(await tierOf()).toMatchObject({ tier: "manzil.unverified", history: { declared: true, firstFluentDate: null } });
    });

    it("keeps a page declared after a passing chunk that did not complete it", async () => {
      const partial = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      await completeSabaqChunk(store.db, { target: partial, plan, rating: Rating.Good, session: null, durationMs: 60_000, now: atLocalTime(TODAY, 9 * 60) });
      await declareMemorizedPages(store.db, { pages: [1], cycleDays: 30, now: atLocalTime(addDays(TODAY, 1), 8 * 60) });

      expect(await tierOf(addDays(TODAY, 1))).toMatchObject({ tier: "manzil.unverified", history: { declared: true, firstFluentDate: null } });
    });

    it("derives sabqi from the chunk that completed the page, dated by that chunk's pass", async () => {
      const day2 = addDays(TODAY, 1);
      const first = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      await completeSabaqChunk(store.db, { target: first, plan, rating: Rating.Again, session: null, durationMs: 60_000, now: atLocalTime(TODAY, 9 * 60) });
      await completeSabaqChunk(store.db, { target: first, plan, rating: Rating.Good, session: null, durationMs: 60_000, now: atLocalTime(TODAY, 9 * 60 + 15) });
      const last = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      expect(last.completesPage).toBe(true);
      const saved = await completeSabaqChunk(store.db, { target: last, plan, rating: Rating.Good, session: null, durationMs: 60_000, now: atLocalTime(day2, 9 * 60) });
      expect(saved.pageAdded).toBe(true);

      expect(await tierOf(day2)).toMatchObject({ tier: "sabqi", history: { declared: false, firstFluentDate: day2 } });
      // The review history decides, so the page stays sabqi when its chunk cards are gone.
      store.sql.prepare("UPDATE study_cards SET deleted_at = ? WHERE id LIKE 'chunk:%'").run(atLocalTime(day2, 10 * 60).toISOString());
      expect(await tierOf(day2)).toMatchObject({ tier: "sabqi", history: { declared: false, firstFluentDate: day2 } });
    });

    it("treats a sabaq page removed and declared again as declared", async () => {
      const whole = (await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords }))!;
      await completeSabaqChunk(store.db, { target: whole, plan, rating: Rating.Good, session: null, durationMs: 60_000, now: atLocalTime(TODAY, 9 * 60) });
      store.sql.prepare("UPDATE study_cards SET deleted_at = ? WHERE id = ?").run(atLocalTime(TODAY, 10 * 60).toISOString(), pageCardId(1));
      await declareMemorizedPages(store.db, { pages: [1], cycleDays: 30, now: atLocalTime(TODAY, 11 * 60) });

      expect(await tierOf()).toMatchObject({ tier: "manzil.unverified", history: { declared: true } });
    });
  });

  describe("second look (SBQ-03)", () => {
    const pageWords = () => null;
    const at = (minutes: number, date = TODAY) => atLocalTime(date, minutes);

    /** Pass the first 4 lines of page 1 at 9:00 today and return the chunk's id and its next due. */
    async function passPartialChunk(rating: Grade = Rating.Good) {
      const target = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      const saved = await completeSabaqChunk(store.db, { target, plan, rating, session: null, durationMs: 600_000, now: at(9 * 60) });
      return { id: chunkCardId(1, target.fromLine, target.toLine), due: new Date(saved.transition.updatedCard.due), saved };
    }
    const logCount = (id: string) => (store.sql.prepare("SELECT COUNT(*) AS count FROM study_log WHERE card_id = ?").get(id) as { count: number }).count;

    it("offers a chunk that passed today once it is due, and says when before that", async () => {
      const { id, due, saved } = await passPartialChunk();
      // Good on a new chunk takes the sabaq policy's second learning step, later today.
      expect(due.getTime()).toBeGreaterThan(at(9 * 60 + 30).getTime());
      expect(saved.secondLookAt).toEqual(due);

      expect(await loadSecondLooks(store.db, { now: at(9 * 60 + 5), pageWords })).toEqual({ due: [], nextAt: due });
      const looks = await loadSecondLooks(store.db, { now: due, pageWords });
      expect(looks.nextAt).toBeNull();
      expect(looks.due).toHaveLength(1);
      expect(looks.due[0]).toMatchObject({ cardId: id, page: 1, fromLine: 2, toLine: 5 });
      expect([...looks.due[0].lineNumbers]).toEqual([2, 3, 4, 5]);
    });

    it("counts due looks for Home's cue and says when the next is offered", async () => {
      const { due } = await passPartialChunk();
      const offeredAt = new Date(due.getTime() - REVIEW_LEARN_AHEAD_MS);
      expect(await countSecondLooks(store.db, at(9 * 60 + 5))).toEqual({ due: 0, offeredAt });
      // The moment it is offered, sabaq shows it and Home counts it.
      expect(await countSecondLooks(store.db, offeredAt)).toEqual({ due: 1, offeredAt: null });
      expect((await loadSecondLooks(store.db, { now: offeredAt, pageWords })).due).toHaveLength(1);
    });

    it("saves a graded look as a logged review of the chunk card that counts for the day", async () => {
      const { id, due } = await passPartialChunk();
      const before = store.sql.prepare("SELECT reps, state, due FROM study_cards WHERE id = ?").get(id) as { reps: number; state: number; due: string };
      const result = await saveSecondLook(store.db, { cardId: id, plan, rating: Rating.Good, session: null, durationMs: 90_000, now: due });

      expect(logCount(id)).toBe(2);
      expect(store.sql.prepare("SELECT rating, local_date, duration_ms, support_level FROM study_log WHERE card_id = ? ORDER BY reviewed_at DESC LIMIT 1").get(id)).toEqual({
        rating: Rating.Good,
        local_date: TODAY,
        duration_ms: 90_000,
        support_level: 4,
      });
      const after = store.sql.prepare("SELECT reps, state, due, last_review FROM study_cards WHERE id = ?").get(id) as { reps: number; state: number; due: string; last_review: string };
      expect(after.reps).toBe(before.reps + 1);
      expect(after.last_review).toBe(due.toISOString());
      expect(result.transition.updatedCard.due).toBe(after.due);
      expect(Date.parse(after.due)).toBeGreaterThan(Date.parse(before.due));
      expect(await readHabitDayRow(store.db, TODAY)).toMatchObject({ status: "done" });
      // Graduated past today, the chunk has no further look.
      expect(await loadSecondLooks(store.db, { now: at(23 * 60), pageWords })).toEqual({ due: [], nextAt: null });
    });

    it("keeps a skipped look for the rest of the day", async () => {
      const { id, due } = await passPartialChunk();
      expect((await loadSecondLooks(store.db, { now: due, pageWords })).due.map((look) => look.cardId)).toEqual([id]);
      // Skipping writes nothing; the look is still offered in the evening.
      expect(logCount(id)).toBe(1);
      expect((await loadSecondLooks(store.db, { now: at(21 * 60), pageWords })).due.map((look) => look.cardId)).toEqual([id]);
    });

    it("does not offer a chunk on a later day, though FSRS still has it due", async () => {
      const { id } = await passPartialChunk();
      const tomorrow = at(8 * 60, addDays(TODAY, 1));
      expect(Date.parse((store.sql.prepare("SELECT due FROM study_cards WHERE id = ?").get(id) as { due: string }).due)).toBeLessThan(tomorrow.getTime());
      expect(await loadSecondLooks(store.db, { now: tomorrow, pageWords })).toEqual({ due: [], nextAt: null });
    });

    it("offers no look for a failed check, and promises none past today", async () => {
      const failed = await passPartialChunk(Rating.Again);
      expect(failed.saved.secondLookAt).toBeNull();
      expect(await loadSecondLooks(store.db, { now: at(10 * 60), pageWords })).toEqual({ due: [], nextAt: null });

      // Passed late in the evening, the next step falls after midnight, so no second look is promised.
      const late = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
      const lateSave = await completeSabaqChunk(store.db, { target: late, plan, rating: Rating.Good, session: null, durationMs: 60_000, now: at(23 * 60 + 30) });
      expect(lateSave.secondLookAt).toBeNull();
    });

    it("does not grade a chunk deleted since the screen loaded", async () => {
      const { id, due } = await passPartialChunk();
      store.sql.prepare("UPDATE study_cards SET deleted_at = ? WHERE id = ?").run(due.toISOString(), id);
      await expect(saveSecondLook(store.db, { cardId: id, plan, rating: Rating.Good, session: null, durationMs: 60_000, now: due })).rejects.toBeInstanceOf(
        StudyCardDeletedError,
      );
      expect(logCount(id)).toBe(1);
      expect(store.sql.prepare("SELECT deleted_at IS NOT NULL AS deleted FROM study_cards WHERE id = ?").get(id)).toEqual({ deleted: 1 });
    });

    it("leaves chunk cards out of every due count and queue once their day is over", async () => {
      await writeHifzPlan(store.db, plan);
      const { id } = await passPartialChunk();
      const tomorrow = at(8 * 60, addDays(TODAY, 1));
      jest.useFakeTimers({ now: tomorrow, doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
      try {
        /** Every count and queue a flow shows: Review all, Home's deck rows, remediation and the wird. */
        const counts = async () => {
          const deckStats = [];
          for (const deckId of REVIEW_DECK_IDS) {
            deckStats.push(await getDeckTodayStats(store.db, deckId, await readDeckReviewSettings(store.db, deckId)));
          }
          const wird = (await loadTodayWird(store.db, tomorrow))!;
          return {
            // New cards come shuffled, so the queue is compared as a set.
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
        // The due chunk adds nothing: every count is the same without it.
        store.sql.prepare("UPDATE study_cards SET deleted_at = ? WHERE id = ?").run(tomorrow.toISOString(), id);
        expect(await counts()).toEqual(withChunk);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
