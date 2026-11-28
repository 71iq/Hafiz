import { DatabaseSync } from "node:sqlite";
import React from "react";
import { Text } from "react-native";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { WordDetailSheet } from "@/components/mushaf/WordDetailSheet";
import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import { strings } from "@/lib/i18n/strings";
import type { WordRef } from "@/lib/word/context";

let mockDetailWord: WordRef | null = null;
const mockOpenDetail = jest.fn();
let mockNeighborLookup: Promise<void> | null = null;
const quran = new DatabaseSync("assets/data/quran.db", { readOnly: true });
afterAll(() => quran.close());
const mockCloseDetail = jest.fn(() => {
  mockDetailWord = null;
});
const mockDatabase = {
  getFirstAsync: jest.fn(async (sql: string, params: number[] = []) => {
    if (sql.includes("FROM quran_text") || sql.includes("JOIN quran_text")) {
      await mockNeighborLookup;
      return quran.prepare(sql).get(...params) ?? null;
    }
    if (sql.includes("FROM surahs")) return { name_arabic: "البقرة", name_english: "Al-Baqarah" };
    if (sql.includes("COUNT(*)")) return { count: 12 };
    return null;
  }),
  getAllAsync: jest.fn(async () => []),
};

jest.mock("@/lib/word/context", () => ({
  useWordInteraction: () => ({
    detailWord: mockDetailWord,
    openDetail: mockOpenDetail,
    closeDetail: mockCloseDetail,
    navigateToAyah: jest.fn(),
    hasReaderNavigation: true,
  }),
}));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/word/queries", () => ({
  fetchWordNeighbors: jest.requireActual("@/lib/word/queries").fetchWordNeighbors,
  fetchWordText: async () => "ٱللَّهُ",
  fetchWordQcf2Glyph: async () => null,
  fetchWordRoot: async () => ({ root: "أله", lemma: "اللَّه" }),
  fetchWordTranslation: async () => ({ translation_en: "Allah" }),
  fetchWordMeaningAr: async () => null,
  // These fixture ayat have one glyph per word, so the reader's number is the table position.
  fetchReaderWordPositions: async (_db: unknown, _surah: number, _ayah: number, readerWordPos: number) => ({
    table: readerWordPos,
    unicode: readerWordPos,
  }),
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
  mockNeighborLookup = null;
  mockOpenDetail.mockClear();
});

describe("WordDetailSheet tabs", () => {
  it("waits for the open word's neighbors before allowing another step", async () => {
    mockDetailWord = word;
    const view = render(<WordDetailSheet />, { wrapper: Wrapper });
    await act(async () => {});
    const previous = () => view.getByRole("button", { name: strings.en.previousWord });
    expect(previous()).toBeEnabled();

    let finish!: () => void;
    mockNeighborLookup = new Promise((resolve) => {
      finish = resolve;
    });
    mockDetailWord = { ...word, wordPos: 6 };
    view.rerender(<WordDetailSheet />);
    expect(previous()).toBeDisabled();
    fireEvent.press(previous());
    expect(mockOpenDetail).not.toHaveBeenCalled();

    await act(async () => {
      finish();
    });
    fireEvent.press(previous());
    expect(mockOpenDetail).toHaveBeenCalledWith({ ...word, wordPos: 5 });
  });

  it.each([3, 4])("opens the next glyph after 2:255:%i even without a root row", async (wordPos) => {
    mockDetailWord = { ...word, wordPos };
    const view = render(<WordDetailSheet />, { wrapper: Wrapper });
    await act(async () => {});

    fireEvent.press(view.getByRole("button", { name: strings.en.nextWord }));
    expect(mockOpenDetail).toHaveBeenCalledWith({ ...word, wordPos: wordPos + 1 });
  });

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
