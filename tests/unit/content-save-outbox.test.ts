import { completeReflectionJourneyLevel, saveReflectionJourneyDraft } from "@/lib/reflection-journey/queries";
import { REFLECTION_JOURNEY_MIN_RESPONSE_CHARS } from "@/lib/reflection-journey/schema";
import { upsertUserWordMeaning } from "@/lib/word/queries";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const MEANING = { surah: 2, ayah: 255, wordPos: 1, word: "ٱللَّهُ", meaning: "synthetic meaning" };
const RESPONSE = "x".repeat(REFLECTION_JOURNEY_MIN_RESPONSE_CHARS);
let store: OutboxDatabase;

function count(table: string, where = "1 = 1") {
  return Number(store.sql.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get()?.count);
}

function meaning() {
  return store.sql
    .prepare("SELECT meaning FROM user_word_meanings WHERE surah = 2 AND ayah = 255 AND word_pos = 1")
    .get()?.meaning;
}

function entry() {
  return store.sql
    .prepare("SELECT status, response_text FROM reflection_journey_entries WHERE level_id = 'level-1'")
    .get();
}

beforeEach(async () => {
  store = await openOutboxDatabase();
  store.sql
    .prepare(
      `INSERT INTO reflection_journey_levels
        (id, slug, order_index, title_en, title_ar, response_prompt_en, response_prompt_ar, content_json)
       VALUES ('level-1', 'level-1', 1, 'Level 1', 'المستوى ١', 'Prompt', 'السؤال', '[]')`,
    )
    .run();
});

afterEach(async () => {
  await store.close();
});

describe("RF-176 word meanings, journey entries and their upload queue", () => {
  it("keeps the previous word meaning when its queue write fails, then saves and queues it", async () => {
    await upsertUserWordMeaning(store.db, MEANING);
    store.failQueueInsert(1);

    await expect(upsertUserWordMeaning(store.db, { ...MEANING, meaning: "edited meaning" })).rejects.toThrow(
      "Synthetic sync_queue write failure",
    );

    expect(meaning()).toBe("synthetic meaning");
    expect(count("sync_queue", "table_name = 'user_word_meanings'")).toBe(1);

    await upsertUserWordMeaning(store.db, { ...MEANING, meaning: "edited meaning" });

    expect(meaning()).toBe("edited meaning");
    expect(count("sync_queue", "table_name = 'user_word_meanings'")).toBe(2);
  });

  it("saves no journey draft when its queue write fails, then saves and queues it", async () => {
    store.failQueueInsert(1);

    await expect(saveReflectionJourneyDraft(store.db, "level-1", "draft text")).rejects.toThrow(
      "Synthetic sync_queue write failure",
    );

    expect(entry()).toBeUndefined();
    expect(count("sync_queue")).toBe(0);

    await expect(saveReflectionJourneyDraft(store.db, "level-1", "draft text")).resolves.toMatchObject({
      status: "draft",
    });

    expect(entry()).toEqual({ status: "draft", response_text: "draft text" });
    expect(count("sync_queue", "table_name = 'reflection_journey_entries'")).toBe(1);
  });

  it("keeps a journey draft when completing it cannot be queued", async () => {
    await saveReflectionJourneyDraft(store.db, "level-1", "draft text");
    store.failQueueInsert(1);

    await expect(completeReflectionJourneyLevel(store.db, "level-1", RESPONSE)).rejects.toThrow(
      "Synthetic sync_queue write failure",
    );

    expect(entry()).toEqual({ status: "draft", response_text: "draft text" });

    await completeReflectionJourneyLevel(store.db, "level-1", RESPONSE);

    expect(entry()).toEqual({ status: "completed", response_text: RESPONSE });
    expect(count("sync_queue", "table_name = 'reflection_journey_entries'")).toBe(2);
  });
});
