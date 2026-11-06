import type { SQLiteDatabase } from "expo-sqlite";
import type { Session, User } from "@supabase/supabase-js";
import type { Profile } from "@/lib/auth/types";
import type { ProfileSurahProgress } from "@/lib/profile/progress";
import { authCommands } from "@/lib/auth/commands";
import { formatUtcDateKey } from "@/lib/date";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import { useAuthStore } from "@/lib/auth/store";
import { syncDailyScore, updateProfileStats } from "@/lib/fsrs/leaderboard-sync";

interface QueryResult {
  data: unknown;
  error: Error | null;
}

type QueryKind = "select" | "insert" | "update" | "upsert" | "delete";
type QueryTerminal = "then" | "single" | "maybeSingle";
type QueryFilter = readonly [column: string, value: unknown];

interface QueryOperation {
  readonly table: string;
  kind: QueryKind;
  columns?: string;
  filters: QueryFilter[];
  data?: unknown;
  options?: unknown;
  terminal: QueryTerminal;
}

const mockOperations: QueryOperation[] = [];
const mockGetTotalScore = jest.fn<Promise<number>, [SQLiteDatabase]>();
const mockGetTodayScore = jest.fn<Promise<{ score: number; reviewsCount: number }>, [SQLiteDatabase]>();
const mockGetLocalSurahProgress = jest.fn<Promise<ProfileSurahProgress[]>, [SQLiteDatabase]>();
const mockHasCompletedAccountRestore = jest.fn<Promise<boolean>, [SQLiteDatabase, string]>();
let mockQueryResponse: ((operation: QueryOperation) => Promise<QueryResult> | undefined) | null = null;
let mockConfigured = true;
let mockProfileUpdateResponse: Promise<QueryResult> | null = null;
let mockProfileUpdateIssued: (() => void) | null = null;

function makeUser(id: string): User {
  return {
    id,
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    email: `${id.slice(-1)}@example.invalid`,
  };
}

let sessionSequence = 0;
function makeSession(user: User): Session {
  const sessionId = `10000000-0000-4000-8000-${String(++sessionSequence).padStart(12, "0")}`;
  const claims = Buffer.from(JSON.stringify({ sub: user.id, session_id: sessionId })).toString("base64url");
  return {
    access_token: `e30.${claims}.c2ln`,
    refresh_token: `synthetic-refresh-${user.id}-${sessionSequence}`,
    token_type: "bearer",
    expires_in: 3600,
    user,
  };
}

function makeProfile(id: string, changes: Partial<Profile> = {}): Profile {
  return {
    id,
    username: `user-${id.slice(-1)}`,
    display_name: `User ${id.slice(-1)}`,
    avatar_url: null,
    bio: null,
    country: null,
    total_score: 0,
    current_streak: 0,
    longest_streak: 0,
    cards_reviewed: 0,
    last_review_date: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...changes,
  };
}

const userA = makeUser("00000000-0000-4000-8000-000000000001");
const userB = makeUser("00000000-0000-4000-8000-000000000002");

class SupabaseQuery implements PromiseLike<QueryResult> {
  private readonly operation: QueryOperation;

  constructor(table: string) {
    this.operation = { table, kind: "select", filters: [], terminal: "then" };
    mockOperations.push(this.operation);
  }

  select(columns = "*"): this {
    this.operation.columns = columns;
    if (this.operation.kind !== "update" && this.operation.kind !== "insert") {
      this.operation.kind = "select";
    }
    return this;
  }

  eq(column: string, value: unknown): this {
    this.operation.filters.push([column, value]);
    return this;
  }

  insert(data: unknown): this {
    this.operation.kind = "insert";
    this.operation.data = data;
    return this;
  }

  update(data: unknown): this {
    this.operation.kind = "update";
    this.operation.data = data;
    return this;
  }

  upsert(data: unknown, options?: unknown): this {
    this.operation.kind = "upsert";
    this.operation.data = data;
    this.operation.options = options;
    return this;
  }

  delete(): this {
    this.operation.kind = "delete";
    return this;
  }

  single(): Promise<QueryResult> {
    this.operation.terminal = "single";
    if (this.operation.table === "profiles" && this.operation.kind === "update") {
      mockProfileUpdateIssued?.();
    }
    return this.execute();
  }

  maybeSingle(): Promise<QueryResult> {
    this.operation.terminal = "maybeSingle";
    return this.execute();
  }

  then: Promise<QueryResult>["then"] = (onfulfilled, onrejected) => this.execute().then(onfulfilled, onrejected);

  private async execute(): Promise<QueryResult> {
    const held = mockQueryResponse?.(this.operation);
    if (held) return held;
    if (this.operation.table === "profiles" && this.operation.kind === "update") {
      if (mockProfileUpdateResponse) return mockProfileUpdateResponse;
      const id = this.filterValue("id");
      const changes = this.operation.data as Partial<Profile> | undefined;
      return { data: makeProfile(id, changes), error: null };
    }

    if (this.operation.kind === "select" && this.operation.table === "profiles") {
      return { data: makeProfile(this.filterValue("id")), error: null };
    }
    if (this.operation.kind === "select" && this.operation.table === "public_review_stats") {
      return { data: null, error: null };
    }
    if (
      this.operation.kind === "select" &&
      this.operation.table === "daily_scores" &&
      this.operation.terminal === "maybeSingle"
    )
      return { data: null, error: null };
    if (this.operation.kind === "select") return { data: [], error: null };
    return { data: null, error: null };
  }

  private filterValue(column: string): string {
    const filter = this.operation.filters.find(([name]) => name === column);
    if (!filter || typeof filter[1] !== "string")
      throw new Error(`Missing ${column} filter on ${this.operation.table}`);
    return filter[1];
  }
}

const mockFrom = jest.fn((table: string) => new SupabaseQuery(table));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  supabase: {
    from: (table: string) => mockFrom(table),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  },
  updateOwnedPassword: jest.fn(),
  signOutOwnedSession: jest.fn(),
  restoreOwnedSession: jest.fn(),
  readOwnedSession: jest.fn(),
}));
jest.mock("@/lib/fsrs/scoring", () => ({
  getTotalScore: (db: SQLiteDatabase) => mockGetTotalScore(db),
  getTodayScore: (db: SQLiteDatabase) => mockGetTodayScore(db),
}));
jest.mock("@/lib/profile/progress", () => ({
  getLocalSurahProgress: (db: SQLiteDatabase) => mockGetLocalSurahProgress(db),
}));
jest.mock("@/lib/database/sync", () => ({
  hasCompletedAccountRestore: (db: SQLiteDatabase, id: string) => mockHasCompletedAccountRestore(db, id),
}));
jest.mock("@/lib/auth/oauth", () => ({ startAppOAuth: jest.fn() }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfSyncEnabled: () => false, isQfLoginEnabled: () => false }));
jest.mock("@/lib/quran-foundation/user", () => ({ connectQfFromSession: jest.fn() }));

function makeDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function activate(session: Session | null, profile: Profile | null): void {
  useAuthStore.setState({ session, user: session?.user ?? null, profile });
}

function beginAsA(): Session {
  const session = makeSession(userA);
  activate(session, null);
  return session;
}

type ReplacementKind = "different-user-b" | "same-user-new-session" | "a-b-a" | "signout";

function publishReplacement(
  kind: ReplacementKind,
  original: Session,
): { observedUserIds: Array<string | null>; profile: Profile | null } {
  if (kind === "different-user-b") {
    const profile = makeProfile(userB.id, { display_name: "replacement B" });
    activate(makeSession(userB), profile);
    return { observedUserIds: [useAuthStore.getState().user?.id ?? null], profile };
  }
  if (kind === "same-user-new-session") {
    const replacementSession = makeSession(userA);
    const next = getAuthSessionIdentity(replacementSession);
    const previous = getAuthSessionIdentity(original);
    if (next.kind !== "identified" || previous.kind !== "identified") throw new Error("Invalid fixture identity");
    expect(next.sessionId).not.toBe(previous.sessionId);
    const profile = makeProfile(userA.id, { display_name: "replacement A session" });
    activate(replacementSession, profile);
    return { observedUserIds: [useAuthStore.getState().user?.id ?? null], profile };
  }
  if (kind === "a-b-a") {
    activate(makeSession(userB), makeProfile(userB.id, { display_name: "intervening B" }));
    const observedUserIds = [useAuthStore.getState().user?.id ?? null];
    const profile = makeProfile(userA.id, { display_name: "returned A" });
    activate(original, profile);
    observedUserIds.push(useAuthStore.getState().user?.id ?? null);
    return { observedUserIds, profile };
  }
  activate(null, null);
  return { observedUserIds: [null], profile: null };
}

const mockDatabaseAll = jest.fn<Promise<{ reviewed_at: string }[]>, [string]>();
const database = {
  getFirstAsync: jest.fn(async () => ({ count: 0 })),
  getAllAsync: (sql: string) => mockDatabaseAll(sql),
} as unknown as SQLiteDatabase;

function writeIntents(): QueryOperation[] {
  return mockOperations.filter(({ kind }) => kind !== "select");
}

function subscribeToLateStorePublications(): { events: Profile[]; unsubscribe: () => void } {
  const events: Profile[] = [];
  const unsubscribe = useAuthStore.subscribe((state, previous) => {
    if (state.profile !== previous.profile && state.profile) events.push(state.profile);
  });
  return { events, unsubscribe };
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
}

beforeEach(() => {
  activate(null, null);
  mockOperations.length = 0;
  mockQueryResponse = null;
  mockConfigured = true;
  mockDatabaseAll.mockReset().mockResolvedValue([]);
  jest.mocked(database.getFirstAsync).mockReset().mockResolvedValue({ count: 0 });
  mockFrom.mockClear();
  mockProfileUpdateResponse = null;
  mockProfileUpdateIssued = null;
  mockGetTotalScore.mockReset().mockResolvedValue(42);
  mockGetTodayScore.mockReset().mockResolvedValue({ score: 42, reviewsCount: 1 });
  mockGetLocalSurahProgress.mockReset().mockResolvedValue([]);
  mockHasCompletedAccountRestore.mockReset().mockResolvedValue(true);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  activate(null, null);
  jest.restoreAllMocks();
});

const transitions: ReplacementKind[] = ["different-user-b", "same-user-new-session", "a-b-a", "signout"];

test.each(transitions)("supersedes held score work after %s before stats publication", async (kind) => {
  const original = beginAsA();
  const owner = authCommands.captureOwner();
  const score = makeDeferred<number>();
  const scoreStarted = makeDeferred<void>();
  mockGetTotalScore.mockImplementationOnce(() => {
    scoreStarted.resolve();
    return score.promise;
  });

  const work = updateProfileStats(database);
  await scoreStarted.promise;
  await flushMicrotasks();
  expect(mockFrom).toHaveBeenCalledWith("profiles");

  const replacement = publishReplacement(kind, original);
  expect(owner.isCurrent()).toBe(false);
  if (kind === "a-b-a") expect(replacement.observedUserIds).toEqual([userB.id, userA.id]);
  if (kind === "different-user-b") expect(replacement.profile?.id).toBe(userB.id);

  const publication = subscribeToLateStorePublications();
  const writesAtReplacement = [...writeIntents()];
  score.resolve(42);
  await work;
  publication.unsubscribe();

  expect(publication.events).toEqual([]);
  expect(writeIntents()).toEqual(writesAtReplacement);
  expect(useAuthStore.getState().profile).toBe(replacement.profile);
});

test.each(transitions)("stops future writes after the issued profile update resolves for %s", async (kind) => {
  const original = beginAsA();
  const updateIssued = makeDeferred<void>();
  const profileResponse = makeDeferred<QueryResult>();
  mockProfileUpdateResponse = profileResponse.promise;
  mockProfileUpdateIssued = () => updateIssued.resolve();

  const work = updateProfileStats(database);
  await updateIssued.promise;
  await flushMicrotasks();

  const issuedUpdates = writeIntents().filter(
    ({ table, kind: operation }) => table === "profiles" && operation === "update",
  );
  expect(issuedUpdates).toHaveLength(1);
  expect(issuedUpdates[0].filters).toEqual([["id", userA.id]]);

  const owner = authCommands.captureOwner();
  const replacement = publishReplacement(kind, original);
  expect(owner.isCurrent()).toBe(false);
  if (kind === "a-b-a") expect(replacement.observedUserIds).toEqual([userB.id, userA.id]);

  const publication = subscribeToLateStorePublications();
  const writesAtReplacement = [...writeIntents()];
  profileResponse.resolve({ data: makeProfile(userA.id, { total_score: 42 }), error: null });
  await work;
  publication.unsubscribe();

  expect(publication.events).toEqual([]);
  expect(writeIntents()).toEqual(writesAtReplacement);
  expect(
    writeIntents().filter(
      ({ table }) =>
        table === "public_review_stats" || table === "public_review_activity" || table === "public_surah_progress",
    ),
  ).toEqual([]);
  expect(useAuthStore.getState().profile).toBe(replacement.profile);
});

test("current owner completes profile, aggregate, and progress writes", async () => {
  const session = beginAsA();
  mockGetLocalSurahProgress.mockResolvedValue([
    { surah: 1, totalCards: 3, memorized: 2, nameArabic: "synthetic", nameEnglish: "synthetic" },
  ]);

  await updateProfileStats(database);

  expect(useAuthStore.getState().profile).toMatchObject({ id: userA.id, total_score: 42 });
  const writes = writeIntents();
  expect(writes.map(({ table, kind }) => [table, kind])).toEqual([
    ["profiles", "update"],
    ["public_review_stats", "upsert"],
    ["public_surah_progress", "upsert"],
  ]);
  expect(writes[0].filters).toEqual([["id", session.user.id]]);
  expect(writes[0].data).toMatchObject({ total_score: 42, current_streak: 0, longest_streak: 0, cards_reviewed: 0 });
  expect(writes[1].data).toMatchObject({ user_id: userA.id, total_reviews: 0, active_days: 0 });
  expect(writes[2].options).toEqual({ onConflict: "user_id,surah" });
  expect(writes[2].data).toEqual([
    expect.objectContaining({ user_id: userA.id, surah: 1, total_cards: 3, memorized_cards: 2 }),
  ]);
});

test("incomplete account restore prevents profile reads and all leaderboard writes", async () => {
  beginAsA();
  mockHasCompletedAccountRestore.mockResolvedValue(false);

  await updateProfileStats(database);

  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockGetTotalScore).not.toHaveBeenCalled();
  expect(writeIntents()).toEqual([]);
});

test("daily score query fixture captures exact upsert intent", async () => {
  const session = beginAsA();
  mockGetTodayScore.mockResolvedValue({ score: 12, reviewsCount: 2 });

  await syncDailyScore(database);

  const writes = writeIntents();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    table: "daily_scores",
    kind: "upsert",
    data: { user_id: session.user.id, score: 12, reviews_count: 2 },
    options: { onConflict: "user_id,date" },
  });
});

type SyncKind = "profile" | "daily";
type PausePhase =
  | "restore"
  | "ensure"
  | "score"
  | "profile-read"
  | "profile-update"
  | "review-stats"
  | "review-activity"
  | "surah-read"
  | "surah-write"
  | "surah-upsert"
  | "remote-daily"
  | "remote-review"
  | "daily-read"
  | "daily-write";
const phases: { sync: SyncKind; phase: PausePhase }[] = [
  ...(
    [
      "restore",
      "ensure",
      "score",
      "profile-read",
      "profile-update",
      "review-stats",
      "review-activity",
      "surah-read",
      "surah-write",
      "surah-upsert",
      "remote-daily",
      "remote-review",
    ] as const
  ).map((phase) => ({ sync: "profile" as const, phase })),
  ...(["restore", "ensure", "score", "daily-read", "daily-write"] as const).map((phase) => ({
    sync: "daily" as const,
    phase,
  })),
];
function syncWork(kind: SyncKind) {
  return kind === "profile" ? updateProfileStats(database) : syncDailyScore(database);
}
function pauseAt(sync: SyncKind, phase: PausePhase) {
  const reached = makeDeferred<void>();
  let release: () => void = () => {
    throw new Error("Pause was not reached");
  };
  let reject: (error: Error) => void = () => {
    throw new Error("Pause was not reached");
  };
  let packet: (error: Error) => void = () => {
    throw new Error("Non-query pause");
  };
  const hold = <T>(value: T) => {
    const pending = makeDeferred<T>();
    release = () => pending.resolve(value);
    reject = pending.reject;
    reached.resolve();
    return pending.promise;
  };
  if (phase === "restore") mockHasCompletedAccountRestore.mockImplementationOnce(() => hold(true));
  else if (phase === "score" && sync === "profile") mockGetTotalScore.mockImplementationOnce(() => hold(42));
  else if (phase === "score") mockGetTodayScore.mockImplementationOnce(() => hold({ score: 42, reviewsCount: 1 }));
  else {
    mockDatabaseAll.mockResolvedValue([{ reviewed_at: "2026-01-01T12:00:00Z" }]);
    if (phase === "surah-upsert")
      mockGetLocalSurahProgress.mockResolvedValue([
        { surah: 1, nameArabic: "synthetic", nameEnglish: "synthetic", totalCards: 3, memorized: 2 },
      ]);
    mockQueryResponse = (operation) => {
      const { table, kind, columns } = operation;
      const matched =
        (phase === "surah-upsert" && table === "public_surah_progress" && kind === "upsert") ||
        (phase === "remote-daily" && table === "daily_scores" && kind === "select" && operation.terminal === "then") ||
        (phase === "remote-review" && table === "public_review_stats" && kind === "select") ||
        (phase === "ensure" && table === "profiles" && kind === "select" && columns === "*") ||
        (phase === "profile-read" && table === "profiles" && kind === "select" && columns !== "*") ||
        (phase === "profile-update" && table === "profiles" && kind === "update") ||
        (phase === "review-stats" && table === "public_review_stats" && kind === "upsert") ||
        (phase === "review-activity" && table === "public_review_activity" && kind === "upsert") ||
        (phase === "surah-read" && table === "public_surah_progress" && kind === "select") ||
        (phase === "surah-write" && table === "public_surah_progress" && kind === "delete") ||
        (phase === "daily-read" &&
          table === "daily_scores" &&
          kind === "select" &&
          operation.terminal === "maybeSingle") ||
        (phase === "daily-write" && table === "daily_scores" && kind === "upsert");
      if (!matched) return undefined;
      mockQueryResponse = null;
      const result: QueryResult = {
        data:
          table === "profiles"
            ? makeProfile(userA.id, { total_score: 42 })
            : kind === "select" && (table === "public_surah_progress" || phase === "remote-daily")
              ? []
              : null,
        error: null,
      };
      const pending = makeDeferred<QueryResult>();
      release = () => pending.resolve(result);
      reject = pending.reject;
      packet = (error) => pending.resolve({ data: null, error });
      reached.resolve();
      return pending.promise;
    };
  }
  return {
    reached: reached.promise,
    release: () => release(),
    reject: (error: Error) => reject(error),
    packet: (error: Error) => packet(error),
  };
}

test.each(phases.flatMap((row) => transitions.map((kind) => ({ ...row, kind }))))(
  "$sync stops obsolete continuations at $phase after $kind",
  async ({ sync, phase, kind }) => {
    const original = beginAsA();
    const owner = authCommands.captureOwner();
    const pause = pauseAt(sync, phase);
    const work = syncWork(sync);
    await pause.reached;
    const replacement = publishReplacement(kind, original);
    expect(owner.isCurrent()).toBe(false);
    expect(authCommands.captureOwner().isCurrent()).toBe(true);
    if (kind === "a-b-a") expect(replacement.observedUserIds).toEqual([userB.id, userA.id]);
    const publication = subscribeToLateStorePublications();
    const requests = mockOperations.length;
    const writes = [...writeIntents()];
    pause.release();
    try {
      await expect(work).resolves.toBeUndefined();
    } finally {
      publication.unsubscribe();
    }
    expect(mockOperations).toHaveLength(requests);
    expect(writeIntents()).toEqual(writes);
    expect(publication.events).toEqual([]);
    expect(useAuthStore.getState().profile).toBe(replacement.profile);
    expect(console.warn).not.toHaveBeenCalled();
  },
);

test.each(phases)("$sync preserves current failures at $phase", async ({ sync, phase }) => {
  beginAsA();
  const pause = pauseAt(sync, phase);
  const work = syncWork(sync);
  await pause.reached;
  const error = new Error(`current ${phase}`);
  const warns = [
    "ensure",
    "review-stats",
    "review-activity",
    "surah-read",
    "surah-write",
    "surah-upsert",
    "remote-daily",
    "remote-review",
  ].includes(phase);
  const completion = warns ? expect(work).resolves.toBeUndefined() : expect(work).rejects.toBe(error);
  pause.reject(error);
  await completion;
  if (warns) expect(console.warn).toHaveBeenCalledWith(expect.any(String), error.message);
  else expect(console.warn).not.toHaveBeenCalled();
});

test.each(phases)("$sync ignores obsolete rejection at $phase", async ({ sync, phase }) => {
  const original = beginAsA();
  const pause = pauseAt(sync, phase);
  const work = syncWork(sync);
  await pause.reached;
  const expected = publishReplacement("different-user-b", original).profile;
  const requests = mockOperations.length;
  const publication = subscribeToLateStorePublications();
  const completion = expect(work).resolves.toBeUndefined();
  pause.reject(new Error(`old ${phase}`));
  try {
    await completion;
  } finally {
    publication.unsubscribe();
  }
  expect(mockOperations).toHaveLength(requests);
  expect(publication.events).toEqual([]);
  expect(useAuthStore.getState().profile).toBe(expected);
  expect(console.warn).not.toHaveBeenCalled();
});

test.each(phases.filter(({ phase }) => !["restore", "score"].includes(phase)))(
  "$sync ignores obsolete error packet at $phase",
  async ({ sync, phase }) => {
    const original = beginAsA();
    const pause = pauseAt(sync, phase);
    const work = syncWork(sync);
    await pause.reached;
    const expected = publishReplacement("different-user-b", original).profile;
    const requests = mockOperations.length;
    pause.packet(new Error(`old ${phase}`));
    await work;
    expect(mockOperations).toHaveLength(requests);
    expect(useAuthStore.getState().profile).toBe(expected);
    expect(console.warn).not.toHaveBeenCalled();
  },
);

test.each(phases)("$sync retains same-session refresh continuity at $phase", async ({ sync, phase }) => {
  const original = beginAsA();
  const owner = authCommands.captureOwner();
  const pause = pauseAt(sync, phase);
  const work = syncWork(sync);
  await pause.reached;
  const claims = JSON.parse(Buffer.from(original.access_token.split(".")[1], "base64url").toString("utf8"));
  const refreshed = {
    ...original,
    access_token: `e30.${Buffer.from(JSON.stringify({ ...claims, iat: 123 })).toString("base64url")}.bmV3`,
    refresh_token: "new-refresh",
    user: { ...original.user, user_metadata: { display_name: "new metadata" } },
  };
  expect(getAuthSessionIdentity(refreshed)).toEqual(getAuthSessionIdentity(original));
  expect(refreshed.access_token).not.toBe(original.access_token);
  activate(refreshed, useAuthStore.getState().profile);
  expect(owner.isCurrent()).toBe(true);
  pause.release();
  await work;
  expect(useAuthStore.getState().session).toBe(refreshed);
  if (sync === "profile") expect(useAuthStore.getState().profile).toMatchObject({ id: userA.id, total_score: 42 });
  expect(writeIntents().some((row) => row.table === (sync === "daily" ? "daily_scores" : "profiles"))).toBe(true);
});

test.each(phases)(
  "$sync rejects an earlier owner at $phase when replacement intent starts",
  async ({ sync, phase }) => {
    beginAsA();
    const pause = pauseAt(sync, phase);
    const work = syncWork(sync);
    await pause.reached;
    const owner = authCommands.captureOwner();
    const replacementGate = makeDeferred<void>();
    const replacement = authCommands.transition(() => replacementGate.promise);
    expect(owner.isCurrent()).toBe(false);
    const current = useAuthStore.getState().profile;
    const requests = mockOperations.length;
    pause.release();
    try {
      await work;
    } finally {
      replacementGate.resolve();
      await replacement;
    }
    expect(mockOperations).toHaveLength(requests);
    expect(useAuthStore.getState().profile).toBe(current);
  },
);

test.each(["profile", "daily"] as const)(
  "%s respects disabled configuration, anonymous and unidentified sessions",
  async (sync) => {
    beginAsA();
    mockConfigured = false;
    await syncWork(sync);
    mockConfigured = true;
    activate(null, null);
    await syncWork(sync);
    const bad = { ...makeSession(userA), access_token: "invalid" };
    activate(bad, makeProfile(userA.id));
    await syncWork(sync);
    expect(mockHasCompletedAccountRestore).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  },
);

test.each(["profile", "daily"] as const)("%s rejects mismatched session and store users", async (sync) => {
  beginAsA();
  useAuthStore.setState({ user: userB, profile: makeProfile(userB.id) });
  await syncWork(sync);
  expect(mockHasCompletedAccountRestore).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
});

test.each(["review-stats", "review-activity"] as const)(
  "preserves missing-table compatibility at %s",
  async (phase) => {
    beginAsA();
    const pause = pauseAt("profile", phase);
    const work = updateProfileStats(database);
    await pause.reached;
    pause.packet(Object.assign(new Error("relation public_review_stats does not exist"), { code: "42P01" }));
    await work;
    expect(console.warn).not.toHaveBeenCalled();
    expect(writeIntents().at(-1)?.table).toBe("public_surah_progress");
  },
);

test("current profile retains remote maxima and exact aggregate/progress payloads", async () => {
  beginAsA();
  const today = formatUtcDateKey(new Date());
  mockGetLocalSurahProgress.mockResolvedValue([
    { surah: 1, nameArabic: "synthetic", nameEnglish: "synthetic", totalCards: 12, memorized: 7 },
  ]);
  mockQueryResponse = (operation) => {
    if (operation.kind !== "select") return undefined;
    const data =
      operation.table === "profiles"
        ? makeProfile(userA.id, {
            total_score: 100,
            current_streak: 2,
            longest_streak: 4,
            cards_reviewed: 5,
            last_review_date: today,
          })
        : operation.table === "daily_scores"
          ? [{ date: today, score: 200, reviews_count: 9 }]
          : operation.table === "public_review_stats"
            ? { total_reviews: 11, active_days: 1, current_streak: 6, longest_streak: 10, last_review_date: today }
            : operation.table === "public_review_activity"
              ? [{ date: today, reviews_count: 12 }]
              : [{ surah: 1, total_cards: 20, memorized_cards: 10 }];
    return Promise.resolve({ data, error: null });
  };
  await updateProfileStats(database);
  expect(writeIntents().find((row) => row.table === "profiles")?.data).toEqual({
    total_score: 200,
    current_streak: 6,
    longest_streak: 10,
    cards_reviewed: 12,
    last_review_date: today,
  });
  expect(useAuthStore.getState().profile).toMatchObject({ id: userA.id, total_score: 200, cards_reviewed: 12 });
  expect(writeIntents().find((row) => row.table === "public_review_stats")?.data).toMatchObject({
    user_id: userA.id,
    total_reviews: 12,
    current_streak: 6,
    longest_streak: 10,
  });
  expect(writeIntents().find((row) => row.table === "public_review_activity")?.data).toEqual([
    expect.objectContaining({ user_id: userA.id, date: today, reviews_count: 12 }),
  ]);
  expect(writeIntents().find((row) => row.table === "public_surah_progress")?.data).toEqual([
    expect.objectContaining({ user_id: userA.id, surah: 1, total_cards: 20, memorized_cards: 10 }),
  ]);
});

test("current daily score preserves existing maxima and zero-review no-op", async () => {
  beginAsA();
  mockQueryResponse = (operation) =>
    operation.table === "daily_scores" && operation.kind === "select"
      ? Promise.resolve({ data: { score: 100, reviews_count: 20 }, error: null })
      : undefined;
  await syncDailyScore(database);
  expect(writeIntents()).toHaveLength(1);
  expect(writeIntents()[0].data).toMatchObject({ user_id: userA.id, score: 100, reviews_count: 20 });
  mockOperations.length = 0;
  mockGetTodayScore.mockResolvedValue({ score: 0, reviewsCount: 0 });
  await syncDailyScore(database);
  expect(writeIntents()).toEqual([]);
});

test.each(["profile", "daily"] as const)(
  "%s rejects valid B credentials paired with user A and missing session",
  async (sync) => {
    activate(makeSession(userB), makeProfile(userA.id));
    useAuthStore.setState({ user: userA });
    await syncWork(sync);
    activate(null, makeProfile(userA.id));
    useAuthStore.setState({ user: userA });
    await syncWork(sync);
    expect(mockHasCompletedAccountRestore).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  },
);

test("synchronous replacement during the local stats publication prevents dispatch", async () => {
  beginAsA();
  const owner = authCommands.captureOwner();
  const replacement = makeProfile(userB.id, { display_name: "current B" });
  const stop = useAuthStore.subscribe((state) => {
    if (state.profile?.id === userA.id && state.profile.total_score === 42) activate(makeSession(userB), replacement);
  });
  try {
    await updateProfileStats(database);
  } finally {
    stop();
  }
  expect(owner.isCurrent()).toBe(false);
  expect(useAuthStore.getState().profile).toBe(replacement);
  expect(writeIntents()).toEqual([]);
});

test("a mismatched profile response cannot publish another account row", async () => {
  beginAsA();
  mockProfileUpdateResponse = Promise.resolve({ data: makeProfile(userB.id), error: null });
  await updateProfileStats(database);
  expect(useAuthStore.getState().profile).toMatchObject({ id: userA.id, total_score: 42 });
});

test("incomplete restore also stops daily score reads and writes", async () => {
  beginAsA();
  mockHasCompletedAccountRestore.mockResolvedValue(false);
  await syncDailyScore(database);
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockGetTodayScore).not.toHaveBeenCalled();
});

describe("account stats FIFO", () => {
  async function drain() {
    for (let turn = 0; turn < 128; turn += 1) await Promise.resolve();
  }
  const pairs: { firstKind: SyncKind; secondKind: SyncKind }[] = [
    { firstKind: "profile", secondKind: "profile" },
    { firstKind: "daily", secondKind: "daily" },
    { firstKind: "daily", secondKind: "profile" },
    { firstKind: "profile", secondKind: "daily" },
  ];
  test.each(pairs)(
    "holds $secondKind behind unfinished $firstKind before computing data",
    async ({ firstKind, secondKind }) => {
      beginAsA();
      const owner = authCommands.captureOwner();
      const firstScore = makeDeferred<number>();
      const firstStarted = makeDeferred<void>();
      mockGetTotalScore.mockResolvedValue(900);
      mockGetTodayScore.mockResolvedValue({ score: 900, reviewsCount: 9 });
      if (firstKind === "profile")
        mockGetTotalScore.mockImplementationOnce(() => {
          firstStarted.resolve();
          return firstScore.promise;
        });
      else
        mockGetTodayScore.mockImplementationOnce(async () => {
          firstStarted.resolve();
          return { score: await firstScore.promise, reviewsCount: 1 };
        });
      const first = syncWork(firstKind);
      await firstStarted.promise;
      const second = syncWork(secondKind);
      try {
        await drain();
        expect(owner.isCurrent()).toBe(true);
        expect(mockHasCompletedAccountRestore).toHaveBeenCalledTimes(1);
        expect(writeIntents()).toEqual([]);
        firstScore.resolve(111);
        await Promise.all([first, second]);
        const scores = writeIntents().filter((row) => row.table === "profiles" || row.table === "daily_scores");
        expect(scores.map((row) => row.table)).toEqual([
          firstKind === "profile" ? "profiles" : "daily_scores",
          secondKind === "profile" ? "profiles" : "daily_scores",
        ]);
        expect(
          scores.map((row) =>
            row.table === "profiles"
              ? (row.data as { total_score: number }).total_score
              : (row.data as { score: number }).score,
          ),
        ).toEqual([111, 900]);
        if (secondKind === "profile") expect(useAuthStore.getState().profile?.total_score).toBe(900);
      } finally {
        firstScore.resolve(111);
        await Promise.allSettled([first, second]);
      }
    },
  );

  const failures: { sync: SyncKind; phase: PausePhase; packet: boolean }[] = [
    { sync: "profile", phase: "score", packet: false },
    { sync: "profile", phase: "profile-update", packet: false },
    { sync: "profile", phase: "profile-update", packet: true },
    { sync: "daily", phase: "score", packet: false },
    { sync: "daily", phase: "daily-write", packet: false },
  ];
  test.each(failures)("keeps later work usable after $sync $phase packet=$packet", async ({ sync, phase, packet }) => {
    beginAsA();
    mockGetTotalScore.mockResolvedValue(950);
    const pause = pauseAt(sync, phase);
    const first = syncWork(sync);
    const firstOutcome = first.then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    );
    await pause.reached;
    const second = updateProfileStats(database);
    const error = new Error("original queued failure");
    try {
      await drain();
      expect(mockHasCompletedAccountRestore).toHaveBeenCalledTimes(1);
      if (packet) pause.packet(error);
      else pause.reject(error);
      expect((await firstOutcome).error).toBe(packet ? null : error);
      await second;
      expect(useAuthStore.getState().profile?.total_score).toBe(950);
      mockGetTotalScore.mockResolvedValue(1000);
      await updateProfileStats(database);
      expect(useAuthStore.getState().profile?.total_score).toBe(1000);
      if (packet)
        expect(console.warn).toHaveBeenCalledWith("[Leaderboard] Failed to update profile stats:", error.message);
    } finally {
      pause.release();
      await Promise.allSettled([first, second]);
    }
  });

  test.each(["metadata", "credentials"] as const)("retains FIFO through same-session %s", async (kind) => {
    const original = beginAsA();
    const owner = authCommands.captureOwner();
    const pause = pauseAt("profile", "score");
    mockGetTotalScore.mockResolvedValue(900);
    const first = updateProfileStats(database);
    await pause.reached;
    const currentProfile = useAuthStore.getState().profile;
    const refreshed =
      kind === "metadata"
        ? { ...original, user: { ...original.user, user_metadata: { name: "updated" } } }
        : {
            ...original,
            access_token: original.access_token.replace(/[^.]+$/, "bmV3"),
            refresh_token: "rotated-refresh",
          };
    expect(getAuthSessionIdentity(refreshed)).toEqual(getAuthSessionIdentity(original));
    activate(refreshed, currentProfile);
    const second = updateProfileStats(database);
    try {
      await drain();
      expect(owner.isCurrent()).toBe(true);
      expect(mockHasCompletedAccountRestore).toHaveBeenCalledTimes(1);
      pause.release();
      await Promise.all([first, second]);
      expect(useAuthStore.getState().session).toBe(refreshed);
      expect(useAuthStore.getState().profile?.total_score).toBe(900);
      expect(
        writeIntents()
          .filter((row) => row.table === "profiles")
          .map((row) => (row.data as { total_score: number }).total_score),
      ).toEqual([42, 900]);
    } finally {
      pause.release();
      await Promise.allSettled([first, second]);
    }
  });

  test.each(transitions)("new owner proceeds while old and queued jobs remain blocked after %s", async (kind) => {
    const original = beginAsA();
    const oldOwner = authCommands.captureOwner();
    const pause = pauseAt("profile", "score");
    mockGetTotalScore.mockResolvedValue(900);
    const first = updateProfileStats(database);
    await pause.reached;
    const queued = updateProfileStats(database);
    const queuedAgain = updateProfileStats(database);
    await drain();
    const replacement = publishReplacement(kind, original);
    expect(oldOwner.isCurrent()).toBe(false);
    if (kind === "a-b-a") expect(replacement.observedUserIds).toEqual([userB.id, userA.id]);
    let completed = false;
    const current = updateProfileStats(database).then(() => {
      completed = true;
    });
    try {
      await drain();
      expect(completed).toBe(true);
      expect(mockGetTotalScore).toHaveBeenCalledTimes(kind === "signout" ? 1 : 2);
      if (kind !== "signout")
        expect(useAuthStore.getState().profile).toMatchObject({ id: replacement.profile?.id, total_score: 900 });
      const latest = useAuthStore.getState().profile;
      const requests = mockOperations.length;
      const restoreCalls = mockHasCompletedAccountRestore.mock.calls.length;
      pause.release();
      await Promise.all([first, queued, queuedAgain, current]);
      expect(mockOperations).toHaveLength(requests);
      expect(mockHasCompletedAccountRestore).toHaveBeenCalledTimes(restoreCalls);
      expect(useAuthStore.getState().profile).toBe(latest);
    } finally {
      pause.release();
      await Promise.allSettled([first, queued, queuedAgain, current]);
    }
  });

  test("completion of old A cannot reset the newer B queue", async () => {
    beginAsA();
    const oldScore = makeDeferred<number>();
    const oldStarted = makeDeferred<void>();
    const newScore = makeDeferred<number>();
    const newStarted = makeDeferred<void>();
    mockGetTotalScore
      .mockImplementationOnce(() => {
        oldStarted.resolve();
        return oldScore.promise;
      })
      .mockImplementationOnce(() => {
        newStarted.resolve();
        return newScore.promise;
      })
      .mockResolvedValueOnce(900)
      .mockResolvedValueOnce(1000);
    const old = updateProfileStats(database);
    await oldStarted.promise;
    activate(makeSession(userB), makeProfile(userB.id));
    const firstB = updateProfileStats(database);
    await newStarted.promise;
    const secondB = updateProfileStats(database);
    let thirdB: Promise<void> | undefined;
    try {
      oldScore.resolve(111);
      await old;
      thirdB = updateProfileStats(database);
      await drain();
      expect(mockHasCompletedAccountRestore).toHaveBeenCalledTimes(2);
      expect(mockGetTotalScore).toHaveBeenCalledTimes(2);
      newScore.resolve(333);
      await Promise.all([firstB, secondB, thirdB]);
      expect(useAuthStore.getState().profile).toMatchObject({ id: userB.id, total_score: 1000 });
      expect(
        writeIntents()
          .filter((row) => row.table === "profiles")
          .map((row) => (row.data as { total_score: number }).total_score),
      ).toEqual([333, 900, 1000]);
    } finally {
      oldScore.resolve(111);
      newScore.resolve(333);
      await Promise.allSettled([old, firstB, secondB, thirdB]);
    }
  });

  test("auth replacement does not wait for blocked stats", async () => {
    beginAsA();
    const pause = pauseAt("profile", "score");
    const work = updateProfileStats(database);
    await pause.reached;
    let completed = false;
    const replacement = authCommands.transition(async () => {
      activate(makeSession(userB), makeProfile(userB.id));
      completed = true;
    });
    try {
      await drain();
      expect(completed).toBe(true);
      expect(useAuthStore.getState().user?.id).toBe(userB.id);
    } finally {
      pause.release();
      await Promise.allSettled([work, replacement]);
    }
  });

  const lateWrites: { sync: SyncKind; phase: PausePhase }[] = [
    { sync: "profile", phase: "review-stats" },
    { sync: "profile", phase: "review-activity" },
    { sync: "profile", phase: "surah-upsert" },
    { sync: "profile", phase: "surah-write" },
    { sync: "daily", phase: "daily-write" },
  ];
  test.each(lateWrites)(
    "waits through final remote $sync $phase before starting later work",
    async ({ sync, phase }) => {
      beginAsA();
      const pause = pauseAt(sync, phase);
      const first = syncWork(sync);
      await pause.reached;
      const requests = mockOperations.length;
      const second = syncWork(sync === "profile" ? "daily" : "profile");
      try {
        await drain();
        expect(mockHasCompletedAccountRestore).toHaveBeenCalledTimes(1);
        expect(mockOperations).toHaveLength(requests);
        pause.release();
        await Promise.all([first, second]);
        expect(mockHasCompletedAccountRestore).toHaveBeenCalledTimes(2);
      } finally {
        pause.release();
        await Promise.allSettled([first, second]);
      }
    },
  );

  test("a later intent starts a fresh queue without relabeling queued old jobs", async () => {
    beginAsA();
    const oldOwner = authCommands.captureOwner();
    const pause = pauseAt("profile", "score");
    mockGetTotalScore.mockResolvedValue(900);
    const first = updateProfileStats(database);
    await pause.reached;
    const queued = updateProfileStats(database);
    const queuedAgain = updateProfileStats(database);
    await authCommands.transition(async () => undefined);
    expect(oldOwner.isCurrent()).toBe(false);
    let completed = false;
    const current = updateProfileStats(database).then(() => {
      completed = true;
    });
    try {
      await drain();
      expect(completed).toBe(true);
      expect(mockGetTotalScore).toHaveBeenCalledTimes(2);
      const latest = useAuthStore.getState().profile;
      const requests = mockOperations.length;
      const restores = mockHasCompletedAccountRestore.mock.calls.length;
      pause.release();
      await Promise.all([first, queued, queuedAgain, current]);
      expect(mockOperations).toHaveLength(requests);
      expect(mockHasCompletedAccountRestore).toHaveBeenCalledTimes(restores);
      expect(useAuthStore.getState().profile).toBe(latest);
    } finally {
      pause.release();
      await Promise.allSettled([first, queued, queuedAgain, current]);
    }
  });
});

describe("same-owner profile field publication", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-06T12:00:00.000Z"));
  });
  afterEach(() => jest.useRealTimers());
  const oldStats = {
    total_score: 10,
    cards_reviewed: 1,
    current_streak: 1,
    longest_streak: 2,
    last_review_date: "2026-01-01",
  };
  const newStats = {
    total_score: 900,
    cards_reviewed: 70,
    current_streak: 8,
    longest_streak: 9,
    last_review_date: "2026-11-06",
  };
  const oldFields = {
    display_name: "old name",
    avatar_url: "https://example.invalid/old.png",
    bio: "old bio",
    country: "old country",
  };
  const fieldCases = [
    {
      kind: "values",
      fields: {
        display_name: "new name",
        avatar_url: "https://example.invalid/new.png",
        bio: "new bio",
        country: "new country",
      },
    },
    { kind: "nulls", fields: { display_name: null, avatar_url: null, bio: null, country: null } },
  ];
  const updates = (fields: (typeof fieldCases)[number]["fields"]) => ({
    displayName: fields.display_name,
    avatarUrl: fields.avatar_url,
    bio: fields.bio,
    country: fields.country,
  });

  function highLocalStats() {
    mockGetTotalScore.mockResolvedValue(newStats.total_score);
    jest.mocked(database.getFirstAsync).mockResolvedValue({ count: newStats.cards_reviewed });
    const reviewedAt = [
      ...Array.from({ length: 9 }, (_, day) => new Date(Date.UTC(2026, 9, 1 + day, 12))),
      ...Array.from({ length: 8 }, (_, day) => new Date(Date.UTC(2026, 9, 30 + day, 12))),
    ];
    mockDatabaseAll.mockResolvedValue(reviewedAt.map((date) => ({ reviewed_at: date.toISOString() })));
  }

  function remoteProfile(initial: Profile) {
    let row = initial;
    const request = (operation: QueryOperation): Promise<QueryResult> | undefined => {
      if (operation.table !== "profiles") return undefined;
      if (operation.kind === "select") return Promise.resolve({ data: { ...row }, error: null });
      if (operation.kind === "update") {
        row = { ...row, ...(operation.data as Partial<Profile>) };
        return Promise.resolve({ data: { ...row }, error: null });
      }
      return undefined;
    };
    return { request, current: () => row };
  }
  function isStatsUpdate(operation: QueryOperation) {
    return operation.table === "profiles" && operation.kind === "update" && "total_score" in (operation.data as object);
  }
  function isEditUpdate(operation: QueryOperation) {
    return operation.table === "profiles" && operation.kind === "update" && !isStatsUpdate(operation);
  }

  test.each(fieldCases)("late stats reply preserves an actual completed edit with $kind", async ({ fields }) => {
    beginAsA();
    highLocalStats();
    const remote = remoteProfile(makeProfile(userA.id, { ...oldStats, ...oldFields }));
    const held = makeDeferred<QueryResult>();
    const reached = makeDeferred<void>();
    let oldReply: QueryResult | undefined;
    mockQueryResponse = (operation) => {
      const response = remote.request(operation);
      if (isStatsUpdate(operation)) {
        oldReply = { data: { ...remote.current() }, error: null };
        reached.resolve();
        return held.promise;
      }
      return response;
    };
    const stats = updateProfileStats(database);
    await reached.promise;
    try {
      const result = await useAuthStore.getState().updateProfile(updates(fields));
      expect(result.status).toBe("completed");
      expect(useAuthStore.getState().profile).toMatchObject({ ...newStats, ...fields });
      held.resolve(oldReply!);
      await stats;
      expect(useAuthStore.getState().profile).toMatchObject({ ...newStats, ...fields });
      expect(remote.current()).toMatchObject({ ...newStats, ...fields });
    } finally {
      held.resolve(oldReply!);
      await stats;
    }
  });

  test.each(fieldCases)(
    "late initial ensure read preserves an actual completed edit with $kind",
    async ({ fields }) => {
      beginAsA();
      highLocalStats();
      const remote = remoteProfile(makeProfile(userA.id, { ...oldStats, ...oldFields }));
      const held = makeDeferred<QueryResult>();
      const reached = makeDeferred<void>();
      const score = makeDeferred<number>();
      const scoreReached = makeDeferred<void>();
      mockGetTotalScore.mockImplementationOnce(() => {
        scoreReached.resolve();
        return score.promise;
      });
      let first = true;
      const oldReply = { data: { ...remote.current() }, error: null };
      mockQueryResponse = (operation) => {
        if (first && operation.table === "profiles" && operation.kind === "select") {
          first = false;
          reached.resolve();
          return held.promise;
        }
        return remote.request(operation);
      };
      const stats = updateProfileStats(database);
      await reached.promise;
      try {
        expect((await useAuthStore.getState().updateProfile(updates(fields))).status).toBe("completed");
        const edited = useAuthStore.getState().profile;
        held.resolve(oldReply);
        await scoreReached.promise;
        expect(useAuthStore.getState().profile).toBe(edited);
        expect(useAuthStore.getState().profile).toMatchObject(fields);
        score.resolve(900);
        await stats;
        expect(useAuthStore.getState().profile).toMatchObject({ ...newStats, ...fields });
      } finally {
        held.resolve(oldReply);
        score.resolve(900);
        await stats;
      }
    },
  );

  test.each(fieldCases)(
    "late edit reply preserves newer actual stats with $kind and returns the accepted profile",
    async ({ fields }) => {
      const original = beginAsA();
      highLocalStats();
      const remote = remoteProfile(makeProfile(userA.id, { ...oldStats, ...oldFields }));
      const held = makeDeferred<QueryResult>();
      const reached = makeDeferred<void>();
      let oldReply: QueryResult | undefined;
      mockQueryResponse = (operation) => {
        const response = remote.request(operation);
        if (isEditUpdate(operation)) {
          oldReply = { data: { ...remote.current() }, error: null };
          reached.resolve();
          return held.promise;
        }
        return response;
      };
      const edit = useAuthStore.getState().updateProfile(updates(fields));
      await reached.promise;
      try {
        await updateProfileStats(database);
        expect(useAuthStore.getState().profile).toMatchObject(newStats);
        held.resolve(oldReply!);
        const result = await edit;
        expect(result).toMatchObject({
          status: "completed",
          value: expect.objectContaining({ ...newStats, ...fields }),
        });
        if (result.status === "completed") expect(result.value).toBe(useAuthStore.getState().profile);
        expect(remote.current()).toMatchObject({ ...newStats, ...fields });
        expect(useAuthStore.getState().session).toBe(original);
      } finally {
        held.resolve(oldReply!);
        await edit;
      }
    },
  );

  test.each(["fetchProfile", "ensureProfile"] as const)(
    "a fresh %s cannot lower optimistic stats while their request is pending",
    async (action) => {
      beginAsA();
      highLocalStats();
      const remote = remoteProfile(makeProfile(userA.id, { ...oldStats, ...oldFields }));
      const held = makeDeferred<QueryResult>();
      const reached = makeDeferred<void>();
      mockQueryResponse = (operation) => {
        if (isStatsUpdate(operation)) {
          reached.resolve();
          return held.promise;
        }
        return remote.request(operation);
      };
      const stats = updateProfileStats(database);
      await reached.promise;
      try {
        const optimistic = useAuthStore.getState().profile;
        expect(optimistic).toMatchObject(newStats);
        const result = await useAuthStore.getState()[action]();
        expect(useAuthStore.getState().profile).toBe(optimistic);
        if (action === "ensureProfile") expect(result).toBe(optimistic);
        expect(remote.current()).toMatchObject(oldStats);
        held.resolve({ data: null, error: new Error("stats packet") });
        await stats;
        await useAuthStore.getState()[action]();
        expect(useAuthStore.getState().profile).toMatchObject(oldStats);
      } finally {
        held.resolve({ data: null, error: new Error("stats packet") });
        await stats;
      }
    },
  );

  test.each(fieldCases)(
    "an edit completing before the pending stats commit preserves optimistic stats with $kind",
    async ({ fields }) => {
      beginAsA();
      highLocalStats();
      const remote = remoteProfile(makeProfile(userA.id, { ...oldStats, ...oldFields }));
      const held = makeDeferred<QueryResult>();
      const reached = makeDeferred<void>();
      let operation: QueryOperation | undefined;
      mockQueryResponse = (next) => {
        if (isStatsUpdate(next)) {
          operation = next;
          reached.resolve();
          return held.promise;
        }
        return remote.request(next);
      };
      const stats = updateProfileStats(database);
      await reached.promise;
      try {
        const result = await useAuthStore.getState().updateProfile(updates(fields));
        expect(result).toMatchObject({
          status: "completed",
          value: expect.objectContaining({ ...newStats, ...fields }),
        });
        expect(useAuthStore.getState().profile).toMatchObject({ ...newStats, ...fields });
        expect(remote.current()).toMatchObject({ ...oldStats, ...fields });
        held.resolve(await remote.request(operation!)!);
        await stats;
        expect(remote.current()).toMatchObject({ ...newStats, ...fields });
        expect(useAuthStore.getState().profile).toMatchObject({ ...newStats, ...fields });
      } finally {
        held.resolve(await remote.request(operation!)!);
        await stats;
      }
    },
  );

  test.each(["fetchProfile", "ensureProfile"] as const)(
    "a %s begun during a write remains fenced after that write settles",
    async (action) => {
      beginAsA();
      highLocalStats();
      const remote = remoteProfile(makeProfile(userA.id, { ...oldStats, ...oldFields }));
      const statsHeld = makeDeferred<QueryResult>();
      const statsReached = makeDeferred<void>();
      const readHeld = makeDeferred<QueryResult>();
      let holdReads = false;
      mockQueryResponse = (operation) => {
        if (isStatsUpdate(operation)) {
          statsReached.resolve();
          return statsHeld.promise;
        }
        if (holdReads && operation.table === "profiles" && operation.kind === "select") return readHeld.promise;
        return remote.request(operation);
      };
      const stats = updateProfileStats(database);
      await statsReached.promise;
      holdReads = true;
      const optimistic = useAuthStore.getState().profile;
      const read = useAuthStore.getState()[action]();
      statsHeld.resolve({ data: null, error: new Error("stats failed") });
      await stats;
      readHeld.resolve({ data: { ...remote.current() }, error: null });
      await read;
      expect(useAuthStore.getState().profile).toBe(optimistic);
    },
  );
  test.each(["same-user-new-session", "different-user-b", "a-b-a"] as const)(
    "old profile write cleanup cannot release replacement write protection after %s",
    async (kind) => {
      const original = beginAsA();
      highLocalStats();
      const oldHeld = makeDeferred<QueryResult>();
      const oldReached = makeDeferred<void>();
      const newHeld = makeDeferred<QueryResult>();
      const newReached = makeDeferred<void>();
      let writes = 0;
      mockQueryResponse = (operation) => {
        if (isStatsUpdate(operation)) {
          if (++writes === 1) {
            oldReached.resolve();
            return oldHeld.promise;
          }
          newReached.resolve();
          return newHeld.promise;
        }
        if (operation.table === "profiles" && operation.kind === "select") {
          const id = operation.filters.find(([key]) => key === "id")?.[1];
          if (typeof id !== "string") throw Error("Missing fixture ID");
          return Promise.resolve({ data: makeProfile(id, oldStats), error: null });
        }
        return undefined;
      };
      const oldWork = updateProfileStats(database);
      await oldReached.promise;
      const replacement = publishReplacement(kind, original);
      await useAuthStore.getState().fetchProfile();
      expect(useAuthStore.getState().profile).toMatchObject({ id: replacement.profile?.id, ...oldStats });
      const newWork = updateProfileStats(database);
      await newReached.promise;
      try {
        oldHeld.resolve({ data: makeProfile(userA.id, newStats), error: null });
        await oldWork;
        const optimistic = useAuthStore.getState().profile;
        expect(optimistic).toMatchObject({ id: replacement.profile?.id, ...newStats });
        await useAuthStore.getState().fetchProfile();
        expect(useAuthStore.getState().profile).toBe(optimistic);
        newHeld.resolve({ data: makeProfile(replacement.profile!.id, newStats), error: null });
        await newWork;
        await useAuthStore.getState().fetchProfile();
        expect(useAuthStore.getState().profile).toMatchObject(oldStats);
      } finally {
        oldHeld.resolve({ data: null, error: null });
        newHeld.resolve({ data: null, error: null });
        await Promise.allSettled([oldWork, newWork]);
      }
    },
  );

  test.each(["fetchProfile", "ensureProfile"] as const)(
    "pending-write %s fallback preserves current data and later rejection releases protection",
    async (action) => {
      beginAsA();
      highLocalStats();
      const held = makeDeferred<QueryResult>();
      const reached = makeDeferred<void>();
      let failRead = false;
      mockQueryResponse = (operation) => {
        if (isStatsUpdate(operation)) {
          reached.resolve();
          return held.promise;
        }
        if (operation.table === "profiles" && operation.kind === "select")
          return Promise.resolve({
            data: failRead ? null : makeProfile(userA.id, oldStats),
            error: failRead ? new Error("read failed") : null,
          });
        return undefined;
      };
      const stats = updateProfileStats(database);
      await reached.promise;
      const optimistic = useAuthStore.getState().profile;
      failRead = true;
      await useAuthStore.getState()[action]();
      expect(useAuthStore.getState().profile).toBe(optimistic);
      const failure = new Error("write rejected");
      held.reject(failure);
      await expect(stats).rejects.toBe(failure);
      failRead = false;
      await useAuthStore.getState()[action]();
      expect(useAuthStore.getState().profile).toMatchObject(oldStats);
    },
  );

  test("stats protection ends before later aggregate requests", async () => {
    beginAsA();
    highLocalStats();
    const pause = pauseAt("profile", "review-stats");
    const stats = updateProfileStats(database);
    await pause.reached;
    try {
      const before = useAuthStore.getState().profile;
      await useAuthStore.getState().fetchProfile();
      expect(useAuthStore.getState().profile).not.toBe(before);
      expect(useAuthStore.getState().profile?.total_score).toBe(0);
    } finally {
      pause.release();
      await stats;
    }
  });
});

describe("public UTC review publication", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test.each([
    {
      instant: "2026-11-03T22:30:00.000Z",
      reviewedAt: ["2026-11-03T21:30:00.000Z", "2026-11-03T22:30:00.000Z"],
      lastDay: "2026-11-03",
      streak: 1,
      activity: [{ date: "2026-11-03", reviews_count: 2 }],
    },
    {
      instant: "2026-11-04T04:30:00.000Z",
      reviewedAt: ["2026-11-03T23:30:00.000Z", "2026-11-04T04:30:00.000Z"],
      lastDay: "2026-11-04",
      streak: 2,
      activity: [
        { date: "2026-11-03", reviews_count: 1 },
        { date: "2026-11-04", reviews_count: 1 },
      ],
    },
  ])("publishes UTC dates and streaks at $instant", async ({ instant, reviewedAt, lastDay, streak, activity }) => {
    jest.setSystemTime(new Date(instant));
    beginAsA();
    mockDatabaseAll.mockResolvedValue(reviewedAt.map((reviewed_at) => ({ reviewed_at })));
    await updateProfileStats(database);
    expect(writeIntents().find((operation) => operation.table === "profiles")?.data).toMatchObject({
      current_streak: streak,
      longest_streak: streak,
      last_review_date: lastDay,
      cards_reviewed: 2,
    });
    expect(writeIntents().find((operation) => operation.table === "public_review_stats")?.data).toMatchObject({
      current_streak: streak,
      longest_streak: streak,
      last_review_date: lastDay,
      total_reviews: 2,
      active_days: activity.length,
    });
    expect(writeIntents().find((operation) => operation.table === "public_review_activity")?.data).toEqual(
      activity.map((row) => ({ user_id: userA.id, ...row, updated_at: instant })),
    );
  });
});
