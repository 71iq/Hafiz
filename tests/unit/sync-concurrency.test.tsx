import React, { Suspense } from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import NetInfo from "@react-native-community/netinfo";
import type { Session } from "@supabase/supabase-js";
import { observeAuthSession } from "@/lib/auth/commands";
import { emitSyncCompleted } from "@/lib/sync/events";
import { useSync } from "@/lib/sync/useSync";

type Summary = { pushed: number; pulled: number; accountRestored: boolean; localDataReplaced: boolean };
const HEALTHY: Summary = { pushed: 1, pulled: 0, accountRestored: false, localDataReplaced: false };
const OLD_RESULT: Summary = { pushed: 0, pulled: 99, accountRestored: true, localDataReplaced: true };
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
let mockDb: object = {};
let mockSession: Session | null = null;
let mockSettings = { isLoaded: true, isTranslationLoading: false };
const mockFullSync = jest.fn(async (..._args: unknown[]): Promise<Summary> => HEALTHY);
const mockStats = jest.fn(async (..._args: unknown[]) => {});
const mockQfSync = jest.fn(async (..._args: unknown[]) => {});
const mockCount = jest.fn(async (..._args: unknown[]) => 0);
const mockQfCount = jest.fn(async (..._args: unknown[]) => 0);

jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/settings/context", () => ({ useSettings: () => mockSettings }));
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: Object.assign(
    (selector: (state: { user: Session["user"] | null; session: Session | null }) => unknown) =>
      selector({ user: mockSession?.user ?? null, session: mockSession }),
    { getState: () => ({ user: mockSession?.user ?? null, session: mockSession }) },
  ),
}));
jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => true }));
jest.mock("@/lib/database/sync", () => ({ fullSync: (...args: unknown[]) => mockFullSync(...args) }));
jest.mock("@/lib/database/sync-queue", () => ({ getPendingSyncCount: (...args: unknown[]) => mockCount(...args) }));
jest.mock("@/lib/fsrs/leaderboard-sync", () => ({ updateProfileStats: (...args: unknown[]) => mockStats(...args) }));
jest.mock("@/lib/quran-foundation/user-sync", () => ({
  fullQfUserSync: (...args: unknown[]) => mockQfSync(...args),
  getPendingQfSyncCount: (...args: unknown[]) => mockQfCount(...args),
}));
jest.mock("@/lib/sync/events", () => ({ emitSyncCompleted: jest.fn() }));
jest.mock("@react-native-community/netinfo", () => ({ fetch: jest.fn(), addEventListener: jest.fn(() => () => {}) }));

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
function session(userId = A): Session {
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, session_id: `10000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` }),
  ).toString("base64url");
  return {
    user: { id: userId, aud: "authenticated", created_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {} },
    access_token: `e30.${payload}.c2ln`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
  };
}
function activate(value: Session | null) {
  mockSession = value;
  observeAuthSession(value);
}
function network(isConnected: boolean) {
  return { isConnected } as Awaited<ReturnType<typeof NetInfo.fetch>>;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(emitSyncCompleted).mockReset();
  activate(null);
  activate(session());
  mockDb = {};
  mockSettings = { isLoaded: true, isTranslationLoading: false };
  mockFullSync.mockReset().mockResolvedValue(HEALTHY);
  mockStats.mockReset().mockResolvedValue();
  mockQfSync.mockReset().mockResolvedValue();
  mockCount.mockReset().mockResolvedValue(0);
  mockQfCount.mockReset().mockResolvedValue(0);
  jest.mocked(NetInfo.fetch).mockReset().mockResolvedValue(network(true));
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  activate(null);
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("runs one sync when triggers arrive during the connectivity check", async () => {
  const response = deferred<Awaited<ReturnType<typeof NetInfo.fetch>>>();
  jest.mocked(NetInfo.fetch).mockReturnValue(response.promise);
  const { result } = renderHook(() => useSync());
  await act(async () => {
    await Promise.all([result.current.triggerSync(), result.current.triggerSync()]);
  });
  expect(NetInfo.fetch).toHaveBeenCalledTimes(1);
  expect(mockFullSync).not.toHaveBeenCalled();
  await act(async () => {
    response.resolve(network(true));
  });
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(result.current.status).toBe("synced"));
});

it("waits for initial settings and translation import before syncing", async () => {
  mockSettings = { isLoaded: false, isTranslationLoading: true };
  const { result, rerender } = renderHook(() => useSync());
  expect(NetInfo.fetch).not.toHaveBeenCalled();
  mockSettings = { isLoaded: true, isTranslationLoading: true };
  rerender({});
  expect(NetInfo.fetch).not.toHaveBeenCalled();
  mockSettings = { isLoaded: true, isTranslationLoading: false };
  rerender({});
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(result.current.status).toBe("synced"));
});

it("releases the guard after an offline check so a later trigger can sync", async () => {
  jest.mocked(NetInfo.fetch).mockResolvedValueOnce(network(false));
  const { result } = renderHook(() => useSync());
  await waitFor(() => expect(result.current.status).toBe("offline"));
  await act(async () => {
    await result.current.triggerSync();
  });
  expect(mockFullSync).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBe("synced");
});

it("retires a deferred connectivity result and admits the latest account after it settles", async () => {
  const response = deferred<Awaited<ReturnType<typeof NetInfo.fetch>>>();
  jest.mocked(NetInfo.fetch).mockReturnValueOnce(response.promise);
  const { result, rerender } = renderHook(() => useSync());
  await act(async () => {
    activate(session(B));
    rerender({});
  });
  expect(NetInfo.fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    response.resolve(network(false));
  });
  await waitFor(() => expect(result.current.status).toBe("synced"));
  expect(NetInfo.fetch).toHaveBeenCalledTimes(2);
  expect(mockFullSync).toHaveBeenCalledTimes(1);
  expect(mockStats).toHaveBeenCalledTimes(1);
});

it.each(["switch", "signout", "same-ID login", "closed A-B-A"])(
  "retires %s while fullSync is pending",
  async (transition) => {
    const original = mockSession;
    const response = deferred<Summary>();
    mockFullSync.mockReturnValueOnce(response.promise);
    const { result, rerender } = renderHook(() => useSync());
    await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
    await act(async () => {
      if (transition === "signout") activate(null);
      else if (transition === "same-ID login") activate(session(A));
      else {
        activate(session(B));
        if (transition === "closed A-B-A") activate(original);
      }
      rerender({});
    });
    expect(mockFullSync).toHaveBeenCalledTimes(1);
    await act(async () => {
      response.resolve(OLD_RESULT);
    });
    await waitFor(() => expect(result.current.status).toBe(transition === "signout" ? "idle" : "synced"));
    expect(mockFullSync).toHaveBeenCalledTimes(transition === "signout" ? 1 : 2);
    expect(mockStats).toHaveBeenCalledTimes(transition === "signout" ? 0 : 1);
    expect(mockQfSync).toHaveBeenCalledTimes(transition === "signout" ? 0 : 1);
    expect(jest.mocked(emitSyncCompleted).mock.calls.every(([summary]) => summary.pulled !== 99)).toBe(true);
    expect(result.current.accountRestoreNotice).toBe(false);
  },
);

it("ignores an obsolete failure and starts the replacement account once", async () => {
  const response = deferred<Summary>();
  mockFullSync.mockReturnValueOnce(response.promise);
  const { result, rerender } = renderHook(() => useSync());
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
  await act(async () => {
    activate(session(B));
    rerender({});
  });
  await act(async () => {
    response.reject(new Error("obsolete synthetic failure"));
  });
  await waitFor(() => expect(result.current.status).toBe("synced"));
  expect(mockFullSync).toHaveBeenCalledTimes(2);
  expect(console.warn).not.toHaveBeenCalled();
});

it.each(["stats", "QF"])("stops the old continuation after deferred %s work", async (stage) => {
  const response = deferred<void>();
  if (stage === "stats") mockStats.mockReturnValueOnce(response.promise);
  else mockQfSync.mockReturnValueOnce(response.promise);
  mockFullSync.mockResolvedValueOnce(OLD_RESULT);
  const { result, rerender } = renderHook(() => useSync());
  await waitFor(() => expect(stage === "stats" ? mockStats : mockQfSync).toHaveBeenCalledTimes(1));
  await act(async () => {
    activate(session(B));
    rerender({});
  });
  jest.mocked(emitSyncCompleted).mockClear();
  await act(async () => {
    response.resolve();
  });
  await waitFor(() => expect(result.current.status).toBe("synced"));
  expect(mockFullSync).toHaveBeenCalledTimes(2);
  expect(mockQfSync).toHaveBeenCalledTimes(stage === "stats" ? 1 : 2);
  expect(jest.mocked(emitSyncCompleted).mock.calls.every(([summary]) => summary.pulled !== 99)).toBe(true);
  expect(result.current.accountRestoreNotice).toBe(false);
});

it("does not let an older pending-count effect overwrite the replacement count", async () => {
  mockSettings = { isLoaded: false, isTranslationLoading: false };
  const response = deferred<number>();
  mockCount.mockImplementation(async () => (mockSession?.user.id === A ? response.promise : 3));
  const { result, rerender } = renderHook(() => useSync());
  await act(async () => {
    activate(session(B));
    rerender({});
  });
  await waitFor(() => expect(result.current.pendingCount).toBe(3));
  await act(async () => {
    response.resolve(99);
  });
  expect(result.current.pendingCount).toBe(3);
});

it("keeps a same-session token refresh current during deferred connectivity", async () => {
  const response = deferred<Awaited<ReturnType<typeof NetInfo.fetch>>>();
  jest.mocked(NetInfo.fetch).mockReturnValueOnce(response.promise);
  const original = mockSession!;
  const claims: unknown = JSON.parse(Buffer.from(original.access_token.split(".")[1], "base64url").toString());
  if (!claims || typeof claims !== "object") throw new Error("Invalid synthetic claims");
  const payload = Buffer.from(JSON.stringify({ ...claims, iat: 2 })).toString("base64url");
  const { result, rerender } = renderHook(() => useSync());
  await act(async () => {
    activate({ ...original, access_token: `e30.${payload}.c2ln` });
    rerender({});
  });
  await act(async () => {
    response.resolve(network(true));
  });
  await waitFor(() => expect(result.current.status).toBe("synced"));
  expect(mockFullSync).toHaveBeenCalledTimes(1);
  expect(NetInfo.fetch).toHaveBeenCalledTimes(1);
});

it("does not let the previous account's idle timer reset a newer success", async () => {
  const { result, rerender } = renderHook(() => useSync());
  await waitFor(() => expect(result.current.status).toBe("synced"));
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  await act(async () => {
    activate(session(B));
    rerender({});
  });
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.status).toBe("synced"));
  await act(async () => {
    jest.advanceTimersByTime(2100);
  });
  expect(result.current.status).toBe("synced");
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(result.current.status).toBe("idle");
});

it.each(["error", "offline"])("does not hide a later %s with an older success timer", async (status) => {
  const { result } = renderHook(() => useSync());
  await waitFor(() => expect(result.current.status).toBe("synced"));
  if (status === "error") mockFullSync.mockRejectedValueOnce(new Error("current synthetic failure"));
  else jest.mocked(NetInfo.fetch).mockResolvedValueOnce(network(false));
  await act(async () => {
    await result.current.triggerSync();
  });
  expect(result.current.status).toBe(status);
  await act(async () => {
    jest.advanceTimersByTime(3100);
  });
  expect(result.current.status).toBe(status);
});

it("retires an old database run and starts one run against its replacement", async () => {
  const response = deferred<Summary>();
  mockFullSync.mockReturnValueOnce(response.promise);
  const oldDb = mockDb;
  const { result, rerender } = renderHook(() => useSync());
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
  mockDb = { synthetic: "replacement" };
  rerender({});
  await act(async () => {
    response.resolve(OLD_RESULT);
  });
  await waitFor(() => expect(result.current.status).toBe("synced"));
  expect(mockFullSync.mock.calls.map(([db]) => db)).toEqual([oldDb, mockDb]);
  expect(mockStats).toHaveBeenCalledTimes(1);
});

it("does not publish or start follow-up work after unmount", async () => {
  const response = deferred<Summary>();
  mockFullSync.mockReturnValueOnce(response.promise);
  const { unmount } = renderHook(() => useSync());
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () => {
    response.resolve(OLD_RESULT);
  });
  expect(mockStats).not.toHaveBeenCalled();
  expect(mockQfSync).not.toHaveBeenCalled();
  expect(emitSyncCompleted).not.toHaveBeenCalled();
});

it("does no account work for an unidentified session", () => {
  activate({ ...mockSession!, access_token: "unidentified" });
  renderHook(() => useSync());
  expect(NetInfo.fetch).not.toHaveBeenCalled();
  expect(mockFullSync).not.toHaveBeenCalled();
  expect(mockCount).not.toHaveBeenCalled();
});

it("rechecks ownership after a synchronous sync-completed listener switches accounts", async () => {
  const response = deferred<Summary>();
  mockFullSync.mockReturnValueOnce(response.promise);
  const { result, rerender } = renderHook(() => useSync());
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
  jest.mocked(emitSyncCompleted).mockImplementationOnce(() => {
    activate(session(B));
  });
  await act(async () => {
    response.resolve(HEALTHY);
  });
  expect(mockQfSync).not.toHaveBeenCalled();
  await act(async () => {
    rerender({});
  });
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.status).toBe("synced"));
  expect(mockQfSync).toHaveBeenCalledTimes(1);
});

it("admits a fresh connectivity trigger after an idle closed A-B-A without a rerender", async () => {
  const original = mockSession;
  const { result } = renderHook(() => useSync());
  await waitFor(() => expect(result.current.status).toBe("synced"));
  const calls = jest.mocked(NetInfo.addEventListener).mock.calls;
  const listener = calls[calls.length - 1]?.[0];
  if (!listener) throw new Error("Connectivity listener was not installed");
  await act(async () => {
    activate(session(B));
    activate(original);
    listener(network(true));
  });
  expect(mockFullSync).toHaveBeenCalledTimes(2);
  expect(result.current.status).toBe("synced");
});

it.each(["same account", "new account", "new database"])(
  "keeps physical background runs serial across overlay unmount and remount: %s",
  async (replacementKind) => {
    const response = deferred<Summary>();
    mockFullSync.mockReturnValueOnce(response.promise);
    const previous = renderHook(() => useSync());
    await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
    previous.unmount();
    if (replacementKind === "new account") activate(session(B));
    if (replacementKind === "new database") mockDb = { synthetic: "replacement" };
    const replacement = renderHook(() => useSync());
    try {
      await act(async () => {});
      expect(mockFullSync).toHaveBeenCalledTimes(1);
      expect(mockStats).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        response.resolve(OLD_RESULT);
      });
    }
    await waitFor(() => expect(replacement.result.current.status).toBe("synced"));
    expect(mockFullSync).toHaveBeenCalledTimes(2);
    expect(mockStats).toHaveBeenCalledTimes(1);
    expect(mockQfSync).toHaveBeenCalledTimes(1);
    expect(replacement.result.current.accountRestoreNotice).toBe(false);
    expect(jest.mocked(emitSyncCompleted).mock.calls.every(([summary]) => summary.pulled !== 99)).toBe(true);
  },
);

it("does not restart an unmounted replacement when the previous physical run settles", async () => {
  const response = deferred<Summary>();
  mockFullSync.mockReturnValueOnce(response.promise);
  const previous = renderHook(() => useSync());
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
  previous.unmount();
  const transient = renderHook(() => useSync());
  transient.unmount();
  await act(async () => {
    response.resolve(OLD_RESULT);
  });
  expect(mockFullSync).toHaveBeenCalledTimes(1);
  expect(mockQfSync).not.toHaveBeenCalled();
  const latest = renderHook(() => useSync());
  await waitFor(() => expect(latest.result.current.status).toBe("synced"));
  expect(mockFullSync).toHaveBeenCalledTimes(2);
});

it("does not admit a speculative database from a suspended transition before commit", async () => {
  const first = deferred<Summary>();
  const blocked = deferred<void>();
  let suspended = false;
  const attempted = jest.fn();
  mockFullSync.mockReturnValueOnce(first.promise);
  const committedDb = mockDb;
  const view = renderHook(
    () => {
      const sync = useSync();
      if (suspended) {
        attempted();
        throw blocked.promise;
      }
      return sync;
    },
    { wrapper: ({ children }: { children: React.ReactNode }) => <Suspense fallback={null}>{children}</Suspense> },
  );
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
  mockDb = { synthetic: "speculative" };
  await act(async () => {
    suspended = true;
    React.startTransition(() => {
      view.rerender({});
    });
  });
  expect(attempted).toHaveBeenCalled();
  try {
    await act(async () => {
      first.resolve(HEALTHY);
    });
    expect(mockFullSync.mock.calls.map(([db]) => db)).toEqual([committedDb]);
  } finally {
    await act(async () => {
      suspended = false;
      blocked.resolve();
      view.rerender({});
    });
  }
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(2));
  expect(mockFullSync.mock.calls.map(([db]) => db)).toEqual([committedDb, mockDb]);
});
