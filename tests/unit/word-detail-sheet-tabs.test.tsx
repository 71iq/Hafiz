import React from "react";
import { Text } from "react-native";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { WordDetailSheet } from "@/components/mushaf/WordDetailSheet";
import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import { strings } from "@/lib/i18n/strings";
import type { WordRef } from "@/lib/word/context";

let mockDetailWord: WordRef | null = null;
const mockCloseDetail = jest.fn(() => {
  mockDetailWord = null;
});
const mockDatabase = {
  getFirstAsync: jest.fn(async (sql: string) => {
    if (sql.includes("FROM surahs")) return { name_arabic: "البقرة", name_english: "Al-Baqarah" };
    if (sql.includes("COUNT(*)")) return { count: 12 };
    return null;
  }),
  getAllAsync: jest.fn(async () => []),
};

jest.mock("@/lib/word/context", () => ({
  useWordInteraction: () => ({
    detailWord: mockDetailWord,
    openDetail: jest.fn(),
    closeDetail: mockCloseDetail,
    navigateToAyah: jest.fn(),
    hasReaderNavigation: true,
  }),
}));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/word/queries", () => ({
  fetchWordText: async () => "ٱللَّهُ",
  fetchWordQcf2Glyph: async () => null,
  fetchWordRoot: async () => ({ root: "أله", lemma: "اللَّه" }),
  fetchWordTranslation: async () => ({ translation_en: "Allah" }),
  fetchWordMeaningAr: async () => null,
}));
jest.mock("@/lib/fonts/use-quran-page-font", () => ({ useQuranPageFontReady: () => true }));
jest.mock("@/lib/fonts/loader", () => ({
  quranPageFontName: () => "SyntheticFont",
  quranPageFontPaletteStyle: () => ({}),
}));
jest.mock("@/components/mushaf/AyahDetailModal", () => ({ AyahDetailModal: () => null }));
jest.mock("@/components/mushaf/word-tabs/MeaningTab", () => ({ MeaningTab: () => mockPanel("meaning-panel") }));
jest.mock("@/components/mushaf/word-tabs/IrabTab", () => ({ IrabTab: () => mockPanel("grammar-panel") }));
jest.mock("@/components/mushaf/word-tabs/TajweedTab", () => ({ TajweedTab: () => mockPanel("tajweed-panel") }));
jest.mock("@/components/mushaf/word-tabs/TasreefTab", () => ({ TasreefTab: () => mockPanel("morphology-panel") }));
jest.mock("@/components/mushaf/word-tabs/OccurrencesTab", () => ({
  OccurrencesTab: () => mockPanel("occurrences-panel"),
}));

function mockPanel(name: string) {
  const { Text: PanelText } = jest.requireActual<typeof import("react-native")>("react-native");
  return <PanelText>{name}</PanelText>;
}

const word: WordRef = { surah: 2, ayah: 255, wordPos: 3, v2Page: 42 };

function Wrapper({ children }: React.PropsWithChildren) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      <OperationNoticeProvider ready>{children}</OperationNoticeProvider>
    </SafeAreaProvider>
  );
}

afterEach(() => {
  cleanup();
  mockDetailWord = null;
});

describe("WordDetailSheet tabs", () => {
  it("labels tabs plainly, opens Occurrences from Root and starts the next word on Meaning", async () => {
    mockDetailWord = word;
    const view = render(<WordDetailSheet />, { wrapper: Wrapper });
    await act(async () => {});
    const en = strings.en;
    expect(view.getAllByRole("tab").map((tab) => tab.findByType(Text).props.children)).toEqual([
      en.wordTabMeaning,
      "Grammar",
      en.wordTabTajweed,
      "Morphology",
      en.wordTabOccurrences,
    ]);
    expect(view.getByText("Al-Baqarah 2:255:3")).toBeTruthy();

    fireEvent.press(view.getByRole("button", { name: "Root أله, show occurrences" }));
    expect(view.getByText("occurrences-panel")).toBeTruthy();

    // An occurrence jump closes the sheet from the reader, not through the sheet's own close button.
    mockDetailWord = null;
    view.rerender(<WordDetailSheet />);
    mockDetailWord = { ...word, wordPos: 4 };
    view.rerender(<WordDetailSheet />);
    await act(async () => {});
    expect(view.getByText("meaning-panel")).toBeTruthy();
    expect(view.queryByText("occurrences-panel")).toBeNull();
  });
});
