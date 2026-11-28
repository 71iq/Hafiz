import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { WordDetailSheet } from "@/components/mushaf/WordDetailSheet";
import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import type { WordRef } from "@/lib/word/context";
import { strings } from "@/lib/i18n/strings";
import type { WordMeaningArRow } from "@/lib/word/queries";

const s = strings.ar;
const mockUpsert = jest.fn();
const mockDelete = jest.fn();
const mockFetchMeaning = jest.fn<Promise<WordMeaningArRow | null>, unknown[]>();
const mockDb = { getFirstAsync: jest.fn(async () => null) };
const mockWord = React.createContext<WordRef | null>(null);

jest.mock("@/lib/word/context", () => ({
  useWordInteraction: () => ({
    detailWord: jest.requireActual<typeof React>("react").useContext(mockWord),
    openDetail: jest.fn(),
    closeDetail: jest.fn(),
  }),
}));
jest.mock("@/lib/fonts/use-quran-page-font", () => ({ useQuranPageFontReady: () => false }));
jest.mock("@/components/mushaf/AyahDetailModal", () => ({ AyahDetailModal: () => null }));

function WordSheet({ surah, ayah, wordPos }: Omit<WordRef, "v2Page">) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
      <OperationNoticeProvider ready>
        <mockWord.Provider value={{ surah, ayah, wordPos, v2Page: 1 }}>
          <WordDetailSheet />
        </mockWord.Provider>
      </OperationNoticeProvider>
    </SafeAreaProvider>
  );
}

jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/settings/context", () => ({
  ...jest.requireActual("@/lib/settings/context"),
  useSettings: () => ({ effectiveTheme: "white", uiLanguage: "ar", isRTL: true, isDark: false, themeColors: { surfaceDim: "#ccc" } }),
}));
jest.mock("@/lib/i18n/useStrings", () => ({
  ...jest.requireActual("@/lib/i18n/useStrings"),
  useStrings: () => jest.requireActual<typeof import("@/lib/i18n/strings")>("@/lib/i18n/strings").strings.ar,
}));
jest.mock("@/lib/fsrs/queries", () => ({
  addMeaningCard: jest.fn(async () => undefined),
  isMeaningCardSaved: jest.fn(async () => false),
}));
jest.mock("@/lib/word/queries", () => ({
  fetchReaderWordPositions: async (_db: unknown, _surah: number, _ayah: number, glyph: number) => ({
    table: glyph === 10 ? 8 : glyph,
    unicode: glyph,
  }),
  fetchWordNeighbors: async () => ({ previous: null, next: null }),
  fetchWordText: async () => "ٱلضَّآلِّينَ",
  fetchWordQcf2Glyph: async () => null,
  fetchWordRoot: async () => null,
  fetchWordMeaningAr: (...args: unknown[]) => mockFetchMeaning(...args),
  fetchWordTranslation: jest.fn(async () => ({ word_arabic: "ٱلضَّآلِّينَ", translation_en: "those who go astray" })),
  upsertUserWordMeaning: (...args: unknown[]) => mockUpsert(...args),
  deleteUserWordMeaning: (...args: unknown[]) => mockDelete(...args),
}));
// The modal itself needs app providers; its own suites cover it. Render its contract plainly.
jest.mock("@/components/ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: {
    visible: boolean;
    title: string;
    message: string;
    cancelLabel: string;
    confirmLabel: string;
    error?: string | null;
    onCancel: () => void;
    onConfirm: () => void;
  }) => {
    const { Pressable, Text, View } = jest.requireActual<typeof import("react-native")>("react-native");
    return props.visible ? (
      <View>
        <Text>{props.title}</Text>
        <Text>{props.message}</Text>
        {props.error ? <Text>{props.error}</Text> : null}
        <Pressable accessibilityRole="button" onPress={props.onCancel}>
          <Text>{"dialog:" + props.cancelLabel}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={props.onConfirm}>
          <Text>{"dialog:" + props.confirmLabel}</Text>
        </Pressable>
      </View>
    ) : null;
  },
}));

const WORD = "ٱلضَّآلِّينَ";
function row(overrides: Partial<WordMeaningArRow> = {}): WordMeaningArRow {
  return {
    surah: 1,
    ayah: 7,
    word_pos: 8,
    word: WORD,
    meaning: "معنى كتبته",
    source: "custom",
    custom_created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("custom Arabic word meaning", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockDelete.mockReset();
    mockFetchMeaning.mockReset().mockResolvedValue(null);
  });

  it("saves a meaning for a word without one and shows it", async () => {
    mockUpsert.mockResolvedValue(undefined);
    // A reader glyph and a saved word can have different positions.
    render(<WordSheet surah={1} ayah={7} wordPos={10} />);

    expect(await screen.findByText(s.noWordMeaningFallback)).toBeTruthy();
    expect(mockFetchMeaning).toHaveBeenCalledWith(mockDb, 1, 7, 8);
    mockFetchMeaning.mockResolvedValue(row({ meaning: "الذين ضلوا الطريق" }));
    fireEvent.changeText(screen.getByPlaceholderText(s.customWordMeaningPlaceholder), "  الذين ضلوا الطريق ");
    fireEvent.press(screen.getByText(s.saveCustomWordMeaning));

    await waitFor(() =>
      expect(mockUpsert).toHaveBeenCalledWith(mockDb, {
        surah: 1,
        ayah: 7,
        wordPos: 8,
        word: WORD,
        meaning: "الذين ضلوا الطريق",
      }),
    );
    await waitFor(() => expect(screen.getAllByText("الذين ضلوا الطريق")).toHaveLength(2));
    expect(screen.getByText(s.customWordMeaningYours)).toBeTruthy();
  });

  it("keeps the draft and reports a failed save", async () => {
    mockUpsert.mockRejectedValue(new Error("disk full"));
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<WordSheet surah={1} ayah={7} wordPos={8} />);

    fireEvent.changeText(await screen.findByPlaceholderText(s.customWordMeaningPlaceholder), "معنى");
    fireEvent.press(screen.getByText(s.saveCustomWordMeaning));

    expect(await screen.findByText(s.customWordMeaningFailed)).toBeTruthy();
    expect(screen.getByDisplayValue("معنى")).toBeTruthy();
  });

  it("offers no Edit or Delete for a bundled meaning", async () => {
    mockFetchMeaning.mockResolvedValue(row({ meaning: "المعنى المضمن", source: "bundled", custom_created_at: null }));
    render(<WordSheet surah={1} ayah={7} wordPos={8} />);

    await waitFor(() => expect(screen.getAllByText("المعنى المضمن")).toHaveLength(2));
    expect(screen.queryByText(s.customWordMeaningEdit)).toBeNull();
    expect(screen.queryByText(s.customWordMeaningDelete)).toBeNull();
    expect(screen.queryByText(s.customWordMeaningYours)).toBeNull();
  });

  it("edits the account's custom meaning and asks before discarding a changed draft", async () => {
    mockFetchMeaning.mockResolvedValue(row());
    mockUpsert.mockResolvedValue(undefined);
    render(<WordSheet surah={1} ayah={7} wordPos={8} />);

    fireEvent.press(await screen.findByLabelText(s.customWordMeaningEditLabel));
    const input = screen.getByDisplayValue("معنى كتبته");
    fireEvent.changeText(input, "معنى أدق");
    fireEvent.press(screen.getByText(s.customWordMeaningCancelEdit));
    expect(await screen.findByText(s.discardChangesTitle)).toBeTruthy();
    fireEvent.press(screen.getByText("dialog:" + s.discardChangesKeepEditing));
    expect(screen.getByDisplayValue("معنى أدق")).toBeTruthy();

    mockFetchMeaning.mockResolvedValue(row({ meaning: "معنى أدق" }));
    fireEvent.press(screen.getByText(s.saveCustomWordMeaning));
    await waitFor(() =>
      expect(mockUpsert).toHaveBeenCalledWith(mockDb, {
        surah: 1,
        ayah: 7,
        wordPos: 8,
        word: WORD,
        meaning: "معنى أدق",
      }),
    );
    await waitFor(() => expect(screen.getAllByText("معنى أدق")).toHaveLength(2));
    expect(screen.queryByDisplayValue("معنى أدق")).toBeNull();
  });

  it("deletes only after confirmation, by canonical key with the original content and creation time", async () => {
    mockFetchMeaning.mockResolvedValue(row());
    mockDelete.mockResolvedValue("deleted");
    render(<WordSheet surah={1} ayah={7} wordPos={8} />);

    fireEvent.press(await screen.findByLabelText(s.customWordMeaningDeleteLabel));
    expect(screen.getByText(s.customWordMeaningDeleteTitle)).toBeTruthy();
    expect(mockDelete).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText("dialog:" + s.customWordMeaningDelete));

    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith(mockDb, {
        surah: 1,
        ayah: 7,
        wordPos: 8,
        meaning: "معنى كتبته",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(await screen.findByText(s.noWordMeaningFallback)).toBeTruthy();
    expect(screen.queryByText("معنى كتبته")).toBeNull();
  });

  it("keeps the meaning and shows the error inside the confirmation when deletion fails", async () => {
    mockFetchMeaning.mockResolvedValue(row());
    mockDelete.mockRejectedValue(new Error("disk full"));
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<WordSheet surah={1} ayah={7} wordPos={8} />);

    fireEvent.press(await screen.findByLabelText(s.customWordMeaningDeleteLabel));
    fireEvent.press(screen.getByText("dialog:" + s.customWordMeaningDelete));

    expect(await screen.findByText(s.customWordMeaningDeleteFailed)).toBeTruthy();
    expect(screen.getByText(s.customWordMeaningDeleteTitle)).toBeTruthy();
    expect(screen.getAllByText("معنى كتبته").length).toBeGreaterThan(0);
  });

  it("ignores a deletion that settles after switching to another word", async () => {
    mockFetchMeaning.mockResolvedValue(row());
    let finish!: (value: "deleted") => void;
    mockDelete.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const view = render(<WordSheet surah={1} ayah={7} wordPos={8} />);

    fireEvent.press(await screen.findByLabelText(s.customWordMeaningDeleteLabel));
    fireEvent.press(screen.getByText("dialog:" + s.customWordMeaningDelete));
    mockFetchMeaning.mockResolvedValue(row({ word_pos: 9, meaning: "معنى الكلمة الأخرى" }));
    view.rerender(<WordSheet surah={1} ayah={7} wordPos={9} />);
    await waitFor(() => expect(screen.getAllByText("معنى الكلمة الأخرى")).toHaveLength(2));

    await act(async () => finish("deleted"));

    expect(screen.getAllByText("معنى الكلمة الأخرى")).toHaveLength(2);
    expect(screen.queryByText(s.noWordMeaningFallback)).toBeNull();
    expect(screen.queryByText(s.customWordMeaningDeleteTitle)).toBeNull();
  });
});
