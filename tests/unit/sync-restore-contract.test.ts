import fs from "fs";
import path from "path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Session } from "@supabase/supabase-js";
import type { AppDatabase, TransactionDatabase } from "@/lib/database/types";
import { observeAuthSession } from "@/lib/auth/commands";
import { createSchema } from "@/lib/database/schema";
import {
  acceptRestoreConsent,
  cancelRestoreConsent,
  clearRestoreConsentRequests,
  fullSync,
  readRestorePause,
  restorePauseKey,
  RESTORE_CONSENT_TTL_MS,
  type SyncResult,
} from "@/lib/database/sync";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  const exportStart = source.indexOf(`export async function ${name}`);
  const functionStart = start >= 0 ? start : exportStart;
  expect(functionStart).toBeGreaterThanOrEqual(0);

  const braceStart = source.indexOf("{\n", functionStart);
  expect(braceStart).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(braceStart, i + 1);
  }
  throw new Error(`Could not parse function body for ${name}`);
}

describe("account sync restore contract", () => {
  it("restores account data, or returns for consent, before pushing any local queue entries", () => {
    const source = read("lib/database/sync.ts");
    const body = functionBody(source, "fullSync");

    expect(body.indexOf("readRestorePause")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("readRestorePause")).toBeLessThan(body.indexOf("restoreAccountDataIfNeeded"));
    expect(body.indexOf("restoreAccountDataIfNeeded")).toBeLessThan(body.indexOf("needs_restore_consent"));
    expect(body.indexOf("needs_restore_consent")).toBeLessThan(body.indexOf("runOrdinarySync"));
    expect(functionBody(source, "runOrdinarySync")).toContain("pushSyncQueue");
  });

  it("fetches remote rows before clearing local synced tables or preparing consent", () => {
    const source = read("lib/database/sync.ts");
    const body = functionBody(source, "restoreAccountDataIfNeeded");

    expect(body.indexOf("fetchRemoteAccountRows")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("fetchRemoteAccountRows")).toBeLessThan(body.indexOf("replaceLocalAccountData"));
    expect(body.indexOf("fetchRemoteAccountRows")).toBeLessThan(body.indexOf("prepareRestoreConsent"));
    expect(functionBody(source, "replaceLocalAccountData")).toContain("clearLocalSyncableData");
  });

  it("shares one replaced scope between clearing and the consent fingerprint", () => {
    const source = read("lib/database/sync.ts");
    const scope = source.slice(
      source.indexOf("const REPLACED_LOCAL_TABLES"),
      source.indexOf("];", source.indexOf("const REPLACED_LOCAL_TABLES")),
    );

    for (const table of [
      "study_cards",
      "study_log",
      "bookmarks",
      "highlights",
      "private_notes",
      "reflection_journey_entries",
      "achievement_unlocks",
      "user_word_meanings",
      "habit_days",
      "review_sessions",
      "recitation_errors",
      "sync_queue",
      "qf_sync_queue",
    ]) {
      expect(scope).toContain(`table: "${table}"`);
    }
    for (const name of ["clearLocalSyncableData", "readReplacedLocalState"]) {
      const body = functionBody(source, name);
      expect(body).toContain("REPLACED_LOCAL_TABLES");
      expect(body).toContain("isReplacedUserSetting");
    }
  });

  it("does not repair server surah progress before account restore is complete", () => {
    const source = read("lib/fsrs/leaderboard-sync.ts");
    const updateProfileStats = functionBody(source, "updateProfileStats");

    expect(updateProfileStats.indexOf("canWriteAccountDerivedStats")).toBeLessThan(
      updateProfileStats.indexOf("getLocalSurahProgress"),
    );
  });

  it("keeps server surah progress monotonic when local SQLite has fewer rows", () => {
    const updateProfileStats = functionBody(read("lib/fsrs/leaderboard-sync.ts"), "updateProfileStats");

    expect(updateProfileStats).toContain("Math.max(row.totalCards, existing?.total_cards ?? 0)");
    expect(updateProfileStats).toContain("Math.max(row.memorized, existing?.memorized_cards ?? 0)");
  });

  it("uses the owner's server surah progress only on their own profile", () => {
    const source = read("components/profile/ProfileModalContent.tsx");

    expect(source).toContain("chooseRicherSurahProgress(localSurahProgress, remoteSurahProgress)");
    expect(source).toContain("enabled: hasValidRequestedUserId && isOwnProfile,");
  });
});

// ─── W07 restore consent behavior against real SQLite ──────────────────────

const USER_A = "00000000-0000-4000-8000-0000000000a1";
const USER_B = "00000000-0000-4000-8000-0000000000b2";
const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-02-01T00:00:00.000Z";
let mockSession: Session | null = null;
let mockRemote: Record<string, Record<string, unknown>[]> = {};
let mockPageErrors = new Map<string, Error>();
const mockRequests: { table: string; incremental: boolean; offset: number }[] = [];
const mockUploads: { table: string; row: Record<string, unknown> }[] = [];

class MockRestoreQuery {
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
  limit() {
    return this;
  }
  async range(start: number, end: number) {
    mockRequests.push({ table: this.table, incremental: this.incremental, offset: start });
    const error = mockPageErrors.get(`${this.table}:${start}`);
    if (error) return { data: null, error };
    const rows = this.incremental ? [] : (mockRemote[this.table] ?? []);
    return { data: rows.slice(start, end + 1).map((row) => ({ ...row })), error: null };
  }
  async upsert(row: Record<string, unknown>) {
    mockUploads.push({ table: this.table, row });
    return { error: null };
  }
  delete() {
    return this;
  }
  lte() {
    return this;
  }
  then<T>(onfulfilled?: ((value: { data: unknown[]; error: null }) => T) | null) {
    return Promise.resolve({ data: [] as unknown[], error: null }).then(onfulfilled ?? undefined);
  }
}

jest.mock("@/lib/auth/store", () => ({
  useAuthStore: { getState: () => ({ user: mockSession?.user ?? null, session: mockSession }) },
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { from: (table: string) => new MockRestoreQuery(table) },
}));
jest.mock("@/lib/achievements/queries", () => ({
  backfillAchievements: jest.fn(async () => 0),
  insertRemoteAchievementUnlock: jest.fn(),
}));

let sessionSequence = 0;
function signIn(userId: string, email = "synthetic@example.test") {
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      session_id: `10000000-0000-4000-8000-${String(++sessionSequence).padStart(12, "0")}`,
    }),
  ).toString("base64url");
  mockSession = {
    user: { id: userId, email, aud: "authenticated", created_at: T0, app_metadata: {}, user_metadata: {} },
    access_token: `e30.${payload}.c2ln`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
  };
  observeAuthSession(mockSession);
}

function remoteSetting(userId: string) {
  return {
    user_id: userId,
    key: "daily_review_limit",
    value: "30",
    created_at: T0,
    updated_at: T1,
    synced_at: T1,
    deleted_at: null,
  };
}

let sql: DatabaseSync;
let restoreDb: AppDatabase;
let beforeTransaction: (() => void) | null = null;
let transactionCount = 0;

function put(key: string, value: string) {
  sql.prepare("INSERT OR REPLACE INTO user_settings (key,value,updated_at) VALUES (?,?,?)").run(key, value, T0);
}
function setting(key: string): string | undefined {
  return (sql.prepare("SELECT value FROM user_settings WHERE key = ?").get(key) as { value: string } | undefined)
    ?.value;
}
function bookmark(surah: number, ayah: number, updatedAt = T0) {
  sql
    .prepare("INSERT OR REPLACE INTO bookmarks (surah,ayah,created_at,updated_at) VALUES (?,?,?,?)")
    .run(surah, ayah, T0, updatedAt);
}
function queueRow(table: string, rowId: string, data: Record<string, unknown>, status = "pending") {
  sql
    .prepare("INSERT INTO sync_queue (table_name,operation,row_id,data,status,created_at) VALUES (?,?,?,?,?,?)")
    .run(table, "UPDATE", rowId, JSON.stringify(data), status, T0);
}
function onboardingSkip() {
  put("onboarding_completed", "true");
  queueRow("user_settings", "onboarding_completed", {
    key: "onboarding_completed",
    value: "true",
    updated_at: T0,
    deleted_at: null,
  });
}
function localState() {
  return {
    bookmarks: sql.prepare("SELECT * FROM bookmarks ORDER BY surah, ayah").all(),
    queue: sql.prepare("SELECT * FROM sync_queue ORDER BY id").all(),
    qfQueue: sql.prepare("SELECT * FROM qf_sync_queue ORDER BY id").all(),
    settings: sql
      .prepare("SELECT * FROM user_settings WHERE key NOT LIKE 'device_sync_restore_pause_%' ORDER BY key")
      .all(),
  };
}
async function prepare(): Promise<Extract<SyncResult, { status: "needs_restore_consent" }>> {
  const result = await fullSync(restoreDb);
  if (result.status !== "needs_restore_consent") throw new Error(`Expected consent, got ${result.status}`);
  return result;
}

describe("W07 restore consent", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    clearRestoreConsentRequests();
    mockRemote = { user_settings: [remoteSetting(USER_A)] };
    mockPageErrors = new Map();
    mockRequests.length = 0;
    mockUploads.length = 0;
    beforeTransaction = null;
    transactionCount = 0;
    observeAuthSession(null);
    signIn(USER_A);
    sql = new DatabaseSync(":memory:");
    const adapter = {
      execAsync: async (source: string) => sql.exec(source),
      getFirstAsync: async (source: string, params: SQLInputValue[] = []) => sql.prepare(source).get(...params) ?? null,
      getAllAsync: async (source: string, params: SQLInputValue[] = []) => sql.prepare(source).all(...params),
      runAsync: async (source: string, params: SQLInputValue[] = []) => sql.prepare(source).run(...params),
      withTransactionAsync: async (work: (transaction: TransactionDatabase) => Promise<void>) => {
        transactionCount += 1;
        const hook = beforeTransaction;
        beforeTransaction = null;
        hook?.();
        sql.exec("BEGIN");
        try {
          await work(restoreDb as unknown as TransactionDatabase);
          sql.exec("COMMIT");
        } catch (error) {
          sql.exec("ROLLBACK");
          throw error;
        }
      },
    };
    restoreDb = adapter as unknown as AppDatabase;
    await createSchema(restoreDb);
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    sql.close();
    mockSession = null;
    observeAuthSession(null);
    clearRestoreConsentRequests();
  });

  it.each([
    ["a queued change alone", () => queueRow("private_notes", "n1", { id: "n1" })],
    ["onboarding Skip plus a bookmark", () => (onboardingSkip(), bookmark(1, 1))],
    ["onboarding Skip plus a plan key", () => (onboardingSkip(), put("hifz_plan", "{}"))],
    ["last_mushaf_position alone", () => put("last_mushaf_position", '{"page":3}')],
  ])("asks before replacing %s, and returns before replacement, push or pull", async (_label, seed) => {
    seed();
    const before = localState();

    const result = await prepare();

    expect(localState()).toEqual(before);
    expect(mockUploads).toEqual([]);
    expect(mockRequests.every((request) => !request.incremental)).toBe(true);
    expect(await readRestorePause(restoreDb, USER_A)).toBe("pending_consent");
    expect(setting(`sync_account_restore_${USER_A}_20260614_account_restore_v1`)).toBeUndefined();
    expect(result.request).toMatchObject({ userId: USER_A, accountEmail: "synthetic@example.test" });
    expect(result.request.expiresAt - result.request.preparedAt).toBe(RESTORE_CONSENT_TTL_MS);
  });

  it("shows counts without onboarding, derived settings or qf_sync_queue", async () => {
    onboardingSkip();
    bookmark(1, 1);
    bookmark(1, 2);
    put("device_hifz_today_plan", "{}");
    sql
      .prepare(
        "INSERT INTO qf_sync_queue (entity_type,operation,local_id,data,status,created_at,updated_at) VALUES ('bookmark','UPSERT','x','{}','pending',?,?)",
      )
      .run(T0, T0);
    queueRow("bookmarks", "1:2", { surah: 1, ayah: 2 });

    const { request } = await prepare();

    expect(request.summary).toEqual({ categories: [{ key: "bookmarks", count: 2 }], pendingChanges: 1 });
  });

  it("restores without a prompt after onboarding Skip alone and keeps completed onboarding", async () => {
    onboardingSkip();

    const result = await fullSync(restoreDb);

    expect(result).toMatchObject({ status: "synced", accountRestored: true, localDataReplaced: false });
    expect(setting("onboarding_completed")).toBe("true");
    expect(setting("daily_review_limit")).toBe("30");
    expect(await readRestorePause(restoreDb, USER_A)).toBeNull();
  });

  it("does not prompt for derived, internal or qf_sync_queue state alone", async () => {
    put("device_hifz_today_plan", "{}");
    put("last_pull_at", T0);
    sql
      .prepare(
        "INSERT INTO qf_sync_queue (entity_type,operation,local_id,data,status,created_at,updated_at) VALUES ('bookmark','UPSERT','x','{}','pending',?,?)",
      )
      .run(T0, T0);

    const result = await fullSync(restoreDb);

    expect(result).toMatchObject({ status: "synced", accountRestored: true });
    // Still replaced: the derived key and the dormant queue belong to the replaced scope.
    expect(setting("device_hifz_today_plan")).toBeUndefined();
    expect(sql.prepare("SELECT COUNT(*) AS count FROM qf_sync_queue").get()).toEqual({ count: 0 });
  });

  it("rechecks the same trigger inside the no-prompt transaction and asks instead of clearing", async () => {
    beforeTransaction = () => bookmark(2, 255);

    const result = await fullSync(restoreDb);

    expect(result.status).toBe("needs_restore_consent");
    expect(sql.prepare("SELECT surah, ayah FROM bookmarks").all()).toEqual([{ surah: 2, ayah: 255 }]);
    expect(setting("daily_review_limit")).toBeUndefined();
    expect(mockUploads).toEqual([]);
  });

  it("keeps remote-empty behavior: local rows stay, no prompt, ordinary sync uploads them", async () => {
    mockRemote = {};
    bookmark(1, 1);

    const result = await fullSync(restoreDb);

    expect(result).toMatchObject({ status: "synced", accountRestored: false, restoreCompleted: true });
    expect(sql.prepare("SELECT surah, ayah FROM bookmarks").all()).toEqual([{ surah: 1, ayah: 1 }]);
    expect(mockUploads.map((upload) => upload.table)).toContain("bookmarks");
  });

  it("never clears or pauses on a partial snapshot", async () => {
    bookmark(1, 1);
    mockRemote = { user_settings: Array.from({ length: 500 }, () => remoteSetting(USER_A)) };
    mockPageErrors.set("user_settings:500", new Error("synthetic partial snapshot"));
    const before = localState();

    await expect(fullSync(restoreDb)).rejects.toThrow("synthetic partial snapshot");

    expect(localState()).toEqual(before);
    expect(await readRestorePause(restoreDb, USER_A)).toBeNull();
  });

  it("replaces atomically on valid acceptance, clears the pause and runs ordinary sync", async () => {
    bookmark(1, 1);
    queueRow("bookmarks", "1:1", { surah: 1, ayah: 1 });
    const { request } = await prepare();

    const result = await acceptRestoreConsent(restoreDb, request.token);

    expect(result).toMatchObject({
      status: "synced",
      accountRestored: true,
      localDataReplaced: true,
      restoreCompleted: true,
    });
    expect(sql.prepare("SELECT COUNT(*) AS count FROM bookmarks").get()).toEqual({ count: 0 });
    expect(setting("daily_review_limit")).toBe("30");
    expect(setting(restorePauseKey(USER_A))).toBeUndefined();
    expect(setting(`sync_account_restore_${USER_A}_20260614_account_restore_v1`)).toBe("true");
    expect(mockUploads.some((upload) => upload.table === "bookmarks")).toBe(false);
    expect(mockRequests.some((request) => request.incremental)).toBe(true);
    // One use only.
    await expect(acceptRestoreConsent(restoreDb, request.token)).resolves.toMatchObject({
      status: "restore_consent_invalid",
    });
  });

  it.each([
    ["a same-count edit", () => bookmark(1, 1, T1)],
    [
      "a queued delete",
      () => {
        sql.prepare("DELETE FROM bookmarks WHERE surah = 1 AND ayah = 2").run();
        queueRow("bookmarks", "1:2", { surah: 1, ayah: 2, deleted_at: T1 });
      },
    ],
    [
      "a dormant qf_sync_queue change",
      () =>
        sql
          .prepare(
            "INSERT INTO qf_sync_queue (entity_type,operation,local_id,data,status,created_at,updated_at) VALUES ('bookmark','UPSERT','y','{}','pending',?,?)",
          )
          .run(T0, T0),
    ],
  ])("rejects stale consent after %s without clearing or uploading", async (_label, mutate) => {
    bookmark(1, 1);
    bookmark(1, 2);
    const { request } = await prepare();
    mutate();
    const before = localState();

    const result = await acceptRestoreConsent(restoreDb, request.token);

    expect(result.status).toBe("restore_consent_stale");
    expect(localState()).toEqual(before);
    expect(mockUploads).toEqual([]);
    expect(await readRestorePause(restoreDb, USER_A)).toBe("pending_consent");
    await expect(acceptRestoreConsent(restoreDb, request.token)).resolves.toMatchObject({
      status: "restore_consent_invalid",
    });
  });

  it.each(["another account", "a new session of the same account"])(
    "rejects a token after switching to %s",
    async (transition) => {
      bookmark(1, 1);
      const { request } = await prepare();
      signIn(transition === "another account" ? USER_B : USER_A);
      const before = localState();

      await expect(acceptRestoreConsent(restoreDb, request.token)).resolves.toMatchObject({
        status: "restore_consent_invalid",
      });
      expect(localState()).toEqual(before);
    },
  );

  it("rejects an expired token and keeps sync paused", async () => {
    bookmark(1, 1);
    const { request } = await prepare();
    jest.spyOn(Date, "now").mockReturnValue(request.preparedAt + RESTORE_CONSENT_TTL_MS);

    await expect(acceptRestoreConsent(restoreDb, request.token)).resolves.toMatchObject({
      status: "restore_consent_invalid",
    });
    expect(sql.prepare("SELECT COUNT(*) AS count FROM bookmarks").get()).toEqual({ count: 1 });
    expect(await readRestorePause(restoreDb, USER_A)).toBe("pending_consent");
  });

  it("rolls back everything when the owner changes after the comparison", async () => {
    bookmark(1, 1);
    const { request } = await prepare();
    const before = localState();
    const original = sql.prepare.bind(sql);
    let switched = false;
    jest.spyOn(sql, "prepare").mockImplementation((source: string) => {
      // The first destructive statement of the replacement runs after the fingerprint matched.
      if (!switched && source.startsWith("DELETE FROM study_cards")) {
        switched = true;
        signIn(USER_B);
      }
      return original(source);
    });

    await expect(acceptRestoreConsent(restoreDb, request.token)).rejects.toThrow("Sync account changed");

    expect(switched).toBe(true);
    expect(localState()).toEqual(before);
    expect(await readRestorePause(restoreDb, USER_A)).toBe("pending_consent");
  });

  it("keeps a cancelled pause through restart, for that account only, until Resume sync", async () => {
    bookmark(1, 1);
    queueRow("bookmarks", "1:1", { surah: 1, ayah: 1 });
    const { request } = await prepare();
    const before = localState();

    await expect(cancelRestoreConsent(restoreDb)).resolves.toBe(true);
    await expect(acceptRestoreConsent(restoreDb, request.token)).resolves.toMatchObject({
      status: "restore_consent_invalid",
    });
    // A restart loses memory but not the stored pause; every automatic run stops before remote work.
    clearRestoreConsentRequests();
    mockRequests.length = 0;
    await expect(fullSync(restoreDb)).resolves.toMatchObject({ status: "sync_paused", pause: "cancelled" });
    expect(mockRequests).toEqual([]);
    expect(localState()).toEqual(before);

    // Account B is not paused by account A's marker.
    signIn(USER_B);
    expect(await readRestorePause(restoreDb, USER_B)).toBeNull();

    // Back on A, only an explicit resume fetches a fresh snapshot and asks again.
    signIn(USER_A);
    const resumed = await fullSync(restoreDb, { resume: true });
    expect(resumed.status).toBe("needs_restore_consent");
    expect(mockRequests.length).toBeGreaterThan(0);
    expect(localState()).toEqual(before);
  });

  it("captures the fingerprint in a short transaction after writing the pause", async () => {
    bookmark(1, 1);
    transactionCount = 0;
    await prepare();
    expect(transactionCount).toBe(1);
  });
});
