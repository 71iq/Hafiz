import { type SQLiteDatabase } from "expo-sqlite";
import {
  type Ayah,
  getDuplicateTexts,
  getPreviousAyah,
  getNextAyah,
  getSurah,
} from "../db/database";

export interface FlashCard {
  /** The ayah being tested */
  ayah: Ayah;
  /** Context ayahs shown before the target (for disambiguation) */
  contextAyahs: Ayah[];
  /** Surah name shown if context crosses surah boundary or start of surah */
  surahLabel: string | null;
  /** The answer: next ayah in the Quran */
  answer: Ayah;
}

const MAX_CONTEXT_DEPTH = 5;

export function buildDeck(db: SQLiteDatabase, ayahs: Ayah[]): FlashCard[] {
  const cards: FlashCard[] = [];

  for (const ayah of ayahs) {
    // Skip last ayah of Quran (114:6) — no next verse
    if (ayah.surah === 114 && ayah.ayah === 6) continue;

    const answer = getNextAyah(db, ayah.surah, ayah.ayah);
    if (!answer) continue;

    const duplicates = getDuplicateTexts(db, ayah.text_clean);
    let contextAyahs: Ayah[] = [];
    let surahLabel: string | null = null;

    if (duplicates.length > 1) {
      // This ayah text appears in multiple places — need disambiguation
      contextAyahs = findDisambiguatingContext(db, ayah, duplicates);

      // If we're at the start of surah (ayah 1 or context reaches ayah 1),
      // include surah name as additional context
      const earliestAyah =
        contextAyahs.length > 0 ? contextAyahs[0] : ayah;
      if (earliestAyah.ayah === 1) {
        const surah = getSurah(db, earliestAyah.surah);
        if (surah) surahLabel = surah.name_arabic;
      }
    }

    cards.push({ ayah, contextAyahs, surahLabel, answer });
  }

  return cards;
}

function findDisambiguatingContext(
  db: SQLiteDatabase,
  targetAyah: Ayah,
  duplicates: Ayah[]
): Ayah[] {
  // Build context chains for all duplicate locations
  type Location = { surah: number; ayah: number };
  let candidates: Location[] = duplicates
    .filter((d) => !(d.surah === targetAyah.surah && d.ayah === targetAyah.ayah));

  const targetContext: Ayah[] = [];

  for (let depth = 1; depth <= MAX_CONTEXT_DEPTH; depth++) {
    // Get previous ayah for the target at this depth
    const refAyah = targetContext.length > 0 ? targetContext[0] : targetAyah;
    const prev = getPreviousAyah(db, refAyah.surah, refAyah.ayah);
    if (!prev) {
      // At start of Quran — no more context available, surah name will disambiguate
      break;
    }
    targetContext.unshift(prev);

    // Check if this context chain now distinguishes target from all other occurrences
    const newCandidates = candidates.filter((loc) => {
      // Build the same-depth context for this candidate
      const candidatePrev = getContextAtDepth(db, loc.surah, loc.ayah, depth);
      if (!candidatePrev) return false; // candidate can't match if it has no context
      // Still ambiguous if preceding ayah text matches
      return candidatePrev.text_clean === prev.text_clean;
    });

    if (newCandidates.length === 0) {
      // Fully disambiguated
      break;
    }
    candidates = newCandidates;
  }

  return targetContext;
}

/** Get the ayah that is `depth` positions before surah:ayah */
function getContextAtDepth(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
  depth: number
): Ayah | null {
  let current: Ayah | null = { surah, ayah, text_uthmani: "", text_clean: "" };
  for (let i = 0; i < depth; i++) {
    current = getPreviousAyah(db, current.surah, current.ayah);
    if (!current) return null;
  }
  return current;
}
