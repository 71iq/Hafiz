import React from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { act, cleanup, render, renderHook } from "@testing-library/react-native";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";
import { Skeleton, SkeletonText, SearchResultsSkeleton } from "@/components/ui/Skeleton";

// The installed server renderer has no declaration package in this RN workspace.
const { renderToString } = jest.requireActual<{ renderToString: (element: React.ReactNode) => string }>(
  "react-dom/server",
);

jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({ themeColors: { surfaceHigh: "#ddd" } }),
}));

function deferred() {
  let resolve!: (value: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<boolean>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let query: ReturnType<typeof deferred>;
let changed: (value: boolean) => void;
let remove: jest.Mock;
let readPreference: jest.SpyInstance;
let listen: jest.Mock<{ remove: () => void } | undefined, [string, (value: boolean) => void]>;
const originalListener = Object.getOwnPropertyDescriptor(AccessibilityInfo, "addEventListener");

beforeEach(() => {
  jest.clearAllMocks();
  query = deferred();
  remove = jest.fn();
  changed = () => {
    throw new Error("Preference listener was not installed");
  };
  readPreference = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(query.promise);
  listen = jest.fn((event: string, handler: (value: boolean) => void) => {
    expect(event).toBe("reduceMotionChanged");
    changed = handler;
    return { remove };
  });
  Object.defineProperty(AccessibilityInfo, "addEventListener", { configurable: true, writable: true, value: listen });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  if (!originalListener) throw new Error("Missing original AccessibilityInfo listener descriptor");
  Object.defineProperty(AccessibilityInfo, "addEventListener", originalListener);
});

async function resolvePreference(value: boolean) {
  await act(async () => {
    query.resolve(value);
  });
}

it.each([true, false])("starts conservatively and reads initial preference %s", async (value) => {
  const view = renderHook(useReducedMotionPreference);
  expect(view.result.current).toBe(true);
  await resolvePreference(value);
  expect(view.result.current).toBe(value);
  expect(listen.mock.invocationCallOrder[0]).toBeLessThan(readPreference.mock.invocationCallOrder[0]);
});

it("updates existing consumers when the preference changes in either direction", async () => {
  const view = renderHook(useReducedMotionPreference);
  await resolvePreference(false);
  act(() => changed(true));
  expect(view.result.current).toBe(true);
  act(() => changed(false));
  expect(view.result.current).toBe(false);
});

it.each([true, false])("keeps newer event %s ahead of the stale initial query", async (event) => {
  const view = renderHook(useReducedMotionPreference);
  act(() => changed(event));
  await resolvePreference(!event);
  expect(view.result.current).toBe(event);
});

it("shares one subscription and query until the final consumer unmounts", async () => {
  const first = renderHook(useReducedMotionPreference);
  const second = renderHook(useReducedMotionPreference);
  await resolvePreference(false);
  expect(first.result.current).toBe(false);
  expect(second.result.current).toBe(false);
  expect(listen).toHaveBeenCalledTimes(1);
  expect(readPreference).toHaveBeenCalledTimes(1);
  first.unmount();
  expect(remove).not.toHaveBeenCalled();
  act(() => changed(true));
  expect(second.result.current).toBe(true);
  second.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

it("ignores both old events and old pending reads after remount", async () => {
  const first = renderHook(useReducedMotionPreference);
  const oldEvent = changed;
  const oldQuery = query;
  first.unmount();
  query = deferred();
  readPreference.mockReturnValue(query.promise);
  const next = renderHook(useReducedMotionPreference);
  expect(next.result.current).toBe(true);
  await act(async () => {
    oldEvent(false);
    oldQuery.resolve(false);
  });
  expect(next.result.current).toBe(true);
  await resolvePreference(false);
  expect(next.result.current).toBe(false);
  expect(readPreference).toHaveBeenCalledTimes(2);
});

it("returns to an unknown static snapshot when a new consumer mounts after the last leaves", async () => {
  const first = renderHook(useReducedMotionPreference);
  await resolvePreference(false);
  first.unmount();
  query = deferred();
  readPreference.mockReturnValue(query.promise);
  const next = renderHook(useReducedMotionPreference);
  expect(next.result.current).toBe(true);
  await resolvePreference(true);
  expect(next.result.current).toBe(true);
});

it("keeps the static fallback when the query rejects and still accepts events", async () => {
  const view = renderHook(useReducedMotionPreference);
  await act(async () => {
    query.reject(new Error("System API unavailable"));
  });
  expect(view.result.current).toBe(true);
  act(() => changed(false));
  expect(view.result.current).toBe(false);
});

it("keeps a live event if the initial query later rejects", async () => {
  const view = renderHook(useReducedMotionPreference);
  act(() => changed(false));
  await act(async () => {
    query.reject(new Error("System API unavailable"));
  });
  expect(view.result.current).toBe(false);
});

it("uses the query when event subscription throws", async () => {
  listen.mockImplementationOnce(() => {
    throw new Error("Events unsupported");
  });
  const view = renderHook(useReducedMotionPreference);
  await resolvePreference(false);
  expect(view.result.current).toBe(false);
  view.unmount();
  expect(remove).not.toHaveBeenCalled();
});

it("keeps motion disabled if both APIs throw synchronously", () => {
  listen.mockImplementationOnce(() => {
    throw new Error("Events unsupported");
  });
  readPreference.mockImplementationOnce(() => {
    throw new Error("Query unsupported");
  });
  const view = renderHook(useReducedMotionPreference);
  expect(view.result.current).toBe(true);
});

it("handles the installed web API returning no subscription on unsupported targets", async () => {
  listen.mockReturnValueOnce(undefined);
  const view = renderHook(useReducedMotionPreference);
  await resolvePreference(true);
  expect(view.result.current).toBe(true);
  view.unmount();
  expect(remove).not.toHaveBeenCalled();
});

it("server-renders the conservative snapshot without reading platform APIs", () => {
  function Preference() {
    return String(useReducedMotionPreference());
  }
  expect(renderToString(<Preference />)).toBe("true");
  expect(listen).not.toHaveBeenCalled();
  expect(readPreference).not.toHaveBeenCalled();
});

describe("actual Skeleton pulse", () => {
  let loops: { start: jest.Mock; stop: jest.Mock; reset: jest.Mock }[];
  let timing: jest.SpyInstance;
  let setValue: jest.SpyInstance;

  beforeEach(() => {
    loops = [];
    jest.spyOn(Animated, "loop").mockImplementation(() => {
      const loop = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
      loops.push(loop);
      return loop;
    });
    timing = jest.spyOn(Animated, "timing");
    setValue = jest.spyOn(Animated.Value.prototype, "setValue");
  });

  function subject() {
    return <Skeleton testID="loading" width={160} height={24} borderRadius={12} />;
  }

  it("shows a visible static placeholder before the preference resolves", () => {
    const Value = Animated.Value;
    const construct = jest.spyOn(Animated, "Value").mockImplementation((value, config) => new Value(value, config));
    const view = render(subject());
    expect(construct.mock.calls[0][0]).toBe(0.5);
    expect(loops).toHaveLength(0);
    expect(setValue).toHaveBeenLastCalledWith(0.5);
    expect(StyleSheet.flatten(view.getByTestId("loading").props.style)).toEqual(
      expect.objectContaining({
        width: 160,
        height: 24,
        borderRadius: 12,
        backgroundColor: "#ddd",
      }),
    );
  });

  it("does not start a pulse for initial reduced motion", async () => {
    render(subject());
    await resolvePreference(true);
    expect(loops).toHaveLength(0);
    expect(timing).not.toHaveBeenCalled();
    expect(setValue).toHaveBeenLastCalledWith(0.5);
  });

  it("keeps the original pulse range and native-driver duration for no preference", async () => {
    render(subject());
    await resolvePreference(false);
    expect(loops).toHaveLength(1);
    expect(loops[0].start).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls.map(([, config]) => config)).toEqual([
      { toValue: 0.7, duration: 1200, useNativeDriver: true },
      { toValue: 0.3, duration: 1200, useNativeDriver: true },
    ]);
    expect(setValue).toHaveBeenLastCalledWith(0.3);
  });

  it("stops an active pulse and settles static, then resumes on a later opt-in", async () => {
    const view = render(subject());
    await resolvePreference(false);
    act(() => changed(true));
    expect(loops[0].stop).toHaveBeenCalledTimes(1);
    expect(setValue).toHaveBeenLastCalledWith(0.5);
    act(() => changed(false));
    expect(loops).toHaveLength(2);
    expect(loops[1].start).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(loops[1].stop).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("shares the preference across composed placeholders and preserves cleanup", async () => {
    const view = render(
      <View>
        <SkeletonText testID="line" />
        <SearchResultsSkeleton />
      </View>,
    );
    expect(listen).toHaveBeenCalledTimes(1);
    expect(loops).toHaveLength(0);
    await resolvePreference(false);
    expect(loops).toHaveLength(19);
    act(() => changed(true));
    expect(loops.every((loop) => loop.stop.mock.calls.length === 1)).toBe(true);
    expect(view.getByTestId("line")).toBeTruthy();
    view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
