import fc from "fast-check";
import { persistReviewTransition, DEFAULT_REVIEW_SAVE_CONTEXT, type ReviewSaveContext } from "@/lib/fsrs/persist-review";
import { setStudyCardMarked } from "@/lib/fsrs/queries";
import { calculateReviewTransition } from "@/lib/fsrs/review-transition";
import { endReviewSession, readReviewSession, startReviewSession } from "@/lib/fsrs/review-sessions";
import { Rating, type Grade } from "@/lib/fsrs/scheduler";
import { addDays, atLocalTime, localDateOf } from "@/lib/habit/dates";
import {
  clearExcusedDay,
  loadHabitOverview,
  markExcusedDays,
  markFullWirdIfComplete,
  applyRemoteHabitDay,
  putHabitDay,
  readHabitDayRow,
  settleHabitDays,
} from "@/lib/habit/queries";
import { reconcileHabitDaysFromLogs } from "@/lib/habit/reconcile";
import type { HabitDayRow } from "@/lib/habit/types";
import { DAY_TALLY_SQL, tallyReviews } from "@/lib/habit/minimum";
import { countMistakeInbox, readMistakeInbox } from "@/lib/hifz/errors";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const DECK = "default-retention";
const TODAY = "2026-03-10";
let store: OutboxDatabase;

function count(table: string, where = "1 = 1") {
  return Number(store.sql.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get()?.count);
}

async function settle() {
  await store.db.getFirstAsync("SELECT 1");
}

async function grade(cardId: string, at: Date, rating: Grade = Rating.Good, context: Partial<ReviewSaveContext> = {}) {
  const card = await setStudyCardMarked(store.db, DECK, cardId, false);
  const transition = calculateReviewTransition({ card, rating, reviewedAt: at });
  return persistReviewTransition({ db: store.db, cardId, transition, context: { ...DEFAULT_REVIEW_SAVE_CONTEXT, ...context } });
}

/** Ten ayah reviews make one page, the default minimum. */
async function reciteMinimum(date: string, startMinutes: number) {
  let last;
  for (let i = 0; i < 10; i += 1) {
    last = await grade(`2:${startMinutes + i + 1}`, atLocalTime(date, startMinutes + i));
  }
  return last!;
}

function doneDay(date: string): HabitDayRow {
  const at = atLocalTime(date, 20 * 60).toISOString();
  return {
    local_date: date,
    status: "done",
    earned_status: "done",
    reason: null,
    excuse_updated_at: null,
    minimum_met: 1,
    full_met: 0,
    manzil_cycle_completed: 0,
    source_session_id: null,
    credited_through: null,
    tz: "Asia/Amman",
    created_at: at,
    updated_at: at,
  };
}

async function seedDone(dates: string[]) {
  await store.db.withTransactionAsync(async (tx) => {
    for (const date of dates) await putHabitDay(tx, doneDay(date));
  });
}

beforeEach(async () => {
  store = await openOutboxDatabase();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await settle();
  await store.close();
  jest.restoreAllMocks();
});

describe("wird progress on grade (STR-01, DB-01)", () => {
  it("marks the day done on the review that completes the minimum, once", async () => {
    let event;
    for (let i = 0; i < 9; i += 1) event = await grade(`2:${i + 1}`, atLocalTime(TODAY, 600 + i));
    expect(event!.wird).toEqual({ kind: "none" });
    expect(await readHabitDayRow(store.db, TODAY)).toBeNull();

    event = await grade("2:10", atLocalTime(TODAY, 610));
    expect(event.wird).toEqual({ kind: "minimum_met", length: 1 });
    expect(await readHabitDayRow(store.db, TODAY)).toMatchObject({ status: "done", minimum_met: 1 });

    event = await grade("2:11", atLocalTime(TODAY, 611));
    expect(event.wird).toEqual({ kind: "none" });
    expect(count("sync_queue", "table_name = 'habit_days'")).toBe(1);
  });

  it("stores each review's local date, zone and detail", async () => {
    await grade("2:255", atLocalTime(TODAY, 600), Rating.Hard, { durationMs: 42_000, supportLevel: 3, proposedRating: 2 });
    const log = store.sql.prepare("SELECT * FROM study_log").get();
    expect(log).toMatchObject({
      local_date: TODAY,
      duration_ms: 42_000,
      support_level: 3,
      proposed_rating: 2,
      grader: "self",
      error_count: 0,
    });
    expect(typeof log?.tz).toBe("string");
    const queued = JSON.parse(String(store.sql.prepare("SELECT data FROM sync_queue WHERE table_name = 'study_log'").get()?.data));
    expect(queued).toMatchObject({ local_date: TODAY, duration_ms: 42_000, support_level: 3, grader: "self" });
  });

  it("meets the minimum by five minutes of graded review", async () => {
    await grade("2:1", atLocalTime(TODAY, 600), Rating.Good, { durationMs: 180_000 });
    const event = await grade("2:2", atLocalTime(TODAY, 604), Rating.Good, { durationMs: 120_000 });
    expect(event.wird.kind).toBe("minimum_met");
  });

  it("saves nothing when the wird day's upload cannot be queued", async () => {
    const card = await setStudyCardMarked(store.db, DECK, "page:madani15:1", false);
    const transition = calculateReviewTransition({ card, rating: Rating.Good, reviewedAt: atLocalTime(TODAY, 600) });
    // Queue order inside the grade: card, review log, then the wird day.
    store.failQueueInsert(3);
    await expect(persistReviewTransition({ db: store.db, cardId: card.id, transition })).rejects.toThrow(
      "Synthetic sync_queue write failure",
    );
    expect(count("study_log")).toBe(0);
    expect(count("habit_days")).toBe(0);
    expect(store.sql.prepare("SELECT reps FROM study_cards WHERE id = ?").get(card.id)).toEqual({ reps: card.reps });
  });
});

describe("make-up window (STR-07, STR-08)", () => {
  const yesterday = addDays(TODAY, -1);

  it("credits the first minimum before 12:30 to yesterday, and only later reviews to today", async () => {
    await seedDone([addDays(TODAY, -3), addDays(TODAY, -2)]);
    const madeUp = await reciteMinimum(TODAY, 9 * 60);
    expect(madeUp.wird).toEqual({ kind: "made_up", madeUpDay: yesterday, length: 3 });
    const row = await readHabitDayRow(store.db, yesterday);
    expect(row).toMatchObject({ status: "made_up", credited_through: atLocalTime(TODAY, 9 * 60 + 9).toISOString() });
    expect(await readHabitDayRow(store.db, TODAY)).toBeNull();

    // The same reviews never count for today too.
    const overview = await loadHabitOverview(store.db, { now: atLocalTime(TODAY, 10 * 60) });
    expect(overview.minimumProgressToday).toBe(0);
    expect(overview.streak).toMatchObject({ length: 3, atRisk: true });

    const own = await reciteMinimum(TODAY, 10 * 60);
    expect(own.wird).toEqual({ kind: "minimum_met", length: 4 });
  });

  it("keeps the credited reviews off today after another device also marks yesterday done", async () => {
    await seedDone([addDays(TODAY, -3), addDays(TODAY, -2)]);
    await reciteMinimum(TODAY, 9 * 60);
    await applyRemoteHabitDay(store.db, doneDay(yesterday));
    expect(await readHabitDayRow(store.db, yesterday)).toMatchObject({ status: "done", credited_through: expect.any(String) });

    const overview = await loadHabitOverview(store.db, { now: atLocalTime(TODAY, 10 * 60) });
    expect(overview.minimumProgressToday).toBe(0);
    for (let i = 0; i < 9; i += 1) {
      expect((await grade(`3:${i + 1}`, atLocalTime(TODAY, 10 * 60 + i))).wird).toEqual({ kind: "none" });
    }
    expect((await grade("3:10", atLocalTime(TODAY, 10 * 60 + 9))).wird).toEqual({ kind: "minimum_met", length: 4 });
  });

  it("counts reviews after the cutoff for today, leaving yesterday missed", async () => {
    await seedDone([addDays(TODAY, -3), addDays(TODAY, -2)]);
    const event = await reciteMinimum(TODAY, 13 * 60);
    expect(event.wird).toEqual({ kind: "minimum_met", length: 1 });
    expect(await readHabitDayRow(store.db, yesterday)).toBeNull();
  });

  it("does not make up a day when the streak had already ended", async () => {
    await seedDone([addDays(TODAY, -4)]);
    const event = await reciteMinimum(TODAY, 9 * 60);
    expect(event.wird).toEqual({ kind: "minimum_met", length: 1 });
  });
});

describe("settle pass, excuses and pause", () => {
  it("records a grace day once yesterday's make-up window closes, and only once", async () => {
    await seedDone([addDays(TODAY, -4), addDays(TODAY, -3), addDays(TODAY, -2)]);
    expect(await settleHabitDays(store.db, { now: atLocalTime(TODAY, 9 * 60) })).toEqual([]);
    expect(await settleHabitDays(store.db, { now: atLocalTime(TODAY, 13 * 60) })).toEqual([
      { localDate: addDays(TODAY, -1), status: "grace" },
    ]);
    expect(await settleHabitDays(store.db, { now: atLocalTime(TODAY, 14 * 60) })).toEqual([]);
    const overview = await loadHabitOverview(store.db, { now: atLocalTime(TODAY, 14 * 60) });
    expect(overview).toMatchObject({ graceHeld: 0, recentGraceDay: addDays(TODAY, -1) });
    expect(overview.headline).toEqual({ kind: "at_risk", length: 4 });
  });

  it("gives grace to an earlier gap that was never settled before a later wird day", async () => {
    await seedDone([addDays(TODAY, -6), addDays(TODAY, -5), addDays(TODAY, -4), addDays(TODAY, -2)]);
    expect(await settleHabitDays(store.db, { now: atLocalTime(TODAY, 9 * 60) })).toEqual([
      { localDate: addDays(TODAY, -3), status: "grace" },
    ]);
    const overview = await loadHabitOverview(store.db, { now: atLocalTime(TODAY, 9 * 60) });
    expect(overview.streak).toMatchObject({ length: 5, makeUpPending: true });
  });

  it("marks and withdraws excused days within 3 days back and 30 ahead", async () => {
    const now = atLocalTime(TODAY, 600);
    await markExcusedDays(store.db, { from: addDays(TODAY, -1), to: addDays(TODAY, 1), reason: "illness", now });
    expect(await readHabitDayRow(store.db, TODAY)).toMatchObject({ status: "excused", reason: "illness" });
    await expect(
      markExcusedDays(store.db, { from: addDays(TODAY, -4), to: TODAY, reason: "travel", now }),
    ).rejects.toThrow(RangeError);

    // A recited day keeps its status when the excuse is withdrawn.
    await reciteMinimum(TODAY, 700);
    await clearExcusedDay(store.db, { date: TODAY, now: atLocalTime(TODAY, 800) });
    await clearExcusedDay(store.db, { date: addDays(TODAY, 1), now: atLocalTime(TODAY, 800) });
    expect(await readHabitDayRow(store.db, TODAY)).toMatchObject({ status: "done", reason: null });
    expect(await readHabitDayRow(store.db, addDays(TODAY, 1))).toMatchObject({ status: null, reason: null });
  });

  it("marks the full wird only after the minimum and when nothing is left", async () => {
    const now = atLocalTime(TODAY, 900);
    expect(await markFullWirdIfComplete(store.db, { now, remaining: 0 })).toBe(false);
    await reciteMinimum(TODAY, 600);
    expect(await markFullWirdIfComplete(store.db, { now, remaining: 2 })).toBe(false);
    expect(await markFullWirdIfComplete(store.db, { now, remaining: 0 })).toBe(true);
    expect(await readHabitDayRow(store.db, TODAY)).toMatchObject({ full_met: 1 });
  });
});

describe("earn-back on grade (STR-17)", () => {
  it("restores the missed day after 3 recited days in the window", async () => {
    const lastDay = "2026-02-10";
    await seedDone(Array.from({ length: 8 }, (_, i) => addDays(lastDay, -7 + i)));
    // Return after the make-up cutoff two days later.
    expect((await reciteMinimum(addDays(lastDay, 2), 14 * 60)).wird.kind).toBe("minimum_met");
    expect((await reciteMinimum(addDays(lastDay, 3), 14 * 60)).wird.kind).toBe("minimum_met");
    const restored = await reciteMinimum(addDays(lastDay, 4), 14 * 60);
    expect(restored.wird).toEqual({ kind: "earned_back", length: 12, restoredDays: 1 });
    expect(await readHabitDayRow(store.db, addDays(lastDay, 1))).toMatchObject({ status: "earned_back" });
  });
});

describe("earn-back by full wird (STR-17, GOAL-04)", () => {
  it("restores the missed day when the second full wird is marked", async () => {
    const lastDay = "2026-02-10";
    await seedDone(Array.from({ length: 8 }, (_, i) => addDays(lastDay, -7 + i)));
    const first = addDays(lastDay, 2);
    const second = addDays(lastDay, 3);
    await reciteMinimum(first, 14 * 60);
    expect(await markFullWirdIfComplete(store.db, { now: atLocalTime(first, 15 * 60), remaining: 0 })).toBe(true);
    expect((await reciteMinimum(second, 14 * 60)).wird.kind).toBe("minimum_met");
    expect(await readHabitDayRow(store.db, addDays(lastDay, 1))).toBeNull();
    expect(await markFullWirdIfComplete(store.db, { now: atLocalTime(second, 15 * 60), remaining: 0 })).toBe(true);
    expect(await readHabitDayRow(store.db, addDays(lastDay, 1))).toMatchObject({ status: "earned_back" });
    const overview = await loadHabitOverview(store.db, { now: atLocalTime(second, 16 * 60) });
    expect(overview.streak.length).toBe(11);
  });
});

describe("recitation errors and the mistake inbox (ERR-01 to ERR-04)", () => {
  it("logs errors with the grade and resolves them after clean recalls on two later days", async () => {
    const session = startReviewSession("cards", { now: atLocalTime(TODAY, 590) });
    await grade("2:255", atLocalTime(TODAY, 600), Rating.Again, {
      session,
      supportLevel: 4,
      errors: [
        { type: "skip_word", corrected: "none", surah: 2, ayah: 255, word: 4 },
        { type: "wrong_word", corrected: "self", surah: 2, ayah: 255, word: 7 },
        { type: "tajweed", corrected: "none", surah: 2, ayah: 255, word: 9 },
      ],
    });
    expect(count("recitation_errors")).toBe(3);
    expect(await countMistakeInbox(store.db, TODAY)).toBe(1);
    expect(store.sql.prepare("SELECT error_count FROM study_log").get()).toEqual({ error_count: 3 });
    expect(await readReviewSession(store.db, session.id)).toMatchObject({ cards_reviewed: 1, errors: 3, local_date: TODAY });

    // A clean recall the same day does not count; two later days resolve it.
    await grade("2:255", atLocalTime(TODAY, 700), Rating.Good, { supportLevel: 4 });
    expect(await countMistakeInbox(store.db, TODAY)).toBe(1);
    await grade("2:255", atLocalTime(addDays(TODAY, 1), 600), Rating.Good, { supportLevel: 4 });
    await grade("2:255", atLocalTime(addDays(TODAY, 1), 700), Rating.Good, { supportLevel: 4 });
    expect((await readMistakeInbox(store.db, addDays(TODAY, 1)))[0]).toMatchObject({ cleanCount: 1 });
    // A recall with prompts does not count.
    await grade("2:255", atLocalTime(addDays(TODAY, 2), 600), Rating.Good, { supportLevel: 2 });
    expect(await countMistakeInbox(store.db, addDays(TODAY, 2))).toBe(1);
    const resolving = await grade("2:255", atLocalTime(addDays(TODAY, 2), 700), Rating.Easy, { supportLevel: 4 });
    expect(resolving.resolvedInboxItems).toBe(1);
    expect(await countMistakeInbox(store.db, addDays(TODAY, 2))).toBe(0);

    const ended = await endReviewSession(store.db, { session, now: atLocalTime(TODAY, 620) });
    expect(ended).toMatchObject({ ended_at: atLocalTime(TODAY, 620).toISOString(), duration_ms: 30 * 60_000 });
  });

  it("does not resolve an item from a recall with no support level or one recited in salah", async () => {
    await grade("2:255", atLocalTime(TODAY, 600), Rating.Again, {
      supportLevel: 4,
      errors: [{ type: "skip_word", corrected: "none", surah: 2, ayah: 255, word: 4 }],
    });
    await grade("2:255", atLocalTime(addDays(TODAY, 1), 600), Rating.Good, { supportLevel: null });
    await grade("2:255", atLocalTime(addDays(TODAY, 2), 600), Rating.Good, { supportLevel: null });
    await grade("2:255", atLocalTime(addDays(TODAY, 3), 600), Rating.Good, { supportLevel: 4, grader: "salah" });
    await grade("2:255", atLocalTime(addDays(TODAY, 4), 600), Rating.Good, { supportLevel: 4, grader: "salah" });
    expect(await countMistakeInbox(store.db, addDays(TODAY, 4))).toBe(1);
  });

  it("expires inbox items after 28 days", async () => {
    await grade("2:255", atLocalTime(TODAY, 600), Rating.Again, {
      errors: [{ type: "skip_ayah", corrected: "fath", surah: 2, ayah: 255, word: null }],
    });
    expect(await countMistakeInbox(store.db, addDays(TODAY, 28))).toBe(1);
    expect(await countMistakeInbox(store.db, addDays(TODAY, 29))).toBe(0);
  });
});

describe("reconciling wird days from the review log", () => {
  function insertLog(cardId: string, at: Date, grader: string | null) {
    store.sql
      .prepare(
        `INSERT INTO study_log (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at,
          local_date, grader) VALUES (?, 3, 2, ?, 1, 1, 0, 1, ?, ?, ?)`,
      )
      .run(cardId, at.toISOString(), at.toISOString(), localDateOf(at), grader);
  }

  it("raises a grace day to done when reviews from an older version prove it", async () => {
    const graced = { ...doneDay(addDays(TODAY, -1)), status: "grace" as const, earned_status: "grace" as const };
    await store.db.withTransactionAsync(async (tx) => {
      await putHabitDay(tx, graced);
    });
    insertLog("2:1", atLocalTime(addDays(TODAY, -1), 600), null);
    await store.db.withTransactionAsync(async (tx) => {
      await reconcileHabitDaysFromLogs(tx, { now: atLocalTime(TODAY, 600) });
    });
    expect(await readHabitDayRow(store.db, addDays(TODAY, -1))).toMatchObject({ status: "done", earned_status: "done" });
  });

  it("keeps the old any-review rule for reviews from older app versions and the minimum for newer ones", async () => {
    insertLog("2:1", atLocalTime(addDays(TODAY, -3), 600), null);
    insertLog("2:2", atLocalTime(addDays(TODAY, -2), 600), "self");
    insertLog("page:madani15:3", atLocalTime(addDays(TODAY, -1), 600), "self");
    const written = await store.db.withTransactionAsync(async (tx) => {
      await reconcileHabitDaysFromLogs(tx, { now: atLocalTime(TODAY, 600) });
    });
    expect(written).toBeUndefined();
    expect(await readHabitDayRow(store.db, addDays(TODAY, -3))).toMatchObject({ status: "done" });
    expect(await readHabitDayRow(store.db, addDays(TODAY, -2))).toBeNull();
    expect(await readHabitDayRow(store.db, addDays(TODAY, -1))).toMatchObject({ status: "done" });
  });
});

describe("SQL day tally (DAY_TALLY_SQL)", () => {
  const prefixes = ["page:madani15:", "chunk:", "half:", "seam:", "word:", "qiraat:", "asbab:", "2:", "similar:"];

  it("matches tallyReviews for any mix of cards and durations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            prefix: fc.constantFrom(...prefixes),
            n: fc.integer({ min: 1, max: 600 }),
            duration: fc.option(fc.integer({ min: -5_000, max: 30 * 60_000 }), { nil: null }),
          }),
          { maxLength: 40 },
        ),
        fc.boolean(),
        async (reviews, studyCounts) => {
          store.sql.prepare("DELETE FROM study_log").run();
          const insert = store.sql.prepare(
            `INSERT INTO study_log (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days,
              reviewed_at, local_date, duration_ms) VALUES (?, 3, 2, ?, 1, 1, 0, 1, ?, ?, ?)`,
          );
          const at = atLocalTime(TODAY, 600).toISOString();
          for (const review of reviews) insert.run(`${review.prefix}${review.n}`, at, at, TODAY, review.duration);
          const row = await store.db.getFirstAsync<{ page_units: number; counted_ms: number }>(DAY_TALLY_SQL, [
            studyCounts ? 1 : 0,
            TODAY,
          ]);
          const expected = tallyReviews(
            reviews.map((review) => ({ cardId: `${review.prefix}${review.n}`, durationMs: review.duration })),
            { studyCounts },
          );
          expect({ pageUnits: Number(row?.page_units), countedMs: Number(row?.counted_ms) }).toEqual(expected);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("make-up attribution on each review (STR-08)", () => {
  const yesterday = addDays(TODAY, -1);

  function insertLog(cardId: string, at: Date, makeupFor: string | null) {
    store.sql
      .prepare(
        `INSERT INTO study_log (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at,
          local_date, grader, makeup_for) VALUES (?, 3, 2, ?, 1, 1, 0, 1, ?, ?, 'self', ?)`,
      )
      .run(cardId, at.toISOString(), at.toISOString(), localDateOf(at), makeupFor);
  }
  async function reconcile(dates: string[]) {
    await store.db.withTransactionAsync(async (tx) => {
      await reconcileHabitDaysFromLogs(tx, { now: atLocalTime(TODAY, 14 * 60), dates: new Set(dates) });
    });
  }

  it("stores the missed day on reviews graded toward a make-up, and only until it is made up", async () => {
    await seedDone([addDays(TODAY, -3), addDays(TODAY, -2)]);
    await reciteMinimum(TODAY, 9 * 60);
    await grade("3:1", atLocalTime(TODAY, 9 * 60 + 30));
    const rows = store.sql.prepare("SELECT makeup_for FROM study_log ORDER BY reviewed_at").all() as { makeup_for: string | null }[];
    expect(rows.slice(0, 10).every((row) => row.makeup_for === yesterday)).toBe(true);
    expect(rows[10]).toEqual({ makeup_for: null });
  });

  it("credits reviews pulled from another device to the day they made up, never to today", async () => {
    await seedDone([addDays(TODAY, -3), addDays(TODAY, -2)]);
    for (let i = 0; i < 10; i += 1) insertLog(`2:${i + 1}`, atLocalTime(TODAY, 9 * 60 + i), yesterday);
    await reconcile([TODAY, yesterday]);
    expect(await readHabitDayRow(store.db, yesterday)).toMatchObject({ status: "made_up" });
    expect(await readHabitDayRow(store.db, TODAY)).toBeNull();
  });

  it("makes up a day from reviews two devices graded toward it together", async () => {
    await seedDone([addDays(TODAY, -3), addDays(TODAY, -2)]);
    insertLog("half:madani15:5:a", atLocalTime(TODAY, 9 * 60), yesterday);
    insertLog("half:madani15:5:b", atLocalTime(TODAY, 10 * 60), yesterday);
    await reconcile([TODAY, yesterday]);
    expect(await readHabitDayRow(store.db, yesterday)).toMatchObject({ status: "made_up" });
    expect(await readHabitDayRow(store.db, TODAY)).toBeNull();
  });

  it("keeps the reviews of an unfinished make-up off today after the cutoff", async () => {
    await seedDone([addDays(TODAY, -3), addDays(TODAY, -2)]);
    for (let i = 0; i < 5; i += 1) await grade(`2:${i + 1}`, atLocalTime(TODAY, 9 * 60 + i));
    for (let i = 0; i < 9; i += 1) {
      expect((await grade(`3:${i + 1}`, atLocalTime(TODAY, 13 * 60 + i))).wird).toEqual({ kind: "none" });
    }
    expect((await grade("3:10", atLocalTime(TODAY, 13 * 60 + 9))).wird).toEqual({ kind: "minimum_met", length: 1 });
    expect(await readHabitDayRow(store.db, yesterday)).toBeNull();
  });
});
