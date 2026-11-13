import { localDateOf } from "@/lib/habit/dates";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { AppDatabase, TransactionDatabase } from "@/lib/database/types";
import type { Session } from "@supabase/supabase-js";
import { observeAuthSession } from "@/lib/auth/commands";
import { createSchema } from "@/lib/database/schema";
import { fullSync } from "@/lib/database/sync";
import { State } from "@/lib/fsrs/scheduler";
import { getReviewStats } from "@/lib/fsrs/queries";

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
let beforeHighlightDelete: (() => void) | null = null;
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
let db: AppDatabase;
let transactions = 0;
let studyLogTimestampCandidateQueries = 0;
let studyLogTimestampCandidateRowsLoaded = 0;
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
function studyLogRow(overrides: Record<string, SQLInputValue> = {}): Record<string, SQLInputValue> {
  return {
    card_id: "2:255",
    rating: 3,
    state: State.Review,
    due: OLD,
    stability: 5,
    difficulty: 4,
    elapsed_days: 1,
    scheduled_days: 1,
    reviewed_at: NEW,
    ...overrides,
  };
}
function insertStudyLog(row: Record<string, SQLInputValue>) {
  const columns = Object.keys(row);
  sql
    .prepare(`INSERT INTO study_log (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
    .run(...Object.values(row));
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
  beforeHighlightDelete = null;
  transactions = 0;
  studyLogTimestampCandidateQueries = 0;
  studyLogTimestampCandidateRowsLoaded = 0;
  sql = new DatabaseSync(":memory:");
  const adapter = {
    execAsync: async (source: string) => {
      sql.exec(source);
    },
    getFirstAsync: async (source: string, params: SQLInputValue[] = []) => sql.prepare(source).get(...params) ?? null,
    getAllAsync: async (source: string, params: SQLInputValue[] = []) => {
      const rows = sql.prepare(source).all(...params);
      const normalizedSql = source.replace(/\s+/g, " ").trim().toLowerCase();
      // The per-card timestamp candidate scan, not the one-pass wird-day reconcile after restore.
      if (normalizedSql.startsWith("select reviewed_at from study_log where card_id")) {
        studyLogTimestampCandidateQueries += 1;
        studyLogTimestampCandidateRowsLoaded += rows.length;
      }
      return rows;
    },
    runAsync: async (source: string, params: SQLInputValue[] = []) => {
      writes.push(source);
      if (source.trimStart().toUpperCase().startsWith("DELETE FROM HIGHLIGHTS") && beforeHighlightDelete) {
        const interleave = beforeHighlightDelete;
        beforeHighlightDelete = null;
        interleave();
      }
      return sql.prepare(source).run(...params);
    },
    withTransactionAsync: async (work: (transaction: TransactionDatabase) => Promise<void>) => {
      transactions += 1;
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
  // Only this isolated boundary adapts the wider Expo API to real Node SQLite.
  db = adapter as unknown as AppDatabase;
  await createSchema(db);
  putSetting(`sync_initial_backfill_${USER_ID}_20260525_sync_v1`, "true");
  putSetting(`sync_user_settings_backfill_${USER_ID}_20260528_user_settings_v1`, "true");
  putSetting(`sync_habit_backfill_${USER_ID}_20261113_habit_v1`, "true");
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
type TimestampConflictTarget = {
  label: string;
  table: string;
  seedLocal: (updatedAt: string) => void;
  remoteRow: (updatedAt: string) => unknown;
  readValue: () => unknown;
  localResult: unknown;
  remoteResult: unknown;
};

const timestampConflictTargets: TimestampConflictTarget[] = [
  {
    label: "user settings",
    table: "user_settings",
    seedLocal: (updatedAt) =>
      sql
        .prepare("INSERT INTO user_settings (key,value,updated_at) VALUES ('daily_review_limit','local',?)")
        .run(updatedAt),
    remoteRow: (updatedAt) => ({ key: "daily_review_limit", value: "remote", updated_at: updatedAt, deleted_at: null }),
    readValue: () => sql.prepare("SELECT value FROM user_settings WHERE key='daily_review_limit'").get()?.value,
    localResult: "local",
    remoteResult: "remote",
  },
  {
    label: "word meanings",
    table: "user_word_meanings",
    seedLocal: (updatedAt) => putMeaning(meaning({ meaning: "local", updated_at: updatedAt })),
    remoteRow: (updatedAt) => meaning({ meaning: "remote", updated_at: updatedAt }),
    readValue: () =>
      sql.prepare("SELECT meaning FROM user_word_meanings WHERE surah=2 AND ayah=256 AND word_pos=1").get()?.meaning,
    localResult: "local",
    remoteResult: "remote",
  },
  {
    label: "study cards",
    table: "study_cards",
    seedLocal: (updatedAt) => sql.prepare("UPDATE study_cards SET updated_at=? WHERE id='2:255'").run(updatedAt),
    remoteRow: (updatedAt) => ({ ...card(), state: State.New, updated_at: updatedAt }),
    readValue: () => sql.prepare("SELECT state FROM study_cards WHERE id='2:255'").get()?.state,
    localResult: State.Review,
    remoteResult: State.New,
  },
  {
    label: "bookmarks",
    table: "bookmarks",
    seedLocal: (updatedAt) =>
      sql.prepare("INSERT INTO bookmarks (surah,ayah,created_at,updated_at) VALUES (2,255,?,?)").run(OLD, updatedAt),
    remoteRow: (updatedAt) => ({ surah: 2, ayah: 255, created_at: OLD, updated_at: updatedAt, deleted_at: null }),
    readValue: () => sql.prepare("SELECT updated_at FROM bookmarks WHERE surah=2 AND ayah=255").get()?.updated_at,
    localResult: (updatedAt: string) => updatedAt,
    remoteResult: (updatedAt: string) => updatedAt,
  },
  {
    label: "highlights",
    table: "highlights",
    seedLocal: (updatedAt) => putHighlight(highlightRow(HIGHLIGHT_CANONICAL_ID, updatedAt)),
    remoteRow: (updatedAt) => highlightRow(HIGHLIGHT_CANONICAL_ID, updatedAt),
    readValue: () =>
      sql.prepare("SELECT updated_at FROM highlights WHERE sync_id=?").get(HIGHLIGHT_CANONICAL_ID)?.updated_at,
    localResult: (updatedAt: string) => updatedAt,
    remoteResult: (updatedAt: string) => updatedAt,
  },
  {
    label: "private notes",
    table: "private_notes",
    seedLocal: (updatedAt) =>
      sql.prepare("UPDATE private_notes SET content='local',updated_at=? WHERE id='synthetic-note'").run(updatedAt),
    remoteRow: (updatedAt) => ({
      id: "synthetic-note",
      surah: 2,
      ayah_start: 255,
      ayah_end: 255,
      content: "remote",
      created_at: OLD,
      updated_at: updatedAt,
      deleted_at: null,
    }),
    readValue: () => sql.prepare("SELECT content FROM private_notes WHERE id='synthetic-note'").get()?.content,
    localResult: "local",
    remoteResult: "remote",
  },
  {
    label: "reflection journey",
    table: "reflection_journey_entries",
    seedLocal: (updatedAt) =>
      sql
        .prepare(
          "INSERT INTO reflection_journey_entries (level_id,status,response_text,created_at,updated_at) VALUES ('synthetic-level','draft','local',?,?)",
        )
        .run(OLD, updatedAt),
    remoteRow: (updatedAt) => ({
      level_id: "synthetic-level",
      status: "completed",
      response_text: "remote",
      created_at: OLD,
      updated_at: updatedAt,
    }),
    readValue: () =>
      sql.prepare("SELECT response_text FROM reflection_journey_entries WHERE level_id='synthetic-level'").get()
        ?.response_text,
    localResult: "local",
    remoteResult: "remote",
  },
];

const offsetConflictDirections = [
  {
    label: "older remote text sorts later",
    local: "2026-06-01T00:00:00-04:00",
    remote: "2026-06-01T03:00:00Z",
    winner: "local",
  },
  {
    label: "newer remote text sorts earlier",
    local: "2026-06-01T04:00:00+03:00",
    remote: "2026-06-01T02:00:00Z",
    winner: "remote",
  },
] as const;

it.each(
  timestampConflictTargets.flatMap((target) => offsetConflictDirections.map((direction) => ({ target, direction }))),
)("uses instant order for $target.label when $direction.label", async ({ target, direction }) => {
  restoreComplete();
  target.seedLocal(direction.local);
  mockTableRows.set(target.table + ":incremental", [target.remoteRow(direction.remote)]);

  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced" });

  const localResult =
    typeof target.localResult === "function" ? target.localResult(direction.local) : target.localResult;
  const remoteResult =
    typeof target.remoteResult === "function" ? target.remoteResult(direction.remote) : target.remoteResult;
  expect(target.readValue()).toBe(direction.winner === "local" ? localResult : remoteResult);
});

it.each([
  {
    label: "newer remote beyond local millisecond",
    local: "2026-06-01T00:00:00.100Z",
    remote: "2026-06-01T00:00:00.1001+00:00",
    winner: "remote",
  },
  {
    label: "older remote below local sub-millisecond",
    local: "2026-06-01T00:00:00.1001+00:00",
    remote: "2026-06-01T00:00:00.100Z",
    winner: "local",
  },
  {
    label: "equal instant with fractional trailing zeros",
    local: "2026-06-01T02:00:00.1000+00:00",
    remote: "2026-06-01T02:00:00.1Z",
    winner: "local",
  },
])("compares card conflict by exact fractional instant: $label", async ({ local, remote, winner }) => {
  restoreComplete();
  sql.prepare("UPDATE study_cards SET updated_at=? WHERE id='2:255'").run(local);
  mockIncrementalCards = [{ ...card(), state: State.New, updated_at: remote }];

  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced" });

  expect(sql.prepare("SELECT state,updated_at FROM study_cards WHERE id='2:255'").get()).toEqual(
    winner === "local" ? { state: State.Review, updated_at: local } : { state: State.New, updated_at: remote },
  );
});

it("retains a row and cursor on malformed local time, then retries after manual repair", async () => {
  restoreComplete();
  const malformed = "not-an-iso-timestamp";
  sql.prepare("UPDATE study_cards SET updated_at=? WHERE id='2:255'").run(malformed);
  mockIncrementalCards = [{ ...card(), state: State.New, updated_at: "2026-06-01T00:00:00.1001Z" }];
  const before = snapshot();

  const failed = await fullSync(db);

  expect(failed).toMatchObject({ status: "failed", pulled: 0 });
  expect(snapshot()).toEqual(before);
  expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()).toEqual({ value: OLD });

  const repaired = "2026-06-01T00:00:00.100Z";
  sql.prepare("UPDATE study_cards SET updated_at=? WHERE id='2:255'").run(repaired);
  const retried = await fullSync(db);

  expect(retried).toMatchObject({ status: "synced", pulled: 1 });
  expect(sql.prepare("SELECT state,updated_at FROM study_cards WHERE id='2:255'").get()).toEqual({
    state: State.New,
    updated_at: "2026-06-01T00:00:00.1001Z",
  });
});

it("does not duplicate an incremental review with an equivalent timestamp spelling", async () => {
  restoreComplete();
  insertStudyLog({
    id: 71,
    ...studyLogRow({ card_id: "review-equivalent", reviewed_at: "2026-06-01T04:00:00+02:00", rating: 3 }),
    sync_status: "pending",
  });
  const original = sql.prepare("SELECT * FROM study_log WHERE id=71").get();
  mockTableRows.set("study_log:incremental", [
    studyLogRow({ card_id: "review-equivalent", reviewed_at: "2026-06-01T02:00:00Z", rating: 1 }),
  ]);

  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });

  const rows = sql.prepare("SELECT * FROM study_log WHERE card_id='review-equivalent'").all();
  const stats = await getReviewStats(db);
  expect({ rows, totalReviews: stats.totalReviews }).toEqual({ rows: [original], totalReviews: 1 });

  putSetting("last_pull_at", OLD);
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });
  expect(sql.prepare("SELECT * FROM study_log WHERE card_id='review-equivalent'").all()).toEqual([original]);
});

it("deduplicates an equivalent restore review across the 500-row page boundary", async () => {
  const first = studyLogRow({
    id: "9000000000000000001",
    card_id: "restore-equivalent",
    reviewed_at: "2026-06-01T04:00:00+02:00",
    rating: 3,
  });
  const otherEvents = Array.from({ length: 499 }, (_, index) =>
    studyLogRow({ card_id: `restore-distinct-${index}`, reviewed_at: "2026-06-01T12:00:00.123456789Z" }),
  );
  const equivalent = studyLogRow({
    id: "9000000000000000002",
    card_id: "restore-equivalent",
    reviewed_at: "2026-06-01T02:00:00.000Z",
    rating: 1,
  });
  mockTableRows.set("study_log:restore", [first, ...otherEvents, equivalent]);

  await expect(fullSync(db)).resolves.toMatchObject({
    status: "synced",
    pulled: 501,
    accountRestored: true,
  });

  expect(
    requests.filter((request) => request.table === "study_log" && !request.incremental).map((r) => r.offset),
  ).toEqual([0, 500]);
  const eventRows = sql
    .prepare("SELECT card_id,rating,reviewed_at,sync_status FROM study_log WHERE card_id='restore-equivalent'")
    .all();
  const candidateLoad = {
    queries: studyLogTimestampCandidateQueries,
    rows: studyLogTimestampCandidateRowsLoaded,
  };
  const stats = await getReviewStats(db);
  expect({ eventRows, totalReviews: stats.totalReviews, candidateLoad }).toEqual({
    eventRows: [{ card_id: "restore-equivalent", rating: 3, reviewed_at: first.reviewed_at, sync_status: "synced" }],
    totalReviews: 500,
    candidateLoad: { queries: 0, rows: 0 },
  });
});

it("preserves historical duplicate reviews when an equivalent incremental event arrives", async () => {
  restoreComplete();
  const first = {
    id: 81,
    ...studyLogRow({ card_id: "historical-duplicates", reviewed_at: "2026-06-01T04:00:00+02:00" }),
    sync_status: "pending",
  };
  const second = {
    id: 82,
    ...studyLogRow({ card_id: "historical-duplicates", reviewed_at: "2026-06-01T04:00:00+02:00", rating: 1 }),
    sync_status: "synced",
  };
  insertStudyLog(first);
  insertStudyLog(second);
  mockTableRows.set("study_log:incremental", [
    studyLogRow({ card_id: "historical-duplicates", reviewed_at: "2026-06-01T02:00:00.000Z", rating: 2 }),
  ]);

  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });

  const rows = sql.prepare("SELECT * FROM study_log WHERE card_id='historical-duplicates' ORDER BY id").all();
  const stats = await getReviewStats(db);
  // Rows written before review detail existed keep empty detail columns.
  const noDetail = {
    session_id: null,
    duration_ms: null,
    support_level: null,
    proposed_rating: null,
    grader: null,
    local_date: null,
    tz: null,
    error_count: 0,
    makeup_for: null,
  };
  expect({ rows, totalReviews: stats.totalReviews }).toEqual({
    rows: [
      { ...first, ...noDetail },
      { ...second, ...noDetail },
    ],
    totalReviews: 2,
  });
});

it("keeps distinct cards and sub-millisecond review instants", async () => {
  restoreComplete();
  insertStudyLog({
    id: 91,
    ...studyLogRow({ card_id: "fractional-review", reviewed_at: "2026-06-01T02:00:00.100Z", rating: 3 }),
    sync_status: "pending",
  });
  mockTableRows.set("study_log:incremental", [
    studyLogRow({ card_id: "fractional-review", reviewed_at: "2026-06-01T02:00:00.1001Z", rating: 1 }),
    studyLogRow({ card_id: "fractional-review", reviewed_at: "2026-06-01T04:00:00.10010+02:00", rating: 2 }),
    studyLogRow({ card_id: "fractional-review", reviewed_at: "2026-06-01T02:00:00.1002Z", rating: 4 }),
    studyLogRow({ card_id: "other-card", reviewed_at: "2026-06-01T02:00:00.1001Z", rating: 2 }),
  ]);

  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 4 });

  expect(sql.prepare("SELECT id,card_id,rating,reviewed_at,sync_status FROM study_log ORDER BY id").all()).toEqual([
    {
      id: 91,
      card_id: "fractional-review",
      rating: 3,
      reviewed_at: "2026-06-01T02:00:00.100Z",
      sync_status: "pending",
    },
    {
      id: 92,
      card_id: "fractional-review",
      rating: 1,
      reviewed_at: "2026-06-01T02:00:00.1001Z",
      sync_status: "synced",
    },
    {
      id: 93,
      card_id: "fractional-review",
      rating: 4,
      reviewed_at: "2026-06-01T02:00:00.1002Z",
      sync_status: "synced",
    },
    {
      id: 94,
      card_id: "other-card",
      rating: 2,
      reviewed_at: "2026-06-01T02:00:00.1001Z",
      sync_status: "synced",
    },
  ]);
});

it("fails closed on a malformed same-card review timestamp and retries after repair", async () => {
  restoreComplete();
  insertStudyLog({
    id: 101,
    ...studyLogRow({ card_id: "malformed-review", reviewed_at: "not-a-timestamp" }),
    sync_status: "pending",
  });
  putSetting("last_pull_at", OLD);
  mockTableRows.set("study_log:incremental", [
    studyLogRow({ card_id: "malformed-review", reviewed_at: "2026-06-01T02:00:00Z" }),
  ]);
  const before = snapshot();

  await expect(fullSync(db)).resolves.toMatchObject({ status: "failed", pulled: 0 });
  expect(snapshot()).toEqual(before);
  expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()).toEqual({ value: OLD });
  expect(studyLogTimestampCandidateRowsLoaded).toBe(1);

  sql.prepare("UPDATE study_log SET reviewed_at='2026-06-01T01:00:00Z' WHERE id=101").run();
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });
  expect(sql.prepare("SELECT card_id,reviewed_at FROM study_log ORDER BY id").all()).toEqual([
    { card_id: "malformed-review", reviewed_at: "2026-06-01T01:00:00Z" },
    { card_id: "malformed-review", reviewed_at: "2026-06-01T02:00:00Z" },
  ]);
});

it("rolls back an incremental review page after a later SQL insert failure and retries", async () => {
  restoreComplete();
  putSetting("last_pull_at", OLD);
  insertStudyLog({
    id: 115,
    ...studyLogRow({ card_id: "incremental-original", reviewed_at: OLD }),
    sync_status: "pending",
  });
  mockTableRows.set("study_log:incremental", [
    studyLogRow({ card_id: "incremental-before-trigger", reviewed_at: "2026-06-01T11:00:00Z" }),
    studyLogRow({ card_id: "incremental-trigger-failure", reviewed_at: "2026-06-01T12:00:00Z" }),
  ]);
  sql.exec(
    "CREATE TEMP TRIGGER fail_later_incremental_review BEFORE INSERT ON study_log " +
      "WHEN NEW.card_id='incremental-trigger-failure' BEGIN SELECT RAISE(ABORT,'RF157 incremental insert failure'); END",
  );
  const before = snapshot();

  await expect(fullSync(db)).resolves.toMatchObject({ status: "failed", pulled: 0 });
  expect(snapshot()).toEqual(before);
  expect(sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()).toEqual({ value: OLD });

  sql.exec("DROP TRIGGER fail_later_incremental_review");
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 2 });
  expect(sql.prepare("SELECT card_id,reviewed_at,sync_status FROM study_log ORDER BY id").all()).toEqual([
    { card_id: "incremental-original", reviewed_at: OLD, sync_status: "pending" },
    { card_id: "incremental-before-trigger", reviewed_at: "2026-06-01T11:00:00Z", sync_status: "synced" },
    { card_id: "incremental-trigger-failure", reviewed_at: "2026-06-01T12:00:00Z", sync_status: "synced" },
  ]);
});

it("keeps the literal review lookup ahead of unrelated malformed history", async () => {
  restoreComplete();
  insertStudyLog({
    id: 111,
    ...studyLogRow({ card_id: "literal-review", reviewed_at: "malformed-local-history" }),
    sync_status: "pending",
  });
  insertStudyLog({
    id: 112,
    ...studyLogRow({ card_id: "literal-review", reviewed_at: "2026-06-01T02:00:00Z" }),
    sync_status: "synced",
  });
  mockTableRows.set("study_log:incremental", [
    studyLogRow({ card_id: "literal-review", reviewed_at: "2026-06-01T02:00:00Z" }),
  ]);

  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });

  expect(sql.prepare("SELECT id FROM study_log WHERE card_id='literal-review' ORDER BY id").all()).toEqual([
    { id: 111 },
    { id: 112 },
  ]);
  expect(studyLogTimestampCandidateRowsLoaded).toBe(0);
});

it("preserves local history on an empty account restore", async () => {
  insertStudyLog({
    id: 121,
    ...studyLogRow({ card_id: "empty-restore-history" }),
    sync_status: "pending",
  });
  putQueueRow();
  const beforeLogs = sql.prepare("SELECT * FROM study_log ORDER BY id").all();
  const beforeQueue = snapshot().queue;

  await fullSync(db);

  expect(sql.prepare("SELECT * FROM study_log ORDER BY id").all()).toEqual(beforeLogs);
  expect(snapshot().queue).toEqual(beforeQueue);
  expect(transactions).toBe(0);
});

it("discards restore duplicate keys when a later insert rolls back, then retries cleanly", async () => {
  insertStudyLog({
    id: 131,
    ...studyLogRow({ card_id: "old-review-history" }),
    sync_status: "pending",
  });
  putQueueRow();
  mockTableRows.set("study_log:restore", [
    studyLogRow({ card_id: "restore-before-trigger", reviewed_at: "2026-06-01T04:00:00+02:00", rating: 3 }),
    studyLogRow({ card_id: "trigger-failure", reviewed_at: "2026-06-01T12:00:00Z", rating: 2 }),
  ]);
  sql.exec(
    "CREATE TEMP TRIGGER fail_later_review_insert BEFORE INSERT ON study_log " +
      "WHEN NEW.card_id='trigger-failure' BEGIN SELECT RAISE(ABORT,'RF157 synthetic insert failure'); END",
  );
  const before = snapshot();

  await expect(fullSync(db)).rejects.toThrow("RF157 synthetic insert failure");
  expect(snapshot()).toEqual(before);
  expect(transactions).toBe(1);

  sql.exec("DROP TRIGGER fail_later_review_insert");
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 2, accountRestored: true });
  expect(sql.prepare("SELECT card_id,rating,reviewed_at,sync_status FROM study_log ORDER BY id").all()).toEqual([
    {
      card_id: "restore-before-trigger",
      rating: 3,
      reviewed_at: "2026-06-01T04:00:00+02:00",
      sync_status: "synced",
    },
    {
      card_id: "trigger-failure",
      rating: 2,
      reviewed_at: "2026-06-01T12:00:00Z",
      sync_status: "synced",
    },
  ]);
  await expect(getReviewStats(db)).resolves.toMatchObject({ totalReviews: 2 });
});

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

it.each([false, true])("deletes only instant-older highlight targets, reverse insertion=%s", async (reverseOrder) => {
  restoreComplete();
  const targets = [
    highlightRow(HIGHLIGHT_CANONICAL_ID, "2026-06-01T04:00:00+03:00"),
    highlightRow(HIGHLIGHT_CANONICAL_ID + ":tie", "2026-06-01T04:00:00+02:00"),
    highlightRow(HIGHLIGHT_CANONICAL_ID + ":newer", "2026-06-01T00:00:00-03:00"),
  ];
  for (const row of reverseOrder ? [...targets].reverse() : targets) putHighlight(row);
  const preservedIds = [HIGHLIGHT_CANONICAL_ID + ":tie", HIGHLIGHT_CANONICAL_ID + ":newer"];
  mockIncrementalHighlights.push(
    remoteHighlightDeletion({ updated_at: "2026-06-01T02:00:00Z", deleted_at: "2026-06-01T02:00:00Z" }),
  );

  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });

  expect(
    highlightRows()
      .map((row) => row.sync_id)
      .sort(),
  ).toEqual(preservedIds.sort());
});

it("keeps a highlight whose identity changes after target selection", async () => {
  restoreComplete();
  putHighlight(highlightRow(HIGHLIGHT_CANONICAL_ID, "2026-06-01T01:00:00Z"));
  beforeHighlightDelete = () => {
    sql
      .prepare("UPDATE highlights SET sync_id='edited-highlight-id',ayah=256 WHERE sync_id=?")
      .run(HIGHLIGHT_CANONICAL_ID);
  };
  mockIncrementalHighlights.push(
    remoteHighlightDeletion({ updated_at: "2026-06-01T02:00:00Z", deleted_at: "2026-06-01T02:00:00Z" }),
  );

  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });

  expect(sql.prepare("SELECT sync_id,ayah FROM highlights").all()).toEqual([
    { sync_id: "edited-highlight-id", ayah: 256 },
  ]);
});

it("keeps a highlight edited after target selection", async () => {
  restoreComplete();
  putHighlight(highlightRow(HIGHLIGHT_CANONICAL_ID, "2026-06-01T01:00:00Z"));
  const editedTimestamp = "2026-06-01T00:00:00-03:00";
  beforeHighlightDelete = () => {
    sql.prepare("UPDATE highlights SET updated_at=? WHERE sync_id=?").run(editedTimestamp, HIGHLIGHT_CANONICAL_ID);
  };
  mockIncrementalHighlights.push(
    remoteHighlightDeletion({ updated_at: "2026-06-01T02:00:00Z", deleted_at: "2026-06-01T02:00:00Z" }),
  );

  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });

  expect(sql.prepare("SELECT sync_id,updated_at FROM highlights").all()).toEqual([
    { sync_id: HIGHLIGHT_CANONICAL_ID, updated_at: editedTimestamp },
  ]);
});

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

describe("RF-169 live highlight with an empty remote updated_at", () => {
  const live = () => ({ ...highlightRow(HIGHLIGHT_CANONICAL_ID, ""), synced_at: NEW });

  it("keeps a newer local highlight instead of skipping the freshness check", async () => {
    restoreComplete();
    putHighlight({ ...highlightRow(HIGHLIGHT_CANONICAL_ID, NEW), color: "yellow" });
    mockIncrementalHighlights.push(live());

    await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });

    expect(highlightRows()).toMatchObject([{ sync_id: HIGHLIGHT_CANONICAL_ID, updated_at: NEW }]);
  });

  it("stores the remote creation time rather than an empty updated_at", async () => {
    restoreComplete();
    mockIncrementalHighlights.push(live());

    await expect(fullSync(db)).resolves.toMatchObject({ status: "synced", pulled: 1 });

    expect(highlightRows()).toMatchObject([{ sync_id: HIGHLIGHT_CANONICAL_ID, updated_at: OLD, deleted_at: null }]);
  });
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

it("pulls the wird tables in full once per account, then from the shared cursor", async () => {
  restoreComplete();
  putSetting("last_pull_at", OLD);
  const wirdTables = new Set(["habit_days", "review_sessions", "recitation_errors"]);
  const sinceByTable = () =>
    Object.fromEntries(requests.filter((r) => r.incremental).map((r) => [r.table, r.since]));
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced" });
  const first = sinceByTable();
  for (const table of wirdTables) expect(first[table]).toBe("1970-01-01T00:00:00Z");
  expect(first.study_log).toBe(OLD);
  const cursor = sql.prepare("SELECT value FROM user_settings WHERE key='last_pull_at'").get()?.value;
  requests.length = 0;
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced" });
  const second = sinceByTable();
  for (const table of wirdTables) expect(second[table]).toBe(cursor);
});

it("keeps a pulled page card's cached tier", async () => {
  restoreComplete();
  mockTableRows.set("study_cards:incremental", [
    { ...card("page:madani15:5"), tier: "manzil", tier_changed_at: NEW, updated_at: NEW },
  ]);
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced" });
  expect(sql.prepare("SELECT tier, tier_changed_at FROM study_cards WHERE id = 'page:madani15:5'").get()).toEqual({
    tier: "manzil",
    tier_changed_at: NEW,
  });
});

it("drops device state built from the replaced account when restoring another", async () => {
  putSetting("device_hifz_today_plan", JSON.stringify({ date: "2026-11-13", ids: ["page:madani15:5"], newLines: 0 }));
  putSetting("device_wird_extras", "{}");
  putSetting("hifz_auto_delay_ms", "900");
  mockTableRows.set("user_settings:restore", [boundaryRows.user_settings]);
  await expect(fullSync(db)).resolves.toMatchObject({ accountRestored: true });
  const keys = sql.prepare("SELECT key FROM user_settings").all().map((row) => row.key);
  expect(keys).not.toContain("device_hifz_today_plan");
  expect(keys).not.toContain("device_wird_extras");
  expect(keys).toContain("hifz_auto_delay_ms");
});

it("pulls wird days before reviews and marks a day whose minimum two devices met together", async () => {
  restoreComplete();
  putSetting("last_pull_at", OLD);
  const now = new Date();
  const today = localDateOf(now);
  const earlier = new Date(now.getTime() - 60 * 60_000).toISOString();
  // This device recited the first half of a page; another device recited the second half.
  sql
    .prepare(
      `INSERT INTO study_log (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at,
        local_date, grader) VALUES ('half:madani15:5:a', 3, 2, ?, 1, 1, 0, 1, ?, ?, 'self')`,
    )
    .run(earlier, earlier, today);
  const remoteAt = new Date(now.getTime() - 30 * 60_000).toISOString();
  mockTableRows.set("study_log:incremental", [
    { ...boundaryRows.study_log, card_id: "half:madani15:5:b", reviewed_at: remoteAt, local_date: today, grader: "self" },
  ]);
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced" });
  const tables = requests.filter((r) => r.incremental).map((r) => r.table);
  expect(tables.indexOf("habit_days")).toBeLessThan(tables.indexOf("study_log"));
  expect(sql.prepare("SELECT status FROM habit_days WHERE local_date = ?").get(today)).toEqual({ status: "done" });
});

it("credits pulled make-up reviews to the missed day, not to today", async () => {
  restoreComplete();
  putSetting("last_pull_at", OLD);
  const now = new Date();
  const today = localDateOf(now);
  const yesterday = localDateOf(new Date(now.getTime() - 24 * 60 * 60_000));
  const earlier = new Date(now.getTime() - 60 * 60_000).toISOString();
  mockTableRows.set("study_log:incremental", [
    { ...boundaryRows.study_log, card_id: "page:madani15:5", reviewed_at: earlier, local_date: today, grader: "self", makeup_for: yesterday },
  ]);
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced" });
  expect(sql.prepare("SELECT makeup_for FROM study_log WHERE card_id = 'page:madani15:5'").get()).toEqual({ makeup_for: yesterday });
  expect(sql.prepare("SELECT status FROM habit_days WHERE local_date = ?").get(yesterday)).toEqual({ status: "made_up" });
  expect(sql.prepare("SELECT status FROM habit_days WHERE local_date = ?").get(today)).toBeUndefined();
});

/** A clear error at 2:255 word 4, one per session, as another device uploads it. */
function weakSpotError(session: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `error-${session}`,
    card_id: "2:255",
    session_id: `session-${session}`,
    surah: 2,
    ayah: 255,
    word: 4,
    type: "wrong_word",
    severity: "jali",
    corrected: "none",
    sibling_ref: null,
    local_date: "2026-02-01",
    clean_count: 0,
    last_clean_date: null,
    resolved_at: null,
    created_at: OLD,
    updated_at: OLD,
    deleted_at: null,
    ...overrides,
  };
}
const liveClozeCards = () =>
  sql.prepare("SELECT id FROM study_cards WHERE id LIKE 'cloze:%' AND deleted_at IS NULL ORDER BY id").all();

it("gives a restored weak spot its cloze card when the account's errors came from several devices", async () => {
  mockTableRows.set("recitation_errors:restore", [weakSpotError(1), weakSpotError(2), weakSpotError(3)]);
  await expect(fullSync(db)).resolves.toMatchObject({ accountRestored: true });
  expect(liveClozeCards()).toEqual([{ id: "cloze:2:255:4" }]);
});

it("does not make a cloze card on restore for a word wrong in fewer than 3 sessions", async () => {
  mockTableRows.set("recitation_errors:restore", [weakSpotError(1), weakSpotError(2), weakSpotError(3, { deleted_at: NEW })]);
  await expect(fullSync(db)).resolves.toMatchObject({ accountRestored: true });
  expect(liveClozeCards()).toEqual([]);
});

it("removes the cloze card when another device's dismissal takes the word below 3 sessions", async () => {
  restoreComplete();
  mockTableRows.set("recitation_errors:incremental", [weakSpotError(1), weakSpotError(2), weakSpotError(3)]);
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced" });
  expect(liveClozeCards()).toEqual([{ id: "cloze:2:255:4" }]);

  mockTableRows.set("recitation_errors:incremental", [
    { ...weakSpotError(3, { updated_at: NEW, deleted_at: NEW }), synced_at: "2099-01-01T00:00:00.000Z" },
  ]);
  await expect(fullSync(db)).resolves.toMatchObject({ status: "synced" });
  expect(liveClozeCards()).toEqual([]);
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
  // A review from an older app version also reconciles its wird day after an incremental pull.
  const reconciled = table === "study_log" && mode === "incremental";
  expect(transactions).toBe(reconciled ? 2 : 1);
  if (reconciled) {
    expect(sql.prepare("SELECT status FROM habit_days").all()).toEqual([{ status: "done" }]);
  }
});
