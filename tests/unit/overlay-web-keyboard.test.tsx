/**
 * @jest-environment jsdom
 */
import React, { act, type ReactNode } from "react";

// Renders through React Native Web into a DOM, as the web export does: focus, Escape and menu keys
// are browser behavior.
jest.mock("react-native", () => jest.requireActual("react-native-web"));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
const mockReduceMotion = jest.fn(() => true);
jest.mock("@/lib/ui/reduced-motion", () => ({ useReducedMotionPreference: () => mockReduceMotion() }));
// The overlay's crash boundary pulls in expo-router, which needs browser globals jsdom lacks.
jest.mock("@/components/ui/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    uiLanguage: "en",
    isRTL: false,
    isDark: false,
    effectiveTheme: "white",
    themeSurface: "#fff",
    themeColors: { surface: "#fff", surfaceLow: "#eee" },
  }),
}));

type Root = { render: (node: ReactNode) => void; unmount: () => void };
const { createRoot } = jest.requireActual<{ createRoot: (container: Element) => Root }>("react-dom/client");
const { OverlayBody, OverlayHeader, ResponsiveSheet, hasOpenOverlay } =
  require("@/components/ui/ResponsiveOverlay") as typeof import("@/components/ui/ResponsiveOverlay");
const { DropdownMenu } = require("@/components/ui/DropdownMenu") as typeof import("@/components/ui/DropdownMenu");
const { Text } = jest.requireActual<typeof import("react-native")>("react-native-web");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let frames: FrameRequestCallback[];
let deliverLayout: (target: Element) => void;
const originalResizeObserver = window.ResizeObserver;
beforeAll(() => {
  window.ResizeObserver = class implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      deliverLayout = (target) => callback([{ target } as ResizeObserverEntry], this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterAll(() => {
  window.ResizeObserver = originalResizeObserver;
});
beforeEach(() => {
  mockReduceMotion.mockReturnValue(true);
  frames = [];
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  jest.restoreAllMocks();
});

function show(node: ReactNode) {
  act(() => root.render(node));
  flushFrames();
}

function flushFrames() {
  for (let round = 0; round < 3 && frames.length > 0; round += 1) {
    act(() => frames.splice(0).forEach((frame) => frame(0)));
  }
}

function key(name: string, type = "keydown") {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  flushFrames();
  return event;
}

function sheet(
  title: string,
  onClose: () => void,
  extra: Partial<React.ComponentProps<typeof ResponsiveSheet>> = {},
  body?: ReactNode,
) {
  return (
    <ResponsiveSheet open onClose={onClose} {...extra}>
      <OverlayHeader title={title} onClose={onClose} />
      <OverlayBody>{body ?? <Text>{`${title} body`}</Text>}</OverlayBody>
    </ResponsiveSheet>
  );
}

it("moves focus to the title on open and back to the opener on close", () => {
  const opener = document.createElement("button");
  document.body.appendChild(opener);
  opener.focus();
  show(sheet("Private note", jest.fn()));
  expect(document.activeElement?.textContent).toBe("Private note");
  show(
    <ResponsiveSheet open={false} onClose={jest.fn()}>
      <Text>closed</Text>
    </ResponsiveSheet>,
  );
  expect(document.activeElement).toBe(opener);
  opener.remove();
});

it("lets only the topmost overlay handle Escape and keeps it from the reader", () => {
  const outer = jest.fn();
  const inner = jest.fn();
  const reader = jest.fn();
  window.addEventListener("keydown", reader);
  const tree = (innerDismisses: boolean) => (
    <>
      {sheet("Outer", outer)}
      {sheet("Inner", inner, { dismissOnEscape: innerDismisses })}
    </>
  );
  show(tree(false));
  expect(hasOpenOverlay()).toBe(true);
  // A topmost overlay that does not dismiss on Escape still consumes it.
  expect(key("Escape").defaultPrevented).toBe(true);
  expect(outer).not.toHaveBeenCalled();
  expect(inner).not.toHaveBeenCalled();
  show(tree(true));
  key("Escape");
  expect(inner).toHaveBeenCalledTimes(1);
  expect(outer).not.toHaveBeenCalled();
  expect(reader).not.toHaveBeenCalled();
  window.removeEventListener("keydown", reader);
  show(null);
  expect(hasOpenOverlay()).toBe(false);
});

async function openMenu(trigger: HTMLElement) {
  act(() => {
    trigger.focus();
    trigger.click();
  });
  // react-native-web measures the trigger on a timer.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const menu = document.querySelector('[role="menu"]')!;
  await act(async () => {
    deliverLayout(menu);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  flushFrames();
}

it.each([false, true])("drives a nested menu by keyboard with reduced motion=%s", async (reduceMotion) => {
  mockReduceMotion.mockReturnValue(reduceMotion);
  const sheetClose = jest.fn();
  const reader = jest.fn();
  const mark = jest.fn();
  const suspend = jest.fn();
  window.addEventListener("keydown", reader);
  const menu = (
    <DropdownMenu
      triggerLabel="Card actions"
      items={[
        { key: "mark", label: "Mark", onPress: mark },
        { key: "suspend", label: "Suspend", onPress: suspend },
        { key: "disabled", label: "Bury", onPress: jest.fn(), disabled: true },
        { key: "delete", label: "Delete", onPress: jest.fn(), destructive: true },
      ]}
    />
  );
  show(sheet("Deck cards", sheetClose, {}, menu));
  const trigger = document.querySelector<HTMLElement>('[aria-label="Card actions"]')!;
  await openMenu(trigger);
  const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(items().map((item) => item.getAttribute("aria-label"))).toEqual(["Mark", "Suspend", "Bury", "Delete"]);
  // The first destructive item is set apart by a divider.
  expect(getComputedStyle(items()[3]).borderTopWidth).toBe("1px");

  // The menu takes focus after placement even when no CSS animationend event is delivered.
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Mark");
  key("ArrowDown");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Suspend");
  key("End");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Delete");
  key("ArrowUp");
  // Disabled items are skipped.
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Suspend");
  key("Home");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Mark");
  key("PageDown");
  expect(reader).not.toHaveBeenCalled();

  key("Escape");
  key("Escape", "keyup");
  expect(items()).toHaveLength(0);
  expect(document.activeElement).toBe(trigger);
  expect(sheetClose).not.toHaveBeenCalled();

  await openMenu(trigger);
  key("ArrowDown");
  key("Enter");
  expect(items()).toHaveLength(0);
  expect(suspend).toHaveBeenCalledTimes(1);
  expect(mark).not.toHaveBeenCalled();
  expect(reader).not.toHaveBeenCalled();

  key("Escape");
  expect(sheetClose).toHaveBeenCalledTimes(1);
  window.removeEventListener("keydown", reader);
});

it("pads the page by the scrollbar width while scrolling is locked", () => {
  jest.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1009);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  document.body.style.paddingRight = "";
  show(sheet("Locked", jest.fn()));
  expect(document.body.style.overflow).toBe("hidden");
  expect(document.body.style.paddingRight).toBe("15px");
  show(null);
  expect(document.body.style.overflow).toBe("");
  expect(document.body.style.paddingRight).toBe("");
});
