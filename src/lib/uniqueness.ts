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

export async function buildDeck(db: SQLiteDatabase, ayahs: Ayah[]): Promise<FlashCard[]> {
  const cards: FlashCard[] = [];

  for (const ayah of ayahs) {
    // Skip last ayah of Quran (114:6) — no next verse
    if (ayah.surah === 114 && ayah.ayah === 6) continue;

    const answer = await getNextAyah(db, ayah.surah, ayah.ayah);
    if (!answer) continue;

    const duplicates = await getDuplicateTexts(db, ayah.text_clean);
    let contextAyahs: Ayah[] = [];
    let surahLabel: string | null = null;

    if (duplicates.length > 1) {
      // This ayah text appears in multiple places — need disambiguation
      contextAyahs = await findDisambiguatingContext(db, ayah, duplicates);

      // If we're at the start of surah (ayah 1 or context reaches ayah 1),
      // include surah name as additional context
      const earliestAyah =
        contextAyahs.length > 0 ? contextAyahs[0] : ayah;
      if (earliestAyah.ayah === 1) {
        const surah = await getSurah(db, earliestAyah.surah);
        if (surah) surahLabel = surah.name_arabic;
      }
    }

    cards.push({ ayah, contextAyahs, surahLabel, answer });
  }

  return cards;
}

async function findDisambiguatingContext(
  db: SQLiteDatabase,
  targetAyah: Ayah,
  duplicates: Ayah[]
): Promise<Ayah[]> {
  // Build context chains for all duplicate locations
  type Location = { surah: number; ayah: number };
  let candidates: Location[] = duplicates
    .filter((d) => !(d.surah === targetAyah.surah && d.ayah === targetAyah.ayah));

  const targetContext: Ayah[] = [];

  for (let depth = 1; depth <= MAX_CONTEXT_DEPTH; depth++) {
    // Get previous ayah for the target at this depth
    const refAyah = targetContext.length > 0 ? targetContext[0] : targetAyah;
    const prev = await getPreviousAyah(db, refAyah.surah, refAyah.ayah);
    if (!prev) {
      // At start of Quran — no more context available, surah name will disambiguate
      break;
    }
    targetContext.unshift(prev);

    // Check if this context chain now distinguishes target from all other occurrences
    const newCandidates: Location[] = [];
    for (const loc of candidates) {
      const candidatePrev = await getContextAtDepth(db, loc.surah, loc.ayah, depth);
      if (!candidatePrev) continue; // candidate can't match if it has no context
      // Still ambiguous if preceding ayah text matches
      if (candidatePrev.text_clean === prev.text_clean) {
        newCandidates.push(loc);
      }
    }

    if (newCandidates.length === 0) {
      // Fully disambiguated
      break;
    }
    candidates = newCandidates;
  }

  return targetContext;
}

/** Get the ayah that is `depth` positions before surah:ayah */
async function getContextAtDepth(
  db: SQLiteDatabase,
  surah: number,
  ayah: number,
  depth: number
): Promise<Ayah | null> {
  let current: Ayah | null = { surah, ayah, text_uthmani: "", text_clean: "" };
  for (let i = 0; i < depth; i++) {
    current = await getPreviousAyah(db, current.surah, current.ayah);
    if (!current) return null;
  }
  return current;
}
