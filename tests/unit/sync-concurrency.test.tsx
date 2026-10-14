import { act, renderHook, waitFor } from "@testing-library/react-native";
import NetInfo from "@react-native-community/netinfo";
import { useSync } from "@/lib/sync/useSync";

const mockDb = {};
const mockUser = { id: "staging-user" };
let mockSettings = { isLoaded: true, isTranslationLoading: false };
const mockFullSync = jest.fn();

jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/settings/context", () => ({ useSettings: () => mockSettings }));
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: (selector: (state: { user: typeof mockUser }) => unknown) => selector({ user: mockUser }),
}));
jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => true }));
jest.mock("@/lib/database/sync", () => ({ fullSync: (...args: unknown[]) => mockFullSync(...args) }));
jest.mock("@/lib/database/sync-queue", () => ({ getPendingSyncCount: async () => 0 }));
jest.mock("@/lib/fsrs/leaderboard-sync", () => ({ updateProfileStats: async () => {} }));
jest.mock("@/lib/quran-foundation/user-sync", () => ({
  fullQfUserSync: async () => {},
  getPendingQfSyncCount: async () => 0,
}));
jest.mock("@/lib/sync/events", () => ({ emitSyncCompleted: jest.fn() }));
jest.mock("@react-native-community/netinfo", () => ({
  fetch: jest.fn(),
  addEventListener: jest.fn(() => () => {}),
}));

describe("automatic sync concurrency", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockSettings = { isLoaded: true, isTranslationLoading: false };
    mockFullSync.mockResolvedValue({ pushed: 1, pulled: 0, accountRestored: false, localDataReplaced: false });
    jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: true } as Awaited<ReturnType<typeof NetInfo.fetch>>);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("runs one sync when triggers arrive during the connectivity check", async () => {
    let resolveNetwork!: (value: Awaited<ReturnType<typeof NetInfo.fetch>>) => void;
    jest.mocked(NetInfo.fetch).mockReturnValue(
      new Promise((resolve) => {
        resolveNetwork = resolve;
      }),
    );
    const { result } = renderHook(() => useSync());
    await act(async () => {
      await Promise.all([result.current.triggerSync(), result.current.triggerSync()]);
    });
    expect(NetInfo.fetch).toHaveBeenCalledTimes(1);
    expect(mockFullSync).not.toHaveBeenCalled();
    await act(async () => {
      resolveNetwork({ isConnected: true } as Awaited<ReturnType<typeof NetInfo.fetch>>);
    });
    await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
  });

  it("waits for initial settings and translation import before syncing", async () => {
    mockSettings = { isLoaded: false, isTranslationLoading: true };
    const { rerender } = renderHook(() => useSync());
    expect(NetInfo.fetch).not.toHaveBeenCalled();
    mockSettings = { isLoaded: true, isTranslationLoading: true };
    rerender({});
    expect(NetInfo.fetch).not.toHaveBeenCalled();
    mockSettings = { isLoaded: true, isTranslationLoading: false };
    rerender({});
    await waitFor(() => expect(mockFullSync).toHaveBeenCalledTimes(1));
  });

  it("releases the guard after an offline check so a later trigger can sync", async () => {
    jest
      .mocked(NetInfo.fetch)
      .mockResolvedValueOnce({ isConnected: false } as Awaited<ReturnType<typeof NetInfo.fetch>>);
    const { result } = renderHook(() => useSync());
    await waitFor(() => expect(result.current.status).toBe("offline"));
    await act(async () => {
      await result.current.triggerSync();
    });
    expect(mockFullSync).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("synced");
  });
});
