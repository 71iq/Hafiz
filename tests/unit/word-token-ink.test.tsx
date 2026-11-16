import React from "react";
import { Platform, StyleSheet, type StyleProp, type TextStyle } from "react-native";
import { render } from "@testing-library/react-native";
import { WordToken } from "@/components/mushaf/WordToken";

jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({ isDark: false, viewMode: "page", pageScroll: "vertical" }),
}));
jest.mock("@/components/mushaf/useWordTap", () => ({
  useWordTap: () => ({
    wordRef: { current: null },
    isTooltipSelected: false,
    isTouchInput: true,
    openDetail: jest.fn(),
    press: jest.fn(),
    longPress: jest.fn(),
  }),
}));

const RAHMAN = "ﱃ";

function renderWord(props: Partial<React.ComponentProps<typeof WordToken>> = {}) {
  return render(
    <WordToken
      glyph={RAHMAN}
      fontFamily="QCF2_P001"
      fontSize={30}
      lineHeight={54}
      surah={1}
      ayah={1}
      wordPos={3}
      v2Page={1}
      compactLayout
      {...props}
    />,
  );
}

const flat = (node: { props: { style?: unknown } }): TextStyle =>
  StyleSheet.flatten(node.props.style as StyleProp<TextStyle>) ?? {};

describe("RF-189 page-view word ink on Android", () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
  });

  it("draws the glyph in a wider layer so Android does not clip ink outside the advance", () => {
    Platform.OS = "android";
    const view = renderWord({ highlightColor: "#0d9488" });

    const [sizing, ink] = view.getAllByText(RAHMAN, { includeHiddenElements: true });
    expect(view.getAllByText(RAHMAN)).toHaveLength(1);
    expect(flat(sizing)).toMatchObject({ color: "transparent", backgroundColor: "#0d948820" });
    expect(flat(sizing).position).toBeUndefined();
    let layer = ink.parent;
    while (layer && String(layer.type) !== "View") layer = layer.parent;
    if (!layer) throw new Error("ink layer View not found");
    expect(layer.props.pointerEvents).toBe("none");
    expect(flat(layer)).toMatchObject({ position: "absolute", left: -60, right: -60 });
    expect(flat(ink)).toMatchObject({ paddingRight: 60, textAlign: "right" });
    expect(flat(ink).backgroundColor).toBeUndefined();
  });

  it("keeps the glyph on the word box when the word has padding, and keeps the word color", () => {
    Platform.OS = "android";
    const view = renderWord({ compactLayout: false });

    const [sizing, ink] = view.getAllByText(RAHMAN, { includeHiddenElements: true });
    expect(flat(sizing).paddingHorizontal).toBe(1);
    expect(flat(ink).paddingRight).toBe(62);
    expect(ink.props.className).toBe(sizing.props.className);
  });

  it("leaves hidden words as a blank underline", () => {
    Platform.OS = "android";
    const view = renderWord({ hidden: true });

    expect(view.getAllByText(RAHMAN, { includeHiddenElements: true })).toHaveLength(1);
    expect(flat(view.getByText(RAHMAN, { includeHiddenElements: true })).opacity).toBe(0);
  });

  it("keeps one text per word on the web", () => {
    Platform.OS = "web";
    const view = renderWord();

    expect(view.getAllByText(RAHMAN, { includeHiddenElements: true })).toHaveLength(1);
    expect(flat(view.getByText(RAHMAN)).color).toBeUndefined();
  });
});
