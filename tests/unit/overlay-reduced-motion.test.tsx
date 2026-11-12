import React from "react";
import { AccessibilityInfo, Animated, Modal, Text } from "react-native";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react-native";
import { ResponsiveOverlay } from "@/components/ui/ResponsiveOverlay";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);

jest.mock("@/lib/ui/direction", () => ({
  ...jest.requireActual("@/lib/ui/direction"),
  useUIDirection: (dir?: "rtl" | "ltr") => dir ?? "ltr",
}));

jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({ themeSurface: "#fdf8f1" }),
}));

function deferred() {
  let resolve!: (value: boolean) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<boolean>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const originalListener = Object.getOwnPropertyDescriptor(AccessibilityInfo, "addEventListener");
let query: ReturnType<typeof deferred>;
let changed: (value: boolean) => void;
let remove: jest.Mock;
let listen: jest.Mock;
let timing: jest.SpyInstance;
let setValue: jest.SpyInstance;
let animations: { start: jest.Mock; stop: jest.Mock; reset: jest.Mock }[];

beforeEach(() => {
  jest.clearAllMocks();
  query = deferred();
  remove = jest.fn();
  changed = () => {
    throw new Error("Missing live preference observer");
  };
  listen = jest.fn((event: string, handler: (value: boolean) => void) => {
    expect(event).toBe("reduceMotionChanged");
    changed = handler;
    return { remove };
  });
  Object.defineProperty(AccessibilityInfo, "addEventListener", { configurable: true, writable: true, value: listen });
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(query.promise);
  animations = [];
  timing = jest.spyOn(Animated, "timing").mockImplementation(() => {
    const animation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
    animations.push(animation);
    return animation;
  });
  setValue = jest.spyOn(Animated.Value.prototype, "setValue");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  if (!originalListener) throw new Error("Missing original listener descriptor");
  Object.defineProperty(AccessibilityInfo, "addEventListener", originalListener);
});

async function preference(value: boolean) {
  await act(async () => {
    query.resolve(value);
  });
}

function overlay(
  open: boolean,
  onClose = jest.fn(),
  extra: Partial<React.ComponentProps<typeof ResponsiveOverlay>> = {},
) {
  return (
    <ResponsiveOverlay open={open} onClose={onClose} phonePresentation="sheet" {...extra}>
      <Text>Original content</Text>
    </ResponsiveOverlay>
  );
}
it.each([false, true])("snaps unknown open=%s without timing", (open) => {
  const view = render(overlay(open));
  expect(timing).not.toHaveBeenCalled();
  expect(setValue).toHaveBeenLastCalledWith(open ? 1 : 0);
  expect(view.UNSAFE_getByType(Modal).props.visible).toBe(open);
});
it.each([false, true])("keeps resolved reduced open=%s static", async (open) => {
  render(overlay(open));
  await preference(true);
  expect(timing).not.toHaveBeenCalled();
  expect(setValue).toHaveBeenLastCalledWith(open ? 1 : 0);
});
it.each([false, true])("retains original allowed target/duration for open=%s", async (open) => {
  render(overlay(open));
  await preference(false);
  expect(timing).toHaveBeenCalledTimes(1);
  expect(timing.mock.calls[0][1]).toEqual({ toValue: open ? 1 : 0, duration: open ? 220 : 180, useNativeDriver: true });
  expect(animations[0].start).toHaveBeenCalledTimes(1);
});
it.each([false, true])("snaps controlled open=%s without close callbacks", async (open) => {
  const close = jest.fn();
  const view = render(overlay(!open, close));
  await preference(true);
  view.rerender(overlay(open, close));
  expect(setValue).toHaveBeenLastCalledWith(open ? 1 : 0);
  expect(timing).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
it("live reduction cancels motion to the latest open target without dismissing", async () => {
  const close = jest.fn();
  const view = render(overlay(false, close));
  await preference(false);
  view.rerender(overlay(true, close));
  act(() => changed(true));
  expect(setValue).toHaveBeenLastCalledWith(1);
  expect(timing).toHaveBeenCalledTimes(2);
  expect(close).not.toHaveBeenCalled();
  expect(view.UNSAFE_getByType(Modal).props.visible).toBe(true);
});
it("live opt-in keeps the original timing and current open state", async () => {
  const close = jest.fn();
  const view = render(overlay(false, close));
  await preference(true);
  view.rerender(overlay(true, close));
  act(() => changed(false));
  expect(timing).toHaveBeenCalledTimes(1);
  expect(timing.mock.calls[0][1]).toEqual({ toValue: 1, duration: 220, useNativeDriver: true });
  expect(close).not.toHaveBeenCalled();
});
it("actual backdrop and Modal request each call the original close once", async () => {
  const close = jest.fn();
  const view = render(overlay(true, close));
  await preference(true);
  fireEvent.press(view.UNSAFE_getAllByProps({ onPress: close })[0]);
  expect(close).toHaveBeenCalledTimes(1);
  act(() => view.UNSAFE_getByType(Modal).props.onRequestClose());
  expect(close).toHaveBeenCalledTimes(2);
  expect(view.UNSAFE_getByType(Modal).props.animationType).toBe("none");
  expect(view.UNSAFE_getByType(Modal).props.statusBarTranslucent).toBe(true);
});
it("disabled backdrop cannot dismiss", async () => {
  const close = jest.fn();
  const view = render(overlay(true, close, { dismissOnBackdrop: false }));
  await preference(true);
  const backdrop = view.UNSAFE_getAllByProps({ className: "absolute inset-0" })[0];
  fireEvent.press(backdrop);
  expect(close).not.toHaveBeenCalled();
});
it.each(["sheet", "dialog", "fullscreen"] as const)(
  "retains children and Modal visibility for %s",
  async (phonePresentation) => {
    const view = render(overlay(true, jest.fn(), { phonePresentation }));
    await preference(true);
    expect(view.getByText("Original content")).toBeTruthy();
    expect(view.UNSAFE_getByType(Modal).props.visible).toBe(true);
  },
);
it("shares its observer until the final consumer leaves", async () => {
  const observer = renderHook(() => useReducedMotionPreference());
  const view = render(overlay(true));
  await preference(true);
  expect(listen).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(remove).not.toHaveBeenCalled();
  observer.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
