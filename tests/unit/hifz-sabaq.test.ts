import { atLocalTime } from "@/lib/habit/dates";
import { readHabitDayRow } from "@/lib/habit/queries";
import { loadPageCards } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN } from "@/lib/hifz/plan";
import { completeSabaqChunk, newPageOrder, nextSabaqTarget } from "@/lib/hifz/sabaq";
import { PAGE_COUNT, pageCardId } from "@/lib/hifz/units";
import { Rating } from "@/lib/fsrs/scheduler";
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
    expect(firstSave.wird.kind).toBe("minimum_met");

    const second = (await nextSabaqTarget(store.db, { plan, wantLines: 4, pageWords }))!;
    expect(second).toMatchObject({ page: 1, fromLine: 6, toLine: 8, completesPage: true });
    expect(second.linkAyahs.map((ayah) => ayah.ayah)).toEqual([3, 4]);
    const secondSave = await completeSabaqChunk(store.db, { target: second, plan, rating: Rating.Good, session: null, durationMs: 600_000, now: atLocalTime(TODAY, 600) });
    expect(secondSave.pageAdded).toBe(true);

    const cards = await loadPageCards(store.db, { today: TODAY, plan });
    expect(cards.map((card) => [card.row.id, card.tier])).toEqual([[pageCardId(1), "sabqi"]]);
    expect(await nextSabaqTarget(store.db, { plan: { ...plan, direction: "from_fatiha" }, wantLines: 4, pageWords })).toBeNull();
    expect(await readHabitDayRow(store.db, TODAY)).toMatchObject({ status: "done" });
  });

  it("does not add the page when the fluent check of its last chunk fails", async () => {
    const target = (await nextSabaqTarget(store.db, { plan, wantLines: 10, pageWords: () => null }))!;
    expect(target.completesPage).toBe(true);
    const result = await completeSabaqChunk(store.db, { target, plan, rating: Rating.Again, session: null, durationMs: 60_000 });
    expect(result.pageAdded).toBe(false);
  });
});
