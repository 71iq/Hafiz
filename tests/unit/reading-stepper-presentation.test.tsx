import React from "react";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Platform, StyleSheet, View } from "react-native";
import type { ReactTestInstance } from "react-test-renderer";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { Minus, Plus } from "lucide-react-native";
import { ReadingStepper } from "@/components/settings/ReadingStepper";

const cases = (["pill", "sheet"] as const).flatMap((variant) =>
  [false, true].flatMap((compact) =>
    [false, true].flatMap((isRTL) => [false, true].map((isDark) => ({ variant, compact, isRTL, isDark }))),
  ),
);
function controlStyle(node: ReactTestInstance, pressed: boolean) {
  let current: ReactTestInstance | null = node;
  while (current) {
    if (typeof current.props.style === "function") return StyleSheet.flatten(current.props.style({ pressed }));
    current = current.parent;
  }
  throw new Error("Missing original Pressable style callback");
}
afterEach(cleanup);
describe.each(cases)("$variant compact=$compact RTL=$isRTL dark=$isDark", (input) => {
  const value = input.isRTL ? "٥ / ١٠" : "supplied value";
  function open(decrementDisabled = false, incrementDisabled = false) {
    const onDecrement = jest.fn(),
      onIncrement = jest.fn();
    const view = render(
      <ReadingStepper
        {...input}
        value={value}
        decrementLabel="decrease"
        incrementLabel="increase"
        onDecrement={onDecrement}
        onIncrement={onIncrement}
        decrementDisabled={decrementDisabled}
        incrementDisabled={incrementDisabled}
      />,
    );
    return { view, onDecrement, onIncrement };
  }
  function expectedStyle(disabled: boolean, pressed: boolean) {
    const feedback = {
      opacity: disabled ? 0.35 : pressed ? 0.68 : 1,
      transform: [{ scale: pressed && !disabled ? 0.96 : 1 }],
    };
    return input.variant === "pill"
      ? { height: input.compact ? 30 : 36, ...feedback, width: input.compact ? 30 : 36 }
      : { ...feedback, cursor: Platform.OS === "web" ? (disabled ? "auto" : "pointer") : undefined };
  }
  it("preserves presentation, supplied text, direction, icon colors and pressed feedback", () => {
    const { view } = open();
    const root = view.UNSAFE_getAllByType(View)[0];
    expect(StyleSheet.flatten(root.props.style)).toEqual({
      direction: "ltr",
      flexDirection: input.isRTL ? "row-reverse" : "row",
    });
    expect(root.props.className).toBe(
      input.variant === "pill"
        ? "self-start rounded-full bg-surface-high dark:bg-surface-dark-high p-1"
        : "rounded-lg border border-warm-200/40 bg-surface-low/60 p-0.5 dark:border-neutral-800 dark:bg-surface-dark-high/70",
    );
    expect(view.getByText(value).props.style).toEqual(
      input.variant === "pill"
        ? { fontFamily: "Manrope_700Bold", fontSize: input.compact ? 13 : 14 }
        : { fontFamily: "Manrope_600SemiBold", fontSize: 12.5 },
    );
    for (const icon of [Minus, Plus]) {
      expect(view.UNSAFE_getByType(icon).props.size).toBe(input.variant === "pill" && !input.compact ? 17 : 15);
      expect(view.UNSAFE_getByType(icon).props.color).toBe(
        input.isDark ? "#d4d4d4" : input.variant === "pill" ? "#6e5a47" : "#6E6258",
      );
    }
    for (const label of ["decrease", "increase"]) {
      const control = view.getByRole("button", { name: label });
      expect(control.props.accessibilityState).toEqual({ disabled: false });
      expect(controlStyle(control, false)).toEqual(expectedStyle(false, false));
      expect(controlStyle(control, true)).toEqual(expectedStyle(false, true));
    }
    const capture = process.env.RF036_CAPTURE_DIR;
    if (capture) {
      mkdirSync(capture, { recursive: true });
      const key = [input.variant, input.compact, input.isRTL, input.isDark].join("-");
      writeFileSync(join(capture, key + ".json"), JSON.stringify(view.toJSON(), null, 2));
    }
  });
  it.each([false, true])("keeps action order and independent disabled states, decrease disabled=%s", (disabled) => {
    const { view, onDecrement, onIncrement } = open(disabled, !disabled);
    for (const [label, isDisabled] of [
      ["decrease", disabled],
      ["increase", !disabled],
    ] as const) {
      const control = view.getByRole("button", { name: label });
      expect(control.props.accessibilityState).toEqual({ disabled: isDisabled });
      expect(controlStyle(control, false)).toEqual(expectedStyle(isDisabled, false));
      expect(controlStyle(control, true)).toEqual(expectedStyle(isDisabled, true));
      fireEvent.press(control);
    }
    expect(onDecrement).toHaveBeenCalledTimes(disabled ? 0 : 1);
    expect(onIncrement).toHaveBeenCalledTimes(disabled ? 1 : 0);
  });
});
