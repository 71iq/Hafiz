import React from "react";
import { StyleSheet, type StyleProp } from "react-native";
import { render, type RenderAPI } from "@testing-library/react-native";
import { DirectionProvider, type Direction } from "@/lib/ui/direction";

export type RtlTestNode = {
  props: Record<string, any>;
  parent?: RtlTestNode | null;
  type?: unknown;
};

export function renderWithDirection(ui: React.ReactElement, dir: Direction): RenderAPI {
  return render(<DirectionProvider dir={dir}>{ui}</DirectionProvider>);
}

export function flattenStyle(style: StyleProp<unknown>): Record<string, unknown> {
  return (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
}

export function getStyleValue(node: RtlTestNode, key: string): unknown {
  return flattenStyle(node.props.style)[key];
}

export function expectWritingDirection(node: RtlTestNode, dir: Direction) {
  expect(getStyleValue(node, "writingDirection")).toBe(dir);
}

export function expectTextAlignStart(node: RtlTestNode, dir: Direction) {
  expect(getStyleValue(node, "textAlign")).toBe(dir === "rtl" ? "right" : "left");
}

export function expectFlexDirectionForDir(node: RtlTestNode, dir: Direction) {
  expect(getStyleValue(node, "flexDirection")).toBe(dir === "rtl" ? "row-reverse" : "row");
}
