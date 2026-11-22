import React from "react";
import { Platform } from "react-native";
import { act, render, renderHook } from "@testing-library/react-native";
import { Qcf2AyahText } from "@/components/flashcards/Qcf2AyahText";
import type { QuranPageFontStyle } from "@/lib/fonts/loader";
import { useQuranPageFontReady } from "@/lib/fonts/use-quran-page-font";

let mockLoaded = new Set<string>();
let mockResolveLoad: (() => void) | null = null;

jest.mock("@/lib/fonts/loader", () => ({
  isQuranPageFontLoaded: (style: string, page: number) => mockLoaded.has(`${style}:${page}`),
  loadQuranPageFont: (style: string, page: number) =>
    new Promise<void>((resolve) => {
      mockResolveLoad = () => {
        mockLoaded.add(`${style}:${page}`);
        resolve();
      };
    }),
  quranPageFontName: (_style: string, page: number) => `QCF2_${page}`,
  quranPageFontPaletteStyle: () => ({}),
  quranPageMarkerFontPaletteStyle: () => ({}),
}));

jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    quranFontStyle: "qcf2",
    quranRenderFontStyle: "qcf2",
    showAyahMarkers: true,
    quranMarkerStyle: "auto",
    effectiveTheme: "white",
  }),
}));

beforeEach(() => {
  mockLoaded = new Set();
  mockResolveLoad = null;
});

afterEach(() => jest.restoreAllMocks());

describe("Quran page font readiness", () => {
  it("mounts review-card glyphs only after their page font is registered", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const verse = "عَمَّ يَتَسَآءَلُونَ";
    const view = render(
      <Qcf2AyahText textQcf2={"\uFC7A \uFC7B \uFC7C"} textUthmani={verse} v2Page={300} fontSize={28} lineHeight={48} />,
    );
    // Android would draw and measure early glyphs in the system font and keep that measurement.
    expect(view.queryByText("\uFC7A", { includeHiddenElements: true })).toBeNull();
    expect(view.queryByLabelText(verse)).toBeNull();

    await act(async () => mockResolveLoad?.());

    expect(view.getByLabelText(verse)).toHaveTextContent("\uFC7A \uFC7B \uFC7C");
  });

  it("reports an already loaded font as ready without a pending pass", () => {
    mockLoaded.add("qcf2:12");
    const seen: boolean[] = [];
    renderHook(() => {
      const ready = useQuranPageFontReady("qcf2", 12);
      seen.push(ready);
      return ready;
    });
    expect(seen.every(Boolean)).toBe(true);
  });

  it("waits for the new font before displaying glyphs when Tajweed colors are turned off", async () => {
    mockLoaded.add("v4-tajweed:12");
    const seen: boolean[] = [];
    const { rerender, result } = renderHook(({ style }: { style: QuranPageFontStyle }) => {
      const ready = useQuranPageFontReady(style, 12);
      seen.push(ready);
      return ready;
    }, { initialProps: { style: "v4-tajweed" } });

    expect(result.current).toBe(true);
    seen.length = 0;
    rerender({ style: "v4" });
    expect(seen).toEqual([false]);

    await act(async () => mockResolveLoad?.());
    expect(result.current).toBe(true);
  });

  it("is not ready without a page", () => {
    const { result } = renderHook(() => useQuranPageFontReady("qcf2", undefined));
    expect(result.current).toBe(false);
  });
});
