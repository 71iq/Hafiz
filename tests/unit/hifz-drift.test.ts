import { recordSessionProgress, startReviewSession } from "@/lib/fsrs/review-sessions";
import { setStudyCardMarked } from "@/lib/fsrs/queries";
import { Rating } from "@/lib/fsrs/scheduler";
import { addDays, atLocalTime } from "@/lib/habit/dates";
import { DRIFT_FOLLOW_UP_SESSIONS, loadDriftDrills, readMistakeInbox } from "@/lib/hifz/errors";
import type { PageToken } from "@/lib/hifz/page-data";
import { declareMemorizedPages, loadPageCards, loadTodayWird } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN, writeHifzPlan } from "@/lib/hifz/plan";
import { emptyAttempt, savePageGrade, type Attempt } from "@/lib/hifz/review";
import { pickDriftSibling, similarGroupsForAyahs } from "@/lib/hifz/similar";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/** SCH-07 and MUT-04: a drift into a similar verse, logged with its sibling and drilled in the next sessions. */

const TODAY = "2026-11-13";
const plan = { ...DEFAULT_HIFZ_PLAN, cycleDays: 30 };
let store: OutboxDatabase;

/** One group, 2:5 on page 2 and 31:5 on page 411, plus 2:6 alone on page 2 for a drift with no group. */
function seedSimilarVerses() {
  store.sql.exec(
    "INSERT INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES ('g1', 'similar', 'cue', 'test', 0)",
  );
  const refs = [
    [0, 2, 5, "البقرة", "أُو۟لَٰٓئِكَ", "عَلَىٰ هُدًى", "مِّن رَّبِّهِمْ", 2],
    [1, 31, 5, "لقمان", "أُو۟لَٰٓئِكَ", "عَلَىٰ هُدًى", "مِّن رَّبِّهِمْ", 411],
  ] as const;
  for (const [order, surah, ayah, name, pre, similar, post, page] of refs) {
    store.sql
      .prepare(
        "INSERT INTO mutashabihat_refs (group_id, sort_order, surah, ayah, surah_name_ar, pre_text, similar_text, post_text) VALUES ('g1', ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(order, surah, ayah, name, pre, similar, post);
    store.sql
      .prepare(
        "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (?, ?, 'x', 'x', 'x', ?)",
      )
      .run(surah, ayah, page);
  }
}

function token(ayah: number, wordPos: number): PageToken {
  return { glyph: `g${ayah}-${wordPos}`, surah: 2, ayah, wordPos, isMarker: false, firstLetter: "ب" };
}

function driftAttempt(ayah = 5): Attempt {
  return {
    ...emptyAttempt(4),
    marks: new Map([["drift", { token: token(ayah, 3), type: "mutashabih_drift" as const }]]),
  };
}

async function gradeDrift(now: Date, attempt = driftAttempt()) {
  const page = (await loadPageCards(store.db, { today: TODAY, plan })).find((card) => card.page === 2)!;
  return savePageGrade(store.db, {
    card: page.row,
    history: page.history,
    plan,
    attempt,
    rating: Rating.Again,
    firstToken: token(5, 1),
    session: startReviewSession("wird", { now: new Date(now.getTime() - 60_000) }),
    durationMs: 60_000,
    now,
  });
}

/** A later review session of `kind` that graded a card, so it has a row, as on any device. */
async function sessionAt(at: Date, kind: "wird" | "mistakes" | "sabaq" = "wird") {
  await store.db.withTransactionAsync(async (tx) => {
    await recordSessionProgress(tx, startReviewSession(kind, { now: at }), { cards: 1 }, at);
  });
}

const count = (sql: string) => Number(store.sql.prepare(sql).get()?.count);
const siblingRefs = () =>
  store.sql.prepare("SELECT sibling_ref FROM recitation_errors WHERE type = 'mutashabih_drift'").all();

beforeEach(async () => {
  store = await openOutboxDatabase();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  seedSimilarVerses();
  await declareMemorizedPages(store.db, { pages: [2, 411], cycleDays: 30, now: atLocalTime(addDays(TODAY, -1), 600) });
});
afterEach(async () => {
  await store.db.getFirstAsync("SELECT 1");
  await store.close();
  jest.restoreAllMocks();
});

describe("drift into a similar verse (SCH-07, MUT-04)", () => {
  it("logs the sibling, then drills its page in the next session and the pair in the next three", async () => {
    const card = await setStudyCardMarked(store.db, "default-mutashabihat", "mutashabihat:g1:1", false);
    store.sql.prepare("UPDATE study_cards SET due = ? WHERE id = ?").run("2027-01-01T00:00:00.000Z", card.id);
    const now = atLocalTime(TODAY, 600);
    await gradeDrift(now);

    expect(siblingRefs()).toEqual([{ sibling_ref: "31:5" }]);
    // What already worked stays: the pair's card comes due within a day, and the ayah keeps its drill.
    const due = String(store.sql.prepare("SELECT due FROM study_cards WHERE id = ?").get(card.id)?.due);
    expect(new Date(due).getTime()).toBeLessThanOrEqual(now.getTime() + 86_400_000);
    expect(await readMistakeInbox(store.db, TODAY)).toMatchObject([
      { surah: 2, ayah: 5, type: "mutashabih_drift", siblingRef: "31:5" },
    ]);

    const first = await loadDriftDrills(store.db, TODAY);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ siblingPage: 411, sessionsSince: 0 });
    expect(first[0].pair.self).toMatchObject({ surah: 2, ayah: 5, page: 2 });
    expect(first[0].pair.sibling).toMatchObject({ surah: 31, ayah: 5, page: 411, similar: "عَلَىٰ هُدًى" });

    // A sabaq session builds no drill list, so it uses up no follow-up.
    await sessionAt(new Date(now.getTime() + 30 * 60_000), "sabaq");
    expect(await loadDriftDrills(store.db, TODAY)).toMatchObject([{ siblingPage: 411, sessionsSince: 0 }]);

    for (let session = 1; session <= DRIFT_FOLLOW_UP_SESSIONS; session += 1) {
      await sessionAt(new Date(now.getTime() + session * 3_600_000), session === 2 ? "mistakes" : "wird");
      const drills = await loadDriftDrills(store.db, TODAY);
      if (session < DRIFT_FOLLOW_UP_SESSIONS) {
        // The sibling page was the first session's; the pair prompt stays for sessions 2 and 3.
        expect(drills).toMatchObject([{ siblingPage: null, sessionsSince: session }]);
      } else {
        // The fourth session adds neither.
        expect(drills).toEqual([]);
      }
    }
    // The ayah's own drill is untouched by the follow-ups ending.
    expect(await readMistakeInbox(store.db, TODAY)).toHaveLength(1);
  });

  it("keeps the day's list count when a sibling page outside it is reviewed (SCH-07)", async () => {
    await writeHifzPlan(store.db, plan);
    const now = atLocalTime(TODAY, 600);
    // Today's list holds page 2 only.
    store.sql
      .prepare("INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES ('device_hifz_today_plan', ?, ?, NULL)")
      .run(JSON.stringify({ date: TODAY, ids: ["page:madani15:2"], newLines: 0, unit: "page" }), now.toISOString());
    const sibling = (await loadPageCards(store.db, { today: TODAY, plan })).find((card) => card.page === 411)!;
    await savePageGrade(store.db, {
      card: sibling.row,
      history: sibling.history,
      plan,
      attempt: emptyAttempt(4),
      rating: Rating.Good,
      firstToken: token(5, 1),
      session: startReviewSession("mistakes", { now }),
      durationMs: 60_000,
      now,
    });
    const wird = (await loadTodayWird(store.db, new Date(now.getTime() + 60_000)))!;
    expect(wird.done).toEqual([]);
    expect(wird.total).toBe(1);
    expect(wird.todo.map((page) => page.page)).toEqual([2]);
  });

  it("orders drifts by instant, so a newer drift of the pair keeps its fresh follow-ups whatever the offsets", async () => {
    await gradeDrift(new Date("2026-11-13T08:00:00.000Z"));
    await sessionAt(new Date("2026-11-13T08:10:00.000Z"));
    await gradeDrift(new Date("2026-11-13T08:30:00.000Z"));
    // Synced with another offset, the older drift's text sorts after the newer one's.
    const ids = store.sql.prepare("SELECT id FROM recitation_errors WHERE type = 'mutashabih_drift' ORDER BY created_at").all() as { id: string }[];
    expect(ids).toHaveLength(2);
    store.sql.prepare("UPDATE recitation_errors SET created_at = ? WHERE id = ?").run("2026-11-13T10:00:00.000+02:00", ids[0].id);
    const drills = await loadDriftDrills(store.db, TODAY);
    expect(drills).toHaveLength(1);
    expect(drills[0]).toMatchObject({ errorId: ids[1].id, sessionsSince: 0, siblingPage: 411 });
  });

  it("commits the sibling with the grade, so a failed grade leaves no sibling and no drills", async () => {
    const now = atLocalTime(TODAY, 600);
    // Count the grade's queued uploads on a twin database, then fail the last of them: it comes after
    // the error row's, so the error was written inside the transaction before the failure.
    const twin = store;
    store = await openOutboxDatabase();
    seedSimilarVerses();
    await declareMemorizedPages(store.db, {
      pages: [2, 411],
      cycleDays: 30,
      now: atLocalTime(addDays(TODAY, -1), 600),
    });
    store.failQueueInsert(Number.MAX_SAFE_INTEGER);
    await gradeDrift(now);
    const uploads = store.queueInsertAttempts();
    await store.db.getFirstAsync("SELECT 1");
    await store.close();
    store = twin;

    const logsBefore = count("SELECT COUNT(*) AS count FROM study_log");
    store.failQueueInsert(uploads);
    await expect(gradeDrift(now)).rejects.toThrow("Synthetic sync_queue write failure");
    expect(count("SELECT COUNT(*) AS count FROM recitation_errors")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM study_log")).toBe(logsBefore);
    expect(await loadDriftDrills(store.db, TODAY)).toEqual([]);

    await gradeDrift(now);
    expect(siblingRefs()).toEqual([{ sibling_ref: "31:5" }]);
  });

  it("leaves a drift with no similar-verse group without a sibling or follow-ups", async () => {
    store.sql
      .prepare(
        "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (2, 6, 'x', 'x', 'x', 2)",
      )
      .run();
    await gradeDrift(atLocalTime(TODAY, 600), driftAttempt(6));
    expect(siblingRefs()).toEqual([{ sibling_ref: null }]);
    expect(await loadDriftDrills(store.db, TODAY)).toEqual([]);
  });

  it("drops the follow-ups of a drift dismissed as not a mistake", async () => {
    await gradeDrift(atLocalTime(TODAY, 600));
    store.sql
      .prepare("UPDATE recitation_errors SET deleted_at = ? WHERE type = 'mutashabih_drift'")
      .run(new Date().toISOString());
    expect(await loadDriftDrills(store.db, TODAY)).toEqual([]);
  });
});

describe("choosing the sibling a drift went into", () => {
  const ref = (surah: number, ayah: number, page: number) => ({
    surah,
    ayah,
    page,
    surahName: "",
    pre: "",
    similar: "",
    post: "",
  });
  const self = ref(2, 5, 2);
  const group = (id: string, siblings: ReturnType<typeof ref>[]) => ({
    groupId: id,
    kind: "similar" as const,
    self,
    siblings,
  });

  it("shows similar-verse text without the stray Latin full stop some bundled refs carry", async () => {
    store.sql.prepare("UPDATE mutashabihat_refs SET post_text = ? WHERE surah = 31 AND ayah = 5").run("مِّن رَّبِّهِمْ.");
    const [group] = await similarGroupsForAyahs(store.db, [{ surah: 2, ayah: 5 }]);
    expect(group.siblings[0].post).toBe("مِّن رَّبِّهِمْ");
  });

  it("prefers the memorized sibling on the most firmly held page, keeping the dataset's order on ties", () => {
    const groups = [group("a", [ref(31, 5, 411), ref(7, 52, 157)]), group("b", [ref(10, 57, 215)])];
    const memorized = new Set([411, 157, 215]);
    expect(
      pickDriftSibling(
        groups,
        memorized,
        new Map([
          [411, 4],
          [157, 30],
          [215, 12],
        ]),
      ),
    ).toMatchObject({ surah: 7, ayah: 52 });
    expect(pickDriftSibling(groups, memorized, new Map())).toMatchObject({ surah: 31, ayah: 5 });
    expect(pickDriftSibling(groups, new Set([215]), new Map([[411, 99]]))).toMatchObject({ surah: 10, ayah: 57 });
  });

  it("names a lone sibling even when unmemorized, and none of several unmemorized ones", async () => {
    const lone = await similarGroupsForAyahs(store.db, [{ surah: 2, ayah: 5 }]);
    expect(pickDriftSibling(lone, new Set(), new Map())).toMatchObject({ surah: 31, ayah: 5 });
    // The same sibling in two groups is still one sibling.
    expect(
      pickDriftSibling([group("a", [ref(31, 5, 411)]), group("b", [ref(31, 5, 411)])], new Set(), new Map()),
    ).toMatchObject({ surah: 31 });
    expect(pickDriftSibling([group("a", [ref(31, 5, 411), ref(7, 52, 157)])], new Set(), new Map())).toBeNull();
  });
});
