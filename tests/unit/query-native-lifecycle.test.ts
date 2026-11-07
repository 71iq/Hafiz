import { focusManager, onlineManager } from "@tanstack/react-query";
import { bindNativeQueryLifecycle, createAppQueryClient } from "@/lib/query/native-lifecycle";

type NetState = { isConnected: boolean | null; isInternetReachable: boolean | null };
const mockNetListeners = new Set<(state: NetState) => void>();
const mockAppListeners = new Set<(state: string) => void>();
let mockPlatform = "android";

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: NetState) => void) => {
      mockNetListeners.add(listener);
      return () => mockNetListeners.delete(listener);
    },
  },
}));
jest.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mockPlatform;
    },
  },
  AppState: {
    addEventListener: (_type: string, listener: (state: string) => void) => {
      mockAppListeners.add(listener);
      return { remove: () => mockAppListeners.delete(listener) };
    },
  },
}));

function network(state: NetState) {
  mockNetListeners.forEach((listener) => listener(state));
}
function appState(state: string) {
  mockAppListeners.forEach((listener) => listener(state));
}

afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
  mockPlatform = "android";
});

describe("RF-028 native Query online and focus lifecycle", () => {
  it("follows NetInfo and AppState on native and removes both listeners on cleanup", () => {
    const unbind = bindNativeQueryLifecycle();

    network({ isConnected: false, isInternetReachable: false });
    expect(onlineManager.isOnline()).toBe(false);
    network({ isConnected: true, isInternetReachable: null });
    expect(onlineManager.isOnline()).toBe(true);
    network({ isConnected: true, isInternetReachable: false });
    expect(onlineManager.isOnline()).toBe(false);

    appState("background");
    expect(focusManager.isFocused()).toBe(false);
    appState("active");
    expect(focusManager.isFocused()).toBe(true);

    unbind();
    expect(mockNetListeners.size).toBe(0);
    expect(mockAppListeners.size).toBe(0);
  });

  it("keeps a single listener pair across a strict remount", () => {
    const first = bindNativeQueryLifecycle();
    first();
    const second = bindNativeQueryLifecycle();

    expect(mockNetListeners.size).toBe(1);
    expect(mockAppListeners.size).toBe(1);
    second();
  });

  it("leaves the web on the browser's own online and visibility events", () => {
    mockPlatform = "web";
    const unbind = bindNativeQueryLifecycle();

    expect(mockNetListeners.size).toBe(0);
    expect(mockAppListeners.size).toBe(0);
    unbind();
  });

  it("still loads a local database query offline on native", async () => {
    const client = createAppQueryClient();
    const unbind = bindNativeQueryLifecycle();
    network({ isConnected: false, isInternetReachable: false });

    await expect(
      client.fetchQuery({ queryKey: ["synthetic-local"], queryFn: async () => "from SQLite", gcTime: 0 }),
    ).resolves.toBe("from SQLite");
    unbind();
    client.clear();
  });

  it("keeps the web on the default network mode", () => {
    mockPlatform = "web";
    const client = createAppQueryClient();

    expect(client.getDefaultOptions().queries?.networkMode).toBe("online");
    expect(client.getDefaultOptions().mutations?.networkMode).toBe("online");
  });

  it("does not pause native writes offline, so nothing replays on reconnect", async () => {
    const client = createAppQueryClient();
    const unbind = bindNativeQueryLifecycle();
    network({ isConnected: false, isInternetReachable: false });
    const write = jest.fn(async () => {
      throw new Error("synthetic offline failure");
    });

    await expect(
      client.getMutationCache().build(client, { mutationFn: write, gcTime: 0 }).execute(undefined),
    ).rejects.toThrow("synthetic offline failure");
    expect(write).toHaveBeenCalledTimes(1);

    network({ isConnected: true, isInternetReachable: true });
    await client.resumePausedMutations();
    expect(write).toHaveBeenCalledTimes(1);
    unbind();
  });
});
