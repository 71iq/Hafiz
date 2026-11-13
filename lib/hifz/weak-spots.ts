import type { DatabaseExecutor } from "@/lib/database/types";
import { deleteStudyCardRow, insertNewStudyCard } from "@/lib/fsrs/queries";
import { HIFZ_PAGES_DECK_ID } from "@/lib/hifz/units";

/** ERR-06: a location wrong in this many separate sessions is a weak spot. */
export const WEAK_SPOT_SESSIONS = 3;

/** The errors that count toward a weak spot: clear errors, not tajweed, hesitation or caught slips. */
export const WEAK_SPOT_ERROR_SQL = "deleted_at IS NULL AND type NOT IN ('tajweed', 'hesitation') AND corrected != 'self'";

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

/** Where an error was logged; errors.ts imports this module, so the shape is declared here. */
type ErrorLocation = Readonly<{ surah: number; ayah: number | null; word: number | null }>;
type WordLocation = Readonly<{ id: string; surah: number; ayah: number; word: number }>;

/** Each word location once, in first-seen order. Ayah-level errors have no word and no cloze card. */
function wordLocations(errors: readonly ErrorLocation[]): WordLocation[] {
  const locations = new Map<string, WordLocation>();
  for (const { surah, ayah, word } of errors) {
    if (ayah === null || word === null) continue;
    const id = clozeCardId(surah, ayah, word);
    if (!locations.has(id)) locations.set(id, { id, surah, ayah, word });
  }
  return [...locations.values()];
}

/** Keeps each query well under SQLite's bound-parameter limit when a sync pull passes many locations. */
const LOCATIONS_PER_QUERY = 200;

function batches<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += LOCATIONS_PER_QUERY) result.push(items.slice(start, start + LOCATIONS_PER_QUERY));
  return result;
}

/** The ids of the cloze cards that exist and are not deleted, among `ids`. */
async function liveClozeIds(db: DatabaseExecutor, ids: readonly string[]): Promise<Set<string>> {
  const live = new Set<string>();
  for (const batch of batches(ids)) {
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM study_cards WHERE id IN (${batch.map(() => "?").join(", ")}) AND deleted_at IS NULL`,
      batch,
    );
    for (const row of rows) live.add(row.id);
  }
  return live;
}

/** The cloze ids of the locations wrong in WEAK_SPOT_SESSIONS or more sessions, in one grouped query per batch. */
async function weakLocationIds(db: DatabaseExecutor, locations: readonly WordLocation[]): Promise<Set<string>> {
  const weak = new Set<string>();
  for (const batch of batches(locations)) {
    const rows = await db.getAllAsync<{ surah: number; ayah: number; word: number }>(
      `SELECT surah, ayah, word FROM recitation_errors
        WHERE ${WEAK_SPOT_ERROR_SQL} AND (${batch.map(() => "(surah = ? AND ayah = ? AND word = ?)").join(" OR ")})
        GROUP BY surah, ayah, word
       HAVING COUNT(DISTINCT COALESCE(session_id, id)) >= ?`,
      [...batch.flatMap((location) => [location.surah, location.ayah, location.word]), WEAK_SPOT_SESSIONS],
    );
    for (const row of rows) weak.add(clozeCardId(row.surah, row.ayah, row.word));
  }
  return weak;
}

/**
 * Give each word location among `errors` that is now a weak spot (wrong in 3 or more sessions) its
 * cloze card, due now. Locations that already have a card are skipped before any counting. Returns
 * how many cards were created. Pass a transaction: each new card queues its upload.
 *
 * Runs inside the grade transaction with the grade's errors. Call it after a sync pull too, with the
 * pulled recitation_errors rows, so a weak spot whose sessions came from more than one device gets
 * its card.
 */
export async function createWeakSpotCards(db: DatabaseExecutor, errors: readonly ErrorLocation[], now: Date): Promise<number> {
  const locations = wordLocations(errors);
  if (locations.length === 0) return 0;
  const existing = await liveClozeIds(db, locations.map((location) => location.id));
  const missing = locations.filter((location) => !existing.has(location.id));
  if (missing.length === 0) return 0;
  const weak = await weakLocationIds(db, missing);
  let created = 0;
  for (const location of missing) {
    if (!weak.has(location.id)) continue;
    if (await insertNewStudyCard(db, { id: location.id, deckId: HIFZ_PAGES_DECK_ID, due: now, now: now.toISOString() })) created += 1;
  }
  return created;
}

/**
 * Soft-delete the cloze card of each word location among `errors` that is no longer a weak spot,
 * for example after an error there was dismissed as logged by mistake. Each delete queues its
 * upload, so pass the transaction that removed the error. Returns how many cards were deleted.
 */
export async function removeClearedWeakSpotCards(db: DatabaseExecutor, errors: readonly ErrorLocation[]): Promise<number> {
  const locations = wordLocations(errors);
  if (locations.length === 0) return 0;
  const existing = await liveClozeIds(db, locations.map((location) => location.id));
  const carded = locations.filter((location) => existing.has(location.id));
  if (carded.length === 0) return 0;
  const weak = await weakLocationIds(db, carded);
  let removed = 0;
  for (const location of carded) {
    if (weak.has(location.id)) continue;
    await deleteStudyCardRow(db, HIFZ_PAGES_DECK_ID, location.id);
    removed += 1;
  }
  return removed;
}
