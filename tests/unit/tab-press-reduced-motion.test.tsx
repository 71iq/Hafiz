import React from "react";
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
  const [blocked, setBlocked] = React.useState(true);
  const c = useChrome();
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel="Hide" onPress={() => c.setVisible(false)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Show" onPress={() => c.setVisible(true)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Immersive on" onPress={() => c.setImmersive(true)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Immersive off" onPress={() => c.setImmersive(false)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Allow navigation" onPress={() => setBlocked(false)} />
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
                  if (blocked) event.preventDefault();
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
let spring: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(require("react-native"), "useWindowDimensions")
    .mockReturnValue({ width: 390, height: 900, scale: 1, fontScale: 1 });
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
  spring = jest.spyOn(Reanimated, "withSpring");
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
function scales() {
  const values = mockValues.filter((v) => v.initial === 1);
  expect(values).toHaveLength(2);
  return values.map((v) => v.shared.value);
}
function inFlight(index: number, value: number) {
  const owner = mockValues.filter((v) => v.initial === 1)[index];
  if (!owner) throw Error("Missing tab shared value");
  owner.shared.value = value;
}
function press(view: ReturnType<typeof render>, name: string, phase: "pressIn" | "pressOut") {
  fireEvent(view.getByRole("button", { name }), phase);
}
it("unknown starts at rest without scheduling springs", () => {
  render(fixture());
  expect(scales()).toEqual([1, 1]);
  expect(spring).not.toHaveBeenCalled();
});
it("unknown press in/out keeps immediate feedback without springs", () => {
  const view = render(fixture());
  press(view, "Mushaf", "pressIn");
  expect(scales()).toEqual([1, 0.98]);
  press(view, "Mushaf", "pressOut");
  expect(scales()).toEqual([1, 1]);
  expect(spring).not.toHaveBeenCalled();
});
it("reduced press in/out preserves exact feedback endpoints", async () => {
  const view = render(fixture());
  await preference(true);
  press(view, "Mushaf", "pressIn");
  expect(scales()).toEqual([1, 0.98]);
  press(view, "Mushaf", "pressOut");
  expect(scales()).toEqual([1, 1]);
  expect(spring).not.toHaveBeenCalled();
});
it("allowed keeps exact spring parameters and Never for both targets", async () => {
  const view = render(fixture());
  await preference(false);
  press(view, "Mushaf", "pressIn");
  press(view, "Mushaf", "pressOut");
  expect(spring.mock.calls).toEqual([
    [0.98, { damping: 15, stiffness: 400, reduceMotion: Reanimated.ReduceMotion.Never }],
    [1, { damping: 15, stiffness: 400, reduceMotion: Reanimated.ReduceMotion.Never }],
  ]);
});
it.each(["pressIn", "pressOut"] as const)(
  "live reduction retains latest %s target without new spring",
  async (phase) => {
    const view = render(fixture());
    await preference(false);
    press(view, "Mushaf", "pressIn");
    if (phase === "pressOut") press(view, "Mushaf", "pressOut");
    const count = spring.mock.calls.length;
    inFlight(1, 0.99);
    act(() => changed(true));
    expect(scales()[1]).toBe(phase === "pressIn" ? 0.98 : 1);
    expect(spring).toHaveBeenCalledTimes(count);
  },
);
it("rapid allowed reversals preserve current target when reduced", async () => {
  const view = render(fixture());
  await preference(false);
  press(view, "Mushaf", "pressIn");
  press(view, "Mushaf", "pressOut");
  press(view, "Mushaf", "pressIn");
  inFlight(1, 0.99);
  act(() => changed(true));
  expect(scales()).toEqual([1, 0.98]);
  expect(spring).toHaveBeenCalledTimes(3);
});
it("opt-in while held does not restart feedback and release uses Never", async () => {
  const view = render(fixture());
  await preference(true);
  press(view, "Mushaf", "pressIn");
  act(() => changed(false));
  expect(scales()[1]).toBe(0.98);
  expect(spring).not.toHaveBeenCalled();
  press(view, "Mushaf", "pressOut");
  expect(spring.mock.calls).toEqual([
    [1, { damping: 15, stiffness: 400, reduceMotion: Reanimated.ReduceMotion.Never }],
  ]);
});
it("preference changes at rest schedule no spring", async () => {
  render(fixture());
  await preference(true);
  act(() => changed(false));
  act(() => changed(true));
  expect(scales()).toEqual([1, 1]);
  expect(spring).not.toHaveBeenCalled();
});
it("each tab keeps its own target through live reduction", async () => {
  const view = render(fixture());
  await preference(false);
  press(view, "Home", "pressIn");
  press(view, "Mushaf", "pressIn");
  press(view, "Home", "pressOut");
  inFlight(0, 0.995);
  inFlight(1, 0.99);
  act(() => changed(true));
  expect(scales()).toEqual([1, 0.98]);
});
it("feedback preserves prevented tabPress, selection and longPress delivery", async () => {
  const view = render(fixture());
  await preference(true);
  press(view, "Mushaf", "pressIn");
  press(view, "Mushaf", "pressOut");
  expect(pressed).not.toHaveBeenCalled();
  expect(longPressed).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole("button", { name: "Mushaf" }));
  expect(pressed).toHaveBeenCalledTimes(1);
  expect(view.getByRole("button", { name: "Home" }).props.accessibilityState.selected).toBe(true);
  fireEvent(view.getByRole("button", { name: "Mushaf" }), "longPress");
  expect(longPressed).toHaveBeenCalledTimes(1);
  expect(pressed).toHaveBeenCalledTimes(1);
});
it("accepted real navigation selects Mushaf and retains press callbacks", async () => {
  const view = render(fixture());
  await preference(true);
  fireEvent.press(view.getByRole("button", { name: "Allow navigation" }));
  fireEvent.press(view.getByRole("button", { name: "Mushaf" }));
  expect(pressed).toHaveBeenCalledTimes(1);
  expect(view.getByRole("button", { name: "Mushaf" }).props.accessibilityState.selected).toBe(true);
  expect(view.getByRole("button", { name: "Home" }).props.accessibilityState.selected).not.toBe(true);
});
it("bar and both tabs share one observer and release after unmount", async () => {
  const observer = renderHook(() => useReducedMotionPreference());
  const view = render(fixture());
  await preference(true);
  expect(listen).toHaveBeenCalledTimes(1);
  press(view, "Mushaf", "pressIn");
  view.unmount();
  expect(remove).not.toHaveBeenCalled();
  observer.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
