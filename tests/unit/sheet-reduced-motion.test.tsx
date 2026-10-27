import React from "react";
import { AccessibilityInfo, Animated, Modal, Text, View } from "react-native";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react-native";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";

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
let spring: jest.SpyInstance;
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
  spring = jest.spyOn(Animated, "spring").mockImplementation(() => {
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

function sheet(open: boolean, onClose = jest.fn()) {
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetContent>
        <Text>Selection actions</Text>
      </SheetContent>
    </Sheet>
  );
}

it.each([false, true])("snaps initial open=%s while preference is unknown", (open) => {
  const view = render(sheet(open));
  expect(spring).not.toHaveBeenCalled();
  expect(setValue).toHaveBeenLastCalledWith(open ? 1 : 0);
  expect(view.UNSAFE_getByType(Modal).props.visible).toBe(open);
});

it.each([false, true])("snaps initial open=%s when reduced motion resolves", async (open) => {
  render(sheet(open));
  await preference(true);
  expect(spring).not.toHaveBeenCalled();
  expect(setValue).toHaveBeenLastCalledWith(open ? 1 : 0);
});

it.each([false, true])("preserves the original allowed spring for open=%s", async (open) => {
  render(sheet(open));
  await preference(false);
  expect(spring).toHaveBeenCalledTimes(1);
  expect(spring.mock.calls[0][1]).toEqual({
    toValue: open ? 1 : 0,
    useNativeDriver: true,
    damping: 25,
    stiffness: 200,
  });
  expect(animations[0].start).toHaveBeenCalledTimes(1);
});

it.each([false, true])("snaps controlled open=%s without dismissing", async (open) => {
  const close = jest.fn();
  const view = render(sheet(!open, close));
  await preference(true);
  view.rerender(sheet(open, close));
  expect(setValue).toHaveBeenLastCalledWith(open ? 1 : 0);
  expect(spring).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it("preserves allowed spring handoff and snaps the latest target on live reduction", async () => {
  const close = jest.fn();
  const view = render(sheet(false, close));
  await preference(false);
  view.rerender(sheet(true, close));
  expect(spring).toHaveBeenCalledTimes(2);
  expect(animations[0].stop).not.toHaveBeenCalled();
  expect(spring.mock.calls[1][1].toValue).toBe(1);
  act(() => changed(true));
  expect(setValue).toHaveBeenLastCalledWith(1);
  expect(spring).toHaveBeenCalledTimes(2);
  expect(close).not.toHaveBeenCalled();
});

it("starts the original spring at the latest controlled target after live opt-in", async () => {
  const close = jest.fn();
  const view = render(sheet(false, close));
  await preference(true);
  view.rerender(sheet(true, close));
  act(() => changed(false));
  expect(spring).toHaveBeenCalledTimes(1);
  expect(spring.mock.calls[0][1].toValue).toBe(1);
  expect(animations[0].start).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
});

it("calls onClose once per actual backdrop and Modal request without mutating controlled state", async () => {
  const close = jest.fn();
  const view = render(sheet(true, close));
  await preference(true);
  fireEvent.press(view.UNSAFE_getAllByProps({ onPress: close })[0]);
  expect(close).toHaveBeenCalledTimes(1);
  act(() => view.UNSAFE_getByType(Modal).props.onRequestClose());
  expect(close).toHaveBeenCalledTimes(2);
  expect(view.UNSAFE_getByType(Modal).props.visible).toBe(true);
  expect(view.UNSAFE_getByType(Modal).props.animationType).toBe("none");
  expect(view.UNSAFE_getByType(Modal).props.transparent).toBe(true);
});

it("preserves the existing Modal override spread order", () => {
  const close = jest.fn();
  const override = jest.fn();
  const view = render(
    <Sheet
      open
      onClose={close}
      visible={false}
      transparent={false}
      onRequestClose={override}
      presentationStyle="overFullScreen"
      hardwareAccelerated
    >
      <Text>Content</Text>
    </Sheet>,
  );
  const props = view.UNSAFE_getByType(Modal).props;
  expect(props.visible).toBe(false);
  expect(props.transparent).toBe(false);
  expect(props.presentationStyle).toBe("overFullScreen");
  expect(props.hardwareAccelerated).toBe(true);
  act(() => props.onRequestClose());
  expect(override).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
});

it("preserves SheetContent classes and children", () => {
  const view = render(
    <SheetContent className="custom">
      <Text>Original child</Text>
    </SheetContent>,
  );
  expect(view.getByText("Original child")).toBeTruthy();
  expect(view.UNSAFE_getByType(View).props.className).toBe("px-6 pb-8 custom");
});

it("keeps the shared native listener until its final consumer leaves", async () => {
  const observer = renderHook(() => useReducedMotionPreference());
  const view = render(sheet(true));
  await preference(true);
  expect(listen).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(remove).not.toHaveBeenCalled();
  observer.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
