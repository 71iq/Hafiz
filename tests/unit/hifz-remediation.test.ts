import { atLocalTime } from "@/lib/habit/dates";
import { countMistakeInbox } from "@/lib/hifz/errors";
import type { PageLine, PageToken, RecitationPage } from "@/lib/hifz/page-data";
import { declareMemorizedPages, loadPageCards } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN } from "@/lib/hifz/plan";
import { errorHalf, halfLineNumbers, loadDueRemediation } from "@/lib/hifz/remediation";
import { dismissInboxItem, readMistakeInbox, readWeakSpots, type RecitationErrorInput } from "@/lib/hifz/errors";
import { clozeCardId, createWeakSpotCards, parseClozeCardId } from "@/lib/hifz/weak-spots";
import { DEFAULT_REVIEW_SAVE_CONTEXT, persistReviewTransition } from "@/lib/fsrs/persist-review";
import { setStudyCardMarked } from "@/lib/fsrs/queries";
import { calculateReviewTransition } from "@/lib/fsrs/review-transition";
import { startReviewSession } from "@/lib/fsrs/review-sessions";
import { parseHabitSettings } from "@/lib/habit/settings";
import { addDays } from "@/lib/habit/dates";
import { emptyAttempt, savePageGrade, saveRemediationGrade, type Attempt } from "@/lib/hifz/review";
import { Rating } from "@/lib/fsrs/scheduler";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const TODAY = "2026-11-13";
const MINUTE = 60_000;

function token(ayah: number, wordPos: number): PageToken {
  return { glyph: `g${ayah}-${wordPos}`, surah: 2, ayah, wordPos, isMarker: false, firstLetter: "ب" };
}

/** A 15-line page, one ayah per line, two words each. */
const page: RecitationPage = {
  page: 5,
  lines: Array.from(
    { length: 15 },
    (_, i): PageLine => ({ lineNumber: i + 1, kind: "ayah", centered: false, surahNumber: null, tokens: [token(i + 1, 1), token(i + 1, 2)] }),
  ),
  ayahs: Array.from({ length: 15 }, (_, i) => ({ surah: 2, ayah: i + 1 })),
};
const wordOn = (line: number) => page.lines[line - 1].tokens[0];

describe("half pages (SCH-08)", () => {
  it("splits a page in reading order, the first half taking the odd line", () => {
    expect([...halfLineNumbers(page, "a")]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...halfLineNumbers(page, "b")]).toEqual([9, 10, 11, 12, 13, 14, 15]);
  });

  it("names the half only when every error falls in it", () => {
    expect(errorHalf(page, [])).toBeNull();
    expect(errorHalf(page, [wordOn(2), wordOn(8)])).toBe("a");
    expect(errorHalf(page, [wordOn(9), wordOn(15)])).toBe("b");
    expect(errorHalf(page, [wordOn(8), wordOn(9)])).toBeNull();
  });
});

describe("half pages and seams from a page grade", () => {
  let store: OutboxDatabase;
  const plan = { ...DEFAULT_HIFZ_PLAN, cycleDays: 30 };
  const start = atLocalTime(TODAY, 600);

  beforeEach(async () => {
    store = await openOutboxDatabase();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    await declareMemorizedPages(store.db, { pages: [5, 6], cycleDays: 30, now: start });
  });
  afterEach(async () => {
    await store.db.getFirstAsync("SELECT 1");
    await store.close();
    jest.restoreAllMocks();
  });

  async function gradePage(attempt: Attempt, rating: Rating, now = start) {
    const cards = await loadPageCards(store.db, { today: TODAY, plan });
    const card = cards.find((candidate) => candidate.page === 5)!;
    return savePageGrade(store.db, {
      card: card.row,
      history: card.history,
      plan,
      attempt,
      rating: rating as 1 | 2 | 3 | 4,
      firstToken: page.lines[0].tokens[0],
      session: null,
      durationMs: 3 * MINUTE,
      now,
      page,
    });
  }

  const ids = async (at: Date) => (await loadDueRemediation(store.db, at)).map((unit) => unit.row.id);
  const logCount = () => Number(store.sql.prepare("SELECT COUNT(*) AS count FROM study_log").get()?.count);

  it("relearns the failing half in 10 minutes and the next day, without logging it twice", async () => {
    const attempt: Attempt = { ...emptyAttempt(4), shown: [wordOn(11)], peeked: [wordOn(13)] };
    const result = await gradePage(attempt, Rating.Again);
    expect(result.remediation).toEqual({ half: "b", seam: null });
    expect(logCount()).toBe(1);

    expect(await ids(new Date(start.getTime() + 5 * MINUTE))).toEqual([]);
    const tenMinutes = new Date(start.getTime() + 10 * MINUTE);
    expect(await ids(tenMinutes)).toEqual(["half:madani15:5:b"]);

    const [unit] = await loadDueRemediation(store.db, tenMinutes);
    const graded = async (row: StudyCardRow, at: Date) =>
      saveRemediationGrade(store.db, {
        card: row,
        rating: Rating.Good,
        attempt: emptyAttempt(4),
        firstToken: wordOn(9),
        session: null,
        durationMs: 2 * MINUTE,
        now: at,
      });
    await graded(unit.row, tenMinutes);
    expect(logCount()).toBe(2);
    expect(await ids(new Date(tenMinutes.getTime() + 60 * MINUTE))).toEqual([]);

    const nextDay = new Date(tenMinutes.getTime() + 24 * 60 * MINUTE);
    const [again] = await loadDueRemediation(store.db, nextDay);
    expect(again?.row.id).toBe("half:madani15:5:b");
    await graded(again.row, nextDay);
    expect(await ids(new Date(nextDay.getTime() + 40 * 24 * 60 * MINUTE))).toEqual([]);
  });

  it("leaves halves alone when errors span the page or the grade is not Again", async () => {
    await gradePage({ ...emptyAttempt(4), shown: [wordOn(2), wordOn(12)] }, Rating.Again);
    await gradePage({ ...emptyAttempt(4), peeked: [wordOn(2)] }, Rating.Hard, atLocalTime(TODAY, 700));
    expect(store.sql.prepare("SELECT COUNT(*) AS count FROM study_cards WHERE id LIKE 'half:%'").get()).toEqual({ count: 0 });
  });

  it("reviews the seam on a clean continuation without surfacing it, and relearns it after a stumble", async () => {
    const seam = { surah: 2, ayah: 16 };
    const clean = await gradePage({ ...emptyAttempt(4), seam: { clean: true, ...seam } }, Rating.Good);
    expect(clean.remediation).toEqual({ half: null, seam: "clean" });
    expect(store.sql.prepare("SELECT state, learning_steps FROM study_cards WHERE id = 'seam:madani15:5'").get()).toMatchObject({
      learning_steps: 0,
    });
    expect(await ids(atLocalTime(TODAY, 600 + 30 * 24 * 60))).toEqual([]);

    const later = atLocalTime(TODAY, 900);
    const stumbled = await gradePage({ ...emptyAttempt(4), seam: { clean: false, ...seam } }, Rating.Again, later);
    expect(stumbled.remediation.seam).toBe("lapsed");
    expect(await ids(new Date(later.getTime() + 10 * MINUTE))).toEqual(["seam:madani15:5"]);
    // The stumble is logged on the page but relearns as the seam, not as an ayah drill.
    expect(store.sql.prepare("SELECT type FROM recitation_errors").all()).toEqual([{ type: "seam" }]);
    expect(await countMistakeInbox(store.db, TODAY)).toBe(0);
  });

  it("keeps the next-day step for a stumbled seam when the next continuation is clean (SCH-06)", async () => {
    const seam = { surah: 2, ayah: 16 };
    await gradePage({ ...emptyAttempt(4), seam: { clean: false, ...seam } }, Rating.Again);
    const later = new Date(start.getTime() + 11 * MINUTE);
    await gradePage({ ...emptyAttempt(4), seam: { clean: true, ...seam } }, Rating.Good, later);
    // The clean continuation counts as the 10-minute step; the seam still comes back the next day.
    expect(await ids(new Date(later.getTime() + 60 * MINUTE))).toEqual([]);
    expect(await ids(new Date(later.getTime() + 24 * 60 * MINUTE + MINUTE))).toEqual(["seam:madani15:5"]);
  });

  it("grades a queued seam from its current row when a page grade reviewed it after the queue was built", async () => {
    const seam = { surah: 2, ayah: 16 };
    await gradePage({ ...emptyAttempt(4), seam: { clean: false, ...seam } }, Rating.Again);
    const queuedAt = new Date(start.getTime() + 10 * MINUTE);
    const [queued] = await loadDueRemediation(store.db, queuedAt);
    expect(queued.kind).toBe("seam");
    await gradePage({ ...emptyAttempt(4), seam: { clean: true, ...seam } }, Rating.Good, new Date(start.getTime() + 11 * MINUTE));
    const current = store.sql.prepare("SELECT reps FROM study_cards WHERE id = 'seam:madani15:5'").get() as { reps: number };
    await saveRemediationGrade(store.db, {
      card: queued.row,
      rating: Rating.Good,
      attempt: { ...emptyAttempt(4), seam: { clean: true, ...seam } },
      firstToken: null,
      session: null,
      durationMs: MINUTE,
      now: new Date(start.getTime() + 12 * MINUTE),
    });
    expect(store.sql.prepare("SELECT reps FROM study_cards WHERE id = 'seam:madani15:5'").get()).toEqual({ reps: current.reps + 1 });
  });

  it("applies two grades of the same queued card queued at once, each from the row the other left", async () => {
    const seam = { surah: 2, ayah: 16 };
    await gradePage({ ...emptyAttempt(4), seam: { clean: false, ...seam } }, Rating.Again);
    const [queued] = await loadDueRemediation(store.db, new Date(start.getTime() + 10 * MINUTE));
    const before = store.sql.prepare("SELECT reps FROM study_cards WHERE id = 'seam:madani15:5'").get() as { reps: number };
    const gradeAt = (minutes: number) =>
      saveRemediationGrade(store.db, {
        card: queued.row,
        rating: Rating.Good,
        attempt: { ...emptyAttempt(4), seam: { clean: true, ...seam } },
        firstToken: null,
        session: null,
        durationMs: MINUTE,
        now: new Date(start.getTime() + minutes * MINUTE),
      });
    await Promise.all([gradeAt(11), gradeAt(12)]);
    expect(store.sql.prepare("SELECT reps FROM study_cards WHERE id = 'seam:madani15:5'").get()).toEqual({ reps: before.reps + 2 });
  });

  it("does not count a clean seam after a weak page, or any seam recited in salah", async () => {
    const seam = { clean: true, surah: 2, ayah: 16 };
    expect((await gradePage({ ...emptyAttempt(4), seam }, Rating.Hard)).remediation.seam).toBeNull();
    const cards = await loadPageCards(store.db, { today: TODAY, plan });
    const card = cards.find((candidate) => candidate.page === 5)!;
    const salah = await savePageGrade(store.db, {
      card: card.row,
      history: card.history,
      plan,
      attempt: { ...emptyAttempt(4), seam },
      rating: Rating.Good,
      firstToken: page.lines[0].tokens[0],
      session: null,
      durationMs: 0,
      grader: "salah",
      now: atLocalTime(TODAY, 700),
      page,
    });
    expect(salah.remediation).toEqual({ half: null, seam: null });
    expect(store.sql.prepare("SELECT COUNT(*) AS count FROM study_cards WHERE id LIKE 'seam:%'").get()).toEqual({ count: 0 });
  });
});

describe("weak spots (ERR-06)", () => {
  let store: OutboxDatabase;
  beforeEach(async () => {
    store = await openOutboxDatabase();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    await store.db.getFirstAsync("SELECT 1");
    await store.close();
    jest.restoreAllMocks();
  });

  async function gradeWithErrors(day: number, errors: RecitationErrorInput[]) {
    const at = atLocalTime(addDays(TODAY, day), 600);
    const card = await setStudyCardMarked(store.db, "default-retention", "2:255", false);
    const transition = calculateReviewTransition({ card, rating: Rating.Again, reviewedAt: at });
    const session = startReviewSession("wird", { now: at });
    await persistReviewTransition({
      db: store.db,
      cardId: "2:255",
      transition,
      context: { ...DEFAULT_REVIEW_SAVE_CONTEXT, session, supportLevel: 4, errors },
    });
  }
  const wrongWord = (word: number, overrides: Partial<RecitationErrorInput> = {}): RecitationErrorInput => ({
    type: "wrong_word",
    corrected: "none",
    surah: 2,
    ayah: 255,
    word,
    ...overrides,
  });
  const cards = () => store.sql.prepare("SELECT id FROM study_cards WHERE id LIKE 'cloze:%' ORDER BY id").all();

  it("makes a word wrong in a third session a weak spot with one cloze card, due now", async () => {
    await gradeWithErrors(0, [wrongWord(4)]);
    await gradeWithErrors(1, [wrongWord(4), wrongWord(4)]);
    expect(cards()).toEqual([]);
    await gradeWithErrors(2, [wrongWord(4)]);
    expect(cards()).toEqual([{ id: clozeCardId(2, 255, 4) }]);
    expect(await readWeakSpots(store.db)).toEqual([{ surah: 2, ayah: 255, word: 4 }]);
    await gradeWithErrors(3, [wrongWord(4)]);
    expect(cards()).toEqual([{ id: clozeCardId(2, 255, 4) }]);

    const [unit] = await loadDueRemediation(store.db, atLocalTime(addDays(TODAY, 3), 700));
    expect(unit).toMatchObject({ kind: "cloze", surah: 2, ayah: 255, word: 4 });
  });

  it("does not count tajweed, hesitation or caught slips toward a weak spot", async () => {
    for (let day = 0; day < 3; day += 1) {
      await gradeWithErrors(day, [
        wrongWord(5, { type: "tajweed" }),
        wrongWord(6, { type: "hesitation" }),
        wrongWord(7, { corrected: "self" }),
      ]);
    }
    expect(cards()).toEqual([]);
    expect(await readWeakSpots(store.db)).toEqual([]);
  });

  const liveCards = () => store.sql.prepare("SELECT id FROM study_cards WHERE id LIKE 'cloze:%' AND deleted_at IS NULL ORDER BY id").all();

  it("deletes the cloze card, with its upload queued, when a dismissal leaves the word wrong in fewer than 3 sessions", async () => {
    for (let day = 0; day < 3; day += 1) await gradeWithErrors(day, [wrongWord(4)]);
    expect(liveCards()).toEqual([{ id: clozeCardId(2, 255, 4) }]);
    const [item] = await readMistakeInbox(store.db, addDays(TODAY, 2));
    await dismissInboxItem(store.db, { id: item.id, now: atLocalTime(addDays(TODAY, 2), 700) });

    expect(liveCards()).toEqual([]);
    expect(await readWeakSpots(store.db)).toEqual([]);
    expect(await loadDueRemediation(store.db, atLocalTime(addDays(TODAY, 2), 800))).toEqual([]);
    const upload = store.sql
      .prepare("SELECT data FROM sync_queue WHERE table_name = 'study_cards' AND operation = 'DELETE' AND row_id = ?")
      .get(clozeCardId(2, 255, 4)) as { data: string } | undefined;
    expect(JSON.parse(upload?.data ?? "{}")).toMatchObject({ id: clozeCardId(2, 255, 4), deck_id: "hifz-pages", deleted_at: expect.any(String) });
  });

  it("restores a deleted cloze card with its training when the word becomes weak again", async () => {
    for (let day = 0; day < 3; day += 1) await gradeWithErrors(day, [wrongWord(4)]);
    const id = clozeCardId(2, 255, 4);
    store.sql.prepare("UPDATE study_cards SET reps = 4, stability = 9 WHERE id = ?").run(id);
    const [item] = await readMistakeInbox(store.db, addDays(TODAY, 2));
    await dismissInboxItem(store.db, { id: item.id, now: atLocalTime(addDays(TODAY, 2), 700) });
    expect(liveCards()).toEqual([]);

    await gradeWithErrors(3, [wrongWord(4)]);
    expect(liveCards()).toEqual([{ id }]);
    expect(store.sql.prepare("SELECT reps, stability FROM study_cards WHERE id = ?").get(id)).toEqual({ reps: 4, stability: 9 });
    const upload = store.sql
      .prepare("SELECT data FROM sync_queue WHERE table_name = 'study_cards' AND row_id = ? ORDER BY id DESC LIMIT 1")
      .get(id) as { data: string };
    expect(JSON.parse(upload.data)).toMatchObject({ id, reps: 4, deleted_at: null });
  });

  it("keeps the cloze card when the word is still wrong in 3 sessions after a dismissal", async () => {
    for (let day = 0; day < 4; day += 1) await gradeWithErrors(day, [wrongWord(4)]);
    const [item] = await readMistakeInbox(store.db, addDays(TODAY, 3));
    await dismissInboxItem(store.db, { id: item.id, now: atLocalTime(addDays(TODAY, 3), 700) });
    expect(liveCards()).toEqual([{ id: clozeCardId(2, 255, 4) }]);
  });

  it("skips locations that already have a cloze card and counts the rest in one query", async () => {
    for (let day = 0; day < 3; day += 1) await gradeWithErrors(day, [wrongWord(4)]);
    await gradeWithErrors(3, [wrongWord(5)]);
    const counts: string[] = [];
    const now = atLocalTime(addDays(TODAY, 3), 700);
    await store.db.withTransactionAsync(async (tx) => {
      // Record each read of the error log made through this executor.
      const counting = new Proxy(tx, {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (typeof value !== "function") return value;
          return (sql: string, ...rest: unknown[]) => {
            if ((key === "getAllAsync" || key === "getFirstAsync") && sql.includes("FROM recitation_errors")) counts.push(sql);
            return value.call(target, sql, ...rest);
          };
        },
      });
      expect(await createWeakSpotCards(counting, [wrongWord(4), wrongWord(5), wrongWord(6), wrongWord(5)], now)).toBe(0);
      expect(counts).toHaveLength(1);
      counts.length = 0;
      expect(await createWeakSpotCards(counting, [wrongWord(4)], now)).toBe(0);
      expect(counts).toHaveLength(0);
    });
  });

  it("creates the cloze card for a weak spot whose sessions were pulled from other devices", async () => {
    const insert = store.sql.prepare(
      `INSERT INTO recitation_errors (id, card_id, session_id, surah, ayah, word, type, severity, corrected, local_date, created_at, updated_at)
       VALUES (?, '2:255', ?, 2, 255, 7, 'wrong_word', 'jali', 'none', ?, ?, ?)`,
    );
    for (let day = 0; day < 3; day += 1) {
      const at = atLocalTime(addDays(TODAY, day), 600).toISOString();
      insert.run(`err-pulled-${day}`, `session-device-${day}`, addDays(TODAY, day), at, at);
    }
    const pulled = store.sql.prepare("SELECT surah, ayah, word FROM recitation_errors").all() as { surah: number; ayah: number; word: number }[];
    let created = 0;
    await store.db.withTransactionAsync(async (tx) => {
      created = await createWeakSpotCards(tx, pulled, atLocalTime(addDays(TODAY, 2), 700));
    });
    expect(created).toBe(1);
    expect(liveCards()).toEqual([{ id: clozeCardId(2, 255, 7) }]);
  });

  it("reads cloze ids and the marker setting, on by default", () => {
    expect(parseClozeCardId("cloze:2:255:4")).toEqual({ surah: 2, ayah: 255, word: 4 });
    expect(parseClozeCardId("cloze:115:1:1")).toBeNull();
    expect(parseClozeCardId("page:madani15:5")).toBeNull();
    expect(parseHabitSettings(new Map()).showWeakSpots).toBe(true);
    expect(parseHabitSettings(new Map([["habit_hide_weak_spots", "true"]])).showWeakSpots).toBe(false);
  });
});
