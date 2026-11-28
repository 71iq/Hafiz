import type { DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting } from "@/lib/database/user-settings";
import { HIFZ_PAGES_DECK_ID, PAGE_COUNT, parsePageUnit } from "./units";

export const DECLARED_WHOLE_QURAN_KEY = "habit_declared_whole_quran";
const DECLARED_PORTION = "habit_declared_memorized_portion";

/** Deck filters can change independently. Keep the learner's actual setup declaration with the plan. */
export async function recordMemorizedPortion(db: DatabaseExecutor, surahs: readonly number[], juz: readonly number[]) {
  if (surahs.length || juz.length) await putUserSetting(db, DECLARED_PORTION, JSON.stringify({ surahs, juz }));
}

export async function readMemorizedPageNumbers(db: DatabaseExecutor): Promise<Set<number>> {
  const rows = await db.getAllAsync<{ id: string; suspended_at: string | null }>(
    `SELECT id, suspended_at FROM study_cards
      WHERE deck_id = ? AND id LIKE 'page:%' AND deleted_at IS NULL`,
    [HIFZ_PAGES_DECK_ID],
  );
  return new Set(
    rows.flatMap((row) => {
      if (row.suspended_at && Date.parse(row.suspended_at) !== 0) return [];
      const unit = parsePageUnit(row.id);
      return unit?.kind === "page" ? [unit.page] : [];
    }),
  );
}

async function declaredOrAwardedWholeQuran(db: DatabaseExecutor, declared?: boolean): Promise<boolean> {
  if (declared === undefined) {
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM user_settings WHERE key = ? AND deleted_at IS NULL",
      [DECLARED_WHOLE_QURAN_KEY],
    );
    declared = row?.value === "true";
  }
  return (
    declared ||
    !!(await db.getFirstAsync(
      "SELECT 1 AS found FROM achievement_unlocks WHERE achievement_id = 'quran_complete' LIMIT 1",
    ))
  );
}

export async function isFullHafiz(db: DatabaseExecutor, settings?: { declaredWholeQuran: boolean }): Promise<boolean> {
  return (
    (await declaredOrAwardedWholeQuran(db, settings?.declaredWholeQuran)) ||
    (await readMemorizedPageNumbers(db)).size >= PAGE_COUNT
  );
}

/** null means the whole Quran. An empty set means no memorization has been recorded. */
export async function readMemorizedAyahs(db: DatabaseExecutor): Promise<ReadonlySet<string> | null> {
  if (await declaredOrAwardedWholeQuran(db)) return null;
  const pages = [...(await readMemorizedPageNumbers(db))];
  if (pages.length === PAGE_COUNT) return null;
  const rows = await db.getAllAsync<{ id: string }>(
    `WITH declaration AS (
       SELECT CASE WHEN json_valid(value) THEN value ELSE '{}' END AS portion
         FROM user_settings WHERE key = ? AND deleted_at IS NULL
     )
     SELECT id FROM study_cards
      WHERE id >= '0' AND id < ':' AND deleted_at IS NULL AND (reps > 0 OR last_review IS NOT NULL)
     UNION ALL
     SELECT surah || ':' || ayah FROM quran_text
      WHERE v2_page IN (SELECT value FROM json_each(?))
         OR surah IN (SELECT item.value FROM declaration, json_each(portion, '$.surahs') item
                       WHERE json_type(portion, '$.surahs') = 'array' AND item.type = 'integer')
     UNION ALL
     SELECT q.surah || ':' || q.ayah FROM juz_map j
       JOIN quran_text q ON q.surah = j.surah AND q.ayah BETWEEN j.ayah_start AND j.ayah_end
      WHERE j.juz IN (SELECT item.value FROM declaration, json_each(portion, '$.juz') item
                       WHERE json_type(portion, '$.juz') = 'array' AND item.type = 'integer')`,
    [DECLARED_PORTION, JSON.stringify(pages)],
  );
  return new Set(rows.map((row) => row.id).filter((id) => /^\d+:\d+$/.test(id)));
}

export function isMemorizedAyah(known: ReadonlySet<string> | null, ref: { surah: number; ayah: number }) {
  return known === null || known.has(`${ref.surah}:${ref.ayah}`);
}
