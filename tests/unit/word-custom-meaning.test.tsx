import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MeaningTab } from "@/components/mushaf/word-tabs/MeaningTab";
import { strings } from "@/lib/i18n/strings";

const s = strings.ar;
const mockUpsert = jest.fn();
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
  fetchWordMeaningAr: jest.fn(async () => null),
  fetchWordTranslation: jest.fn(async () => ({ word_arabic: "ٱلضَّآلِّينَ", translation_en: "those who go astray" })),
  upsertUserWordMeaning: (...args: unknown[]) => mockUpsert(...args),
}));

describe("custom Arabic word meaning", () => {
  beforeEach(() => mockUpsert.mockReset());

  it("saves a meaning for a word without one and shows it", async () => {
    mockUpsert.mockResolvedValue(undefined);
    render(<MeaningTab surah={1} ayah={7} wordPos={8} />);

    expect(await screen.findByText(s.noWordMeaningFallback)).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText(s.customWordMeaningPlaceholder), "  الذين ضلوا الطريق ");
    fireEvent.press(screen.getByText(s.saveCustomWordMeaning));

    await waitFor(() =>
      expect(mockUpsert).toHaveBeenCalledWith(mockDb, {
        surah: 1,
        ayah: 7,
        wordPos: 8,
        word: "ٱلضَّآلِّينَ",
        meaning: "الذين ضلوا الطريق",
      }),
    );
    expect(await screen.findByText("الذين ضلوا الطريق")).toBeTruthy();
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
});
