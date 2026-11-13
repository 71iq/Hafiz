import { atLocalTime } from "@/lib/habit/dates";
import { countMistakeInbox } from "@/lib/hifz/errors";
import type { PageLine, PageToken, RecitationPage } from "@/lib/hifz/page-data";
import { declareMemorizedPages, loadPageCards } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN } from "@/lib/hifz/plan";
import { errorHalf, halfLineNumbers, loadDueRemediation } from "@/lib/hifz/remediation";
import { readWeakSpots, type RecitationErrorInput } from "@/lib/hifz/errors";
import { clozeCardId, parseClozeCardId } from "@/lib/hifz/weak-spots";
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

  it("reads cloze ids and the marker setting, on by default", () => {
    expect(parseClozeCardId("cloze:2:255:4")).toEqual({ surah: 2, ayah: 255, word: 4 });
    expect(parseClozeCardId("cloze:115:1:1")).toBeNull();
    expect(parseClozeCardId("page:madani15:5")).toBeNull();
    expect(parseHabitSettings(new Map()).showWeakSpots).toBe(true);
    expect(parseHabitSettings(new Map([["habit_hide_weak_spots", "true"]])).showWeakSpots).toBe(false);
  });
});
