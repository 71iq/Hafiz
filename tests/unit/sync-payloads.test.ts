import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import type { Session } from "@supabase/supabase-js";
import { observeAuthSession } from "@/lib/auth/commands";
import { createSchema } from "@/lib/database/schema";
import { fullSync } from "@/lib/database/sync";
import { State } from "@/lib/fsrs/scheduler";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OLD = "2026-01-01T00:00:00.000Z";
const NEW = "2026-02-01T00:00:00.000Z";
let mockSession: Session | null = null;
let mockRestoreCards: unknown[] = [];
let mockIncrementalCards: unknown[] = [];
const requests: { table: string; incremental: boolean; offset: number }[] = [];
const writes: string[] = [];
const mockPending = jest.fn(async () => []);
const mockBackfill = jest.fn(async () => 0);

class MockQuery {
  private incremental = false;
  constructor(private readonly table: string) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  gt() {
    this.incremental = true;
    return this;
  }
  order() {
    return this;
  }
  async range(start: number, end: number) {
    requests.push({ table: this.table, incremental: this.incremental, offset: start });
    const rows = this.table === "study_cards" ? (this.incremental ? mockIncrementalCards : mockRestoreCards) : [];
    return { data: rows.slice(start, end + 1), error: null };
  }
}

jest.mock("@/lib/auth/store", () => ({
  useAuthStore: { getState: () => ({ user: mockSession?.user ?? null, session: mockSession }) },
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { from: (table: string) => new MockQuery(table) },
}));
jest.mock("@/lib/database/sync-queue", () => ({
  getPendingSyncEntries: () => mockPending(),
  enqueueSync: jest.fn(async () => {}),
  markSynced: jest.fn(async () => {}),
  markFailed: jest.fn(async () => {}),
  cleanSyncedEntries: jest.fn(async () => {}),
}));
jest.mock("@/lib/achievements/queries", () => ({
  backfillAchievements: () => mockBackfill(),
  insertRemoteAchievementUnlock: jest.fn(),
}));

let sql: DatabaseSync;
let db: SQLiteDatabase;
let transactions = 0;
function card(id = "2:255"): Record<string, SQLInputValue> {
  return {
    id,
    deck_id: "synthetic",
    due: OLD,
    stability: 5,
    difficulty: 4,
    elapsed_days: 1,
    scheduled_days: 1,
    learning_steps: 0,
    reps: 1,
    lapses: 0,
    state: State.Review,
    last_review: OLD,
    suspended_at: null,
    buried_until: null,
    marked_at: null,
    created_at: OLD,
    updated_at: NEW,
    deleted_at: null,
  };
}
function putCard(row: Record<string, SQLInputValue>) {
  const columns = Object.keys(row);
  sql
    .prepare(`INSERT INTO study_cards (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
    .run(...Object.values(row));
}
function putSetting(key: string, value: string) {
  sql.prepare("INSERT OR REPLACE INTO user_settings (key,value,updated_at) VALUES (?,?,?)").run(key, value, OLD);
}
function restoreComplete() {
  putSetting(`sync_account_restore_${USER_ID}_20260614_account_restore_v1`, "true");
}
function snapshot() {
  return {
    cards: sql.prepare("SELECT * FROM study_cards ORDER BY id").all(),
    notes: sql.prepare("SELECT * FROM private_notes ORDER BY id").all(),
    settings: sql.prepare("SELECT * FROM user_settings ORDER BY key").all(),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  observeAuthSession(null);
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
  mockRestoreCards = [];
  mockIncrementalCards = [];
  requests.length = 0;
  writes.length = 0;
  transactions = 0;
  sql = new DatabaseSync(":memory:");
  const adapter = {
    execAsync: async (source: string) => {
      sql.exec(source);
    },
    getFirstAsync: async (source: string, params: SQLInputValue[] = []) => sql.prepare(source).get(...params) ?? null,
    getAllAsync: async (source: string, params: SQLInputValue[] = []) => sql.prepare(source).all(...params),
    runAsync: async (source: string, params: SQLInputValue[] = []) => {
      writes.push(source);
      return sql.prepare(source).run(...params);
    },
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
  // Only this isolated boundary adapts the wider Expo API to real Node SQLite.
  db = adapter as unknown as SQLiteDatabase;
  await createSchema(db);
  putSetting(`sync_initial_backfill_${USER_ID}_20260525_sync_v1`, "true");
  putSetting(`sync_user_settings_backfill_${USER_ID}_20260528_user_settings_v1`, "true");
  putSetting("last_pull_at", OLD);
  putCard({ ...card(), updated_at: OLD });
  sql
    .prepare(
      "INSERT INTO private_notes (id,surah,ayah_start,ayah_end,content,created_at,updated_at) VALUES ('synthetic-note',2,255,255,'synthetic note',?,?)",
    )
    .run(OLD, OLD);
  writes.length = 0;
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  sql.close();
  mockSession = null;
  observeAuthSession(null);
  jest.restoreAllMocks();
});

const invalidStates: { label: string; state: unknown }[] = [
  { label: "999", state: 999 },
  { label: "negative", state: -1 },
  { label: "4", state: 4 },
  { label: "fraction", state: 1.5 },
  { label: "string", state: "2" },
  { label: "null", state: null },
  { label: "missing", state: undefined },
  { label: "NaN", state: NaN },
  { label: "infinity", state: Infinity },
];
it.each(invalidStates.flatMap((entry) => ["restore", "incremental"].map((mode) => ({ ...entry, mode }))))(
  "rejects $label during $mode before local writes",
  async ({ state, mode }) => {
    const incoming = { ...card(), state };
    if (mode === "restore") mockRestoreCards = [incoming];
    else {
      restoreComplete();
      mockIncrementalCards = [incoming];
    }
    const before = snapshot();
    if (mode === "restore") await expect(fullSync(db)).rejects.toThrow("Invalid synced study card state");
    else await fullSync(db); // Existing RF029 partial-error reporting remains a separate task.
    expect(snapshot()).toEqual(before);
    expect(transactions).toBe(0);
    expect(writes).toEqual([]);
    expect(mockBackfill).not.toHaveBeenCalled();
  },
);

it("validates a later restore page before clearing any local tables", async () => {
  mockRestoreCards = [...Array.from({ length: 500 }, (_, i) => card(`synthetic-${i}`)), { ...card(), state: 999 }];
  const before = snapshot();
  await expect(fullSync(db)).rejects.toThrow("Invalid synced study card state");
  expect(requests.filter((request) => request.table === "study_cards").map((request) => request.offset)).toEqual([
    0, 500,
  ]);
  expect(snapshot()).toEqual(before);
  expect(transactions).toBe(0);
  expect(writes).toEqual([]);
});

it("rejects an incremental page's valid prefix before starting the page transaction", async () => {
  restoreComplete();
  mockIncrementalCards = [card("synthetic-valid"), { ...card(), state: 999 }];
  const before = snapshot();
  await fullSync(db);
  expect(snapshot()).toEqual(before);
  expect(transactions).toBe(0);
  expect(writes).toEqual([]);
});

it.each(
  [State.New, State.Learning, State.Review, State.Relearning].flatMap((state) =>
    ["restore", "incremental"].map((mode) => ({ state, mode })),
  ),
)("retains supported state $state during $mode", async ({ state, mode }) => {
  const incoming = { ...card(), state };
  if (mode === "restore") mockRestoreCards = [incoming];
  else {
    restoreComplete();
    mockIncrementalCards = [incoming];
  }
  await expect(fullSync(db)).resolves.toMatchObject({ pulled: 1, accountRestored: mode === "restore" });
  expect(sql.prepare("SELECT state, updated_at FROM study_cards WHERE id = '2:255'").get()).toEqual({
    state,
    updated_at: NEW,
  });
  expect(transactions).toBe(1);
});

it.each(["restore", "incremental"])("preserves omitted-state tombstone defaults during %s", async (mode) => {
  const tombstone = { id: "2:255", updated_at: NEW, deleted_at: NEW };
  if (mode === "restore") mockRestoreCards = [tombstone];
  else {
    restoreComplete();
    mockIncrementalCards = [tombstone];
  }
  await fullSync(db);
  expect(sql.prepare("SELECT state, deck_id, deleted_at FROM study_cards WHERE id = '2:255'").get()).toEqual({
    state: State.New,
    deck_id: "deleted",
    deleted_at: NEW,
  });
});

it.each([OLD, NEW])(
  "preserves valid local state when the remote timestamp is tied or older: %s",
  async (localUpdatedAt) => {
    restoreComplete();
    sql.prepare("UPDATE study_cards SET updated_at = ?").run(localUpdatedAt);
    mockIncrementalCards = [{ ...card(), state: State.New, updated_at: OLD }];
    await fullSync(db);
    expect(sql.prepare("SELECT state, updated_at FROM study_cards WHERE id = '2:255'").get()).toEqual({
      state: State.Review,
      updated_at: localUpdatedAt,
    });
  },
);
