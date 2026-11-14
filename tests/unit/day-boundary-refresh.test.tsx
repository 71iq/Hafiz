import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import type { AppDatabase } from "@/lib/database/types";
import type { DhuhrResolver } from "@/lib/habit/cutoff";
import { atLocalTime, localDateOf } from "@/lib/habit/dates";
import { loadHabitOverview, settleHabitDays } from "@/lib/habit/queries";
import { useHabitOverview } from "@/lib/habit/use-habit-overview";
import { countMistakeInbox } from "@/lib/hifz/errors";
import { loadTodayWird } from "@/lib/hifz/pages";
import { monthlyCheckDueFor } from "@/lib/hifz/progress";
import { countDueRemediation } from "@/lib/hifz/remediation";
import { useTodayWird } from "@/lib/hifz/use-today-wird";
import { readDhuhrResolver } from "@/lib/prayer/settings";

/** Focus for useFocusEffect, which the test can take away and give back like a screen pushed on top. */
const mockFocus = { focused: true, listeners: new Set<(focused: boolean) => void>() };
jest.mock("@react-navigation/native", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      React.useEffect(() => {
        let cleanup: (() => void) | null = null;
        const apply = (focused: boolean) => {
          if (focused && !cleanup) cleanup = effect() ?? (() => undefined);
          else if (!focused && cleanup) {
            cleanup();
            cleanup = null;
          }
        };
        apply(mockFocus.focused);
        mockFocus.listeners.add(apply);
        return () => {
          mockFocus.listeners.delete(apply);
          cleanup?.();
        };
      }, [effect]);
    },
  };
});
jest.mock("@/lib/habit/queries", () => ({ settleHabitDays: jest.fn(), loadHabitOverview: jest.fn() }));
jest.mock("@/lib/prayer/settings", () => ({ readDhuhrResolver: jest.fn() }));
jest.mock("@/lib/hifz/pages", () => ({ loadTodayWird: jest.fn() }));
jest.mock("@/lib/hifz/errors", () => ({ countMistakeInbox: jest.fn() }));
jest.mock("@/lib/hifz/remediation", () => ({ countDueRemediation: jest.fn() }));
jest.mock("@/lib/hifz/progress", () => ({ monthlyCheckDueFor: jest.fn() }));

const db = {} as AppDatabase;
const NO_PRAYER_TIMES: DhuhrResolver = () => null;

/** 21:00 on 14 November, local time: today's wird is done and the app is on Home. */
const EVENING = new Date(2026, 10, 14, 21, 0);
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes);

const appStateListeners = new Set<(state: AppStateStatus) => void>();
let appStateRemovals = 0;
// React Native's Jest mock leaves currentState as a function; the hook reads it as a state.
const appState = AppState as { currentState: unknown };
const mockedCurrentState = appState.currentState;
/** Change AppState as the platform does: the current state first, then the change event. */
function setAppState(state: AppStateStatus) {
  appState.currentState = state;
  for (const listener of [...appStateListeners]) listener(state);
}

function setFocused(focused: boolean) {
  mockFocus.focused = focused;
  for (const listener of [...mockFocus.listeners]) listener(focused);
}

/** Let the hook's chained loads settle. */
async function flush() {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  });
}

async function advanceTo(time: Date) {
  await act(async () => {
    jest.advanceTimersByTime(time.getTime() - Date.now());
  });
  await flush();
}

/** The app goes to the background, the device sleeps until `time`, and the app comes back. */
async function resumeAt(time: Date, { timersRun }: { timersRun: boolean }) {
  await act(async () => setAppState("background"));
  // Native suspends JS timers in the background; a web tab keeps them running, throttled.
  if (timersRun) await advanceTo(time);
  else jest.setSystemTime(time);
  await act(async () => setAppState("active"));
  await flush();
}

/** The renderer leaves an immediate timer behind; past it, any timer left is the hook's boundary timer. */
function expectNoBoundaryTimer() {
  act(() => {
    jest.advanceTimersByTime(1);
  });
  expect(jest.getTimerCount()).toBe(0);
}

const overviewLoads = () => jest.mocked(loadHabitOverview).mock.calls.length;
const wirdLoads = () => jest.mocked(loadTodayWird).mock.calls.length;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(EVENING);
  jest.clearAllMocks();
  mockFocus.focused = true;
  mockFocus.listeners.clear();
  appStateListeners.clear();
  appStateRemovals = 0;
  appState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListeners.add(listener as (state: AppStateStatus) => void);
    return {
      remove: () => {
        appStateRemovals += 1;
        appStateListeners.delete(listener as (state: AppStateStatus) => void);
      },
    } as ReturnType<typeof AppState.addEventListener>;
  });
  jest.mocked(readDhuhrResolver).mockResolvedValue(NO_PRAYER_TIMES);
  jest.mocked(settleHabitDays).mockResolvedValue([]);
  // The overview stands in for "done today": it names the local day it was loaded for.
  jest
    .mocked(loadHabitOverview)
    .mockImplementation(async (_db, options) => ({ loadedFor: localDateOf(options?.now ?? new Date()) }) as never);
  jest
    .mocked(loadTodayWird)
    .mockImplementation(async (_db, now = new Date()) => ({ loadedFor: localDateOf(now), cards: [] }) as never);
  jest.mocked(countMistakeInbox).mockResolvedValue(0);
  jest.mocked(countDueRemediation).mockResolvedValue(0);
  jest.mocked(monthlyCheckDueFor).mockResolvedValue(false);
});

afterEach(() => {
  appState.currentState = mockedCurrentState;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const loadedFor = (value: unknown) => (value as { loadedFor: string } | null | undefined)?.loadedFor;

describe("useHabitOverview across a day boundary", () => {
  it("reloads when the app returns to the foreground the next day, so yesterday's done state does not stay", async () => {
    const { result } = renderHook(() => useHabitOverview(db));
    await flush();
    expect(loadedFor(result.current.overview)).toBe("2026-11-14");
    await resumeAt(at(15, 7), { timersRun: false });
    expect(loadedFor(result.current.overview)).toBe("2026-11-15");
    expect(overviewLoads()).toBe(2);
  });

  it("reloads once when a boundary passed in the background, not for the boundary and the resume both", async () => {
    const { result } = renderHook(() => useHabitOverview(db));
    await flush();
    await resumeAt(at(15, 7), { timersRun: true });
    expect(loadedFor(result.current.overview)).toBe("2026-11-15");
    expect(overviewLoads()).toBe(2);
    expect(settleHabitDays).toHaveBeenCalledTimes(2);
  });

  it("reloads at local midnight while open, then at the 12:30 make-up cutoff without prayer times", async () => {
    const { result } = renderHook(() => useHabitOverview(db));
    await flush();
    await advanceTo(new Date(at(15, 0).getTime() - 1));
    expect(overviewLoads()).toBe(1);
    await advanceTo(at(15, 0));
    expect(overviewLoads()).toBe(2);
    expect(loadedFor(result.current.overview)).toBe("2026-11-15");
    await advanceTo(at(15, 12, 29));
    expect(overviewLoads()).toBe(2);
    await advanceTo(at(15, 12, 30));
    expect(overviewLoads()).toBe(3);
  });

  it("reloads at Dhuhr, read once per load from the saved prayer location", async () => {
    const dhuhr: DhuhrResolver = (date) => atLocalTime(date, 12 * 60 + 5);
    jest.mocked(readDhuhrResolver).mockResolvedValue(dhuhr);
    renderHook(() => useHabitOverview(db));
    await flush();
    await advanceTo(at(15, 0));
    expect(overviewLoads()).toBe(2);
    await advanceTo(at(15, 12, 5));
    expect(overviewLoads()).toBe(3);
    expect(readDhuhrResolver).toHaveBeenCalledTimes(3);
    expect(settleHabitDays).toHaveBeenLastCalledWith(db, expect.objectContaining({ dhuhr }));
    expect(loadHabitOverview).toHaveBeenLastCalledWith(db, expect.objectContaining({ dhuhr }));
  });

  it("leaves a screen behind another to reload on focus, not on resume", async () => {
    const { result } = renderHook(() => useHabitOverview(db));
    await flush();
    await act(async () => setFocused(false));
    await resumeAt(at(15, 7), { timersRun: false });
    expect(overviewLoads()).toBe(1);
    await act(async () => setFocused(true));
    await flush();
    expect(overviewLoads()).toBe(2);
    expect(loadedFor(result.current.overview)).toBe("2026-11-15");
  });

  it("clears its timer and AppState listener on unmount", async () => {
    const { unmount } = renderHook(() => useHabitOverview(db));
    await flush();
    expect(appStateListeners.size).toBe(1);
    unmount();
    expect(appStateListeners.size).toBe(0);
    expect(appStateRemovals).toBeGreaterThan(0);
    expectNoBoundaryTimer();
    await advanceTo(at(15, 13));
    expect(overviewLoads()).toBe(1);
  });
});

describe("useTodayWird across a day boundary", () => {
  it("reloads when the app returns to the foreground the next day, so yesterday's empty list does not hide today's review", async () => {
    const { result } = renderHook(() => useTodayWird(db));
    await flush();
    expect(loadedFor(result.current.wird)).toBe("2026-11-14");
    await resumeAt(at(15, 7), { timersRun: true });
    expect(loadedFor(result.current.wird)).toBe("2026-11-15");
    expect(wirdLoads()).toBe(2);
  });

  it("reloads at local midnight while open, and not at the make-up cutoff", async () => {
    const { result } = renderHook(() => useTodayWird(db));
    await flush();
    await advanceTo(at(15, 0));
    expect(wirdLoads()).toBe(2);
    expect(loadedFor(result.current.wird)).toBe("2026-11-15");
    await advanceTo(at(15, 23, 59));
    expect(wirdLoads()).toBe(2);
    await advanceTo(at(16, 0));
    expect(wirdLoads()).toBe(3);
  });

  it("clears its timer and AppState listener on unmount", async () => {
    const { unmount } = renderHook(() => useTodayWird(db));
    await flush();
    unmount();
    expect(appStateListeners.size).toBe(0);
    expectNoBoundaryTimer();
    await advanceTo(at(16, 1));
    expect(wirdLoads()).toBe(1);
  });
});
