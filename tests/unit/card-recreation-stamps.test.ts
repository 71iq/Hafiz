import { addMeaningCard, deleteStudyCard, setStudyCardMarked, setStudyCardSuspended } from "@/lib/fsrs/queries";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const AHEAD = "2099-01-15T10:00:00.000Z";
let store: OutboxDatabase;

beforeEach(async () => {
  store = await openOutboxDatabase();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await store.close();
});

function seedDeletedCard(id: string, deckId: string, extra: { suspended?: string; buried?: string; marked?: string } = {}) {
  store.sql
    .prepare(
      `INSERT INTO study_cards
        (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
         last_review, suspended_at, buried_until, marked_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 3, 5, 0, 4, 0, 2, 0, 2, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      deckId,
      "2026-01-05T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      extra.suspended ?? null,
      extra.buried ?? null,
      extra.marked ?? null,
      "2026-01-01T00:00:00.000Z",
      AHEAD,
      AHEAD,
    );
}

function uploads(id: string) {
  return (
    store.sql
      .prepare("SELECT operation, data FROM sync_queue WHERE table_name = 'study_cards' AND row_id = ? ORDER BY id")
      .all(id) as { operation: string; data: string }[]
  ).map((row) => ({ operation: row.operation, data: JSON.parse(row.data) as Record<string, unknown> }));
}

describe("a card created again over a deletion from a clock running ahead", () => {
  it.each([
    ["marked", (id: string) => setStudyCardMarked(store.db, "smart-qiraat", id, true)],
    ["suspended", (id: string) => setStudyCardSuspended(store.db, "smart-qiraat", id, true)],
  ])("an action on a virtual card (%s) is stamped after the deletion, locally and in every upload", async (_label, act) => {
    seedDeletedCard("qiraat:2:1", "smart-qiraat");

    await act("qiraat:2:1");

    const row = store.sql.prepare("SELECT updated_at, deleted_at FROM study_cards WHERE id = 'qiraat:2:1'").get() as {
      updated_at: string;
      deleted_at: string | null;
    };
    expect(row.deleted_at).toBeNull();
    expect(Date.parse(row.updated_at)).toBeGreaterThan(Date.parse(AHEAD));
    const queued = uploads("qiraat:2:1");
    expect(queued.length).toBeGreaterThanOrEqual(2);
    for (const upload of queued) expect(Date.parse(String(upload.data.updated_at))).toBeGreaterThan(Date.parse(AHEAD));
    expect(queued[queued.length - 1].data.updated_at).toBe(row.updated_at);
  });

  it("does not stamp a brand-new virtual card into the future", async () => {
    const before = Date.now();
    await setStudyCardMarked(store.db, "smart-qiraat", "qiraat:2:2", true);
    const row = store.sql.prepare("SELECT updated_at FROM study_cards WHERE id = 'qiraat:2:2'").get() as { updated_at: string };
    expect(Date.parse(row.updated_at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(row.updated_at)).toBeLessThan(Date.parse(AHEAD));
  });
});

describe("a meaning card added again after it was deleted", () => {
  it("starts with no suspension, burial or mark, matching its queued upload", async () => {
    await addMeaningCard(store.db, 2, 255, 3);
    const { id } = store.sql.prepare("SELECT id FROM study_cards").get() as { id: string };
    await setStudyCardSuspended(store.db, "meanings", id, true, { requireLive: true });
    store.sql
      .prepare("UPDATE study_cards SET buried_until = ?, marked_at = ? WHERE id = ?")
      .run("2099-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", id);
    const deck = (store.sql.prepare("SELECT deck_id FROM study_cards WHERE id = ?").get(id) as { deck_id: string }).deck_id;
    await deleteStudyCard(store.db, deck, id);

    await expect(addMeaningCard(store.db, 2, 255, 3)).resolves.toEqual({ created: true });

    const row = store.sql
      .prepare("SELECT suspended_at, buried_until, marked_at, deleted_at FROM study_cards WHERE id = ?")
      .get(id) as Record<string, string | null>;
    expect(row).toEqual({ suspended_at: null, buried_until: null, marked_at: null, deleted_at: null });
    const last = uploads(id).at(-1)!;
    expect(last.operation).toBe("INSERT");
    expect(last.data).toMatchObject({ suspended_at: null, buried_until: null, marked_at: null, deleted_at: null });
  });
});
