import { deleteStudyCardRow, insertNewStudyCard, putCardRow } from "@/lib/fsrs/queries";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/** A version stamped by a clock running two months ahead of this device. */
const AHEAD = "2027-01-15T10:00:00.000Z";
const NOW = new Date("2026-11-14T10:00:00.000Z");
const ID = "cloze:2:255:4";
let store: OutboxDatabase;

beforeEach(async () => {
  store = await openOutboxDatabase();
  await store.db.withTransactionAsync(async (tx) => {
    await insertNewStudyCard(tx, { id: ID, deckId: "hifz-pages", due: NOW, now: NOW.toISOString() });
  });
  store.sql.prepare("UPDATE study_cards SET updated_at = ? WHERE id = ?").run(AHEAD, ID);
});
afterEach(async () => {
  await store.db.getFirstAsync("SELECT 1");
  await store.close();
});

const row = () => store.sql.prepare("SELECT * FROM study_cards WHERE id = ?").get(ID) as unknown as StudyCardRow;
const lastUpload = () =>
  JSON.parse(
    (store.sql.prepare("SELECT data FROM sync_queue WHERE table_name = 'study_cards' AND row_id = ? ORDER BY id DESC LIMIT 1").get(ID) as {
      data: string;
    }).data,
  ) as { updated_at: string; reps: number; last_review: string | null };

describe("card version stamps", () => {
  it("stamps a grade after a version from a clock running ahead, keeping the real review time", async () => {
    const graded = { ...row(), reps: 1, last_review: NOW.toISOString(), updated_at: NOW.toISOString() };
    await store.db.withTransactionAsync(async (tx) => {
      await putCardRow(tx, graded);
    });
    expect(Date.parse(row().updated_at)).toBeGreaterThan(Date.parse(AHEAD));
    expect(row().last_review).toBe(NOW.toISOString());
    expect(lastUpload()).toMatchObject({ updated_at: row().updated_at, reps: 1, last_review: NOW.toISOString() });
  });

  it("keeps the grade's own time when nothing stored is newer", async () => {
    store.sql.prepare("UPDATE study_cards SET updated_at = ? WHERE id = ?").run("2026-11-14T09:00:00.000Z", ID);
    await store.db.withTransactionAsync(async (tx) => {
      await putCardRow(tx, { ...row(), reps: 1, updated_at: NOW.toISOString() });
    });
    expect(row().updated_at).toBe(NOW.toISOString());
  });

  it("stamps a card created again over a deletion from a clock running ahead after that deletion", async () => {
    store.sql.prepare("UPDATE study_cards SET deleted_at = ? WHERE id = ?").run(AHEAD, ID);
    let created = false;
    await store.db.withTransactionAsync(async (tx) => {
      created = await insertNewStudyCard(tx, { id: ID, deckId: "hifz-pages", due: NOW, now: NOW.toISOString() });
    });
    expect(created).toBe(true);
    expect(row().deleted_at).toBeNull();
    expect(Date.parse(row().updated_at)).toBeGreaterThan(Date.parse(AHEAD));
    expect(lastUpload().updated_at).toBe(row().updated_at);
  });

  it("stamps a deletion after the version it replaces", async () => {
    await store.db.withTransactionAsync(async (tx) => {
      await deleteStudyCardRow(tx, "hifz-pages", ID);
    });
    expect(Date.parse(row().deleted_at ?? "")).toBeGreaterThan(Date.parse(AHEAD));
    expect(lastUpload().updated_at).toBe(row().updated_at);
  });
});
