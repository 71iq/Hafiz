import type { State } from "ts-fsrs";

/** A deck is a logical grouping — we track it as metadata on cards */
export type DeckScope =
  | { type: "surah"; surahs: number[] }
  | { type: "juz"; juzNumbers: number[] }
  | { type: "hizb"; hizbNumbers: number[] }
  | { type: "custom"; surahStart: number; ayahStart: number; surahEnd: number; ayahEnd: number };

export interface DeckInfo {
  id: string;
  name: string;
  scope: DeckScope;
  cardCount: number;
  dueCount: number;
  newCount: number;
  createdAt: string;
}

export interface StudyCardRow {
  id: string; // ayah "2:255", word "word:2:255:4", or built-in smart deck id
  deck_id: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number; // State enum: 0=New, 1=Learning, 2=Review, 3=Relearning
  last_review: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudyLogRow {
  id: number;
  card_id: string;
  rating: number;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reviewed_at: string;
  sync_status: string;
}

/** Test modes available in flashcard review */
export type TestMode =
  | "nextAyah"
  | "previousAyah"
  | "translation"
  | "tafseer"
  | "surahName";

export const ALL_TEST_MODES: TestMode[] = [
  "nextAyah",
  "previousAyah",
  "translation",
  "tafseer",
  "surahName",
];

export const DEFAULT_ENABLED_MODES: TestMode[] = [
  "nextAyah",
  "translation",
  "surahName",
];

export type WordTestMode = "wordMeaningArabic" | "wordMeaningTranslation";

export const ALL_WORD_TEST_MODES: WordTestMode[] = [
  "wordMeaningArabic",
  "wordMeaningTranslation",
];

export const DEFAULT_WORD_TEST_MODES: WordTestMode[] = [
  "wordMeaningArabic",
  "wordMeaningTranslation",
];

export const DEFAULT_DECK_DAILY_REVIEW_LIMIT = 30;
export const MIN_DECK_DAILY_REVIEW_LIMIT = 10;
export const MAX_DECK_DAILY_REVIEW_LIMIT = 30;
export const DECK_DAILY_REVIEW_LIMIT_STEP = 10;

export type DeckReviewSettings = {
  dailyReviewLimit: number;
  testModes: TestMode[];
  wordTestModes: WordTestMode[];
};

/** Color for each test mode tag */
export const TEST_MODE_COLORS: Record<TestMode, string> = {
  nextAyah: "#3b82f6",       // blue
  previousAyah: "#8b5cf6",   // violet
  translation: "#0d9488",    // teal
  tafseer: "#d97706",        // amber
  surahName: "#e11d48",      // rose
};
