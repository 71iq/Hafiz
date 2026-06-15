import React from "react";
import { Text as RNText, View } from "react-native";
import { useForm } from "react-hook-form";
import { fireEvent } from "@testing-library/react-native";
import { Button } from "@/components/ui/Button";
import { Field, FieldMessage, Label } from "@/components/ui/Field";
import { FormTextField } from "@/components/ui/FormTextField";
import { Input } from "@/components/ui/Input";
import { DisclosureRow, MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { textAlignForDirection } from "@/lib/ui/direction";
import {
  expectFlexDirectionForDir,
  expectTextAlignStart,
  expectWritingDirection,
  flattenStyle,
  getStyleValue,
  renderWithDirection,
  type RtlTestNode,
} from "../rtl/rtl-test-utils";

type TestFormValues = {
  email: string;
};

function TestFormTextField({ dir = "rtl" as const, error = "Required" }) {
  const { control } = useForm<TestFormValues>({
    defaultValues: { email: "hafiz@example.com" },
  });

  return (
    <FormTextField
      control={control}
      name="email"
      label="Email"
      error={error}
      dir={dir}
      inputProps={{ testID: "form-email-input" }}
    />
  );
}

function findAncestorByClassName(node: RtlTestNode, token: string): RtlTestNode {
  let current = node.parent;
  while (current) {
    if (typeof current.props.className === "string" && current.props.className.includes(token)) {
      return current;
    }
    current = current.parent;
  }
  throw new Error(`No ancestor with className containing ${token}`);
}

describe("RTL primitive component contracts", () => {
  it("keeps direction helper start/center/end alignment stable", () => {
    expect(textAlignForDirection("ltr", "start")).toBe("left");
    expect(textAlignForDirection("rtl", "start")).toBe("right");
    expect(textAlignForDirection("ltr", "end")).toBe("right");
    expect(textAlignForDirection("rtl", "end")).toBe("left");
    expect(textAlignForDirection("ltr", "center")).toBe("center");
    expect(textAlignForDirection("rtl", "center")).toBe("center");
  });

  it("MirroredRow and DisclosureRow mirror physical row order in RTL", () => {
    const row = renderWithDirection(
      <MirroredRow testID="mirrored-row">
        <RNText>Leading</RNText>
        <RNText>Trailing</RNText>
      </MirroredRow>,
      "rtl"
    );
    const mirroredRow = row.getByTestId("mirrored-row");
    expect(mirroredRow.props.className).toContain("flex-row-reverse");
    expect(getStyleValue(mirroredRow, "direction")).toBe("ltr");
    expect(getStyleValue(mirroredRow, "flexDirection")).toBe("row-reverse");

    const disclosure = renderWithDirection(
      <DisclosureRow
        testID="disclosure-row"
        leading={<RNText>Icon</RNText>}
        trailing={<RNText>Chevron</RNText>}
      >
        <RNText>Value</RNText>
      </DisclosureRow>,
      "rtl"
    );
    const disclosureRow = disclosure.getByTestId("disclosure-row");
    const resolvedStyle = typeof disclosureRow.props.style === "function"
      ? flattenStyle(disclosureRow.props.style({ pressed: false }))
      : flattenStyle(disclosureRow.props.style);
    expect(resolvedStyle.direction).toBe("ltr");
    expect(resolvedStyle.flexDirection).toBe("row-reverse");
    expect(disclosureRow.props.className).toContain("flex-row-reverse");
    expect(disclosureRow.props.className).toContain("w-full");
    expect(disclosureRow.props.className).toContain("items-center");
    expect(disclosureRow.props.className).toContain("justify-between");
    expect(disclosureRow.props.className).toContain("gap-3");

    const content = findAncestorByClassName(disclosure.getByText("Value"), "min-w-0");
    expect(content.props.className).toContain("flex-1");
    expect(content.props.className).toContain("items-end");

    const trailing = findAncestorByClassName(disclosure.getByText("Chevron"), "shrink-0");
    expect(trailing.props.className).toContain("h-9");
    expect(trailing.props.className).toContain("w-9");
  });

  it("Text aligns to logical start and writes in the active direction", () => {
    const ltr = renderWithDirection(<Text>English</Text>, "ltr");
    const ltrText = ltr.getByText("English");
    expectTextAlignStart(ltrText, "ltr");
    expectWritingDirection(ltrText, "ltr");

    const rtl = renderWithDirection(<Text>العربية</Text>, "rtl");
    const rtlText = rtl.getByText("العربية");
    expectTextAlignStart(rtlText, "rtl");
    expectWritingDirection(rtlText, "rtl");

    const centered = renderWithDirection(<Text align="center">Centered</Text>, "rtl");
    expect(getStyleValue(centered.getByText("Centered"), "textAlign")).toBe("center");
  });

  it("Button mirrors row direction in RTL without horizontally mirroring press transforms", () => {
    const ltr = renderWithDirection(
      <Button label="Save" testID="save-button" />,
      "ltr"
    );
    const ltrButton = ltr.getByTestId("save-button");
    expect(ltrButton.props.className).toContain("flex-row");
    expect(ltrButton.props.className).toContain("gap-2");
    expect(ltrButton.props.className).not.toContain("flex-row-reverse");
    expectWritingDirection(ltr.getByText("Save"), "ltr");

    const rtl = renderWithDirection(
      <Button label="Save" testID="save-button" dir="rtl" />,
      "ltr"
    );
    const rtlButton = rtl.getByTestId("save-button");
    expect(rtlButton.props.className).toContain("flex-row-reverse");
    expectWritingDirection(rtl.getByText("Save"), "rtl");

    const resolvedStyle = typeof rtlButton.props.style === "function"
      ? flattenStyle(rtlButton.props.style({ pressed: true }))
      : flattenStyle(rtlButton.props.style);
    expect(resolvedStyle.transform).toEqual(expect.arrayContaining([{ scale: expect.any(Number) }]));
    expect(resolvedStyle.transform).not.toEqual(expect.arrayContaining([{ scaleX: -1 }]));
  });

  it("Field, Label, and FieldMessage align text and chrome to logical start", () => {
    const { getByTestId, getByText } = renderWithDirection(
      <Field testID="field">
        <Label>Name</Label>
        <FieldMessage>Required</FieldMessage>
      </Field>,
      "rtl"
    );

    const field = getByTestId("field");
    expect(field.props.className).toContain("items-end");
    expect(getStyleValue(field, "direction")).toBe("rtl");

    const label = getByText("Name");
    const message = getByText("Required");
    expectTextAlignStart(label, "rtl");
    expectWritingDirection(label, "rtl");
    expectTextAlignStart(message, "rtl");
    expectWritingDirection(message, "rtl");
  });

  it("Input aligns text start and swaps start/end icon chrome in RTL", () => {
    const { getByTestId } = renderWithDirection(
      <Input
        testID="search-input"
        dir="rtl"
        placeholder="Search"
        startIcon={<RNText testID="start-icon">S</RNText>}
        endIcon={<RNText testID="end-icon">E</RNText>}
      />,
      "ltr"
    );

    const input = getByTestId("search-input");
    const container = findAncestorByClassName(input, "flex-row-reverse");
    expect(container.props.className).toContain("flex-row-reverse");
    expectTextAlignStart(input, "rtl");
    expectWritingDirection(input, "rtl");
  });

  it("FormTextField passes direction through to Input and error text", () => {
    const { getByTestId, getByText } = renderWithDirection(<TestFormTextField />, "ltr");

    const input = getByTestId("form-email-input");
    expectTextAlignStart(input, "rtl");
    expectWritingDirection(input, "rtl");
    expect(input.props.value).toBe("hafiz@example.com");

    const error = getByText("Required");
    expectTextAlignStart(error, "rtl");
    expectWritingDirection(error, "rtl");
  });

  it("ToggleGroup mirrors the segmented row and preserves selected item state", () => {
    const onValueChange = jest.fn();
    const items = [
      { value: "text", label: "Text" },
      { value: "root", label: "Root" },
      { value: "page", label: "Page", icon: <View testID="page-icon" /> },
    ];

    const { UNSAFE_getByType, getByText } = renderWithDirection(
      <ToggleGroup
        testID="toggle"
        value="root"
        onValueChange={onValueChange}
        items={items}
      />,
      "rtl"
    );

    const container = UNSAFE_getByType(View);
    expect(container.props.className).toContain("flex-row-reverse");
    expectFlexDirectionForDir(container, "rtl");
    expect(getStyleValue(container, "direction")).toBe("ltr");

    const root = getByText("Root");
    const page = getByText("Page");
    expectWritingDirection(root, "rtl");
    const selectedButton = findAncestorByClassName(root, "bg-surface-bright");
    expect(selectedButton.props.className).toContain("bg-surface-bright");
    const iconButton = findAncestorByClassName(page, "gap-1.5");
    expect(iconButton.props.className).toContain("flex-row-reverse");
    expect(page.props.className).not.toContain("mr-1.5");
    expect(page.props.className).not.toContain("ml-1.5");

    fireEvent.press(selectedButton as any);
    expect(onValueChange).toHaveBeenCalledWith("root");
  });
});
