import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import ReflectionJourneyScreen from "@/app/(tabs)/reflection-journey";
import { listReflectionJourneyLevels } from "@/lib/reflection-journey/queries";
import type { ReflectionJourneyLevelListItem } from "@/lib/reflection-journey/types";
import { strings } from "@/lib/i18n/strings";

const mockSettings = {
  isDark: false,
  isRTL: false,
  uiLanguage: "en" as "en" | "ar",
  themeColors: {
    surface: "#FFFFFF",
    surfaceLow: "#F8FAFC",
    surfaceMid: "#F4F4F5",
    surfaceHigh: "#E5E7EB",
    surfaceDim: "#D1D5DB",
    surfaceBright: "#FFFFFF",
  },
};
let mockFocus: (() => void) | null = null;

const mockDatabase = {};
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { withThemeOpacity: actual.withThemeOpacity, useSettings: () => mockSettings };
});
jest.mock("@/lib/selection/context", () => ({
  SelectionProvider: ({ children }: { children: React.ReactNode }) => children,
  useSelection: () => ({ showToast: jest.fn() }),
}));
jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  return {
    useFocusEffect: (callback: () => void) => {
      mockFocus = callback;
      useEffect(callback, [callback]);
    },
  };
});
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { SafeAreaView: View };
});
jest.mock("@/components/reflection-journey/JourneyAyahCard", () => ({ JourneyAyahCard: () => null }));
jest.mock("@/lib/reflection-journey/queries", () => ({
  listReflectionJourneyLevels: jest.fn(),
  saveReflectionJourneyDraft: jest.fn(),
  completeReflectionJourneyLevel: jest.fn(),
}));

function level(id: string, status: ReflectionJourneyLevelListItem["status"]): ReflectionJourneyLevelListItem {
  return {
    id,
    slug: id,
    order: id === "first" ? 1 : 2,
    title: { en: `Level ${id}`, ar: `المستوى ${id}` },
    summary: { en: `Summary ${id}`, ar: `ملخص ${id}` },
    responsePrompt: { en: "Prompt", ar: "سؤال" },
    blocks: [],
    status,
    entry: null,
    isLocked: false,
  };
}
const levels = [level("first", "completed"), level("second", "available")];

describe.each(["en", "ar"] as const)("reflection journey loading in %s", (language) => {
  const s = strings[language];
  beforeEach(() => {
    jest.mocked(listReflectionJourneyLevels).mockReset();
    mockSettings.uiLanguage = language;
    mockSettings.isRTL = language === "ar";
  });
  afterEach(cleanup);

  it("shows a loading state, not the empty state, while levels load", async () => {
    let resolve!: (items: ReflectionJourneyLevelListItem[]) => void;
    jest.mocked(listReflectionJourneyLevels).mockReturnValue(new Promise((accept) => (resolve = accept)));
    const view = render(<ReflectionJourneyScreen />);

    expect(view.getByLabelText(s.reflectionJourneyLoading)).toBeTruthy();
    expect(view.queryByText(s.reflectionJourneyEmptyTitle)).toBeNull();
    await act(async () => resolve(levels));
    expect(view.getByText(language === "ar" ? "ملخص second" : "Summary second")).toBeTruthy();
  });

  it("offers a retry after a failed load", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.mocked(listReflectionJourneyLevels).mockRejectedValueOnce(new Error("synthetic failure"));
    const view = render(<ReflectionJourneyScreen />);
    await act(async () => {});

    expect(view.getByText(s.reflectionJourneyLoadFailed)).toBeTruthy();
    expect(view.queryByText(s.reflectionJourneyEmptyTitle)).toBeNull();
    jest.mocked(listReflectionJourneyLevels).mockResolvedValueOnce(levels);
    await act(async () => {
      fireEvent.press(view.getByText(s.reflectionJourneyRetry));
    });
    expect(view.getByText(language === "ar" ? "ملخص second" : "Summary second")).toBeTruthy();
  });

  it("keeps the chosen level when the screen regains focus", async () => {
    jest.mocked(listReflectionJourneyLevels).mockResolvedValue(levels);
    const view = render(<ReflectionJourneyScreen />);
    await act(async () => {});
    const first = language === "ar" ? "ملخص first" : "Summary first";
    await act(async () => {
      fireEvent.press(view.getByText(language === "ar" ? "المستوى first" : "Level first"));
    });
    expect(view.getByText(first)).toBeTruthy();

    await act(async () => mockFocus?.());
    expect(listReflectionJourneyLevels).toHaveBeenCalledTimes(2);
    expect(view.getByText(first)).toBeTruthy();
  });
});
