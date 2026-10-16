import React from "react";
import * as ReactNative from "react-native";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import FlashcardSessionScreenWrapper from "@/app/flashcards/session";
import { ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { DirectionProvider } from "@/lib/ui/direction";
import { useSettings } from "@/lib/settings/context";
import { strings, type UIStrings } from "@/lib/i18n/strings";
import { formatLocalDateInput, parseDueDateInput } from "@/lib/date";
import { State } from "@/lib/fsrs/scheduler";
import type { DeckReviewSettings, StudyCardRow } from "@/lib/fsrs/types";
import type { SmartCardContent, SmartDeckRef } from "@/lib/fsrs/smart-decks";
import { DEFAULT_RECITATION_ID } from "@/lib/quran-foundation/recitations";
import { DEFAULT_TAFSIR_SOURCE } from "@/lib/tafsir/sources";
import { addTodayPoints, computeReviewPoints } from "@/lib/fsrs/scoring";
import {
  getDueCardsForReview,
  getSmartCardContent,
  isSmartDeckId,
  materializeSmartDeckCards,
} from "@/lib/fsrs/smart-decks";
import {
  getNextEligibleReviewDate,
  getRemainingReviewLimit,
  getStudyStreak,
  getWirdStatus,
  insertStudyLog,
  readDeckReviewSettings,
  setStudyCardDueDate,
  updateCard,
} from "@/lib/fsrs/queries";
import { hapticMedium } from "@/lib/haptics";
import { recordAchievementEvent } from "@/lib/achievements/queries";
import { syncDailyScore, updateProfileStats } from "@/lib/fsrs/leaderboard-sync";
import {
  isQuranPageFontLoaded,
  loadQuranPageFont,
  quranPageFontName,
  quranPageFontPaletteStyle,
  quranPageMarkerFontPaletteStyle,
} from "@/lib/fonts/loader";
import { expectTextAlignStart, expectWritingDirection, flattenStyle } from "../rtl/rtl-test-utils";

const mockDatabase = Object.freeze({ identity: "session-due-date-database" });
const mockRouterReplace = jest.fn();

const mockSettings: ReturnType<typeof useSettings> = {
  fontSizeIndex: 2,
  fontSize: 20,
  lineHeight: 44,
  setFontSizeIndex: jest.fn(),
  theme: "beige",
  setTheme: jest.fn(),
  effectiveTheme: "beige",
  systemTheme: "white",
  themeSurface: "#FFF8F1",
  themeColors: {
    surface: "#FFF8F1",
    surfaceLow: "#F9F3EB",
    surfaceMid: "#F0EBE3",
    surfaceHigh: "#E8E1DA",
    surfaceDim: "#DFD9D1",
    surfaceBright: "#FFFFFF",
  },
  viewMode: "verse",
  setViewMode: jest.fn(),
  quranFontStyle: "qcf2",
  setQuranFontStyle: jest.fn(),
  quranMarkerStyle: "auto",
  setQuranMarkerStyle: jest.fn(),
  showAyahMarkers: true,
  setShowAyahMarkers: jest.fn(),
  pageScroll: "vertical",
  setPageScroll: jest.fn(),
  showTranslation: false,
  setShowTranslation: jest.fn(),
  showTafseer: false,
  setShowTafseer: jest.fn(),
  translationLanguage: "en",
  setTranslationLanguage: jest.fn(async () => undefined),
  isTranslationLoading: false,
  tafseerSource: DEFAULT_TAFSIR_SOURCE,
  setTafseerSource: jest.fn(),
  recitationId: DEFAULT_RECITATION_ID,
  setRecitationId: jest.fn(),
  uiLanguage: "ar",
  setUiLanguage: jest.fn(),
  dailyReviewLimit: 20,
  setDailyReviewLimit: jest.fn(),
  focusScrollSpeed: 1,
  setFocusScrollSpeed: jest.fn(),
  hifzAutoDelayMs: 500,
  setHifzAutoDelayMs: jest.fn(),
  hifzAutoAdvancePage: false,
  setHifzAutoAdvancePage: jest.fn(),
  isRTL: true,
  isDark: false,
  isLoaded: true,
};

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const originalWindowDimensions = ReactNative.Dimensions.get("window");
const originalScreenDimensions = ReactNative.Dimensions.get("screen");

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
  useLocalSearchParams: () => ({ deckId: "fixture-session-deck" }),
}));

jest.mock("@/lib/database/provider", () => ({
  useDatabase: () => mockDatabase,
  useDatabaseStatus: () => ({ isReady: true, progress: null, error: null }),
}));

jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return {
    ...actual,
    SettingsProvider: ({ children }: { children: React.ReactNode }) => children,
    useSettings: () => mockSettings,
    withThemeOpacity: actual.withThemeOpacity,
  };
});

jest.mock("@/lib/fonts/loader", () => ({
  isQuranPageFontLoaded: jest.fn(() => false),
  loadQuranPageFont: jest.fn(() => Promise.resolve()),
  quranPageFontName: jest.fn(() => "QCF2_fixture"),
  quranPageFontPaletteStyle: jest.fn(() => ({})),
  quranPageMarkerFontPaletteStyle: jest.fn(() => ({})),
}));

jest.mock("@/lib/fsrs/queries", () => ({
  deleteStudyCard: jest.fn(),
  getNextEligibleReviewDate: jest.fn(),
  getRemainingReviewLimit: jest.fn(),
  getStudyStreak: jest.fn(),
  getWirdStatus: jest.fn(),
  insertStudyLog: jest.fn(),
  readDeckReviewSettings: jest.fn(),
  resetStudyCardProgress: jest.fn(),
  setStudyCardBuried: jest.fn(),
  setStudyCardDueDate: jest.fn(),
  setStudyCardMarked: jest.fn(),
  setStudyCardSuspended: jest.fn(),
  updateCard: jest.fn(),
  MUTASHABIHAT_DECK_ID: "mutashabihat",
}));

jest.mock("@/lib/fsrs/smart-decks", () => ({
  getDueCardsForReview: jest.fn(),
  getSmartCardContent: jest.fn(),
  isSmartDeckId: jest.fn(),
  materializeSmartDeckCards: jest.fn(),
}));

jest.mock("@/lib/fsrs/scoring", () => ({
  addTodayPoints: jest.fn(),
  computeReviewPoints: jest.fn(() => 0),
}));

jest.mock("@/lib/haptics", () => ({
  hapticMedium: jest.fn(),
  hapticSuccess: jest.fn(),
}));

jest.mock("@/lib/achievements/queries", () => ({
  recordAchievementEvent: jest.fn(),
}));

jest.mock("@/lib/fsrs/leaderboard-sync", () => ({
  syncDailyScore: jest.fn(),
  updateProfileStats: jest.fn(),
}));

jest.mock("@/lib/database/user-settings", () => ({
  deleteUserSetting: jest.fn(),
  writeUserSetting: jest.fn(),
}));

jest.mock("@/lib/word/queries", () => ({
  fetchWordMeaningAr: jest.fn(),
  fetchWordText: jest.fn(),
  fetchWordTranslation: jest.fn(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => {
      if (!resolvePromise) throw new Error("Deferred promise was not initialized");
      resolvePromise(value);
    },
    reject: (reason) => {
      if (!rejectPromise) throw new Error("Deferred promise was not initialized");
      rejectPromise(reason);
    },
  };
}

function localDateWithOffset(days: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function makeStudyCard(id: string, due: Date): StudyCardRow {
  const dueIso = due.toISOString();
  return {
    id,
    deck_id: "fixture-session-deck",
    due: dueIso,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: State.New,
    last_review: null,
    suspended_at: null,
    buried_until: null,
    marked_at: null,
    created_at: dueIso,
    updated_at: dueIso,
    deleted_at: null,
  };
}

function makeSmartRef(groupId: string, surah: number, ayah: number): SmartDeckRef {
  return {
    groupId,
    sortOrder: 0,
    surah,
    ayah,
    surahNameAr: `Synthetic Surah ${surah}`,
    surahNameEn: `Synthetic Surah ${surah}`,
    tail5: null,
    textUthmani: `Synthetic text ${surah}:${ayah}`,
    textClean: `Synthetic clean ${surah}:${ayah}`,
    textQcf2: `synthetic-qcf2-${surah}-${ayah}`,
    v2Page: 7 + surah,
  };
}

const firstCard = makeStudyCard("mutashabihat:fixture-one:0", localDateWithOffset(2));
const secondCard = makeStudyCard("mutashabihat:fixture-two:0", localDateWithOffset(5));
const firstCue = "First synthetic cue";
const secondCue = "Second synthetic cue";
const firstRef = makeSmartRef("fixture-one", 2, 10);
const secondRef = makeSmartRef("fixture-two", 3, 20);
const firstSmartContent: SmartCardContent = {
  kind: "mutashabihat",
  cue: firstCue,
  targetRef: firstRef,
  refs: [firstRef],
};
const secondSmartContent: SmartCardContent = {
  kind: "mutashabihat",
  cue: secondCue,
  targetRef: secondRef,
  refs: [secondRef],
};
const smartContentById = new Map<string, SmartCardContent>([
  [firstCard.id, firstSmartContent],
  [secondCard.id, secondSmartContent],
]);

const reviewSettings = {
  dailyReviewLimit: 2,
  newCardsLimit: 2,
  requestRetention: 0.95,
  maximumInterval: 365,
  enableFuzz: true,
  enableShortTerm: true,
  learningSteps: ["1m", "10m"],
  relearningSteps: ["10m"],
  newReviewOrder: "mixed",
  reviewSortOrder: "due",
  newCardSortOrder: "created",
  testModes: ["nextAyah", "translation", "surahName"],
  wordTestModes: ["wordMeaningArabic", "wordMeaningTranslation"],
} satisfies DeckReviewSettings;

type RenderedNode = ReturnType<ReturnType<typeof render>["getByText"]>;

function getTextButton(view: ReturnType<typeof render>, label: string): RenderedNode {
  let current: RenderedNode | null = view.getByText(label);
  while (current.parent) {
    current = current.parent;
    if (current.props.accessibilityState && typeof current.props.accessibilityState === "object") return current;
  }
  throw new Error(`No rendered button for ${label}`);
}

function configureSettings(language: "ar" | "en", isDark: boolean) {
  mockSettings.uiLanguage = language;
  mockSettings.isRTL = language === "ar";
  mockSettings.isDark = isDark;
  mockSettings.effectiveTheme = isDark ? "dark" : "beige";
  mockSettings.systemTheme = isDark ? "dark" : "white";
  mockSettings.theme = isDark ? "dark" : "beige";
  mockSettings.themeSurface = isDark ? "#0A0A0A" : "#FFF8F1";
  mockSettings.themeColors = isDark
    ? {
        surface: "#0A0A0A",
        surfaceLow: "#141414",
        surfaceMid: "#1A1A1A",
        surfaceHigh: "#262626",
        surfaceDim: "#0F0F0F",
        surfaceBright: "#2D2D2D",
      }
    : {
        surface: "#FFF8F1",
        surfaceLow: "#F9F3EB",
        surfaceMid: "#F0EBE3",
        surfaceHigh: "#E8E1DA",
        surfaceDim: "#DFD9D1",
        surfaceBright: "#FFFFFF",
      };
}

function renderSession() {
  return render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <DirectionProvider dir={mockSettings.isRTL ? "rtl" : "ltr"}>
        <FlashcardSessionScreenWrapper />
      </DirectionProvider>
    </SafeAreaProvider>,
    { concurrentRoot: false },
  );
}

async function openDueDateEditor(view: ReturnType<typeof render>, s: UIStrings): Promise<RenderedNode> {
  await waitFor(() => {
    expect(view.getByText(firstCue)).toBeTruthy();
    expect(view.getByRole("button", { name: s.cardActionsTitle })).toBeTruthy();
  });
  expect(view.queryByPlaceholderText(s.cardDueDatePlaceholder)).toBeNull();

  if (view.queryByText(s.flashcardsReveal)) {
    fireEvent.press(getTextButton(view, s.flashcardsReveal));
    await waitFor(() => expect(view.getAllByText(s.smartDeckTargetAyah).length).toBeGreaterThan(0));
  }

  fireEvent.press(view.getByRole("button", { name: s.cardActionsTitle }));
  await waitFor(() => expect(view.getByText(s.cardActionsTitle)).toBeTruthy());
  fireEvent.press(view.getByRole("button", { name: s.cardSetDueDate }));
  await waitFor(() => expect(view.getByPlaceholderText(s.cardDueDatePlaceholder)).toBeTruthy());
  expect(view.queryByText(s.cardActionsTitle)).toBeNull();
  return view.getByPlaceholderText(s.cardDueDatePlaceholder);
}

describe("Flashcard session due-date editor characterization", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    configureSettings("ar", false);
    ReactNative.Dimensions.set({
      window: { width: 390, height: 844, scale: 1, fontScale: 1 },
      screen: { width: 390, height: 844, scale: 1, fontScale: 1 },
    });
    jest.mocked(readDeckReviewSettings).mockResolvedValue(reviewSettings);
    jest.mocked(getStudyStreak).mockResolvedValue(0);
    jest.mocked(getRemainingReviewLimit).mockResolvedValue(2);
    jest.mocked(getDueCardsForReview).mockResolvedValue([firstCard, secondCard]);
    jest.mocked(getSmartCardContent).mockImplementation(async (_db, cardId) => smartContentById.get(cardId) ?? null);
    jest.mocked(isSmartDeckId).mockReturnValue(false);
    jest.mocked(materializeSmartDeckCards).mockResolvedValue(0);
    jest.mocked(setStudyCardDueDate).mockResolvedValue(firstCard);
    jest.mocked(computeReviewPoints).mockReturnValue(0);
    jest.mocked(loadQuranPageFont).mockResolvedValue();
    jest.mocked(isQuranPageFontLoaded).mockReturnValue(true);
    jest.mocked(quranPageFontName).mockReturnValue("QCF2_fixture");
    jest.mocked(quranPageFontPaletteStyle).mockReturnValue({});
    jest.mocked(quranPageMarkerFontPaletteStyle).mockReturnValue({});
  });

  afterEach(() => {
    cleanup();
    ReactNative.Dimensions.set({ window: originalWindowDimensions, screen: originalScreenDimensions });
    jest.restoreAllMocks();
  });

  it("characterizes Arabic light validation, native input options, cancel, and reopen", async () => {
    const s = strings.ar;
    const view = renderSession();
    const input = await openDueDateEditor(view, s);
    const inputStyle = flattenStyle(input.props.style);

    expect(input.props.value).toBe(formatLocalDateInput(new Date(firstCard.due)));
    expect(input.props.keyboardType).toBe("numbers-and-punctuation");
    expect(input.props.autoCapitalize).toBe("none");
    expect(input.props.autoCorrect).toBe(false);
    expect(input.props.placeholder).toBe(s.cardDueDatePlaceholder);
    expect(input.props.placeholderTextColor).toBe("#b9a085");
    expect(input.props.className).toContain("min-h-12 rounded-2xl bg-surface-low dark:bg-surface-dark-low");
    expect(inputStyle).toMatchObject({ fontFamily: "Manrope_500Medium", fontSize: 16 });
    expectTextAlignStart(input, "rtl");
    expectWritingDirection(input, "ltr");
    expect(loadQuranPageFont).not.toHaveBeenCalled();

    const editorSheet = view
      .UNSAFE_getAllByType(ResponsiveSheet)
      .find((node) => node.props.maxWidth === 420 && node.props.maxHeight === 360);
    if (!editorSheet) throw new Error("The session due-date editor sheet was not rendered");
    expect(editorSheet.props).toMatchObject({ maxWidth: 420, maxHeight: 360, avoidKeyboard: true });
    const renderedEditorSheet = view
      .UNSAFE_getAllByType(ReactNative.Animated.View)
      .find((node) => flattenStyle(node.props.style).maxHeight === 360);
    if (!renderedEditorSheet) throw new Error("The rendered session due-date sheet was not found");
    expect(flattenStyle(renderedEditorSheet.props.style)).toMatchObject({ width: 390, maxHeight: 360 });
    expect(view.UNSAFE_getAllByType(ReactNative.KeyboardAvoidingView)).not.toHaveLength(0);

    fireEvent.changeText(input, "not-a-date");
    fireEvent.press(getTextButton(view, s.cardSaveDueDate));
    await waitFor(() => expect(view.getByText(s.cardDueDateInvalid)).toBeTruthy());
    expect(setStudyCardDueDate).not.toHaveBeenCalled();
    expect(hapticMedium).not.toHaveBeenCalled();

    fireEvent.changeText(input, formatLocalDateInput(localDateWithOffset(-2)));
    expect(view.getByText(s.cardDueDateInvalid)).toBeTruthy();
    fireEvent.press(getTextButton(view, s.cardSaveDueDate));
    await waitFor(() => expect(view.getByText(s.cardDueDatePast)).toBeTruthy());
    expect(view.queryByText(s.cardDueDateInvalid)).toBeNull();
    expect(setStudyCardDueDate).not.toHaveBeenCalled();
    expect(hapticMedium).not.toHaveBeenCalled();

    fireEvent.press(getTextButton(view, s.flashcardsCancel));
    await waitFor(() => expect(view.queryByPlaceholderText(s.cardDueDatePlaceholder)).toBeNull());
    expect(view.getByText(firstCue)).toBeTruthy();
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(setStudyCardDueDate).not.toHaveBeenCalled();

    const reopenedInput = await openDueDateEditor(view, s);
    expect(reopenedInput.props.value).toBe(formatLocalDateInput(new Date(firstCard.due)));
    expect(view.queryByText(s.cardDueDatePast)).toBeNull();
    expect(loadQuranPageFont).not.toHaveBeenCalled();
  });

  it("characterizes English dark busy guards, haptics, persistence, and real advance", async () => {
    configureSettings("en", true);
    const s = strings.en;
    const view = renderSession();
    const input = await openDueDateEditor(view, s);
    const inputStyle = flattenStyle(input.props.style);
    expect(input.props.placeholderTextColor).toBe("#737373");
    expect(input.props.className).toContain("text-charcoal dark:text-neutral-100");
    expect(inputStyle).toMatchObject({ fontFamily: "Manrope_500Medium", fontSize: 16 });
    expectTextAlignStart(input, "ltr");
    expectWritingDirection(input, "ltr");

    const saveDateKey = formatLocalDateInput(localDateWithOffset(9));
    const parsed = parseDueDateInput(saveDateKey);
    if (!parsed.ok) throw new Error("The relative future fixture date must be valid");
    const deferred = createDeferred<StudyCardRow>();
    jest.mocked(setStudyCardDueDate).mockReturnValueOnce(deferred.promise);

    try {
      fireEvent.changeText(input, saveDateKey);
      fireEvent.press(getTextButton(view, s.cardSaveDueDate));
      await waitFor(() => expect(getTextButton(view, s.cardSaveDueDate).props.accessibilityState.disabled).toBe(true));
      expect(getTextButton(view, s.flashcardsCancel).props.accessibilityState.disabled).toBe(true);
      expect(hapticMedium).toHaveBeenCalledTimes(1);

      let editorModal: RenderedNode | null = input;
      while (editorModal && editorModal.type !== ReactNative.Modal) {
        editorModal = editorModal.parent;
      }
      if (!editorModal) throw new Error("The session due-date editor modal was not rendered");
      expect(editorModal.props.visible).toBe(true);
      fireEvent(editorModal, "requestClose");
      expect(view.getByPlaceholderText(s.cardDueDatePlaceholder)).toBeTruthy();

      deferred.resolve(firstCard);
      await act(async () => {
        await deferred.promise;
      });
      await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
      expect(view.queryByText(firstCue)).toBeNull();
      expect(view.queryByPlaceholderText(s.cardDueDatePlaceholder)).toBeNull();
      expect(setStudyCardDueDate).toHaveBeenCalledTimes(1);
      expect(setStudyCardDueDate).toHaveBeenCalledWith(mockDatabase, firstCard.deck_id, firstCard.id, parsed.date);
      expect(mockRouterReplace).not.toHaveBeenCalled();
      expect(insertStudyLog).not.toHaveBeenCalled();
      expect(updateCard).not.toHaveBeenCalled();
      expect(addTodayPoints).not.toHaveBeenCalled();
      expect(recordAchievementEvent).not.toHaveBeenCalled();
      expect(syncDailyScore).not.toHaveBeenCalled();
      expect(updateProfileStats).not.toHaveBeenCalled();
      expect(getNextEligibleReviewDate).not.toHaveBeenCalled();
      expect(getWirdStatus).not.toHaveBeenCalled();
      expect(loadQuranPageFont).not.toHaveBeenCalled();
    } finally {
      deferred.resolve(firstCard);
      await act(async () => {
        await deferred.promise;
      });
    }
  });

  it("keeps the real editor open after rejected persistence and reports the actual failure", async () => {
    configureSettings("en", true);
    const s = strings.en;
    const view = renderSession();
    const input = await openDueDateEditor(view, s);
    const failure = new Error("session date write failed");
    const failedDateKey = formatLocalDateInput(localDateWithOffset(9));
    const deferred = createDeferred<StudyCardRow>();
    jest.mocked(setStudyCardDueDate).mockReturnValueOnce(deferred.promise);
    const expectedWarning: [string, Error] = ["[FlashcardSession] Card action failed:", failure];
    const originalWarn = console.warn;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation((...args) => {
      const isExpectedWarning =
        args.length === expectedWarning.length && args.every((arg, index) => arg === expectedWarning[index]);
      if (!isExpectedWarning) originalWarn(...args);
    });

    try {
      try {
        fireEvent.changeText(input, failedDateKey);
        fireEvent.press(getTextButton(view, s.cardSaveDueDate));
        await waitFor(() =>
          expect(getTextButton(view, s.cardSaveDueDate).props.accessibilityState.disabled).toBe(true),
        );
        deferred.reject(failure);
        await act(async () => {
          await deferred.promise.catch(() => undefined);
        });
        await waitFor(() => expect(view.getByText(s.cardActionFailed)).toBeTruthy());
        expect(view.getByPlaceholderText(s.cardDueDatePlaceholder)).toBeTruthy();
        expect(input.props.value).toBe(failedDateKey);
        expect(getTextButton(view, s.cardSaveDueDate).props.accessibilityState.disabled).toBe(false);
        expect(getTextButton(view, s.flashcardsCancel).props.accessibilityState.disabled).toBe(false);
        expect(view.getByText(firstCue)).toBeTruthy();
        expect(view.queryByText(secondCue)).toBeNull();
        expect(mockRouterReplace).not.toHaveBeenCalled();
        expect(setStudyCardDueDate).toHaveBeenCalledTimes(1);
        expect(hapticMedium).toHaveBeenCalledTimes(1);
        expect(getDueCardsForReview).toHaveBeenCalledTimes(1);
      } finally {
        deferred.reject(failure);
        await act(async () => {
          await deferred.promise.catch(() => undefined);
        });
      }
      expect(warnSpy.mock.calls).toEqual([expectedWarning]);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
