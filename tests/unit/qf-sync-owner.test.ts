import { createConnectionOwner } from "@/lib/database/connection-owner";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { AppDatabase, TransactionDatabase } from "@/lib/database/types";
import { createClient, type Session } from "@supabase/supabase-js";
import { captureQfRequestOwner } from "@/lib/quran-foundation/request-owner";
import { observeAuthSession } from "@/lib/auth/commands";
import { createSchema } from "@/lib/database/schema";
import { invokeQfUser } from "@/lib/quran-foundation/user";
import {
  enqueueQfSync,
  fullQfUserSync,
  getPendingQfSyncCount,
  runInitialQfUserSync,
  type QfSyncResult,
} from "@/lib/quran-foundation/user-sync";

const USER_A = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-000000000002";
const SESSION_A = "10000000-0000-4000-8000-000000000001";
const SESSION_A2 = "10000000-0000-4000-8000-000000000002";
const SESSION_B = "10000000-0000-4000-8000-000000000003";
const OLD = "2000-01-01T00:00:00.000Z";
let mockCurrentSession: Session | null = null;
let sdkToken: string;
let accessTokenCall = 0;
let delayedAccessCall: number | null = null;
let delayedAccess: ReturnType<typeof deferred<string>> | null = null;
let delayedAccessEntered: ReturnType<typeof deferred<void>> | null = null;
let mockConfigured = true;
let remoteCreated = false;
let mockAfterCountOwnerRead: (() => void) | null = null;
let retireAfterCountRead: (() => void) | null = null;
const authSession = jest.fn<Promise<{ data: { session: Session | null }; error: unknown }>, []>();
const requests: { action: string; authorization: string | null }[] = [];
const responses: Record<string, unknown> = {};
const requestSignals = new Map<string, ReturnType<typeof deferred<void>>>();
const REMOTE_NOTE = {
  id: "remote-note",
  body: "synthetic local note",
  ranges: ["2:255-2:255"],
  createdAt: OLD,
  updatedAt: OLD,
};
const fetchImpl = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
  const body: unknown = JSON.parse(String(init?.body ?? "{}"));
  if (!body || typeof body !== "object" || !("action" in body) || typeof body.action !== "string")
    throw new Error("Invalid synthetic request");
  const action = body.action;
  requests.push({ action, authorization: new Headers(init?.headers).get("authorization") });
  requestSignals.get(action)?.resolve();
  const data = await (responses[action] ?? defaultResponse(action));
  if (data instanceof Response) return data;
  if (action === "create-note" && data && typeof data === "object" && "ok" in data && data.ok === true)
    remoteCreated = true;
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
});
const mockClient = createClient("https://synthetic.invalid", "synthetic-anon-key", {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  accessToken: async () => {
    accessTokenCall += 1;
    if (delayedAccess && accessTokenCall === delayedAccessCall) {
      delayedAccessEntered?.resolve();
      return delayedAccess.promise;
    }
    return sdkToken;
  },
  global: { fetch: fetchImpl as typeof fetch },
});

jest.mock("@/lib/auth/store", () => ({
  useAuthStore: {
    getState: () => {
      const state = { user: mockCurrentSession?.user ?? null, session: mockCurrentSession };
      const afterRead = mockAfterCountOwnerRead;
      mockAfterCountOwnerRead = null;
      afterRead?.();
      return state;
    },
  },
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  get supabase() {
    return mockClient;
  },
}));

function token(userId: string, sessionId: string, revision = 0): string {
  const claims = Buffer.from(JSON.stringify({ sub: userId, session_id: sessionId, iat: revision })).toString(
    "base64url",
  );
  return "e30." + claims + ".c2ln";
}
function session(userId = USER_A, sessionId = SESSION_A, revision = 0): Session {
  return {
    access_token: token(userId, sessionId, revision),
    refresh_token: "synthetic-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 4_000_000_000,
    user: { id: userId, aud: "authenticated", created_at: OLD, app_metadata: {}, user_metadata: {} },
  };
}
function defaultResponse(action: string): unknown {
  if (action === "status") return { ok: true, status: "connected" };
  if (action === "list-bookmarks") return { ok: true, bookmarks: [] };
  if (action === "list-notes") return { ok: true, notes: remoteCreated ? [REMOTE_NOTE] : [] };
  if (action === "create-note" || action === "update-note") return { ok: true, note: REMOTE_NOTE };
  throw new Error("Unexpected synthetic action: " + action);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
type Outcome = { kind: "resolved"; value: QfSyncResult } | { kind: "rejected"; error: unknown };
function start(mode: "full" | "initial" = "full"): Promise<Outcome> {
  const work = mode === "full" ? fullQfUserSync(db) : runInitialQfUserSync(db);
  return work.then(
    (value) => ({ kind: "resolved", value }),
    (error: unknown) => ({ kind: "rejected", error }),
  );
}
async function reached(signal: Promise<void>, run: Promise<Outcome>) {
  await Promise.race([
    signal,
    run.then(() => {
      throw new Error("Sync completed before its expected fixture boundary");
    }),
  ]);
}
function failure(outcome: Outcome): unknown {
  if (outcome.kind !== "rejected") throw new Error("Obsolete sync unexpectedly completed");
  return outcome.error;
}
function watch(action: string) {
  const signal = deferred<void>();
  requestSignals.set(action, signal);
  return signal.promise;
}
function hold() {
  return { entered: deferred<void>(), release: deferred<void>() };
}
let sql: DatabaseSync;
let db: AppDatabase;
let transactionWait: ReturnType<typeof hold> | null = null;
let transactionOpenedWait: ReturnType<typeof hold> | null = null;
let readWait: { gate: ReturnType<typeof hold>; query: string } | null = null;
let enqueueWait: ReturnType<typeof hold> | null = null;
let transactionCount = 0;
async function afterRead(source: string) {
  if (retireAfterCountRead && source.includes("SELECT COUNT(*) as count FROM qf_sync_queue")) {
    const retire = retireAfterCountRead;
    retireAfterCountRead = null;
    mockAfterCountOwnerRead = () => {
      queueMicrotask(retire);
    };
  }
  if (readWait && source.includes(readWait.query)) {
    readWait.gate.entered.resolve();
    await readWait.gate.release.promise;
  }
}

beforeEach(async () => {
  jest.clearAllMocks();
  requests.length = 0;
  requestSignals.clear();
  Object.keys(responses).forEach((key) => delete responses[key]);
  mockConfigured = true;
  remoteCreated = false;
  mockAfterCountOwnerRead = null;
  retireAfterCountRead = null;
  observeAuthSession(null);
  switchSession(session());
  accessTokenCall = 0;
  delayedAccessCall = null;
  delayedAccess = null;
  delayedAccessEntered = null;
  readWait = null;
  transactionWait = null;
  transactionOpenedWait = null;
  enqueueWait = null;
  transactionCount = 0;
  authSession.mockReset().mockImplementation(async () => ({ data: { session: mockCurrentSession }, error: null }));
  Object.defineProperty(mockClient, "auth", { configurable: true, value: { getSession: authSession } });
  sql = new DatabaseSync(":memory:");
  const adapter = {
    execAsync: async (source: string) => {
      sql.exec(source);
    },
    getFirstAsync: async (source: string, params: SQLInputValue[] = []) => {
      const value = sql.prepare(source).get(...params) ?? null;
      await afterRead(source);
      return value;
    },
    getAllAsync: async (source: string, params: SQLInputValue[] = []) => {
      const value = sql.prepare(source).all(...params);
      await afterRead(source);
      return value;
    },
    runAsync: async (source: string, params: SQLInputValue[] = []) => {
      const value = sql.prepare(source).run(...params);
      if (enqueueWait && source.includes("INSERT INTO sync_queue")) {
        enqueueWait.entered.resolve();
        await enqueueWait.release.promise;
      }
      return value;
    },
    withTransactionAsync: async (work: (transaction: TransactionDatabase) => Promise<void>) => {
      transactionCount += 1;
      if (transactionWait) {
        transactionWait.entered.resolve();
        await transactionWait.release.promise;
      }
      sql.exec("BEGIN");
      try {
        if (transactionOpenedWait) {
          transactionOpenedWait.entered.resolve();
          await transactionOpenedWait.release.promise;
        }
        await work(db as unknown as TransactionDatabase);
        sql.exec("COMMIT");
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  // This adapter supplies only the Expo operations used by sync, against real isolated SQLite.
  db = adapter as unknown as AppDatabase;
  await createSchema(db);
  sql.prepare("INSERT INTO user_settings (key,value) VALUES ('qf_initial_local_enqueue_done','true')").run();
  sql
    .prepare(
      "INSERT INTO private_notes (id,surah,ayah_start,ayah_end,content,created_at,updated_at) VALUES ('local-note',2,255,255,'synthetic local note',?,?)",
    )
    .run(OLD, OLD);
  await enqueueQfSync(db, "private_note", "UPSERT", "local-note", { content: "synthetic local note" });
});
afterEach(() => {
  sql.close();
  switchSession(null);
  jest.restoreAllMocks();
});

function switchSession(next: Session | null) {
  mockCurrentSession = next;
  observeAuthSession(next);
  if (next) sdkToken = next.access_token;
}
function queueState() {
  return sql.prepare("SELECT status,attempt_count,last_error FROM qf_sync_queue ORDER BY id").all();
}
function snapshot() {
  return {
    notes: sql.prepare("SELECT * FROM private_notes ORDER BY id").all(),
    bookmarks: sql.prepare("SELECT * FROM bookmarks ORDER BY surah,ayah").all(),
    settings: sql.prepare("SELECT * FROM user_settings ORDER BY key").all(),
    queue: sql.prepare("SELECT * FROM qf_sync_queue ORDER BY id").all(),
    supabaseQueue: sql.prepare("SELECT * FROM sync_queue ORDER BY id").all(),
  };
}
function noPush() {
  sql.exec("DELETE FROM qf_sync_queue");
}
function linkOldNote() {
  noPush();
  sql.exec("UPDATE private_notes SET qf_note_id='remote-keeper'");
}
function emptyRemoteLists() {
  responses["list-bookmarks"] = { ok: true, bookmarks: [] };
  responses["list-notes"] = { ok: true, notes: [] };
}
function seedActiveBookmark(surah = 2, ayah = 256, qfBookmarkId: string | null = null) {
  noPush();
  sql
    .prepare(
      `INSERT INTO bookmarks
    (surah,ayah,created_at,updated_at,deleted_at,qf_bookmark_id,qf_synced_at,qf_sync_error,
     qf_is_in_default_collection,qf_collections_count)
    VALUES (?,?,?,?,NULL,?,?,NULL,0,0)`,
    )
    .run(surah, ayah, OLD, OLD, qfBookmarkId, qfBookmarkId ? OLD : null);
}
async function seedDeleteNote() {
  noPush();
  sql.prepare("UPDATE private_notes SET deleted_at=?,qf_note_id='remote-keeper' WHERE id='local-note'").run(OLD);
  await enqueueQfSync(db, "private_note", "DELETE", "local-note", { qfNoteId: "remote-keeper" });
}
async function seedDeleteBookmark() {
  noPush();
  seedActiveBookmark(2, 256, "remote-bookmark");
  sql.prepare("UPDATE bookmarks SET deleted_at=? WHERE surah=2 AND ayah=256").run(OLD);
  await enqueueQfSync(db, "bookmark", "DELETE", "2:256", { qfBookmarkId: "remote-bookmark" });
}

it("pins delayed create-note transport to A and stops attaching or listing after A-to-B", async () => {
  delayedAccess = deferred<string>();
  delayedAccessEntered = deferred<void>();
  delayedAccessCall = 2;
  const before = snapshot();
  const run = start();
  try {
    await reached(delayedAccessEntered.promise, run);
    switchSession(session(USER_B, SESSION_B));
    delayedAccess.resolve(token(USER_B, SESSION_B));
    const outcome = await run;
    expect(requests.find((request) => request.action === "create-note")?.authorization).toBe(
      "Bearer " + token(USER_A, SESSION_A),
    );
    expect(failure(outcome)).toBeInstanceOf(Error);
    expect(snapshot()).toEqual(before);
    expect(requests.some((request) => request.action.startsWith("list-"))).toBe(false);
  } finally {
    delayedAccess.resolve(sdkToken);
    await run;
  }
});

it.each(["account switch", "sign out", "same user new session", "closed ABA"])(
  "abandons an outstanding status response after %s",
  async (transition) => {
    const entered = watch("status");
    const gate = deferred<unknown>();
    responses.status = gate.promise;
    const original = mockCurrentSession;
    const before = snapshot();
    const run = start();
    try {
      await reached(entered, run);
      if (transition === "sign out") switchSession(null);
      else if (transition === "same user new session") switchSession(session(USER_A, SESSION_A2));
      else {
        switchSession(session(USER_B, SESSION_B));
        if (transition === "closed ABA") switchSession(original);
      }
      gate.resolve({ ok: true, status: "connected" });
      expect(failure(await run)).toBeInstanceOf(Error);
      expect(requests.map((request) => request.action)).toEqual(["status"]);
      expect(snapshot()).toEqual(before);
    } finally {
      gate.resolve({ ok: true, status: "connected" });
      await run;
    }
  },
);

async function expectInvalidAcknowledgement(
  action: string,
  response: unknown,
  setup: () => Promise<void>,
  rowQuery: string,
  rowParams: SQLInputValue[] = [],
) {
  emptyRemoteLists();
  await setup();
  const before = sql.prepare(rowQuery).get(...rowParams);
  responses[action] = response;
  const result = await fullQfUserSync(db);
  expect(result).toMatchObject({ status: "failed", pushed: 0 });
  expect(queueState()).toEqual([
    { status: "failed", attempt_count: 1, last_error: expect.stringContaining("Incomplete Quran Foundation") },
  ]);
  await expect(getPendingQfSyncCount(db)).resolves.toBe(1);
  expect(sql.prepare(rowQuery).get(...rowParams)).toEqual(before);
  expect(sql.prepare("SELECT COUNT(*) AS count FROM sync_queue").get()).toEqual({ count: 0 });
}
const validNoteAck = { ok: true, note: { id: "remote-keeper", body: "x", ranges: [], createdAt: OLD, updatedAt: OLD } };
const validBookmarkAck = {
  ok: true,
  bookmark: {
    id: "remote-bookmark",
    surah: 2,
    ayah: 256,
    type: "ayah",
    createdAt: OLD,
    isInDefaultCollection: false,
    collectionsCount: 0,
  },
};

it.each([
  ["missing note", { ok: true }],
  ["blank note id", { ok: true, note: { ...validNoteAck.note, id: " " } }],
  ["blank note body", { ok: true, note: { ...validNoteAck.note, body: "\n " } }],
  ["malformed note ranges", { ok: true, note: { ...validNoteAck.note, ranges: "2:255" } }],
  ["malformed note timestamp", { ok: true, note: { ...validNoteAck.note, updatedAt: 12 } }],
])("keeps create-note retryable for %s acknowledgement", async (_label, response) => {
  await expectInvalidAcknowledgement(
    "create-note",
    response,
    async () => {},
    "SELECT * FROM private_notes WHERE id='local-note'",
  );
});
it("rejects a note update acknowledgement for a different remote id", async () => {
  await expectInvalidAcknowledgement(
    "update-note",
    { ...validNoteAck, note: { ...validNoteAck.note, id: "some-other-note" } },
    async () => {
      linkOldNote();
      await enqueueQfSync(db, "private_note", "UPSERT", "local-note", { content: "synthetic local note" });
    },
    "SELECT * FROM private_notes WHERE id='local-note'",
  );
});
it.each([
  ["wrong response variant", { ok: true, status: "connected" }],
  ["blank id", { ...validBookmarkAck, bookmark: { ...validBookmarkAck.bookmark, id: " " } }],
  ["wrong coordinates", { ...validBookmarkAck, bookmark: { ...validBookmarkAck.bookmark, ayah: 257 } }],
  ["wrong type", { ...validBookmarkAck, bookmark: { ...validBookmarkAck.bookmark, type: "page" } }],
  [
    "nonboolean collection flag",
    { ...validBookmarkAck, bookmark: { ...validBookmarkAck.bookmark, isInDefaultCollection: 0 } },
  ],
  [
    "invalid collection count",
    { ...validBookmarkAck, bookmark: { ...validBookmarkAck.bookmark, collectionsCount: 1.5 } },
  ],
  ["blank created time", { ...validBookmarkAck, bookmark: { ...validBookmarkAck.bookmark, createdAt: " " } }],
])("keeps bookmark upsert retryable for %s acknowledgement", async (_label, response) => {
  await expectInvalidAcknowledgement(
    "upsert-bookmark",
    response,
    async () => {
      seedActiveBookmark();
      await enqueueQfSync(db, "bookmark", "UPSERT", "2:256", { surah: 2, ayah: 256 });
    },
    "SELECT * FROM bookmarks WHERE surah=2 AND ayah=256",
  );
});
it.each([
  [
    "delete-note",
    { ok: true, status: "connected" },
    seedDeleteNote,
    "SELECT * FROM private_notes WHERE id='local-note'",
  ],
  [
    "delete-bookmark",
    { ok: true, status: "connected" },
    seedDeleteBookmark,
    "SELECT * FROM bookmarks WHERE surah=2 AND ayah=256",
  ],
])("keeps %s retryable unless the acknowledgement confirms deletion", async (action, response, setup, rowQuery) => {
  await expectInvalidAcknowledgement(action, response, setup, rowQuery);
});
it("accepts a valid short note update with empty ranges as a server fallback", async () => {
  emptyRemoteLists();
  linkOldNote();
  await enqueueQfSync(db, "private_note", "UPSERT", "local-note", { content: "synthetic local note" });
  responses["update-note"] = validNoteAck;
  responses["list-notes"] = { ok: true, notes: [{ ...validNoteAck.note, ranges: ["2:255-2:255"] }] };
  await expect(fullQfUserSync(db)).resolves.toMatchObject({ pushed: 1 });
  expect(queueState()).toEqual([{ status: "synced", attempt_count: 0, last_error: null }]);
  expect(
    sql.prepare("SELECT qf_note_id,qf_ranges_json,qf_synced_at FROM private_notes WHERE id='local-note'").get(),
  ).toEqual({
    qf_note_id: "remote-keeper",
    qf_ranges_json: '["2:255-2:255"]',
    qf_synced_at: expect.any(String),
  });
});
it("accepts a complete matching bookmark acknowledgement", async () => {
  emptyRemoteLists();
  seedActiveBookmark();
  await enqueueQfSync(db, "bookmark", "UPSERT", "2:256", { surah: 2, ayah: 256 });
  responses["upsert-bookmark"] = validBookmarkAck;
  responses["list-bookmarks"] = { ok: true, bookmarks: [validBookmarkAck.bookmark] };
  await expect(fullQfUserSync(db)).resolves.toMatchObject({ pushed: 1 });
  expect(queueState()).toEqual([{ status: "synced", attempt_count: 0, last_error: null }]);
  expect(sql.prepare("SELECT qf_bookmark_id,qf_synced_at FROM bookmarks WHERE surah=2 AND ayah=256").get()).toEqual({
    qf_bookmark_id: "remote-bookmark",
    qf_synced_at: expect.any(String),
  });
});
it.each(["note", "bookmark"] as const)("accepts an explicit valid %s deletion acknowledgement", async (entity) => {
  emptyRemoteLists();
  if (entity === "note") {
    await seedDeleteNote();
    responses["delete-note"] = { ok: true, deleted: true };
  } else {
    await seedDeleteBookmark();
    responses["delete-bookmark"] = { ok: true, deleted: true };
  }
  await expect(fullQfUserSync(db)).resolves.toMatchObject({ pushed: 1 });
  expect(queueState()).toEqual([{ status: "synced", attempt_count: 0, last_error: null }]);
  if (entity === "note")
    expect(sql.prepare("SELECT qf_note_id,qf_synced_at FROM private_notes WHERE id='local-note'").get()).toEqual({
      qf_note_id: "remote-keeper",
      qf_synced_at: expect.any(String),
    });
  else
    expect(sql.prepare("SELECT qf_bookmark_id FROM bookmarks WHERE surah=2 AND ayah=256").get()).toEqual({
      qf_bookmark_id: null,
    });
});
it("does not call delete-bookmark for a protected collection bookmark", async () => {
  emptyRemoteLists();
  seedActiveBookmark(2, 256, "remote-bookmark");
  sql.prepare("UPDATE bookmarks SET deleted_at=?,qf_is_in_default_collection=1 WHERE surah=2 AND ayah=256").run(OLD);
  await enqueueQfSync(db, "bookmark", "DELETE", "2:256", { qfBookmarkId: "remote-bookmark" });
  await expect(fullQfUserSync(db)).resolves.toMatchObject({ pushed: 1 });
  expect(requests.some(({ action }) => action === "delete-bookmark")).toBe(false);
  expect(sql.prepare("SELECT qf_bookmark_id,deleted_at FROM bookmarks WHERE surah=2 AND ayah=256").get()).toEqual({
    qf_bookmark_id: "remote-bookmark",
    deleted_at: OLD,
  });
});

it("keeps a pending note write retryable when create-note returns an unrelated ok:true variant", async () => {
  emptyRemoteLists();
  responses["create-note"] = { ok: true, status: "connected" };
  const original = sql.prepare("SELECT * FROM private_notes WHERE id='local-note'").get();
  const result = await fullQfUserSync(db);
  expect(queueState()).toEqual([
    { status: "failed", attempt_count: 1, last_error: expect.stringContaining("Incomplete Quran Foundation") },
  ]);
  await expect(getPendingQfSyncCount(db)).resolves.toBe(1);
  expect(result).toMatchObject({ pushed: 0 });
  expect(sql.prepare("SELECT * FROM private_notes WHERE id='local-note'").get()).toEqual(original);
  expect(sql.prepare("SELECT COUNT(*) AS count FROM sync_queue").get()).toEqual({ count: 0 });
});

it("allows unchanged-owner full sync with an acknowledged note and complete pull", async () => {
  await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "synced", pushed: 1 });
  expect(requests.map((request) => request.action)).toEqual(["status", "create-note", "list-bookmarks", "list-notes"]);
  expect(requests.every((request) => request.authorization === "Bearer " + token(USER_A, SESSION_A))).toBe(true);
  expect(queueState()).toEqual([{ status: "synced", attempt_count: 0, last_error: null }]);
  expect(sql.prepare("SELECT qf_note_id,deleted_at FROM private_notes WHERE id='local-note'").get()).toEqual({
    qf_note_id: "remote-note",
    deleted_at: null,
  });
});
it("preserves a valid initial pull-enqueue-push-pull sequence", async () => {
  noPush();
  sql.exec("DELETE FROM user_settings");
  await expect(runInitialQfUserSync(db)).resolves.toMatchObject({ status: "synced", pushed: 1 });
  expect(requests.map((request) => request.action)).toEqual([
    "status",
    "list-bookmarks",
    "list-notes",
    "create-note",
    "list-bookmarks",
    "list-notes",
  ]);
  expect(sql.prepare("SELECT value FROM user_settings WHERE key='qf_initial_local_enqueue_done'").get()).toEqual({
    value: "true",
  });
  expect(queueState()).toEqual([{ status: "synced", attempt_count: 0, last_error: null }]);
});

it.each([
  { response: { ok: false, code: "upstream", message: "Synthetic status outage" }, status: "failed" },
  { response: { ok: false, code: "needs_reauth", message: "Synthetic reauthentication" }, status: "needs_reauth" },
  { response: { ok: true, status: "disconnected" }, status: "not_connected" },
  { response: { ok: true, status: "needs_reauth" }, status: "needs_reauth" },
])("retains the existing connection outcome $status", async ({ response, status }) => {
  const before = snapshot();
  responses.status = response;
  await expect(fullQfUserSync(db)).resolves.toEqual({ status, pushed: 0, pulled: 0 });
  expect(snapshot()).toEqual(before);
  expect(requests.map((request) => request.action)).toEqual(["status"]);
});
it.each(["list-bookmarks", "list-notes"])("keeps current-owner %s errors and local rows", async (action) => {
  noPush();
  const before = snapshot();
  responses[action] = { ok: false, code: "upstream", message: "Synthetic " + action + " failure" };
  await expect(fullQfUserSync(db)).rejects.toThrow("Synthetic " + action + " failure");
  expect(snapshot()).toEqual(before);
});
it("preserves current-owner queue failure accounting", async () => {
  responses["create-note"] = { ok: false, code: "upstream", message: "Synthetic push failure" };
  await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "failed", pushed: 0 });
  expect(queueState()).toEqual([{ status: "failed", attempt_count: 1, last_error: "Synthetic push failure" }]);
});

it.each(["FROM qf_sync_queue", "FROM private_notes WHERE id"])(
  "rechecks after deferred local read %s before dispatching a note",
  async (query) => {
    readWait = { query, gate: hold() };
    const gate = readWait.gate;
    const before = snapshot();
    const run = start();
    try {
      await reached(gate.entered.promise, run);
      switchSession(session(USER_B, SESSION_B));
      gate.release.resolve();
      expect(failure(await run)).toBeInstanceOf(Error);
      expect(requests.map((request) => request.action)).toEqual(["status"]);
      expect(snapshot()).toEqual(before);
    } finally {
      gate.release.resolve();
      await run;
    }
  },
);
it.each(["list-bookmarks", "list-notes"])("rejects an obsolete %s response before reconciliation", async (action) => {
  linkOldNote();
  const before = snapshot();
  const entered = watch(action);
  const gate = deferred<unknown>();
  responses[action] = gate.promise;
  const run = start();
  try {
    await reached(entered, run);
    switchSession(session(USER_B, SESSION_B));
    gate.resolve(defaultResponse(action));
    expect(failure(await run)).toBeInstanceOf(Error);
    expect(transactionCount).toBe(0);
    expect(snapshot()).toEqual(before);
  } finally {
    gate.resolve(defaultResponse(action));
    await run;
  }
});
it.each(["full", "initial"] as const)(
  "retires %s first-pull work without an initial marker or enqueue",
  async (mode) => {
    linkOldNote();
    sql.exec("DELETE FROM user_settings");
    const before = snapshot();
    const entered = watch("list-notes");
    const gate = deferred<unknown>();
    responses["list-notes"] = gate.promise;
    const run = start(mode);
    try {
      await reached(entered, run);
      switchSession(session(USER_B, SESSION_B));
      gate.resolve({ ok: true, notes: [] });
      expect(failure(await run)).toBeInstanceOf(Error);
      expect(snapshot()).toEqual(before);
      expect(transactionCount).toBe(0);
    } finally {
      gate.resolve({ ok: true, notes: [] });
      await run;
    }
  },
);
it("rechecks when a fetched pull is admitted into its transaction callback", async () => {
  linkOldNote();
  const before = snapshot();
  transactionWait = hold();
  const gate = transactionWait;
  const run = start();
  try {
    await reached(gate.entered.promise, run);
    switchSession(session(USER_B, SESSION_B));
    gate.release.resolve();
    expect(failure(await run)).toBeInstanceOf(Error);
    expect(transactionCount).toBe(1);
    expect(snapshot()).toEqual(before);
  } finally {
    gate.release.resolve();
    await run;
  }
});

it("preserves an unrelated edit when the account changes after BEGIN before merge admission", async () => {
  linkOldNote();
  transactionOpenedWait = hold();
  const gate = transactionOpenedWait;
  const run = start();
  try {
    await reached(gate.entered.promise, run);
    switchSession(session(USER_B, SESSION_B));
    await db.runAsync(
      "INSERT INTO private_notes (id,surah,ayah_start,ayah_end,content,created_at,updated_at) VALUES ('new-owner-note',2,256,256,'synthetic new owner edit',?,?)",
      [OLD, OLD],
    );
    gate.release.resolve();
    expect(failure(await run)).toBeInstanceOf(Error);
    expect(sql.prepare("SELECT content FROM private_notes WHERE id='new-owner-note'").get()).toEqual({
      content: "synthetic new owner edit",
    });
    expect(sql.prepare("SELECT deleted_at FROM private_notes WHERE id='local-note'").get()).toEqual({
      deleted_at: null,
    });
    expect(sql.prepare("SELECT value FROM user_settings WHERE key='qf_last_sync_at'").get()).toBeUndefined();
  } finally {
    gate.release.resolve();
    await run;
  }
});

it.each(["bookmark read", "note read", "queue write"])(
  "settles an admitted merge and preserves unrelated edits after supersession at %s",
  async (boundary) => {
    noPush();
    responses["list-bookmarks"] = {
      ok: true,
      bookmarks: [
        {
          id: "remote-bookmark",
          type: "ayah",
          surah: 2,
          ayah: 256,
          createdAt: OLD,
          isInDefaultCollection: true,
          collectionsCount: 0,
        },
      ],
    };
    responses["list-notes"] = { ok: true, notes: [REMOTE_NOTE] };
    const gate = hold();
    if (boundary === "queue write") enqueueWait = gate;
    else
      readWait = {
        gate,
        query: boundary === "bookmark read" ? "FROM bookmarks WHERE surah" : "FROM private_notes WHERE qf_note_id",
      };
    const run = start();
    try {
      await reached(gate.entered.promise, run);
      switchSession(session(USER_B, SESSION_B));
      await db.runAsync(
        "INSERT INTO private_notes (id,surah,ayah_start,ayah_end,content,created_at,updated_at) VALUES ('new-owner-note',2,257,257,'synthetic new owner edit',?,?)",
        [OLD, OLD],
      );
      gate.release.resolve();
      expect(failure(await run)).toBeInstanceOf(Error);
      expect(sql.prepare("SELECT content FROM private_notes WHERE id='new-owner-note'").get()).toEqual({
        content: "synthetic new owner edit",
      });
      expect(sql.prepare("SELECT qf_bookmark_id FROM bookmarks WHERE surah=2 AND ayah=256").get()).toEqual({
        qf_bookmark_id: "remote-bookmark",
      });
      expect(sql.prepare("SELECT qf_note_id FROM private_notes WHERE id='local-note'").get()).toEqual({
        qf_note_id: REMOTE_NOTE.id,
      });
      expect(sql.prepare("SELECT COUNT(*) AS count FROM sync_queue").get()).toEqual({ count: 2 });
      expect(sql.prepare("SELECT value FROM user_settings WHERE key='qf_last_sync_at'").get()).toBeUndefined();
      expect(requests.map((request) => request.action)).toEqual(["status", "list-bookmarks", "list-notes"]);
    } finally {
      gate.release.resolve();
      await run;
    }
  },
);
it("preserves rollback and the original error for an ordinary merge SQL failure", async () => {
  noPush();
  responses["list-bookmarks"] = {
    ok: true,
    bookmarks: [
      {
        id: "remote-bookmark",
        type: "ayah",
        surah: 2,
        ayah: 256,
        createdAt: OLD,
        isInDefaultCollection: true,
        collectionsCount: 0,
      },
    ],
  };
  responses["list-notes"] = { ok: true, notes: [REMOTE_NOTE] };
  const before = snapshot();
  const originalRead = db.getFirstAsync.bind(db);
  const error = new Error("Synthetic merge SQL failure");
  jest.spyOn(db, "getFirstAsync").mockImplementation(async (source, ...params) => {
    if (source.includes("WHERE qf_note_id")) throw error;
    return originalRead(source, ...params);
  });
  await expect(fullQfUserSync(db)).rejects.toBe(error);
  expect(snapshot()).toEqual(before);
  expect(transactionCount).toBe(1);
});

it("uses renewed matching SDK credentials when the store token has expired", async () => {
  switchSession({ ...session(), expires_at: 1 });
  const fresh = session(USER_A, SESSION_A, 42);
  // SDK renewal may return before the store observes its same-session notification.
  authSession.mockResolvedValue({ data: { session: fresh }, error: null });
  await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "synced" });
  expect(authSession).toHaveBeenCalled();
  expect(requests.every((request) => request.authorization === "Bearer " + fresh.access_token)).toBe(true);
});
it("keeps a same-session token refresh current during a deferred status response", async () => {
  const entered = watch("status");
  const gate = deferred<unknown>();
  responses.status = gate.promise;
  const fresh = session(USER_A, SESSION_A, 42);
  const run = start();
  try {
    await reached(entered, run);
    switchSession(fresh);
    gate.resolve({ ok: true, status: "connected" });
    expect(await run).toMatchObject({ kind: "resolved", value: { status: "synced" } });
    expect(requests[0].authorization).toBe("Bearer " + token(USER_A, SESSION_A));
    expect(requests.slice(1).every((request) => request.authorization === "Bearer " + fresh.access_token)).toBe(true);
  } finally {
    gate.resolve({ ok: true, status: "connected" });
    await run;
  }
});
it.each([
  { label: "missing", fresh: null, error: null },
  { label: "foreign user", fresh: session(USER_B, SESSION_B), error: null },
  { label: "same user different session", fresh: session(USER_A, SESSION_A2), error: null },
  { label: "SDK error", fresh: null, error: new Error("Synthetic auth error") },
])("rejects a $label SDK session before QF dispatch", async ({ fresh, error }) => {
  const before = snapshot();
  authSession.mockResolvedValue({ data: { session: fresh }, error });
  if (error) await expect(fullQfUserSync(db)).rejects.toBe(error);
  else await expect(fullQfUserSync(db)).rejects.toThrow("sync session changed");
  expect(requests).toHaveLength(0);
  expect(snapshot()).toEqual(before);
});
it("retires a delayed SDK session result even if it returns the original session", async () => {
  const gate = deferred<Awaited<ReturnType<typeof authSession>>>();
  const entered = deferred<void>();
  const original = mockCurrentSession;
  authSession.mockImplementationOnce(async () => {
    entered.resolve();
    return gate.promise;
  });
  const before = snapshot();
  const run = start();
  try {
    await reached(entered.promise, run);
    switchSession(session(USER_B, SESSION_B));
    gate.resolve({ data: { session: original }, error: null });
    expect(failure(await run)).toBeInstanceOf(Error);
    expect(requests).toHaveLength(0);
    expect(snapshot()).toEqual(before);
  } finally {
    gate.resolve({ data: { session: original }, error: null });
    await run;
  }
});

it.each(["success", "error"])("does not attach or acknowledge an obsolete push %s", async (reply) => {
  const entered = watch("create-note");
  const gate = deferred<unknown>();
  responses["create-note"] = gate.promise;
  const before = snapshot();
  const run = start();
  const response =
    reply === "success"
      ? { ok: true, note: REMOTE_NOTE }
      : { ok: false, code: "upstream", message: "Obsolete push error" };
  try {
    await reached(entered, run);
    switchSession(session(USER_B, SESSION_B));
    gate.resolve(response);
    expect(failure(await run)).toBeInstanceOf(Error);
    expect(snapshot()).toEqual(before);
    expect(requests.some((request) => request.action.startsWith("list-"))).toBe(false);
  } finally {
    gate.resolve(response);
    await run;
  }
});
it("retires an HTTP error whose body is parsed after account replacement", async () => {
  const entered = deferred<void>();
  const body = deferred<unknown>();
  const response = new Response("", { status: 500, headers: { "Content-Type": "application/json" } });
  response.json = async () => {
    entered.resolve();
    return body.promise;
  };
  responses["create-note"] = response;
  const before = snapshot();
  const run = start();
  try {
    await reached(entered.promise, run);
    switchSession(session(USER_B, SESSION_B));
    body.resolve({ ok: false, code: "upstream", message: "Obsolete parsed error" });
    expect(failure(await run)).toBeInstanceOf(Error);
    expect(snapshot()).toEqual(before);
  } finally {
    body.resolve({ ok: false, code: "upstream", message: "Obsolete parsed error" });
    await run;
  }
});
it("waits for an issued Supabase enqueue and retires before QF queue acknowledgement", async () => {
  enqueueWait = hold();
  const gate = enqueueWait;
  const before = queueState();
  const run = start();
  try {
    await reached(gate.entered.promise, run);
    switchSession(session(USER_B, SESSION_B));
    gate.release.resolve();
    expect(failure(await run)).toBeInstanceOf(Error);
    expect(queueState()).toEqual(before);
    expect(sql.prepare("SELECT COUNT(*) AS count FROM sync_queue").get()).toEqual({ count: 1 });
    expect(requests.some((request) => request.action.startsWith("list-"))).toBe(false);
    // The prior local attachment and already-issued SQL are not claimed to be cancelled.
  } finally {
    gate.release.resolve();
    await run;
  }
});

it.each(["unconfigured", "signed out", "unidentified"])("does no account work when %s", async (state) => {
  const before = snapshot();
  if (state === "unconfigured") mockConfigured = false;
  if (state === "signed out") switchSession(null);
  if (state === "unidentified") switchSession({ ...session(), access_token: "unidentified" });
  await expect(fullQfUserSync(db)).resolves.toEqual({ status: "not_connected", pushed: 0, pulled: 0 });
  expect(requests).toHaveLength(0);
  expect(authSession).not.toHaveBeenCalled();
  expect(snapshot()).toEqual(before);
});
it("keeps public offline enqueue and count independent from account configuration", async () => {
  mockConfigured = false;
  switchSession(null);
  await enqueueQfSync(db, "bookmark", "UPSERT", "2:256", { surah: 2, ayah: 256 });
  expect(await getPendingQfSyncCount(db)).toBe(2);
  expect(requests).toHaveLength(0);
  expect(authSession).not.toHaveBeenCalled();
});
it("preserves the existing unowned invocation path for legacy callers", async () => {
  await expect(invokeQfUser({ action: "status" })).resolves.toMatchObject({ ok: true, status: "connected" });
  expect(authSession).not.toHaveBeenCalled();
  expect(requests).toEqual([{ action: "status", authorization: "Bearer " + token(USER_A, SESSION_A) }]);
});

it.each(["full-ready", "full-initial", "explicit-initial"] as const)(
  "reports failed queue entries and preserves the success timestamp in %s",
  async (mode) => {
    sql.prepare("INSERT INTO user_settings (key,value) VALUES ('qf_last_sync_at',?)").run(OLD);
    if (mode === "full-initial") sql.exec("DELETE FROM user_settings WHERE key='qf_initial_local_enqueue_done'");
    responses["create-note"] = { ok: false, code: "upstream", message: "Synthetic push failure" };
    const result = mode === "explicit-initial" ? await runInitialQfUserSync(db) : await fullQfUserSync(db);
    expect(result).toMatchObject({ status: "failed", pushed: 0, pulled: 0 });
    const expectedCount = mode === "full-ready" ? 1 : 2;
    expect(await getPendingQfSyncCount(db)).toBe(expectedCount);
    expect(queueState()).toEqual(
      Array.from({ length: expectedCount }, () => ({
        status: "failed",
        attempt_count: 1,
        last_error: "Synthetic push failure",
      })),
    );
    expect(sql.prepare("SELECT value FROM user_settings WHERE key='qf_last_sync_at'").get()).toEqual({ value: OLD });
  },
);

it("includes exhausted QF entries in incomplete status without resetting attempts", async () => {
  sql.exec("UPDATE qf_sync_queue SET status='failed',attempt_count=5,last_error='prior failure'");
  sql.prepare("INSERT INTO user_settings (key,value) VALUES ('qf_last_sync_at',?)").run(OLD);
  const before = queueState();
  await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "failed", pushed: 0 });
  expect(queueState()).toEqual(before);
  expect(await getPendingQfSyncCount(db)).toBe(1);
  expect(requests.some(({ action }) => action === "create-note")).toBe(false);
  expect(sql.prepare("SELECT value FROM user_settings WHERE key='qf_last_sync_at'").get()).toEqual({ value: OLD });
});

it("reports the 100-entry QF cap as incomplete, retaining the remaining entry for retry", async () => {
  noPush();
  sql.prepare("INSERT INTO user_settings (key,value) VALUES ('qf_last_sync_at',?)").run(OLD);
  for (let index = 0; index < 101; index += 1)
    await enqueueQfSync(db, "private_note", "UPSERT", "missing-note-" + index, {});
  await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "failed", pushed: 100 });
  expect(await getPendingQfSyncCount(db)).toBe(1);
  expect(queueState().filter((row) => row.status === "pending")).toHaveLength(1);
  expect(sql.prepare("SELECT value FROM user_settings WHERE key='qf_last_sync_at'").get()).toEqual({ value: OLD });
  await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "synced", pushed: 1 });
  expect(await getPendingQfSyncCount(db)).toBe(0);
  expect(sql.prepare("SELECT value FROM user_settings WHERE key='qf_last_sync_at'").get()?.value).not.toBe(OLD);
});

it("includes QF work enqueued while the final pull is pending", async () => {
  noPush();
  sql.prepare("INSERT INTO user_settings (key,value) VALUES ('qf_last_sync_at',?)").run(OLD);
  const entered = watch("list-notes");
  const gate = deferred<unknown>();
  responses["list-notes"] = gate.promise;
  const run = start();
  try {
    await reached(entered, run);
    await enqueueQfSync(db, "private_note", "UPSERT", "new-work", {});
    gate.resolve({ ok: true, notes: [] });
    expect(await run).toMatchObject({ kind: "resolved", value: { status: "failed", pushed: 0 } });
    expect(await getPendingQfSyncCount(db)).toBe(1);
    expect(queueState()).toEqual([{ status: "pending", attempt_count: 0, last_error: null }]);
    expect(sql.prepare("SELECT value FROM user_settings WHERE key='qf_last_sync_at'").get()).toEqual({ value: OLD });
  } finally {
    gate.resolve({ ok: true, notes: [] });
    await run;
  }
});

it("rechecks ownership after the final pending-count read before writing success", async () => {
  noPush();
  sql.prepare("INSERT INTO user_settings (key,value) VALUES ('qf_last_sync_at',?)").run(OLD);
  readWait = { query: "SELECT COUNT(*) as count FROM qf_sync_queue", gate: hold() };
  const gate = readWait.gate;
  const run = start();
  try {
    await reached(gate.entered.promise, run);
    switchSession(session(USER_B, SESSION_B));
    gate.release.resolve();
    expect(failure(await run)).toEqual(expect.any(Error));
    expect(sql.prepare("SELECT value FROM user_settings WHERE key='qf_last_sync_at'").get()).toEqual({ value: OLD });
    expect(requests.every(({ authorization }) => authorization === "Bearer " + token(USER_A, SESSION_A))).toBe(true);
  } finally {
    gate.release.resolve();
    await run;
  }
});

it.each(["full-ready", "full-initial"] as const)(
  "retires after the final result fence before caller timestamp publication in %s",
  async (mode) => {
    noPush();
    sql.exec("DELETE FROM private_notes");
    if (mode === "full-initial") sql.exec("DELETE FROM user_settings WHERE key='qf_initial_local_enqueue_done'");
    sql.prepare("INSERT INTO user_settings (key,value) VALUES ('qf_last_sync_at',?)").run(OLD);
    let retired = false;
    retireAfterCountRead = () => {
      retired = true;
      switchSession(session(USER_B, SESSION_B));
    };
    await expect(fullQfUserSync(db)).rejects.toThrow("Quran Foundation sync account changed");
    expect(retired).toBe(true);
    expect(sql.prepare("SELECT value FROM user_settings WHERE key='qf_last_sync_at'").get()).toEqual({ value: OLD });
    expect(requests.every(({ authorization }) => authorization === "Bearer " + token(USER_A, SESSION_A))).toBe(true);
  },
);

function initialOwner() {
  const owner = captureQfRequestOwner({
    getState: () => ({ user: mockCurrentSession?.user ?? null, session: mockCurrentSession }),
    readSession: async () => {
      const { data, error } = await authSession();
      if (error) throw error;
      return data.session ? { data: { session: data.session }, error: null } : { data: { session: null }, error: null };
    },
  });
  if (!owner) throw new Error("Missing synthetic initial owner");
  return owner;
}
it.each(["external", "ABA", "signed out"])(
  "explicit initial-sync owner cannot be recaptured after %s",
  async (kind) => {
    const original = mockCurrentSession,
      owner = initialOwner(),
      before = snapshot();
    switchSession(kind === "signed out" ? null : session(USER_B, SESSION_B));
    if (kind === "ABA") switchSession(original);
    await expect(runInitialQfUserSync(db, owner)).rejects.toThrow("account changed");
    expect(requests).toEqual([]);
    expect(snapshot()).toEqual(before);
    expect(authSession).not.toHaveBeenCalled();
  },
);
it("explicit missing initial owner fails closed without capturing the current account", async () => {
  const before = snapshot();
  await expect(runInitialQfUserSync(db, null)).resolves.toMatchObject({ status: "not_connected" });
  expect(requests).toEqual([]);
  expect(snapshot()).toEqual(before);
});
it("current explicit initial owner supplies every credential read", async () => {
  const owner = initialOwner();
  const read = jest.spyOn(owner, "getAccessToken");
  await expect(runInitialQfUserSync(db, owner)).resolves.toMatchObject({ status: "synced" });
  expect(read).toHaveBeenCalled();
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((request) => request.authorization === "Bearer " + mockCurrentSession?.access_token)).toBe(
    true,
  );
});

it("keeps an acknowledged note UPSERT failed when its account queue insert aborts", async () => {
  sql.exec(
    "CREATE TEMP TRIGGER fail_post_push_sync_queue BEFORE INSERT ON sync_queue WHEN NEW.table_name = 'private_notes' AND NEW.row_id = 'local-note' BEGIN SELECT RAISE(ABORT, 'RF160 note queue insert aborted'); END;",
  );
  responses["list-bookmarks"] = { ok: true, bookmarks: [] };
  responses["list-notes"] = { ok: true, notes: [REMOTE_NOTE] };
  try {
    await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "failed", pushed: 0 });
    expect(sql.prepare("SELECT qf_note_id,qf_synced_at FROM private_notes WHERE id='local-note'").get()).toEqual({
      qf_note_id: "remote-note",
      qf_synced_at: expect.any(String),
    });
    expect(queueState()).toEqual([
      { status: "failed", attempt_count: 1, last_error: expect.stringContaining("RF160 note queue insert aborted") },
    ]);
    expect(sql.prepare("SELECT * FROM sync_queue").all()).toEqual([]);
    expect(requests.filter((request) => request.action === "create-note")).toHaveLength(1);
    sql.exec("DROP TRIGGER fail_post_push_sync_queue");
    await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "synced" });
    expect(requests.filter((request) => request.action === "create-note")).toHaveLength(1);
    expect(requests.filter((request) => request.action === "update-note")).toHaveLength(1);
    const queued = sql
      .prepare(
        "SELECT data FROM sync_queue WHERE table_name='private_notes' AND row_id='local-note' ORDER BY id DESC LIMIT 1",
      )
      .get() as { data: string };
    expect(JSON.parse(queued.data)).toMatchObject({
      id: "local-note",
      content: "synthetic local note",
      qf_note_id: "remote-note",
    });
  } finally {
    sql.exec("DROP TRIGGER IF EXISTS fail_post_push_sync_queue");
  }
});
it.each([
  { label: "valid edit", content: "edited after enqueue failure", deleted: null, updateRemote: true },
  { label: "unsyncable edit", content: "x", deleted: null, updateRemote: false },
  { label: "deletion", content: "synthetic local note", deleted: "2026-02-02T00:00:00.000Z", updateRemote: false },
])("retries a failed note UPSERT using the current $label row", async ({ content, deleted, updateRemote }) => {
  sql.exec(
    "CREATE TEMP TRIGGER fail_post_push_sync_queue BEFORE INSERT ON sync_queue WHEN NEW.table_name = 'private_notes' AND NEW.row_id = 'local-note' BEGIN SELECT RAISE(ABORT, 'RF160 retry queue insert aborted'); END;",
  );
  responses["list-bookmarks"] = { ok: true, bookmarks: [] };
  responses["list-notes"] = { ok: true, notes: [REMOTE_NOTE] };
  try {
    await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "failed", pushed: 0 });
    expect(queueState()).toEqual([
      { status: "failed", attempt_count: 1, last_error: expect.stringContaining("RF160 retry queue insert aborted") },
    ]);
    expect(sql.prepare("SELECT qf_note_id FROM private_notes WHERE id='local-note'").get()).toEqual({
      qf_note_id: "remote-note",
    });

    const createdAt = "2001-02-03T04:05:06.123456Z";
    const updatedAt = "2026-02-02T01:00:00.000+01:00";
    sql
      .prepare("UPDATE private_notes SET content=?,created_at=?,updated_at=?,deleted_at=? WHERE id='local-note'")
      .run(content, createdAt, updatedAt, deleted);
    sql.exec("DROP TRIGGER fail_post_push_sync_queue");
    responses["update-note"] = { ok: true, note: REMOTE_NOTE };
    await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "synced" });

    const stored = sql
      .prepare("SELECT content,created_at,updated_at,deleted_at,qf_note_id FROM private_notes WHERE id='local-note'")
      .get();
    expect(stored).toEqual({
      content,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: deleted,
      qf_note_id: "remote-note",
    });
    const queued = sql
      .prepare(
        "SELECT data FROM sync_queue WHERE table_name='private_notes' AND row_id='local-note' ORDER BY id ASC LIMIT 1",
      )
      .get() as { data: string };
    expect(JSON.parse(queued.data)).toMatchObject({
      content,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: deleted,
      qf_note_id: "remote-note",
    });
    expect(requests.filter((request) => request.action === "create-note")).toHaveLength(1);
    expect(requests.filter((request) => request.action === "update-note")).toHaveLength(updateRemote ? 1 : 0);
  } finally {
    sql.exec("DROP TRIGGER IF EXISTS fail_post_push_sync_queue");
  }
});

it("keeps an acknowledged bookmark UPSERT failed when its account queue insert aborts", async () => {
  seedActiveBookmark();
  await enqueueQfSync(db, "bookmark", "UPSERT", "2:256", { surah: 2, ayah: 256 });
  responses["upsert-bookmark"] = validBookmarkAck;
  responses["list-bookmarks"] = { ok: true, bookmarks: [validBookmarkAck.bookmark] };
  responses["list-notes"] = { ok: true, notes: [] };
  sql.exec(
    "CREATE TEMP TRIGGER fail_post_push_bookmark_queue BEFORE INSERT ON sync_queue WHEN NEW.table_name = 'bookmarks' AND NEW.row_id = '2:256' BEGIN SELECT RAISE(ABORT, 'RF160 bookmark queue insert aborted'); END;",
  );
  try {
    await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "failed", pushed: 0 });
    expect(sql.prepare("SELECT qf_bookmark_id FROM bookmarks WHERE surah=2 AND ayah=256").get()).toEqual({
      qf_bookmark_id: "remote-bookmark",
    });
    expect(queueState()).toEqual([
      {
        status: "failed",
        attempt_count: 1,
        last_error: expect.stringContaining("RF160 bookmark queue insert aborted"),
      },
    ]);
    expect(sql.prepare("SELECT * FROM sync_queue").all()).toEqual([]);
    expect(requests.filter((request) => request.action === "upsert-bookmark")).toHaveLength(1);
    sql.exec("DROP TRIGGER fail_post_push_bookmark_queue");
    await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "synced" });
    expect(requests.filter((request) => request.action === "upsert-bookmark")).toHaveLength(1);
    const queued = sql
      .prepare("SELECT data FROM sync_queue WHERE table_name='bookmarks' AND row_id='2:256' ORDER BY id DESC LIMIT 1")
      .get() as { data: string };
    expect(JSON.parse(queued.data)).toMatchObject({ surah: 2, ayah: 256, qf_bookmark_id: "remote-bookmark" });
  } finally {
    sql.exec("DROP TRIGGER IF EXISTS fail_post_push_bookmark_queue");
  }
});
it.each([
  { label: "valid edit", content: "edited local note", deleted: null },
  { label: "unsyncable edit", content: "x", deleted: null },
  { label: "deletion", content: "synthetic local note", deleted: "2026-02-02T00:00:00.000Z" },
])("queues the current note after create acknowledgement with a concurrent $label", async ({ content, deleted }) => {
  const gate = deferred<unknown>();
  const entered = watch("create-note");
  responses["create-note"] = gate.promise;
  responses["list-bookmarks"] = { ok: true, bookmarks: [] };
  responses["list-notes"] = { ok: true, notes: [{ ...REMOTE_NOTE, id: "remote-note" }] };
  const run = start();
  try {
    await reached(entered, run);
    const updatedAt = "2026-02-02T00:00:00.000Z";
    sql
      .prepare("UPDATE private_notes SET content=?,updated_at=?,deleted_at=? WHERE id='local-note'")
      .run(content, updatedAt, deleted);
    gate.resolve({ ok: true, note: { ...REMOTE_NOTE, id: "remote-note" } });
    await expect(run).resolves.toMatchObject({ kind: "resolved", value: { status: "synced" } });
    expect(
      sql.prepare("SELECT content,updated_at,deleted_at,qf_note_id FROM private_notes WHERE id='local-note'").get(),
    ).toEqual({
      content,
      updated_at: updatedAt,
      deleted_at: deleted,
      qf_note_id: "remote-note",
    });
    const queued = sql
      .prepare(
        "SELECT data FROM sync_queue WHERE table_name='private_notes' AND row_id='local-note' ORDER BY id DESC LIMIT 1",
      )
      .get() as { data: string };
    expect(JSON.parse(queued.data)).toMatchObject({
      content,
      updated_at: updatedAt,
      deleted_at: deleted,
      qf_note_id: "remote-note",
    });
  } finally {
    gate.resolve({ ok: true, note: { ...REMOTE_NOTE, id: "remote-note" } });
    await run;
  }
});

it("allows at-least-once account enqueue when QF acknowledgement marking fails", async () => {
  sql.exec(
    "CREATE TEMP TRIGGER fail_qf_synced BEFORE UPDATE ON qf_sync_queue WHEN NEW.status='synced' BEGIN SELECT RAISE(ABORT, 'RF160 mark synced aborted'); END;",
  );
  responses["list-bookmarks"] = { ok: true, bookmarks: [] };
  responses["list-notes"] = { ok: true, notes: [REMOTE_NOTE] };
  try {
    await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "failed", pushed: 0 });
    expect(queueState()).toEqual([
      { status: "failed", attempt_count: 1, last_error: expect.stringContaining("RF160 mark synced aborted") },
    ]);
    expect(
      sql
        .prepare("SELECT COUNT(*) AS count FROM sync_queue WHERE table_name='private_notes' AND row_id='local-note'")
        .get(),
    ).toEqual({ count: 1 });
    sql.exec("DROP TRIGGER fail_qf_synced");
    await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "synced" });
    expect(requests.filter((request) => request.action === "create-note")).toHaveLength(1);
    const queuedRows = sql
      .prepare(
        "SELECT operation,data FROM sync_queue WHERE table_name='private_notes' AND row_id='local-note' ORDER BY id",
      )
      .all() as { operation: string; data: string }[];
    expect(queuedRows).toHaveLength(2);
    for (const row of queuedRows) {
      expect(row.operation).toBe("UPDATE");
      expect(JSON.parse(row.data)).toMatchObject({
        id: "local-note",
        content: "synthetic local note",
        created_at: OLD,
        updated_at: OLD,
        deleted_at: null,
        qf_note_id: "remote-note",
      });
    }
  } finally {
    sql.exec("DROP TRIGGER IF EXISTS fail_qf_synced");
  }
});

it.each(["edit", "delete"] as const)(
  "preserves a bookmark %s made while its UPSERT acknowledgement is held",
  async (change) => {
    seedActiveBookmark();
    await enqueueQfSync(db, "bookmark", "UPSERT", "2:256", { surah: 2, ayah: 256 });
    const gate = deferred<unknown>();
    const entered = watch("upsert-bookmark");
    responses["upsert-bookmark"] = gate.promise;
    responses["list-bookmarks"] = { ok: true, bookmarks: [validBookmarkAck.bookmark] };
    responses["list-notes"] = { ok: true, notes: [] };
    const run = start();
    try {
      await reached(entered, run);
      const editedAt = "2026-02-02T00:00:00.000Z";
      sql
        .prepare("UPDATE bookmarks SET updated_at=?,deleted_at=? WHERE surah=2 AND ayah=256")
        .run(editedAt, change === "delete" ? editedAt : null);
      gate.resolve(validBookmarkAck);
      await expect(run).resolves.toMatchObject({ kind: "resolved", value: { status: "synced" } });
      expect(
        sql
          .prepare("SELECT created_at,updated_at,deleted_at,qf_bookmark_id FROM bookmarks WHERE surah=2 AND ayah=256")
          .get(),
      ).toEqual({
        created_at: OLD,
        updated_at: editedAt,
        deleted_at: change === "delete" ? editedAt : null,
        qf_bookmark_id: "remote-bookmark",
      });
      const queued = sql
        .prepare("SELECT data FROM sync_queue WHERE table_name='bookmarks' AND row_id='2:256' ORDER BY id DESC LIMIT 1")
        .get() as { data: string };
      expect(JSON.parse(queued.data)).toMatchObject({
        created_at: OLD,
        updated_at: editedAt,
        deleted_at: change === "delete" ? editedAt : null,
        qf_bookmark_id: "remote-bookmark",
      });
    } finally {
      gate.resolve(validBookmarkAck);
      await run;
    }
  },
);

it("retires during a push account enqueue before acknowledging the QF entry", async () => {
  enqueueWait = hold();
  const gate = enqueueWait;
  const before = queueState();
  const run = start();
  try {
    await reached(gate.entered.promise, run);
    switchSession(session(USER_B, SESSION_B));
    gate.release.resolve();
    expect(failure(await run)).toBeInstanceOf(Error);
    expect(queueState()).toEqual(before);
    expect(
      sql
        .prepare("SELECT COUNT(*) AS count FROM sync_queue WHERE table_name='private_notes' AND row_id='local-note'")
        .get(),
    ).toEqual({ count: 1 });
    expect(requests.map((request) => request.action)).toEqual(["status", "create-note"]);
  } finally {
    gate.release.resolve();
    await run;
  }
});

it("keeps a committed post-push note acknowledgement when a later pull transaction queue abort rolls back its prefix", async () => {
  sql.prepare("INSERT INTO bookmarks (surah,ayah,created_at,updated_at) VALUES (2,257,?,?)").run(OLD, OLD);
  const prefixBookmark = {
    id: "remote-bookmark-prefix",
    surah: 2,
    ayah: 256,
    type: "ayah",
    createdAt: OLD,
    isInDefaultCollection: false,
    collectionsCount: 0,
  };
  const laterBookmark = {
    ...prefixBookmark,
    id: "remote-bookmark-later",
    ayah: 257,
  };
  responses["list-bookmarks"] = { ok: true, bookmarks: [prefixBookmark, laterBookmark] };
  responses["list-notes"] = { ok: true, notes: [REMOTE_NOTE] };
  sql.exec(`
    CREATE TEMP TRIGGER fail_later_pull_queue
    BEFORE INSERT ON sync_queue
    WHEN NEW.table_name = 'bookmarks' AND NEW.row_id = '2:257'
    BEGIN SELECT RAISE(ABORT, 'RF158 later pull queue aborted'); END;
  `);

  const firstOutcome = await start();
  expect({
    outcome: firstOutcome,
    note: sql.prepare("SELECT qf_note_id,qf_synced_at FROM private_notes WHERE id='local-note'").get(),
    qfQueue: queueState(),
    bookmarks: sql.prepare("SELECT surah,ayah,qf_bookmark_id,updated_at,deleted_at FROM bookmarks ORDER BY ayah").all(),
    syncQueue: sql.prepare("SELECT table_name,row_id FROM sync_queue ORDER BY id").all(),
    createCount: requests.filter((request) => request.action === "create-note").length,
  }).toEqual({
    outcome: {
      kind: "rejected",
      error: expect.objectContaining({ message: expect.stringContaining("RF158 later pull queue aborted") }),
    },
    note: { qf_note_id: "remote-note", qf_synced_at: expect.any(String) },
    qfQueue: [{ status: "synced", attempt_count: 0, last_error: null }],
    bookmarks: [{ surah: 2, ayah: 257, qf_bookmark_id: null, updated_at: OLD, deleted_at: null }],
    syncQueue: [{ table_name: "private_notes", row_id: "local-note" }],
    createCount: 1,
  });

  sql.exec("DROP TRIGGER fail_later_pull_queue");
  await expect(fullQfUserSync(db)).resolves.toMatchObject({ status: "synced" });
  expect(requests.filter((request) => request.action === "create-note")).toHaveLength(1);
  expect(sql.prepare("SELECT surah,ayah,qf_bookmark_id FROM bookmarks ORDER BY ayah").all()).toEqual([
    { surah: 2, ayah: 256, qf_bookmark_id: "remote-bookmark-prefix" },
    { surah: 2, ayah: 257, qf_bookmark_id: "remote-bookmark-later" },
  ]);
  expect(sql.prepare("SELECT table_name,row_id FROM sync_queue ORDER BY id").all()).toEqual([
    { table_name: "private_notes", row_id: "local-note" },
    { table_name: "bookmarks", row_id: "2:256" },
    { table_name: "bookmarks", row_id: "2:257" },
  ]);
});

it("reconciles QF pull rows and account queue through the real private transaction owner", async () => {
  const ownedSql = new DatabaseSync(":memory:");
  const raw: Parameters<typeof createConnectionOwner>[0] = {
    async execAsync(source) {
      ownedSql.exec(source);
    },
    async prepareAsync(source) {
      const statement = ownedSql.prepare(source);
      return {
        async executeAsync(...args: unknown[]) {
          const bindings = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
          const values = bindings as SQLInputValue[];
          const result = statement.columns().length ? null : statement.run(...values);
          return {
            changes: Number(result?.changes ?? 0),
            lastInsertRowId: Number(result?.lastInsertRowid ?? 0),
            getFirstAsync: async <T>() => (statement.get(...values) as T | undefined) ?? null,
            getAllAsync: async <T>() => statement.all(...values) as T[],
          };
        },
        async finalizeAsync() {},
      };
    },
    async closeAsync() {
      ownedSql.close();
    },
  };
  const owner = createConnectionOwner(raw);
  try {
    await createSchema(owner.database);
    await owner.database.runAsync(
      "INSERT INTO user_settings (key,value) VALUES ('qf_initial_local_enqueue_done','true')",
    );
    responses["list-bookmarks"] = { ok: true, bookmarks: [validBookmarkAck.bookmark] };
    responses["list-notes"] = { ok: true, notes: [REMOTE_NOTE] };
    await expect(fullQfUserSync(owner.database)).resolves.toMatchObject({ status: "synced", pulled: 2 });
    expect(
      await owner.database.getFirstAsync("SELECT content FROM private_notes WHERE qf_note_id = ?", [REMOTE_NOTE.id]),
    ).toEqual({ content: REMOTE_NOTE.body });
    expect(await owner.database.getAllAsync("SELECT table_name,operation,status FROM sync_queue ORDER BY id")).toEqual([
      { table_name: "bookmarks", operation: "INSERT", status: "pending" },
      { table_name: "private_notes", operation: "INSERT", status: "pending" },
    ]);
  } finally {
    await owner.close();
  }
});
