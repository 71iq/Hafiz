import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import type { Session } from "@supabase/supabase-js";
import { observeAuthSession } from "@/lib/auth/commands";
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
let mockSession: Session | null = null;
const pageCounts = { bookmarks: 0, notes: 0 };

jest.mock("@/lib/auth/store", () => ({
  useAuthStore: { getState: () => ({ user: mockSession?.user ?? null, session: mockSession }) },
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: mockSession }, error: null }) },
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
  const userId = "00000000-0000-4000-8000-000000000001";
  const claims = Buffer.from(
    JSON.stringify({ sub: userId, session_id: "10000000-0000-4000-8000-000000000001" }),
  ).toString("base64url");
  mockSession = {
    user: { id: userId, aud: "authenticated", created_at: OLD, app_metadata: {}, user_metadata: {} },
    access_token: "e30." + claims + ".c2ln",
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
  };
  observeAuthSession(mockSession);
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
  mockSession = null;
  observeAuthSession(null);
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
  await expect(run("full")).resolves.toMatchObject({ status: "failed", pulled: 0 });
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

function linkedTarget(entity: Entity, id: unknown) {
  return entity === "bookmarks"
    ? { ...remoteBookmark, id, surah: 2, ayah: 255 }
    : { ...remoteNote, id, body: "Synthetic local note", ranges: ["2:255-2:255"] };
}
function linkNumericTargets() {
  sql.prepare("UPDATE bookmarks SET qf_bookmark_id='42' WHERE ayah=255").run();
  sql.prepare("UPDATE private_notes SET qf_note_id='42' WHERE id='local-note-tail'").run();
}
function expectLinkedTarget(entity: Entity) {
  expect(
    entity === "bookmarks"
      ? sql.prepare("SELECT deleted_at,qf_bookmark_id AS remote_id FROM bookmarks WHERE ayah=255").get()
      : sql.prepare("SELECT deleted_at,qf_note_id AS remote_id FROM private_notes WHERE id='local-note-tail'").get(),
  ).toEqual({ deleted_at: null, remote_id: "42" });
}

it.each(
  modes.flatMap((mode) => entities.flatMap((entity) => [1, 2].map((invalidPage) => ({ mode, entity, invalidPage })))),
)(
  "preserves the numeric-ID target for $entity page$invalidPage during $mode sync",
  async ({ mode, entity, invalidPage }) => {
    prepare(mode);
    linkNumericTargets();
    const before = snapshot();
    mockPage = (kind, index) =>
      kind !== entity
        ? page(kind)
        : index < invalidPage
          ? page(kind, "next")
          : { ok: true, [kind]: [kind === "bookmarks" ? remoteBookmark : remoteNote, linkedTarget(kind, 42)] };
    let failure: unknown;
    try {
      await run(mode);
    } catch (error) {
      failure = error;
    }
    expectLinkedTarget(entity);
    expect(failure).toEqual(
      expect.objectContaining({ message: expect.stringContaining("Incomplete Quran Foundation") }),
    );
    expect(transactions).toBe(0);
    expect(snapshot()).toEqual(before);
    expect(pageCounts[entity]).toBe(invalidPage);
  },
);

it.each(entities)("keeps a valid string-ID target present in a complete %s list", async (entity) => {
  prepare("full");
  linkNumericTargets();
  mockPage = (kind) => (kind === entity ? { ok: true, [kind]: [linkedTarget(kind, "42")] } : page(kind));
  await expect(run("full")).resolves.toMatchObject({ status: "synced" });
  expectLinkedTarget(entity);
  expect(transactions).toBe(1);
});

it.each([
  { label: "empty ranges", ranges: [], expectedContent: "Synthetic local note" },
  { label: "unsupported string ranges", ranges: ["unsupported range"], expectedContent: "Synthetic local note" },
  { label: "short nonblank body", ranges: ["2:255-2:255"], expectedContent: "x" },
])("keeps a linked note present with $label", async ({ ranges, expectedContent }) => {
  prepare("full");
  linkNumericTargets();
  mockPage = (kind) =>
    kind === "notes"
      ? {
          ok: true,
          notes: [{ ...linkedTarget("notes", "42"), body: "x", ranges, updatedAt: "2026-02-01T00:00:00.000Z" }],
        }
      : page(kind);
  await expect(run("full")).resolves.toMatchObject({ status: "synced" });
  expectLinkedTarget("notes");
  expect(sql.prepare("SELECT content FROM private_notes WHERE id='local-note-tail'").get()).toEqual({
    content: expectedContent,
  });
});

it.each(
  entities.flatMap((entity) =>
    [
      { label: "null row", rows: [null] },
      { label: "invalid row", rows: [{}] },
      { label: "sparse array", rows: new Array(1) },
    ].map((value) => ({ entity, ...value })),
  ),
)("rejects $entity $label before reconciliation", async ({ entity, rows }) => {
  prepare("full");
  const before = snapshot();
  mockPage = (kind) => (kind === entity ? { ok: true, [kind]: rows } : page(kind));
  await expect(run("full")).rejects.toThrow("Incomplete Quran Foundation");
  expect(transactions).toBe(0);
  expect(snapshot()).toEqual(before);
});

type QueueAbortCase = {
  name: string;
  mode: Mode;
  tableName: "bookmarks" | "private_notes";
  rowId: string;
  seed?: () => void;
  remoteBookmarks: (typeof remoteBookmark)[];
  remoteNotes: (typeof remoteNote)[];
};

const prefixBookmark = { ...remoteBookmark, id: "remote-bookmark-prefix-success", ayah: 254 };
const secondBookmark = { ...remoteBookmark, id: "remote-bookmark-abort", ayah: 257 };
const prefixNote = { ...remoteNote, id: "remote-note-prefix-success", ranges: ["2:254-2:254"] };
const secondNote = { ...remoteNote, id: "remote-note-abort", ranges: ["2:257-2:257"] };
const queueAbortCases: QueueAbortCase[] = [
  {
    name: "new bookmark after a successful insert",
    mode: "full",
    tableName: "bookmarks",
    rowId: "2:257",
    remoteBookmarks: [prefixBookmark, secondBookmark],
    remoteNotes: [],
  },
  {
    name: "attached bookmark after a successful insert",
    mode: "full",
    tableName: "bookmarks",
    rowId: "2:257",
    seed: () => {
      sql.prepare("INSERT INTO bookmarks (surah,ayah,created_at,updated_at) VALUES (2,257,?,?)").run(OLD, OLD);
    },
    remoteBookmarks: [prefixBookmark, secondBookmark],
    remoteNotes: [],
  },
  {
    name: "missing-bookmark tombstone after a successful insert",
    mode: "full",
    tableName: "bookmarks",
    rowId: "2:255",
    remoteBookmarks: [prefixBookmark],
    remoteNotes: [],
  },
  {
    name: "new note after a successful insert",
    mode: "full",
    tableName: "private_notes",
    rowId: "qf:remote-note-abort",
    remoteBookmarks: [],
    remoteNotes: [prefixNote, secondNote],
  },
  {
    name: "updated linked note after a successful insert",
    mode: "full",
    tableName: "private_notes",
    rowId: "linked-note",
    seed: () => {
      sql
        .prepare(
          "INSERT INTO private_notes (id,surah,ayah_start,ayah_end,content,created_at,updated_at,qf_note_id) VALUES ('linked-note',2,255,255,'Older linked text',?,?,'remote-note-abort')",
        )
        .run(OLD, OLD);
    },
    remoteBookmarks: [],
    remoteNotes: [prefixNote, { ...secondNote, updatedAt: "2026-02-01T00:00:00.000Z" }],
  },
  {
    name: "attached exact note after a successful insert",
    mode: "full",
    tableName: "private_notes",
    rowId: "attached-note",
    seed: () => {
      sql
        .prepare(
          "INSERT INTO private_notes (id,surah,ayah_start,ayah_end,content,created_at,updated_at) VALUES ('attached-note',2,257,257,?,?,?)",
        )
        .run(secondNote.body, OLD, OLD);
    },
    remoteBookmarks: [],
    remoteNotes: [prefixNote, secondNote],
  },
  {
    name: "duplicate-note tombstone after a successful insert",
    mode: "full",
    tableName: "private_notes",
    rowId: "linked-note",
    seed: () => {
      sql
        .prepare(
          "INSERT INTO private_notes (id,surah,ayah_start,ayah_end,content,created_at,updated_at,qf_note_id) VALUES ('linked-note',2,255,255,'Older linked text',?,?,'remote-note-abort')",
        )
        .run(OLD, OLD);
      sql
        .prepare(
          "INSERT INTO private_notes (id,surah,ayah_start,ayah_end,content,created_at,updated_at) VALUES ('duplicate-note',2,257,257,?,?,?)",
        )
        .run(secondNote.body, OLD, OLD);
    },
    remoteBookmarks: [],
    remoteNotes: [prefixNote, { ...secondNote, updatedAt: "2026-02-01T00:00:00.000Z" }],
  },
  {
    name: "missing-note tombstone after a successful insert",
    mode: "full",
    tableName: "private_notes",
    rowId: "local-note-tail",
    remoteBookmarks: [],
    remoteNotes: [prefixNote],
  },
  {
    name: "first initial-pull bookmark propagation failure",
    mode: "initial",
    tableName: "bookmarks",
    rowId: "2:257",
    remoteBookmarks: [prefixBookmark, secondBookmark],
    remoteNotes: [],
  },
];

it.each(queueAbortCases)(
  "rolls back $name when the main-sync queue aborts during $mode reconciliation",
  async ({ mode, tableName, rowId, seed, remoteBookmarks, remoteNotes }) => {
    prepare(mode);
    sql.prepare("INSERT OR REPLACE INTO user_settings (key,value) VALUES ('qf_last_sync_at','prior-success')").run();
    seed?.();
    mockPage = (entity) =>
      entity === "bookmarks"
        ? { ok: true, bookmarks: remoteBookmarks, nextCursor: null }
        : { ok: true, notes: remoteNotes, nextCursor: null };
    const before = snapshot();
    sql.exec(`
      CREATE TEMP TRIGGER fail_main_sync_queue
      BEFORE INSERT ON sync_queue
      WHEN NEW.table_name = '${tableName}' AND NEW.row_id = '${rowId}'
      BEGIN SELECT RAISE(ABORT, 'RF158 sync_queue insert aborted'); END;
    `);

    const outcome = await run(mode).then(
      (value) => ({ kind: "resolved" as const, value }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    );
    const after = snapshot();

    expect({ outcome, after }).toEqual({
      outcome: {
        kind: "rejected",
        error: expect.objectContaining({ message: expect.stringContaining("RF158 sync_queue insert aborted") }),
      },
      after: before,
    });
    if (mode === "initial") {
      expect(
        sql.prepare("SELECT value FROM user_settings WHERE key='qf_initial_local_enqueue_done'").get(),
      ).toBeUndefined();
    } else {
      expect(sql.prepare("SELECT value FROM user_settings WHERE key='qf_last_sync_at'").get()).toEqual({
        value: "prior-success",
      });
    }

    sql.exec("DROP TRIGGER fail_main_sync_queue");
    await expect(run(mode)).resolves.toMatchObject({ status: "synced" });
    expect(
      sql
        .prepare("SELECT table_name,operation,row_id,status FROM sync_queue WHERE table_name = ? AND row_id = ?")
        .get(tableName, rowId),
    ).toMatchObject({
      table_name: tableName,
      operation: expect.stringMatching(/^(INSERT|UPDATE)$/),
      row_id: rowId,
      status: "pending",
    });
    if (mode === "initial") {
      expect(sql.prepare("SELECT value FROM user_settings WHERE key='qf_initial_local_enqueue_done'").get()).toEqual({
        value: "true",
      });
    }

    const targetQueue = sql
      .prepare("SELECT data,status FROM sync_queue WHERE table_name = ? AND row_id = ?")
      .get(tableName, rowId) as { data: string; status: string } | undefined;
    expect(targetQueue?.status).toBe("pending");
    const queuedPayload = JSON.parse(targetQueue?.data ?? "null") as Record<string, unknown>;
    if (tableName === "bookmarks") {
      const ayah = Number(rowId.split(":")[1]);
      const row = sql
        .prepare(
          "SELECT surah,ayah,created_at,updated_at,deleted_at,qf_bookmark_id FROM bookmarks WHERE surah=2 AND ayah=?",
        )
        .get(ayah) as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(queuedPayload).toMatchObject(row ?? {});
    } else {
      const row = sql
        .prepare(
          "SELECT id,surah,ayah_start,ayah_end,content,created_at,updated_at,deleted_at,qf_note_id FROM private_notes WHERE id=?",
        )
        .get(rowId) as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(queuedPayload).toMatchObject(row ?? {});
    }
  },
);
