import { addDays, atLocalTime } from "@/lib/habit/dates";
import { readHabitDayRow } from "@/lib/habit/queries";
import { countMistakeInbox, recordDrillResult, readMistakeInbox } from "@/lib/hifz/errors";
import { proposeRating } from "@/lib/hifz/grading";
import type { PageLine, PageToken } from "@/lib/hifz/page-data";
import { declareMemorizedPages, loadPageCards } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN } from "@/lib/hifz/plan";
import {
  attemptErrors,
  attemptEvents,
  emptyAttempt,
  endOfLineAt,
  MANZIL_CYCLE_START_KEY,
  nextHiddenWord,
  proposedRating,
  recordReviewPace,
  savePageGrade,
  type Attempt,
  type AttemptMark,
} from "@/lib/hifz/review";
import { Rating } from "@/lib/fsrs/scheduler";
import { pageCardId } from "@/lib/hifz/units";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const TODAY = "2026-11-13";

function token(ayah: number, wordPos: number | null, isMarker = false): PageToken {
  return { glyph: `g${ayah}-${wordPos ?? "m"}`, surah: 2, ayah, wordPos, isMarker, firstLetter: isMarker ? null : "ب" };
}

const lines: PageLine[] = [
  { lineNumber: 1, kind: "ayah", centered: false, surahNumber: null, tokens: [token(1, 1), token(1, 2), token(1, null, true)] },
  { lineNumber: 2, kind: "ayah", centered: false, surahNumber: null, tokens: [token(2, 1), token(2, 2), token(2, 3)] },
];
const tokens = lines.flatMap((line) => line.tokens);

describe("recitation attempt (GRD-01 to GRD-03)", () => {
  it("skips ayah markers when peeking and shows to the end of the line", () => {
    expect(nextHiddenWord(tokens, 2)).toBe(3);
    expect(nextHiddenWord(tokens, 6)).toBe(-1);
    expect(endOfLineAt(lines, 0)).toBe(3);
    expect(endOfLineAt(lines, 4)).toBe(6);
  });

  it("proposes Good for a clean attempt, Hard after a peek, Again after Show me, capped by the level", () => {
    expect(proposedRating(emptyAttempt(4))).toBe(Rating.Good);
    expect(proposedRating({ ...emptyAttempt(4), peeked: [tokens[0]] })).toBe(Rating.Hard);
    expect(proposedRating({ ...emptyAttempt(4), shown: [tokens[0]] })).toBe(Rating.Again);
    expect(proposedRating(emptyAttempt(2))).toBe(Rating.Good);
    expect(proposedRating(emptyAttempt(1))).toBe(Rating.Hard);
    expect(proposedRating(emptyAttempt(0))).toBe(0);
  });

  it("counts marked mistakes by kind, keeping tajweed off the hifz grade", () => {
    const marks = new Map<string, AttemptMark>([
      ["a", { token: tokens[0], type: "wrong_word" }],
      ["b", { token: tokens[1], type: "tajweed" }],
    ]);
    const attempt: Attempt = { ...emptyAttempt(4), marks };
    expect(attemptEvents(attempt)).toMatchObject({ uncorrectedJali: 1, skippedAyah: false });
    expect(proposedRating(attempt)).toBe(Rating.Hard);
    const twice = new Map<string, AttemptMark>([...marks, ["c", { token: tokens[3], type: "harakah" }]]);
    expect(proposedRating({ ...attempt, marks: twice })).toBe(Rating.Again);
    const drift = new Map([["d", { token: tokens[3], type: "mutashabih_drift" as const }]]);
    expect(proposedRating({ ...attempt, marks: drift })).toBe(Rating.Again);
    expect(proposeRating(attemptEvents({ ...emptyAttempt(4), slips: 2 }), 4, { fluent: true })).toBe(Rating.Good);
  });

  it("logs peeks as tanbih, Show me as fath, marks as uncorrected and slips as self-corrected", () => {
    const attempt: Attempt = {
      ...emptyAttempt(4),
      peeked: [tokens[0]],
      shown: [tokens[3]],
      slips: 1,
      marks: new Map([["x", { token: tokens[4], type: "harakah" as const }]]),
    };
    expect(attemptErrors(attempt, tokens[0])).toEqual([
      { type: "skip_word", corrected: "tanbih", surah: 2, ayah: 1, word: 1 },
      { type: "skip_word", corrected: "fath", surah: 2, ayah: 2, word: 1 },
      { type: "harakah", corrected: "none", surah: 2, ayah: 2, word: 2 },
      { type: "wrong_word", corrected: "self", surah: 2, ayah: null, word: null },
    ]);
  });
});

describe("saving a page grade", () => {
  let store: OutboxDatabase;
  const plan = { ...DEFAULT_HIFZ_PLAN, cycleDays: 2 };
  beforeEach(async () => {
    store = await openOutboxDatabase();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    await store.db.getFirstAsync("SELECT 1");
    await store.close();
    jest.restoreAllMocks();
  });

  async function card(page: number, now: Date) {
    const cards = await loadPageCards(store.db, { today: TODAY, plan });
    return cards.find((candidate) => candidate.page === page)!;
  }

  it("caps the grade by the support level, logs the attempt and updates the cached tier in one save", async () => {
    const now = atLocalTime(TODAY, 600);
    await declareMemorizedPages(store.db, { pages: [5], cycleDays: 30, now });
    const page = await card(5, now);
    const attempt: Attempt = { ...emptyAttempt(1), marks: new Map([["k", { token: tokens[0], type: "wrong_word" as const }]]) };
    const result = await savePageGrade(store.db, {
      card: page.row,
      history: page.history,
      plan,
      attempt,
      rating: Rating.Easy,
      firstToken: tokens[0],
      session: null,
      durationMs: 120_000,
      now,
    });
    expect(result.tier).toBe("manzil");
    expect(result.wird.kind).toBe("minimum_met");
    const log = store.sql.prepare("SELECT rating, support_level, proposed_rating, error_count FROM study_log").get();
    expect(log).toEqual({ rating: Rating.Hard, support_level: 1, proposed_rating: Rating.Hard, error_count: 1 });
    expect(store.sql.prepare("SELECT tier FROM study_cards WHERE id = ?").get(page.row.id)).toEqual({ tier: "manzil" });
    expect(await countMistakeInbox(store.db, TODAY)).toBe(1);
  });

  it("logs a page recited in salah as Good with no support level or errors (REV-02)", async () => {
    const now = atLocalTime(TODAY, 600);
    await declareMemorizedPages(store.db, { pages: [6], cycleDays: 30, now });
    const page = await card(6, now);
    await savePageGrade(store.db, {
      card: page.row,
      history: page.history,
      plan,
      attempt: emptyAttempt(4),
      rating: Rating.Good,
      firstToken: tokens[0],
      session: null,
      durationMs: 0,
      grader: "salah",
      now,
    });
    expect(store.sql.prepare("SELECT rating, grader, support_level, error_count FROM study_log").get()).toEqual({
      rating: Rating.Good,
      grader: "salah",
      support_level: null,
      error_count: 0,
    });
  });

  it("marks the day a manzil cycle completes and starts the next one tomorrow (MST-04)", async () => {
    const now = atLocalTime(TODAY, 600);
    await declareMemorizedPages(store.db, { pages: [7, 8], cycleDays: 2, now });
    for (const [offset, pageNumber] of [[0, 7], [1, 8]] as const) {
      const page = await card(pageNumber, now);
      await savePageGrade(store.db, {
        card: page.row,
        history: page.history,
        plan,
        attempt: emptyAttempt(4),
        rating: Rating.Good,
        firstToken: tokens[0],
        session: null,
        durationMs: 60_000,
        now: atLocalTime(TODAY, 600 + offset),
      });
    }
    expect(await readHabitDayRow(store.db, TODAY)).toMatchObject({ manzil_cycle_completed: 1, status: "done" });
    expect(store.sql.prepare("SELECT value FROM user_settings WHERE key = ?").get(MANZIL_CYCLE_START_KEY)).toEqual({
      value: addDays(TODAY, 1),
    });
  });

  async function gradeGood(pageNumber: number, now: Date) {
    const page = await card(pageNumber, now);
    await savePageGrade(store.db, {
      card: page.row,
      history: page.history,
      plan,
      attempt: emptyAttempt(4),
      rating: Rating.Good,
      firstToken: tokens[0],
      session: null,
      durationMs: 60_000,
      now,
    });
  }
  const cycleStart = () => store.sql.prepare("SELECT value FROM user_settings WHERE key = ?").get(MANZIL_CYCLE_START_KEY);
  /** A zone further east puts the cards' creation instant on the next local day; a fallback start would move with it. */
  const travelEast = () =>
    store.sql.prepare("UPDATE study_cards SET created_at = ? WHERE id LIKE 'page:%'").run(atLocalTime(addDays(TODAY, 1), 30).toISOString());

  it("counts a manzil page toward the cycle when its synced cached tier is stale (MST-04)", async () => {
    await declareMemorizedPages(store.db, { pages: [7, 8], cycleDays: 2, now: atLocalTime(TODAY, 600) });
    // Another device's older row left page 8 cached as sabaq, while its merged history makes it manzil.
    store.sql.prepare("UPDATE study_cards SET tier = 'sabaq' WHERE id = ?").run(pageCardId(8));
    await gradeGood(7, atLocalTime(TODAY, 601));
    expect((await readHabitDayRow(store.db, TODAY))?.manzil_cycle_completed).toBe(0);
    await gradeGood(8, atLocalTime(TODAY, 602));
    expect(await readHabitDayRow(store.db, TODAY)).toMatchObject({ manzil_cycle_completed: 1 });
  });

  it("stores the first cycle's start as the declared calendar day, so travel does not move it (MST-04)", async () => {
    await declareMemorizedPages(store.db, { pages: [7, 8], cycleDays: 2, now: atLocalTime(TODAY, 600) });
    expect(cycleStart()).toEqual({ value: TODAY });
    expect(
      store.sql.prepare("SELECT COUNT(*) AS count FROM sync_queue WHERE table_name = 'user_settings' AND row_id = ?").get(MANZIL_CYCLE_START_KEY),
    ).toEqual({ count: 1 });
    travelEast();
    await gradeGood(8, atLocalTime(TODAY, 601));
    await gradeGood(7, atLocalTime(addDays(TODAY, 1), 600));
    expect(await readHabitDayRow(store.db, addDays(TODAY, 1))).toMatchObject({ manzil_cycle_completed: 1 });
  });

  it("stores the first cycle's start the first time it is needed when none was stored (MST-04)", async () => {
    await declareMemorizedPages(store.db, { pages: [7, 8], cycleDays: 2, now: atLocalTime(TODAY, 600) });
    // As for pages that reached manzil through sabqi, with no declaration to store a start.
    store.sql.prepare("DELETE FROM user_settings WHERE key = ?").run(MANZIL_CYCLE_START_KEY);
    await gradeGood(8, atLocalTime(TODAY, 601));
    expect(cycleStart()).toEqual({ value: TODAY });
    travelEast();
    await gradeGood(7, atLocalTime(addDays(TODAY, 1), 600));
    expect(await readHabitDayRow(store.db, addDays(TODAY, 1))).toMatchObject({ manzil_cycle_completed: 1 });
  });

  it("resolves a drilled inbox item after clean drills on two later days", async () => {
    const now = atLocalTime(TODAY, 600);
    await declareMemorizedPages(store.db, { pages: [9], cycleDays: 30, now });
    const page = await card(9, now);
    await savePageGrade(store.db, {
      card: page.row,
      history: page.history,
      plan,
      attempt: { ...emptyAttempt(4), shown: [tokens[0]] },
      rating: Rating.Again,
      firstToken: tokens[0],
      session: null,
      durationMs: 60_000,
      now,
    });
    const [item] = await readMistakeInbox(store.db, TODAY);
    expect(await recordDrillResult(store.db, { id: item.id, clean: true, now: atLocalTime(TODAY, 700) })).toEqual({ resolved: false });
    expect(await recordDrillResult(store.db, { id: item.id, clean: false, now: atLocalTime(addDays(TODAY, 1), 700) })).toEqual({ resolved: false });
    expect(await recordDrillResult(store.db, { id: item.id, clean: true, now: atLocalTime(addDays(TODAY, 1), 800) })).toEqual({ resolved: false });
    expect(await recordDrillResult(store.db, { id: item.id, clean: true, now: atLocalTime(addDays(TODAY, 2), 700) })).toEqual({ resolved: true });
    expect(await countMistakeInbox(store.db, addDays(TODAY, 2))).toBe(0);
  });

  it("learns minutes per review page as a moving average (PLN-05)", async () => {
    await recordReviewPace(store.db, { minutes: 20, pages: 4, current: 3 });
    expect(store.sql.prepare("SELECT value FROM user_settings WHERE key = 'hifz_t_rev'").get()).toEqual({ value: "3.4" });
    await recordReviewPace(store.db, { minutes: 0, pages: 4, current: 3.4 });
    expect(store.sql.prepare("SELECT value FROM user_settings WHERE key = 'hifz_t_rev'").get()).toEqual({ value: "3.4" });
  });
});
