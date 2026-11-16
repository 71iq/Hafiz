import React from "react";
import * as ReactNative from "react-native";
import { AccessibilityInfo, BackHandler, Pressable, Text, View } from "react-native";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react-native";
import { NavigationContainer, NavigationIndependentTree } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import * as Reanimated from "react-native-reanimated";
import { AppNavigation } from "@/components/ui/AppNavigation";
import { ChromeProvider, useChrome } from "@/lib/ui/chrome";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";

let mockValues: { initial: number; shared: { value: number } }[];
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
jest.mock("expo-router", () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
const Tabs = createBottomTabNavigator<{ home: undefined; mushaf: undefined }>();
let initialRoute: "home" | "mushaf" = "home";
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
            initialRouteName={initialRoute}
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
  initialRoute = "home";
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
  return view.getByRole("button", { name: "Navigation menu" });
}
function outside(view: ReturnType<typeof render>) {
  return view.queryByTestId("navigation-outside-layer", { includeHiddenElements: true });
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
  expect(outside(view)).toBeNull();
  expect(ownTimings()).toHaveLength(0);
});
it("opens only by press; hover and focus never open it and there is no hover edge", () => {
  const view = render(fixture());
  const node = trigger(view);
  expect(node.props.onHoverIn).toBeUndefined();
  expect(view.UNSAFE_root.findAll((n) => n.props.onHoverIn && n.props.style?.width === 16)).toHaveLength(0);
  fireEvent(node, "focus");
  expect(hidden()).toBe(0);
  fireEvent.press(node);
  expect(hidden()).toBe(1);
  expect(panel(view).props.pointerEvents).toBe("auto");
  expect(trigger(view).props.accessibilityState).toEqual({ expanded: true });
  expect(ownTimings()).toHaveLength(0);
});
it("gives the trigger a 44px target with a localized name", () => {
  const view = render(fixture());
  expect(ReactNative.StyleSheet.flatten(trigger(view).props.style).width).toBeGreaterThanOrEqual(44);
});
it("the first outside press only dismisses through a capturing layer above the content", async () => {
  const view = render(fixture());
  await preference(true);
  fireEvent.press(trigger(view));
  const layer = outside(view);
  expect(layer).not.toBeNull();
  expect(ReactNative.StyleSheet.flatten(layer!.props.style)).toEqual(
    expect.objectContaining({ top: 0, bottom: 0, left: 0, right: 0, zIndex: 50 }),
  );
  fireEvent.press(layer!);
  expect(hidden()).toBe(0);
  expect(outside(view)).toBeNull();
  expect(view.getByText("Home screen")).toBeTruthy();
});
it("the labeled Close button and Android Back dismiss it", async () => {
  const handlers: (() => boolean)[] = [];
  const remove = jest.fn();
  jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, handler) => {
    handlers.push(handler as () => boolean);
    return { remove };
  });
  const view = render(fixture());
  await preference(true);
  fireEvent.press(trigger(view));
  event(view, "Close navigation");
  expect(hidden()).toBe(0);
  fireEvent.press(trigger(view));
  let handled = false;
  act(() => {
    handled = handlers.at(-1)!();
  });
  expect(handled).toBe(true);
  expect(hidden()).toBe(0);
  expect(remove).toHaveBeenCalled();
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
it.each([false, true])("preserves RTL=%s offset, prevented press and closes on destination", async (rtl) => {
  const view = render(fixture(rtl));
  await preference(true);
  expect(ReactNative.StyleSheet.flatten(panel(view).props.style).transform).toEqual([{ translateX: rtl ? 24 : -24 }]);
  fireEvent.press(trigger(view));
  event(view, "Mushaf");
  expect(pressed).toHaveBeenCalledTimes(1);
  expect(hidden()).toBe(0);
  expect(view.getByText("Home screen")).toBeTruthy();
});
it("lists Search with the destinations", async () => {
  const view = render(fixture());
  await preference(true);
  fireEvent.press(trigger(view));
  expect(view.getByRole("button", { name: "Search" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Home" }).props.accessibilityState.selected).toBe(true);
});
it("immersive mode removes the panel and returns closed", async () => {
  const view = render(fixture());
  await preference(true);
  fireEvent.press(trigger(view));
  event(view, "Immersive on");
  expect(hidden()).toBe(0);
  expect(view.queryByRole("button", { name: "Navigation menu" })).toBeNull();
  event(view, "Immersive off");
  expect(panel(view).props.pointerEvents).toBe("none");
});
it("hidden reader chrome hides the trigger", async () => {
  const view = render(fixture());
  await preference(true);
  event(view, "Hide");
  expect(view.queryByRole("button", { name: "Navigation menu" })).toBeNull();
  event(view, "Show");
  expect(trigger(view)).toBeTruthy();
});
it("unmount releases the shared observer", async () => {
  const observer = renderHook(() => useReducedMotionPreference());
  const view = render(fixture());
  await preference(true);
  view.unmount();
  expect(remove).not.toHaveBeenCalled();
  observer.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
it("1024px uses the nonmodal persistent sidebar without an outside layer", async () => {
  dimensions.mockReturnValue({ width: 1024, height: 900, scale: 1, fontScale: 1 });
  const view = render(fixture());
  await preference(false);
  expect(view.queryByRole("button", { name: "Navigation menu" })).toBeNull();
  expect(outside(view)).toBeNull();
  expect(view.getByRole("button", { name: "Search" })).toBeTruthy();
  expect(ownTimings()).toHaveLength(0);
});
it("wide Mushaf keeps the edge trigger instead of hiding navigation", async () => {
  dimensions.mockReturnValue({ width: 1440, height: 900, scale: 1, fontScale: 1 });
  initialRoute = "mushaf";
  const view = render(fixture());
  await preference(true);
  expect(view.getByText("Mushaf screen")).toBeTruthy();
  fireEvent.press(trigger(view));
  expect(outside(view)).not.toBeNull();
});
