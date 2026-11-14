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
import { endReviewSession, recordSessionProgress, startReviewSession } from "@/lib/fsrs/review-sessions";
import { loadHabitOverview, makeUpTarget, recordWirdProgress } from "@/lib/habit/queries";
import { readDhuhrResolver } from "@/lib/prayer/settings";
import { recordCleanRecitation } from "@/lib/hifz/errors";
import { getSmartCardContent } from "@/lib/fsrs/smart-decks";
import {
  deleteStudyCard,
  setStudyCardBuried,
  getNextEligibleReviewDate,
  loadReviewQueue,
  putStudyLogRow,
  resetStudyCardProgress,
  setStudyCardDueDate,
  setStudyCardMarked,
  setStudyCardSuspended,
  putCardRow,
} from "@/lib/fsrs/queries";
import { StudyCardDeletedError } from "@/lib/fsrs/card-errors";
import { hapticMedium } from "@/lib/haptics";
import { recordAchievementEvent } from "@/lib/achievements/queries";
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
// Review persistence runs its card and log writes inside one transaction on this database. A grade
// reads the card there first; with no row it grades the queued copy.
const mockDatabase = Object.freeze({
  identity: "session-due-date-database",
  getFirstAsync: jest.fn(async (): Promise<unknown> => null),
  withTransactionAsync: async (task: (transaction: unknown) => Promise<void>) => task(mockDatabase),
});
const mockRouterReplace = jest.fn();

type RemoveAction = { type: string };
type PreventRemove = { prevent: boolean; callback: (options: { data: { action: RemoveAction } }) => void };
/** What the screen last passed to usePreventRemove. The prevent flag is what native-stack uses to block the iOS swipe. */
let mockPreventRemove: PreventRemove | null = null;
const mockNavigation = { getState: () => undefined, dispatch: jest.fn() };
/** A hardware back press, a back gesture, or the pop native-stack sends after it blocks the iOS swipe. */
const BACK: RemoveAction = { type: "GO_BACK" };
/** The navigation returnToTabs sends when the screen leaves on purpose. */
const EXIT: RemoveAction = { type: "REPLACE" };

/**
 * Remove the screen as React Navigation does: when the latest render prevents removal, the action is
 * stopped and handed to the callback, which may continue it with navigation.dispatch. Returns whether
 * the screen stayed.
 */
function remove(action: RemoveAction): boolean {
  const guard = mockPreventRemove;
  if (!guard?.prevent) return false;
  const before = mockNavigation.dispatch.mock.calls.length;
  guard.callback({ data: { action } });
  return !mockNavigation.dispatch.mock.calls.slice(before).some(([dispatched]) => dispatched === action);
}
const back = () => remove(BACK);
const preventing = () => mockPreventRemove?.prevent ?? false;

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
  quranRenderFontStyle: "qcf2",
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
  router: { replace: (...args: unknown[]) => mockRouterReplace(...args), dismissTo: jest.fn() },
  useNavigation: () => mockNavigation,
  useLocalSearchParams: () => ({ deckId: "fixture-session-deck" }),
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual<typeof import("@react-navigation/native")>("@react-navigation/native"),
  usePreventRemove: (prevent: boolean, callback: PreventRemove["callback"]) => {
    mockPreventRemove = { prevent, callback };
  },
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
  publishReviewLogged: jest.fn(),
  putStudyLogRow: jest.fn(),
  loadReviewQueue: jest.fn(),
  resetStudyCardProgress: jest.fn(),
  setStudyCardBuried: jest.fn(),
  setStudyCardDueDate: jest.fn(),
  setStudyCardMarked: jest.fn(),
  setStudyCardSuspended: jest.fn(),
  putCardRow: jest.fn(),
  MUTASHABIHAT_DECK_ID: "mutashabihat",
}));

jest.mock("@/lib/fsrs/smart-decks", () => ({
  getSmartCardContent: jest.fn(),
}));

// The wird day is written inside the grade transaction; its rules are covered by habit-wird-progress.
jest.mock("@/lib/habit/queries", () => ({
  recordWirdProgress: jest.fn(),
  loadHabitOverview: jest.fn(),
  makeUpTarget: jest.fn(),
}));
// The make-up cutoff reads prayer times inside the grade; covered by habit-wird-progress.
jest.mock("@/lib/prayer/settings", () => ({
  readDhuhrResolver: jest.fn(async () => () => null),
}));
// Inbox resolution is covered by habit-wird-progress against a real schema.
jest.mock("@/lib/hifz/errors", () => ({
  insertRecitationErrors: jest.fn(),
  recordCleanRecitation: jest.fn(),
}));

const fixtureSession = {
  id: "fixture-session",
  kind: "cards",
  deckId: "fixture-session-deck",
  startedAt: "2026-11-02T10:00:00.000Z",
  source: "app",
} as const;

jest.mock("@/lib/fsrs/review-sessions", () => ({
  startReviewSession: jest.fn(),
  recordSessionProgress: jest.fn(),
  endReviewSession: jest.fn(),
}));

jest.mock("@/lib/haptics", () => ({
  hapticMedium: jest.fn(),
  hapticSuccess: jest.fn(),
}));

jest.mock("@/lib/achievements/queries", () => ({
  recordAchievementEvent: jest.fn(),
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
const DIALOG_CLOSE_TIMEOUT_MS = 5000;
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

function reviewQueue(cards: StudyCardRow[], settings: DeckReviewSettings = reviewSettings) {
  return cards.map((card) => ({ card, settings }));
}

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
    expect(setStudyCardSuspended).toHaveBeenNthCalledWith(1, mockDatabase, firstCard.deck_id, firstCard.id, true, {
      requireLive: true,
    });
    expect(setStudyCardSuspended).toHaveBeenNthCalledWith(2, mockDatabase, firstCard.deck_id, firstCard.id, true, {
      requireLive: true,
    });
    expect(setStudyCardBuried).not.toHaveBeenCalled();
    expect(setStudyCardMarked).not.toHaveBeenCalled();
    return;
  }
  if (action === "bury") {
    expect(setStudyCardBuried).toHaveBeenCalledTimes(2);
    expect(setStudyCardBuried).toHaveBeenNthCalledWith(1, mockDatabase, firstCard.deck_id, firstCard.id, true, {
      requireLive: true,
    });
    expect(setStudyCardBuried).toHaveBeenNthCalledWith(2, mockDatabase, firstCard.deck_id, firstCard.id, true, {
      requireLive: true,
    });
    expect(setStudyCardSuspended).not.toHaveBeenCalled();
    expect(setStudyCardMarked).not.toHaveBeenCalled();
    return;
  }
  expect(setStudyCardMarked).toHaveBeenCalledTimes(2);
  expect(setStudyCardMarked).toHaveBeenNthCalledWith(1, mockDatabase, firstCard.deck_id, firstCard.id, true, {
    requireLive: true,
  });
  expect(setStudyCardMarked).toHaveBeenNthCalledWith(2, mockDatabase, firstCard.deck_id, firstCard.id, true, {
    requireLive: true,
  });
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
  expect(recordSessionProgress).not.toHaveBeenCalled();
  expect(putStudyLogRow).not.toHaveBeenCalled();
  expect(putCardRow).not.toHaveBeenCalled();
  expect(recordAchievementEvent).not.toHaveBeenCalled();
  expect(endReviewSession).not.toHaveBeenCalled();
  expect(mockRouterReplace).not.toHaveBeenCalled();
  expect(getNextEligibleReviewDate).not.toHaveBeenCalled();
  expect(loadHabitOverview).not.toHaveBeenCalled();
}

describe("Flashcard session due-date editor characterization", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockPreventRemove = null;
    mockDatabase.getFirstAsync.mockResolvedValue(null);
    jest.mocked(startReviewSession).mockReturnValue(fixtureSession);
    jest.mocked(recordSessionProgress).mockResolvedValue({} as never);
    jest.mocked(endReviewSession).mockResolvedValue(null);
    jest.mocked(loadHabitOverview).mockResolvedValue(null as never);
    jest.mocked(recordWirdProgress).mockResolvedValue({ kind: "none" });
    jest.mocked(makeUpTarget).mockResolvedValue(null);
    jest.mocked(readDhuhrResolver).mockResolvedValue(() => null);
    jest.mocked(recordCleanRecitation).mockResolvedValue(0);
    // Restore the React Native preset clock cleared by the fixture mock reset.
    jest.mocked(performance.now).mockImplementation(Date.now);
    configureSettings("ar", false);
    ReactNative.Dimensions.set({
      window: { width: 390, height: 844, scale: 1, fontScale: 1 },
      screen: { width: 390, height: 844, scale: 1, fontScale: 1 },
    });
    jest.mocked(loadReviewQueue).mockResolvedValue(reviewQueue([firstCard, secondCard]));
    jest.mocked(getSmartCardContent).mockImplementation(async (_db, cardId) => smartContentById.get(cardId) ?? null);
    jest.mocked(setStudyCardDueDate).mockResolvedValue(firstCard);
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
      expect(setStudyCardDueDate).toHaveBeenCalledWith(mockDatabase, firstCard.deck_id, firstCard.id, parsed.date, {
        requireLive: true,
      });
      expect(mockRouterReplace).not.toHaveBeenCalled();
      expect(putStudyLogRow).not.toHaveBeenCalled();
      expect(putCardRow).not.toHaveBeenCalled();
      expect(recordAchievementEvent).not.toHaveBeenCalled();
      expect(endReviewSession).not.toHaveBeenCalled();
      expect(getNextEligibleReviewDate).not.toHaveBeenCalled();
      expect(loadHabitOverview).not.toHaveBeenCalled();
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
        expect(loadReviewQueue).toHaveBeenCalledTimes(1);
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
        expect(setStudyCardDueDate).toHaveBeenCalledWith(mockDatabase, firstCard.deck_id, firstCard.id, parsed.date, {
          requireLive: true,
        });
        expect(hapticMedium).toHaveBeenCalledTimes(1);
        expect(putStudyLogRow).not.toHaveBeenCalled();
        expect(putCardRow).not.toHaveBeenCalled();
        expect(recordAchievementEvent).not.toHaveBeenCalled();
        expect(endReviewSession).not.toHaveBeenCalled();
        expect(getNextEligibleReviewDate).not.toHaveBeenCalled();
        expect(loadHabitOverview).not.toHaveBeenCalled();

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
          await waitFor(
            () => expect(view.UNSAFE_getAllByType(NativeModal).filter((node) => node.props.visible)).toHaveLength(0),
            // The dialog stays mounted through its real-timer exit animation; allow for a loaded CI host.
            { timeout: DIALOG_CLOSE_TIMEOUT_MS },
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
          expect(setStudyCardDueDate).toHaveBeenCalledWith(mockDatabase, firstCard.deck_id, firstCard.id, parsed.date, {
            requireLive: true,
          });

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
          expect(loadReviewQueue).toHaveBeenCalledTimes(1);
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
          expect(loadReviewQueue).toHaveBeenCalledTimes(1);
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
          expect(resetStudyCardProgress).toHaveBeenNthCalledWith(1, mockDatabase, firstCard.deck_id, firstCard.id, {
            requireLive: true,
          });
          expect(deleteStudyCard).not.toHaveBeenCalled();
          expect(hapticMedium).toHaveBeenCalledTimes(1);

          fireEvent.press(within(failedModal).getByRole("button", { name: s.cardResetProgress }));
          await waitFor(
            () => expect(view.UNSAFE_getAllByType(NativeModal).filter((node) => node.props.visible)).toHaveLength(0),
            // The dialog stays mounted through its real-timer exit animation; allow for a loaded CI host.
            { timeout: DIALOG_CLOSE_TIMEOUT_MS },
          );
          await waitFor(() => expect(view.getByText(s.flashcardsReveal)).toBeTruthy());
          expect(view.getByText(firstCue)).toBeTruthy();
          expect(view.queryByText(secondCue)).toBeNull();
          expect(resetStudyCardProgress).toHaveBeenCalledTimes(2);
          expect(resetStudyCardProgress).toHaveBeenNthCalledWith(2, mockDatabase, firstCard.deck_id, firstCard.id, {
            requireLive: true,
          });
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
        expect(loadReviewQueue).toHaveBeenCalledTimes(1);
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
        expect(loadReviewQueue).toHaveBeenCalledTimes(1);
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
          expect(loadReviewQueue).toHaveBeenCalledTimes(1);

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
          expect(recordSessionProgress).not.toHaveBeenCalled();
          expect(putStudyLogRow).not.toHaveBeenCalled();
          expect(putCardRow).not.toHaveBeenCalled();
          expect(recordAchievementEvent).not.toHaveBeenCalled();
          expect(endReviewSession).not.toHaveBeenCalled();
          expect(mockRouterReplace).not.toHaveBeenCalled();
          expect(getNextEligibleReviewDate).not.toHaveBeenCalled();
          expect(loadHabitOverview).not.toHaveBeenCalled();
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
      jest.mocked(recordAchievementEvent).mockResolvedValue(undefined);
      jest.mocked(getNextEligibleReviewDate).mockResolvedValue(null);
      jest.mocked(loadHabitOverview).mockResolvedValue(null as never);
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

    it("previews and grades each card with its own deck's settings, as in Review all", async () => {
      const card = { ...firstCard, state: State.New, reps: 0, stability: 0, difficulty: 0, last_review: null };
      const deckSettings = { ...reviewSettings, enableFuzz: false, learningSteps: ["7m", "3h"] } satisfies DeckReviewSettings;
      jest.mocked(loadReviewQueue).mockResolvedValue([
        ...reviewQueue([card], deckSettings),
        ...reviewQueue([secondCard]),
      ]);
      const view = renderSession();
      await reveal(view);
      expect(view.getByText("1/2 · 7m")).toBeTruthy();
      fireEvent.press(getTextButton(view, s.flashcardsAgain));
      await waitFor(() => expect(putStudyLogRow).toHaveBeenCalledTimes(1));
      const reviewedAt = jest.mocked(putStudyLogRow).mock.calls[0][1].reviewedAt;
      const transition = calculateReviewTransition({
        card,
        rating: Rating.Again,
        reviewedAt: new Date(reviewedAt),
        reviewPolicy: deckSettings,
      });
      expect(putCardRow).toHaveBeenCalledWith(mockDatabase, transition.updatedCard);
      expect(new Date(transition.updatedCard.due).getTime() - new Date(reviewedAt).getTime()).toBe(7 * 60 * 1000);
    });

    it("awaits card then log persistence, rejects duplicate grades, and records session progress once", async () => {
      const card = { ...firstCard, state: State.Review, reps: 5, stability: 12, difficulty: 6 };
      jest.mocked(loadReviewQueue).mockResolvedValue(reviewQueue([card, secondCard]));
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
      // The card write follows the grade's read of the current card inside the transaction.
      await waitFor(() => expect(putCardRow).toHaveBeenCalledTimes(1));
      expect(mockDatabase.getFirstAsync).toHaveBeenCalledTimes(1);
      expect(putStudyLogRow).not.toHaveBeenCalled();
      expect(recordSessionProgress).not.toHaveBeenCalled();
      expect(view.queryByText(secondCue)).toBeNull();
      await act(async () => cardWrite.resolve());
      expect(putStudyLogRow).toHaveBeenCalledTimes(1);
      expect(recordSessionProgress).not.toHaveBeenCalled();
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
        sessionId: "fixture-session",
        durationMs: expect.any(Number),
        supportLevel: null,
        proposedRating: null,
        grader: "self",
        errorCount: 0,
        makeupFor: null,
      });
      await act(async () => logWrite.resolve());
      await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
      expect(recordSessionProgress).toHaveBeenCalledTimes(1);
      expect(recordAchievementEvent).toHaveBeenCalledWith(mockDatabase, {
        type: "mutashabih_pair_reviewed",
        pairId: card.id,
        reviewedAt,
      });
      expect(endReviewSession).not.toHaveBeenCalled();
      expect(putCardRow).toHaveBeenCalledTimes(1);
    });

    it("requeues a same-day card with its updated row then finishes and closes the session once", async () => {
      jest.mocked(loadReviewQueue).mockResolvedValue(reviewQueue([firstCard]));
      const view = renderSession();
      await reveal(view);
      fireEvent.press(getTextButton(view, s.flashcardsAgain));
      await waitFor(() => expect(view.getByText(s.flashcardsReveal)).toBeTruthy());
      expect(view.getByText(firstCue)).toBeTruthy();
      expect(view.queryByText(s.flashcardsSummaryTitle)).toBeNull();
      expect(endReviewSession).not.toHaveBeenCalled();
      const updated = jest.mocked(putCardRow).mock.calls[0][1];
      expect(updated.reps).toBe(firstCard.reps + 1);
      expect(updated.state).toBe(State.Learning);
      await reveal(view);
      fireEvent.press(getTextButton(view, s.flashcardsEasy));
      await waitFor(() => expect(view.getByText(s.flashcardsSummaryTitle)).toBeTruthy());
      const row = view.UNSAFE_getAllByType(Card).find((card) => within(card).queryByText(s.flashcardsSummaryReviewed));
      if (!row) throw new Error("Missing summary row");
      // One card graded twice is one card reviewed.
      expect(within(row).getByText("1")).toBeTruthy();
      expect(jest.mocked(putCardRow).mock.calls[1][1].reps).toBe(updated.reps + 1);
      expect(jest.mocked(putStudyLogRow).mock.calls[1][1].state).toBe(State.Learning);
      expect(recordSessionProgress).toHaveBeenCalledTimes(2);
      expect(endReviewSession).toHaveBeenCalledTimes(1);
      fireEvent.press(getTextButton(view, s.flashcardsSummaryDone));
      expect(mockRouterReplace).toHaveBeenCalledWith("/(tabs)/home");
    });

    it("grades the card as sync left it after the queue loaded, and requeues the row that was saved", async () => {
      jest.mocked(loadReviewQueue).mockResolvedValue(reviewQueue([firstCard]));
      // Another device's Good review reached this device after the queue was loaded.
      const synced = calculateReviewTransition({
        card: firstCard,
        rating: Rating.Good,
        reviewedAt: new Date(2026, 10, 2, 11, 0, 0),
        reviewPolicy: reviewSettings,
      }).updatedCard;
      mockDatabase.getFirstAsync.mockResolvedValueOnce(synced);
      const view = renderSession();
      await reveal(view);
      fireEvent.press(getTextButton(view, s.flashcardsAgain));
      await waitFor(() => expect(putStudyLogRow).toHaveBeenCalledTimes(1));
      const reviewedAt = jest.mocked(putStudyLogRow).mock.calls[0][1].reviewedAt;
      const saved = calculateReviewTransition({
        card: synced,
        rating: Rating.Again,
        reviewedAt: new Date(reviewedAt),
        reviewPolicy: reviewSettings,
      });
      expect(putCardRow).toHaveBeenCalledWith(mockDatabase, saved.updatedCard);
      expect(saved.updatedCard.reps).toBe(synced.reps + 1);
      // The requeued card is the saved row: graded again with no row to read, it continues from it.
      await waitFor(() => expect(view.getByText(s.flashcardsReveal)).toBeTruthy());
      await reveal(view);
      fireEvent.press(getTextButton(view, s.flashcardsEasy));
      await waitFor(() => expect(putCardRow).toHaveBeenCalledTimes(2));
      expect(jest.mocked(putCardRow).mock.calls[1][1].reps).toBe(saved.updatedCard.reps + 1);
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
        expect(recordSessionProgress).not.toHaveBeenCalled();
        expect(recordAchievementEvent).not.toHaveBeenCalled();
        expect(putStudyLogRow).toHaveBeenCalledTimes(stage === "card" ? 0 : 1);
        expect(warning).toHaveBeenCalledWith("[FlashcardSession] Failed to grade card:", failure);
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
        expect(view.queryByText(s.flashcardsReviewSaveFailed)).toBeNull();
        expect(putCardRow).toHaveBeenCalledTimes(2);
        expect(recordSessionProgress).toHaveBeenCalledTimes(1);
      },
    );

    it("skips a card deleted during the session when it is graded (RF-183)", async () => {
      jest.spyOn(console, "warn").mockImplementation(() => undefined);
      jest.mocked(putCardRow).mockRejectedValueOnce(new StudyCardDeletedError());
      const view = renderSession();
      await reveal(view);
      fireEvent.press(getTextButton(view, s.flashcardsEasy));

      await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
      expect(view.getByText(s.cardDeletedSkipped)).toBeTruthy();
      expect(view.queryByText(s.flashcardsReviewSaveFailed)).toBeNull();
      expect(recordSessionProgress).not.toHaveBeenCalled();
    });

    it("shows the deleted-card notice on the summary when the deleted card was the last one (RF-183)", async () => {
      jest.spyOn(console, "warn").mockImplementation(() => undefined);
      jest.mocked(loadReviewQueue).mockResolvedValue(reviewQueue([firstCard]));
      jest.mocked(putCardRow).mockRejectedValueOnce(new StudyCardDeletedError());
      const view = renderSession();
      await reveal(view);
      fireEvent.press(getTextButton(view, s.flashcardsEasy));

      await waitFor(() => expect(view.getByText(s.flashcardsSummaryTitle)).toBeTruthy());
      expect(view.getByText(s.cardDeletedSkipped)).toBeTruthy();
    });

    it("finishes instead of reshowing a graded card when the last card is suspended", async () => {
      jest.mocked(setStudyCardSuspended).mockResolvedValueOnce({ ...secondCard, suspended: 1 } as StudyCardRow);
      const view = renderSession();
      await reveal(view);
      // Easy graduates the new card, so it is not requeued behind the last card.
      fireEvent.press(getTextButton(view, s.flashcardsEasy));
      await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());

      fireEvent.press(view.getByRole("button", { name: s.cardActionsTitle }));
      await waitFor(() => expect(view.getByText(s.cardActionsTitle)).toBeTruthy());
      fireEvent.press(view.getByRole("button", { name: s.cardSuspend }));

      // Graded cards stay in the session list; removing the last card must not step back onto one.
      await waitFor(() => expect(view.getByText(s.flashcardsSummaryTitle)).toBeTruthy());
      expect(view.queryByText(firstCue)).toBeNull();
      expect(putCardRow).toHaveBeenCalledTimes(1);
    });

    it("skips a card deleted during the session when a card action finds it gone (RF-183)", async () => {
      jest.spyOn(console, "warn").mockImplementation(() => undefined);
      jest.mocked(setStudyCardMarked).mockRejectedValueOnce(new StudyCardDeletedError());
      const view = renderSession();
      await openDirectCardAction(view, s, "front", "mark");

      await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
      expect(view.getByText(s.cardDeletedSkipped)).toBeTruthy();
      expect(view.queryByText(s.cardActionFailed)).toBeNull();
      expect(setStudyCardMarked).toHaveBeenCalledWith(mockDatabase, firstCard.deck_id, firstCard.id, true, {
        requireLive: true,
      });
    });

    it("reports an optional achievement failure while advancing after durable writes", async () => {
      const failure = new Error("synthetic optional failure");
      const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      jest.mocked(recordAchievementEvent).mockRejectedValueOnce(failure);
      const view = renderSession();
      await reveal(view);
      fireEvent.press(getTextButton(view, s.flashcardsEasy));
      await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
      expect(putStudyLogRow).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledWith(failure);
      expect(view.queryByText(s.flashcardsReviewSaveFailed)).toBeNull();
    });

    it("leaves at once before any grade, and asks once after one (SES-02)", async () => {
      const view = renderSession();
      await reveal(view);
      fireEvent.press(view.getByLabelText(s.genericClose));
      expect(mockRouterReplace).toHaveBeenCalledWith("/(tabs)/home");
    });

    it("confirms leaving after a grade, keeps reviewing on Stay, and closes the session on Leave", async () => {
      const view = renderSession();
      await reveal(view);
      fireEvent.press(getTextButton(view, s.flashcardsEasy));
      await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
      fireEvent.press(view.getByLabelText(s.genericClose));
      await waitFor(() => expect(view.getByText(s.habitExitTitle)).toBeTruthy());
      fireEvent.press(getTextButton(view, s.habitExitStay));
      await waitFor(() => expect(view.queryByText(s.habitExitTitle)).toBeNull());
      expect(mockRouterReplace).not.toHaveBeenCalled();
      fireEvent.press(view.getByLabelText(s.genericClose));
      await waitFor(() => expect(view.getByText(s.habitExitLeave)).toBeTruthy());
      fireEvent.press(getTextButton(view, s.habitExitLeave));
      expect(endReviewSession).toHaveBeenCalledWith(mockDatabase, { session: fixtureSession });
      expect(mockRouterReplace).toHaveBeenCalledWith("/(tabs)/home");
    });

    describe("leaving while a grade is unresolved", () => {
      /** Each time the screen left on purpose, whether React Navigation let it go or held it. */
      let exits: ("left" | "held")[] = [];
      const failure = new Error("synthetic card failure");

      beforeEach(() => {
        exits = [];
        mockRouterReplace.mockImplementation(() => {
          exits.push(remove(EXIT) ? "held" : "left");
        });
      });

      function closeButton(view: ReturnType<typeof render>): RenderedNode {
        return view.getByRole("button", { name: s.genericClose });
      }

      /** Grade the first card with its card write held open, so the grade stays unresolved. */
      async function startFirstGrade(write: Deferred<void>) {
        jest.mocked(putCardRow).mockReturnValueOnce(write.promise);
        const view = renderSession();
        await reveal(view);
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(putCardRow).toHaveBeenCalledTimes(1));
        return view;
      }

      it("waits for an unresolved first grade before leaving on Close, then leaves once it is saved", async () => {
        const write = createDeferred<void>();
        const view = await startFirstGrade(write);
        // No grade is saved yet, so Close leaves without asking, but only after the grade settles.
        fireEvent.press(closeButton(view));
        expect(mockRouterReplace).not.toHaveBeenCalled();
        expect(view.queryByText(s.habitExitTitle)).toBeNull();
        // Close is dimmed while the leave waits for the grade.
        expect(closeButton(view).props.accessibilityState).toMatchObject({ disabled: true });
        expect(closeButton(view).props.className).toContain("opacity-50");
        await act(async () => write.resolve());
        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith("/(tabs)/home"));
        // The grade is saved in full before the screen leaves, and the screen's own leave is not held.
        expect(putStudyLogRow).toHaveBeenCalledTimes(1);
        expect(recordSessionProgress).toHaveBeenCalledTimes(1);
        expect(exits).toEqual(["left"]);
        expect(endReviewSession).toHaveBeenCalledWith(mockDatabase, { session: fixtureSession });
      });

      it("stays on the card to show a failed grade when Close was pressed while it was unresolved", async () => {
        const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const write = createDeferred<void>();
        const view = await startFirstGrade(write);
        fireEvent.press(closeButton(view));
        await act(async () => write.reject(failure));
        await waitFor(() => expect(view.getByText(s.flashcardsReviewSaveFailed)).toBeTruthy());
        expect(warning).toHaveBeenCalledWith("[FlashcardSession] Failed to grade card:", failure);
        expect(mockRouterReplace).not.toHaveBeenCalled();
        expect(endReviewSession).not.toHaveBeenCalled();
        expect(view.queryByText(secondCue)).toBeNull();
        expect(closeButton(view).props.accessibilityState).toMatchObject({ disabled: false });
        // The card is still open, and the cancelled Close does not carry over to the retry.
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
        expect(putCardRow).toHaveBeenCalledTimes(2);
        expect(mockRouterReplace).not.toHaveBeenCalled();
      });

      it("prevents removal, the native swipe included, while a grade is unresolved or saved grades would be left", async () => {
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const first = createDeferred<void>();
        const second = createDeferred<void>();
        jest.mocked(putCardRow).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const view = renderSession();
        await reveal(view);
        expect(preventing()).toBe(false);
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(putCardRow).toHaveBeenCalledTimes(1));
        expect(preventing()).toBe(true);
        await act(async () => first.reject(failure));
        await waitFor(() => expect(view.getByText(s.flashcardsReviewSaveFailed)).toBeTruthy());
        expect(preventing()).toBe(false);
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(putCardRow).toHaveBeenCalledTimes(2));
        expect(preventing()).toBe(true);
        await act(async () => second.resolve());
        await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
        // Leaving now would leave a saved grade behind, so removal stays prevented until the summary.
        expect(preventing()).toBe(true);
        await reveal(view, secondCue);
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(view.getByText(s.flashcardsSummaryTitle)).toBeTruthy());
        expect(preventing()).toBe(false);
      });

      it("holds a back press during an unresolved grade, then goes back once it is saved", async () => {
        const write = createDeferred<void>();
        const view = await startFirstGrade(write);
        let held = false;
        act(() => {
          held = back();
        });
        expect(held).toBe(true);
        expect(view.queryByText(s.habitExitTitle)).toBeNull();
        expect(closeButton(view).props.accessibilityState).toMatchObject({ disabled: true });
        await act(async () => write.resolve());
        // The held back press goes on to where it was going, not to the tabs.
        await waitFor(() => expect(mockNavigation.dispatch).toHaveBeenCalledWith(BACK));
        expect(mockRouterReplace).not.toHaveBeenCalled();
        expect(putStudyLogRow).toHaveBeenCalledTimes(1);
        expect(endReviewSession).toHaveBeenCalledWith(mockDatabase, { session: fixtureSession });
      });

      it("holds a back press during an unresolved grade, and stays to show a failure without carrying the leave over", async () => {
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const write = createDeferred<void>();
        const view = await startFirstGrade(write);
        let held = false;
        act(() => {
          held = back();
        });
        expect(held).toBe(true);
        await act(async () => write.reject(failure));
        await waitFor(() => expect(view.getByText(s.flashcardsReviewSaveFailed)).toBeTruthy());
        expect(mockNavigation.dispatch).not.toHaveBeenCalled();
        expect(closeButton(view).props.accessibilityState).toMatchObject({ disabled: false });
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
        expect(mockNavigation.dispatch).not.toHaveBeenCalled();
        expect(mockRouterReplace).not.toHaveBeenCalled();
      });

      it("asks before a back press leaves a saved grade, and goes back once confirmed", async () => {
        const view = renderSession();
        await reveal(view);
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
        let held = false;
        act(() => {
          held = back();
        });
        expect(held).toBe(true);
        await waitFor(() => expect(view.getByText(s.habitExitLeave)).toBeTruthy());
        fireEvent.press(getTextButton(view, s.habitExitLeave));
        expect(mockNavigation.dispatch).toHaveBeenCalledWith(BACK);
        expect(mockRouterReplace).not.toHaveBeenCalled();
        expect(endReviewSession).toHaveBeenCalledWith(mockDatabase, { session: fixtureSession });
      });

      it("drops a held back press on Stay, so a later Close returns to the tabs", async () => {
        const view = renderSession();
        await reveal(view);
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
        act(() => {
          back();
        });
        await waitFor(() => expect(view.getByText(s.habitExitStay)).toBeTruthy());
        fireEvent.press(getTextButton(view, s.habitExitStay));
        await waitFor(() => expect(view.queryByText(s.habitExitTitle)).toBeNull());
        expect(view.getByText(secondCue)).toBeTruthy();
        expect(endReviewSession).not.toHaveBeenCalled();
        fireEvent.press(closeButton(view));
        await waitFor(() => expect(view.getByText(s.habitExitLeave)).toBeTruthy());
        fireEvent.press(getTextButton(view, s.habitExitLeave));
        expect(mockRouterReplace).toHaveBeenCalledWith("/(tabs)/home");
        expect(mockNavigation.dispatch).not.toHaveBeenCalledWith(BACK);
        expect(exits).toEqual(["left"]);
      });

      it("asks on Close with a saved grade while a later grade is unresolved, then leaves once it is saved", async () => {
        const write = createDeferred<void>();
        jest.mocked(putCardRow).mockResolvedValueOnce(undefined).mockReturnValueOnce(write.promise);
        const view = renderSession();
        await reveal(view);
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
        await reveal(view, secondCue);
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(putCardRow).toHaveBeenCalledTimes(2));
        fireEvent.press(closeButton(view));
        await waitFor(() => expect(view.getByText(s.habitExitLeave)).toBeTruthy());
        fireEvent.press(getTextButton(view, s.habitExitLeave));
        expect(mockRouterReplace).not.toHaveBeenCalled();
        expect(closeButton(view).props.accessibilityState).toMatchObject({ disabled: true });
        await act(async () => write.resolve());
        await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith("/(tabs)/home"));
        expect(putStudyLogRow).toHaveBeenCalledTimes(2);
        expect(exits).toEqual(["left"]);
        expect(endReviewSession).toHaveBeenCalledWith(mockDatabase, { session: fixtureSession });
      });

      it("ends the session when the screen is removed without Close", async () => {
        const view = renderSession();
        await reveal(view);
        fireEvent.press(getTextButton(view, s.flashcardsEasy));
        await waitFor(() => expect(view.getByText(secondCue)).toBeTruthy());
        expect(endReviewSession).not.toHaveBeenCalled();
        view.unmount();
        expect(endReviewSession).toHaveBeenCalledWith(mockDatabase, { session: fixtureSession });
      });
    });

    it("announces the day's minimum wird and ends the first week with a commitment (STR-20)", async () => {
      jest.mocked(loadReviewQueue).mockResolvedValue(reviewQueue([firstCard]));
      jest.mocked(recordWirdProgress).mockResolvedValueOnce({ kind: "minimum_met", length: 2 });
      const view = renderSession();
      await reveal(view);
      fireEvent.press(getTextButton(view, s.flashcardsEasy));
      await waitFor(() => expect(view.getByText(s.flashcardsSummaryTitle)).toBeTruthy());
      expect(view.getAllByText(s.habitMinimumMet).length).toBeGreaterThan(0);
      expect(view.getByText("Day 2")).toBeTruthy();
      expect(getTextButton(view, s.habitCommitTomorrow)).toBeTruthy();
      expect(view.queryByText(s.flashcardsSummaryDone)).toBeNull();
    });

    it("marks a streak milestone quietly at the session end (STR-23)", async () => {
      jest.mocked(loadReviewQueue).mockResolvedValue(reviewQueue([firstCard]));
      jest.mocked(recordWirdProgress).mockResolvedValueOnce({ kind: "made_up", madeUpDay: "2026-11-01", length: 7 });
      const view = renderSession();
      await reveal(view);
      fireEvent.press(getTextButton(view, s.flashcardsEasy));
      await waitFor(() => expect(view.getByText(s.flashcardsSummaryTitle)).toBeTruthy());
      expect(view.getByText("7 days of wird")).toBeTruthy();
      expect(view.getAllByText("Yesterday's wird is made up. Your 7-day streak continues.").length).toBeGreaterThan(0);
    });

    it("cancels pending queue loading before fetching card content after unmount", async () => {
      const queue = createDeferred<ReturnType<typeof reviewQueue>>();
      jest.mocked(loadReviewQueue).mockReturnValueOnce(queue.promise);
      const view = renderSession();
      await waitFor(() => expect(loadReviewQueue).toHaveBeenCalledTimes(1));
      view.unmount();
      await act(async () => queue.resolve(reviewQueue([firstCard])));
      expect(getSmartCardContent).not.toHaveBeenCalled();
      expect(putCardRow).not.toHaveBeenCalled();
      expect(mockRouterReplace).not.toHaveBeenCalled();
    });

    it("shows a failed queue load as an empty summary with an error and no review side effects", async () => {
      const failure = new Error("synthetic queue failure");
      const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      jest.mocked(loadReviewQueue).mockRejectedValueOnce(failure);
      const view = renderSession();
      await waitFor(() => expect(view.getByText(s.genericActionFailed)).toBeTruthy());
      expect(view.getByText(s.flashcardsSummaryTitle)).toBeTruthy();
      expect(warning).toHaveBeenCalledWith("[FlashcardSession] Failed to load session:", failure);
      expect(putCardRow).not.toHaveBeenCalled();
      expect(putStudyLogRow).not.toHaveBeenCalled();
      expect(endReviewSession).not.toHaveBeenCalled();
    });
  });
});
