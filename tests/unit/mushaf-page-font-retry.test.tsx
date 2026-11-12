import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { strings } from "@/lib/i18n/strings";

let mockLoaded = false;
const mockLoadQuranPageFont = jest.fn();

jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    uiLanguage: "en",
    isDark: false,
    isRTL: false,
    quranFontStyle: "qcf2",
    quranMarkerStyle: "auto",
    showAyahMarkers: true,
    effectiveTheme: "white",
  }),
}));
jest.mock("@/lib/i18n/useStrings", () => ({
  useStrings: () => require("@/lib/i18n/strings").strings.en,
  interpolate: (template: string) => template,
}));
jest.mock("@/lib/selection/context", () => ({
  useSelection: () => ({ getHighlightColor: () => undefined, getWordHighlightColor: () => undefined, selectAyah: jest.fn() }),
}));
jest.mock("@/components/mushaf/SurahInfoModal", () => ({ SurahInfoModal: () => null }));
jest.mock("@/components/mushaf/WordToken", () => ({ WordToken: () => null }));
jest.mock("@/lib/fonts/loader", () => ({
  isSurahNameFontLoaded: () => true,
  loadSurahNameFont: jest.fn(() => Promise.resolve()),
  surahNameGlyph: () => undefined,
  surahNameBismillahGlyphs: () => "",
  surahNameFontName: () => "SyntheticSurahFont",
  isQuranPageFontLoaded: () => mockLoaded,
  loadQuranPageFont: (...args: unknown[]) => mockLoadQuranPageFont(...args),
  quranPageFontName: () => "SyntheticPageFont",
  quranPageFontPaletteStyle: () => ({}),
  quranPageMarkerFontPaletteStyle: () => ({}),
}));

import { MushafPage } from "@/components/mushaf/MushafPage";

beforeEach(() => {
  mockLoaded = false;
  mockLoadQuranPageFont.mockReset();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

it("offers a retry when a page font fails to load and loads again on press", async () => {
  mockLoadQuranPageFont.mockRejectedValueOnce(new Error("synthetic font failure"));
  const view = render(
    <MushafPage pageNumber={2} ayahs={[]} surahMap={new Map()} fontSize={24} lineHeight={40} width={360} />,
  );
  await act(async () => {});

  // Before the fix the page stayed a spinner with no way to recover.
  expect(view.getByText(strings.en.mushafPageLoadFailed)).toBeTruthy();

  mockLoadQuranPageFont.mockImplementationOnce(async () => {
    mockLoaded = true;
  });
  await act(async () => {
    fireEvent.press(view.getByText(strings.en.mushafPageRetry));
  });

  expect(mockLoadQuranPageFont).toHaveBeenCalledTimes(2);
  expect(view.queryByText(strings.en.mushafPageLoadFailed)).toBeNull();
});
