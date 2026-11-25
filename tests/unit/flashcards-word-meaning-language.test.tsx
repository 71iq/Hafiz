import React from "react";
import * as ReactNative from "react-native";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import FlashcardSessionScreenWrapper from "@/app/flashcards/session";
import { DirectionProvider } from "@/lib/ui/direction";
import { useSettings } from "@/lib/settings/context";
import { strings } from "@/lib/i18n/strings";
import { State } from "@/lib/fsrs/scheduler";
import type { DeckReviewSettings, StudyCardRow } from "@/lib/fsrs/types";
import { DEFAULT_RECITATION_ID } from "@/lib/quran-foundation/recitations";
import { DEFAULT_TAFSIR_SOURCE } from "@/lib/tafsir/sources";
import { endReviewSession, startReviewSession } from "@/lib/fsrs/review-sessions";
import { loadReviewQueue } from "@/lib/fsrs/queries";
import { fetchWordMeaningAr, fetchWordText, fetchWordTranslation } from "@/lib/word/queries";
import { readMeaningsSettings } from "@/lib/meanings/settings";
import { isQuranPageFontLoaded, loadQuranPageFont, quranPageFontName } from "@/lib/fonts/loader";

const mockDatabase = Object.freeze({
  identity: "word-lang-db",
  getFirstAsync: jest.fn(async (): Promise<unknown> => null),
  getAllAsync: async () => [],
  withTransactionAsync: async (task: (transaction: unknown) => Promise<void>) => task(mockDatabase),
});

const mockSettings = {
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
  classicDownloadState: "ready",
  setQuranFontStyle: jest.fn(),
  quranMarkerStyle: "auto",
  setQuranMarkerStyle: jest.fn(),
  showAyahMarkers: true,
  setShowAyahMarkers: jest.fn(),
  markSimilarVerses: true,
  setMarkSimilarVerses: jest.fn(),
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
  accountPromoDismissed: false,
  dismissAccountPromo: jest.fn(),
  bookmarksOrder: "recent",
  setBookmarksOrder: jest.fn(),
  audioFollow: true,
  setAudioFollow: jest.fn(),
  audioRepeatRange: 1,
  setAudioRepeatRange: jest.fn(),
  audioRepeatEach: 1,
  setAudioRepeatEach: jest.fn(),
  audioDelaySeconds: 1,
  setAudioDelaySeconds: jest.fn(),
  hapticsEnabled: true,
  setHapticsEnabled: jest.fn(),
  autoDownloadUpdates: true,
  setAutoDownloadUpdates: jest.fn(),
  isRTL: true,
  isDark: false,
  isLoaded: true,
} as unknown as ReturnType<typeof useSettings>;

const mockNavigation = { getState: () => undefined, dispatch: jest.fn() };
jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), dismissTo: jest.fn() },
  useNavigation: () => mockNavigation,
  useLocalSearchParams: () => ({ deckId: "meanings-fixture" }),
}));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  usePreventRemove: () => undefined,
  useIsFocused: () => true,
}));
jest.mock("@/lib/database/provider", () => ({
  useDatabase: () => mockDatabase,
  useDatabaseStatus: () => ({ isReady: true, progress: null, error: null }),
}));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual("@/lib/settings/context");
  return {
    ...actual,
    SettingsProvider: ({ children }: { children: React.ReactNode }) => children,
    useSettings: () => mockSettings,
  };
});
jest.mock("@/lib/fonts/loader", () => ({
  isQuranPageFontLoaded: jest.fn(() => true),
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
  MEANINGS_DECK_ID: "meanings",
}));
jest.mock("@/lib/fsrs/review-sessions", () => ({
  startReviewSession: jest.fn(),
  recordSessionProgress: jest.fn(),
  endReviewSession: jest.fn(),
}));
jest.mock("@/lib/haptics", () => ({ hapticMedium: jest.fn(), hapticSuccess: jest.fn() }));
jest.mock("@/lib/achievements/queries", () => ({ recordAchievementEvent: jest.fn() }));
jest.mock("@/lib/word/queries", () => ({
  fetchWordMeaningAr: jest.fn(),
  fetchWordText: jest.fn(),
  fetchWordTranslation: jest.fn(),
}));
jest.mock("@/lib/meanings/settings", () => ({ readMeaningsSettings: jest.fn() }));

function card(id: string): StudyCardRow {
  const now = new Date().toISOString();
  return {
    id,
    deck_id: "meanings-fixture",
    due: now,
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
    created_at: now,
    updated_at: now,
    deleted_at: null,
  } as StudyCardRow;
}

const settings = {
  dailyReviewLimit: 20,
  newCardsLimit: 5,
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

function renderSession() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <DirectionProvider dir="rtl">
        <FlashcardSessionScreenWrapper />
      </DirectionProvider>
    </SafeAreaProvider>,
    { concurrentRoot: false },
  );
}

/**
 * SPEC 3.6: with the deck's default two answer sides, a word card answers in the meaning language
 * only. Most words have no Arabic entry; those answer with the English gloss.
 */
const s = strings.ar;
const NO_ARABIC = { surah: 2, ayah: 4, word_pos: 2, word: null, meaning: null, source: null, custom_created_at: null };
const WITH_ARABIC = { ...NO_ARABIC, word: "يُؤْمِنُونَ", meaning: "يصدّقون", source: "bundled" };

beforeEach(() => {
  jest.resetAllMocks();
  mockDatabase.getFirstAsync.mockResolvedValue(null);
  jest.mocked(performance.now).mockImplementation(Date.now);
  jest.mocked(startReviewSession).mockReturnValue({
    id: "s",
    kind: "cards",
    deckId: "meanings-fixture",
    startedAt: new Date().toISOString(),
    source: "app",
  } as never);
  jest.mocked(endReviewSession).mockResolvedValue(null);
  jest.mocked(isQuranPageFontLoaded).mockReturnValue(true);
  jest.mocked(loadQuranPageFont).mockResolvedValue();
  jest.mocked(quranPageFontName).mockReturnValue("QCF2_fixture");
  ReactNative.Dimensions.set({
    window: { width: 390, height: 844, scale: 1, fontScale: 1 },
    screen: { width: 390, height: 844, scale: 1, fontScale: 1 },
  });
  jest.mocked(loadReviewQueue).mockResolvedValue([{ card: card("word:2:4:2"), settings }]);
  jest.mocked(fetchWordText).mockResolvedValue("يُؤْمِنُونَ");
  jest
    .mocked(fetchWordTranslation)
    .mockResolvedValue({ word_arabic: null, translation_en: "believe", transliteration: "yu'minūna" } as never);
});
afterEach(() => cleanup());

async function revealed(language: "ar" | "en", arabic: typeof NO_ARABIC | typeof WITH_ARABIC) {
  jest.mocked(readMeaningsSettings).mockResolvedValue({ language, level: 3, stored: { language: true, level: true } });
  jest.mocked(fetchWordMeaningAr).mockResolvedValue(arabic as never);
  const view = renderSession();
  await waitFor(() => expect(view.getByText(s.flashcardsReveal)).toBeTruthy(), { timeout: 15000 });
  fireEvent.press(view.getByText(s.flashcardsReveal));
  await waitFor(() => expect(view.queryByText(s.flashcardsReveal)).toBeNull());
  return {
    english: view.queryAllByText("believe").length > 0,
    arabic: view.queryAllByText("يصدّقون").length > 0,
    fallback: view.queryAllByText(s.noWordMeaningFallback).length > 0,
  };
}

it("answers in Arabic only when the word has an Arabic meaning", async () => {
  expect(await revealed("ar", WITH_ARABIC)).toEqual({ english: false, arabic: true, fallback: false });
});

it("answers with the English gloss when the word has no Arabic meaning", async () => {
  expect(await revealed("ar", NO_ARABIC)).toEqual({ english: true, arabic: false, fallback: false });
});

it("answers in English only for English meanings", async () => {
  expect(await revealed("en", WITH_ARABIC)).toEqual({ english: true, arabic: false, fallback: false });
});
