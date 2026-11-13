import type { SQLiteDatabase } from "expo-sqlite";
import type { Session, User } from "@supabase/supabase-js";
import type { ProfileSurahProgress } from "@/lib/profile/progress";
import { useAuthStore } from "@/lib/auth/store";
import { updateProfileStats } from "@/lib/fsrs/leaderboard-sync";

/**
 * After daily_scores and the public profile totals were retired (spec 5.6), the post-sync job only
 * repairs this account's own surah progress. It must stay bound to the account that started it and
 * must never write scores, streaks or totals.
 */
type Operation = { table: string; kind: "select" | "upsert" | "delete"; data?: unknown; filters: Array<[string, unknown]> };

const mockOperations: Operation[] = [];
const mockLocalProgress = jest.fn<Promise<ProfileSurahProgress[]>, [SQLiteDatabase]>();
const mockRestored = jest.fn<Promise<boolean>, [SQLiteDatabase, string]>();
let mockRemoteRows: unknown[] = [];
let mockConfigured = true;
let mockBeforeSelect: (() => void) | null = null;

function mockBuilder(table: string) {
  return {
    select: (_columns: string) => {
      const operation: Operation = { table, kind: "select", filters: [] };
      mockOperations.push(operation);
      const query = {
        eq: (column: string, value: unknown) => {
          operation.filters.push([column, value]);
          mockBeforeSelect?.();
          return Promise.resolve({ data: mockRemoteRows, error: null });
        },
      };
      return query;
    },
    upsert: (data: unknown) => {
      mockOperations.push({ table, kind: "upsert", data, filters: [] });
      return Promise.resolve({ error: null });
    },
    delete: () => ({
      eq: (column: string, value: unknown) => {
        mockOperations.push({ table, kind: "delete", filters: [[column, value]] });
        return Promise.resolve({ error: null });
      },
    }),
  };
}

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  supabase: {
    from: (table: string) => mockBuilder(table),
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
jest.mock("@/lib/profile/progress", () => ({
  getLocalSurahProgress: (db: SQLiteDatabase) => mockLocalProgress(db),
}));
jest.mock("@/lib/database/sync", () => ({
  hasCompletedAccountRestore: (db: SQLiteDatabase, id: string) => mockRestored(db, id),
}));
jest.mock("@/lib/auth/oauth", () => ({ startAppOAuth: jest.fn() }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfSyncEnabled: () => false, isQfLoginEnabled: () => false }));
jest.mock("@/lib/quran-foundation/user", () => ({ connectQfFromSession: jest.fn() }));

const db = { name: "synthetic" } as unknown as SQLiteDatabase;

function makeUser(id: string): User {
  return { id, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00.000Z" };
}

let sessionSequence = 0;
function makeSession(user: User): Session {
  const sessionId = `10000000-0000-4000-8000-${String(++sessionSequence).padStart(12, "0")}`;
  const claims = Buffer.from(JSON.stringify({ sub: user.id, session_id: sessionId })).toString("base64url");
  return {
    access_token: `e30.${claims}.c2ln`,
    refresh_token: `synthetic-refresh-${sessionSequence}`,
    token_type: "bearer",
    expires_in: 3600,
    user,
  };
}

const userA = makeUser("00000000-0000-4000-8000-00000000000a");
const userB = makeUser("00000000-0000-4000-8000-00000000000b");

function signIn(user: User | null) {
  const session = user ? makeSession(user) : null;
  useAuthStore.setState({ session, user, profile: null });
}

const progress = (surah: number, totalCards: number, memorized: number): ProfileSurahProgress =>
  ({ surah, totalCards, memorized }) as ProfileSurahProgress;

beforeEach(() => {
  mockOperations.length = 0;
  mockRemoteRows = [];
  mockConfigured = true;
  mockBeforeSelect = null;
  mockLocalProgress.mockReset().mockResolvedValue([]);
  mockRestored.mockReset().mockResolvedValue(true);
  signIn(userA);
});

describe("surah progress repair after sync", () => {
  it("waits for account restore before reading or writing anything", async () => {
    mockRestored.mockResolvedValue(false);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await updateProfileStats(db);
    expect(mockOperations).toEqual([]);
    expect(mockLocalProgress).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps the larger count per surah and writes only this account's surah progress", async () => {
    mockRemoteRows = [
      { surah: 1, total_cards: 7, memorized_cards: 7 },
      { surah: 2, total_cards: 286, memorized_cards: 10 },
    ];
    mockLocalProgress.mockResolvedValue([progress(2, 286, 40), progress(112, 4, 4)]);

    await updateProfileStats(db);

    expect(mockOperations.map((operation) => [operation.table, operation.kind])).toEqual([
      ["public_surah_progress", "select"],
      ["public_surah_progress", "upsert"],
    ]);
    expect(mockOperations[0].filters).toEqual([["user_id", userA.id]]);
    const written = mockOperations[1].data as Array<Record<string, unknown>>;
    expect(written.map(({ updated_at: _ignored, ...row }) => row)).toEqual([
      { user_id: userA.id, surah: 1, total_cards: 7, memorized_cards: 7 },
      { user_id: userA.id, surah: 2, total_cards: 286, memorized_cards: 40 },
      { user_id: userA.id, surah: 112, total_cards: 4, memorized_cards: 4 },
    ]);
  });

  it("clears the server copy when neither side has progress", async () => {
    await updateProfileStats(db);
    expect(mockOperations.map((operation) => [operation.table, operation.kind])).toEqual([
      ["public_surah_progress", "select"],
      ["public_surah_progress", "delete"],
    ]);
    expect(mockOperations[1].filters).toEqual([["user_id", userA.id]]);
  });

  it("drops the run when another account signs in while it reads", async () => {
    mockLocalProgress.mockResolvedValue([progress(1, 7, 7)]);
    mockBeforeSelect = () => signIn(userB);

    await updateProfileStats(db);

    expect(mockOperations.filter((operation) => operation.kind !== "select")).toEqual([]);
  });

  it("does nothing signed out or without the account service", async () => {
    signIn(null);
    await updateProfileStats(db);
    signIn(userA);
    mockConfigured = false;
    await updateProfileStats(db);
    expect(mockOperations).toEqual([]);
  });
});
