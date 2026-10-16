import React from "react";
import { Pressable, Text } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { Button } from "@/components/ui/Button";
import { DirectionProvider } from "@/lib/ui/direction";

jest.unmock("@rn-primitives/slot");

describe("Button accessibility", () => {
  it("gives label and custom children a default button role", () => {
    const labelButton = render(<Button label="Save date" />);
    expect(labelButton.getByRole("button", { name: "Save date" })).toBeTruthy();

    const childrenButton = render(
      <Button>
        <Text>Save custom date</Text>
      </Button>,
    );
    expect(childrenButton.getByRole("button", { name: "Save custom date" })).toBeTruthy();
  });

  it("keeps accessible Arabic naming in RTL", () => {
    const screen = render(
      <DirectionProvider dir="rtl">
        <Button label="حفظ التاريخ" />
      </DirectionProvider>,
    );

    expect(screen.getByRole("button", { name: "حفظ التاريخ" })).toBeTruthy();
    expect(screen.getByText("حفظ التاريخ").props.style).toEqual(expect.objectContaining({ writingDirection: "rtl" }));
  });

  it("presses enabled controls and exposes disabled state", () => {
    const onPress = jest.fn();
    const enabled = render(<Button label="Enabled" onPress={onPress} />);
    const enabledButton = enabled.getByRole("button", { name: "Enabled", disabled: false });

    fireEvent.press(enabledButton);
    expect(onPress).toHaveBeenCalledTimes(1);

    const disabledPress = jest.fn();
    const disabled = render(<Button label="Disabled" disabled onPress={disabledPress} />);
    const disabledButton = disabled.getByRole("button", { name: "Disabled", disabled: true });

    fireEvent.press(disabledButton);
    expect(disabledPress).not.toHaveBeenCalled();
    expect(disabledButton.props.accessibilityState?.disabled).toBe(true);
  });

  it("preserves explicit accessibilityRole and native role precedence", () => {
    const link = render(<Button label="Read details" accessibilityRole="link" />);
    expect(link.getByRole("link", { name: "Read details" })).toBeTruthy();
    expect(link.queryByRole("button", { name: "Read details" })).toBeNull();

    const none = render(<Button label="Decorative" accessibilityRole="none" testID="none-control" />);
    expect(none.getByTestId("none-control").props.accessibilityRole).toBe("none");
    expect(none.queryByRole("button", { name: "Decorative" })).toBeNull();

    const nativeRole = render(<Button label="Open details" accessibilityRole="button" role="link" />);
    expect(nativeRole.getByRole("link", { name: "Open details" })).toBeTruthy();
    expect(nativeRole.queryByRole("button", { name: "Open details" })).toBeNull();
  });

  it("keeps real Slot child ownership and callback ordering", () => {
    const calls: string[] = [];
    const screen = render(
      <Button asChild accessibilityLabel="Parent label" onPress={() => calls.push("parent")}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Child label"
          testID="child-link"
          onPress={() => calls.push("child")}
        >
          <Text>Read details</Text>
        </Pressable>
      </Button>,
    );

    const child = screen.getByRole("link", { name: "Child label" });
    expect(child.props.testID).toBe("child-link");
    expect(child.props.accessibilityLabel).toBe("Child label");
    expect(screen.queryByRole("button", { name: "Child label" })).toBeNull();

    fireEvent.press(child);
    expect(calls).toEqual(["child", "parent"]);
  });

  it("does not add a default role to asChild and forwards an explicit parent role", () => {
    const plainChild = render(
      <Button asChild>
        <Pressable testID="plain-child">
          <Text>Plain child</Text>
        </Pressable>
      </Button>,
    );
    expect(plainChild.queryByRole("button", { name: "Plain child" })).toBeNull();
    expect(plainChild.getByTestId("plain-child").props.accessibilityRole).toBeUndefined();

    const explicitParent = render(
      <Button asChild accessibilityRole="link" accessibilityLabel="Parent link">
        <Pressable testID="parent-role-child">
          <Text>Child content</Text>
        </Pressable>
      </Button>,
    );
    expect(explicitParent.getByRole("link", { name: "Parent link" })).toBeTruthy();
    expect(explicitParent.queryByRole("button", { name: "Parent link" })).toBeNull();
  });
});
