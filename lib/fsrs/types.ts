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
  id: string; // "surah:ayah" e.g. "2:255"
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
  | "firstLetter"
  | "surahIdentification";

export const ALL_TEST_MODES: TestMode[] = [
  "nextAyah",
  "previousAyah",
  "translation",
  "tafseer",
  "firstLetter",
  "surahIdentification",
];

export const DEFAULT_ENABLED_MODES: TestMode[] = [
  "nextAyah",
  "translation",
  "firstLetter",
];
