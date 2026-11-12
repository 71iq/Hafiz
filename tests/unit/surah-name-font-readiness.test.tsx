import React from "react";
import { Dimensions, I18nManager, StyleSheet } from "react-native";
import { act, cleanup, render } from "@testing-library/react-native";
import { SurahHeader } from "@/components/mushaf/SurahHeader";
import { MushafPage, type PageLineLayout } from "@/components/mushaf/MushafPage";
import { isSurahNameFontLoaded, loadSurahNameFont, surahNameGlyph } from "@/lib/fonts/loader";
import type { useSettings } from "@/lib/settings/context";

const mockSettings: Pick<
  ReturnType<typeof useSettings>,
  "uiLanguage" | "isDark" | "quranFontStyle" | "quranRenderFontStyle" | "quranMarkerStyle" | "showAyahMarkers" | "effectiveTheme"
> = {
  uiLanguage: "ar",
  isDark: false,
  quranFontStyle: "qcf2",
  quranRenderFontStyle: "qcf2",
  quranMarkerStyle: "auto",
  showAyahMarkers: true,
  effectiveTheme: "beige",
};
const name = "Synthetic surah name";
const decorative = "SYNTHETIC-NAME";
const bismillah = "SYNTHETIC-BISMILLAH";
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");
const layout: PageLineLayout[] = [
  { line_number: 1, line_type: "basmallah", is_centered: 1, first_word_id: null, last_word_id: null, surah_number: 2 },
];

jest.mock("@/lib/settings/context", () => ({ useSettings: () => mockSettings }));
jest.mock("@/lib/selection/context", () => ({
  useSelection: () => ({
    getHighlightColor: () => undefined,
    getWordHighlightColor: () => undefined,
    selectAyah: jest.fn(),
  }),
}));
jest.mock("@/components/mushaf/SurahInfoModal", () => ({ SurahInfoModal: () => null }));
jest.mock("@/components/mushaf/WordToken", () => ({ WordToken: () => null }));
jest.mock("@/lib/fonts/loader", () => ({
  isSurahNameFontLoaded: jest.fn(),
  loadSurahNameFont: jest.fn(),
  surahNameGlyph: jest.fn(),
  surahNameBismillahGlyphs: () => "SYNTHETIC-BISMILLAH",
  surahNameFontName: () => "SyntheticSurahFont",
  isQuranPageFontLoaded: () => true,
  loadQuranPageFont: jest.fn(),
  quranPageFontName: () => "SyntheticPageFont",
  quranPageFontPaletteStyle: () => ({}),
  quranPageMarkerFontPaletteStyle: () => ({}),
}));

function deferred() {
  let resolve: (() => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {
    promise,
    resolve() {
      if (!resolve) throw new Error("Missing fixture resolve");
      resolve();
    },
    reject(error: Error) {
      if (!reject) throw new Error("Missing fixture reject");
      reject(error);
    },
  };
}

const variants = [
  { kind: "header", compact: true, language: "ar", width: 390 },
  { kind: "header", compact: false, language: "ar", width: 390 },
  { kind: "header", compact: true, language: "en", width: 1280 },
  { kind: "header", compact: false, language: "en", width: 1280 },
  { kind: "page", compact: false, language: "ar", width: 390 },
  { kind: "page", compact: false, language: "en", width: 1280 },
] satisfies { kind: "header" | "page"; compact: boolean; language: "ar" | "en"; width: number }[];

describe.each(variants)(
  "$kind compact=$compact $language/$width font readiness",
  ({ kind, compact, language, width }) => {
    let loaded: boolean;
    let pending: ReturnType<typeof deferred>;
    let frames: FrameRequestCallback[];
    let warn: jest.SpyInstance;

    function subject(needed = true) {
      jest.mocked(surahNameGlyph).mockReturnValue(needed ? decorative : undefined);
      return kind === "header" ? (
        <SurahHeader
          surahNumber={2}
          nameArabic={name}
          nameEnglish={name}
          ayahCount={3}
          revelationType="Makkiyah"
          compact={compact}
          hideBismillah={!needed}
        />
      ) : (
        <MushafPage
          pageNumber={1}
          ayahs={[]}
          surahMap={new Map()}
          fontSize={24}
          lineHeight={40}
          width={width}
          lineLayout={needed ? layout : []}
        />
      );
    }

    function flushFrames() {
      act(() => {
        for (const callback of frames.splice(0)) callback(0);
      });
    }

    function expectReady(view: ReturnType<typeof render>, ready: boolean) {
      const text = view.getByText(bismillah);
      expect(StyleSheet.flatten(text.props.style)).toMatchObject({
        opacity: ready ? 1 : 0,
        fontFamily: "SyntheticSurahFont",
        writingDirection: "rtl",
      });
      if (kind === "header") {
        // The compact page-view card shows the calligraphic name in both languages once the font is
        // ready; English compact cards carry the English name in their subtitle instead.
        const decorativeShown = (language === "ar" || compact) && ready;
        expect(Boolean(view.queryByText(decorative))).toBe(decorativeShown);
        if (!decorativeShown) expect(view.getByText(name)).toBeTruthy();
        if (compact && language === "en") expect(view.getAllByText(new RegExp(name)).length).toBeGreaterThan(0);
        expect(view.getByRole("button")).toBeTruthy();
      }
    }

    beforeEach(() => {
      loaded = false;
      pending = deferred();
      frames = [];
      jest.clearAllMocks();
      Object.assign(mockSettings, {
        uiLanguage: language,
        isDark: language === "en",
        effectiveTheme: language === "en" ? "dark" : "beige",
      });
      const screen = { width, height: 844, scale: 1, fontScale: 1 };
      Dimensions.set({ window: screen, screen });
      jest.replaceProperty(I18nManager, "isRTL", language === "ar");
      jest.mocked(isSurahNameFontLoaded).mockImplementation(() => loaded);
      jest.mocked(loadSurahNameFont).mockImplementation(() => pending.promise);
      jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
      cleanup();
      jest.restoreAllMocks();
      Dimensions.set({ window: originalWindow, screen: originalScreen });
    });

    it("uses the existing cache without loading", () => {
      loaded = true;
      const view = render(subject());
      flushFrames();
      expectReady(view, true);
      expect(loadSurahNameFont).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it("keeps the fallback until the delayed load and next frame", async () => {
      const view = render(subject());
      flushFrames();
      expectReady(view, false);
      expect(loadSurahNameFont).toHaveBeenCalledTimes(1);
      await act(async () => {
        loaded = true;
        pending.resolve();
      });
      expectReady(view, false);
      expect(frames).toHaveLength(1);
      flushFrames();
      expectReady(view, true);
      expect(warn).not.toHaveBeenCalled();
    });

    it("reports rejection and retains the fallback", async () => {
      const view = render(subject());
      flushFrames();
      const error = new Error("Synthetic optional font failure");
      await act(async () => {
        pending.reject(error);
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(error);
      expect(frames).toHaveLength(0);
      expectReady(view, false);
    });

    it("loads only after the parent begins needing the font", async () => {
      const view = render(subject(false));
      flushFrames();
      expect(view.queryByText(bismillah)).toBeNull();
      expect(loadSurahNameFont).not.toHaveBeenCalled();
      view.rerender(subject());
      expectReady(view, false);
      expect(loadSurahNameFont).toHaveBeenCalledTimes(1);
      await act(async () => {
        loaded = true;
        pending.resolve();
      });
      flushFrames();
      expectReady(view, true);
    });

    it("ignores completion after disabling and rechecks the cache when enabled", async () => {
      const view = render(subject());
      flushFrames();
      view.rerender(subject(false));
      await act(async () => {
        loaded = true;
        pending.resolve();
      });
      expect(frames).toHaveLength(0);
      expect(view.queryByText(bismillah)).toBeNull();
      view.rerender(subject());
      expectReady(view, true);
      expect(loadSurahNameFont).toHaveBeenCalledTimes(1);
    });

    it("does not schedule completion after unmount", async () => {
      const view = render(subject());
      flushFrames();
      view.unmount();
      await act(async () => {
        loaded = true;
        pending.resolve();
      });
      expect(frames).toHaveLength(0);
      expect(warn).not.toHaveBeenCalled();
    });
  },
);
