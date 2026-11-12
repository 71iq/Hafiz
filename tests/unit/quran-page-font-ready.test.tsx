import React from "react";
import { act, render, renderHook } from "@testing-library/react-native";

let mockLoaded = new Set<number>();
let mockResolveLoad: (() => void) | null = null;

jest.mock("@/lib/fonts/loader", () => ({
  isQuranPageFontLoaded: (_style: string, page: number) => mockLoaded.has(page),
  loadQuranPageFont: (_style: string, page: number) =>
    new Promise<void>((resolve) => {
      mockResolveLoad = () => {
        mockLoaded.add(page);
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

import { useQuranPageFontReady } from "@/lib/fonts/use-quran-page-font";
import { Qcf2AyahText } from "@/components/flashcards/Qcf2AyahText";

beforeEach(() => {
  mockLoaded = new Set();
  mockResolveLoad = null;
});

describe("Quran page font readiness", () => {
  it("mounts review-card glyphs only after their page font is registered", async () => {
    const view = render(<Qcf2AyahText textQcf2={"\uFC7A \uFC7B \uFC7C"} v2Page={300} fontSize={28} lineHeight={48} />);
    // Android would draw and measure early glyphs in the system font and keep that measurement.
    expect(view.queryByText("\uFC7A", { includeHiddenElements: true })).toBeNull();

    await act(async () => mockResolveLoad?.());

    expect(view.getByText("\uFC7A")).toBeTruthy();
  });

  it("reports an already loaded font as ready without a pending pass", () => {
    mockLoaded.add(12);
    const seen: boolean[] = [];
    renderHook(() => {
      const ready = useQuranPageFontReady("qcf2", 12);
      seen.push(ready);
      return ready;
    });
    expect(seen.every(Boolean)).toBe(true);
  });

  it("is not ready without a page", () => {
    const { result } = renderHook(() => useQuranPageFontReady("qcf2", undefined));
    expect(result.current).toBe(false);
  });
});
