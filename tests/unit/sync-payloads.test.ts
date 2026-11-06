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
const requests: { table: string; incremental: boolean; offset: number; since: string | null }[] = [];
const mockMeaningRestoreRows: unknown[] = [];
const mockMeaningIncrementalRows: unknown[] = [];
const mockQueryErrors = new Map<string, Error>();
const writes: string[] = [];
const mockPending = jest.fn(async () => []);
const mockBackfill = jest.fn(async () => 0);

class MockQuery {
  private incremental = false;
  private since: string | null = null;
  constructor(private readonly table: string) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  gt(_column: string, value: string) {
    this.incremental = true;
    this.since = value;
    return this;
  }
  order() {
    return this;
  }
  async range(start: number, end: number) {
    requests.push({ table: this.table, incremental: this.incremental, offset: start, since: this.since });
    const key = `${this.table}:${this.incremental ? "incremental" : "restore"}:${start}`;
    const error = mockQueryErrors.get(key);
    if (error) return { data: null, error };
    const rows =
      this.table === "study_cards"
        ? this.incremental
          ? mockIncrementalCards
          : mockRestoreCards
        : this.table === "user_word_meanings"
          ? this.incremental
            ? mockMeaningIncrementalRows
            : mockMeaningRestoreRows
          : [];
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
function meaning(overrides: Record<string, SQLInputValue> = {}): Record<string, SQLInputValue> {
  return {
    surah: 2,
    ayah: 256,
    word_pos: 1,
    word: "synthetic",
    meaning: "synthetic meaning",
    created_at: OLD,
    updated_at: NEW,
    ...overrides,
  };
}
function putMeaning(row: Record<string, SQLInputValue> = meaning()) {
  sql
    .prepare(
      "INSERT INTO user_word_meanings (surah,ayah,word_pos,word,meaning,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(row.surah, row.ayah, row.word_pos, row.word, row.meaning, row.created_at, row.updated_at);
}
function putQueueRow() {
  sql
    .prepare(
      "INSERT INTO sync_queue (table_name,operation,row_id,data,status,created_at) VALUES ('private_notes','UPDATE','synthetic-note','{}','pending',?)",
    )
    .run(OLD);
}
function failPage(table: string, mode: "restore" | "incremental", offset: number, error: Error) {
  mockQueryErrors.set(`${table}:${mode}:${offset}`, error);
}
function snapshot() {
  return {
    cards: sql.prepare("SELECT * FROM study_cards ORDER BY id").all(),
    notes: sql.prepare("SELECT * FROM private_notes ORDER BY id").all(),
    meanings: sql.prepare("SELECT * FROM user_word_meanings ORDER BY surah,ayah,word_pos").all(),
    settings: sql.prepare("SELECT * FROM user_settings ORDER BY key").all(),
    queue: sql.prepare("SELECT * FROM sync_queue ORDER BY id").all(),
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
  mockMeaningRestoreRows.length = 0;
  mockMeaningIncrementalRows.length = 0;
  mockQueryErrors.clear();
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

describe("word meaning restore and incremental recovery", () => {
  it.each([
    ["first", 0],
    ["later", 500],
  ] as const)("rejects a %s-page meaning restore failure before replacing local state", async (_label, offset) => {
    const error = new Error("Synthetic word meaning restore failure " + offset);
    mockRestoreCards = [card("synthetic-remote-card")];
    if (offset === 500)
      mockMeaningRestoreRows.push(
        ...Array.from({ length: 500 }, (_, i) => meaning({ surah: 2 + Math.floor(i / 100), ayah: 1 + (i % 100) })),
      );
    failPage("user_word_meanings", "restore", offset, error);
    putMeaning(meaning({ meaning: "keep local restore meaning", updated_at: OLD }));
    putQueueRow();
    const before = snapshot();
    writes.length = 0;

    const outcome = await fullSync(db).then(
      () => null,
      (failure: unknown) => failure,
    );

    expect(snapshot()).toEqual(before);
    expect(outcome).toBe(error);
    expect(requests.filter((r) => r.table === "user_word_meanings").map((r) => r.offset)).toEqual(
      offset === 500 ? [0, 500] : [0],
    );
    expect(mockPending).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(transactions).toBe(0);
    expect(sql.prepare("SELECT value FROM user_settings WHERE key = 'last_pull_at'").get()).toEqual({ value: OLD });
    expect(
      sql.prepare("SELECT value FROM user_settings WHERE key LIKE 'sync_account_restore_%'").get(),
    ).toBeUndefined();
  });

  it("rejects a missing meaning table instead of completing an otherwise empty snapshot", async () => {
    const error = Object.assign(new Error("Synthetic missing word-meaning table"), { code: "42P01" });
    failPage("user_word_meanings", "restore", 0, error);
    await expect(fullSync(db)).rejects.toBe(error);
    expect(
      sql.prepare("SELECT value FROM user_settings WHERE key LIKE 'sync_account_restore_%'").get(),
    ).toBeUndefined();
    expect(mockPending).not.toHaveBeenCalled();
  });

  it.each([
    ["first", 0],
    ["later", 500],
  ] as const)(
    "keeps successful card work but retries a %s-page incremental meaning failure from the old watermark",
    async (_label, offset) => {
      restoreComplete();
      putSetting("last_pull_at", OLD);
      if (offset === 500) {
        mockMeaningIncrementalRows.push(
          ...Array.from({ length: 500 }, (_, i) => meaning({ surah: 2 + Math.floor(i / 100), ayah: 1 + (i % 100) })),
        );
      }
      const error = new Error("Synthetic incremental word meaning failure " + offset);
      failPage("user_word_meanings", "incremental", offset, error);
      mockIncrementalCards = [{ ...card(), updated_at: NEW, due: NEW }];
      putMeaning(meaning({ meaning: "keep local incremental meaning", updated_at: OLD }));
      const initialQueue = snapshot().queue;

      await expect(fullSync(db)).resolves.toMatchObject({ accountRestored: false });
      expect(sql.prepare("SELECT state,updated_at FROM study_cards WHERE id='2:255'").get()).toEqual({
        state: State.Review,
        updated_at: NEW,
      });
      expect(
        sql.prepare("SELECT meaning FROM user_word_meanings WHERE surah=2 AND ayah=256 AND word_pos=1").get(),
      ).toEqual({
        meaning: "keep local incremental meaning",
      });
      expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()).toEqual({ value: OLD });
      expect(snapshot().queue).toEqual(initialQueue);

      mockQueryErrors.clear();
      mockMeaningIncrementalRows.length = 0;
      mockMeaningIncrementalRows.push(meaning({ meaning: "downloaded after retry", ayah: 257 }));
      mockIncrementalCards = [];
      const retry = await fullSync(db);
      expect(retry.accountRestored).toBe(false);
      expect(requests.filter((r) => r.table === "user_word_meanings" && r.incremental).map((r) => r.since)).toEqual(
        offset === 500 ? [OLD, OLD, OLD] : [OLD, OLD],
      );
      expect(
        sql.prepare("SELECT meaning FROM user_word_meanings WHERE surah=2 AND ayah=257 AND word_pos=1").get(),
      ).toEqual({
        meaning: "downloaded after retry",
      });
      expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()?.value).not.toBe(OLD);
    },
  );

  it("restores valid remote meanings after a failed snapshot can be retried", async () => {
    putMeaning(meaning({ meaning: "keep until a complete snapshot", updated_at: OLD }));
    mockRestoreCards = [card("synthetic-remote-card")];
    const error = new Error("Synthetic retryable snapshot failure");
    failPage("user_word_meanings", "restore", 0, error);
    await expect(fullSync(db)).rejects.toBe(error);
    expect(sql.prepare("SELECT meaning FROM user_word_meanings").get()).toEqual({
      meaning: "keep until a complete snapshot",
    });
    mockQueryErrors.clear();
    mockMeaningRestoreRows.push(meaning({ meaning: "restored from a complete snapshot" }));
    await expect(fullSync(db)).resolves.toMatchObject({ pulled: 2, accountRestored: true, localDataReplaced: true });
    expect(sql.prepare("SELECT surah,ayah,word_pos,meaning,updated_at FROM user_word_meanings").get()).toEqual({
      surah: 2,
      ayah: 256,
      word_pos: 1,
      meaning: "restored from a complete snapshot",
      updated_at: NEW,
    });
    expect(sql.prepare("SELECT value FROM user_settings WHERE key LIKE 'sync_account_restore_%'").get()).toEqual({
      value: "true",
    });
  });

  it("advances the watermark when the meaning table succeeds with no rows", async () => {
    restoreComplete();
    putSetting("last_pull_at", OLD);
    mockMeaningIncrementalRows.length = 0;
    await fullSync(db);
    expect(requests.some((r) => r.table === "user_word_meanings" && r.incremental && r.since === OLD)).toBe(true);
    expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()?.value).not.toBe(OLD);
  });
});
