import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useFocusKeepAwake as useNativeLease } from "@/components/mushaf/focus-keep-awake";
import { useFocusKeepAwake as useWebLease } from "@/components/mushaf/focus-keep-awake.web";

jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(async () => undefined),
}));

const activate = activateKeepAwakeAsync as jest.Mock;
const deactivate = deactivateKeepAwake as jest.Mock;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("focus keep-awake lease (native)", () => {
  let appStateListener: ((state: AppStateStatus) => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      appStateListener = listener as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it("holds nothing until Play, one lease while playing, and releases it on pause", async () => {
    const view = renderHook(({ playing }: { playing: boolean }) => useNativeLease(playing), {
      initialProps: { playing: false },
    });
    await flush();
    expect(activate).not.toHaveBeenCalled();

    view.rerender({ playing: true });
    await flush();
    expect(activate).toHaveBeenCalledTimes(1);

    view.rerender({ playing: true });
    await flush();
    expect(activate).toHaveBeenCalledTimes(1);

    view.rerender({ playing: false });
    await flush();
    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it("releases in the background and takes it again on return only while still playing", async () => {
    const view = renderHook(({ playing }: { playing: boolean }) => useNativeLease(playing), {
      initialProps: { playing: true },
    });
    await flush();
    expect(activate).toHaveBeenCalledTimes(1);

    act(() => appStateListener?.("background"));
    await flush();
    expect(deactivate).toHaveBeenCalledTimes(1);

    act(() => appStateListener?.("active"));
    await flush();
    expect(activate).toHaveBeenCalledTimes(2);

    view.rerender({ playing: false });
    act(() => appStateListener?.("background"));
    act(() => appStateListener?.("active"));
    await flush();
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it("releases on unmount, and a refused lease never throws", async () => {
    const view = renderHook(() => useNativeLease(true));
    await flush();
    view.unmount();
    await flush();
    expect(deactivate).toHaveBeenCalledTimes(1);

    activate.mockRejectedValueOnce(new Error("denied"));
    const refused = renderHook(() => useNativeLease(true));
    await flush();
    refused.unmount();
    await flush();
    expect(deactivate).toHaveBeenCalledTimes(1);
  });
});

describe("focus keep-awake lease (web Wake Lock)", () => {
  const nav = globalThis.navigator as Navigator & { wakeLock?: unknown };
  const originalWakeLock = nav.wakeLock;
  afterEach(() => {
    Object.defineProperty(nav, "wakeLock", { value: originalWakeLock, configurable: true });
  });

  it("is a harmless no-op where the Wake Lock API is missing", async () => {
    Object.defineProperty(nav, "wakeLock", { value: undefined, configurable: true });
    const view = renderHook(({ playing }: { playing: boolean }) => useWebLease(playing), {
      initialProps: { playing: true },
    });
    await flush();
    view.rerender({ playing: false });
    view.unmount();
  });

  it("study continues when the browser denies the lock", async () => {
    const request = jest.fn(() => Promise.reject(new Error("NotAllowedError")));
    Object.defineProperty(nav, "wakeLock", { value: { request }, configurable: true });
    const view = renderHook(() => useWebLease(true));
    await flush();
    expect(request).toHaveBeenCalledWith("screen");
    view.unmount();
  });

  it("requests on Play and releases on pause", async () => {
    const release = jest.fn(async () => undefined);
    const request = jest.fn(async () => ({ release }));
    Object.defineProperty(nav, "wakeLock", { value: { request }, configurable: true });
    const view = renderHook(({ playing }: { playing: boolean }) => useWebLease(playing), {
      initialProps: { playing: false },
    });
    await flush();
    expect(request).not.toHaveBeenCalled();

    view.rerender({ playing: true });
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    view.rerender({ playing: false });
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
