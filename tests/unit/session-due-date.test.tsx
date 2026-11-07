import React from "react";
import * as ReactNative from "react-native";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import FlashcardSessionScreenWrapper from "@/app/flashcards/session";
import { Card } from "@/components/ui/Card";
import { ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { DirectionProvider } from "@/lib/ui/direction";
import { useSettings } from "@/lib/settings/context";
import { strings, type UIStrings } from "@/lib/i18n/strings";
import { formatLocalDateInput, parseDueDateInput } from "@/lib/date";
import { Rating, State } from "@/lib/fsrs/scheduler";
import { calculateReviewTransition } from "@/lib/fsrs/review-transition";
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
  deleteStudyCard,
  setStudyCardBuried,
  getNextEligibleReviewDate,
  getRemainingReviewLimit,
  getStudyStreak,
  getWirdStatus,
  putStudyLogRow,
  readDeckReviewSettings,
  resetStudyCardProgress,
  setStudyCardDueDate,
  setStudyCardMarked,
  setStudyCardSuspended,
  putCardRow,
} from "@/lib/fsrs/queries";
import { hapticMedium } from "@/lib/haptics";
import { recordAchievementEvent } from "@/lib/achievements/queries";
import { syncDailyScore, updateProfileStats } from "@/lib/fsrs/leaderboard-sync";
import { deleteUserSetting, writeUserSetting } from "@/lib/database/user-settings";
import {
  isQuranPageFontLoaded,
  loadQuranPageFont,
  quranPageFontName,
  quranPageFontPaletteStyle,
  quranPageMarkerFontPaletteStyle,
} from "@/lib/fonts/loader";
import { expectTextAlignStart, expectWritingDirection, flattenStyle } from "../rtl/rtl-test-utils";

const NativeModal = ReactNative.Modal;
// Review persistence runs its card and log writes inside one transaction on this database.
const mockDatabase = Object.freeze({
  identity: "session-due-date-database",
  withTransactionAsync: async (task: (transaction: unknown) => Promise<void>) => task(mockDatabase),
});
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
  publishReviewLogged: jest.fn(),
  putStudyLogRow: jest.fn(),
  readDeckReviewSettings: jest.fn(),
  resetStudyCardProgress: jest.fn(),
  setStudyCardBuried: jest.fn(),
  setStudyCardDueDate: jest.fn(),
  setStudyCardMarked: jest.fn(),
  setStudyCardSuspended: jest.fn(),
  putCardRow: jest.fn(),
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

function getVisibleModal(node: RenderedNode): RenderedNode {
  let modal: RenderedNode | null = node;
  while (modal && modal.type !== NativeModal) {
    modal = modal.parent;
  }
  if (!modal) throw new Error("The expected visible session modal was not rendered");
  expect(modal.props.visible).toBe(true);
  return modal;
}

function getVisibleModalByText(view: ReturnType<typeof render>, text: string): RenderedNode {
  const modal = findVisibleModalByText(view, text);
  if (modal) return modal;
  throw new Error(`No visible modal contains ${text}`);
}

function findVisibleModalByText(view: ReturnType<typeof render>, text: string): RenderedNode | null {
  for (const node of view.queryAllByText(text)) {
    let modal: RenderedNode | null = node;
    while (modal && modal.type !== NativeModal) {
      modal = modal.parent;
    }
    if (modal?.props.visible === true) return modal;
  }
  return null;
}

async function openDueDateEditor(
  view: ReturnType<typeof render>,
  s: UIStrings,
  phase: "front" | "revealed",
): Promise<RenderedNode> {
  await waitFor(() => {
    expect(view.getByText(firstCue)).toBeTruthy();
    expect(view.getByRole("button", { name: s.cardActionsTitle })).toBeTruthy();
  });
  expect(view.queryByPlaceholderText(s.cardDueDatePlaceholder)).toBeNull();

  if (phase === "revealed") {
    expect(view.getByText(s.flashcardsReveal)).toBeTruthy();
    fireEvent.press(getTextButton(view, s.flashcardsReveal));
    await waitFor(() => expect(view.getAllByText(s.smartDeckTargetAyah).length).toBeGreaterThan(0));
    expect(view.getByText(`${s.smartDeckComparisonCue}: ${firstCue}`)).toBeTruthy();
    expect(view.queryByText(s.flashcardsReveal)).toBeNull();
  } else {
    expect(view.getByText(s.flashcardsReveal)).toBeTruthy();
  }

  fireEvent.press(view.getByRole("button", { name: s.cardActionsTitle }));
  await waitFor(() => expect(view.getByText(s.cardActionsTitle)).toBeTruthy());
  fireEvent.press(view.getByRole("button", { name: s.cardSetDueDate }));
  await waitFor(() => expect(view.getByPlaceholderText(s.cardDueDatePlaceholder)).toBeTruthy());
  expect(view.queryByText(s.cardActionsTitle)).toBeNull();
  return view.getByPlaceholderText(s.cardDueDatePlaceholder);
}

async function openAnswerEditor(
  view: ReturnType<typeof render>,
  s: UIStrings,
  phase: "front" | "revealed",
  reveal = phase === "revealed",
  revealedAnswer: "default" | string = "default",
): Promise<RenderedNode> {
  await waitFor(() => {
    expect(view.getByText(firstCue)).toBeTruthy();
    expect(view.getByRole("button", { name: s.cardActionsTitle })).toBeTruthy();
  });

  if (phase === "revealed" && reveal) {
    expect(view.getByText(s.flashcardsReveal)).toBeTruthy();
    fireEvent.press(getTextButton(view, s.flashcardsReveal));
    await waitFor(() => expect(view.getByText(`${s.smartDeckComparisonCue}: ${firstCue}`)).toBeTruthy());
  }

  if (phase === "front") {
    expect(view.getByText(s.flashcardsReveal)).toBeTruthy();
  } else {
    if (revealedAnswer === "default") {
      expect(view.getByText(`${s.smartDeckComparisonCue}: ${firstCue}`)).toBeTruthy();
    } else {
      expect(view.getByText(revealedAnswer)).toBeTruthy();
    }
    expect(view.queryByText(s.flashcardsReveal)).toBeNull();
  }

  fireEvent.press(view.getByRole("button", { name: s.cardActionsTitle }));
  await waitFor(() => expect(view.getByText(s.cardActionsTitle)).toBeTruthy());
  fireEvent.press(view.getByRole("button", { name: s.cardEditAnswer }));
  await waitFor(() => expect(view.getByPlaceholderText(s.cardEditAnswerPlaceholder)).toBeTruthy());
  return view.getByPlaceholderText(s.cardEditAnswerPlaceholder);
}

type DirectCardAction = "suspend" | "bury" | "mark";
type DirectCardActionCase = readonly [string, "ar" | "en", boolean, "front" | "revealed", DirectCardAction];

type DueDateRetryCase = readonly [string, "ar" | "en", boolean, string, "invalid" | "past"];

const dueDateRetryCases: readonly DueDateRetryCase[] = [
  ["Arabic light invalid-format", "ar", false, "not-a-date", "invalid"],
  ["English dark past-date", "en", true, formatLocalDateInput(localDateWithOffset(-2)), "past"],
];

const directCardActionCases: readonly DirectCardActionCase[] = [
  ["Arabic light front Suspend", "ar", false, "front", "suspend"],
  ["English dark revealed Suspend", "en", true, "revealed", "suspend"],
  ["Arabic light front Bury", "ar", false, "front", "bury"],
  ["English dark revealed Bury", "en", true, "revealed", "bury"],
  ["Arabic light front Mark", "ar", false, "front", "mark"],
  ["English dark revealed Mark", "en", true, "revealed", "mark"],
];

function directCardActionLabel(s: UIStrings, action: DirectCardAction): string {
  if (action === "suspend") return s.cardSuspend;
  if (action === "bury") return s.cardBury;
  return s.cardMark;
}

async function openDirectCardAction(
  view: ReturnType<typeof render>,
  s: UIStrings,
  phase: "front" | "revealed",
  action: DirectCardAction,
) {
  await waitFor(() => {
    expect(view.getByText(firstCue)).toBeTruthy();
    expect(view.getByRole("button", { name: s.cardActionsTitle })).toBeTruthy();
  });

  if (phase === "revealed") {
    fireEvent.press(getTextButton(view, s.flashcardsReveal));
    await waitFor(() => expect(view.getAllByText(s.smartDeckTargetAyah).length).toBeGreaterThan(0));
    expect(view.getByText(`${s.smartDeckComparisonCue}: ${firstCue}`)).toBeTruthy();
    expect(view.queryByText(s.flashcardsReveal)).toBeNull();
  }

  fireEvent.press(view.getByRole("button", { name: s.cardActionsTitle }));
  await waitFor(() => expect(view.getByText(s.cardActionsTitle)).toBeTruthy());
  fireEvent.press(view.getByRole("button", { name: directCardActionLabel(s, action) }));
}

function configureRejectedDirectAction(
  action: DirectCardAction,
  deferred: Deferred<StudyCardRow>,
  retryResult: StudyCardRow,
) {
  if (action === "suspend") {
    jest.mocked(setStudyCardSuspended).mockReturnValueOnce(deferred.promise).mockResolvedValueOnce(retryResult);
    return;
  }
  if (action === "bury") {
    jest.mocked(setStudyCardBuried).mockReturnValueOnce(deferred.promise).mockResolvedValueOnce(retryResult);
    return;
  }
  jest.mocked(setStudyCardMarked).mockReturnValueOnce(deferred.promise).mockResolvedValueOnce(retryResult);
}

function expectDirectCardActionCalls(action: DirectCardAction) {
  if (action === "suspend") {
    expect(setStudyCardSuspended).toHaveBeenCalledTimes(2);
    expect(setStudyCardSuspended).toHaveBeenNthCalledWith(1, mockDatabase, firstCard.deck_id, firstCard.id, true);
    expect(setStudyCardSuspended).toHaveBeenNthCalledWith(2, mockDatabase, firstCard.deck_id, firstCard.id, true);
    expect(setStudyCardBuried).not.toHaveBeenCalled();
    expect(setStudyCardMarked).not.toHaveBeenCalled();
    return;
  }
  if (action === "bury") {
    expect(setStudyCardBuried).toHaveBeenCalledTimes(2);
    expect(setStudyCardBuried).toHaveBeenNthCalledWith(1, mockDatabase, firstCard.deck_id, firstCard.id, true);
    expect(setStudyCardBuried).toHaveBeenNthCalledWith(2, mockDatabase, firstCard.deck_id, firstCard.id, true);
    expect(setStudyCardSuspended).not.toHaveBeenCalled();
    expect(setStudyCardMarked).not.toHaveBeenCalled();
    return;
  }
  expect(setStudyCardMarked).toHaveBeenCalledTimes(2);
  expect(setStudyCardMarked).toHaveBeenNthCalledWith(1, mockDatabase, firstCard.deck_id, firstCard.id, true);
  expect(setStudyCardMarked).toHaveBeenNthCalledWith(2, mockDatabase, firstCard.deck_id, firstCard.id, true);
  expect(setStudyCardSuspended).not.toHaveBeenCalled();
  expect(setStudyCardBuried).not.toHaveBeenCalled();
}

type ConfirmCardAction = "delete" | "reset";

function confirmCardActionLabel(s: UIStrings, action: ConfirmCardAction): string {
  return action === "delete" ? s.cardDelete : s.cardResetProgress;
}

function confirmCardActionTitle(s: UIStrings, action: ConfirmCardAction): string {
  return action === "delete" ? s.cardDeleteTitle : s.cardResetTitle;
}

async function openConfirmCardAction(
  view: ReturnType<typeof render>,
  s: UIStrings,
  phase: "front" | "revealed",
  action: ConfirmCardAction,
): Promise<RenderedNode> {
  await waitFor(() => {
    expect(view.getByText(firstCue)).toBeTruthy();
    expect(view.getByRole("button", { name: s.cardActionsTitle })).toBeTruthy();
  });

  if (phase === "revealed") {
    fireEvent.press(getTextButton(view, s.flashcardsReveal));
    await waitFor(() => expect(view.getAllByText(s.smartDeckTargetAyah).length).toBeGreaterThan(0));
    expect(view.getByText(`${s.smartDeckComparisonCue}: ${firstCue}`)).toBeTruthy();
    expect(view.queryByText(s.flashcardsReveal)).toBeNull();
  }

  fireEvent.press(view.getByRole("button", { name: s.cardActionsTitle }));
  await waitFor(() => expect(view.getByText(s.cardActionsTitle)).toBeTruthy());
  fireEvent.press(view.getByRole("button", { name: confirmCardActionLabel(s, action) }));
  return getVisibleModalByText(view, confirmCardActionTitle(s, action));
}

function expectExactlyTwoDisabledDialogButtons(modal: RenderedNode): void {
  const disabledButtons = within(modal)
    .getAllByRole("button")
    .filter((button) => button.props.accessibilityState?.disabled === true);
  expect(disabledButtons).toHaveLength(2);
}

function expectExactlyTwoEnabledDialogButtons(modal: RenderedNode): void {
  const buttons = within(modal).getAllByRole("button");
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    expect(button.props.accessibilityState?.disabled).toBe(false);
  }
}

function expectNoUnrelatedCardActionCalls(): void {
  expectNoUnrelatedCardActionServiceCalls();
  expect(writeUserSetting).not.toHaveBeenCalled();
  expect(deleteUserSetting).not.toHaveBeenCalled();
}

function expectNoUnrelatedCardActionServiceCalls(): void {
  expect(setStudyCardSuspended).not.toHaveBeenCalled();
  expect(setStudyCardBuried).not.toHaveBeenCalled();
  expect(setStudyCardMarked).not.toHaveBeenCalled();
  expect(setStudyCardDueDate).not.toHaveBeenCalled();
  expect(computeReviewPoints).not.toHaveBeenCalled();
  expect(putStudyLogRow).not.toHaveBeenCalled();
  expect(putCardRow).not.toHaveBeenCalled();
  expect(addTodayPoints).not.toHaveBeenCalled();
  expect(recordAchievementEvent).not.toHaveBeenCalled();
  expect(syncDailyScore).not.toHaveBeenCalled();
  expect(updateProfileStats).not.toHaveBeenCalled();
  expect(mockRouterReplace).not.toHaveBeenCalled();
  expect(getNextEligibleReviewDate).not.toHaveBeenCalled();
  expect(getWirdStatus).not.toHaveBeenCalled();
}

describe("Flashcard session due-date editor characterization", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Restore the React Native preset clock cleared by the fixture mock reset.
    jest.mocked(performance.now).mockImplementation(Date.now);
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

  it("keeps a finite React Native clock after fixture mock reset", () => {
    expect(Number.isFinite(performance.now())).toBe(true);
  });

  it("characterizes Arabic light validation, native input options, cancel, and reopen", async () => {
    const s = strings.ar;
    const view = renderSession();
    const input = await openDueDateEditor(view, s, "front");
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

    const reopenedInput = await openDueDateEditor(view, s, "front");
    expect(reopenedInput.props.value).toBe(formatLocalDateInput(new Date(firstCard.due)));
    expect(view.queryByText(s.cardDueDatePast)).toBeNull();
    expect(loadQuranPageFont).not.toHaveBeenCalled();
  });

  it("characterizes English dark busy guards, haptics, persistence, and real advance", async () => {
    configureSettings("en", true);
    const s = strings.en;
    const view = renderSession();
    const input = await openDueDateEditor(view, s, "front");
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

      const editorModal = getVisibleModal(input);
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
      expect(putStudyLogRow).not.toHaveBeenCalled();
      expect(putCardRow).not.toHaveBeenCalled();
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
    const input = await openDueDateEditor(view, s, "revealed");
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
        const editorModal = getVisibleModal(input);
        expect(within(editorModal).getByText(s.cardActionFailed)).toBeTruthy();
        expect(view.getByPlaceholderText(s.cardDueDatePlaceholder)).toBeTruthy();
        expect(input.props.value).toBe(failedDateKey);
        expect(getTextButton(view, s.cardSaveDueDate).props.accessibilityState.disabled).toBe(false);
        expect(getTextButton(view, s.flashcardsCancel).props.accessibilityState.disabled).toBe(false);
        expect(view.getByText(firstCue)).toBeTruthy();
        expect(view.queryByText(secondCue)).toBeNull();
        expect(view.getByText(`${s.smartDeckComparisonCue}: ${firstCue}`)).toBeTruthy();
        expect(view.queryByText(s.flashcardsReveal)).toBeNull();
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

  it.each([
    ["Arabic light", "ar", false],
    ["English dark", "en", true],
  ] as const)("shows rejected front-state date writes in the active modal for %s", async (_label, language, isDark) => {
    configureSettings(language, isDark);
    const s = language === "ar" ? strings.ar : strings.en;
    const view = renderSession();
    const input = await openDueDateEditor(view, s, "front");
    const failure = new Error("front session date write failed");
    const failedDateKey = formatLocalDateInput(localDateWithOffset(11));
    const parsed = parseDueDateInput(failedDateKey);
    if (!parsed.ok) throw new Error("The relative future fixture date must be valid");
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
        await waitFor(() => {
          const editorModal = getVisibleModal(input);
          expect(within(editorModal).getByText(s.cardActionFailed)).toBeTruthy();
        });
        expect(input.props.value).toBe(failedDateKey);
        expect(getTextButton(view, s.cardSaveDueDate).props.accessibilityState.disabled).toBe(false);
        expect(getTextButton(view, s.flashcardsCancel).props.accessibilityState.disabled).toBe(false);
        expect(view.getByText(firstCue)).toBeTruthy();
        expect(view.getByText(s.flashcardsReveal)).toBeTruthy();
        expect(mockRouterReplace).not.toHaveBeenCalled();
        expect(setStudyCardDueDate).toHaveBeenCalledTimes(1);
        expect(setStudyCardDueDate).toHaveBeenCalledWith(mockDatabase, firstCard.deck_id, firstCard.id, parsed.date);
        expect(hapticMedium).toHaveBeenCalledTimes(1);
        expect(putStudyLogRow).not.toHaveBeenCalled();
        expect(putCardRow).not.toHaveBeenCalled();
        expect(addTodayPoints).not.toHaveBeenCalled();
        expect(recordAchievementEvent).not.toHaveBeenCalled();
        expect(syncDailyScore).not.toHaveBeenCalled();
        expect(updateProfileStats).not.toHaveBeenCalled();
        expect(getNextEligibleReviewDate).not.toHaveBeenCalled();
        expect(getWirdStatus).not.toHaveBeenCalled();

        fireEvent.press(getTextButton(view, s.flashcardsCancel));
        await waitFor(() => expect(view.queryByPlaceholderText(s.cardDueDatePlaceholder)).toBeNull());
        expect(view.getByText(firstCue)).toBeTruthy();
        expect(view.getByText(s.flashcardsReveal)).toBeTruthy();

        const reopenedInput = await openDueDateEditor(view, s, "front");
        const reopenedModal = getVisibleModal(reopenedInput);
        expect(reopenedInput.props.value).toBe(formatLocalDateInput(new Date(firstCard.due)));
        expect(within(reopenedModal).queryByText(s.cardActionFailed)).toBeNull();
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

  it.each([
    ["Arabic light front", "ar", false, "front"],
    ["English dark revealed", "en", true, "revealed"],
  ] as const)(
    "keeps the Delete confirmation open for a rejected write and retries through the real route for %s",
    async (_label, language, isDark, phase) => {
      configureSettings(language, isDark);
      const s = language === "ar" ? strings.ar : strings.en;
      const view = renderSession();
      const failure = new Error("delete card action failed");
      const deferred = createDeferred<void>();
      jest.mocked(deleteStudyCard).mockReturnValueOnce(deferred.promise).mockResolvedValueOnce(undefined);
      const expectedWarning: [string, Error] = ["[FlashcardSession] Card action failed:", failure];
      const originalWarn = console.warn;
      const warnSpy = jest.spyOn(console, "warn").mockImplementation((...args) => {
        const isExpectedWarning =
          args.length === expectedWarning.length && args.every((arg, index) => arg === expectedWarning[index]);
        if (isExpectedWarning) return;
        originalWarn(...args);
      });

      try {
        try {
          const modal = await openConfirmCardAction(view, s, phase, "delete");
          expect(within(modal).getByText(s.cardDeleteConfirm)).toBeTruthy();
          fireEvent.press(within(modal).getByRole("button", { name: s.flashcardsDelete }));
          await waitFor(() => expectExactlyTwoDisabledDialogButtons(getVisibleModalByText(view, s.cardDeleteTitle)));
          const busyModal = getVisibleModalByText(view, s.cardDeleteTitle);
          fireEvent(busyModal, "requestClose");
          expect(within(getVisibleModalByText(view, s.cardDeleteTitle)).getByText(s.cardDeleteConfirm)).toBeTruthy();

          deferred.reject(failure);
          await act(async () => {
            await deferred.promise.catch(() => undefined);
          });

          const failedModal = getVisibleModalByText(view, s.cardDeleteTitle);
          expect(within(failedModal).getByText(s.cardActionFailed)).toBeTruthy();
          expectExactlyTwoEnabledDialogButtons(failedModal);
          expect(view.getByText(firstCue)).toBeTruthy();
          expect(view.queryByText(secondCue)).toBeNull();
          if (phase === "front") {
            expect(view.getByText(s.flashcardsReveal)).toBeTruthy();
          } else {
            expect(view.getAllByText(s.smartDeckTargetAyah).length).toBeGreaterThan(0);
            expect(view.getByText(`${s.smartDeckComparisonCue}: ${firstCue}`)).toBeTruthy();
            expect(view.queryByText(s.flashcardsReveal)).toBeNull();
          }
          expect(view.getByRole("button", { name: s.cardActionsTitle }).props.accessibilityState.disabled).toBe(false);
          expect(deleteStudyCard).toHaveBeenCalledTimes(1);
          expect(deleteStudyCard).toHaveBeenNthCalledWith(1, mockDatabase, firstCard.deck_id, firstCard.id);
          expect(resetStudyCardProgress).not.toHaveBeenCalled();
          expect(hapticMedium).toHaveBeenCalledTimes(1);

          fireEvent.press(within(failedModal).getByRole("button", { name: s.flashcardsDelete }));
          await waitFor(() =>
            expect(view.UNSAFE_getAllByType(NativeModal).filter((node) => node.props.visible)).toHaveLength(0),
          );
          await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
          expect(view.queryByText(firstCue)).toBeNull();
          expect(deleteStudyCard).toHaveBeenCalledTimes(2);
          expect(deleteStudyCard).toHaveBeenNthCalledWith(2, mockDatabase, firstCard.deck_id, firstCard.id);
          expect(resetStudyCardProgress).not.toHaveBeenCalled();
          expect(hapticMedium).toHaveBeenCalledTimes(2);
          expect(view.getByRole("button", { name: s.cardActionsTitle }).props.accessibilityState.disabled).toBe(false);
          expectNoUnrelatedCardActionCalls();
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
    },
  );

  it.each(dueDateRetryCases)(
    "clears stale validation before a rejected valid save for %s",
    async (_label, language, isDark, invalidInput, validationKind) => {
      configureSettings(language, isDark);
      const s = language === "ar" ? strings.ar : strings.en;
      const view = renderSession();
      const input = await openDueDateEditor(view, s, "front");
      const editorModal = getVisibleModal(input);
      const validationMessage = validationKind === "past" ? s.cardDueDatePast : s.cardDueDateInvalid;
      const otherValidationMessage = validationKind === "past" ? s.cardDueDateInvalid : s.cardDueDatePast;

      fireEvent.changeText(input, invalidInput);
      fireEvent.press(within(editorModal).getByRole("button", { name: s.cardSaveDueDate }));
      await waitFor(() => expect(within(editorModal).getByText(validationMessage)).toBeTruthy());
      expect(within(editorModal).queryByText(otherValidationMessage)).toBeNull();
      expect(setStudyCardDueDate).not.toHaveBeenCalled();

      const validDateKey = formatLocalDateInput(localDateWithOffset(9));
      const parsed = parseDueDateInput(validDateKey);
      if (!parsed.ok) throw new Error("The relative future fixture date must be valid");
      const deferred = createDeferred<StudyCardRow>();
      jest.mocked(setStudyCardDueDate).mockReturnValueOnce(deferred.promise);
      const failure = new Error("session validation retry write failed");
      const expectedWarning: [string, Error] = ["[FlashcardSession] Card action failed:", failure];
      const originalWarn = console.warn;
      const warnSpy = jest.spyOn(console, "warn").mockImplementation((...args) => {
        const isExpectedWarning =
          args.length === expectedWarning.length && args.every((arg, index) => arg === expectedWarning[index]);
        if (!isExpectedWarning) originalWarn(...args);
      });

      try {
        try {
          fireEvent.changeText(input, validDateKey);
          fireEvent.press(within(editorModal).getByRole("button", { name: s.cardSaveDueDate }));
          await waitFor(() => {
            expect(within(editorModal).queryByText(validationMessage)).toBeNull();
            expect(within(editorModal).queryByText(otherValidationMessage)).toBeNull();
            expect(within(editorModal).queryByText(s.cardActionFailed)).toBeNull();
            expect(input.props.value).toBe(validDateKey);
            expect(getTextButton(view, s.cardSaveDueDate).props.accessibilityState.disabled).toBe(true);
            expect(getTextButton(view, s.flashcardsCancel).props.accessibilityState.disabled).toBe(true);
          });
          expect(hapticMedium).toHaveBeenCalledTimes(1);
          expect(setStudyCardDueDate).toHaveBeenCalledTimes(1);
          expect(setStudyCardDueDate).toHaveBeenCalledWith(mockDatabase, firstCard.deck_id, firstCard.id, parsed.date);

          fireEvent(editorModal, "requestClose");
          expect(view.getByPlaceholderText(s.cardDueDatePlaceholder)).toBeTruthy();
          fireEvent.press(within(editorModal).getByRole("button", { name: s.cardSaveDueDate }));
          expect(setStudyCardDueDate).toHaveBeenCalledTimes(1);

          deferred.reject(failure);
          await act(async () => {
            await deferred.promise.catch(() => undefined);
          });

          const failedModal = getVisibleModal(input);
          const error = within(failedModal).getByText(s.cardActionFailed);
          expect(error).toBeTruthy();
          expectWritingDirection(error, language === "ar" ? "rtl" : "ltr");
          expect(within(failedModal).queryByText(s.cardDueDateInvalid)).toBeNull();
          expect(within(failedModal).queryByText(s.cardDueDatePast)).toBeNull();
          expect(input.props.value).toBe(validDateKey);
          expect(getTextButton(view, s.cardSaveDueDate).props.accessibilityState.disabled).toBe(false);
          expect(getTextButton(view, s.flashcardsCancel).props.accessibilityState.disabled).toBe(false);
          expect(view.getByText(firstCue)).toBeTruthy();
          expect(view.getByText(s.flashcardsReveal)).toBeTruthy();
          expect(view.queryByText(secondCue)).toBeNull();
          expect(getDueCardsForReview).toHaveBeenCalledTimes(1);
          expect(mockRouterReplace).not.toHaveBeenCalled();
          expect(setStudyCardDueDate).toHaveBeenCalledTimes(1);

          fireEvent.press(getTextButton(view, s.flashcardsCancel));
          await waitFor(() => expect(view.queryByPlaceholderText(s.cardDueDatePlaceholder)).toBeNull());
          const reopenedInput = await openDueDateEditor(view, s, "front");
          const reopenedModal = getVisibleModal(reopenedInput);
          expect(reopenedInput.props.value).toBe(formatLocalDateInput(new Date(firstCard.due)));
          expect(within(reopenedModal).queryByText(s.cardActionFailed)).toBeNull();
          expect(within(reopenedModal).queryByText(s.cardDueDateInvalid)).toBeNull();
          expect(within(reopenedModal).queryByText(s.cardDueDatePast)).toBeNull();
          expect(setStudyCardDueDate).toHaveBeenCalledTimes(1);
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
    },
  );

  it.each([
    ["Arabic light front", "ar", false, "front"],
    ["English dark revealed", "en", true, "revealed"],
  ] as const)(
    "keeps the Reset confirmation open for a rejected write and retries through the real route for %s",
    async (_label, language, isDark, phase) => {
      configureSettings(language, isDark);
      const s = language === "ar" ? strings.ar : strings.en;
      const view = renderSession();
      const failure = new Error("reset card action failed");
      const deferred = createDeferred<StudyCardRow>();
      jest.mocked(resetStudyCardProgress).mockReturnValueOnce(deferred.promise).mockResolvedValueOnce(firstCard);
      const expectedWarning: [string, Error] = ["[FlashcardSession] Card action failed:", failure];
      const originalWarn = console.warn;
      const warnSpy = jest.spyOn(console, "warn").mockImplementation((...args) => {
        const isExpectedWarning =
          args.length === expectedWarning.length && args.every((arg, index) => arg === expectedWarning[index]);
        if (isExpectedWarning) return;
        originalWarn(...args);
      });

      try {
        try {
          const modal = await openConfirmCardAction(view, s, phase, "reset");
          expect(within(modal).getByText(s.cardResetConfirm)).toBeTruthy();
          fireEvent.press(within(modal).getByRole("button", { name: s.cardResetProgress }));
          await waitFor(() => expectExactlyTwoDisabledDialogButtons(getVisibleModalByText(view, s.cardResetTitle)));
          const busyModal = getVisibleModalByText(view, s.cardResetTitle);
          fireEvent(busyModal, "requestClose");
          expect(within(getVisibleModalByText(view, s.cardResetTitle)).getByText(s.cardResetConfirm)).toBeTruthy();

          deferred.reject(failure);
          await act(async () => {
            await deferred.promise.catch(() => undefined);
          });

          const failedModal = getVisibleModalByText(view, s.cardResetTitle);
          expect(within(failedModal).getByText(s.cardActionFailed)).toBeTruthy();
          expectExactlyTwoEnabledDialogButtons(failedModal);
          expect(view.getByText(firstCue)).toBeTruthy();
          expect(view.queryByText(secondCue)).toBeNull();
          if (phase === "front") {
            expect(view.getByText(s.flashcardsReveal)).toBeTruthy();
          } else {
            expect(view.getAllByText(s.smartDeckTargetAyah).length).toBeGreaterThan(0);
            expect(view.getByText(`${s.smartDeckComparisonCue}: ${firstCue}`)).toBeTruthy();
            expect(view.queryByText(s.flashcardsReveal)).toBeNull();
          }
          expect(view.getByRole("button", { name: s.cardActionsTitle }).props.accessibilityState.disabled).toBe(false);
          expect(resetStudyCardProgress).toHaveBeenCalledTimes(1);
          expect(resetStudyCardProgress).toHaveBeenNthCalledWith(1, mockDatabase, firstCard.deck_id, firstCard.id);
          expect(deleteStudyCard).not.toHaveBeenCalled();
          expect(hapticMedium).toHaveBeenCalledTimes(1);

          fireEvent.press(within(failedModal).getByRole("button", { name: s.cardResetProgress }));
          await waitFor(() =>
            expect(view.UNSAFE_getAllByType(NativeModal).filter((node) => node.props.visible)).toHaveLength(0),
          );
          await waitFor(() => expect(view.getByText(s.flashcardsReveal)).toBeTruthy());
          expect(view.getByText(firstCue)).toBeTruthy();
          expect(view.queryByText(secondCue)).toBeNull();
          expect(resetStudyCardProgress).toHaveBeenCalledTimes(2);
          expect(resetStudyCardProgress).toHaveBeenNthCalledWith(2, mockDatabase, firstCard.deck_id, firstCard.id);
          expect(deleteStudyCard).not.toHaveBeenCalled();
          expect(hapticMedium).toHaveBeenCalledTimes(2);
          expect(view.getByRole("button", { name: s.cardActionsTitle }).props.accessibilityState.disabled).toBe(false);
          expectNoUnrelatedCardActionCalls();
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
    },
  );

  it("clears a failed Delete confirmation error when the front dialog is canceled and reopened", async () => {
    const s = strings.ar;
    const view = renderSession();
    const failure = new Error("delete card action failed");
    const deferred = createDeferred<void>();
    jest.mocked(deleteStudyCard).mockReturnValueOnce(deferred.promise);
    const expectedWarning: [string, Error] = ["[FlashcardSession] Card action failed:", failure];
    const originalWarn = console.warn;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation((...args) => {
      const isExpectedWarning =
        args.length === expectedWarning.length && args.every((arg, index) => arg === expectedWarning[index]);
      if (isExpectedWarning) return;
      originalWarn(...args);
    });

    try {
      try {
        const modal = await openConfirmCardAction(view, s, "front", "delete");
        fireEvent.press(within(modal).getByRole("button", { name: s.flashcardsDelete }));
        await waitFor(() => expectExactlyTwoDisabledDialogButtons(getVisibleModalByText(view, s.cardDeleteTitle)));
        deferred.reject(failure);
        await act(async () => {
          await deferred.promise.catch(() => undefined);
        });
        const failedModal = getVisibleModalByText(view, s.cardDeleteTitle);
        expect(within(failedModal).getByText(s.cardActionFailed)).toBeTruthy();
        expectExactlyTwoEnabledDialogButtons(failedModal);
        fireEvent.press(within(failedModal).getByRole("button", { name: s.flashcardsCancel }));
        await waitFor(() => expect(findVisibleModalByText(view, s.cardDeleteTitle)).toBeNull());

        const reopenedModal = await openConfirmCardAction(view, s, "front", "delete");
        expect(within(reopenedModal).queryByText(s.cardActionFailed)).toBeNull();
        expect(deleteStudyCard).toHaveBeenCalledTimes(1);
        expect(resetStudyCardProgress).not.toHaveBeenCalled();
        fireEvent.press(within(reopenedModal).getByRole("button", { name: s.flashcardsCancel }));
        await waitFor(() => expect(findVisibleModalByText(view, s.cardDeleteTitle)).toBeNull());
        expectNoUnrelatedCardActionCalls();
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

  it("clears a failed Reset confirmation error when the front dialog is canceled and reopened", async () => {
    const s = strings.ar;
    const view = renderSession();
    const failure = new Error("reset card action failed");
    const deferred = createDeferred<StudyCardRow>();
    jest.mocked(resetStudyCardProgress).mockReturnValueOnce(deferred.promise);
    const expectedWarning: [string, Error] = ["[FlashcardSession] Card action failed:", failure];
    const originalWarn = console.warn;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation((...args) => {
      const isExpectedWarning =
        args.length === expectedWarning.length && args.every((arg, index) => arg === expectedWarning[index]);
      if (isExpectedWarning) return;
      originalWarn(...args);
    });

    try {
      try {
        const modal = await openConfirmCardAction(view, s, "front", "reset");
        fireEvent.press(within(modal).getByRole("button", { name: s.cardResetProgress }));
        await waitFor(() => expectExactlyTwoDisabledDialogButtons(getVisibleModalByText(view, s.cardResetTitle)));
        deferred.reject(failure);
        await act(async () => {
          await deferred.promise.catch(() => undefined);
        });
        const failedModal = getVisibleModalByText(view, s.cardResetTitle);
        expect(within(failedModal).getByText(s.cardActionFailed)).toBeTruthy();
        expectExactlyTwoEnabledDialogButtons(failedModal);
        fireEvent.press(within(failedModal).getByRole("button", { name: s.flashcardsCancel }));
        await waitFor(() => expect(findVisibleModalByText(view, s.cardResetTitle)).toBeNull());

        const reopenedModal = await openConfirmCardAction(view, s, "front", "reset");
        expect(within(reopenedModal).queryByText(s.cardActionFailed)).toBeNull();
        expect(resetStudyCardProgress).toHaveBeenCalledTimes(1);
        expect(deleteStudyCard).not.toHaveBeenCalled();
        fireEvent.press(within(reopenedModal).getByRole("button", { name: s.flashcardsCancel }));
        await waitFor(() => expect(findVisibleModalByText(view, s.cardResetTitle)).toBeNull());
        expectNoUnrelatedCardActionCalls();
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

  it.each([
    ["Arabic light front write", "ar", false, "front", "write"],
    ["English dark revealed write", "en", true, "revealed", "write"],
    ["Arabic light front delete", "ar", false, "front", "delete"],
    ["English dark revealed delete", "en", true, "revealed", "delete"],
  ] as const)("shows and retries a rejected answer for %s", async (_label, language, isDark, phase, operation) => {
    configureSettings(language, isDark);
    const s = language === "ar" ? strings.ar : strings.en;
    const view = renderSession();
    const answerKey = `card_answer_${firstCard.id}:smartRefs`;
    const seededAnswer = "Seeded custom answer";
    const paddedAnswer = operation === "write" ? "  Retried custom answer  " : "   ";
    const trimmedAnswer = paddedAnswer.trim();
    let input = await openAnswerEditor(view, s, phase);
    expect(input.props.value).toBe(firstRef.textUthmani);

    if (operation === "delete") {
      jest.mocked(writeUserSetting).mockResolvedValueOnce(undefined);
      fireEvent.changeText(input, ` ${seededAnswer} `);
      fireEvent.press(within(getVisibleModal(input)).getByRole("button", { name: s.cardSaveAnswer }));
      await waitFor(() => expect(writeUserSetting).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(findVisibleModalByText(view, s.cardEditAnswerTitle)).toBeNull());
      expect(writeUserSetting).toHaveBeenCalledTimes(1);
      expect(writeUserSetting).toHaveBeenNthCalledWith(1, mockDatabase, answerKey, seededAnswer);
      if (phase === "revealed") expect(view.getByText(seededAnswer)).toBeTruthy();

      input = await openAnswerEditor(view, s, phase, false, seededAnswer);
      expect(input.props.value).toBe(seededAnswer);
    }

    const failure = new Error(`${operation} answer action failed`);
    const deferred = createDeferred<void>();
    if (operation === "write") {
      jest.mocked(writeUserSetting).mockReturnValueOnce(deferred.promise).mockResolvedValueOnce(undefined);
    } else {
      jest.mocked(deleteUserSetting).mockReturnValueOnce(deferred.promise).mockResolvedValueOnce(undefined);
    }
    const expectedWarning: [string, Error] = ["[FlashcardSession] Card action failed:", failure];
    const originalWarn = console.warn;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation((...args) => {
      const isExpectedWarning =
        args.length === expectedWarning.length && args.every((arg, index) => arg === expectedWarning[index]);
      if (!isExpectedWarning) originalWarn(...args);
    });

    try {
      try {
        fireEvent.changeText(input, paddedAnswer);
        fireEvent.press(getTextButton(view, s.cardSaveAnswer));
        await waitFor(() => expect(getTextButton(view, s.cardSaveAnswer).props.accessibilityState.disabled).toBe(true));
        const busyModal = getVisibleModal(input);
        expect(within(busyModal).getByText(s.flashcardsCancel)).toBeTruthy();
        expect(within(busyModal).getByText(s.cardSaveAnswer)).toBeTruthy();
        expect(getTextButton(view, s.flashcardsCancel).props.accessibilityState.disabled).toBe(true);
        fireEvent(busyModal, "requestClose");
        expect(view.getByPlaceholderText(s.cardEditAnswerPlaceholder)).toBeTruthy();

        deferred.reject(failure);
        await act(async () => {
          await deferred.promise.catch(() => undefined);
        });

        const failedModal = getVisibleModal(input);
        const error = within(failedModal).getByRole("alert");
        expect(error).toHaveTextContent(s.cardActionFailed);
        expectWritingDirection(error, language === "ar" ? "rtl" : "ltr");
        expect(error.props.accessibilityLiveRegion).toBe("polite");
        expect(input.props.value).toBe(paddedAnswer);
        expectExactlyTwoEnabledDialogButtons(failedModal);
        expect(view.getByText(firstCue)).toBeTruthy();
        expect(view.queryByText(secondCue)).toBeNull();
        if (phase === "front") {
          expect(view.getByText(s.flashcardsReveal)).toBeTruthy();
        } else if (operation === "delete") {
          expect(view.getByText(seededAnswer)).toBeTruthy();
          expect(view.queryByText(s.flashcardsReveal)).toBeNull();
        } else {
          expect(view.getByText(`${s.smartDeckComparisonCue}: ${firstCue}`)).toBeTruthy();
          expect(view.queryByText(s.flashcardsReveal)).toBeNull();
        }

        expect(hapticMedium).not.toHaveBeenCalled();
        expect(deleteStudyCard).not.toHaveBeenCalled();
        expect(resetStudyCardProgress).not.toHaveBeenCalled();
        expect(getDueCardsForReview).toHaveBeenCalledTimes(1);
        expectNoUnrelatedCardActionServiceCalls();
        if (operation === "write") {
          expect(writeUserSetting).toHaveBeenCalledTimes(1);
          expect(writeUserSetting).toHaveBeenNthCalledWith(1, mockDatabase, answerKey, trimmedAnswer);
          expect(deleteUserSetting).not.toHaveBeenCalled();
        } else {
          expect(writeUserSetting).toHaveBeenCalledTimes(1);
          expect(deleteUserSetting).toHaveBeenCalledTimes(1);
          expect(deleteUserSetting).toHaveBeenNthCalledWith(1, mockDatabase, answerKey);
        }

        fireEvent.press(within(getVisibleModal(input)).getByRole("button", { name: s.cardSaveAnswer }));
        await waitFor(() =>
          expect(operation === "write" ? writeUserSetting : deleteUserSetting).toHaveBeenCalledTimes(2),
        );
        await waitFor(() => expect(findVisibleModalByText(view, s.cardEditAnswerTitle)).toBeNull());
        if (operation === "write") {
          expect(writeUserSetting).toHaveBeenCalledTimes(2);
          expect(writeUserSetting).toHaveBeenNthCalledWith(2, mockDatabase, answerKey, trimmedAnswer);
          expect(deleteUserSetting).not.toHaveBeenCalled();
          if (phase === "revealed") expect(view.getByText(trimmedAnswer)).toBeTruthy();
        } else {
          expect(writeUserSetting).toHaveBeenCalledTimes(1);
          expect(deleteUserSetting).toHaveBeenCalledTimes(2);
          expect(deleteUserSetting).toHaveBeenNthCalledWith(2, mockDatabase, answerKey);
          expect(view.queryByText(seededAnswer)).toBeNull();
        }

        input = await openAnswerEditor(view, s, phase, false, operation === "write" ? trimmedAnswer : "default");
        expect(input.props.value).toBe(operation === "write" ? trimmedAnswer : firstRef.textUthmani);
        expect(within(getVisibleModal(input)).queryByText(s.cardActionFailed)).toBeNull();
        fireEvent.press(within(getVisibleModal(input)).getByRole("button", { name: s.flashcardsCancel }));
        await waitFor(() => expect(findVisibleModalByText(view, s.cardEditAnswerTitle)).toBeNull());
        expect(hapticMedium).not.toHaveBeenCalled();
        expect(deleteStudyCard).not.toHaveBeenCalled();
        expect(resetStudyCardProgress).not.toHaveBeenCalled();
        expect(getDueCardsForReview).toHaveBeenCalledTimes(1);
        expectNoUnrelatedCardActionServiceCalls();
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

  it("cancels and reopens a rejected front answer write without another persistence call", async () => {
    const s = strings.ar;
    const view = renderSession();
    let input = await openAnswerEditor(view, s, "front");
    const failure = new Error("front answer write failed");
    const deferred = createDeferred<void>();
    jest.mocked(writeUserSetting).mockReturnValueOnce(deferred.promise);
    const expectedWarning: [string, Error] = ["[FlashcardSession] Card action failed:", failure];
    const originalWarn = console.warn;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation((...args) => {
      const isExpectedWarning =
        args.length === expectedWarning.length && args.every((arg, index) => arg === expectedWarning[index]);
      if (!isExpectedWarning) originalWarn(...args);
    });

    try {
      try {
        fireEvent.changeText(input, "  Canceled answer  ");
        fireEvent.press(getTextButton(view, s.cardSaveAnswer));
        await waitFor(() => expect(getTextButton(view, s.cardSaveAnswer).props.accessibilityState.disabled).toBe(true));
        deferred.reject(failure);
        await act(async () => {
          await deferred.promise.catch(() => undefined);
        });
        const failedModal = getVisibleModal(input);
        expect(within(failedModal).getByRole("alert")).toHaveTextContent(s.cardActionFailed);
        expect(input.props.value).toBe("  Canceled answer  ");
        expectExactlyTwoEnabledDialogButtons(failedModal);
        fireEvent.press(within(failedModal).getByRole("button", { name: s.flashcardsCancel }));
        await waitFor(() => expect(writeUserSetting).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(findVisibleModalByText(view, s.cardEditAnswerTitle)).toBeNull());
        expect(view.getByText(s.flashcardsReveal)).toBeTruthy();

        input = await openAnswerEditor(view, s, "front");
        expect(input.props.value).toBe(firstRef.textUthmani);
        expect(within(getVisibleModal(input)).queryByText(s.cardActionFailed)).toBeNull();
        expect(writeUserSetting).toHaveBeenCalledTimes(1);
        expect(writeUserSetting).toHaveBeenNthCalledWith(
          1,
          mockDatabase,
          `card_answer_${firstCard.id}:smartRefs`,
          "Canceled answer",
        );
        expect(deleteUserSetting).not.toHaveBeenCalled();
        expect(hapticMedium).not.toHaveBeenCalled();
        expect(deleteStudyCard).not.toHaveBeenCalled();
        expect(resetStudyCardProgress).not.toHaveBeenCalled();
        expectNoUnrelatedCardActionServiceCalls();
        fireEvent.press(within(getVisibleModal(input)).getByRole("button", { name: s.flashcardsCancel }));
        await waitFor(() => expect(findVisibleModalByText(view, s.cardEditAnswerTitle)).toBeNull());
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

  it("cancels and reopens a rejected front answer delete without another persistence call", async () => {
    const s = strings.en;
    configureSettings("en", true);
    const view = renderSession();
    let input = await openAnswerEditor(view, s, "front");
    const answerKey = `card_answer_${firstCard.id}:smartRefs`;
    const seededAnswer = "Seeded front answer";
    jest.mocked(writeUserSetting).mockResolvedValueOnce(undefined);
    fireEvent.changeText(input, ` ${seededAnswer} `);
    fireEvent.press(within(getVisibleModal(input)).getByRole("button", { name: s.cardSaveAnswer }));
    await waitFor(() => expect(writeUserSetting).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(findVisibleModalByText(view, s.cardEditAnswerTitle)).toBeNull());
    expect(writeUserSetting).toHaveBeenCalledTimes(1);
    expect(writeUserSetting).toHaveBeenNthCalledWith(1, mockDatabase, answerKey, seededAnswer);

    input = await openAnswerEditor(view, s, "front", false, seededAnswer);
    expect(input.props.value).toBe(seededAnswer);
    const failure = new Error("front answer delete failed");
    const deferred = createDeferred<void>();
    jest.mocked(deleteUserSetting).mockReturnValueOnce(deferred.promise);
    const expectedWarning: [string, Error] = ["[FlashcardSession] Card action failed:", failure];
    const originalWarn = console.warn;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation((...args) => {
      const isExpectedWarning =
        args.length === expectedWarning.length && args.every((arg, index) => arg === expectedWarning[index]);
      if (!isExpectedWarning) originalWarn(...args);
    });

    try {
      try {
        fireEvent.changeText(input, "   ");
        fireEvent.press(getTextButton(view, s.cardSaveAnswer));
        await waitFor(() => expect(getTextButton(view, s.cardSaveAnswer).props.accessibilityState.disabled).toBe(true));
        deferred.reject(failure);
        await act(async () => {
          await deferred.promise.catch(() => undefined);
        });
        const failedModal = getVisibleModal(input);
        expect(within(failedModal).getByRole("alert")).toHaveTextContent(s.cardActionFailed);
        expect(input.props.value).toBe("   ");
        expectExactlyTwoEnabledDialogButtons(failedModal);
        fireEvent.press(within(failedModal).getByRole("button", { name: s.flashcardsCancel }));
        await waitFor(() => expect(findVisibleModalByText(view, s.cardEditAnswerTitle)).toBeNull());
        expect(view.getByText(s.flashcardsReveal)).toBeTruthy();

        input = await openAnswerEditor(view, s, "front");
        expect(input.props.value).toBe(seededAnswer);
        expect(within(getVisibleModal(input)).queryByText(s.cardActionFailed)).toBeNull();
        expect(writeUserSetting).toHaveBeenCalledTimes(1);
        expect(deleteUserSetting).toHaveBeenCalledTimes(1);
        expect(deleteUserSetting).toHaveBeenNthCalledWith(1, mockDatabase, answerKey);
        expect(hapticMedium).not.toHaveBeenCalled();
        expect(deleteStudyCard).not.toHaveBeenCalled();
        expect(resetStudyCardProgress).not.toHaveBeenCalled();
        expectNoUnrelatedCardActionServiceCalls();
        fireEvent.press(within(getVisibleModal(input)).getByRole("button", { name: s.flashcardsCancel }));
        await waitFor(() => expect(findVisibleModalByText(view, s.cardEditAnswerTitle)).toBeNull());
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

  it.each(directCardActionCases)(
    "rejects and retries direct card actions through the real route for %s",
    async (_label, language, isDark, phase, action) => {
      configureSettings(language, isDark);
      const s = language === "ar" ? strings.ar : strings.en;
      const view = renderSession();
      const failure = new Error(`${action} card action failed`);
      const deferred = createDeferred<StudyCardRow>();
      const retryResult = action === "mark" ? { ...firstCard, marked_at: new Date().toISOString() } : firstCard;
      configureRejectedDirectAction(action, deferred, retryResult);
      const expectedWarning: [string, Error] = ["[FlashcardSession] Card action failed:", failure];
      const originalWarn = console.warn;
      const warnSpy = jest.spyOn(console, "warn").mockImplementation((...args) => {
        const isExpectedWarning =
          args.length === expectedWarning.length && args.every((arg, index) => arg === expectedWarning[index]);
        if (!isExpectedWarning) originalWarn(...args);
      });

      try {
        try {
          await openDirectCardAction(view, s, phase, action);
          await waitFor(() =>
            expect(view.getByRole("button", { name: s.cardActionsTitle }).props.accessibilityState.disabled).toBe(true),
          );
          fireEvent.press(view.getByRole("button", { name: s.cardActionsTitle }));
          expect(setStudyCardSuspended).toHaveBeenCalledTimes(action === "suspend" ? 1 : 0);
          expect(setStudyCardBuried).toHaveBeenCalledTimes(action === "bury" ? 1 : 0);
          expect(setStudyCardMarked).toHaveBeenCalledTimes(action === "mark" ? 1 : 0);
          deferred.reject(failure);
          await act(async () => {
            await deferred.promise.catch(() => undefined);
          });

          expect(view.queryByText(s.cardActionsTitle)).toBeNull();
          expect(view.getByText(s.cardActionFailed)).toBeTruthy();
          expect(view.getByText(firstCue)).toBeTruthy();
          expect(view.queryByText(secondCue)).toBeNull();
          if (phase === "front") {
            expect(view.getByText(s.flashcardsReveal)).toBeTruthy();
          } else {
            expect(view.getAllByText(s.smartDeckTargetAyah).length).toBeGreaterThan(0);
            expect(view.getByText(`${s.smartDeckComparisonCue}: ${firstCue}`)).toBeTruthy();
            expect(view.queryByText(s.flashcardsReveal)).toBeNull();
          }
          expect(view.getByRole("button", { name: s.cardActionsTitle }).props.accessibilityState.disabled).toBe(false);
          expect(hapticMedium).toHaveBeenCalledTimes(1);
          expect(getDueCardsForReview).toHaveBeenCalledTimes(1);

          fireEvent.press(view.getByRole("button", { name: s.cardActionsTitle }));
          await waitFor(() => expect(view.getByText(s.cardActionsTitle)).toBeTruthy());
          fireEvent.press(view.getByRole("button", { name: directCardActionLabel(s, action) }));
          await waitFor(() => expect(view.queryByText(s.cardActionsTitle)).toBeNull());
          await waitFor(() =>
            expect(view.getByRole("button", { name: s.cardActionsTitle }).props.accessibilityState.disabled).toBe(
              false,
            ),
          );
          expectDirectCardActionCalls(action);
          expect(hapticMedium).toHaveBeenCalledTimes(2);
          expect(setStudyCardDueDate).not.toHaveBeenCalled();
          expect(deleteStudyCard).not.toHaveBeenCalled();
          expect(resetStudyCardProgress).not.toHaveBeenCalled();
          expect(writeUserSetting).not.toHaveBeenCalled();
          expect(deleteUserSetting).not.toHaveBeenCalled();
          expect(computeReviewPoints).not.toHaveBeenCalled();
          expect(putStudyLogRow).not.toHaveBeenCalled();
          expect(putCardRow).not.toHaveBeenCalled();
          expect(addTodayPoints).not.toHaveBeenCalled();
          expect(recordAchievementEvent).not.toHaveBeenCalled();
          expect(syncDailyScore).not.toHaveBeenCalled();
          expect(updateProfileStats).not.toHaveBeenCalled();
          expect(mockRouterReplace).not.toHaveBeenCalled();
          expect(getNextEligibleReviewDate).not.toHaveBeenCalled();
          expect(getWirdStatus).not.toHaveBeenCalled();
          expect(view.queryByText(s.cardActionFailed)).toBeNull();

          if (action === "mark") {
            expect(view.getByText(firstCue)).toBeTruthy();
            expect(view.queryByText(secondCue)).toBeNull();
            fireEvent.press(view.getByRole("button", { name: s.cardActionsTitle }));
            await waitFor(() => expect(view.getByText(s.cardActionsTitle)).toBeTruthy());
            expect(view.getByRole("button", { name: s.cardUnmark })).toBeTruthy();
          } else {
            await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
            expect(view.queryByText(firstCue)).toBeNull();
          }
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
    },
  );

  describe("review-session persistence orchestration", () => {
    const s = strings.en;

    beforeEach(() => {
      configureSettings("en", false);
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2026, 10, 2, 12, 0, 0));
      jest.mocked(putCardRow).mockResolvedValue(undefined);
      jest.mocked(putStudyLogRow).mockResolvedValue(undefined);
      jest.mocked(addTodayPoints).mockResolvedValue(undefined);
      jest.mocked(recordAchievementEvent).mockResolvedValue(undefined);
      jest.mocked(syncDailyScore).mockResolvedValue(undefined);
      jest.mocked(updateProfileStats).mockResolvedValue(undefined);
      jest.mocked(getNextEligibleReviewDate).mockResolvedValue(null);
      jest.mocked(getWirdStatus).mockResolvedValue({
        currentDays: 3,
        maintainedToday: true,
        longestDays: 3,
        lastReviewDate: null,
        state: "maintained_today",
      });
    });

    afterEach(() => {
      cleanup();
      jest.useRealTimers();
    });

    async function reveal(view: ReturnType<typeof render>, cue = firstCue) {
      await waitFor(() => expect(view.getByText(cue)).toBeTruthy());
      fireEvent.press(getTextButton(view, s.flashcardsReveal));
      await waitFor(() => expect(view.getByText(s.flashcardsEasy)).toBeTruthy());
    }

    it("awaits card then log persistence, rejects duplicate grades, and scores the original card", async () => {
      const card = { ...firstCard, state: State.Review, reps: 5, stability: 12, difficulty: 6 };
      jest.mocked(getDueCardsForReview).mockResolvedValue([card, secondCard]);
      jest.mocked(getStudyStreak).mockResolvedValue(7);
      jest.mocked(computeReviewPoints).mockReturnValue(9);
      const cardWrite = createDeferred<void>();
      const logWrite = createDeferred<void>();
      jest.mocked(putCardRow).mockReturnValueOnce(cardWrite.promise);
      jest.mocked(putStudyLogRow).mockReturnValueOnce(logWrite.promise);
      const view = renderSession();
      await reveal(view);
      const gradeButton = getTextButton(view, s.flashcardsEasy);
      act(() => {
        fireEvent.press(gradeButton);
        fireEvent.press(gradeButton);
      });
      expect(putCardRow).toHaveBeenCalledTimes(1);
      expect(putStudyLogRow).not.toHaveBeenCalled();
      expect(computeReviewPoints).not.toHaveBeenCalled();
      expect(view.queryByText(secondCue)).toBeNull();
      await act(async () => cardWrite.resolve());
      expect(putStudyLogRow).toHaveBeenCalledTimes(1);
      expect(computeReviewPoints).not.toHaveBeenCalled();
      expect(view.queryByText(secondCue)).toBeNull();
      const reviewedAt = jest.mocked(putStudyLogRow).mock.calls[0][1].reviewedAt;
      const transition = calculateReviewTransition({
        card,
        rating: Rating.Easy,
        reviewedAt: new Date(reviewedAt),
        reviewPolicy: reviewSettings,
      });
      expect(putCardRow).toHaveBeenCalledWith(mockDatabase, transition.updatedCard);
      const record = transition.reviewRecord;
      expect(putStudyLogRow).toHaveBeenCalledWith(mockDatabase, {
        cardId: card.id,
        rating: Rating.Easy,
        state: record.state,
        due: record.due,
        stability: record.stability,
        difficulty: record.difficulty,
        elapsedDays: record.elapsedDays,
        scheduledDays: record.scheduledDays,
        reviewedAt: record.reviewedAt,
      });
      await act(async () => logWrite.resolve());
      await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
      expect(computeReviewPoints).toHaveBeenCalledWith(Rating.Easy, 7, 6, 12);
      expect(addTodayPoints).toHaveBeenCalledWith(mockDatabase, 9);
      expect(recordAchievementEvent).toHaveBeenCalledWith(mockDatabase, {
        type: "mutashabih_pair_reviewed",
        pairId: card.id,
        reviewedAt,
      });
      expect(syncDailyScore).not.toHaveBeenCalled();
      expect(updateProfileStats).not.toHaveBeenCalled();
      expect(putCardRow).toHaveBeenCalledTimes(1);
    });

    it("requeues a same-day card with its updated row then finishes and syncs once", async () => {
      jest.mocked(getDueCardsForReview).mockResolvedValue([firstCard]);
      const view = renderSession();
      await reveal(view);
      fireEvent.press(getTextButton(view, s.flashcardsAgain));
      await waitFor(() => expect(view.getByText(s.flashcardsReveal)).toBeTruthy());
      expect(view.getByText(firstCue)).toBeTruthy();
      expect(view.queryByText(s.flashcardsSummaryTitle)).toBeNull();
      expect(syncDailyScore).not.toHaveBeenCalled();
      const updated = jest.mocked(putCardRow).mock.calls[0][1];
      expect(updated.reps).toBe(firstCard.reps + 1);
      expect(updated.state).toBe(State.Learning);
      await reveal(view);
      fireEvent.press(getTextButton(view, s.flashcardsEasy));
      await waitFor(() => expect(view.getByText(s.flashcardsSummaryTitle)).toBeTruthy());
      const row = view.UNSAFE_getAllByType(Card).find((card) => within(card).queryByText(s.flashcardsSummaryReviewed));
      if (!row) throw new Error("Missing summary row");
      expect(within(row).getByText("2")).toBeTruthy();
      expect(jest.mocked(putCardRow).mock.calls[1][1].reps).toBe(updated.reps + 1);
      expect(jest.mocked(putStudyLogRow).mock.calls[1][1].state).toBe(State.Learning);
      expect(computeReviewPoints).toHaveBeenCalledTimes(2);
      expect(addTodayPoints).not.toHaveBeenCalled();
      expect(syncDailyScore).toHaveBeenCalledTimes(1);
      expect(updateProfileStats).toHaveBeenCalledTimes(1);
      fireEvent.press(getTextButton(view, s.flashcardsSummaryDone));
      expect(mockRouterReplace).toHaveBeenCalledWith("/(tabs)/home");
    });

    it.each(["card", "log"] as const)(
      "keeps the current card and allows retry after a rejected %s write",
      async (stage) => {
        const failure = new Error("synthetic " + stage + " failure");
        const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        if (stage === "card") jest.mocked(putCardRow).mockRejectedValueOnce(failure);
        else jest.mocked(putStudyLogRow).mockRejectedValueOnce(failure);
        const view = renderSession();
        await reveal(view);
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(view.getByText(s.flashcardsReviewSaveFailed)).toBeTruthy());
        expect(view.queryByText(secondCue)).toBeNull();
        expect(computeReviewPoints).not.toHaveBeenCalled();
        expect(recordAchievementEvent).not.toHaveBeenCalled();
        expect(putStudyLogRow).toHaveBeenCalledTimes(stage === "card" ? 0 : 1);
        expect(warning).toHaveBeenCalledWith("[FlashcardSession] Failed to grade card:", failure);
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
        expect(view.queryByText(s.flashcardsReviewSaveFailed)).toBeNull();
        expect(putCardRow).toHaveBeenCalledTimes(2);
        expect(computeReviewPoints).toHaveBeenCalledTimes(1);
      },
    );

    it("reports optional score and achievement failures while advancing after durable writes", async () => {
      const failure = new Error("synthetic optional failure");
      const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      jest.mocked(computeReviewPoints).mockReturnValue(4);
      jest.mocked(addTodayPoints).mockRejectedValueOnce(failure);
      jest.mocked(recordAchievementEvent).mockRejectedValueOnce(failure);
      const view = renderSession();
      await reveal(view);
      fireEvent.press(getTextButton(view, s.flashcardsEasy));
      await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
      expect(putStudyLogRow).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledWith(failure);
      expect(view.queryByText(s.flashcardsReviewSaveFailed)).toBeNull();
    });

    it("cancels pending settings on unmount before starting queue loading", async () => {
      const settings = createDeferred<DeckReviewSettings>();
      jest.mocked(readDeckReviewSettings).mockReturnValueOnce(settings.promise);
      const view = renderSession();
      expect(readDeckReviewSettings).toHaveBeenCalledTimes(1);
      view.unmount();
      await act(async () => settings.resolve(reviewSettings));
      expect(getStudyStreak).not.toHaveBeenCalled();
      expect(getDueCardsForReview).not.toHaveBeenCalled();
    });

    it("cancels pending queue loading before fetching card content after unmount", async () => {
      const queue = createDeferred<StudyCardRow[]>();
      jest.mocked(getDueCardsForReview).mockReturnValueOnce(queue.promise);
      const view = renderSession();
      await waitFor(() => expect(getDueCardsForReview).toHaveBeenCalledTimes(1));
      view.unmount();
      await act(async () => queue.resolve([firstCard]));
      expect(getSmartCardContent).not.toHaveBeenCalled();
      expect(putCardRow).not.toHaveBeenCalled();
      expect(mockRouterReplace).not.toHaveBeenCalled();
    });

    it("shows a failed queue load as an empty summary with an error and no review side effects", async () => {
      const failure = new Error("synthetic queue failure");
      const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      jest.mocked(getDueCardsForReview).mockRejectedValueOnce(failure);
      const view = renderSession();
      await waitFor(() => expect(view.getByText(s.genericActionFailed)).toBeTruthy());
      expect(view.getByText(s.flashcardsSummaryTitle)).toBeTruthy();
      expect(warning).toHaveBeenCalledWith("[FlashcardSession] Failed to load session:", failure);
      expect(putCardRow).not.toHaveBeenCalled();
      expect(putStudyLogRow).not.toHaveBeenCalled();
      expect(syncDailyScore).not.toHaveBeenCalled();
    });
  });
});
