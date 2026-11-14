import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { createActiveClock, useActiveClock } from "@/lib/habit/use-active-clock";

/** Screen focus for useIsFocused; a test takes it away and gives it back like a screen pushed on top. */
const mockFocus = { focused: true, listeners: new Set<() => void>() };
jest.mock("@react-navigation/native", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    useIsFocused: () =>
      React.useSyncExternalStore(
        (listener: () => void) => {
          mockFocus.listeners.add(listener);
          return () => mockFocus.listeners.delete(listener);
        },
        () => mockFocus.focused,
      ),
  };
});

const MINUTE = 60_000;

describe("createActiveClock", () => {
  let time = 0;
  const now = () => time;

  beforeEach(() => {
    time = 1_000_000;
  });

  it("counts from creation while running", () => {
    const clock = createActiveClock({ now });
    time += 2 * MINUTE;
    expect(clock.elapsedMs()).toBe(2 * MINUTE);
  });

  it("counts nothing while paused and keeps the earlier time across a resume", () => {
    const clock = createActiveClock({ now });
    time += MINUTE;
    clock.pause();
    time += 6 * MINUTE;
    expect(clock.elapsedMs()).toBe(MINUTE);
    clock.resume();
    time += 2 * MINUTE;
    expect(clock.elapsedMs()).toBe(3 * MINUTE);
  });

  it("ignores a second pause or resume", () => {
    const clock = createActiveClock({ now });
    time += MINUTE;
    clock.pause();
    time += MINUTE;
    clock.pause();
    clock.resume();
    time += MINUTE;
    // A second resume would restart the running segment and lose the minute before it.
    clock.resume();
    time += MINUTE;
    expect(clock.elapsedMs()).toBe(3 * MINUTE);
  });

  it("starts paused when asked, counting from its first resume", () => {
    const clock = createActiveClock({ now, running: false });
    time += 5 * MINUTE;
    expect(clock.elapsedMs()).toBe(0);
    clock.resume();
    time += MINUTE;
    expect(clock.elapsedMs()).toBe(MINUTE);
  });

  it("resets while running to count again from the reset", () => {
    const clock = createActiveClock({ now });
    time += 4 * MINUTE;
    clock.reset();
    expect(clock.elapsedMs()).toBe(0);
    time += MINUTE;
    expect(clock.elapsedMs()).toBe(MINUTE);
  });

  it("resets while paused to zero and stays paused until resumed", () => {
    const clock = createActiveClock({ now });
    time += 4 * MINUTE;
    clock.pause();
    time += MINUTE;
    clock.reset();
    time += 6 * MINUTE;
    expect(clock.elapsedMs()).toBe(0);
    clock.resume();
    time += MINUTE;
    expect(clock.elapsedMs()).toBe(MINUTE);
  });

  it("reports the time at an explicit earlier instant, such as a grade's review time", () => {
    const clock = createActiveClock({ now });
    time += MINUTE;
    clock.pause();
    time += 6 * MINUTE;
    clock.resume();
    const reviewedAt = time + 2 * MINUTE;
    time = reviewedAt + 500;
    expect(clock.elapsedMs(reviewedAt)).toBe(3 * MINUTE);
    // An instant before the running segment began adds nothing to it.
    expect(clock.elapsedMs(reviewedAt - 10 * MINUTE)).toBe(MINUTE);
  });

  it("applies each change at the instant it is given", () => {
    const clock = createActiveClock({ now, running: false });
    clock.resume(time - 2 * MINUTE);
    clock.pause(time - MINUTE);
    expect(clock.elapsedMs()).toBe(MINUTE);
    clock.reset(time);
    clock.resume(time);
    expect(clock.elapsedMs(time + MINUTE)).toBe(MINUTE);
  });

  it("follows Date.now by default, so a test that replaces it moves the clock", () => {
    const spy = jest.spyOn(Date, "now").mockReturnValue(5_000);
    try {
      const clock = createActiveClock();
      spy.mockReturnValue(9_000);
      expect(clock.elapsedMs()).toBe(4_000);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("useActiveClock", () => {
  const appStateListeners = new Set<(state: AppStateStatus) => void>();
  // React Native's Jest mock leaves currentState as a function; the hook reads it as a state.
  const appState = AppState as { currentState: unknown };
  const mockedCurrentState = appState.currentState;
  // The same mock serves every test, so each test puts its default subscription back.
  const addListener = jest.mocked(AppState.addEventListener);
  const mockedAddListener = addListener.getMockImplementation();
  let time = 0;
  let nowSpy: jest.SpyInstance;
  let removals = 0;

  /** Change AppState as the platform does: the current state first, then the change event. */
  function setAppState(state: AppStateStatus) {
    appState.currentState = state;
    for (const listener of [...appStateListeners]) listener(state);
  }
  function setFocused(focused: boolean) {
    mockFocus.focused = focused;
    for (const listener of [...mockFocus.listeners]) listener();
  }

  beforeEach(() => {
    time = 1_000_000;
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => time);
    mockFocus.focused = true;
    mockFocus.listeners.clear();
    appStateListeners.clear();
    removals = 0;
    appState.currentState = "active";
    addListener.mockImplementation((_type, listener) => {
      appStateListeners.add(listener as (state: AppStateStatus) => void);
      return {
        remove: () => {
          removals += 1;
          appStateListeners.delete(listener as (state: AppStateStatus) => void);
        },
      } as ReturnType<typeof AppState.addEventListener>;
    });
  });
  afterEach(() => {
    nowSpy.mockRestore();
    if (mockedAddListener) addListener.mockImplementation(mockedAddListener);
    appState.currentState = mockedCurrentState;
  });

  it("pauses in the background and resumes without losing the earlier time", () => {
    const { result } = renderHook(() => useActiveClock());
    time += MINUTE;
    act(() => setAppState("background"));
    time += 6 * MINUTE;
    act(() => setAppState("active"));
    time += 2 * MINUTE;
    expect(result.current.elapsedMs()).toBe(3 * MINUTE);
  });

  it("pauses while iOS reports the app inactive", () => {
    const { result } = renderHook(() => useActiveClock());
    act(() => setAppState("inactive"));
    time += 6 * MINUTE;
    act(() => setAppState("active"));
    time += MINUTE;
    expect(result.current.elapsedMs()).toBe(MINUTE);
  });

  it("pauses while another screen covers this one, even when the app goes away and back meanwhile", () => {
    const { result } = renderHook(() => useActiveClock());
    time += MINUTE;
    act(() => setFocused(false));
    time += 2 * MINUTE;
    // An app resume while blurred does not start a screen that is not in front.
    act(() => setAppState("background"));
    act(() => setAppState("active"));
    time += 4 * MINUTE;
    act(() => setFocused(true));
    time += 2 * MINUTE;
    expect(result.current.elapsedMs()).toBe(3 * MINUTE);
  });

  it("starts paused when the app is in the background at mount", () => {
    appState.currentState = "background";
    const { result } = renderHook(() => useActiveClock());
    time += 6 * MINUTE;
    expect(result.current.elapsedMs()).toBe(0);
    act(() => setAppState("active"));
    time += MINUTE;
    expect(result.current.elapsedMs()).toBe(MINUTE);
  });

  it("starts paused when the screen is not focused at mount", () => {
    mockFocus.focused = false;
    const { result } = renderHook(() => useActiveClock());
    time += 6 * MINUTE;
    expect(result.current.elapsedMs()).toBe(0);
    act(() => setFocused(true));
    time += MINUTE;
    expect(result.current.elapsedMs()).toBe(MINUTE);
  });

  it("keeps one clock for the screen's lifetime and unsubscribes on unmount", () => {
    const { result, rerender, unmount } = renderHook(() => useActiveClock());
    const clock = result.current;
    act(() => setFocused(false));
    act(() => setFocused(true));
    rerender({});
    expect(result.current).toBe(clock);
    unmount();
    expect(appStateListeners.size).toBe(0);
    expect(removals).toBeGreaterThan(0);
  });

  it("runs when the platform has no AppState subscription, as on a web page without a visibility API", () => {
    addListener.mockReturnValueOnce(undefined as never);
    const { result, unmount } = renderHook(() => useActiveClock());
    time += MINUTE;
    expect(result.current.elapsedMs()).toBe(MINUTE);
    expect(() => unmount()).not.toThrow();
  });
});
