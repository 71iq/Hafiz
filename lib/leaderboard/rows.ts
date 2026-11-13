import { z } from "zod";

// Remote profile rows. Nulls keep their existing fallbacks, but a wrong type is rejected so the screen
// shows its error state instead of undefined or NaN.
const count = z
  .number()
  .finite()
  .nullish()
  .transform((value) => value ?? 0);
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const publicProfileRow = z.object({
  id: z.string(),
  username: z.string(),
  display_name: optionalText,
  avatar_url: optionalText,
  bio: optionalText,
  country: optionalText,
});
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

export const parsePublicProfileRow = (input: unknown) => publicProfileRow.nullish().parse(input) ?? null;
export const parseSurahProgressRows = (input: unknown) => list(surahProgressRow).parse(input);
export const parseAchievementUnlockRows = (input: unknown) => list(achievementUnlockRow).parse(input);
