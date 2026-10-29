import React from "react";
import * as ReactNative from "react-native";
import { AccessibilityInfo, Pressable, Text, View } from "react-native";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react-native";
import { NavigationContainer, NavigationIndependentTree } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import * as Reanimated from "react-native-reanimated";
import { AppNavigation } from "@/components/ui/AppNavigation";
import { ChromeProvider, useChrome } from "@/lib/ui/chrome";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";

let mockValues: { initial: number; shared: { value: number } }[];
// Native scheduling boundary only. Browser gates use the installed real Reanimated runtime.
jest.mock("react-native-reanimated", () => {
  const React = require("react");
  const RN = require("react-native");
  const { ReduceMotion } = jest.requireActual("react-native-reanimated/src/commonTypes");
  return {
    __esModule: true,
    default: { View: RN.View, createAnimatedComponent: (component: React.ComponentType) => component },
    ReduceMotion,
    useSharedValue: (initial: number) => {
      const shared = React.useRef({ value: initial }).current;
      if (!mockValues.some((v) => v.shared === shared)) mockValues.push({ initial, shared });
      return shared;
    },
    useAnimatedStyle: (read: () => object) => read(),
    withTiming: jest.fn((value: number) => value),
    withSpring: jest.fn((value: number) => value),
  };
});
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({ isDark: false, themeSurface: "#fff" }),
  withThemeOpacity: (color: string) => color,
}));
jest.mock("@/lib/auth/store", () => ({ useAuthStore: () => ({ user: null, profile: null }) }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
const Tabs = createBottomTabNavigator<{ home: undefined; mushaf: undefined }>();
function Home() {
  return <Text>Home screen</Text>;
}
function Mushaf() {
  return <Text>Mushaf screen</Text>;
}
const pressed = jest.fn();
function Body({ isRTL = false }: { isRTL?: boolean }) {
  const c = useChrome();
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel="Hide" onPress={() => c.setVisible(false)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Show" onPress={() => c.setVisible(true)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Immersive on" onPress={() => c.setImmersive(true)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Immersive off" onPress={() => c.setImmersive(false)} />
      <NavigationIndependentTree>
        <NavigationContainer>
          <Tabs.Navigator
            screenOptions={{ headerShown: false, animation: "none" }}
            tabBar={(props) => <AppNavigation {...props} isRTL={isRTL} />}
          >
            <Tabs.Screen name="home" component={Home} options={{ title: "Home" }} />
            <Tabs.Screen
              name="mushaf"
              component={Mushaf}
              options={{ title: "Mushaf" }}
              listeners={{
                tabPress: (event) => {
                  pressed();
                  event.preventDefault();
                },
              }}
            />
          </Tabs.Navigator>
        </NavigationContainer>
      </NavigationIndependentTree>
    </View>
  );
}
function fixture(isRTL = false) {
  return (
    <ChromeProvider>
      <Body isRTL={isRTL} />
    </ChromeProvider>
  );
}
function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const descriptor = Object.getOwnPropertyDescriptor(AccessibilityInfo, "addEventListener");
let query: ReturnType<typeof deferred>;
let changed: (value: boolean) => void;
let remove: jest.Mock;
let listen: jest.Mock;
let timing: jest.SpyInstance;
let dimensions: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  dimensions = jest
    .spyOn(require("react-native"), "useWindowDimensions")
    .mockReturnValue({ width: 800, height: 900, scale: 1, fontScale: 1 });
  mockValues = [];
  query = deferred();
  remove = jest.fn();
  listen = jest.fn((event: string, handler: (value: boolean) => void) => {
    expect(event).toBe("reduceMotionChanged");
    changed = handler;
    return { remove };
  });
  Object.defineProperty(AccessibilityInfo, "addEventListener", { configurable: true, writable: true, value: listen });
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(query.promise);
  timing = jest.spyOn(Reanimated, "withTiming");
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (!descriptor) throw Error("Missing preference listener descriptor");
  Object.defineProperty(AccessibilityInfo, "addEventListener", descriptor);
});
async function preference(value: boolean) {
  await act(async () => {
    query.resolve(value);
  });
}
function hidden() {
  const owner = mockValues.find((v) => v.initial === 0);
  if (!owner) throw Error("Missing floating panel shared value");
  return owner.shared.value;
}
function event(view: ReturnType<typeof render>, name: string) {
  fireEvent.press(view.getByRole("button", { name }), { stopPropagation: jest.fn() });
}
function ownTimings() {
  return timing.mock.calls.filter((c) => c[1]?.duration === 180);
}

function trigger(view: ReturnType<typeof render>) {
  const node = view.UNSAFE_root.findAll((n) => n.props.onHoverIn && n.props.onPress)[0];
  if (!node) throw Error("Missing floating trigger");
  return node;
}
function edge(view: ReturnType<typeof render>) {
  const node = view.UNSAFE_root.findAll((n) => n.props.onHoverIn && n.props.style?.width === 16)[0];
  if (!node) throw Error("Missing floating edge");
  return node;
}
function panel(view: ReturnType<typeof render>) {
  const node = view.UNSAFE_root.findAll((n) => ReactNative.StyleSheet.flatten(n.props.style)?.width === 248)[0];
  if (!node) throw Error("Missing floating panel");
  return node;
}
it("starts closed with unknown preference without timing", () => {
  const view = render(fixture());
  expect(hidden()).toBe(0);
  expect(panel(view).props.pointerEvents).toBe("none");
  expect(ownTimings()).toHaveLength(0);
});
it.each(["hoverIn", "focus", "press"])("snaps unknown opening via %s", (name) => {
  const view = render(fixture());
  fireEvent(trigger(view), name);
  expect(hidden()).toBe(1);
  expect(panel(view).props.pointerEvents).toBe("auto");
  expect(ownTimings()).toHaveLength(0);
});
it("reduced click toggles immediate feedback in both directions", async () => {
  const view = render(fixture());
  await preference(true);
  fireEvent.press(trigger(view));
  expect(hidden()).toBe(1);
  fireEvent.press(trigger(view));
  expect(hidden()).toBe(0);
  expect(ownTimings()).toHaveLength(0);
});
it.each(["hoverOut", "blur"])("retains the distinct 180ms %s hide delay", async (name) => {
  const view = render(fixture());
  await preference(true);
  fireEvent(trigger(view), "focus");
  fireEvent(trigger(view), name);
  act(() => jest.advanceTimersByTime(179));
  expect(hidden()).toBe(1);
  act(() => jest.advanceTimersByTime(1));
  expect(hidden()).toBe(0);
  expect(ownTimings()).toHaveLength(0);
});
it("edge re-entry cancels the pending hide without losing later hide", async () => {
  const view = render(fixture());
  await preference(true);
  fireEvent(edge(view), "hoverIn");
  fireEvent(edge(view), "hoverOut");
  act(() => jest.advanceTimersByTime(90));
  fireEvent(edge(view), "hoverIn");
  act(() => jest.advanceTimersByTime(300));
  expect(hidden()).toBe(1);
  fireEvent(edge(view), "hoverOut");
  act(() => jest.advanceTimersByTime(180));
  expect(hidden()).toBe(0);
});
it("allowed timing keeps both endpoints, 180ms and explicit Never", async () => {
  const view = render(fixture());
  await preference(false);
  fireEvent.press(trigger(view));
  expect(ownTimings().at(-1)).toEqual([1, { duration: 180, reduceMotion: Reanimated.ReduceMotion.Never }]);
  fireEvent.press(trigger(view));
  expect(ownTimings().at(-1)).toEqual([0, { duration: 180, reduceMotion: Reanimated.ReduceMotion.Never }]);
});
it.each([true, false])("live reduction snaps the latest open=%s endpoint", async (open) => {
  const view = render(fixture());
  await preference(false);
  fireEvent.press(trigger(view));
  if (!open) fireEvent.press(trigger(view));
  const count = ownTimings().length;
  act(() => changed(true));
  expect(hidden()).toBe(open ? 1 : 0);
  expect(ownTimings()).toHaveLength(count);
});
it("late opt-in uses explicit Never after reduced startup", async () => {
  const view = render(fixture());
  await preference(true);
  fireEvent(trigger(view), "focus");
  act(() => changed(false));
  expect(ownTimings().at(-1)).toEqual([1, { duration: 180, reduceMotion: Reanimated.ReduceMotion.Never }]);
});
it.each([false, true])("preserves RTL=%s offset, prevented press and route-close behavior", async (rtl) => {
  const view = render(fixture(rtl));
  await preference(true);
  expect(ReactNative.StyleSheet.flatten(panel(view).props.style).transform).toEqual([{ translateX: rtl ? 24 : -24 }]);
  fireEvent(trigger(view), "focus");
  event(view, "Mushaf");
  expect(pressed).toHaveBeenCalledTimes(1);
  expect(hidden()).toBe(0);
  expect(view.getByRole("button", { name: "Home" }).props.accessibilityState.selected).toBe(true);
  expect(view.getByText("Home screen")).toBeTruthy();
});
it("immersive mode removes the panel and returns closed", async () => {
  const view = render(fixture());
  await preference(true);
  fireEvent(trigger(view), "focus");
  event(view, "Immersive on");
  expect(hidden()).toBe(0);
  expect(view.UNSAFE_root.findAll((n) => Boolean(n.props.onHoverIn))).toHaveLength(0);
  event(view, "Immersive off");
  expect(panel(view).props.pointerEvents).toBe("none");
});
it("unmount clears pending hide and releases the shared observer", async () => {
  const observer = renderHook(() => useReducedMotionPreference());
  const view = render(fixture());
  await preference(true);
  const timers = jest.spyOn(global, "setTimeout");
  const cleared = jest.spyOn(global, "clearTimeout");
  fireEvent(trigger(view), "focus");
  fireEvent(trigger(view), "blur");
  const handle = timers.mock.results.at(-1)?.value;
  expect(timers.mock.calls.at(-1)?.[1]).toBe(180);
  view.unmount();
  expect(remove).not.toHaveBeenCalled();
  observer.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(cleared).toHaveBeenCalledWith(handle);
});
it("1024px uses the persistent sidebar instead of floating timing", async () => {
  dimensions.mockReturnValue({ width: 1024, height: 900, scale: 1, fontScale: 1 });
  const view = render(fixture());
  await preference(false);
  expect(view.UNSAFE_root.findAll((n) => Boolean(n.props.onHoverIn))).toHaveLength(0);
  expect(ownTimings()).toHaveLength(0);
});
