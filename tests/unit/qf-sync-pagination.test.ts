import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import { createSchema } from "@/lib/database/schema";
import { fullQfUserSync, runInitialQfUserSync } from "@/lib/quran-foundation/user-sync";
import type { QfUserAction } from "@/lib/quran-foundation/user-types";

const OLD = "2026-01-01T00:00:00.000Z";
type Entity = "bookmarks" | "notes";
type Mode = "full" | "initial";
const remoteBookmark = {
  id: "remote-bookmark-prefix",
  surah: 2,
  ayah: 256,
  type: "ayah",
  createdAt: OLD,
  isInDefaultCollection: false,
  collectionsCount: 0,
};
const remoteNote = {
  id: "remote-note-prefix",
  body: "Synthetic remote note",
  ranges: ["2:256-2:256"],
  createdAt: OLD,
  updatedAt: OLD,
};
const requests: QfUserAction[] = [];
let mockPage: (entity: Entity, page: number) => unknown;
const pageCounts = { bookmarks: 0, notes: 0 };

jest.mock("@/lib/auth/store", () => ({
  useAuthStore: { getState: () => ({ user: { id: "synthetic-user" } }) },
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    functions: {
      invoke: async (_name: string, options: { body: QfUserAction }) => {
        const action = options.body;
        requests.push(action);
        if (action.action === "status") return { data: { ok: true, status: "connected" }, error: null };
        if (action.action === "list-bookmarks" || action.action === "list-notes") {
          const entity = action.action === "list-bookmarks" ? "bookmarks" : "notes";
          pageCounts[entity] += 1;
          return { data: mockPage(entity, pageCounts[entity]), error: null };
        }
        throw new Error("Unexpected synthetic action: " + action.action);
      },
    },
  },
}));

let sql: DatabaseSync;
let db: SQLiteDatabase;
let transactions: number;
function page(entity: Entity, nextCursor?: unknown, includePrefix = true) {
  return {
    ok: true,
    [entity]: includePrefix ? [entity === "bookmarks" ? remoteBookmark : remoteNote] : [],
    nextCursor,
  };
}
function prepare(mode: Mode) {
  if (mode === "full")
    sql.prepare("INSERT INTO user_settings (key,value) VALUES ('qf_initial_local_enqueue_done','true')").run();
}
function run(mode: Mode) {
  return mode === "full" ? fullQfUserSync(db) : runInitialQfUserSync(db);
}
function snapshot() {
  return {
    bookmarks: sql.prepare("SELECT * FROM bookmarks ORDER BY surah,ayah").all(),
    notes: sql.prepare("SELECT * FROM private_notes ORDER BY id").all(),
    settings: sql.prepare("SELECT * FROM user_settings ORDER BY key").all(),
    supabaseQueue: sql.prepare("SELECT * FROM sync_queue ORDER BY id").all(),
    qfQueue: sql.prepare("SELECT * FROM qf_sync_queue ORDER BY id").all(),
  };
}
beforeEach(async () => {
  requests.length = 0;
  pageCounts.bookmarks = 0;
  pageCounts.notes = 0;
  mockPage = (entity) => page(entity);
  transactions = 0;
  sql = new DatabaseSync(":memory:");
  const adapter = {
    execAsync: async (source: string) => {
      sql.exec(source);
    },
    getFirstAsync: async (source: string, params: SQLInputValue[] = []) => sql.prepare(source).get(...params) ?? null,
    getAllAsync: async (source: string, params: SQLInputValue[] = []) => sql.prepare(source).all(...params),
    runAsync: async (source: string, params: SQLInputValue[] = []) => sql.prepare(source).run(...params),
    withTransactionAsync: async (work: () => Promise<void>) => {
      transactions += 1;
      sql.exec("BEGIN");
      try {
        await work();
        sql.exec("COMMIT");
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  // Only this fixture adapts Expo's wider API to a real isolated SQLite database.
  db = adapter as unknown as SQLiteDatabase;
  await createSchema(db);
  sql
    .prepare(
      "INSERT INTO bookmarks (surah,ayah,created_at,updated_at,qf_bookmark_id) VALUES (2,255,?,?,'remote-bookmark-tail')",
    )
    .run(OLD, OLD);
  sql
    .prepare(
      "INSERT INTO private_notes (id,surah,ayah_start,ayah_end,content,created_at,updated_at,qf_note_id) VALUES ('local-note-tail',2,255,255,'Synthetic local note',?,?,'remote-note-tail')",
    )
    .run(OLD, OLD);
});
afterEach(() => {
  sql.close();
});

const modes: Mode[] = ["full", "initial"];
const entities: Entity[] = ["bookmarks", "notes"];
it.each(modes.flatMap((mode) => entities.map((entity) => ({ mode, entity }))))(
  "preserves all local data when $entity still has a cursor after page20 during $mode sync",
  async ({ mode, entity }) => {
    prepare(mode);
    const before = snapshot();
    mockPage = (kind, index) => page(kind, kind === entity ? "next-" + index : undefined, index === 1);
    let failure: unknown;
    try {
      await run(mode);
    } catch (error) {
      failure = error;
    }
    expect(snapshot()).toEqual(before);
    expect(failure).toEqual(
      expect.objectContaining({ message: expect.stringContaining("Incomplete Quran Foundation") }),
    );
    expect(pageCounts[entity]).toBe(20);
    expect(pageCounts[entity === "bookmarks" ? "notes" : "bookmarks"]).toBe(1);
    expect(transactions).toBe(0);
    expect(snapshot()).toEqual(before);
    const continuation = requests.filter((action) => action.action === "list-" + entity);
    expect(continuation).toHaveLength(20);
    expect(continuation[19]).toMatchObject(entity === "bookmarks" ? { after: "next-19" } : { cursor: "next-19" });
  },
);

it.each(
  modes.flatMap((mode) => entities.flatMap((entity) => [1, 2].map((invalidPage) => ({ mode, entity, invalidPage })))),
)(
  "rejects a wrong success variant for $entity page$invalidPage during $mode sync before applying either collection",
  async ({ mode, entity, invalidPage }) => {
    prepare(mode);
    const before = snapshot();
    mockPage = (kind, index) =>
      kind !== entity ? page(kind) : index === invalidPage ? { ok: true, status: "connected" } : page(kind, "next");
    await expect(run(mode)).rejects.toThrow("Incomplete Quran Foundation");
    expect(transactions).toBe(0);
    expect(snapshot()).toEqual(before);
  },
);

it.each(entities.flatMap((entity) => [null, {}, "not-an-array"].map((value) => ({ entity, value }))))(
  "rejects a non-array $entity collection: $value",
  async ({ entity, value }) => {
    prepare("full");
    const before = snapshot();
    mockPage = (kind) => (kind === entity ? { ok: true, [kind]: value } : page(kind));
    await expect(run("full")).rejects.toThrow("Incomplete Quran Foundation");
    expect(transactions).toBe(0);
    expect(snapshot()).toEqual(before);
  },
);

it.each(entities.flatMap((entity) => [false, 0, true, {}].map((cursor) => ({ entity, cursor }))))(
  "rejects an invalid $entity cursor: $cursor",
  async ({ entity, cursor }) => {
    prepare("full");
    const before = snapshot();
    mockPage = (kind) => page(kind, kind === entity ? cursor : undefined);
    await expect(run("full")).rejects.toThrow("Incomplete Quran Foundation");
    expect(transactions).toBe(0);
    expect(snapshot()).toEqual(before);
  },
);

it.each([undefined, null, ""])("accepts a complete snapshot with terminal cursor %s", async (cursor) => {
  prepare("full");
  mockPage = (kind) => page(kind, cursor);
  await expect(run("full")).resolves.toMatchObject({ status: "synced", pulled: 2 });
  expect(transactions).toBe(1);
  expect(sql.prepare("SELECT qf_bookmark_id FROM bookmarks WHERE ayah=256").get()).toEqual({
    qf_bookmark_id: remoteBookmark.id,
  });
  expect(sql.prepare("SELECT qf_note_id FROM private_notes WHERE id='qf:remote-note-prefix'").get()).toEqual({
    qf_note_id: remoteNote.id,
  });
  expect(sql.prepare("SELECT deleted_at FROM bookmarks WHERE ayah=255").get()).toMatchObject({
    deleted_at: expect.any(String),
  });
  expect(sql.prepare("SELECT deleted_at FROM private_notes WHERE id='local-note-tail'").get()).toMatchObject({
    deleted_at: expect.any(String),
  });
});

it.each(entities)("accepts %s that completes exactly on page20", async (entity) => {
  prepare("full");
  mockPage = (kind, index) => page(kind, kind === entity && index < 20 ? "next-" + index : null, index === 1);
  await expect(run("full")).resolves.toMatchObject({ status: "synced", pulled: 2 });
  expect(pageCounts[entity]).toBe(20);
  expect(transactions).toBe(1);
  expect(sql.prepare("SELECT deleted_at FROM bookmarks WHERE ayah=256").get()).toEqual({ deleted_at: null });
  expect(sql.prepare("SELECT deleted_at FROM private_notes WHERE id='qf:remote-note-prefix'").get()).toEqual({
    deleted_at: null,
  });
});

it("still applies legitimate deletions from complete empty snapshots", async () => {
  prepare("full");
  mockPage = (kind) => page(kind, null, false);
  await expect(run("full")).resolves.toMatchObject({ status: "synced", pulled: 0 });
  expect(transactions).toBe(1);
  expect(sql.prepare("SELECT deleted_at FROM bookmarks WHERE ayah=255").get()).toMatchObject({
    deleted_at: expect.any(String),
  });
  expect(sql.prepare("SELECT deleted_at FROM private_notes WHERE id='local-note-tail'").get()).toMatchObject({
    deleted_at: expect.any(String),
  });
  expect(sql.prepare("SELECT COUNT(*) AS count FROM sync_queue").get()).toEqual({ count: 2 });
});

it.each(entities)(
  "preserves the original remote error for %s without reconciling either collection",
  async (entity) => {
    prepare("full");
    const before = snapshot();
    mockPage = (kind, index) =>
      kind !== entity
        ? page(kind)
        : index === 1
          ? page(kind, "next")
          : { ok: false, code: "upstream", message: "Synthetic remote outage" };
    await expect(run("full")).rejects.toThrow("Synthetic remote outage");
    expect(transactions).toBe(0);
    expect(snapshot()).toEqual(before);
  },
);

it.each(entities)("keeps pending local %s protected in a complete empty snapshot", async (entity) => {
  prepare("full");
  sql
    .prepare(
      "INSERT INTO qf_sync_queue (entity_type,operation,local_id,data,status,attempt_count,created_at,updated_at) VALUES (?,?,?,'{}','failed',5,?,?)",
    )
    .run(
      entity === "bookmarks" ? "bookmark" : "private_note",
      "UPSERT",
      entity === "bookmarks" ? "2:255" : "local-note-tail",
      OLD,
      OLD,
    );
  const before = snapshot();
  mockPage = (kind) => page(kind, null, false);
  await expect(run("full")).resolves.toMatchObject({ status: "synced", pulled: 0 });
  const after = snapshot();
  expect(entity === "bookmarks" ? after.bookmarks : after.notes).toEqual(
    entity === "bookmarks" ? before.bookmarks : before.notes,
  );
  expect(after.qfQueue).toEqual(before.qfQueue);
  expect(after.supabaseQueue).toHaveLength(1);
});

it("completes valid initial empty reconciliation before publishing its initial-enqueue marker", async () => {
  mockPage = (kind) => page(kind, null, false);
  await expect(run("initial")).resolves.toMatchObject({ status: "synced", pushed: 0, pulled: 0 });
  expect(transactions).toBe(2);
  expect(pageCounts).toEqual({ bookmarks: 2, notes: 2 });
  expect(sql.prepare("SELECT value FROM user_settings WHERE key='qf_initial_local_enqueue_done'").get()).toEqual({
    value: "true",
  });
});
