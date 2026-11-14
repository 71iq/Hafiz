import React from "react";
import { StyleSheet } from "react-native";
import { act, cleanup, render } from "@testing-library/react-native";
import { MushafPage, type PageLineLayout } from "@/components/mushaf/MushafPage";
import { shouldJustifyMushafLine } from "@/lib/mushaf/page-layout";

let mockMarkSimilarVerses = false;

jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    uiLanguage: "en",
    isDark: false,
    isLoaded: true,
    quranRenderFontStyle: "qcf2",
    quranMarkerStyle: "auto",
    showAyahMarkers: true,
    effectiveTheme: "white",
    markSimilarVerses: mockMarkSimilarVerses,
  }),
}));
jest.mock("@/lib/database/provider", () => ({ useDatabaseStatus: () => ({ db: {} }) }));
// The page's marks as the store returns them once read: ayah 2:5 has a memorized similar verse.
jest.mock("@/lib/hifz/use-similar-markers", () => ({
  useSimilarMarks: (_db: unknown, _page: number, enabled: boolean) => new Map(enabled ? [["2:5", []]] : []),
}));
jest.mock("@/lib/selection/context", () => ({
  useSelection: () => ({
    getHighlightColor: () => undefined,
    getWordHighlightColor: () => undefined,
    selectAyah: jest.fn(),
  }),
}));
jest.mock("@/components/mushaf/WordToken", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  return {
    WordToken: ({ glyph }: { glyph: string }) => ReactActual.createElement(Text, { style: { width: 30 } }, glyph),
  };
});
jest.mock("@/lib/fonts/loader", () => ({
  isSurahNameFontLoaded: () => true,
  loadSurahNameFont: async () => undefined,
  surahNameGlyph: () => undefined,
  surahNameBismillahGlyphs: () => "",
  surahNameFontName: () => "FixtureSurahFont",
  isQuranPageFontLoaded: () => true,
  loadQuranPageFont: async () => undefined,
  quranPageFontName: () => "FixturePageFont",
  quranPageFontPaletteStyle: () => ({}),
  quranPageMarkerFontPaletteStyle: () => ({}),
}));

describe("Mushaf page line spacing", () => {
  it("keeps the third ayah line on page 2 compact", () => {
    expect(shouldJustifyMushafLine(2, 5, false, 8)).toBe(false);
  });

  it("still justifies ordinary multi-word ayah lines", () => {
    expect(shouldJustifyMushafLine(3, 5, false, 7)).toBe(true);
  });

  it("does not justify centered or single-word lines", () => {
    expect(shouldJustifyMushafLine(2, 4, true, 4)).toBe(false);
    expect(shouldJustifyMushafLine(3, 10, false, 1)).toBe(false);
  });
});

describe("Mushaf page line with a similar-verse mark (MUT-02)", () => {
  // Synthetic glyphs: two words and a marker for 2:5, one word and a marker for 2:6, on one line.
  const ayahs = [
    { surah: 2, ayah: 5, textQcf2: "G-a G-b G-m5" },
    { surah: 2, ayah: 6, textQcf2: "G-c G-m6" },
  ];
  const lineLayout: PageLineLayout[] = [
    { line_number: 3, line_type: "ayah", is_centered: 0, first_word_id: 1, last_word_id: 5, surah_number: null },
  ];

  type Node = {
    type: string;
    props: Record<string, unknown> & { style?: unknown; testID?: string };
    children: (Node | string)[] | null;
  };
  const children = (node: Node) => (node.children ?? []).filter((child): child is Node => typeof child !== "string");
  const styleOf = (node: Node): Record<string, unknown> =>
    (StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]) as Record<string, unknown>) ?? {};
  function find(node: Node, test: (node: Node) => boolean): Node | null {
    if (test(node)) return node;
    for (const child of children(node)) {
      const found = find(child, test);
      if (found) return found;
    }
    return null;
  }

  const element = (key: string) =>
    React.createElement(MushafPage, {
      key,
      pageNumber: 3,
      ayahs,
      surahMap: new Map(),
      fontSize: 20,
      lineHeight: 44,
      width: 390,
      lineLayout,
      globalWordOffset: 0,
      usePageWords: false,
      onOpenAyahDetail: jest.fn(),
      onOpenSimilarVerses: jest.fn(),
    });

  async function lineOf(view: ReturnType<typeof render>) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const tree = view.toJSON() as Node;
    const line = find(tree, (node) => styleOf(node).flexDirection === "row-reverse" && styleOf(node).height === 44);
    if (!line) throw new Error("The page line did not render");
    return { tree, line };
  }

  afterEach(() => {
    cleanup();
    mockMarkSimilarVerses = false;
  });

  it("draws the mark out of flow, so the line and its words keep their layout", async () => {
    mockMarkSimilarVerses = false;
    const view = render(element("plain"));
    const plain = await lineOf(view);
    const lineStyle = styleOf(plain.line);
    const itemStyles = children(plain.line).map(styleOf);
    expect(find(plain.tree, (node) => node.props.testID === "similar-verse-marker")).toBeNull();

    // A new key remounts the memoized page with the marks on.
    mockMarkSimilarVerses = true;
    view.rerender(element("marked"));
    const marked = await lineOf(view);
    const mark = find(marked.tree, (node) => node.props.testID === "similar-verse-marker");
    expect(mark).not.toBeNull();

    // The line row and every flex item in it (words and ayah end markers) keep their styles; the
    // marked marker only gains a stacking order, which does not affect layout.
    expect(styleOf(marked.line)).toEqual(lineStyle);
    const markedItems = children(marked.line).map(styleOf);
    expect(markedItems).toHaveLength(itemStyles.length);
    markedItems.forEach((style, index) => {
      const { zIndex, ...rest } = style;
      expect(rest).toEqual(itemStyles[index]);
      if (zIndex !== undefined) expect(zIndex).toBe(1);
    });

    // The mark sits in an absolutely positioned layer inside the 2:5 marker, with a 44 px target.
    const layer = find(marked.line, (node) => children(node).includes(mark as Node));
    expect(styleOf(layer as Node)).toMatchObject({ position: "absolute", left: 0, right: 0 });
    expect(styleOf(mark as Node)).toMatchObject({ width: 44 });
    expect(Number(styleOf(mark as Node).height)).toBeGreaterThanOrEqual(44);
    expect(find(marked.line, (node) => node.props.testID === "similar-verse-marker" && node !== mark)).toBeNull();
  });
});
