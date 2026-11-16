import type { DatabaseExecutor } from "@/lib/database/types";
import { readHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { putCardRow } from "@/lib/fsrs/queries";
import { laterThanAll } from "@/lib/fsrs/card-stamps";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { HIFZ_PAGES_DECK_ID } from "@/lib/hifz/units";
import {
  isUnitSwitchResume,
  isUnitSwitchSuspension,
  PAGE_REVIEW_CARDS_SQL,
  resumedFromUnitSwitch,
  reviewsPages,
  setAsideForUnitSwitch,
  switchToAyahReview,
  switchToPageReview,
} from "@/lib/hifz/unit-switch";

type Unit = HifzPlan["unit"];

export const APPLIED_UNIT_KEY = "device_hifz_unit_applied";

async function readAppliedUnit(db: DatabaseExecutor): Promise<Unit | null> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [
    APPLIED_UNIT_KEY,
  ]);
  return row?.value === "page" || row?.value === "half" || row?.value === "ayah" ? row.value : null;
}

async function writeAppliedUnit(db: DatabaseExecutor, unit: Unit, now: Date): Promise<void> {
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, ?, ?, NULL)",
    [APPLIED_UNIT_KEY, unit, now.toISOString()],
  );
}

export async function applyUnitSwitch(
  db: DatabaseExecutor,
  { unit, previousPlanUnit, now }: { unit: Unit; previousPlanUnit: Unit | null; now: Date },
): Promise<number> {
  const applied = (await readAppliedUnit(db)) ?? previousPlanUnit;
  let migrated = 0;
  if (applied === null || reviewsPages(applied) !== reviewsPages(unit)) {
    if (unit === "ayah") await switchToAyahReview(db, { previousUnit: applied, now });
    else migrated = await switchToPageReview(db, { previousUnit: applied, now });
  }
  await writeAppliedUnit(db, unit, now);
  return migrated;
}

async function unitCards(db: DatabaseExecutor, ayah: boolean, condition: string): Promise<StudyCardRow[]> {
  return ayah
    ? db.getAllAsync<StudyCardRow>(
        `SELECT * FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL AND ${condition}`,
        [SMART_DECK_IDS.retention],
      )
    : db.getAllAsync<StudyCardRow>(
        `SELECT * FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL AND ${condition} AND ${PAGE_REVIEW_CARDS_SQL}`,
        [HIFZ_PAGES_DECK_ID],
      );
}

async function markedActiveCards(db: DatabaseExecutor, unit: Unit): Promise<StudyCardRow[]> {
  const rows = await unitCards(db, !reviewsPages(unit), "suspended_at IS NOT NULL");
  return rows.filter((row) => isUnitSwitchSuspension(row.suspended_at));
}

async function resumedOtherCards(db: DatabaseExecutor, unit: Unit): Promise<StudyCardRow[]> {
  const rows = await unitCards(db, reviewsPages(unit), "suspended_at IS NULL AND buried_until IS NOT NULL");
  return rows.filter(isUnitSwitchResume);
}

async function undoLosingSwitch(db: DatabaseExecutor, unit: Unit, now: Date): Promise<void> {
  for (const row of await markedActiveCards(db, unit)) {
    await putCardRow(db, resumedFromUnitSwitch(row, laterThanAll(now, [row.updated_at])));
  }
  for (const row of await resumedOtherCards(db, unit)) {
    await setAsideForUnitSwitch(db, row, laterThanAll(now, [row.updated_at]));
  }
}

export async function unitReconcileNeeded(db: DatabaseExecutor): Promise<boolean> {
  const plan = await readHifzPlan(db);
  if (!plan) return false;
  const applied = await readAppliedUnit(db);
  if (applied === null || reviewsPages(applied) !== reviewsPages(plan.unit)) return true;
  if ((await markedActiveCards(db, plan.unit)).length > 0) return true;
  return (await resumedOtherCards(db, plan.unit)).length > 0;
}

export async function reconcileUnitAfterSync(db: DatabaseExecutor, now: Date): Promise<void> {
  const plan = await readHifzPlan(db);
  if (!plan) return;
  const applied = await readAppliedUnit(db);
  if (applied === null) {
    await writeAppliedUnit(db, plan.unit, now);
  } else if (reviewsPages(applied) !== reviewsPages(plan.unit)) {
    await applyUnitSwitch(db, { unit: plan.unit, previousPlanUnit: applied, now });
  }
  await undoLosingSwitch(db, plan.unit, now);
}

export async function markUnitAppliedFromPlan(db: DatabaseExecutor, now: Date): Promise<void> {
  const plan = await readHifzPlan(db);
  if (!plan) {
    await db.runAsync("DELETE FROM user_settings WHERE key = ?", [APPLIED_UNIT_KEY]);
    return;
  }
  await writeAppliedUnit(db, plan.unit, now);
  await undoLosingSwitch(db, plan.unit, now);
}
