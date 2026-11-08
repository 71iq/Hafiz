import {
  createPrivateNote,
  deletePrivateNote,
  isDuplicatePrivateNoteError,
  updatePrivateNote,
} from "@/lib/notes/queries";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

// Notes import the QF queue module, which loads the Supabase client. No network is used here.
jest.mock("@/lib/auth/store", () => ({ useAuthStore: { getState: () => ({ user: null, session: null }) } }));
jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => false, supabase: {} }));

const NOTE = { surah: 2, ayahStart: 255, ayahEnd: 255, content: "synthetic reflection" };
let store: OutboxDatabase;

function count(table: string, where = "1 = 1") {
  return Number(store.sql.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get()?.count);
}

function noteContent(id: string) {
  return store.sql.prepare("SELECT content, deleted_at FROM private_notes WHERE id = ?").get(id);
}

/** Wait for detached post-commit work, such as the achievement event, to leave the owner queue. */
async function settle() {
  await store.db.getFirstAsync("SELECT 1");
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

describe("RF-174 private notes and their upload queues", () => {
  it.each(["sync_queue", "qf_sync_queue"] as const)(
    "saves no note when its %s write fails, then saves and queues it once on retry",
    async (table) => {
      store.failQueueInsert(1, table);

      await expect(createPrivateNote(store.db, NOTE)).rejects.toThrow(`Synthetic ${table} write failure`);

      expect(count("private_notes")).toBe(0);
      expect(count("sync_queue", "table_name = 'private_notes'")).toBe(0);
      expect(count("qf_sync_queue")).toBe(0);

      const note = await createPrivateNote(store.db, NOTE);
      await settle();

      expect(noteContent(note.id)).toEqual({ content: NOTE.content, deleted_at: null });
      expect(count("sync_queue", "table_name = 'private_notes'")).toBe(1);
      expect(count("qf_sync_queue")).toBe(1);
    },
  );

  it.each(["sync_queue", "qf_sync_queue"] as const)(
    "keeps the previous content when an edit's %s write fails",
    async (table) => {
      const note = await createPrivateNote(store.db, NOTE);
      await settle();
      store.failQueueInsert(1, table);

      await expect(updatePrivateNote(store.db, note.id, "edited reflection")).rejects.toThrow(
        `Synthetic ${table} write failure`,
      );

      expect(noteContent(note.id)).toEqual({ content: NOTE.content, deleted_at: null });
      expect(count("sync_queue", "table_name = 'private_notes' AND operation = 'UPDATE'")).toBe(0);
      expect(count("qf_sync_queue")).toBe(1);

      await updatePrivateNote(store.db, note.id, "edited reflection");

      expect(noteContent(note.id)).toEqual({ content: "edited reflection", deleted_at: null });
      expect(count("sync_queue", "table_name = 'private_notes' AND operation = 'UPDATE'")).toBe(1);
      expect(count("qf_sync_queue")).toBe(2);
    },
  );

  it.each(["sync_queue", "qf_sync_queue"] as const)(
    "keeps a note visible when its delete %s write fails, then deletes and queues it",
    async (table) => {
      const note = await createPrivateNote(store.db, NOTE);
      await settle();
      store.failQueueInsert(1, table);

      await expect(deletePrivateNote(store.db, note.id)).rejects.toThrow(`Synthetic ${table} write failure`);

      expect(noteContent(note.id)).toEqual({ content: NOTE.content, deleted_at: null });
      expect(count("sync_queue", "table_name = 'private_notes' AND operation = 'UPDATE'")).toBe(0);
      expect(count("qf_sync_queue", "operation = 'DELETE'")).toBe(0);

      await deletePrivateNote(store.db, note.id);

      expect(noteContent(note.id)?.deleted_at).toEqual(expect.any(String));
      expect(count("sync_queue", "table_name = 'private_notes' AND operation = 'UPDATE'")).toBe(1);
      expect(count("qf_sync_queue", "operation = 'DELETE'")).toBe(1);
    },
  );

  it("still rejects an exact duplicate note without writing anything", async () => {
    await createPrivateNote(store.db, NOTE);
    await settle();

    const duplicate = await createPrivateNote(store.db, { ...NOTE, content: ` ${NOTE.content} ` }).catch(
      (error: unknown) => error,
    );

    expect(isDuplicatePrivateNoteError(duplicate)).toBe(true);
    expect(count("private_notes")).toBe(1);
    expect(count("sync_queue", "table_name = 'private_notes'")).toBe(1);
    expect(count("qf_sync_queue")).toBe(1);
  });
});
