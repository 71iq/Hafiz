import React from "react";
import { AccessibilityInfo, Animated, StyleSheet } from "react-native";
import { act, cleanup, render, renderHook } from "@testing-library/react-native";
import { Toast } from "@/components/ui/Toast";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";

type MockCompositeAnimation = Animated.CompositeAnimation & {
  start: jest.Mock;
  stop: jest.Mock;
  reset: jest.Mock;
};

type ScheduledTiming = {
  animation: MockCompositeAnimation;
  config: Parameters<typeof Animated.timing>[1];
};

function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

const originalListener = Object.getOwnPropertyDescriptor(AccessibilityInfo, "addEventListener");
let preferenceQuery: ReturnType<typeof deferred>;
let preferenceChanged: (value: boolean) => void;
let preferenceRemove: jest.Mock;
let timings: ScheduledTiming[];
let setValue: jest.SpyInstance;
let schedule: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  preferenceQuery = deferred();
  preferenceChanged = () => {
    throw new Error("The reduced-motion listener was not installed");
  };
  preferenceRemove = jest.fn();
  timings = [];
  schedule = jest.spyOn(globalThis, "setTimeout");

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
    animation.start.mockImplementation(() => undefined);
    timings.push({ animation, config });
    return animation;
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.useRealTimers();
  if (!originalListener) throw new Error("Missing original AccessibilityInfo listener descriptor");
  Object.defineProperty(AccessibilityInfo, "addEventListener", originalListener);
});

async function resolvePreference(value: boolean) {
  await act(async () => {
    preferenceQuery.resolve(value);
  });
}

async function renderWithInitialPreference(value: boolean) {
  const preference = renderHook(useReducedMotionPreference);
  await resolvePreference(value);
  const view = render(<Toast message="Saved" onDismiss={jest.fn()} />);
  return { preference, view };
}

function timerCallback(delay: number): () => void {
  const timer = schedule.mock.calls.find(([, timerDelay]) => timerDelay === delay);
  if (!timer || typeof timer[0] !== "function") throw new Error(`Missing ${delay}ms timer callback`);
  return timer[0];
}

it("keeps the existing text, pointer behavior, and styles", () => {
  const view = render(<Toast message="Saved" onDismiss={jest.fn()} />);
  const text = view.getByText("Saved");
  const container = text.parent?.parent ?? text.parent;
  if (!container) throw new Error("Toast container was not rendered");

  expect(container.props.pointerEvents).toBe("none");
  expect(StyleSheet.flatten(container.props.style)).toEqual(
    expect.objectContaining({
      position: "absolute",
      top: 60,
      left: 0,
      right: 0,
      alignItems: "center",
      zIndex: 9999,
    }),
  );
  expect(StyleSheet.flatten(text.props.style)).toEqual({
    backgroundColor: "#003638",
    color: "#fff",
    fontFamily: "Manrope_600SemiBold",
    fontSize: 13,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    overflow: "hidden",
  });
});

it.each([
  [undefined, 2000],
  [3500, 3500],
] as const)("uses the %s hold and a separate 200ms dismissal tail", (duration, hold) => {
  const onDismiss = jest.fn();
  render(<Toast message="Saved" onDismiss={onDismiss} duration={duration} />);

  expect(jest.getTimerCount()).toBe(1);
  act(() => jest.advanceTimersByTime(hold - 1));
  expect(onDismiss).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(onDismiss).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(1);
  act(() => jest.advanceTimersByTime(199));
  expect(onDismiss).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it.each([0, -50])("keeps zero and negative durations as immediate holds with a full 200ms tail", (duration) => {
  const onDismiss = jest.fn();
  render(<Toast message="Saved" onDismiss={onDismiss} duration={duration} />);

  act(() => jest.advanceTimersByTime(0));
  expect(onDismiss).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(199));
  expect(onDismiss).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("uses a static initial endpoint for unknown motion", () => {
  const view = render(<Toast message="Saved" onDismiss={jest.fn()} />);
  expect(timings).toHaveLength(0);
  expect(setValue).toHaveBeenLastCalledWith(1);
  view.unmount();
});

it("uses a static initial endpoint for reduced motion", async () => {
  const { preference, view } = await renderWithInitialPreference(true);
  expect(timings).toHaveLength(0);
  expect(setValue).toHaveBeenLastCalledWith(1);
  view.unmount();
  preference.unmount();
});

it("uses the existing 200ms native-driver fades when motion is initially allowed", async () => {
  const { preference, view } = await renderWithInitialPreference(false);
  expect(timings).toHaveLength(1);
  expect(timings[0].config).toEqual({ toValue: 1, duration: 200, useNativeDriver: true });
  expect(timings[0].animation.start).toHaveBeenCalledWith();
  expect(timings[0].animation.start.mock.calls[0]).toHaveLength(0);
  view.unmount();
  preference.unmount();
});

it("does not restart the lifetime when preference changes during entry, hold, or exit", async () => {
  const onDismiss = jest.fn();
  const preference = renderHook(useReducedMotionPreference);
  await resolvePreference(false);
  const view = render(<Toast message="Saved" onDismiss={onDismiss} duration={1000} />);

  act(() => preferenceChanged(true));
  expect(timings[0].animation.stop).toHaveBeenCalledTimes(1);
  expect(schedule.mock.calls.filter(([, timerDelay]) => timerDelay === 1000)).toHaveLength(1);
  act(() => jest.advanceTimersByTime(400));
  act(() => preferenceChanged(false));
  act(() => preferenceChanged(true));
  expect(timings).toHaveLength(1);
  expect(setValue).toHaveBeenLastCalledWith(1);
  expect(schedule.mock.calls.filter(([, timerDelay]) => timerDelay === 1000)).toHaveLength(1);
  act(() => jest.advanceTimersByTime(600));
  expect(timings).toHaveLength(1);
  expect(schedule.mock.calls.filter(([, timerDelay]) => timerDelay === 1000)).toHaveLength(1);
  act(() => preferenceChanged(false));
  expect(timings).toHaveLength(2);
  expect(timings[1].config).toEqual({ toValue: 0, duration: 200, useNativeDriver: true });
  act(() => jest.advanceTimersByTime(75));
  act(() => preferenceChanged(true));
  expect(timings[1].animation.stop).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(124));
  expect(onDismiss).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  view.unmount();
  preference.unmount();
});

it("uses the clamped remaining entry time when motion is enabled live", async () => {
  const { preference, view } = await renderWithInitialPreference(true);
  act(() => jest.advanceTimersByTime(75));
  act(() => preferenceChanged(false));

  expect(timings).toHaveLength(1);
  expect(timings[0].config).toEqual({ toValue: 1, duration: 125, useNativeDriver: true });
  view.unmount();
  preference.unmount();
});

it("does not replay entry after it has settled during a live opt-in", async () => {
  const { preference, view } = await renderWithInitialPreference(true);
  act(() => jest.advanceTimersByTime(200));
  act(() => preferenceChanged(false));

  expect(timings).toHaveLength(0);
  expect(setValue).toHaveBeenLastCalledWith(1);
  view.unmount();
  preference.unmount();
});

it("resets message, duration, and dismissal callback without flashing hidden", async () => {
  const oldDismiss = jest.fn();
  const newDismiss = jest.fn();
  const { preference, view } = await renderWithInitialPreference(false);
  view.rerender(<Toast message="First" onDismiss={oldDismiss} duration={1000} />);
  act(() => jest.advanceTimersByTime(400));
  view.rerender(<Toast message="Second" onDismiss={newDismiss} duration={500} />);

  expect(timings.at(-1)?.config).toEqual({ toValue: 1, duration: 200, useNativeDriver: true });
  expect(setValue).not.toHaveBeenCalledWith(0);
  act(() => jest.advanceTimersByTime(500));
  act(() => jest.advanceTimersByTime(200));
  expect(oldDismiss).not.toHaveBeenCalled();
  expect(newDismiss).toHaveBeenCalledTimes(1);
  view.unmount();
  preference.unmount();
});

it("keeps only the current session callback after old timers are invoked", () => {
  const oldDismiss = jest.fn();
  const newDismiss = jest.fn();
  const view = render(<Toast message="First" onDismiss={oldDismiss} duration={100} />);
  const oldHold = timerCallback(100);
  act(() => oldHold());
  const oldTail = timerCallback(200);

  view.rerender(<Toast message="Second" onDismiss={newDismiss} duration={100} />);
  act(() => {
    oldHold();
    oldTail();
  });
  expect(oldDismiss).not.toHaveBeenCalled();
  expect(newDismiss).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(100));
  act(() => jest.advanceTimersByTime(200));
  expect(oldDismiss).not.toHaveBeenCalled();
  expect(newDismiss).toHaveBeenCalledTimes(1);
});

it("does not dismiss on animation cancellation and stops the owned animation on cleanup", async () => {
  const onDismiss = jest.fn();
  const { preference, view } = await renderWithInitialPreference(false);
  act(() => preferenceChanged(true));
  expect(timings[0].animation.stop).toHaveBeenCalledTimes(1);
  expect(onDismiss).not.toHaveBeenCalled();
  view.unmount();
  preference.unmount();
  expect(preferenceRemove).toHaveBeenCalled();
});

it("guards captured hold and tail callbacks after unmount", () => {
  const onDismiss = jest.fn();
  const view = render(<Toast message="Saved" onDismiss={onDismiss} duration={100} />);
  const hold = timerCallback(100);
  act(() => hold());
  const tail = timerCallback(200);
  view.unmount();
  act(() => {
    hold();
    tail();
  });
  expect(onDismiss).not.toHaveBeenCalled();
});

it.each([null, ""])("renders no node and resets opacity for falsy message %s", (message) => {
  const view = render(<Toast message={message} onDismiss={jest.fn()} />);
  expect(view.toJSON()).toBeNull();
  expect(view.queryByText("Saved")).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  expect(setValue).toHaveBeenLastCalledWith(0);
});

it.each(["message", "duration", "callback"] as const)("resets the session when only %s changes", (changed) => {
  const oldDismiss = jest.fn();
  const newDismiss = jest.fn();
  const view = render(<Toast message="Saved" duration={1000} onDismiss={oldDismiss} />);
  act(() => jest.advanceTimersByTime(400));
  const nextMessage = changed === "message" ? "Changed" : "Saved";
  const nextDuration = changed === "duration" ? 500 : 1000;
  const nextDismiss = changed === "callback" ? newDismiss : oldDismiss;
  view.rerender(<Toast message={nextMessage} duration={nextDuration} onDismiss={nextDismiss} />);
  act(() => jest.advanceTimersByTime(nextDuration + 199));
  expect(oldDismiss).not.toHaveBeenCalled();
  expect(newDismiss).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(nextDismiss).toHaveBeenCalledTimes(1);
  if (changed === "callback") expect(oldDismiss).not.toHaveBeenCalled();
  else expect(newDismiss).not.toHaveBeenCalled();
});

it("uses only the remaining exit time on a late opt-in and keeps the dismissal deadline", async () => {
  const preference = renderHook(useReducedMotionPreference);
  await resolvePreference(true);
  const onDismiss = jest.fn();
  const view = render(<Toast message="Saved" duration={1000} onDismiss={onDismiss} />);
  act(() => jest.advanceTimersByTime(1075));
  act(() => preferenceChanged(false));
  expect(timings).toHaveLength(1);
  expect(timings[0].config).toEqual({ toValue: 0, duration: 125, useNativeDriver: true });
  act(() => jest.advanceTimersByTime(124));
  expect(onDismiss).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  const tail = timerCallback(200);
  act(() => tail());
  expect(onDismiss).toHaveBeenCalledTimes(1);
  view.unmount();
  preference.unmount();
});

it.each([0, 1000])("stops an active animation on unmount at %sms without dismissing", async (elapsed) => {
  const preference = renderHook(useReducedMotionPreference);
  await resolvePreference(false);
  const onDismiss = jest.fn();
  const view = render(<Toast message="Saved" duration={1000} onDismiss={onDismiss} />);
  act(() => jest.advanceTimersByTime(elapsed));
  const owned = timings.at(-1);
  if (!owned) throw new Error("Missing current animation");
  expect(owned.animation.stop).not.toHaveBeenCalled();
  view.unmount();
  expect(owned.animation.stop).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(5000));
  expect(onDismiss).not.toHaveBeenCalled();
  expect(preferenceRemove).not.toHaveBeenCalled();
  preference.unmount();
  expect(preferenceRemove).toHaveBeenCalledTimes(1);
});
