import { compareSyncTimestamps } from "@/lib/database/sync-timestamps";
import type { DatabaseExecutor } from "@/lib/database/types";

/**
 * An ISO instant later than `now` and every given stamp, so a write made now supersedes all of them.
 * Card writes stamp past the version they replace: a version stamped by a clock running ahead
 * (another device's deletion, or a restore after it) must not make this device's later grades look
 * older and lose to it in sync. Review times (reviewed_at, last_review, due) stay the real ones.
 */
export function laterThanAll(now: Date, stamps: readonly (string | null | undefined)[]): string {
  let at = now.toISOString();
  for (const stamp of stamps) {
    if (!stamp || compareSyncTimestamps(stamp, at) < 0) continue;
    const next = Date.parse(stamp) + 1;
    if (Number.isFinite(next)) at = new Date(next).toISOString();
  }
  return at;
}

/**
 * For each id among `ids` that is a deleted card, a stamp later than `now` and the deletion it would
 * replace, so a card created again over a deletion stamped by a clock running ahead is not older than
 * that deletion in sync. Ids without a deleted row are absent from the map.
 */
export async function stampsOverDeletedCards(
  db: DatabaseExecutor,
  ids: readonly string[],
  now: Date,
): Promise<Map<string, string>> {
  const stamps = new Map<string, string>();
  const base = Number.isFinite(now.getTime()) ? now : new Date();
  for (let start = 0; start < ids.length; start += 200) {
    const batch = ids.slice(start, start + 200);
    const rows = await db.getAllAsync<{ id: string; updated_at: string | null; deleted_at: string | null }>(
      `SELECT id, updated_at, deleted_at FROM study_cards WHERE id IN (${batch.map(() => "?").join(", ")}) AND deleted_at IS NOT NULL`,
      [...batch],
    );
    for (const row of rows) stamps.set(row.id, laterThanAll(base, [row.updated_at, row.deleted_at]));
  }
  return stamps;
}
