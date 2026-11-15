import React from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { act, cleanup, render } from "@testing-library/react-native";
import { OFFLINE_FADE_MS, OFFLINE_UNREACHABLE_DELAY_MS, OfflineBanner } from "@/components/ui/OfflineBanner";
import { strings } from "@/lib/i18n/strings";
import { warningColors } from "@/lib/ui/theme-icons";

type NetSnapshot = { isConnected: boolean | null; isInternetReachable?: boolean | null };
const mockSettings = { effectiveTheme: "beige" as const };
let mockNetInfo: NetSnapshot = { isConnected: null, isInternetReachable: null };

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
jest.mock("@react-native-community/netinfo", () => ({ useNetInfo: () => mockNetInfo }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => mockSettings };
});

const originalListener = Object.getOwnPropertyDescriptor(AccessibilityInfo, "addEventListener");
let resolvePreference: (value: boolean) => void;
let timing: jest.SpyInstance;
let setValue: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  mockNetInfo = { isConnected: null, isInternetReachable: null };
  Object.defineProperty(AccessibilityInfo, "addEventListener", {
    configurable: true,
    writable: true,
    value: jest.fn(() => ({ remove: jest.fn() })),
  });
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(
    new Promise<boolean>((resolve) => {
      resolvePreference = resolve;
    }),
  );
  setValue = jest.spyOn(Animated.Value.prototype, "setValue");
  timing = jest
    .spyOn(Animated, "timing")
    .mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }));
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (originalListener) Object.defineProperty(AccessibilityInfo, "addEventListener", originalListener);
});

function renderBanner(net: NetSnapshot, uiLanguage: "en" | "ar" = "en") {
  mockNetInfo = net;
  return render(<OfflineBanner uiLanguage={uiLanguage} />);
}

function update(view: ReturnType<typeof render>, net: NetSnapshot) {
  mockNetInfo = net;
  view.rerender(<OfflineBanner uiLanguage="en" />);
}

it.each([
  { isConnected: null, isInternetReachable: null },
  { isConnected: true, isInternetReachable: null },
  { isConnected: true, isInternetReachable: undefined },
  { isConnected: true, isInternetReachable: true },
])("treats %o as not offline, even after waiting", (net) => {
  const view = renderBanner(net);
  act(() => jest.advanceTimersByTime(OFFLINE_UNREACHABLE_DELAY_MS * 2));
  expect(view.queryByText(strings.en.offlineBanner)).toBeNull();
});

it("shows at once when the device reports no connection", () => {
  const view = renderBanner({ isConnected: false, isInternetReachable: null });
  expect(view.getByText(strings.en.offlineBanner)).toBeTruthy();
});

it("waits three continuous seconds of confirmed unreachable internet (captive portal)", () => {
  const view = renderBanner({ isConnected: true, isInternetReachable: false });
  act(() => jest.advanceTimersByTime(OFFLINE_UNREACHABLE_DELAY_MS - 1));
  expect(view.queryByText(strings.en.offlineBanner)).toBeNull();
  act(() => jest.advanceTimersByTime(1));
  expect(view.getByText(strings.en.offlineBanner)).toBeTruthy();
  update(view, { isConnected: true, isInternetReachable: true });
  expect(view.queryByText(strings.en.offlineBanner)).toBeNull();
});

it("restarts the three seconds when reachability flaps back before it elapses", () => {
  const view = renderBanner({ isConnected: true, isInternetReachable: false });
  act(() => jest.advanceTimersByTime(2000));
  update(view, { isConnected: true, isInternetReachable: null });
  update(view, { isConnected: true, isInternetReachable: false });
  act(() => jest.advanceTimersByTime(2000));
  expect(view.queryByText(strings.en.offlineBanner)).toBeNull();
  act(() => jest.advanceTimersByTime(1000));
  expect(view.getByText(strings.en.offlineBanner)).toBeTruthy();
});

it("snaps visible while reduced motion is unknown or on, and fades over 200ms when allowed", async () => {
  const reduced = renderBanner({ isConnected: false });
  expect(timing).not.toHaveBeenCalled();
  expect(setValue).toHaveBeenLastCalledWith(1);
  reduced.unmount();

  const view = renderBanner({ isConnected: false });
  await act(async () => resolvePreference(false));
  expect(timing).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ toValue: 1, duration: OFFLINE_FADE_MS, useNativeDriver: true }),
  );
  view.unmount();
});

it.each([
  ["en", "row", "ltr"],
  ["ar", "row-reverse", "rtl"],
] as const)(
  "%s banner takes layout space with warning tokens and direction",
  (uiLanguage, flexDirection, writingDirection) => {
    const view = renderBanner({ isConnected: false }, uiLanguage);
    const banner = view.UNSAFE_getByType(Animated.View);
    const style = StyleSheet.flatten(banner.props.style);
    expect(style.position).toBeUndefined();
    expect(banner.props.pointerEvents).toBe("none");
    const colors = warningColors("beige");
    const row = view
      .UNSAFE_getAllByType(View)
      .find((node) => node.props.className === "mx-4 mt-2 rounded-xl px-3 py-2.5");
    expect(row?.props.style).toEqual(expect.objectContaining({ backgroundColor: colors.surface, flexDirection }));
    expect(view.getByText(strings[uiLanguage].offlineBanner).props.style).toEqual(
      expect.objectContaining({ color: colors.text, writingDirection }),
    );
  },
);
