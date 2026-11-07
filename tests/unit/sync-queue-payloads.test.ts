import * as fc from "fast-check";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Session } from "@supabase/supabase-js";
import type { SQLiteDatabase } from "expo-sqlite";
import { observeAuthSession } from "@/lib/auth/commands";
import { createSchema } from "@/lib/database/schema";
import { fullSync } from "@/lib/database/sync";
import { enqueueSync, getPendingSyncEntries } from "@/lib/database/sync-queue";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const OLD = "2026-01-01T00:00:00.000Z";
const NEW = "2026-02-01T00:00:00.000Z";

type RemoteFilter = [column: string, value: unknown];
type RemoteWrite = {
  table: string;
  kind: "upsert" | "insert" | "delete";
  row?: Record<string, unknown>;
  filters: RemoteFilter[];
  onConflict?: string;
};

type RawQueueEntry = {
  tableName: string;
  operation: string;
  rowId: string;
  data: string;
};

let mockSession: Session | null = null;
let mockProbeData: unknown = [];
let mockExistingLog: unknown = null;
const remoteWrites: RemoteWrite[] = [];

class MockQuery {
  private readonly filters: RemoteFilter[] = [];
  private writeKind: "delete" | null = null;

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  gt() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  async range() {
    return { data: [], error: null };
  }

  async maybeSingle() {
    return { data: mockExistingLog, error: null };
  }

  async upsert(row: Record<string, unknown>, options: { onConflict: string }) {
    remoteWrites.push({
      table: this.table,
      kind: "upsert",
      row: { ...row },
      filters: [...this.filters],
      onConflict: options.onConflict,
    });
    return { error: null };
  }

  async insert(row: Record<string, unknown>) {
    remoteWrites.push({ table: this.table, kind: "insert", row: { ...row }, filters: [...this.filters] });
    return { error: null };
  }

  delete() {
    this.writeKind = "delete";
    return this;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.writeKind === "delete") {
      remoteWrites.push({ table: this.table, kind: "delete", filters: [...this.filters] });
    }
    const response: { data: unknown; error: null } = {
      data: this.writeKind === "delete" ? null : mockProbeData,
      error: null,
    };
    return Promise.resolve(response).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

jest.mock("@/lib/auth/store", () => ({
  useAuthStore: { getState: () => ({ user: mockSession?.user ?? null, session: mockSession }) },
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { from: (table: string) => new MockQuery(table) },
}));
jest.mock("@/lib/achievements/queries", () => ({
  backfillAchievements: jest.fn(async () => 0),
  insertRemoteAchievementUnlock: jest.fn(),
}));

let sql: DatabaseSync;
let db: SQLiteDatabase;

function seedSession() {
  const payload = Buffer.from(
    JSON.stringify({ sub: USER_ID, session_id: "10000000-0000-4000-8000-000000000001" }),
  ).toString("base64url");
  mockSession = {
    user: { id: USER_ID, aud: "authenticated", created_at: OLD, app_metadata: {}, user_metadata: {} },
    access_token: `e30.${payload}.c2ln`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
  };
  observeAuthSession(mockSession);
}

function note(id = "queued-note") {
  return {
    id,
    surah: 2,
    ayah_start: 255,
    ayah_end: 255,
    content: `synthetic note ${id}`,
    created_at: OLD,
    updated_at: NEW,
    deleted_at: null,
  };
}

function card(id = "qiraat:2:255") {
  return {
    id,
    deck_id: "synthetic-deck",
    due: NEW,
    stability: 5,
    difficulty: 4,
    elapsed_days: 1,
    scheduled_days: 1,
    learning_steps: 0,
    reps: 1,
    lapses: 0,
    state: 2,
    last_review: OLD,
    suspended_at: null,
    buried_until: null,
    marked_at: null,
    created_at: OLD,
    updated_at: NEW,
    deleted_at: null,
  };
}

function bookmark() {
  return { surah: 2, ayah: 255, created_at: OLD, updated_at: NEW, deleted_at: null };
}

function wordMeaning() {
  return {
    surah: 2,
    ayah: 255,
    word_pos: 1,
    word: "synthetic",
    meaning: "synthetic meaning",
    created_at: OLD,
    updated_at: NEW,
  };
}

function studyLog(cardId = "qiraat:2:255", reviewedAt = NEW) {
  return {
    card_id: cardId,
    rating: 3,
    state: 2,
    due: NEW,
    stability: 5,
    difficulty: 4,
    elapsed_days: 1,
    scheduled_days: 1,
    reviewed_at: reviewedAt,
  };
}

function seedRawQueueEntry(entry: RawQueueEntry): number {
  const result = sql
    .prepare(
      `INSERT INTO sync_queue (table_name,operation,row_id,data,status,created_at)
       VALUES (?,?,?,?,'pending',?)`,
    )
    .run(entry.tableName, entry.operation, entry.rowId, entry.data, OLD);
  return Number(result.lastInsertRowid);
}

async function seedValidNeighbor(preferCard: boolean): Promise<number> {
  if (preferCard)
    return enqueueSync(db, "study_cards", "UPDATE", "qiraat:2:255", card()).then(async () => {
      const entry = await db.getFirstAsync<{ id: number }>("SELECT id FROM sync_queue ORDER BY id DESC LIMIT 1");
      return entry!.id;
    });
  await enqueueSync(db, "private_notes", "UPDATE", "queued-note", note());
  const entry = await db.getFirstAsync<{ id: number }>("SELECT id FROM sync_queue ORDER BY id DESC LIMIT 1");
  if (!entry) throw new Error("Expected real sync queue entry");
  return entry.id;
}

function queueState(id: number) {
  return sql.prepare("SELECT status FROM sync_queue WHERE id = ?").get(id) as { status: string } | undefined;
}

beforeEach(async () => {
  jest.clearAllMocks();
  seedSession();
  mockProbeData = [];
  mockExistingLog = null;
  remoteWrites.length = 0;
  sql = new DatabaseSync(":memory:");
  const adapter = {
    execAsync: async (source: string) => sql.exec(source),
    getFirstAsync: async (source: string, params: SQLInputValue[] = []) => sql.prepare(source).get(...params) ?? null,
    getAllAsync: async (source: string, params: SQLInputValue[] = []) => sql.prepare(source).all(...params),
    runAsync: async (source: string, params: SQLInputValue[] = []) => sql.prepare(source).run(...params),
    withTransactionAsync: async (work: () => Promise<void>) => {
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
  db = adapter as unknown as SQLiteDatabase;
  await createSchema(db);
  sql
    .prepare("INSERT INTO user_settings (key,value,updated_at) VALUES (?,?,?)")
    .run(`sync_initial_backfill_${USER_ID}_20260525_sync_v1`, "true", OLD);
  sql
    .prepare("INSERT INTO user_settings (key,value,updated_at) VALUES (?,?,?)")
    .run(`sync_user_settings_backfill_${USER_ID}_20260528_user_settings_v1`, "true", OLD);
  sql
    .prepare("INSERT INTO user_settings (key,value,updated_at) VALUES (?,?,?)")
    .run(`sync_account_restore_${USER_ID}_20260614_account_restore_v1`, "true", OLD);
  sql.prepare("INSERT INTO user_settings (key,value,updated_at) VALUES ('last_pull_at',?,?)").run(OLD, OLD);
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  sql.close();
  mockSession = null;
  observeAuthSession(null);
  jest.restoreAllMocks();
});

const mismatchedIdentityEntries: { label: string; entry: RawQueueEntry }[] = [
  {
    label: "private note ID",
    entry: {
      tableName: "private_notes",
      operation: "UPDATE",
      rowId: "row-note",
      data: JSON.stringify(note("payload-note")),
    },
  },
  {
    label: "colon-containing study card ID",
    entry: {
      tableName: "study_cards",
      operation: "UPDATE",
      rowId: "old-card-id",
      data: JSON.stringify(card("qiraat:2:255")),
    },
  },
  {
    label: "bookmark coordinates",
    entry: { tableName: "bookmarks", operation: "UPDATE", rowId: "2:254", data: JSON.stringify(bookmark()) },
  },
  {
    label: "word meaning coordinates",
    entry: {
      tableName: "user_word_meanings",
      operation: "UPDATE",
      rowId: "2:255:2",
      data: JSON.stringify(wordMeaning()),
    },
  },
  {
    label: "study log composite identity with a colon-containing card ID",
    entry: {
      tableName: "study_log",
      operation: "INSERT",
      rowId: `qiraat:2:255:${OLD}`,
      data: JSON.stringify(studyLog("qiraat:2:255", NEW)),
    },
  },
];

const malformedEntries: { label: string; entry: RawQueueEntry; validNeighborIsCard?: boolean }[] = [
  {
    label: "out-of-range database integer ID",
    entry: { tableName: "highlights", operation: "DELETE", rowId: "9223372036854775808", data: "{}" },
  },
  {
    label: "unknown table",
    entry: { tableName: "unknown_table", operation: "UPDATE", rowId: "bad", data: JSON.stringify(note("bad")) },
  },
  {
    label: "prototype table name",
    entry: { tableName: "__proto__", operation: "UPDATE", rowId: "bad", data: JSON.stringify(note("bad")) },
  },
  {
    label: "unknown operation",
    entry: { tableName: "private_notes", operation: "BOGUS", rowId: "bad", data: JSON.stringify(note("bad")) },
    validNeighborIsCard: true,
  },
  ...(["null", "[]", "not-json"] as const).map((data) => ({
    label: data === "not-json" ? "invalid JSON" : `nonobject ${data}`,
    entry: { tableName: "private_notes", operation: "UPDATE", rowId: "bad", data },
    validNeighborIsCard: true,
  })),
  {
    label: "foreign declared owner",
    entry: {
      tableName: "private_notes",
      operation: "UPDATE",
      rowId: "bad",
      data: JSON.stringify({ ...note("bad"), user_id: OTHER_USER_ID }),
    },
    validNeighborIsCard: true,
  },
];

it.each(malformedEntries)(
  "keeps $label failed without remote write or acknowledgement while a valid neighbor succeeds",
  async ({ entry, validNeighborIsCard = false }) => {
    const badId = seedRawQueueEntry(entry);
    const goodId = await seedValidNeighbor(validNeighborIsCard);

    const result = await fullSync(db);

    expect(remoteWrites.map((write) => write.table)).toEqual([validNeighborIsCard ? "study_cards" : "private_notes"]);
    expect(remoteWrites[0]?.kind).toBe("upsert");
    expect(result).toMatchObject({ status: "partial", pushed: 1 });
    expect(queueState(badId)).toEqual({ status: "failed" });
    expect(queueState(goodId)).toEqual({ status: "synced" });
    expect(await getPendingSyncEntries(db, 100)).toMatchObject([{ id: badId, status: "failed" }]);
  },
);

it.each(mismatchedIdentityEntries)(
  "rejects queue payloads whose $label does not match row_id without blocking another table",
  async ({ entry }) => {
    const badId = seedRawQueueEntry(entry);
    const goodId = await seedValidNeighbor(entry.tableName === "private_notes");

    const result = await fullSync(db);

    expect(remoteWrites.map((write) => write.table)).toEqual([
      entry.tableName === "private_notes" ? "study_cards" : "private_notes",
    ]);
    expect(result).toMatchObject({ status: "partial", pushed: 1 });
    expect(queueState(badId)).toEqual({ status: "failed" });
    expect(queueState(goodId)).toEqual({ status: "synced" });
    expect(await getPendingSyncEntries(db, 100)).toMatchObject([{ id: badId, status: "failed" }]);
  },
);

it("accepts a colon-containing legacy card ID and matching append-only study-log composite ID", async () => {
  const cardId = "qiraat:2:255";
  const cardQueueId = await enqueueSync(db, "study_cards", "UPDATE", cardId, card(cardId)).then(async () => {
    const row = await db.getFirstAsync<{ id: number }>("SELECT id FROM sync_queue ORDER BY id DESC LIMIT 1");
    if (!row) throw new Error("Expected card queue row");
    return row.id;
  });
  const logRowId = `${cardId}:${NEW}`;
  const logQueueId = await enqueueSync(db, "study_log", "INSERT", logRowId, studyLog(cardId, NEW)).then(async () => {
    const row = await db.getFirstAsync<{ id: number }>("SELECT id FROM sync_queue ORDER BY id DESC LIMIT 1");
    if (!row) throw new Error("Expected log queue row");
    return row.id;
  });

  const result = await fullSync(db);

  expect(result).toMatchObject({ status: "synced", pushed: 2 });
  expect(remoteWrites.map((write) => `${write.table}:${write.kind}`)).toEqual([
    "study_cards:upsert",
    "study_log:insert",
  ]);
  expect(queueState(cardQueueId)).toEqual({ status: "synced" });
  expect(queueState(logQueueId)).toEqual({ status: "synced" });
  expect(remoteWrites[0]?.row?.id).toBe(cardId);
  expect(remoteWrites[1]?.row?.card_id).toBe(cardId);
});

it("preserves sparse card, numeric highlight and canonical highlight physical DELETE routes", async () => {
  const cardId = "qiraat:2:255";
  await enqueueSync(db, "study_cards", "DELETE", cardId, {
    id: cardId,
    updated_at: NEW,
    deleted_at: NEW,
  });
  await enqueueSync(db, "highlights", "DELETE", "42", {});
  const canonicalHighlightId = "highlight:2:255:ayah:ayah:yellow";
  await enqueueSync(db, "highlights", "DELETE", canonicalHighlightId, {});
  await enqueueSync(db, "bookmarks", "DELETE", "2:255", {});
  await enqueueSync(db, "user_word_meanings", "DELETE", "2:255:1", {});

  const result = await fullSync(db);

  expect(result).toMatchObject({ status: "synced", pushed: 5 });
  expect([...remoteWrites].sort((a, b) => a.table.localeCompare(b.table))).toEqual([
    {
      table: "bookmarks",
      kind: "delete",
      filters: [
        ["user_id", USER_ID],
        ["surah", 2],
        ["ayah", 255],
      ],
    },
    {
      table: "highlights",
      kind: "delete",
      filters: [
        ["user_id", USER_ID],
        ["id", "42"],
      ],
    },
    {
      table: "highlights",
      kind: "delete",
      filters: [
        ["user_id", USER_ID],
        ["sync_id", canonicalHighlightId],
      ],
    },
    {
      table: "study_cards",
      kind: "delete",
      filters: [
        ["user_id", USER_ID],
        ["id", cardId],
      ],
    },
    {
      table: "user_word_meanings",
      kind: "delete",
      filters: [
        ["user_id", USER_ID],
        ["surah", 2],
        ["ayah", 255],
        ["word_pos", 1],
      ],
    },
  ]);
  expect(await getPendingSyncEntries(db, 100)).toEqual([]);
});

it("retains unsupported outbound fields until repaired, then retries the same queue row", async () => {
  const data = { ...note(), future_field: { version: 2 } };
  const id = seedRawQueueEntry({
    tableName: "private_notes",
    operation: "UPDATE",
    rowId: "queued-note",
    data: JSON.stringify(data),
  });
  await expect(fullSync(db)).resolves.toMatchObject({ status: "failed", pushed: 0 });
  expect(remoteWrites).toEqual([]);
  expect(queueState(id)).toEqual({ status: "failed" });
  expect(sql.prepare("SELECT data FROM sync_queue WHERE id=?").get(id)?.data).toBe(JSON.stringify(data));
  sql.prepare("UPDATE sync_queue SET data=? WHERE id=?").run(JSON.stringify(note()), id);
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pushed: 1 });
  expect(remoteWrites).toHaveLength(1);
  expect(queueState(id)).toEqual({ status: "synced" });
});

it.each([
  { label: "non-array projection", data: {} },
  { label: "malformed newer timestamp", data: [{ updated_at: "9999-invalid" }] },
  { label: "missing timestamp", data: [{}] },
  { label: "foreign declared probe owner", data: [{ updated_at: NEW, user_id: OTHER_USER_ID }] },
])("does not acknowledge an upload on $label", async ({ data }) => {
  const id = await seedValidNeighbor(false);
  mockProbeData = data;
  await expect(fullSync(db)).resolves.toMatchObject({ status: "failed", pushed: 0 });
  expect(remoteWrites).toEqual([]);
  expect(queueState(id)).toEqual({ status: "failed" });
  expect(await getPendingSyncEntries(db, 100)).toMatchObject([{ id, status: "failed" }]);
  mockProbeData = [];
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pushed: 1 });
  expect(queueState(id)).toEqual({ status: "synced" });
  expect(remoteWrites).toHaveLength(1);
});
it.each([
  {
    label: "older remote instant with later-sorting text",
    local: "2026-06-01T00:00:00-04:00",
    remote: "2026-06-01T03:00:00Z",
    remoteIsNewer: false,
  },
  {
    label: "newer remote instant with earlier-sorting text",
    local: "2026-06-01T04:00:00+03:00",
    remote: "2026-06-01T02:00:00Z",
    remoteIsNewer: true,
  },
  {
    label: "newer sub-millisecond remote instant",
    local: "2026-06-01T00:00:00.1Z",
    remote: "2026-06-01T00:00:00.1001+00:00",
    remoteIsNewer: true,
  },
  {
    label: "equal instant with offset and trailing zeros",
    local: "2026-06-01T00:00:00.100-02:00",
    remote: "2026-06-01T02:00:00.1000Z",
    remoteIsNewer: false,
  },
])("compares queued upload freshness by instant: $label", async ({ local, remote, remoteIsNewer }) => {
  await enqueueSync(db, "private_notes", "UPDATE", "queued-note", { ...note(), updated_at: local });
  const row = await db.getFirstAsync<{ id: number }>("SELECT id FROM sync_queue ORDER BY id DESC LIMIT 1");
  if (!row) throw new Error("Expected queued note");
  mockProbeData = [{ updated_at: remote }];

  const result = await fullSync(db);

  expect(result).toMatchObject({ status: "synced", pushed: 1 });
  expect(remoteWrites).toHaveLength(remoteIsNewer ? 0 : 1);
  if (!remoteIsNewer) expect(remoteWrites[0]?.row?.updated_at).toBe(local);
  expect(queueState(row.id)).toEqual({ status: "synced" });
});

it("keeps the existing valid newer-remote timestamp precedence", async () => {
  const id = await seedValidNeighbor(false);
  mockProbeData = [{ updated_at: "2026-03-01T00:00:00.000Z" }];
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pushed: 1 });
  expect(remoteWrites).toEqual([]);
  expect(queueState(id)).toEqual({ status: "synced" });
});

it.each([{}, [], { id: null }, { id: "nonsense" }, { id: 1, user_id: OTHER_USER_ID }])(
  "does not acknowledge a queued review from malformed existence data %p",
  async (data) => {
    await enqueueSync(db, "study_log", "INSERT", `qiraat:2:255:${NEW}`, studyLog());
    const id = (await getPendingSyncEntries(db, 1))[0].id;
    mockExistingLog = data;
    await expect(fullSync(db)).resolves.toMatchObject({ status: "failed", pushed: 0 });
    expect(remoteWrites).toEqual([]);
    expect(queueState(id)).toEqual({ status: "failed" });
    mockExistingLog = null;
    await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pushed: 1 });
    expect(remoteWrites.map((write) => write.kind)).toEqual(["insert"]);
    expect(queueState(id)).toEqual({ status: "synced" });
  },
);
it("acknowledges a validated existing review without inserting it again", async () => {
  await enqueueSync(db, "study_log", "INSERT", `qiraat:2:255:${NEW}`, studyLog());
  mockExistingLog = { id: "42" };
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pushed: 1 });
  expect(remoteWrites).toEqual([]);
  expect(await getPendingSyncEntries(db, 100)).toEqual([]);
});

it("preserves every generated database integer ID from the real queue through remote dispatch", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(fc.bigInt({ min: 1n, max: 9223372036854775807n }), { minLength: 1, maxLength: 8 }),
      async (ids) => {
        sql.exec("DELETE FROM sync_queue");
        remoteWrites.length = 0;
        const decimalIds = ids.map((id) => id.toString());
        for (const id of decimalIds) await enqueueSync(db, "highlights", "DELETE", id, {});
        await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pushed: ids.length });
        expect(remoteWrites.map((write) => write.table + ":" + write.kind)).toEqual(ids.map(() => "highlights:delete"));
        expect(remoteWrites.map((write) => String(write.filters.find(([key]) => key === "id")?.[1]))).toEqual(
          decimalIds,
        );
        expect(await getPendingSyncEntries(db, 100)).toEqual([]);
      },
    ),
    { seed: 310231, numRuns: 60, examples: [[[9007199254740993n, 9223372036854775807n]]] },
  );
});
