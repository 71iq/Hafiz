import type { DatabaseExecutor } from "@/lib/database/types";
import { deleteStudyCardRow, insertNewStudyCard, restoreDeletedStudyCard } from "@/lib/fsrs/queries";
import { HIFZ_PAGES_DECK_ID } from "@/lib/hifz/units";

export const WEAK_SPOT_SESSIONS = 3;

export const WEAK_SPOT_ERROR_SQL = "deleted_at IS NULL AND type NOT IN ('tajweed', 'hesitation') AND corrected != 'self'";

export function clozeCardId(surah: number, ayah: number, word: number): string {
  return `cloze:${surah}:${ayah}:${word}`;
}

export function parseClozeCardId(id: string): { surah: number; ayah: number; word: number } | null {
  const match = /^cloze:(\d+):(\d+):(\d+)$/.exec(id);
  if (!match) return null;
  const [surah, ayah, word] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return surah >= 1 && surah <= 114 && ayah >= 1 && word >= 1 ? { surah, ayah, word } : null;
}

type ErrorLocation = Readonly<{ surah: number; ayah: number | null; word: number | null }>;
type WordLocation = Readonly<{ id: string; surah: number; ayah: number; word: number }>;

function wordLocations(errors: readonly ErrorLocation[]): WordLocation[] {
  const locations = new Map<string, WordLocation>();
  for (const { surah, ayah, word } of errors) {
    if (ayah === null || word === null) continue;
    const id = clozeCardId(surah, ayah, word);
    if (!locations.has(id)) locations.set(id, { id, surah, ayah, word });
  }
  return [...locations.values()];
}

const LOCATIONS_PER_QUERY = 200;

function batches<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += LOCATIONS_PER_QUERY) result.push(items.slice(start, start + LOCATIONS_PER_QUERY));
  return result;
}

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

const WEAK_SPOT_ERROR_WITH_DISMISSED_SQL = "type NOT IN ('tajweed', 'hesitation') AND corrected != 'self'";

async function weakLocationIds(
  db: DatabaseExecutor,
  locations: readonly WordLocation[],
  { includeDismissed = false }: { includeDismissed?: boolean } = {},
): Promise<Set<string>> {
  const weak = new Set<string>();
  const filter = includeDismissed ? WEAK_SPOT_ERROR_WITH_DISMISSED_SQL : WEAK_SPOT_ERROR_SQL;
  for (const batch of batches(locations)) {
    const rows = await db.getAllAsync<{ surah: number; ayah: number; word: number }>(
      `SELECT surah, ayah, word FROM recitation_errors
        WHERE ${filter} AND (${batch.map(() => "(surah = ? AND ayah = ? AND word = ?)").join(" OR ")})
        GROUP BY surah, ayah, word
       HAVING COUNT(DISTINCT COALESCE(session_id, id)) >= ?`,
      [...batch.flatMap((location) => [location.surah, location.ayah, location.word]), WEAK_SPOT_SESSIONS],
    );
    for (const row of rows) weak.add(clozeCardId(row.surah, row.ayah, row.word));
  }
  return weak;
}

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
    if (await restoreDeletedStudyCard(db, location.id, now)) created += 1;
    else if (await insertNewStudyCard(db, { id: location.id, deckId: HIFZ_PAGES_DECK_ID, due: now, now: now.toISOString() })) created += 1;
  }
  return created;
}

export async function weakSpotIds(db: DatabaseExecutor, errors: readonly ErrorLocation[]): Promise<Set<string>> {
  const locations = wordLocations(errors);
  return locations.length === 0 ? new Set() : weakLocationIds(db, locations);
}

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

export async function removeDismissedWeakSpotCards(db: DatabaseExecutor, errors: readonly ErrorLocation[]): Promise<number> {
  const locations = wordLocations(errors);
  if (locations.length === 0) return 0;
  const existing = await liveClozeIds(db, locations.map((location) => location.id));
  const carded = locations.filter((location) => existing.has(location.id));
  if (carded.length === 0) return 0;
  const [weakNow, weakBefore] = await Promise.all([
    weakLocationIds(db, carded),
    weakLocationIds(db, carded, { includeDismissed: true }),
  ]);
  let removed = 0;
  for (const location of carded) {
    if (weakNow.has(location.id) || !weakBefore.has(location.id)) continue;
    await deleteStudyCardRow(db, HIFZ_PAGES_DECK_ID, location.id);
    removed += 1;
  }
  return removed;
}
