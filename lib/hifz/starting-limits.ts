import type { DatabaseExecutor } from "@/lib/database/types";
import { putDeckReviewSettings, readDeckReviewSettings } from "@/lib/fsrs/queries";
import { SMART_DECK_IDS, type SmartDeckId } from "@/lib/fsrs/smart-decks";
import {
  DECK_DAILY_REVIEW_LIMIT_STEP,
  DECK_NEW_CARD_LIMIT_STEP,
  MIN_DECK_DAILY_REVIEW_LIMIT,
  MIN_DECK_NEW_CARD_LIMIT,
} from "@/lib/fsrs/types";
import type { HifzPlan } from "@/lib/hifz/plan";

export type StartingDeckLimit = Readonly<{ newCardsLimit: number; dailyReviewLimit: number }>;

type Tier = Readonly<{
  retentionNew: number;
  mutashabihatNew: number;
  similarTailsNew: number;
  dailyReviewLimit: number;
}>;

// Starting numbers by daily minutes. Qira'at and asbab start with no new cards; the person raises
// them in the deck settings when they want them.
const SHORT: Tier = { retentionNew: 5, mutashabihatNew: 0, similarTailsNew: 0, dailyReviewLimit: 10 };
const MEDIUM: Tier = { retentionNew: 10, mutashabihatNew: 5, similarTailsNew: 0, dailyReviewLimit: 20 };
const LONG: Tier = { retentionNew: 15, mutashabihatNew: 5, similarTailsNew: 5, dailyReviewLimit: 30 };

function onStep(value: number, step: number, min: number): number {
  return Math.max(min, Math.round(value / step) * step);
}

/**
 * The smart decks' daily limits for a first setup, from the minutes a day the chosen pace allows
 * (issue 14). With the defaults of 20 new and 20 cards in each of five decks, day one offered 70 to
 * 90 cards whatever the pace. Values stay on the settings steppers' steps and above their minimums.
 */
export function startingDeckLimits(
  plan: Pick<HifzPlan, "dailyBudgetMin">,
): Readonly<Record<SmartDeckId, StartingDeckLimit>> {
  const tier = plan.dailyBudgetMin <= 10 ? SHORT : plan.dailyBudgetMin <= 30 ? MEDIUM : LONG;
  const daily = onStep(tier.dailyReviewLimit, DECK_DAILY_REVIEW_LIMIT_STEP, MIN_DECK_DAILY_REVIEW_LIMIT);
  const limit = (newCards: number): StartingDeckLimit => ({
    newCardsLimit: onStep(newCards, DECK_NEW_CARD_LIMIT_STEP, MIN_DECK_NEW_CARD_LIMIT),
    dailyReviewLimit: daily,
  });
  return {
    [SMART_DECK_IDS.retention]: limit(tier.retentionNew),
    [SMART_DECK_IDS.mutashabihat]: limit(tier.mutashabihatNew),
    [SMART_DECK_IDS.similarTails]: limit(tier.similarTailsNew),
    [SMART_DECK_IDS.qiraat]: limit(0),
    [SMART_DECK_IDS.reasonsOfRevelation]: limit(0),
  };
}

/**
 * Write the starting limits on a true first setup only: no earlier plan, no review ever logged, and
 * per deck no stored review settings, which the person or a sync wrote. Plan edits, existing users
 * and restored or synced settings keep their limits, and no card changes. Runs in the setup
 * transaction before the unit switch, so page review records the pace's ayah limit. The settings
 * sync through user_settings like any other deck setting.
 */
export async function writeStartingDeckLimits(
  db: DatabaseExecutor,
  { plan, hadPlan }: { plan: Pick<HifzPlan, "dailyBudgetMin">; hadPlan: boolean },
): Promise<void> {
  if (hadPlan) return;
  if (await db.getFirstAsync("SELECT 1 FROM study_log LIMIT 1")) return;
  for (const [deckId, limits] of Object.entries(startingDeckLimits(plan))) {
    const stored = await db.getFirstAsync("SELECT 1 FROM user_settings WHERE key = ?", [`review_settings_${deckId}`]);
    if (stored) continue;
    await putDeckReviewSettings(db, deckId, { ...(await readDeckReviewSettings(db, deckId)), ...limits });
  }
}
