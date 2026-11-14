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
 * The live cards of one unit that match `condition`: ayah cards in the retention deck, or page,
 * half-page and seam cards in the pages deck. Weak-spot cloze cards belong to neither.
 */
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

/**
 * The cards of the plan's own unit that carry the switch mark (lib/hifz/unit-switch): ayah cards in
 * ayah review, page, half-page and seam cards in page review. Only a switch writes the mark, so these
 * came from another device's switch to the other unit whose plan did not win, or a restore of cards
 * left that way. A card the person suspended has a real time and is left alone.
 */
async function markedActiveCards(db: DatabaseExecutor, unit: Unit): Promise<StudyCardRow[]> {
  const rows = await unitCards(db, !reviewsPages(unit), "suspended_at IS NOT NULL");
  return rows.filter((row) => isUnitSwitchSuspension(row.suspended_at));
}

/**
 * The other unit's cards that carry the resume mark: active because a switch to that unit brought
 * them back, which can only be another device's switch whose plan did not win, or a restore of cards
 * left that way. A card the person resumed by hand carries no mark and is left alone.
 */
async function resumedOtherCards(db: DatabaseExecutor, unit: Unit): Promise<StudyCardRow[]> {
  const rows = await unitCards(db, reviewsPages(unit), "suspended_at IS NULL AND buried_until IS NOT NULL");
  return rows.filter(isUnitSwitchResume);
}

/**
 * Undoes another device's losing switch: brings back the plan's own cards it set aside, and sets
 * aside again the other unit's cards it brought back (see markedActiveCards and resumedOtherCards).
 */
async function undoLosingSwitch(db: DatabaseExecutor, unit: Unit, now: Date): Promise<void> {
  for (const row of await markedActiveCards(db, unit)) {
    await putCardRow(db, resumedFromUnitSwitch(row, laterThanAll(now, [row.updated_at])));
  }
  for (const row of await resumedOtherCards(db, unit)) {
    await setAsideForUnitSwitch(db, row, laterThanAll(now, [row.updated_at]));
  }
}

/** Whether reconcileUnitAfterSync has anything to do, read without writing, so a sync opens no transaction for it otherwise. */
export async function unitReconcileNeeded(db: DatabaseExecutor): Promise<boolean> {
  const plan = await readHifzPlan(db);
  if (!plan) return false;
  const applied = await readAppliedUnit(db);
  if (applied === null || reviewsPages(applied) !== reviewsPages(plan.unit)) return true;
  if ((await markedActiveCards(db, plan.unit)).length > 0) return true;
  return (await resumedOtherCards(db, plan.unit)).length > 0;
}

/**
 * After sync, the cards here follow the winning plan's unit (7.6). When the cards were last set for
 * the other kind of review, the switch runs. Whatever was applied here, no card keeps the marks of a
 * switch to the other unit: another device may have switched and lost to a later plan edit, and its
 * pulled rows would otherwise disable the winning unit's cards and leave the other unit's active, so
 * both kinds of review would show. The device that fixes them uploads the result. Does nothing
 * without a plan.
 */
export async function reconcileUnitAfterSync(db: DatabaseExecutor, now: Date): Promise<void> {
  const plan = await readHifzPlan(db);
  if (!plan) return;
  const applied = await readAppliedUnit(db);
  if (applied === null) {
    // No record yet: the cards were set under this plan by this app version or before it.
    await writeAppliedUnit(db, plan.unit, now);
  } else if (reviewsPages(applied) !== reviewsPages(plan.unit)) {
    await applyUnitSwitch(db, { unit: plan.unit, previousPlanUnit: applied, now });
  }
  await undoLosingSwitch(db, plan.unit, now);
}

/**
 * After an account restore the cards come from the server as the plan left them, the plan's own cards
 * active and the other unit's set aside.
 */
export async function markUnitAppliedFromPlan(db: DatabaseExecutor, now: Date): Promise<void> {
  const plan = await readHifzPlan(db);
  if (!plan) {
    await db.runAsync("DELETE FROM user_settings WHERE key = ?", [APPLIED_UNIT_KEY]);
    return;
  }
  await writeAppliedUnit(db, plan.unit, now);
  await undoLosingSwitch(db, plan.unit, now);
}
