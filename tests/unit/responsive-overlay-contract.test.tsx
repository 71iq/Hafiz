import React from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { OverlayFooter, OverlayFooterLabel, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { placeDropdownMenu } from "@/components/ui/DropdownMenu";

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);

jest.mock("@/lib/ui/direction", () => ({
  ...jest.requireActual("@/lib/ui/direction"),
  useUIDirection: (dir?: "rtl" | "ltr") => dir ?? "ltr",
}));

jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    themeSurface: "#fdf8f1",
    themeColors: { surface: "#fdf8f1", surfaceLow: "#eee" },
    isDark: false,
    isRTL: false,
    effectiveTheme: "beige",
  }),
}));

jest.mock("@/lib/ui/reduced-motion", () => ({ useReducedMotionPreference: () => true }));

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function surfaceStyle(view: ReturnType<typeof render>) {
  const surfaces = view.UNSAFE_getAllByType(Animated.View);
  return StyleSheet.flatten(surfaces[surfaces.length - 1].props.style);
}

describe("sheet size", () => {
  it("fits a short phone sheet to its content up to the cap", () => {
    const view = render(
      <ResponsiveSheet open onClose={jest.fn()} maxHeight={600}>
        <Text>Short</Text>
      </ResponsiveSheet>,
    );
    const style = surfaceStyle(view);
    expect(style.maxHeight).toBe(600);
    expect(style.height).toBeUndefined();
  });

  it("keeps the cap as a fixed height for flex-laid-out sheets", () => {
    const view = render(
      <ResponsiveSheet open onClose={jest.fn()} maxHeight={600} phoneSheetHeight="max">
        <Text>Tabs</Text>
      </ResponsiveSheet>,
    );
    expect(surfaceStyle(view).height).toBe(600);
  });
});

describe("header", () => {
  it("has no grab handle and a 44px close button", () => {
    const close = jest.fn();
    const view = render(<OverlayHeader title="Notes" onClose={close} showHandle />);
    expect(view.UNSAFE_queryAllByProps({ className: "items-center pb-3" })).toHaveLength(0);
    const button = view.getByRole("button");
    expect(button.props.className).toContain("h-11 w-11");
    expect(view.getByRole("header")).toBeTruthy();
    fireEvent.press(button);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("footer", () => {
  function footer(width: number, labelHeight?: number) {
    const view = render(
      <OverlayFooter>
        <Text>Cancel</Text>
        <OverlayFooterLabel>Confirm</OverlayFooterLabel>
      </OverlayFooter>,
    );
    const actionsRow = () =>
      view
        .UNSAFE_getAllByType(View)
        .find((node) => typeof node.props.onLayout === "function" && node.props.className?.includes("w-full gap-3"))!;
    act(() => actionsRow().props.onLayout({ nativeEvent: { layout: { width, height: 44 } } }));
    if (labelHeight != null) {
      act(() =>
        view.getByText("Confirm").props.onLayout({ nativeEvent: { layout: { width: 100, height: labelHeight } } }),
      );
    }
    return StyleSheet.flatten(actionsRow().props.style).flexDirection;
  }

  it("keeps actions side by side when they fit", () => {
    expect(footer(480)).not.toBe("column-reverse");
  });

  it("stacks actions below 360px with the main action on top", () => {
    expect(footer(320)).toBe("column-reverse");
  });

  it("stacks actions when a label wraps", () => {
    expect(footer(480, 44)).toBe("column-reverse");
  });
});

describe("menu placement", () => {
  const anchor = { x: 300, y: 100, width: 32, height: 32 };
  const base = { anchor, menuWidth: 220, viewportWidth: 390, viewportHeight: 800, align: "end" as const };

  it("opens below the trigger when the measured menu fits", () => {
    expect(placeDropdownMenu({ ...base, menuHeight: 300 })).toEqual({ left: 112, top: 140 });
  });

  it("flips above when the measured menu does not fit below", () => {
    const low = { ...anchor, y: 600 };
    expect(placeDropdownMenu({ ...base, anchor: low, menuHeight: 300 }).top).toBe(292);
  });

  it("keeps a menu taller than either side on screen", () => {
    const middle = { ...anchor, y: 380 };
    const { top } = placeDropdownMenu({ ...base, anchor: middle, menuHeight: 700 });
    expect(top).toBeGreaterThanOrEqual(12);
    expect(top + 700).toBeLessThanOrEqual(788);
  });
});
