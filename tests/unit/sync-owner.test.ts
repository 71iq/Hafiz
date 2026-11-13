import type { Session, User } from "@supabase/supabase-js";
import type { AppDatabase, TransactionDatabase } from "@/lib/database/types";
import { observeAuthSession } from "@/lib/auth/commands";
import { fullSync } from "@/lib/database/sync";

type Packet = { data: Record<string, unknown>[] | null; error: Error | null };
type Operation = { table: string; userId: unknown; incremental: boolean };
type Statement = { source: string; params: unknown[]; userId: string | null };
const operations: Operation[] = [];
const statements: Statement[] = [];
let mockConfigured = true;
let mockAuth: { user: User | null; session: Session | null } = { user: null, session: null };
let mockRestoreRows: Record<string, unknown>[] = [];
let mockRestored = false;
let mockResponse: (operation: Operation) => Promise<Packet>;
let mockOnRun: ((source: string, params: unknown[]) => void) | null = null;
const mockFirst = jest.fn<Promise<unknown>, [string, ...unknown[]]>();
const mockAll = jest.fn<Promise<unknown[]>, [string, ...unknown[]]>();
const mockRun = jest.fn<Promise<{ changes: number; lastInsertRowId: number }>, [string, ...unknown[]]>();
const mockTransaction = jest.fn<Promise<void>, [(transaction: TransactionDatabase) => Promise<void>]>();
const mockPending = jest.fn(async () => []);
const mockEnqueue = jest.fn(async (..._args: unknown[]) => {});
const mockMarkSynced = jest.fn(async (..._args: unknown[]) => {});
const mockMarkFailed = jest.fn(async (..._args: unknown[]) => {});
const mockClean = jest.fn(async (..._args: unknown[]) => {});
const mockBackfill = jest.fn(async (..._args: unknown[]) => 0);

class MockSyncQuery {
  private readonly operation: Operation;
  constructor(table: string) {
    this.operation = { table, userId: null, incremental: false };
  }
  select() {
    return this;
  }
  eq(key: string, value: unknown) {
    if (key === "user_id") this.operation.userId = value;
    return this;
  }
  gt() {
    this.operation.incremental = true;
    return this;
  }
  order() {
    return this;
  }
  range() {
    const operation = { ...this.operation };
    operations.push(operation);
    return mockResponse(operation);
  }
}

jest.mock("@/lib/auth/store", () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  supabase: { from: (table: string) => new MockSyncQuery(table) },
}));
jest.mock("@/lib/database/sync-queue", () => ({
  getPendingSyncEntries: () => mockPending(),
  getPendingSyncCount: async () => 0,
  enqueueSync: (...args: unknown[]) => mockEnqueue(...args),
  markSynced: (...args: unknown[]) => mockMarkSynced(...args),
  markFailed: (...args: unknown[]) => mockMarkFailed(...args),
  cleanSyncedEntries: (...args: unknown[]) => mockClean(...args),
}));
jest.mock("@/lib/achievements/queries", () => ({
  backfillAchievements: (...args: unknown[]) => mockBackfill(...args),
  insertRemoteAchievementUnlock: jest.fn(),
}));

const db = {
  getFirstAsync: (...args: [string, ...unknown[]]) => mockFirst(...args),
  getAllAsync: (...args: [string, ...unknown[]]) => mockAll(...args),
  runAsync: (...args: [string, ...unknown[]]) => mockRun(...args),
  withTransactionAsync: (work: (transaction: TransactionDatabase) => Promise<void>) =>
    mockTransaction(() => work(db as unknown as TransactionDatabase)),
} as unknown as AppDatabase;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let sequence = 0;
function session(userId: string): Session {
  const user: User = {
    id: userId,
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
    app_metadata: {},
    user_metadata: {},
  };
  const sessionId = `10000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  const payload = Buffer.from(JSON.stringify({ sub: userId, session_id: sessionId })).toString("base64url");
  return {
    user,
    access_token: `e30.${payload}.c2ln`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
  };
}
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
function activate(value: Session | null) {
  mockAuth = { user: value?.user ?? null, session: value };
  observeAuthSession(value);
}
function setting() {
  return {
    user_id: A,
    key: "daily_review_limit",
    value: "20",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    synced_at: "2026-01-02T00:00:00Z",
    deleted_at: null,
  };
}
function packet(operation: Operation): Promise<Packet> {
  return Promise.resolve({
    data: !operation.incremental && operation.table === "user_settings" ? mockRestoreRows : [],
    error: null,
  });
}
function first(source: string, ...params: unknown[]): Promise<unknown> {
  if (source.includes("COUNT(*)")) return Promise.resolve({ count: 0 });
  const key = Array.isArray(params[0]) ? params[0][0] : params[0];
  if (typeof key === "string" && key.startsWith("sync_account_restore_"))
    return Promise.resolve(mockRestored ? { value: "true" } : null);
  if (
    typeof key === "string" &&
    (key.startsWith("sync_initial_backfill_") ||
      key.startsWith("sync_user_settings_backfill_") ||
      key.startsWith("sync_habit_backfill_"))
  )
    return Promise.resolve({ value: "true" });
  return Promise.resolve(null);
}
function expectNoReplacement() {
  expect(statements).toEqual([]);
  expect(mockTransaction).not.toHaveBeenCalled();
  expect(mockPending).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.resetAllMocks();
  activate(null);
  operations.length = 0;
  statements.length = 0;
  mockConfigured = true;
  mockRestored = false;
  mockRestoreRows = [];
  mockOnRun = null;
  mockResponse = packet;
  mockFirst.mockImplementation(first);
  mockAll.mockResolvedValue([]);
  mockRun.mockImplementation(async (source, ...params) => {
    statements.push({ source, params, userId: mockAuth.user?.id ?? null });
    mockOnRun?.(source, params);
    return { changes: 1, lastInsertRowId: 1 };
  });
  mockTransaction.mockImplementation(async (work) => work(db as unknown as TransactionDatabase));
  mockPending.mockResolvedValue([]);
  mockEnqueue.mockResolvedValue();
  mockBackfill.mockResolvedValue(0);
  mockClean.mockResolvedValue();
  mockMarkFailed.mockResolvedValue();
  mockMarkSynced.mockResolvedValue();
});
afterEach(() => {
  activate(null);
  jest.restoreAllMocks();
});

const obsoleteCases = ["switch", "signout", "same-ID login", "closed A-B-A"].flatMap((transition) =>
  [false, true].map((nonempty) => ({ transition, nonempty })),
);
it.each(obsoleteCases)(
  "rejects $transition after deferred restore, nonempty=$nonempty",
  async ({ transition, nonempty }) => {
    const original = session(A);
    activate(original);
    mockRestoreRows = nonempty ? [setting()] : [];
    const reached = deferred<void>();
    const response = deferred<Packet>();
    mockResponse = (operation) => {
      reached.resolve();
      return response.promise;
    };
    const continuation = jest.fn();
    const work = fullSync(db).then(continuation);
    const rejected = expect(work).rejects.toThrow("Sync account changed");
    await reached.promise;
    if (transition === "switch") activate(session(B));
    else if (transition === "signout") activate(null);
    else if (transition === "same-ID login") activate(session(A));
    else {
      activate(session(B));
      activate(original);
    }
    response.resolve({ data: mockRestoreRows, error: null });
    await rejected;
    expectNoReplacement();
    expect(continuation).not.toHaveBeenCalled();
    expect(operations).toHaveLength(1);
    expect(operations[0].userId).toBe(A);
  },
);

it("rejects ownership loss during local-data inspection before opening a replacement transaction", async () => {
  activate(session(A));
  mockRestoreRows = [setting()];
  const reached = deferred<void>();
  const response = deferred<unknown[]>();
  mockAll.mockImplementation((source) => {
    if (source === "SELECT key FROM user_settings") {
      reached.resolve();
      return response.promise;
    }
    return Promise.resolve([]);
  });
  const rejected = expect(fullSync(db)).rejects.toThrow("Sync account changed");
  await reached.promise;
  activate(session(B));
  response.resolve([]);
  await rejected;
  expectNoReplacement();
});

it("rechecks a delayed transaction callback before its first destructive write", async () => {
  activate(session(A));
  mockRestoreRows = [setting()];
  const reached = deferred<void>();
  const admission = deferred<void>();
  mockTransaction.mockImplementation(async (work) => {
    reached.resolve();
    await admission.promise;
    await work(db as unknown as TransactionDatabase);
  });
  const rejected = expect(fullSync(db)).rejects.toThrow("Sync account changed");
  await reached.promise;
  activate(session(B));
  admission.resolve();
  await rejected;
  expect(statements).toEqual([]);
  expect(mockPending).not.toHaveBeenCalled();
});

it("does not hand an obsolete restore completion to the upload phase", async () => {
  activate(session(A));
  mockRestoreRows = [setting()];
  mockTransaction.mockImplementation(async (work) => {
    await work(db as unknown as TransactionDatabase);
    activate(session(B));
  });
  await expect(fullSync(db)).rejects.toThrow("Sync account changed");
  expect(mockPending).not.toHaveBeenCalled();
  expect(statements.every((statement) => statement.userId === A)).toBe(true);
  expect(operations.every((operation) => operation.userId === A)).toBe(true);
});

it("does not begin a new-account pull after an obsolete queue read", async () => {
  activate(session(A));
  mockRestored = true;
  mockPending.mockImplementation(async () => {
    activate(session(B));
    return [];
  });
  await expect(fullSync(db)).rejects.toThrow("Sync account changed");
  expect(operations).toEqual([]);
  expect(statements).toEqual([]);
  expect(mockClean).not.toHaveBeenCalled();
});

it.each([false, true])("preserves a current-owner restore and subsequent phases, nonempty=%s", async (nonempty) => {
  activate(session(A));
  mockRestoreRows = nonempty ? [setting()] : [];
  await expect(fullSync(db)).resolves.toEqual({
    status: "synced",
    pushed: 0,
    pulled: nonempty ? 1 : 0,
    accountRestored: nonempty,
    localDataReplaced: false,
  });
  expect(mockPending).toHaveBeenCalledTimes(1);
  // Nine original tables plus wird days, review sessions and recitation errors.
  expect(operations.filter((operation) => operation.incremental)).toHaveLength(12);
  expect(operations.every((operation) => operation.userId === A)).toBe(true);
  expect(statements.every((statement) => statement.userId === A)).toBe(true);
  expect(statements.some((statement) => statement.source.startsWith("DELETE FROM"))).toBe(nonempty);
});

it("keeps a same-session token refresh current during deferred restore", async () => {
  const original = session(A);
  activate(original);
  mockRestoreRows = [setting()];
  const reached = deferred<void>();
  const response = deferred<Packet>();
  mockResponse = (operation) => {
    if (operations.length === 1) {
      reached.resolve();
      return response.promise;
    }
    return packet(operation);
  };
  const work = fullSync(db);
  await reached.promise;
  const claims: unknown = JSON.parse(Buffer.from(original.access_token.split(".")[1], "base64url").toString());
  if (!claims || typeof claims !== "object") throw new Error("Invalid synthetic claims");
  const payload = Buffer.from(JSON.stringify({ ...claims, iat: 2 })).toString("base64url");
  activate({
    ...original,
    user: { ...original.user, user_metadata: { refreshed: true } },
    access_token: `e30.${payload}.c2ln`,
  });
  response.resolve({ data: mockRestoreRows, error: null });
  await expect(work).resolves.toMatchObject({ pulled: 1, accountRestored: true });
  expect(mockPending).toHaveBeenCalledTimes(1);
});

it("preserves the original current-owner restore transport error", async () => {
  activate(session(A));
  const error = new Error("synthetic remote failure");
  mockResponse = async () => ({ data: null, error });
  await expect(fullSync(db)).rejects.toBe(error);
  expectNoReplacement();
});

it.each(["unconfigured", "signed out", "unidentified"])("does no account work when %s", async (state) => {
  activate(session(A));
  if (state === "unconfigured") mockConfigured = false;
  else if (state === "signed out") activate(null);
  else activate({ ...mockAuth.session!, access_token: "unidentified" });
  await expect(fullSync(db)).resolves.toEqual({
    status: "not_connected",
    pushed: 0,
    pulled: 0,
    accountRestored: false,
    localDataReplaced: false,
  });
  expectNoReplacement();
  expect(operations).toEqual([]);
});
