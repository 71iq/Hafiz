import {
  completeReflectionJourneyLevel,
  getReflectionJourneySummary,
  listReflectionJourneyLevels,
  saveReflectionJourneyDraft,
} from "@/lib/reflection-journey/queries";
import {
  checkJourneyCompletion,
  isJourneyComplete,
  journeyNextLevelId,
  selectDefaultJourneyLevel,
} from "@/lib/reflection-journey/selection";
import type { ReflectionJourneyLevelStatus } from "@/lib/reflection-journey/types";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

let store: OutboxDatabase;

function insertLevel(id: string, order: number) {
  store.sql
    .prepare(
      `INSERT INTO reflection_journey_levels
        (id, slug, order_index, title_en, title_ar, response_prompt_en, response_prompt_ar, content_json)
       VALUES (?, ?, ?, ?, ?, 'Prompt', 'السؤال', '[]')`,
    )
    .run(id, id, order, `Level ${order}`, `المستوى ${order}`);
}

function row(levelId: string) {
  return store.sql
    .prepare("SELECT status, response_text, completed_at FROM reflection_journey_entries WHERE level_id = ?")
    .get(levelId) as { status: string; response_text: string; completed_at: string | null } | undefined;
}

function statuses(...values: ReflectionJourneyLevelStatus[]) {
  return values.map((status, index) => ({ id: `level-${index + 1}`, status }));
}

describe("Reflection Journey default selector and completion bounds", () => {
  it("prefers the first draft, then the first unfinished level, then the last completed level", () => {
    expect(selectDefaultJourneyLevel(statuses("completed", "available", "draft"))?.id).toBe("level-3");
    expect(selectDefaultJourneyLevel(statuses("completed", "available", "available"))?.id).toBe("level-2");
    expect(selectDefaultJourneyLevel(statuses("available", "completed", "available"))?.id).toBe("level-1");
    expect(selectDefaultJourneyLevel(statuses("completed", "completed", "completed"))?.id).toBe("level-3");
    expect(selectDefaultJourneyLevel([])).toBeNull();
  });

  it("marks Next only on an unfinished default without a draft", () => {
    expect(journeyNextLevelId(statuses("completed", "available", "available"))).toBe("level-2");
    expect(journeyNextLevelId(statuses("completed", "available", "draft"))).toBeNull();
    expect(journeyNextLevelId(statuses("completed", "completed"))).toBeNull();
    expect(journeyNextLevelId([])).toBeNull();
    expect(isJourneyComplete(statuses("completed", "completed"))).toBe(true);
    expect(isJourneyComplete(statuses("completed", "available"))).toBe(false);
    expect(isJourneyComplete([])).toBe(false);
  });

  it("requires 10 to 5000 trimmed characters to complete", () => {
    expect(checkJourneyCompletion("  123456789  ")).toEqual({ ok: false, reason: "short", length: 9, remaining: 1 });
    expect(checkJourneyCompletion(" 1234567890 ")).toEqual({ ok: true, length: 10 });
    expect(checkJourneyCompletion("x".repeat(5000))).toEqual({ ok: true, length: 5000 });
    expect(checkJourneyCompletion("x".repeat(5001))).toEqual({ ok: false, reason: "long", length: 5001, excess: 1 });
  });
});

describe("Reflection Journey queries without sequential locks", () => {
  beforeEach(async () => {
    store = await openOutboxDatabase();
    insertLevel("level-1", 1);
    insertLevel("level-2", 2);
    insertLevel("level-3", 3);
  });

  afterEach(async () => {
    await store.close();
  });

  it("opens every level and completes a later level without completing earlier ones", async () => {
    expect((await listReflectionJourneyLevels(store.db)).map((level) => level.status)).toEqual([
      "available",
      "available",
      "available",
    ]);

    await completeReflectionJourneyLevel(store.db, "level-3", "a later reflection");
    await saveReflectionJourneyDraft(store.db, "level-2", "short");

    const levels = await listReflectionJourneyLevels(store.db);
    expect(levels.map((level) => level.status)).toEqual(["available", "draft", "completed"]);
    expect(row("level-1")).toBeUndefined();
    expect(row("level-2")).toMatchObject({ status: "draft", response_text: "short" });

    const summary = await getReflectionJourneySummary(store.db);
    expect(summary).toMatchObject({ totalLevels: 3, completedLevels: 1, currentLevelId: "level-2" });
  });

  it("keeps a draft shorter than ten characters but refuses to complete it", async () => {
    await expect(saveReflectionJourneyDraft(store.db, "level-1", "tiny")).resolves.toMatchObject({ status: "draft" });
    await expect(completeReflectionJourneyLevel(store.db, "level-1", "tiny")).rejects.toThrow("at least 10");
    await expect(completeReflectionJourneyLevel(store.db, "level-1", "x".repeat(5001))).rejects.toThrow("5000");
    expect(row("level-1")).toMatchObject({ status: "draft", response_text: "tiny" });
  });

  it("keeps the completion timestamp when a completed response is edited", async () => {
    await completeReflectionJourneyLevel(store.db, "level-1", "first full reflection");
    const completedAt = row("level-1")?.completed_at;
    expect(completedAt).toBeTruthy();

    await completeReflectionJourneyLevel(store.db, "level-1", "an edited full reflection");
    expect(row("level-1")).toMatchObject({
      status: "completed",
      response_text: "an edited full reflection",
      completed_at: completedAt,
    });

    await expect(saveReflectionJourneyDraft(store.db, "level-1", "short")).rejects.toThrow("at least 10");
    expect(row("level-1")?.response_text).toBe("an edited full reflection");
  });
});
