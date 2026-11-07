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
let mockRestoreHighlights: unknown[] = [];
let mockIncrementalHighlights: unknown[] = [];
const mockTableRows = new Map<string, unknown[]>();
const mockRawResponses = new Map<string, unknown>();
const requests: { table: string; incremental: boolean; offset: number; since: string | null }[] = [];
const mockMeaningRestoreRows: unknown[] = [];
const mockMeaningIncrementalRows: unknown[] = [];
const mockQueryErrors = new Map<string, Error>();
let rangeHook: ((table: string, incremental: boolean) => void) | null = null;
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
    if (mockRawResponses.has(key)) return { data: mockRawResponses.get(key), error: null };
    const rows =
      mockTableRows.get(`${this.table}:${this.incremental ? "incremental" : "restore"}`) ??
      (this.table === "study_cards"
        ? this.incremental
          ? mockIncrementalCards
          : mockRestoreCards
        : this.table === "user_word_meanings"
          ? this.incremental
            ? mockMeaningIncrementalRows
            : mockMeaningRestoreRows
          : this.table === "highlights"
            ? this.incremental
              ? mockIncrementalHighlights
              : mockRestoreHighlights
            : []);
    const wireRows = rows.map((row) => {
      if (
        row === null ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        Object.getPrototypeOf(row) !== Object.prototype
      ) {
        return row;
      }
      return { synced_at: NEW, ...row };
    });
    const eligibleRows = this.incremental
      ? wireRows.filter(
          (row) =>
            row !== null &&
            typeof row === "object" &&
            "synced_at" in row &&
            typeof row.synced_at === "string" &&
            this.since !== null &&
            row.synced_at > this.since,
        )
      : wireRows;
    rangeHook?.(this.table, this.incremental);
    return { data: eligibleRows.slice(start, end + 1), error: null };
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
  getPendingSyncCount:
    jest.requireActual<typeof import("@/lib/database/sync-queue")>("@/lib/database/sync-queue").getPendingSyncCount,
  enqueueSync: jest.fn(async () => {}),
  markSynced: jest.fn(async () => {}),
  markFailed: jest.fn(async () => {}),
  cleanSyncedEntries: jest.fn(async () => {}),
}));
jest.mock("@/lib/achievements/queries", () => ({
  backfillAchievements: () => mockBackfill(),
  insertRemoteAchievementUnlock:
    jest.requireActual<typeof import("@/lib/achievements/queries")>("@/lib/achievements/queries")
      .insertRemoteAchievementUnlock,
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
  const personalNotePayload = JSON.stringify({
    id: "synthetic-note",
    surah: 2,
    ayah_start: 255,
    ayah_end: 255,
    content: "synthetic queued personal note",
    created_at: OLD,
    updated_at: OLD,
    deleted_at: null,
  });
  sql
    .prepare(
      "INSERT INTO sync_queue (table_name,operation,row_id,data,status,created_at) VALUES ('private_notes','UPDATE','synthetic-note',?,'pending',?)",
    )
    .run(personalNotePayload, OLD);
}
function failPage(table: string, mode: "restore" | "incremental", offset: number, error: Error) {
  mockQueryErrors.set(`${table}:${mode}:${offset}`, error);
}
function snapshot() {
  return {
    cards: sql.prepare("SELECT * FROM study_cards ORDER BY id").all(),
    highlights: sql.prepare("SELECT * FROM highlights ORDER BY id").all(),
    notes: sql.prepare("SELECT * FROM private_notes ORDER BY id").all(),
    meanings: sql.prepare("SELECT * FROM user_word_meanings ORDER BY surah,ayah,word_pos").all(),
    settings: sql.prepare("SELECT * FROM user_settings ORDER BY key").all(),
    logs: sql.prepare("SELECT * FROM study_log ORDER BY id").all(),
    bookmarks: sql.prepare("SELECT * FROM bookmarks ORDER BY surah,ayah").all(),
    journey: sql.prepare("SELECT * FROM reflection_journey_entries ORDER BY level_id").all(),
    achievements: sql.prepare("SELECT * FROM achievement_unlocks ORDER BY achievement_id").all(),
    qfQueue: sql.prepare("SELECT * FROM qf_sync_queue ORDER BY id").all(),
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
  mockTableRows.clear();
  mockRawResponses.clear();
  mockRestoreCards = [];
  mockIncrementalCards = [];
  mockRestoreHighlights = [];
  mockIncrementalHighlights = [];
  mockMeaningRestoreRows.length = 0;
  mockMeaningIncrementalRows.length = 0;
  mockQueryErrors.clear();
  rangeHook = null;
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

      await expect(fullSync(db)).resolves.toMatchObject({
        status: "partial",
        pulled: offset + 1,
        accountRestored: false,
      });
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
      mockRestoreHighlights = [];
      mockIncrementalHighlights = [];
      const retry = await fullSync(db);
      expect(retry).toMatchObject({ status: "synced", pulled: 1, accountRestored: false });
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

describe("sync cursor snapshot windows", () => {
  const T_PREVIOUS = "2026-03-01T00:00:00.000Z";
  const T0 = "2026-03-02T00:00:00.000Z";
  const T1 = "2026-03-02T00:00:01.000Z";
  const T2 = "2026-03-02T00:00:02.000Z";

  it("recovers a meaning written after its incremental table read on the next fullSync", async () => {
    restoreComplete();
    putSetting("last_pull_at", T_PREVIOUS);
    jest.useFakeTimers();
    jest.setSystemTime(new Date(T0));
    let inserted = false;
    rangeHook = (table, incremental) => {
      if (table === "study_cards" && incremental && !inserted) {
        inserted = true;
        jest.setSystemTime(new Date(T1));
        mockMeaningIncrementalRows.push(
          meaning({ ayah: 258, meaning: "arrived during later table read", updated_at: T1, synced_at: T1 }),
        );
      }
      if (table === "achievement_unlocks" && incremental) jest.setSystemTime(new Date(T2));
    };

    try {
      await fullSync(db);
      const firstCursor = sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()?.value;
      requests.length = 0;
      await fullSync(db);

      expect(
        sql.prepare("SELECT meaning FROM user_word_meanings WHERE surah=2 AND ayah=258 AND word_pos=1").get(),
      ).toEqual({
        meaning: "arrived during later table read",
      });
      expect(firstCursor).toBe(T0);
      expect(requests.find((request) => request.table === "user_word_meanings" && request.incremental)?.since).toBe(
        firstCursor,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(["empty", "nonempty"] as const)(
    "catches a meaning written during the later study-card read in the same %s restore fullSync",
    async (restoreKind) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(T0));
      const remoteMeaning = meaning({
        ayah: 259,
        meaning: "snapshot meaning",
        updated_at: T_PREVIOUS,
        synced_at: T_PREVIOUS,
      });
      if (restoreKind === "nonempty") {
        mockRestoreCards = [card("synthetic-remote-card")];
        mockMeaningRestoreRows.push(remoteMeaning);
        mockMeaningIncrementalRows.push(remoteMeaning);
      }
      let changed = false;
      rangeHook = (table, incremental) => {
        if (table === "study_cards" && !incremental && !changed) {
          changed = true;
          jest.setSystemTime(new Date(T1));
          if (restoreKind === "empty") {
            mockMeaningIncrementalRows.push(
              meaning({ ayah: 260, meaning: "late restore meaning", updated_at: T1, synced_at: T1 }),
            );
          } else {
            Object.assign(remoteMeaning, {
              meaning: "late updated meaning",
              updated_at: T1,
              synced_at: T1,
            });
          }
        }
        if (table === "achievement_unlocks" && !incremental) jest.setSystemTime(new Date(T2));
      };

      try {
        await fullSync(db);
        const target = restoreKind === "empty" ? 260 : 259;
        const expected = restoreKind === "empty" ? "late restore meaning" : "late updated meaning";
        expect(
          sql.prepare("SELECT meaning FROM user_word_meanings WHERE surah=2 AND ayah=? AND word_pos=1").get(target),
        ).toEqual({ meaning: expected });
        expect(requests.find((request) => request.table === "user_word_meanings" && request.incremental)?.since).toBe(
          T0,
        );
        expect(
          sql.prepare("SELECT updated_at FROM user_settings WHERE key LIKE 'sync_account_restore_%'").get(),
        ).toEqual({ updated_at: T2 });
      } finally {
        jest.useRealTimers();
      }
    },
  );
});

const HIGHLIGHT_DELETION_TIME = "2026-01-15T00:00:00.000Z";
const HIGHLIGHT_CANONICAL_ID = "highlight:2:255:ayah:ayah:yellow";
function highlightRow(syncId: string, updatedAt: string | null, ayah = 255): Record<string, SQLInputValue> {
  return {
    sync_id: syncId,
    surah: 2,
    ayah,
    word_start: null,
    word_end: null,
    color: "yellow",
    created_at: OLD,
    updated_at: updatedAt,
    deleted_at: null,
  };
}
function putHighlight(row: Record<string, SQLInputValue>) {
  const columns = Object.keys(row);
  sql
    .prepare(`INSERT INTO highlights (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
    .run(...Object.values(row));
}
function highlightRows() {
  return sql.prepare("SELECT * FROM highlights ORDER BY id").all();
}
function remoteHighlightDeletion(overrides: Record<string, SQLInputValue> = {}) {
  return {
    ...highlightRow(HIGHLIGHT_CANONICAL_ID, HIGHLIGHT_DELETION_TIME),
    deleted_at: HIGHLIGHT_DELETION_TIME,
    synced_at: NEW,
    ...overrides,
  };
}

it.each(
  ["canonical", "opaque", "missing"].flatMap((identity) =>
    [false, true].map((newerFirst) => ({ identity, newerFirst })),
  ),
)(
  "applies highlight tombstones per target for $identity IDs with newerFirst=$newerFirst",
  async ({ identity, newerFirst }) => {
    restoreComplete();
    const oldId = identity === "opaque" ? "opaque imported highlight" : HIGHLIGHT_CANONICAL_ID;
    const newId = oldId + ":101";
    const older = highlightRow(oldId, OLD);
    const newer = highlightRow(newId, NEW);
    for (const row of newerFirst ? [newer, older] : [older, newer]) putHighlight(row);
    const preserved = sql.prepare("SELECT * FROM highlights WHERE sync_id=?").get(newId);
    mockIncrementalHighlights.push(remoteHighlightDeletion({ sync_id: identity === "missing" ? null : oldId }));
    await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });
    expect(highlightRows()).toEqual([preserved]);
    expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()).not.toEqual({ value: OLD });
  },
);

it.each([
  { label: "equal", updatedAt: HIGHLIGHT_DELETION_TIME, retained: true },
  { label: "null", updatedAt: null, retained: false },
  { label: "empty", updatedAt: "", retained: false },
])("keeps highlight timestamp precedence for a $label local timestamp", async ({ updatedAt, retained }) => {
  restoreComplete();
  putHighlight(highlightRow(HIGHLIGHT_CANONICAL_ID, OLD));
  putHighlight(highlightRow(HIGHLIGHT_CANONICAL_ID + ":101", updatedAt));
  const sibling = highlightRows()[1];
  mockIncrementalHighlights.push(remoteHighlightDeletion());
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });
  expect(highlightRows()).toEqual(retained ? [sibling] : []);
});

it("protects a newer ID match when another older row matches the deletion coordinates", async () => {
  restoreComplete();
  putHighlight(highlightRow(HIGHLIGHT_CANONICAL_ID, OLD));
  const protectedId = "opaque newer highlight";
  putHighlight(highlightRow(protectedId, NEW, 256));
  const preserved = highlightRows()[1];
  mockIncrementalHighlights.push(remoteHighlightDeletion({ sync_id: protectedId }));
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });
  expect(highlightRows()).toEqual([preserved]);
});

it.each([
  { field: "created_at", created_at: HIGHLIGHT_DELETION_TIME, synced_at: NEW },
  { field: "synced_at", created_at: null, synced_at: HIGHLIGHT_DELETION_TIME },
])("keeps the existing highlight deletion timestamp fallback to $field", async ({ created_at, synced_at }) => {
  restoreComplete();
  putHighlight(highlightRow(HIGHLIGHT_CANONICAL_ID, OLD));
  putHighlight(highlightRow(HIGHLIGHT_CANONICAL_ID + ":101", NEW));
  const preserved = highlightRows()[1];
  mockIncrementalHighlights.push(remoteHighlightDeletion({ updated_at: null, created_at, synced_at }));
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });
  expect(highlightRows()).toEqual([preserved]);
});

const malformedHighlightTombstones: {
  field: "updated_at" | "deleted_at";
  overrides: Record<string, SQLInputValue>;
}[] = [
  {
    field: "updated_at",
    overrides: { updated_at: "9999-not-a-date", deleted_at: HIGHLIGHT_DELETION_TIME },
  },
  {
    field: "deleted_at",
    overrides: { updated_at: HIGHLIGHT_DELETION_TIME, deleted_at: "not-a-date" },
  },
];

function seedDuplicateHighlights() {
  putHighlight(highlightRow(HIGHLIGHT_CANONICAL_ID, OLD));
  putHighlight(highlightRow(HIGHLIGHT_CANONICAL_ID + ":newer", NEW));
}

it.each(
  malformedHighlightTombstones.flatMap((entry) =>
    (["restore", "incremental"] as const).map((mode) => ({ ...entry, mode })),
  ),
)(
  "rejects a highlight tombstone with malformed truthy $field during $mode before local mutation",
  async ({ field, overrides, mode }) => {
    seedDuplicateHighlights();
    putQueueRow();
    const payload = remoteHighlightDeletion(overrides);
    if (mode === "restore") mockRestoreHighlights.push(payload);
    else {
      restoreComplete();
      mockIncrementalHighlights.push(payload);
    }
    const before = snapshot();
    writes.length = 0;

    if (mode === "restore") {
      await expect(fullSync(db)).rejects.toThrow();
      expect(mockPending).not.toHaveBeenCalled();
      expect(transactions).toBe(0);
      expect(writes).toEqual([]);
    } else {
      await expect(fullSync(db)).resolves.toMatchObject({ status: "failed", pulled: 0 });
      expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()).toEqual({ value: OLD });
      expect(mockPending).toHaveBeenCalled();
    }

    expect(snapshot()).toEqual(before);
    expect(highlightRows()).toHaveLength(2);
    expect(snapshot().queue).toEqual(before.queue);
    expect(snapshot().notes).toEqual(before.notes);
  },
);

it("retains the legacy unrestricted deletion when resolved highlight updated_at is empty", async () => {
  restoreComplete();
  putHighlight(highlightRow(HIGHLIGHT_CANONICAL_ID, OLD));
  putHighlight(highlightRow(HIGHLIGHT_CANONICAL_ID + ":101", NEW));
  mockIncrementalHighlights.push(remoteHighlightDeletion({ updated_at: "" }));
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });
  expect(highlightRows()).toEqual([]);
});

const boundaryRows: Record<string, Record<string, unknown>> = {
  user_settings: { key: "daily_review_limit", value: "30", updated_at: NEW },
  user_word_meanings: meaning(),
  study_cards: card("boundary-card"),
  study_log: {
    card_id: "boundary-card",
    rating: 3,
    state: 2,
    due: NEW,
    stability: 1,
    difficulty: 2,
    elapsed_days: 1,
    scheduled_days: 1,
    reviewed_at: NEW,
  },
  bookmarks: { surah: 2, ayah: 255, created_at: OLD, updated_at: NEW },
  highlights: highlightRow("boundary-highlight", NEW),
  private_notes: {
    id: "boundary-note",
    surah: 2,
    ayah_start: 255,
    ayah_end: 255,
    content: "synthetic boundary",
    created_at: OLD,
    updated_at: NEW,
    deleted_at: null,
  },
  reflection_journey_entries: {
    level_id: "boundary-level",
    status: "draft",
    response_text: "",
    created_at: OLD,
    updated_at: NEW,
    completed_at: null,
  },
  achievement_unlocks: { achievement_id: "boundary-badge", unlocked_at: NEW, public_payload: {} },
};

it.each(
  Object.keys(boundaryRows).flatMap((table) => (["restore", "incremental"] as const).map((mode) => ({ table, mode }))),
)("rejects a valid prefix and malformed row in $table during $mode before any page write", async ({ table, mode }) => {
  if (mode === "incremental") restoreComplete();
  putQueueRow();
  const row = boundaryRows[table];
  mockTableRows.set(`${table}:${mode}`, [row, { ...row, user_id: "foreign-owner" }]);
  const before = snapshot();
  writes.length = 0;
  if (mode === "restore") await expect(fullSync(db)).rejects.toThrow();
  else await expect(fullSync(db)).resolves.toMatchObject({ status: "failed", pulled: 0 });
  expect(snapshot()).toEqual(before);
  expect(transactions).toBe(0);
  expect(writes).toEqual([]);
});

it.each(Object.keys(boundaryRows))("rejects a malformed later %s restore page before replacement", async (table) => {
  putQueueRow();
  const row = boundaryRows[table];
  mockTableRows.set(`${table}:restore`, [
    ...Array.from({ length: 500 }, () => row),
    { ...row, synced_at: "not-a-date" },
  ]);
  const before = snapshot();
  writes.length = 0;
  await expect(fullSync(db)).rejects.toThrow();
  expect(requests.filter((r) => r.table === table).map((r) => r.offset)).toEqual([0, 500]);
  expect(snapshot()).toEqual(before);
  expect(writes).toEqual([]);
  expect(transactions).toBe(0);
});

it.each([null, {}, { length: 0 }])("rejects non-array account results %p before replacement", async (data) => {
  putQueueRow();
  mockRawResponses.set("highlights:restore:0", data);
  const before = snapshot();
  await expect(fullSync(db)).rejects.toThrow();
  expect(snapshot()).toEqual(before);
  expect(transactions).toBe(0);
  expect(writes).toEqual([]);
});

it("keeps committed page counts and the cursor when a later incremental page is malformed, then retries", async () => {
  restoreComplete();
  putQueueRow();
  const row = boundaryRows.private_notes;
  const valid = Array.from({ length: 501 }, (_, i) => ({ ...row, id: `boundary-note-${i}` }));
  mockTableRows.set("private_notes:incremental", [...valid.slice(0, 500), { ...valid[500], updated_at: "invalid" }]);
  const queueBefore = sql.prepare("SELECT * FROM sync_queue ORDER BY id").all();
  await expect(fullSync(db)).resolves.toMatchObject({ status: "partial", pulled: 500 });
  expect(sql.prepare("SELECT COUNT(*) AS count FROM private_notes WHERE id LIKE 'boundary-note-%'").get()).toEqual({
    count: 500,
  });
  expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()).toEqual({ value: OLD });
  expect(sql.prepare("SELECT * FROM sync_queue ORDER BY id").all()).toEqual(queueBefore);
  mockTableRows.set("private_notes:incremental", valid);
  await expect(fullSync(db)).resolves.toMatchObject({ status: "partial", pulled: 501 });
  expect(sql.prepare("SELECT COUNT(*) AS count FROM private_notes WHERE id LIKE 'boundary-note-%'").get()).toEqual({
    count: 501,
  });
  expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()?.value).not.toBe(OLD);
  expect(sql.prepare("SELECT * FROM sync_queue ORDER BY id").all()).toEqual(queueBefore);
});

it.each(
  Object.keys(boundaryRows).flatMap((table) => (["restore", "incremental"] as const).map((mode) => ({ table, mode }))),
)("applies a valid $table row during $mode", async ({ table, mode }) => {
  if (mode === "incremental") restoreComplete();
  mockTableRows.set(`${table}:${mode}`, [boundaryRows[table]]);
  const result = await fullSync(db);
  expect(result).toMatchObject({ status: "synced", pulled: 1, accountRestored: mode === "restore" });
  const keys: Record<string, string[]> = {
    user_settings: ["key"],
    user_word_meanings: ["surah", "ayah", "word_pos"],
    study_cards: ["id"],
    study_log: ["card_id", "reviewed_at"],
    bookmarks: ["surah", "ayah"],
    highlights: ["sync_id"],
    private_notes: ["id"],
    reflection_journey_entries: ["level_id"],
    achievement_unlocks: ["achievement_id"],
  };
  const incoming = boundaryRows[table];
  const selected = sql
    .prepare(`SELECT * FROM ${table} WHERE ${keys[table].map((key) => key + " = ?").join(" AND ")}`)
    .get(...keys[table].map((key) => incoming[key] as SQLInputValue));
  const expected = table === "achievement_unlocks" ? { ...incoming, public_payload: "{}" } : incoming;
  expect(selected).toMatchObject(expected);
  expect(transactions).toBe(1);
});
