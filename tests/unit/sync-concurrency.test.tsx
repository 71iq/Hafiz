import React, { Suspense } from "react";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react-native";
import NetInfo from "@react-native-community/netinfo";
import type { Session } from "@supabase/supabase-js";
import { observeAuthSession } from "@/lib/auth/commands";
import { emitSyncCompleted } from "@/lib/sync/events";
import { RECONNECT_SYNC_DEBOUNCE_MS, useSync } from "@/lib/sync/useSync";
import { getRestoreConsentView, useRestoreConsent, useSyncRestorePause } from "@/lib/sync/restore-consent";
import { RestoreConsentDialog } from "@/components/sync/RestoreConsent";
import { strings } from "@/lib/i18n/strings";

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
jest.mock("@/lib/ui/reduced-motion", () => ({ useReducedMotionPreference: () => true }));

type Summary = import("@/lib/database/sync").SyncResult;
type QfResult = import("@/lib/quran-foundation/user-sync").QfSyncResult;
const QF_HEALTHY: QfResult = { status: "synced", pushed: 0, pulled: 0 };
const HEALTHY: Summary = { status: "synced", pushed: 1, pulled: 0, accountRestored: false, localDataReplaced: false };
const OLD_RESULT: Summary = { status: "synced", pushed: 0, pulled: 99, accountRestored: true, localDataReplaced: true };
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
let mockDb: object = {};
let mockQfEnabled = true;
let mockSession: Session | null = null;
let mockSettings = { isLoaded: true, isTranslationLoading: false };
const mockFullSync = jest.fn(async (..._args: unknown[]): Promise<Summary> => HEALTHY);
const mockStats = jest.fn(async (..._args: unknown[]) => {});
const mockQfSync = jest.fn(async (..._args: unknown[]): Promise<QfResult> => QF_HEALTHY);
const mockCount = jest.fn(async (..._args: unknown[]) => 0);
const mockQfCount = jest.fn(async (..._args: unknown[]) => 0);

jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/settings/context", () => ({ useSettings: () => ({ ...mockSettings, uiLanguage: "en" }) }));
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: Object.assign(
    (selector: (state: { user: Session["user"] | null; session: Session | null }) => unknown) =>
      selector({ user: mockSession?.user ?? null, session: mockSession }),
    { getState: () => ({ user: mockSession?.user ?? null, session: mockSession }) },
  ),
}));
jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => true }));
const mockPause = jest.fn(async (..._args: unknown[]): Promise<"pending_consent" | "cancelled" | null> => null);
const mockAccept = jest.fn(async (..._args: unknown[]): Promise<Summary> => HEALTHY);
const mockCancel = jest.fn(async (..._args: unknown[]) => true);
const mockRefreshConsent = jest.fn<ReturnType<typeof import("@/lib/database/sync").refreshRestoreConsent>, unknown[]>();
const mockClearConsent = jest.fn();
jest.mock("@/lib/database/sync", () => ({
  fullSync: (...args: unknown[]) => mockFullSync(...args),
  readRestorePause: (...args: unknown[]) => mockPause(...args),
  acceptRestoreConsent: (...args: unknown[]) => mockAccept(...args),
  cancelRestoreConsent: (...args: unknown[]) => mockCancel(...args),
  refreshRestoreConsent: (...args: unknown[]) => mockRefreshConsent(...args),
  clearRestoreConsentRequests: () => mockClearConsent(),
  hasCompletedAccountRestore: async () => false,
}));
jest.mock("@/lib/database/sync-queue", () => ({ getPendingSyncCount: (...args: unknown[]) => mockCount(...args) }));
jest.mock("@/lib/fsrs/leaderboard-sync", () => ({ updateProfileStats: (...args: unknown[]) => mockStats(...args) }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfSyncEnabled: () => mockQfEnabled }));
jest.mock("@/lib/quran-foundation/user-sync", () => ({
  fullQfUserSync: (...args: unknown[]) => mockQfSync(...args),
  getPendingQfSyncCount: (...args: unknown[]) => mockQfCount(...args),
}));
const mockQueuedListeners = new Set<() => void>();
jest.mock("@/lib/sync/events", () => ({
  emitSyncCompleted: jest.fn(),
  subscribeSyncQueued: (listener: () => void) => {
    mockQueuedListeners.add(listener);
    return () => mockQueuedListeners.delete(listener);
  },
}));
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
  mockQfEnabled = true;
  mockSettings = { isLoaded: true, isTranslationLoading: false };
  mockFullSync.mockReset().mockResolvedValue(HEALTHY);
  mockPause.mockReset().mockResolvedValue(null);
  mockAccept.mockReset().mockResolvedValue(HEALTHY);
  mockCancel.mockReset().mockResolvedValue(true);
  mockStats.mockReset().mockResolvedValue();
  mockQfSync.mockReset().mockResolvedValue(QF_HEALTHY);
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
  // The stored pause is read first; wait until A's run is waiting on connectivity.
  await waitFor(() => expect(NetInfo.fetch).toHaveBeenCalledTimes(1));
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
  const qfResponse = deferred<QfResult>();
  if (stage === "stats") mockStats.mockReturnValueOnce(response.promise);
  else mockQfSync.mockReturnValueOnce(qfResponse.promise);
  mockFullSync.mockResolvedValueOnce(OLD_RESULT);
  const { result, rerender } = renderHook(() => useSync());
  await waitFor(() => expect(stage === "stats" ? mockStats : mockQfSync).toHaveBeenCalledTimes(1));
  await act(async () => {
    activate(session(B));
    rerender({});
  });
  jest.mocked(emitSyncCompleted).mockClear();
  await act(async () => {
    if (stage === "stats") response.resolve();
    else qfResponse.resolve(QF_HEALTHY);
  });
  await waitFor(() => expect(result.current.status).toBe("synced"));
  expect(mockFullSync).toHaveBeenCalledTimes(2);
  expect(mockQfSync).toHaveBeenCalledTimes(stage === "stats" ? 1 : 2);
  expect(jest.mocked(emitSyncCompleted).mock.calls.every(([summary]) => summary.pulled !== 99)).toBe(true);
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

it("announces a restore that found no remote data, which moved nothing and replaced nothing", async () => {
  mockFullSync.mockResolvedValueOnce({ status: "synced", pushed: 0, pulled: 0, accountRestored: false, localDataReplaced: false, restoreCompleted: true });
  renderHook(() => useSync());
  await waitFor(() => expect(emitSyncCompleted).toHaveBeenCalledWith(expect.objectContaining({ restoreCompleted: true, pulled: 0 })));
});

it("announces a finished account restore even when it moved no rows", async () => {
  mockFullSync.mockResolvedValueOnce({ status: "synced", pushed: 0, pulled: 0, accountRestored: true, localDataReplaced: false });
  renderHook(() => useSync());
  await waitFor(() => expect(emitSyncCompleted).toHaveBeenCalledWith(expect.objectContaining({ accountRestored: true, pulled: 0 })));
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
  // W02: a reconnect is debounced before it syncs.
  expect(mockFullSync).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(RECONNECT_SYNC_DEBOUNCE_MS);
  });
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(2));
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
    // The retired run's rows are announced only while the replacement syncs the same database for the
    // same session; its follow-up work (stats, QF) still runs once, from the replacement.
    const announced = jest.mocked(emitSyncCompleted).mock.calls.some(([summary]) => summary.pulled === 99);
    expect(announced).toBe(replacementKind === "same account");
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

it.each(["partial", "failed"] as const)(
  "keeps an ordinary %s result visible and retries without a success timer",
  async (status) => {
    const summary: Summary = { ...HEALTHY, status, pushed: 0, pulled: status === "partial" ? 3 : 0 };
    mockFullSync.mockResolvedValueOnce(summary);
    mockCount.mockResolvedValue(2);
    const { result } = renderHook(() => useSync());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.pendingCount).toBe(2);
    expect(mockStats).toHaveBeenCalledTimes(1);
    if (status === "partial") expect(emitSyncCompleted).toHaveBeenCalledWith(summary);
    else expect(emitSyncCompleted).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.status).toBe("error");
    mockCount.mockResolvedValue(0);
    await act(async () => {
      await result.current.triggerSync();
    });
    expect(result.current.status).toBe("synced");
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(result.current.status).toBe("idle");
  },
);

it.each(["failed", "needs_reauth", "not_connected", "synced"] as const)(
  "evaluates the enabled QF %s result after ordinary sync",
  async (status) => {
    mockQfSync.mockResolvedValue({ status, pushed: 0, pulled: 0 });
    mockQfCount.mockResolvedValue(status === "not_connected" ? 4 : status === "failed" ? 2 : 0);
    const { result } = renderHook(() => useSync());
    const expected = status === "failed" || status === "needs_reauth" ? "error" : "synced";
    await waitFor(() => expect(result.current.status).toBe(expected));
    expect(mockQfSync).toHaveBeenCalledTimes(1);
    expect(result.current.pendingCount).toBe(status === "not_connected" ? 4 : status === "failed" ? 2 : 0);
    if (expected === "error") {
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });
      expect(result.current.status).toBe("error");
    }
  },
);

it.each(["synced", "failed"] as const)(
  "does not request disabled QF sync or hide ordinary %s status",
  async (status) => {
    mockQfEnabled = false;
    mockQfCount.mockResolvedValue(7);
    mockFullSync.mockResolvedValue({ ...HEALTHY, status });
    const { result } = renderHook(() => useSync());
    await waitFor(() => expect(result.current.status).toBe(status === "synced" ? "synced" : "error"));
    // Dormant Quran Foundation rows stay stored but are not reported while its gate is off.
    expect(result.current.pendingCount).toBe(0);
    expect(mockQfCount).not.toHaveBeenCalled();
    expect(mockQfSync).not.toHaveBeenCalled();
  },
);

it("waits for final pending counts before publishing success", async () => {
  const count = deferred<number>();
  mockCount.mockReturnValue(count.promise);
  const { result } = renderHook(() => useSync());
  await waitFor(() => expect(mockQfSync).toHaveBeenCalledTimes(1));
  expect(result.current.status).toBe("syncing");
  await act(async () => {
    count.resolve(0);
  });
  await waitFor(() => expect(result.current.status).toBe("synced"));
});

it("shows pending work added after the ordinary outcome instead of a false success", async () => {
  mockCount.mockResolvedValue(1);
  const { result } = renderHook(() => useSync());
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.pendingCount).toBe(1);
});

it("refreshes both queue counts after connectivity is lost during an admitted sync", async () => {
  mockFullSync.mockRejectedValueOnce(new Error("Synthetic connection lost"));
  mockCount.mockResolvedValue(3);
  mockQfCount.mockResolvedValue(2);
  const { result } = renderHook(() => useSync());
  await waitFor(() => expect(result.current.status).toBe("error"));
  await waitFor(() => expect(result.current.pendingCount).toBe(5));
  expect(NetInfo.fetch).toHaveBeenCalledTimes(1);
  expect(mockStats).not.toHaveBeenCalled();
  expect(mockQfSync).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledWith("[Sync] Error:", "Synthetic connection lost");
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(result.current.status).toBe("error");
});

it("does not let error-count recovery publish after its account retires", async () => {
  const oldCount = deferred<number>();
  const entered = deferred<void>();
  mockFullSync.mockRejectedValueOnce(new Error("Synthetic old-owner failure"));
  mockCount.mockImplementation(async () => {
    if (mockSession?.user.id === A && mockFullSync.mock.calls.length === 1) {
      entered.resolve();
      return oldCount.promise;
    }
    return 0;
  });
  const { result, rerender } = renderHook(() => useSync());
  await act(async () => {
    await entered.promise;
  });
  await act(async () => {
    activate(session(B));
    rerender({});
  });
  expect(result.current.pendingCount).toBe(0);
  await act(async () => {
    oldCount.resolve(77);
  });
  await waitFor(() => expect(result.current.status).toBe("synced"));
  expect(result.current.pendingCount).toBe(0);
  expect(mockFullSync).toHaveBeenCalledTimes(2);
});

it("pushes a local change about 20 seconds after it is queued", async () => {
  const { result } = renderHook(() => useSync());
  await waitFor(() => expect(result.current.status).toBe("synced"));
  expect(mockFullSync).toHaveBeenCalledTimes(1);

  act(() => {
    for (const listener of mockQueuedListeners) listener();
    for (const listener of mockQueuedListeners) listener();
  });
  await act(async () => {
    jest.advanceTimersByTime(19_000);
  });
  expect(mockFullSync).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(1_500);
  });
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(2));
});

it("syncs when the app goes to the background", async () => {
  const { AppState } = jest.requireActual<typeof import("react-native")>("react-native");
  let changeListener: ((state: string) => void) | undefined;
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, listener: (state: string) => void) => {
    changeListener = listener;
    return { remove: () => {} };
  }) as never);
  const { result } = renderHook(() => useSync());
  await waitFor(() => expect(result.current.status).toBe("synced"));
  await act(async () => {
    changeListener?.("background");
  });
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(2));
});

describe("W07 restore pause and consent", () => {
  type ConsentSummary = Extract<Summary, { status: "needs_restore_consent" }>;
  function consent(token = "token-1"): ConsentSummary {
    return {
      status: "needs_restore_consent",
      pushed: 0,
      pulled: 0,
      accountRestored: false,
      localDataReplaced: false,
      request: {
        token,
        userId: A,
        accountEmail: null,
        summary: { categories: [{ key: "bookmarks", count: 1 }], pendingChanges: 0 },
        preparedAt: Date.now(),
        expiresAt: Date.now() + 5 * 60_000,
      },
    };
  }

  it("shows a stored pause at an offline cold start without reaching the network", async () => {
    mockPause.mockResolvedValue("pending_consent");
    jest.mocked(NetInfo.fetch).mockResolvedValue(network(false));
    renderHook(() => useSync());
    await waitFor(() => expect(getRestoreConsentView()).toMatchObject({ userId: A, pause: "pending_consent" }));
    expect(mockFullSync).not.toHaveBeenCalled();
  });

  it("stops every automatic trigger and every profile/QF upload while the account is paused", async () => {
    mockPause.mockResolvedValue("cancelled");
    const { AppState } = jest.requireActual<typeof import("react-native")>("react-native");
    let changeListener: ((state: string) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, listener: (state: string) => void) => {
      changeListener = listener;
      return { remove: () => {} };
    }) as never);
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
    renderHook(() => useSync());
    await waitFor(() => expect(mockPause).toHaveBeenCalledTimes(1));
    expect(getRestoreConsentView()).toMatchObject({ userId: A, pause: "cancelled", request: null });

    const calls = jest.mocked(NetInfo.addEventListener).mock.calls;
    const netListener = calls[calls.length - 1]?.[0];
    await act(async () => {
      changeListener?.("active");
      changeListener?.("background");
    });
    await act(async () => {
      for (const listener of mockQueuedListeners) listener();
      jest.advanceTimersByTime(20_000);
    });
    await act(async () => {
      netListener?.(network(true));
      jest.advanceTimersByTime(RECONNECT_SYNC_DEBOUNCE_MS);
    });
    await act(async () => {
      jest.advanceTimersByTime(5 * 60_000);
    });
    expect(mockPause.mock.calls.length).toBeGreaterThan(4);
    expect(mockFullSync).not.toHaveBeenCalled();
    expect(mockStats).not.toHaveBeenCalled();
    expect(mockQfSync).not.toHaveBeenCalled();
    expect(emitSyncCompleted).not.toHaveBeenCalled();
  });

  it("opens consent without profile, QF or completion work, then accepts with only the token", async () => {
    mockFullSync.mockResolvedValueOnce(consent());
    const { result } = renderHook(() => useSync());
    await waitFor(() => expect(getRestoreConsentView().request?.token).toBe("token-1"));
    expect(getRestoreConsentView().pause).toBe("pending_consent");
    expect(mockStats).not.toHaveBeenCalled();
    expect(mockQfSync).not.toHaveBeenCalled();
    expect(emitSyncCompleted).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");

    mockAccept.mockResolvedValueOnce({ ...HEALTHY, accountRestored: true, localDataReplaced: true, restoreCompleted: true });
    const consentHook = renderHook(() => useRestoreConsent(A));
    await act(async () => {
      consentHook.result.current.accept();
    });
    await waitFor(() => expect(result.current.status).toBe("synced"));
    expect(mockAccept).toHaveBeenCalledWith(mockDb, "token-1");
    expect(getRestoreConsentView()).toMatchObject({ request: null, pause: null, busy: null });
    expect(mockStats).toHaveBeenCalledTimes(1);
    expect(emitSyncCompleted).toHaveBeenCalledTimes(1);
  });

  it.each(["stale", "expired", "failed"])("requires preparation and a separate confirmation after %s consent", async (issue) => {
    mockFullSync.mockResolvedValueOnce(consent("old"));
    renderHook(() => useSync());
    await waitFor(() => expect(getRestoreConsentView().request?.token).toBe("old"));
    if (issue === "failed") mockAccept.mockRejectedValueOnce(new Error("restore rolled back"));
    else mockAccept.mockResolvedValueOnce({ ...HEALTHY, status: issue === "stale" ? "restore_consent_stale" : "restore_consent_invalid" });
    const fresh = consent("fresh").request;
    mockRefreshConsent.mockResolvedValueOnce({
      request: { ...fresh, summary: { categories: [{ key: "bookmarks", count: 3 }], pendingChanges: 2 } },
      pause: "pending_consent",
    });
    const dialog = render(<RestoreConsentDialog />);
    const useAccount = strings.en.syncRestoreUseAccount;
    await act(async () => fireEvent.press(dialog.getByText(useAccount)));
    expect(getRestoreConsentView().issue).toBe(issue);
    expect(mockRefreshConsent).not.toHaveBeenCalled();
    expect(dialog.queryByText(useAccount)).toBeNull();
    expect(dialog.queryByText(strings.en.sharedTryAgain)).toBeNull();

    await act(async () => fireEvent.press(dialog.getByText(strings.en.syncRestorePrepareAgain)));
    expect(dialog.getByText(/Bookmarks: 3/)).toBeTruthy();
    expect(dialog.getByText(/Pending sync changes: 2/)).toBeTruthy();
    expect(getRestoreConsentView().issue).toBeNull();
    expect(mockAccept).toHaveBeenCalledTimes(1);
    expect(mockFullSync).toHaveBeenCalledTimes(1);
    expect(mockStats).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(dialog.getByText(useAccount)));
    expect(mockAccept).toHaveBeenLastCalledWith(mockDb, "fresh");
  });

  it("cancels into a stored pause, and Resume sync asks for a fresh snapshot", async () => {
    mockFullSync.mockResolvedValueOnce(consent());
    renderHook(() => useSync());
    await waitFor(() => expect(getRestoreConsentView().request).not.toBeNull());
    const consentHook = renderHook(() => useRestoreConsent(A));
    await act(async () => {
      consentHook.result.current.cancel();
    });
    await waitFor(() => expect(getRestoreConsentView()).toMatchObject({ request: null, pause: "cancelled" }));
    expect(mockCancel).toHaveBeenCalledTimes(1);

    const pauseHook = renderHook(() => useSyncRestorePause(A));
    expect(pauseHook.result.current.paused).toBe(true);
    mockFullSync.mockResolvedValueOnce(consent("resumed"));
    await act(async () => {
      pauseHook.result.current.resume();
    });
    await waitFor(() => expect(getRestoreConsentView().request?.token).toBe("resumed"));
    expect(mockFullSync).toHaveBeenLastCalledWith(mockDb, { resume: true });
  });

  it("drops a prepared request on an account transition", async () => {
    mockFullSync.mockResolvedValueOnce(consent());
    const { rerender } = renderHook(() => useSync());
    await waitFor(() => expect(getRestoreConsentView().request).not.toBeNull());
    mockClearConsent.mockClear();
    await act(async () => {
      activate(session(B));
      rerender({});
    });
    expect(mockClearConsent).toHaveBeenCalled();
    expect(getRestoreConsentView()).toMatchObject({ userId: B, request: null, pause: null });
  });

  it("debounces a reconnect, cancels it on another offline transition and ignores unknown connectivity", async () => {
    const { result } = renderHook(() => useSync());
    await waitFor(() => expect(result.current.status).toBe("synced"));
    const calls = jest.mocked(NetInfo.addEventListener).mock.calls;
    const listener = calls[calls.length - 1]?.[0];
    if (!listener) throw new Error("Connectivity listener was not installed");
    await act(async () => {
      listener(network(true));
      jest.advanceTimersByTime(1_000);
      listener(network(false));
      jest.advanceTimersByTime(RECONNECT_SYNC_DEBOUNCE_MS);
    });
    expect(mockFullSync).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("offline");
    await act(async () => {
      listener({ isConnected: null } as Awaited<ReturnType<typeof NetInfo.fetch>>);
    });
    expect(result.current.status).toBe("offline");
    await act(async () => {
      listener(network(true));
      listener(network(true));
      jest.advanceTimersByTime(RECONNECT_SYNC_DEBOUNCE_MS);
    });
    await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(2));
  });
});

describe("W14 account status details", () => {
  it("records the last complete sync and names a failure class", async () => {
    const { result } = renderHook(() => useSync());
    await waitFor(() => expect(result.current.status).toBe("synced"));
    expect(result.current.failure).toBeNull();
    expect(Date.parse(result.current.lastSyncedAt ?? "")).not.toBeNaN();
    const lastSuccess = result.current.lastSyncedAt;

    mockFullSync.mockResolvedValueOnce({ ...HEALTHY, status: "failed" });
    await act(async () => {
      await result.current.syncNow();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.failure).toBe("failed");
    // A failed run never moves the last successful time.
    expect(result.current.lastSyncedAt).toBe(lastSuccess);

    mockFullSync.mockResolvedValueOnce({ ...HEALTHY, status: "partial" });
    await act(async () => {
      await result.current.syncNow();
    });
    expect(result.current.failure).toBe("partial");
  });

  it("reports offline as its own class", async () => {
    jest.mocked(NetInfo.fetch).mockResolvedValueOnce(network(false));
    const { result } = renderHook(() => useSync());
    await waitFor(() => expect(result.current.failure).toBe("offline"));
  });

  it("keeps Sync now behind a stored restore pause; only Resume sync continues", async () => {
    mockPause.mockResolvedValue("cancelled");
    const { result } = renderHook(() => useSync());
    await waitFor(() => expect(mockPause).toHaveBeenCalled());
    await act(async () => {
      await result.current.syncNow();
    });
    expect(mockFullSync).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("waits for a run in progress instead of dropping Sync now", async () => {
    const first = deferred<Summary>();
    mockFullSync.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useSync());
    await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
    let manual: Promise<void> | undefined;
    act(() => {
      manual = result.current.syncNow();
    });
    await act(async () => {
      first.resolve(HEALTHY);
      await manual;
    });
    expect(mockFullSync).toHaveBeenCalledTimes(2);
  });
});

it("announces what a run moved when its view is replaced but the same session owns the data", async () => {
  // Found on an Android phone: the account restore after sign-in finished as the app navigated, its run
  // was retired with the view, and Home kept the empty plan it read first until the app restarted.
  const restored: Summary = { status: "synced", pushed: 0, pulled: 71, accountRestored: true, localDataReplaced: false, restoreCompleted: true };
  const response = deferred<Summary>();
  mockFullSync.mockReturnValueOnce(response.promise);
  renderHook(() => useSync());
  await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
  // A newer view takes over while the restore is still running.
  const second = renderHook(() => useSync());
  await act(async () => {
    response.resolve(restored);
  });
  await waitFor(() => expect(second.result.current.status).toBe("synced"));
  expect(jest.mocked(emitSyncCompleted).mock.calls.some(([summary]) => summary.pulled === 71)).toBe(true);
});

it("announces a restore before profile stats, so a view replaced during the stats keeps it", async () => {
  // Review finding: the restore finished while its view was current, the view was replaced during
  // the profile stats upload, and the run returned there without announcing.
  const restored: Summary = { status: "synced", pushed: 0, pulled: 71, accountRestored: true, localDataReplaced: false, restoreCompleted: true };
  const stats = deferred<void>();
  mockFullSync.mockResolvedValueOnce(restored);
  mockStats.mockReturnValueOnce(stats.promise);
  const first = renderHook(() => useSync());
  await waitFor(() => expect(mockStats).toHaveBeenCalledTimes(1));
  first.unmount();
  const second = renderHook(() => useSync());
  await act(async () => {
    stats.resolve();
  });
  await waitFor(() => expect(second.result.current.status).toBe("synced"));
  expect(jest.mocked(emitSyncCompleted).mock.calls.some(([summary]) => summary.pulled === 71)).toBe(true);
});
