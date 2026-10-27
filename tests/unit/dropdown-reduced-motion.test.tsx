import React from "react";
import { AccessibilityInfo, Modal, StyleSheet } from "react-native";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react-native";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";

jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({ isDark: false, isRTL: false, themeColors: { surface: "#fdf8f1", surfaceLow: "#eee" } }),
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

const select = jest.fn();
const disabledSelect = jest.fn();
const items = [
  { key: "one", label: "Select", onPress: select },
  { key: "disabled", label: "Disabled", disabled: true, onPress: disabledSelect },
];
let measure: jest.Mock;
function menu(props: Partial<React.ComponentProps<typeof DropdownMenu>> = {}) {
  return <DropdownMenu triggerLabel="Card actions" items={items} {...props} />;
}
function setup(props: Partial<React.ComponentProps<typeof DropdownMenu>> = {}) {
  measure = jest.fn((cb: (x: number, y: number, w: number, h: number) => void) => cb(100, 120, 32, 32));
  const view = render(menu(props));
  jest.spyOn(view.UNSAFE_getByProps({ collapsable: false }).instance, "measureInWindow").mockImplementation(measure);
  return view;
}
function modal(view: ReturnType<typeof setup>) {
  return view.UNSAFE_queryByType(Modal);
}
function open(view: ReturnType<typeof setup>) {
  fireEvent.press(view.getByRole("button", { name: "Card actions" }));
}

it("keeps an unknown closed menu static", () => {
  const view = setup();
  expect(modal(view)?.props.visible).toBe(false);
  expect(modal(view)?.props.animationType).toBe("none");
  expect(measure).not.toHaveBeenCalled();
});
it("opens without motion while initial preference is unknown", () => {
  const view = setup();
  open(view);
  expect(modal(view)?.props.visible).toBe(true);
  expect(modal(view)?.props.animationType).toBe("none");
  expect(measure).toHaveBeenCalledTimes(1);
  expect(view.getByRole("menuitem", { name: "Select" })).toBeTruthy();
});
it("keeps reduced opening and closing static", async () => {
  const view = setup();
  await preference(true);
  open(view);
  expect(modal(view)?.props.animationType).toBe("none");
  act(() => modal(view)?.props.onRequestClose());
  expect(modal(view)?.props.visible).toBe(false);
  expect(select).not.toHaveBeenCalled();
});
it("retains the original allowed fade and hidden Modal lifecycle", async () => {
  const view = setup();
  await preference(false);
  expect(modal(view)?.props.visible).toBe(false);
  expect(modal(view)?.props.animationType).toBe("fade");
  open(view);
  expect(modal(view)?.props.visible).toBe(true);
  expect(modal(view)?.props.transparent).toBe(true);
  expect(modal(view)?.props.statusBarTranslucent).toBe(true);
  act(() => modal(view)?.props.onRequestClose());
  expect(modal(view)?.props.visible).toBe(false);
  expect(modal(view)?.props.animationType).toBe("fade");
});
it("cancels a live opening fade without changing anchor, items or selecting", async () => {
  const view = setup();
  await preference(false);
  open(view);
  const firstLabel = view.getByRole("menuitem", { name: "Select" }).props.accessibilityLabel;
  act(() => changed(true));
  expect(modal(view)?.props.visible).toBe(true);
  expect(modal(view)?.props.animationType).toBe("none");
  expect(view.getByRole("menuitem", { name: "Select" }).props.accessibilityLabel).toBe(firstLabel);
  expect(measure).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
});
it("keeps a closed Modal hidden when reduction interrupts its fade-out", async () => {
  const view = setup();
  await preference(false);
  open(view);
  act(() => modal(view)?.props.onRequestClose());
  expect(modal(view)?.props.visible).toBe(false);
  act(() => changed(true));
  expect(modal(view)?.props.visible).toBe(false);
  expect(select).not.toHaveBeenCalled();
});
it("restores allowed motion on a live opt-in without remeasuring or selecting", async () => {
  const view = setup();
  await preference(true);
  open(view);
  act(() => changed(false));
  expect(modal(view)?.props.visible).toBe(true);
  expect(modal(view)?.props.animationType).toBe("fade");
  expect(measure).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
});
it.each([true, false])("closes before scheduling selection with reduced=%s", async (reduced) => {
  const view = setup();
  await preference(reduced);
  open(view);
  const frames: FrameRequestCallback[] = [];
  jest.spyOn(global, "requestAnimationFrame").mockImplementation((cb) => {
    frames.push(cb);
    return 1;
  });
  fireEvent.press(view.getByRole("menuitem", { name: "Select" }));
  expect(modal(view)?.props.visible ?? false).toBe(false);
  expect(select).not.toHaveBeenCalled();
  expect(frames).toHaveLength(1);
  act(() => frames[0](0));
  expect(select).toHaveBeenCalledTimes(1);
});
it("disabled items do not close or schedule selection", async () => {
  const view = setup();
  await preference(true);
  open(view);
  const raf = jest.spyOn(global, "requestAnimationFrame");
  fireEvent.press(view.getByRole("menuitem", { name: "Disabled" }));
  expect(modal(view)?.props.visible).toBe(true);
  expect(disabledSelect).not.toHaveBeenCalled();
  expect(raf).not.toHaveBeenCalled();
});
it.each([{ disabled: true }, { items: [] }])("does not measure or open unavailable trigger %j", (props) => {
  const view = setup(props);
  open(view);
  expect(measure).not.toHaveBeenCalled();
  expect(modal(view)?.props.visible).toBe(false);
});
it("actual backdrop dismisses without scheduling an item", async () => {
  const view = setup();
  await preference(true);
  open(view);
  const close = modal(view)?.props.onRequestClose;
  expect(typeof close).toBe("function");
  fireEvent.press(view.UNSAFE_getAllByProps({ onPress: close })[0]);
  expect(modal(view)?.props.visible).toBe(false);
  expect(select).not.toHaveBeenCalled();
});
it.each([true, false])("preserves item direction for explicit RTL=%s", async (isRTL) => {
  const view = setup({ isRTL });
  await preference(true);
  open(view);
  const row = view.getByRole("menuitem", { name: "Select" });
  const style = StyleSheet.flatten(row.props.style);
  expect(style.direction).toBe("ltr");
  expect(style.flexDirection).toBe(isRTL ? "row-reverse" : "row");
});
it("shares the preference observer until the final consumer unmounts", async () => {
  const observer = renderHook(() => useReducedMotionPreference());
  const view = setup();
  await preference(true);
  expect(listen).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(remove).not.toHaveBeenCalled();
  observer.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
