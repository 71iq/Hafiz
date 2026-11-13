import type { DatabaseExecutor } from "@/lib/database/types";
import { insertNewStudyCard } from "@/lib/fsrs/queries";
import { WEAK_SPOT_ERROR_SQL, WEAK_SPOT_SESSIONS, type RecitationErrorInput } from "@/lib/hifz/errors";
import { HIFZ_PAGES_DECK_ID } from "@/lib/hifz/units";

/** ERR-06, 4.5 "Fill the gap": one card per weak word, the ayah shown with that word hidden. */
export function clozeCardId(surah: number, ayah: number, word: number): string {
  return `cloze:${surah}:${ayah}:${word}`;
}

export function parseClozeCardId(id: string): { surah: number; ayah: number; word: number } | null {
  const match = /^cloze:(\d+):(\d+):(\d+)$/.exec(id);
  if (!match) return null;
  const [surah, ayah, word] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return surah >= 1 && surah <= 114 && ayah >= 1 && word >= 1 ? { surah, ayah, word } : null;
}

/**
 * Inside the grade transaction: give each word location that this grade made a weak spot (wrong in
 * 3 or more sessions) its cloze card, due now. Existing cards are left alone. Returns how many were
 * created.
 */
export async function createWeakSpotCards(
  db: DatabaseExecutor,
  errors: readonly Pick<RecitationErrorInput, "surah" | "ayah" | "word">[],
  now: Date,
): Promise<number> {
  const seen = new Set<string>();
  let created = 0;
  for (const error of errors) {
    if (error.ayah === null || error.word === null) continue;
    const id = clozeCardId(error.surah, error.ayah, error.word);
    if (seen.has(id)) continue;
    seen.add(id);
    const row = await db.getFirstAsync<{ sessions: number }>(
      `SELECT COUNT(DISTINCT COALESCE(session_id, id)) AS sessions FROM recitation_errors
        WHERE ${WEAK_SPOT_ERROR_SQL} AND surah = ? AND ayah = ? AND word = ?`,
      [error.surah, error.ayah, error.word],
    );
    if (Number(row?.sessions ?? 0) < WEAK_SPOT_SESSIONS) continue;
    if (await insertNewStudyCard(db, { id, deckId: HIFZ_PAGES_DECK_ID, due: now, now: now.toISOString() })) created += 1;
  }
  return created;
}
