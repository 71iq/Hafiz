import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MeaningTab } from "@/components/mushaf/word-tabs/MeaningTab";
import { strings } from "@/lib/i18n/strings";
import type { WordMeaningArRow } from "@/lib/word/queries";

const s = strings.ar;
const mockUpsert = jest.fn();
const mockDelete = jest.fn();
const mockFetchMeaning = jest.fn<Promise<WordMeaningArRow | null>, unknown[]>();
const mockDb = {};

jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/settings/context", () => ({
  ...jest.requireActual("@/lib/settings/context"),
  useSettings: () => ({ uiLanguage: "ar", isRTL: true, isDark: false, themeColors: { surfaceDim: "#ccc" } }),
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
  fetchWordMeaningAr: (...args: unknown[]) => mockFetchMeaning(...args),
  fetchWordTranslation: jest.fn(async () => ({ word_arabic: "ٱلضَّآلِّينَ", translation_en: "those who go astray" })),
  upsertUserWordMeaning: (...args: unknown[]) => mockUpsert(...args),
  deleteUserWordMeaning: (...args: unknown[]) => mockDelete(...args),
}));
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
    render(<MeaningTab surah={1} ayah={7} wordPos={8} />);

    expect(await screen.findByText(s.noWordMeaningFallback)).toBeTruthy();
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
    expect(await screen.findByText("الذين ضلوا الطريق")).toBeTruthy();
    expect(screen.getByText(s.customWordMeaningYours)).toBeTruthy();
  });

  it("keeps the draft and reports a failed save", async () => {
    mockUpsert.mockRejectedValue(new Error("disk full"));
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<MeaningTab surah={1} ayah={7} wordPos={8} />);

    fireEvent.changeText(await screen.findByPlaceholderText(s.customWordMeaningPlaceholder), "معنى");
    fireEvent.press(screen.getByText(s.saveCustomWordMeaning));

    expect(await screen.findByText(s.customWordMeaningFailed)).toBeTruthy();
    expect(screen.getByDisplayValue("معنى")).toBeTruthy();
  });

  it("offers no Edit or Delete for a bundled meaning", async () => {
    mockFetchMeaning.mockResolvedValue(row({ meaning: "المعنى المضمن", source: "bundled", custom_created_at: null }));
    render(<MeaningTab surah={1} ayah={7} wordPos={8} />);

    expect(await screen.findByText("المعنى المضمن")).toBeTruthy();
    expect(screen.queryByText(s.customWordMeaningEdit)).toBeNull();
    expect(screen.queryByText(s.customWordMeaningDelete)).toBeNull();
    expect(screen.queryByText(s.customWordMeaningYours)).toBeNull();
  });

  it("edits the account's custom meaning and asks before discarding a changed draft", async () => {
    mockFetchMeaning.mockResolvedValue(row());
    mockUpsert.mockResolvedValue(undefined);
    render(<MeaningTab surah={1} ayah={7} wordPos={8} />);

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
    expect(await screen.findByText("معنى أدق")).toBeTruthy();
    expect(screen.queryByDisplayValue("معنى أدق")).toBeNull();
  });

  it("deletes only after confirmation, by canonical key with the original content and creation time", async () => {
    mockFetchMeaning.mockResolvedValue(row());
    mockDelete.mockResolvedValue("deleted");
    render(<MeaningTab surah={1} ayah={7} wordPos={8} />);

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
    render(<MeaningTab surah={1} ayah={7} wordPos={8} />);

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
    const view = render(<MeaningTab surah={1} ayah={7} wordPos={8} />);

    fireEvent.press(await screen.findByLabelText(s.customWordMeaningDeleteLabel));
    fireEvent.press(screen.getByText("dialog:" + s.customWordMeaningDelete));
    mockFetchMeaning.mockResolvedValue(row({ word_pos: 9, meaning: "معنى الكلمة الأخرى" }));
    view.rerender(<MeaningTab surah={1} ayah={7} wordPos={9} />);
    expect(await screen.findByText("معنى الكلمة الأخرى")).toBeTruthy();

    await act(async () => finish("deleted"));

    expect(screen.getByText("معنى الكلمة الأخرى")).toBeTruthy();
    expect(screen.queryByText(s.noWordMeaningFallback)).toBeNull();
    expect(screen.queryByText(s.customWordMeaningDeleteTitle)).toBeNull();
  });
});
