import { z } from "zod";

// Remote leaderboard and public-stats rows. Nulls keep their existing fallbacks, but a wrong type
// is rejected so the screen shows its error state instead of undefined, NaN or a wrong streak, and
// the account's own stats are never derived from it.
const count = z
  .number()
  .finite()
  .nullish()
  .transform((value) => value ?? 0);
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? null);
const profileEmbed = z
  .object({ username: z.string().nullish(), display_name: z.string().nullish(), avatar_url: z.string().nullish() })
  .nullish();

const reviewStatsRow = z.object({
  total_reviews: count,
  active_days: count,
  current_streak: count,
  longest_streak: count,
  last_review_date: optionalText,
});
const reviewActivityRow = z.object({ date: z.string(), reviews_count: count });
const dailyScoreSummaryRow = z.object({
  date: z.string(),
  score: z.number().finite().nullable(),
  reviews_count: z.number().finite().nullable(),
});
const streakRow = z.object({ user_id: z.string(), date: z.string(), profiles: profileEmbed });
const surahProgressRow = z.object({ surah: z.number().int(), total_cards: count, memorized_cards: count });
const achievementUnlockRow = z.object({
  achievement_id: z.string(),
  unlocked_at: z.string(),
  public_payload: z.unknown(),
});

const list = <T extends z.ZodTypeAny>(row: T) =>
  z
    .array(row)
    .nullish()
    .transform((rows) => rows ?? []);

export const parseReviewStatsRow = (input: unknown) => reviewStatsRow.nullish().parse(input) ?? null;
export const parseReviewActivityRows = (input: unknown) => list(reviewActivityRow).parse(input);
export const parseDailyScoreSummaryRows = (input: unknown) => list(dailyScoreSummaryRow).parse(input);
export const parseStreakRows = (input: unknown) => list(streakRow).parse(input);
export const parseSurahProgressRows = (input: unknown) => list(surahProgressRow).parse(input);
export const parseAchievementUnlockRows = (input: unknown) => list(achievementUnlockRow).parse(input);
