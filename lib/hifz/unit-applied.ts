import type { DatabaseExecutor } from "@/lib/database/types";
import { readHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { reviewsPages, switchToAyahReview, switchToPageReview } from "@/lib/hifz/unit-switch";

type Unit = HifzPlan["unit"];

/**
 * The recitation unit whose card state this device last applied (7.6). Device-only: each device
 * applies a switch to its own copy of the cards, and sync brings the plan another device saved.
 */
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

/**
 * Brings the cards in line with `unit` when the cards were last set for the other kind of review
 * (pages, including half pages, against ayat), and records the unit as applied. A plan edit that
 * keeps the kind of review changes no card, so an ayah the person resumed by hand in page review
 * stays resumed. Without a record, the unit of the plan stored before stands for it; with neither,
 * as on a first setup, the switch runs. Runs inside the caller's transaction. Returns the pages made
 * from ayah cards.
 */
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

/**
 * After sync brings a plan saved on another device, the cards here follow its unit (7.6): two
 * devices that switched differently end with the winning plan's cards active on both, since the
 * device that applies the switch last uploads the result. Does nothing while the unit applied here
 * is the plan's kind of review, or without a plan.
 */
/** Whether reconcileUnitAfterSync has anything to do, read without writing, so a sync opens no transaction for it otherwise. */
export async function unitReconcileNeeded(db: DatabaseExecutor): Promise<boolean> {
  const plan = await readHifzPlan(db);
  if (!plan) return false;
  const applied = await readAppliedUnit(db);
  return applied === null || reviewsPages(applied) !== reviewsPages(plan.unit);
}

export async function reconcileUnitAfterSync(db: DatabaseExecutor, now: Date): Promise<void> {
  const plan = await readHifzPlan(db);
  if (!plan) return;
  const applied = await readAppliedUnit(db);
  if (applied !== null && reviewsPages(applied) === reviewsPages(plan.unit)) return;
  if (applied === null) {
    // No record yet: the cards were set under this plan by this app version or before it.
    await writeAppliedUnit(db, plan.unit, now);
    return;
  }
  await applyUnitSwitch(db, { unit: plan.unit, previousPlanUnit: applied, now });
}

/** After an account restore the cards come from the server as the plan left them. */
export async function markUnitAppliedFromPlan(db: DatabaseExecutor, now: Date): Promise<void> {
  const plan = await readHifzPlan(db);
  if (plan) await writeAppliedUnit(db, plan.unit, now);
  else await db.runAsync("DELETE FROM user_settings WHERE key = ?", [APPLIED_UNIT_KEY]);
}
