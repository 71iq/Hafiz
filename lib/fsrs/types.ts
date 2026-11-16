import type { StepUnit } from "ts-fsrs";

export type SurahAyahRange = { surah: number; ayahStart: number; ayahEnd: number };

export interface StudyCardRow {
  id: string;
  deck_id: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
  suspended_at: string | null;
  buried_until: string | null;
  marked_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  tier?: string | null;
  tier_changed_at?: string | null;
}

export type DeckCardListItem = StudyCardRow & {
  reference: string;
  title: string;
  subtitle: string;
  titleAr: string;
  subtitleAr: string;
  preview: string;
  searchText: string;
  kind: "ayah" | "word" | "smart";
  isVirtual: boolean;
};

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

export const DEFAULT_DECK_DAILY_REVIEW_LIMIT = 20;
export const MIN_DECK_DAILY_REVIEW_LIMIT = 10;
export const DECK_DAILY_REVIEW_LIMIT_STEP = 10;
export const DEFAULT_DECK_NEW_CARD_LIMIT = 20;
export const MIN_DECK_NEW_CARD_LIMIT = 0;
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
export const DEFAULT_NEW_REVIEW_ORDER: NewReviewOrder = "mixed";
export const DEFAULT_REVIEW_SORT_ORDER: ReviewSortOrder = "random";
export const DEFAULT_NEW_CARD_SORT_ORDER: NewCardSortOrder = "random";

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

export const TEST_MODE_COLORS: Record<TestMode, string> = {
  nextAyah: "#3b82f6",
  previousAyah: "#8b5cf6",
  translation: "#0d9488",
  tafseer: "#d97706",
  surahName: "#e11d48",
};
