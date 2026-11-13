import type { AppDatabase } from "@/lib/database/types";
import { getMemorizedAyahCardCount } from "@/lib/fsrs/queries";
import { deviceUtcOffsetMinutes, newPerDayFromPlan, socialBands, type SocialBands } from "@/lib/social/bands";

/** This device's matching bands, from the local plan and memorized cards (8.13). */
export async function readLocalSocialBands(db: AppDatabase, at: Date = new Date()): Promise<SocialBands> {
  const [memorizedAyahs, plan] = await Promise.all([
    getMemorizedAyahCardCount(db),
    db.getFirstAsync<{ value: string }>(
      "SELECT value FROM user_settings WHERE key = 'hifz_plan' AND deleted_at IS NULL",
    ),
  ]);
  return socialBands({
    memorizedAyahs,
    newPerDayPages: newPerDayFromPlan(plan?.value),
    utcOffsetMinutes: deviceUtcOffsetMinutes(at),
  });
}
