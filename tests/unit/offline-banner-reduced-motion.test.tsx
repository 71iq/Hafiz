import React from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { act, cleanup, render } from "@testing-library/react-native";
import { OfflineBanner } from "@/components/ui/OfflineBanner";

const OFFLINE_TEXT = {
  en: "You\u2019re offline \u2014 study features work, community features will sync when connected",
  ar: "\u0623\u0646\u062a \u063a\u064a\u0631 \u0645\u062a\u0635\u0644 \u2014 \u0645\u064a\u0632\u0627\u062a \u0627\u0644\u062f\u0631\u0627\u0633\u0629 \u062a\u0639\u0645\u0644\u060c \u0627\u0644\u0645\u064a\u0632\u0627\u062a \u0627\u0644\u0627\u062c\u062a\u0645\u0627\u0639\u064a\u0629 \u0633\u062a\u062a\u0645 \u0645\u0632\u0627\u0645\u0646\u062a\u0647\u0627 \u0639\u0646\u062f \u0627\u0644\u0627\u062a\u0635\u0627\u0644",
};

const mockSettings = {
  effectiveTheme: "beige" as const,
  themeColors: { surfaceHigh: "#E8E1DA" },
};
let mockNetInfo: { isConnected: boolean | null } = { isConnected: null };

jest.mock("@react-native-community/netinfo", () => ({
  useNetInfo: () => mockNetInfo,
}));

jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => mockSettings };
});

type ScheduledGroup = {
  animations: Animated.CompositeAnimation[];
  start: jest.Mock;
  stop: jest.Mock;
  reset: jest.Mock;
  callback?: Animated.EndCallback;
};

type MockCompositeAnimation = Animated.CompositeAnimation & {
  start: jest.Mock;
  stop: jest.Mock;
  reset: jest.Mock;
};

type ScheduledTiming = {
  animation: MockCompositeAnimation;
  config: Parameters<typeof Animated.timing>[1];
  callback?: Animated.EndCallback;
};

function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

const originalParallel = Animated.parallel;
const originalListener = Object.getOwnPropertyDescriptor(AccessibilityInfo, "addEventListener");
let preferenceQuery: ReturnType<typeof deferred>;
let preferenceChanged: (value: boolean) => void;
let preferenceRemove: jest.Mock;
let groups: ScheduledGroup[];
let timings: ScheduledTiming[];
let setValue: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockNetInfo = { isConnected: null };
  preferenceQuery = deferred();
  preferenceChanged = () => {
    throw new Error("The reduced-motion listener was not installed");
  };
  preferenceRemove = jest.fn();
  groups = [];
  timings = [];

  Object.defineProperty(AccessibilityInfo, "addEventListener", {
    configurable: true,
    writable: true,
    value: jest.fn((event: string, handler: (value: boolean) => void) => {
      expect(event).toBe("reduceMotionChanged");
      preferenceChanged = handler;
      return { remove: preferenceRemove };
    }),
  });
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(preferenceQuery.promise);
  setValue = jest.spyOn(Animated.Value.prototype, "setValue");
  jest.spyOn(Animated, "timing").mockImplementation((_value, config) => {
    const animation: MockCompositeAnimation = {
      start: jest.fn(),
      stop: jest.fn(),
      reset: jest.fn(),
    };
    const timing: ScheduledTiming = { animation, config };
    animation.start.mockImplementation((callback?: Animated.EndCallback) => {
      timing.callback = callback;
    });
    timings.push(timing);
    return animation;
  });
  jest.spyOn(Animated, "parallel").mockImplementation((animations) => {
    const parallel = originalParallel(animations);
    const group: ScheduledGroup = {
      animations,
      start: jest.fn(),
      stop: jest.fn(),
      reset: jest.fn(),
    };
    group.start.mockImplementation((callback?: Animated.EndCallback) => {
      group.callback = callback;
      parallel.start(callback);
    });
    group.stop.mockImplementation(() => parallel.stop());
    group.reset.mockImplementation(() => parallel.reset());
    groups.push(group);
    return group;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  if (!originalListener) throw new Error("Missing original AccessibilityInfo listener descriptor");
  Object.defineProperty(AccessibilityInfo, "addEventListener", originalListener);
});

async function resolvePreference(value: boolean) {
  await act(async () => {
    preferenceQuery.resolve(value);
  });
}

function renderBanner(isConnected: boolean | null, uiLanguage: "en" | "ar" = "en") {
  mockNetInfo = { isConnected };
  return render(<OfflineBanner uiLanguage={uiLanguage} />);
}

function rerenderConnection(view: ReturnType<typeof render>, isConnected: boolean) {
  mockNetInfo = { isConnected };
  view.rerender(<OfflineBanner uiLanguage="en" />);
}

it.each([
  [false, 0, 1],
  [true, -80, 0],
] as const)("starts connectivity %s at its static endpoint while preference is unknown", (connected, y, opacity) => {
  const view = renderBanner(connected);
  expect(view.getByText(OFFLINE_TEXT.en)).toBeTruthy();
  expect(groups).toHaveLength(0);
  expect(setValue.mock.calls.slice(-2)).toEqual([[y], [opacity]]);
});

it.each([
  [false, 0, 1],
  [true, -80, 0],
] as const)("keeps connectivity %s static after initial reduced preference resolves", async (connected, y, opacity) => {
  renderBanner(connected);
  await resolvePreference(true);
  expect(groups).toHaveLength(0);
  expect(setValue.mock.calls.slice(-2)).toEqual([[y], [opacity]]);
});

it("snaps each connectivity reversal to the newest target while motion stays reduced", async () => {
  const view = renderBanner(false);
  await resolvePreference(true);
  rerenderConnection(view, true);
  expect(setValue.mock.calls.slice(-2)).toEqual([[-80], [0]]);
  rerenderConnection(view, false);
  expect(setValue.mock.calls.slice(-2)).toEqual([[0], [1]]);
  expect(groups).toHaveLength(0);
});

it("keeps null connectivity unrendered while resolving the current hidden endpoints", () => {
  const view = renderBanner(null);

  expect(view.queryByText(OFFLINE_TEXT.en)).toBeNull();
  expect(view.queryByText(OFFLINE_TEXT.ar)).toBeNull();
  expect(groups).toHaveLength(0);
  expect(setValue.mock.calls.map(([value]) => value)).toEqual(expect.arrayContaining([-80, 0]));
});

it.each([
  ["show", false, 0, 1, 300],
  ["hide", true, -80, 0, 250],
] as const)(
  "uses the existing %s transition with native driver",
  async (_label, isConnected, translateY, opacity, duration) => {
    renderBanner(isConnected);
    await resolvePreference(false);

    expect(groups).toHaveLength(1);
    expect(groups[0].start).toHaveBeenCalledTimes(1);
    expect(timings.map(({ config }) => config)).toEqual([
      expect.objectContaining({ toValue: translateY, duration, useNativeDriver: true }),
      expect.objectContaining({ toValue: opacity, duration, useNativeDriver: true }),
    ]);
  },
);

it("snaps both values and stops the active show transition when motion is reduced live", async () => {
  renderBanner(false);
  await resolvePreference(false);
  expect(groups).toHaveLength(1);

  act(() => preferenceChanged(true));

  expect(groups[0].stop).toHaveBeenCalledTimes(1);
  expect(setValue.mock.calls.slice(-2)).toEqual([[0], [1]]);
  expect(groups).toHaveLength(1);
});

it("snaps both values and stops the active hide transition when motion is reduced live", async () => {
  const view = renderBanner(false);
  await resolvePreference(false);
  rerenderConnection(view, true);
  expect(groups).toHaveLength(2);

  act(() => preferenceChanged(true));

  expect(groups[1].stop).toHaveBeenCalledTimes(1);
  expect(setValue.mock.calls.slice(-2)).toEqual([[-80], [0]]);
});

it("starts the current transition after a later opt-in with the latest connectivity target", async () => {
  const view = renderBanner(false);
  act(() => preferenceChanged(true));
  expect(groups).toHaveLength(0);

  await act(async () => preferenceChanged(false));

  expect(groups).toHaveLength(1);
  expect(timings.map(({ config }) => config.duration)).toEqual([300, 300]);
  view.unmount();
});

it("retains the newest offline transition after delayed completion of a stopped hide", async () => {
  const view = renderBanner(false);
  await resolvePreference(false);
  rerenderConnection(view, true);
  rerenderConnection(view, false);
  expect(groups).toHaveLength(3);
  expect(groups[0].stop).toHaveBeenCalledTimes(1);
  expect(groups[1].stop).toHaveBeenCalledTimes(1);
  expect(timings[2].animation.stop).toHaveBeenCalledTimes(1);
  expect(timings[3].animation.stop).toHaveBeenCalledTimes(1);

  // Deliver real parallel child callbacks after their group was stopped.
  const delayedHide = timings.slice(2, 4);
  for (const timing of delayedHide) {
    const complete = timing.callback;
    if (!complete) throw new Error("Missing native timing completion callback");
    act(() => complete({ finished: true }));
  }
  expect(groups[2].stop).not.toHaveBeenCalled();
  rerenderConnection(view, true);
  expect(groups).toHaveLength(4);
  expect(timings.slice(-2).map(({ config }) => config.toValue)).toEqual([-80, 0]);
  rerenderConnection(view, false);
  expect(groups).toHaveLength(5);
  expect(timings.slice(-2).map(({ config }) => config.toValue)).toEqual([0, 1]);
  expect(groups[4].start).toHaveBeenCalledTimes(1);
  expect(groups[4].stop).not.toHaveBeenCalled();
});

it("stops the exact transition group on unmount", async () => {
  const view = renderBanner(true);
  await resolvePreference(false);
  view.unmount();

  expect(groups).toHaveLength(1);
  expect(groups[0].stop).toHaveBeenCalledTimes(1);
  expect(timings.every(({ animation }) => animation.stop.mock.calls.length === 1)).toBe(true);
});

it.each([
  ["en", OFFLINE_TEXT.en, "row", "ltr", "left"],
  ["ar", OFFLINE_TEXT.ar, "row-reverse", "rtl", "right"],
] as const)(
  "preserves %s presentation, direction and pointer behavior",
  (uiLanguage, text, flexDirection, writingDirection, textAlign) => {
    const view = renderBanner(true, uiLanguage);
    const banner = view.UNSAFE_getByType(Animated.View);
    const label = view.getByText(text);
    const row = view
      .UNSAFE_getAllByType(View)
      .find((node) => node.props.className === "mx-4 mt-2 rounded-xl px-3 py-2.5");

    expect(banner.props.pointerEvents).toBe("none");
    expect(StyleSheet.flatten(banner.props.style)).toEqual(
      expect.objectContaining({ position: "absolute", top: 0, left: 0, right: 0, zIndex: 50 }),
    );
    expect(row).toBeDefined();
    expect(row?.props.style).toEqual(
      expect.objectContaining({
        backgroundColor: "rgba(253,220,145,0.15)",
        flexDirection,
        alignItems: "center",
        gap: 8,
      }),
    );
    expect(label.props.style).toEqual(
      expect.objectContaining({
        fontFamily: "Manrope_500Medium",
        fontSize: 12,
        color: "#8a7058",
        writingDirection,
        textAlign,
        flex: 1,
      }),
    );
  },
);
