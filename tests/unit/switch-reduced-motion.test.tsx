import React from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { Switch } from "@/components/ui/Switch";
import { Skeleton } from "@/components/ui/Skeleton";

jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({ themeColors: { surfaceHigh: "#ddd" } }),
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
let stopValue: jest.SpyInstance;
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
  stopValue = jest.spyOn(Animated.Value.prototype, "stopAnimation");
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

it.each([false, true])("starts value %s at its correct endpoint with unknown preference and no spring", (value) => {
  const Value = Animated.Value;
  const construct = jest.spyOn(Animated, "Value").mockImplementation((initial, config) => new Value(initial, config));
  const view = render(<Switch value={value} onValueChange={jest.fn()} />);
  expect(construct.mock.calls[0][0]).toBe(value ? 22 : 2);
  expect(spring).not.toHaveBeenCalled();
  expect(setValue).toHaveBeenLastCalledWith(value ? 22 : 2);
  expect(view.getByRole("switch").props.accessibilityState).toEqual({ checked: value, disabled: undefined });
});

it.each([false, true])("keeps initial reduced-motion value %s static", async (value) => {
  render(<Switch value={value} onValueChange={jest.fn()} />);
  await preference(true);
  expect(spring).not.toHaveBeenCalled();
  expect(setValue).toHaveBeenLastCalledWith(value ? 22 : 2);
});

it.each([false, true])("retains the existing allowed-motion spring for value %s", async (value) => {
  render(<Switch value={value} onValueChange={jest.fn()} />);
  await preference(false);
  expect(spring).toHaveBeenCalledTimes(1);
  expect(spring.mock.calls[0][1]).toEqual({ toValue: value ? 22 : 2, useNativeDriver: false, bounciness: 4 });
  expect(animations[0].start).toHaveBeenCalledTimes(1);
});

it.each([false, true])("snaps to newly controlled value %s while motion is reduced", async (value) => {
  const callback = jest.fn();
  const view = render(<Switch value={!value} onValueChange={callback} />);
  await preference(true);
  view.rerender(<Switch value={value} onValueChange={callback} />);
  expect(setValue).toHaveBeenLastCalledWith(value ? 22 : 2);
  expect(spring).not.toHaveBeenCalled();
  expect(callback).not.toHaveBeenCalled();
  expect(view.getByRole("switch").props.accessibilityState.checked).toBe(value);
});

it("preserves allowed spring handoff and snaps the newest value after a live reduction", async () => {
  const callback = jest.fn();
  const view = render(<Switch value={false} onValueChange={callback} />);
  await preference(false);
  view.rerender(<Switch value onValueChange={callback} />);
  expect(animations[0].stop).not.toHaveBeenCalled();
  expect(stopValue).not.toHaveBeenCalled();
  expect(spring.mock.calls[1][1].toValue).toBe(22);
  act(() => changed(true));
  expect(setValue).toHaveBeenLastCalledWith(22);
  expect(spring).toHaveBeenCalledTimes(2);
  expect(callback).not.toHaveBeenCalled();
});

it("resumes the original spring after a later live opt-in with the latest controlled value", async () => {
  const callback = jest.fn();
  const view = render(<Switch value={false} onValueChange={callback} />);
  await preference(true);
  view.rerender(<Switch value onValueChange={callback} />);
  act(() => changed(false));
  expect(spring).toHaveBeenCalledTimes(1);
  expect(spring.mock.calls[0][1].toValue).toBe(22);
  expect(animations[0].start).toHaveBeenCalledTimes(1);
});

it("removes its final preference listener on unmount", async () => {
  const view = render(<Switch value={false} onValueChange={jest.fn()} />);
  await preference(false);
  view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

it.each([false, true])("emits only the proposed value from controlled state %s", (value) => {
  const callback = jest.fn();
  const view = render(<Switch value={value} onValueChange={callback} />);
  fireEvent.press(view.getByRole("switch"));
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledWith(!value);
  expect(view.getByRole("switch").props.accessibilityState.checked).toBe(value);
});

it.each([false, true])("preserves disabled feedback and prevents writes for state %s", (value) => {
  const callback = jest.fn();
  const view = render(<Switch value={value} disabled onValueChange={callback} />);
  fireEvent.press(view.getByRole("switch", { disabled: true }));
  expect(callback).not.toHaveBeenCalled();
  const control = view.getByRole("switch", { disabled: true });
  expect(StyleSheet.flatten(control.props.style)).toEqual({
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: value ? "#0d9488" : "#ddd",
    opacity: 0.4,
    position: "relative",
    overflow: "hidden",
  });
  expect(view.getByRole("switch", { disabled: true }).props.accessibilityState).toEqual({
    checked: value,
    disabled: true,
  });
  const thumb = control.children[0];
  if (!thumb || typeof thumb === "string") throw new Error("Missing switch thumb");
  const { left, ...thumbStyle } = StyleSheet.flatten(thumb.props.style);
  if (left instanceof Animated.Value) {
    const read = jest.fn();
    left.stopAnimation(read);
    expect(read).toHaveBeenCalledWith(value ? 22 : 2);
  } else {
    expect(left).toBe(value ? 22 : 2);
  }
  expect(thumbStyle).toEqual({
    position: "absolute",
    top: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    shadowColor: "#003638",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  });
});

it("shares one real preference observer with Skeleton and keeps it until the last consumer leaves", async () => {
  const callback = jest.fn();
  const pair = render(
    <View>
      <Switch key="switch" value={false} onValueChange={callback} />
      <Skeleton key="loading" width={20} height={10} />
    </View>,
  );
  await preference(true);
  expect(listen).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
  pair.rerender(
    <View>
      <Skeleton key="loading" width={20} height={10} />
    </View>,
  );
  expect(remove).not.toHaveBeenCalled();
  pair.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

it("keeps a rejected initial preference static and can still accept live changes", async () => {
  render(<Switch value={true} onValueChange={jest.fn()} />);
  await act(async () => {
    query.reject(new Error("Preference unavailable"));
  });
  expect(spring).not.toHaveBeenCalled();
  expect(setValue).toHaveBeenLastCalledWith(22);
  act(() => changed(false));
  expect(spring).toHaveBeenCalledTimes(1);
});
