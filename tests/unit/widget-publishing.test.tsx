import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { emitReviewActivity } from "@/lib/fsrs/review-events";
import { deviceZoneKey } from "@/lib/habit/dates";
import { emitHabitChanged } from "@/lib/habit/use-habit-overview";
import { emitSyncCompleted } from "@/lib/sync/events";
import { loadWidgetInput } from "@/lib/widget/load";
import { publishWidget, requestWidgetRefresh, setWidgetPublishOptions } from "@/lib/widget/publish";
import type { WidgetBuildInput } from "@/lib/widget/timeline";
import { useWidgetPublishing } from "@/lib/widget/use-widget-publishing";

const mockDb = { name: "synthetic" };
let mockSupported = true;
let mockPlacementListener: (() => void) | null = null;
const mockPublish = jest.fn(async (_json: string) => ({ small: 1, medium: 0 }));
const mockClear = jest.fn(async () => undefined);
let mockSettings = { uiLanguage: "en", theme: "white", effectiveTheme: "white", isLoaded: true };
let mockUserId: string | null = null;
let mockToday = "2026-11-23";

jest.mock("@/lib/widget/platform", () => ({
  widgetPlatform: {
    get supported() {
      return mockSupported;
    },
    publish: (json: string) => mockPublish(json),
    clear: () => mockClear(),
    subscribePlacement: (listener: () => void) => {
      mockPlacementListener = listener;
      return () => {
        if (mockPlacementListener === listener) mockPlacementListener = null;
      };
    },
  },
}));
jest.mock("@/lib/database/provider", () => ({ useDatabaseStatus: () => ({ db: mockDb, isReady: true }) }));
jest.mock("@/lib/settings/context", () => ({ useSettings: () => mockSettings }));
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: (select: (state: { user: { id: string } | null }) => unknown) =>
    select({ user: mockUserId ? { id: mockUserId } : null }),
}));
jest.mock("@/lib/habit/use-day-boundary", () => ({ useLocalToday: () => mockToday }));
jest.mock("@/lib/habit/dates", () => ({
  ...jest.requireActual<object>("@/lib/habit/dates"),
  deviceZoneKey: jest.fn(() => "Asia/Riyadh|-180"),
}));
jest.mock("@/lib/widget/load", () => ({ loadWidgetInput: jest.fn() }));
jest.mock("@/lib/widget/publish", () => {
  const actual = jest.requireActual<typeof import("@/lib/widget/publish")>("@/lib/widget/publish");
  return {
    ...actual,
    publishWidget: jest.fn(async () => ({ status: "published" })),
    setWidgetPublishOptions: jest.fn(),
  };
});

const actualPublish = jest.requireActual<typeof import("@/lib/widget/publish")>("@/lib/widget/publish");

let appStateListener: ((state: AppStateStatus) => void) | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  mockSupported = true;
  mockSettings = { uiLanguage: "en", theme: "white", effectiveTheme: "white", isLoaded: true };
  mockUserId = null;
  mockToday = "2026-11-23";
  jest.mocked(publishWidget).mockClear();
  jest.mocked(setWidgetPublishOptions).mockClear();
  jest.mocked(loadWidgetInput).mockReset();
  mockPublish.mockClear();
  mockClear.mockClear();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: () => (appStateListener = null) } as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function mount() {
  const hook = renderHook(() => useWidgetPublishing());
  jest.mocked(publishWidget).mockClear();
  return hook;
}

describe("useWidgetPublishing triggers (spec 6.5)", () => {
  it("publishes on start with the app's language and theme", () => {
    renderHook(() => useWidgetPublishing());
    expect(setWidgetPublishOptions).toHaveBeenCalledWith({
      language: "en",
      themeMode: "white",
      effectiveTheme: "white",
    });
    expect(publishWidget).toHaveBeenCalledTimes(1);
  });

  it("republishes when the language, theme, account or day changes", () => {
    const hook = mount();
    for (const change of [
      () => (mockSettings = { ...mockSettings, uiLanguage: "ar" }),
      () => (mockSettings = { ...mockSettings, theme: "system", effectiveTheme: "dark" }),
      () => (mockUserId = "synthetic-user"),
      () => (mockToday = "2026-11-24"),
    ]) {
      jest.mocked(publishWidget).mockClear();
      change();
      hook.rerender({});
      expect(publishWidget).toHaveBeenCalledTimes(1);
    }
    expect(setWidgetPublishOptions).toHaveBeenLastCalledWith({
      language: "ar",
      themeMode: "system",
      effectiveTheme: "dark",
    });
  });

  it("publishes on return to the foreground and on going to the background", () => {
    mount();
    act(() => appStateListener!("active"));
    expect(publishWidget).toHaveBeenCalledTimes(1);
    act(() => appStateListener!("background"));
    expect(publishWidget).toHaveBeenCalledTimes(2);
  });

  it("debounces reviews and habit changes by 1500 ms", () => {
    mount();
    act(() => {
      emitReviewActivity();
      emitHabitChanged();
    });
    act(() => jest.advanceTimersByTime(1499));
    expect(publishWidget).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(publishWidget).toHaveBeenCalledTimes(1);
  });

  it("flushes a pending debounce when Hafiz goes to the background", () => {
    mount();
    act(() => emitReviewActivity());
    act(() => appStateListener!("background"));
    expect(publishWidget).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(2000));
    expect(publishWidget).toHaveBeenCalledTimes(1);
  });

  it("asks for a celebration after any day earned here, but not after a grade that earned nothing", () => {
    mount();
    act(() => emitReviewActivity({ kind: "none" }));
    act(() => appStateListener!("background"));
    expect(publishWidget).toHaveBeenLastCalledWith(mockDb, undefined);
    for (const wird of [
      { kind: "minimum_met", length: 5 },
      { kind: "made_up", madeUpDay: "2026-11-22", length: 6 },
      { kind: "earned_back", length: 13, restoredDays: 2 },
    ] as const) {
      act(() => emitReviewActivity(wird));
      act(() => appStateListener!("background"));
      expect(publishWidget).toHaveBeenLastCalledWith(mockDb, expect.objectContaining({ aborted: false }));
    }
  });

  it("carries a locally earned milestone through foreground refreshes and consumes it on one background", () => {
    mount();
    act(() => emitReviewActivity({ kind: "minimum_met", length: 7 }));
    act(() => jest.advanceTimersByTime(1500));
    expect(publishWidget).toHaveBeenLastCalledWith(mockDb);
    act(() => appStateListener!("background"));
    expect(publishWidget).toHaveBeenLastCalledWith(mockDb, expect.objectContaining({ aborted: false }));
    act(() => appStateListener!("background"));
    expect(publishWidget).toHaveBeenLastCalledWith(mockDb, undefined);
  });

  it("discards a pending milestone on account restore and on a change of owner", () => {
    const hook = mount();
    act(() => emitReviewActivity({ kind: "minimum_met", length: 7 }));
    act(() => emitSyncCompleted({ pushed: 0, pulled: 1, accountRestored: true }));
    act(() => appStateListener!("background"));
    expect(publishWidget).toHaveBeenLastCalledWith(mockDb, undefined);
    act(() => emitReviewActivity({ kind: "minimum_met", length: 7 }));
    mockUserId = "second-synthetic-user";
    hook.rerender({});
    act(() => appStateListener!("background"));
    expect(publishWidget).toHaveBeenLastCalledWith(mockDb, undefined);
  });

  it("publishes after a sync with new data, and not after one without", () => {
    mount();
    act(() => emitSyncCompleted({ pushed: 3, pulled: 0 }));
    expect(publishWidget).not.toHaveBeenCalled();
    for (const summary of [
      { pushed: 0, pulled: 2 },
      { pushed: 0, pulled: 0, localDataReplaced: true },
      { pushed: 0, pulled: 0, accountRestored: true },
      { pushed: 0, pulled: 0, restoreCompleted: true },
    ]) {
      jest.mocked(publishWidget).mockClear();
      act(() => emitSyncCompleted(summary));
      expect(publishWidget).toHaveBeenCalledTimes(1);
    }
  });

  it("publishes on a Show numbers change and when a widget is placed or removed", () => {
    mount();
    act(() => requestWidgetRefresh());
    expect(publishWidget).toHaveBeenCalledTimes(1);
    act(() => mockPlacementListener!());
    expect(publishWidget).toHaveBeenCalledTimes(2);
  });

  it("publishes after a time zone change while open", () => {
    mount();
    act(() => jest.advanceTimersByTime(60_000));
    expect(publishWidget).not.toHaveBeenCalled();
    jest.mocked(deviceZoneKey).mockReturnValue("Europe/London|0");
    act(() => jest.advanceTimersByTime(60_000));
    expect(publishWidget).toHaveBeenCalledTimes(1);
    jest.mocked(deviceZoneKey).mockReturnValue("Asia/Riyadh|-180");
  });

  it("does nothing where the widget is unsupported", () => {
    mockSupported = false;
    renderHook(() => useWidgetPublishing());
    act(() => {
      emitReviewActivity();
      requestWidgetRefresh();
      jest.advanceTimersByTime(5000);
    });
    expect(publishWidget).not.toHaveBeenCalled();
    expect(mockPlacementListener).toBeNull();
  });
});

/** A begin-state input for the real builder, in the requested language. */
function stubInput(language: "en" | "ar", now: Date): WidgetBuildInput {
  const clock = {
    at: (date: string, minutes: number) => new Date(Date.parse(`${date}T00:00:00Z`) + minutes * 60_000),
    dateOf: (at: Date) => at.toISOString().slice(0, 10),
    minutesOf: (at: Date) => at.getUTCHours() * 60 + at.getUTCMinutes(),
    weekdayOf: (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(),
  };
  return {
    now,
    clock,
    timeZone: "UTC",
    habit: { days: [], pause: null },
    prayers: () => null,
    eveningStartsAt: (date) => clock.at(date, 21 * 60),
    plan: { date: clock.dateOf(now), plan: "none", reviewLeft: false, pagesLeft: 0, minutesLeft: 0, moreDueAt: null },
    language,
    appearance: { colorMode: "system" },
    showZayt: true,
    showNumbers: true,
    todayFinishedAt: null,
  };
}

describe("publishWidget (spec 6.4)", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  it("coalesces overlapping calls into one queued run that uses the latest options", async () => {
    const loads: { language: string; resolve: () => void }[] = [];
    jest.mocked(loadWidgetInput).mockImplementation(
      (_db, options) =>
        new Promise((resolve) => {
          loads.push({ language: options.language, resolve: () => resolve(stubInput(options.language, options.now)) });
        }),
    );
    const db = mockDb as never;
    actualPublish.setWidgetPublishOptions({ language: "en", themeMode: "system", effectiveTheme: "white" });
    const first = actualPublish.publishWidget(db);
    expect(actualPublish.publishWidget(db)).toBe(first);
    await Promise.resolve();
    await Promise.resolve();
    expect(loads).toHaveLength(1);

    const second = actualPublish.publishWidget(db);
    const third = actualPublish.publishWidget(db);
    expect(third).toBe(second);
    actualPublish.setWidgetPublishOptions({ language: "ar", themeMode: "system", effectiveTheme: "dark" });

    loads[0].resolve();
    await expect(first).resolves.toEqual({ status: "published", placement: { small: 1, medium: 0 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loads).toHaveLength(2);
    expect(loads[1].language).toBe("ar");
    loads[1].resolve();
    await expect(second).resolves.toMatchObject({ status: "published" });
    expect(loads).toHaveLength(2);
    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockPublish.mock.calls[1][0]).language).toBe("ar");
  });

  it("drops a milestone publication if its owner changes while the timeline is loading", async () => {
    const owner = new AbortController();
    jest.mocked(loadWidgetInput).mockImplementation(async (_db, options) => {
      owner.abort();
      return stubInput(options.language, options.now);
    });
    actualPublish.setWidgetPublishOptions({ language: "en", themeMode: "white", effectiveTheme: "white" });
    await expect(actualPublish.publishWidget(mockDb as never, owner.signal)).resolves.toEqual({ status: "waiting" });
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  });

  it("clears the widget instead of leaving a stale one when loading fails, and logs no content", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.mocked(loadWidgetInput).mockRejectedValue(new Error("synthetic failure"));
    actualPublish.setWidgetPublishOptions({ language: "en", themeMode: "white", effectiveTheme: "white" });
    await expect(actualPublish.publishWidget(mockDb as never)).resolves.toEqual({ status: "failed" });
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockPublish).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[Widget] Could not publish:", expect.any(Error));
  });

  it("never loads or builds where the widget is unsupported", async () => {
    mockSupported = false;
    await expect(actualPublish.publishWidget(mockDb as never)).resolves.toEqual({ status: "unsupported" });
    expect(loadWidgetInput).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
