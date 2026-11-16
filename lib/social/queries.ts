import type { BoardInputs } from "@/lib/board/api";
import type { DatabaseExecutor } from "@/lib/database/types";
import { localDateOf } from "@/lib/habit/dates";
import { effectiveWeekStart, readHabitSettings } from "@/lib/habit/settings";
import { isMemorized, loadPageCards } from "@/lib/hifz/pages";
import { DEFAULT_HIFZ_PLAN, parseHifzPlan } from "@/lib/hifz/plan";
import {
  deviceUtcOffsetMinutes,
  memorizedPagesFromCards,
  newPagesPerDay,
  socialBands,
  type SocialBands,
} from "@/lib/social/bands";

async function countMemorizedAyahCards(db: DatabaseExecutor): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT count(*) AS count FROM study_cards
      WHERE deleted_at IS NULL
        AND (reps > 0 OR last_review IS NOT NULL)
        AND id GLOB '[0-9]*:[0-9]*' AND id NOT GLOB '*[^0-9:]*' AND id NOT GLOB '*:*:*'`,
  );
  return row?.count ?? 0;
}

export async function readLocalSocialBands(db: DatabaseExecutor, at: Date = new Date()): Promise<SocialBands> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = 'hifz_plan' AND deleted_at IS NULL",
  );
  const plan = parseHifzPlan(row?.value);
  const [pageCards, memorizedAyahCards] = await Promise.all([
    loadPageCards(db, { today: localDateOf(at), plan: plan ?? DEFAULT_HIFZ_PLAN }),
    countMemorizedAyahCards(db),
  ]);
  return socialBands({
    memorizedPages: memorizedPagesFromCards({
      memorizedPageCards: pageCards.filter(isMemorized).length,
      memorizedAyahCards,
    }),
    newPerDayPages: newPagesPerDay(plan),
    utcOffsetMinutes: deviceUtcOffsetMinutes(at),
  });
}

export async function readLocalBoardInputs(
  db: DatabaseExecutor,
  language: "en" | "ar",
  at: Date = new Date(),
): Promise<BoardInputs> {
  const [bands, settings] = await Promise.all([readLocalSocialBands(db, at), readHabitSettings(db)]);
  return { bands, weekStart: effectiveWeekStart(settings, language) };
}
