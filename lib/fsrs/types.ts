import type { State, StepUnit } from "ts-fsrs";

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
  suspended_at: string | null;
  buried_until: string | null;
  marked_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DeckCardListItem = StudyCardRow & {
  reference: string;
  title: string;
  subtitle: string;
  preview: string;
  searchText: string;
  kind: "ayah" | "word" | "smart";
  isVirtual: boolean;
};

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
export const DEFAULT_DECK_NEW_CARD_LIMIT = 30;
export const MIN_DECK_NEW_CARD_LIMIT = 0;
export const MAX_DECK_NEW_CARD_LIMIT = 30;
export const DECK_NEW_CARD_LIMIT_STEP = 5;
export const DEFAULT_DECK_REQUEST_RETENTION = 0.95;
export const MIN_DECK_REQUEST_RETENTION = 0.8;
export const MAX_DECK_REQUEST_RETENTION = 0.99;
export const DECK_REQUEST_RETENTION_STEP = 0.01;
export const DEFAULT_DECK_MAXIMUM_INTERVAL = 365;
export const MIN_DECK_MAXIMUM_INTERVAL = 30;
export const MAX_DECK_MAXIMUM_INTERVAL = 3650;
export const DECK_MAXIMUM_INTERVAL_STEP = 30;
export const DEFAULT_DECK_ENABLE_FUZZ = true;
export const DEFAULT_DECK_ENABLE_SHORT_TERM = true;
export type SchedulerStep = StepUnit;

export const DEFAULT_DECK_LEARNING_STEPS: SchedulerStep[] = ["1m", "10m"];
export const DEFAULT_DECK_RELEARNING_STEPS: SchedulerStep[] = ["10m"];

export type NewReviewOrder = "reviewsFirst" | "newFirst" | "mixed";
export type ReviewSortOrder = "due" | "oldest" | "newest" | "random";
export type NewCardSortOrder = "created" | "random";

export const ALL_NEW_REVIEW_ORDERS: NewReviewOrder[] = ["reviewsFirst", "newFirst", "mixed"];
export const ALL_REVIEW_SORT_ORDERS: ReviewSortOrder[] = ["due", "oldest", "newest", "random"];
export const ALL_NEW_CARD_SORT_ORDERS: NewCardSortOrder[] = ["created", "random"];
export const DEFAULT_NEW_REVIEW_ORDER: NewReviewOrder = "reviewsFirst";
export const DEFAULT_REVIEW_SORT_ORDER: ReviewSortOrder = "due";
export const DEFAULT_NEW_CARD_SORT_ORDER: NewCardSortOrder = "created";

export type DeckReviewSettings = {
  dailyReviewLimit: number;
  newCardsLimit: number;
  requestRetention: number;
  maximumInterval: number;
  enableFuzz: boolean;
  enableShortTerm: boolean;
  learningSteps: SchedulerStep[];
  relearningSteps: SchedulerStep[];
  newReviewOrder: NewReviewOrder;
  reviewSortOrder: ReviewSortOrder;
  newCardSortOrder: NewCardSortOrder;
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
