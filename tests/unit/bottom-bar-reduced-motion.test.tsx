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
const longPressed = jest.fn();
function Body() {
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
            tabBar={(props) => <AppNavigation {...props} />}
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
                tabLongPress: longPressed,
              }}
            />
          </Tabs.Navigator>
        </NavigationContainer>
      </NavigationIndependentTree>
    </View>
  );
}
function fixture() {
  return (
    <ChromeProvider>
      <Body />
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
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(ReactNative, "useWindowDimensions").mockReturnValue({ width: 390, height: 900, scale: 1, fontScale: 1 });
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
  if (!owner) throw Error("Missing bottom bar shared value");
  return owner.shared.value;
}
function event(view: ReturnType<typeof render>, name: string) {
  fireEvent.press(view.getByRole("button", { name }));
}
function ownTimings() {
  return timing.mock.calls.filter((c) => c[1]?.duration === 200);
}
it("starts visible with unknown preference without timing", () => {
  render(fixture());
  expect(hidden()).toBe(0);
  expect(ownTimings()).toHaveLength(0);
});
it("snaps hidden under unknown preference", () => {
  const view = render(fixture());
  event(view, "Hide");
  expect(hidden()).toBe(1);
  expect(ownTimings()).toHaveLength(0);
});
it.each(["Hide", "Immersive on"])("snaps %s while reduced", async (action) => {
  const view = render(fixture());
  await preference(true);
  event(view, action);
  expect(hidden()).toBe(1);
  expect(ownTimings()).toHaveLength(0);
});
it("keeps a hidden bar hidden when show is requested during immersive mode", async () => {
  const view = render(fixture());
  await preference(true);
  event(view, "Hide");
  event(view, "Immersive on");
  event(view, "Show");
  expect(hidden()).toBe(1);
  event(view, "Immersive off");
  expect(hidden()).toBe(0);
  expect(ownTimings()).toHaveLength(0);
});
it("retains the exact allowed 200ms timing with explicit Never for both targets", async () => {
  const view = render(fixture());
  await preference(false);
  event(view, "Hide");
  expect(ownTimings().at(-1)?.[0]).toBe(1);
  expect(ownTimings().at(-1)?.[1]).toEqual({ duration: 200, reduceMotion: Reanimated.ReduceMotion.Never });
  event(view, "Show");
  expect(ownTimings().at(-1)?.[0]).toBe(0);
});
it("live reduction snaps latest hidden target without navigation", async () => {
  const view = render(fixture());
  await preference(false);
  event(view, "Hide");
  const count = ownTimings().length;
  act(() => changed(true));
  expect(hidden()).toBe(1);
  expect(ownTimings()).toHaveLength(count);
  expect(pressed).not.toHaveBeenCalled();
});
it("live reduction snaps the latest visible reversal", async () => {
  const view = render(fixture());
  await preference(false);
  event(view, "Hide");
  event(view, "Show");
  act(() => changed(true));
  expect(hidden()).toBe(0);
});
it("live opt-in after reduced startup uses Never for the latest target", async () => {
  const view = render(fixture());
  await preference(true);
  event(view, "Hide");
  act(() => changed(false));
  expect(ownTimings()).toHaveLength(1);
  expect(ownTimings()[0][0]).toBe(1);
  expect(ownTimings()[0][1]).toEqual({ duration: 200, reduceMotion: Reanimated.ReduceMotion.Never });
});
it("preserves prevented tab press and long-press delivery", async () => {
  const view = render(fixture());
  await preference(true);
  event(view, "Mushaf");
  expect(pressed).toHaveBeenCalledTimes(1);
  expect(view.getByRole("button", { name: "Home" }).props.accessibilityState.selected).toBe(true);
  expect(view.getByRole("button", { name: "Mushaf" }).props.accessibilityState.selected).not.toBe(true);
  expect(view.getByText("Home screen")).toBeTruthy();
  fireEvent(view.getByRole("button", { name: "Mushaf" }), "longPress");
  expect(longPressed).toHaveBeenCalledTimes(1);
  expect(view.getByText("Home screen")).toBeTruthy();
});
it("shares and releases the real preference observer", async () => {
  const observer = renderHook(() => useReducedMotionPreference());
  const view = render(fixture());
  await preference(true);
  expect(listen).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(remove).not.toHaveBeenCalled();
  observer.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
