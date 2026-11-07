import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { AppDatabase, TransactionDatabase } from "@/lib/database/types";
import type { Session } from "@supabase/supabase-js";
import { observeAuthSession } from "@/lib/auth/commands";
import { createSchema } from "@/lib/database/schema";
import { fullSync } from "@/lib/database/sync";
import { enqueueSync, getPendingSyncCount, getPendingSyncEntries } from "@/lib/database/sync-queue";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OLD = "2026-01-01T00:00:00.000Z";
const NEW = "2026-02-01T00:00:00.000Z";
let mockSession: Session | null = null;
let mockConfigured = true;
let mockRemoteNotes: Record<string, unknown>[] = [];
let mockQueryErrors = new Map<string, Error>();
let mockUpsertFailureAt: number | null = null;
let mockUpsertAttempts = 0;
let rangeHook: ((table: string, offset: number) => void | Promise<void>) | null = null;
const requests: { table: string; since: string | null; offset: number }[] = [];
const successfulUpserts: Record<string, unknown>[] = [];
const reads: string[] = [];

class MockQuery {
  private since: string | null = null;

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  eq() {
    return this;
  }

  gt(_column: string, value: string) {
    this.since = value;
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  async range(start: number, end: number) {
    requests.push({ table: this.table, since: this.since, offset: start });
    const error = mockQueryErrors.get(`${this.table}:${start}`);
    if (error) return { data: null, error };

    const rows = this.table === "private_notes" ? mockRemoteNotes : [];
    const eligible = this.since
      ? rows.filter((row) => typeof row.synced_at === "string" && row.synced_at > this.since!)
      : rows;
    await rangeHook?.(this.table, start);
    return { data: eligible.slice(start, end + 1).map((row) => ({ ...row })), error: null };
  }

  async upsert(row: Record<string, unknown>) {
    mockUpsertAttempts += 1;
    if (mockUpsertAttempts === mockUpsertFailureAt) {
      return { error: new Error(`Synthetic remote upsert failure ${mockUpsertAttempts}`) };
    }
    successfulUpserts.push(row);
    return { error: null };
  }

  async delete() {
    return { error: null };
  }

  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    _onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: [] as unknown[], error: null }).then(onfulfilled ?? undefined);
  }
}

jest.mock("@/lib/auth/store", () => ({
  useAuthStore: { getState: () => ({ user: mockSession?.user ?? null, session: mockSession }) },
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  supabase: { from: (table: string) => new MockQuery(table) },
}));
jest.mock("@/lib/achievements/queries", () => ({
  backfillAchievements: jest.fn(async () => 0),
  insertRemoteAchievementUnlock: jest.fn(),
}));

let sql: DatabaseSync;
let db: AppDatabase;

function putSetting(key: string, value: string) {
  sql.prepare("INSERT OR REPLACE INTO user_settings (key,value,updated_at) VALUES (?,?,?)").run(key, value, OLD);
}

function note(id: string, syncedAt = NEW) {
  return {
    id,
    user_id: USER_ID,
    surah: 2,
    ayah_start: 255,
    ayah_end: 255,
    content: `synthetic ${id}`,
    created_at: OLD,
    updated_at: NEW,
    deleted_at: null,
    synced_at: syncedAt,
  };
}

function putLocalNote() {
  sql
    .prepare(
      `INSERT INTO private_notes (id,surah,ayah_start,ayah_end,content,created_at,updated_at)
     VALUES ('local-note',2,255,255,'synthetic local note',?,?)`,
    )
    .run(OLD, OLD);
}

function seedQueueRow(id: string) {
  return enqueueSync(db, "private_notes", "UPDATE", id, {
    id,
    surah: 2,
    ayah_start: 255,
    ayah_end: 255,
    content: `queued ${id}`,
    created_at: OLD,
    updated_at: NEW,
    deleted_at: null,
  });
}

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

async function pendingRows() {
  return getPendingSyncEntries(db, 100);
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockConfigured = true;
  seedSession();
  mockRemoteNotes = [];
  mockQueryErrors = new Map();
  mockUpsertFailureAt = null;
  mockUpsertAttempts = 0;
  rangeHook = null;
  requests.length = 0;
  successfulUpserts.length = 0;
  reads.length = 0;

  sql = new DatabaseSync(":memory:");
  const adapter = {
    execAsync: async (source: string) => sql.exec(source),
    getFirstAsync: async (source: string, params: SQLInputValue[] = []) => {
      reads.push(source);
      return sql.prepare(source).get(...params) ?? null;
    },
    getAllAsync: async (source: string, params: SQLInputValue[] = []) => {
      reads.push(source);
      return sql.prepare(source).all(...params);
    },
    runAsync: async (source: string, params: SQLInputValue[] = []) => sql.prepare(source).run(...params),
    withTransactionAsync: async (work: (transaction: TransactionDatabase) => Promise<void>) => {
      sql.exec("BEGIN");
      try {
        await work(db as unknown as TransactionDatabase);
        sql.exec("COMMIT");
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  db = adapter as unknown as AppDatabase;
  await createSchema(db);
  putSetting(`sync_initial_backfill_${USER_ID}_20260525_sync_v1`, "true");
  putSetting(`sync_user_settings_backfill_${USER_ID}_20260528_user_settings_v1`, "true");
  putSetting(`sync_account_restore_${USER_ID}_20260614_account_restore_v1`, "true");
  putSetting("last_pull_at", OLD);
  putLocalNote();
  reads.length = 0;
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  sql.close();
  mockSession = null;
  observeAuthSession(null);
  jest.restoreAllMocks();
});

describe("RF-029 sync progress reporting", () => {
  it("keeps 500 committed notes and the old cursor after a later page fails, then retries page 501", async () => {
    mockRemoteNotes = Array.from({ length: 501 }, (_, index) => note(`remote-note-${index}`));
    mockQueryErrors.set("private_notes:500", new Error("Synthetic second-page failure"));

    const first = await fullSync(db);

    expect(sql.prepare("SELECT COUNT(*) AS count FROM private_notes WHERE id LIKE 'remote-note-%'").get()).toEqual({
      count: 500,
    });
    expect(first).toMatchObject({ pulled: 500, status: "partial" });
    expect(requests.find((request) => request.table === "private_notes")?.since).toBe(OLD);
    expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()).toEqual({ value: OLD });

    mockQueryErrors.clear();
    const retry = await fullSync(db);

    expect(retry).toMatchObject({ pulled: 501, status: "synced" });
    expect(sql.prepare("SELECT COUNT(*) AS count FROM private_notes WHERE id LIKE 'remote-note-%'").get()).toEqual({
      count: 501,
    });
    expect(requests.filter((request) => request.table === "private_notes").map((request) => request.since)).toEqual([
      OLD,
      OLD,
      OLD,
      OLD,
    ]);
    expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()?.value).not.toBe(OLD);
  });

  it("reports a first-page pull failure with no progress and preserves the cursor", async () => {
    mockRemoteNotes = [note("remote-note-0")];
    mockQueryErrors.set("private_notes:0", new Error("Synthetic first-page failure"));

    const result = await fullSync(db);

    expect(result).toMatchObject({ pulled: 0, status: "failed" });
    expect(sql.prepare("SELECT COUNT(*) AS count FROM private_notes WHERE id LIKE 'remote-note-%'").get()).toEqual({
      count: 0,
    });
    expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()).toEqual({ value: OLD });
  });

  it("retains both same-table queue entries after one remote success and pull failure while reporting partial progress", async () => {
    await seedQueueRow("queued-note-1");
    await seedQueueRow("queued-note-2");
    mockUpsertFailureAt = 2;
    mockQueryErrors.set("private_notes:0", new Error("Synthetic pull failure"));

    const result = await fullSync(db);

    expect(successfulUpserts).toHaveLength(1);
    expect(result).toMatchObject({ pushed: 0, pulled: 0, status: "partial" });
    expect(await pendingRows()).toMatchObject([
      { id: 1, status: "failed", row_id: "queued-note-1" },
      { id: 2, status: "failed", row_id: "queued-note-2" },
    ]);
    expect(await getPendingSyncCount(db)).toBe(2);

    mockUpsertFailureAt = null;
    mockQueryErrors.clear();
    const retry = await fullSync(db);

    expect(retry).toMatchObject({ pushed: 2, status: "synced" });
    expect(await pendingRows()).toEqual([]);
    expect(await getPendingSyncCount(db)).toBe(0);
  });

  it("reports a failed upload with no pull progress and leaves the production queue entry failed", async () => {
    await seedQueueRow("queued-note-failure");
    mockUpsertFailureAt = 1;

    const result = await fullSync(db);

    expect(result).toMatchObject({ pushed: 0, pulled: 0, status: "failed" });
    expect(await pendingRows()).toMatchObject([{ id: 1, status: "failed", row_id: "queued-note-failure" }]);
    expect(await getPendingSyncCount(db)).toBe(1);
    expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()?.value).not.toBe(OLD);
  });

  it("reports work enqueued during a healthy pull as partial without treating it as a failure", async () => {
    let added = false;
    rangeHook = async (table) => {
      if (table === "user_settings" && !added) {
        added = true;
        await seedQueueRow("queued-during-pull");
      }
    };

    const result = await fullSync(db);

    expect(result).toMatchObject({ pushed: 0, pulled: 0, status: "partial" });
    expect(await pendingRows()).toMatchObject([{ id: 1, status: "pending", row_id: "queued-during-pull" }]);
    expect(await getPendingSyncCount(db)).toBe(1);
    expect(successfulUpserts).toEqual([]);
  });

  it("honors the 10000-entry production queue cap and completes its remaining entry on retry", async () => {
    for (let index = 0; index < 10001; index += 1) await seedQueueRow("queued-cap-" + index);

    const first = await fullSync(db);

    expect(first).toMatchObject({ status: "partial", pushed: 10000, pulled: 0 });
    expect(successfulUpserts).toHaveLength(10000);
    expect(await getPendingSyncCount(db)).toBe(1);
    expect(await pendingRows()).toMatchObject([{ id: 10001, row_id: "queued-cap-10000", status: "pending" }]);
    expect(sql.prepare("SELECT COUNT(*) AS count FROM sync_queue WHERE status='synced'").get()).toEqual({
      count: 10000,
    });

    const retry = await fullSync(db);

    expect(retry).toMatchObject({ status: "synced", pushed: 1, pulled: 0 });
    expect(successfulUpserts).toHaveLength(10001);
    expect(successfulUpserts.at(-1)?.id).toBe("queued-cap-10000");
    expect(await getPendingSyncCount(db)).toBe(0);
    expect(await pendingRows()).toEqual([]);
    expect(sql.prepare("SELECT COUNT(*) AS count FROM sync_queue WHERE status='synced'").get()).toEqual({
      count: 10001,
    });
  }, 30000);

  it("reports an empty successful sync as synced and advances its cursor", async () => {
    const result = await fullSync(db);

    expect(result).toMatchObject({ pushed: 0, pulled: 0, status: "synced" });
    expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()?.value).not.toBe(OLD);
    expect(await getPendingSyncCount(db)).toBe(0);
  });

  it.each(["unconfigured", "no matching owner"] as const)(
    "returns not_connected for %s without database reads or remote requests",
    async (caseName) => {
      if (caseName === "unconfigured") mockConfigured = false;
      else {
        mockSession = null;
        observeAuthSession(null);
      }

      const result = await fullSync(db);

      expect(result).toMatchObject({ pushed: 0, pulled: 0, status: "not_connected" });
      expect(reads).toEqual([]);
      expect(requests).toEqual([]);
      expect(successfulUpserts).toEqual([]);
    },
  );
});
