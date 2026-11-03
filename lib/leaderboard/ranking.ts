import { z } from "zod";

const dailyScoreRowSchema = z.object({
  user_id: z.string(),
  score: z
    .number()
    .finite()
    .nullable()
    .transform((score) => score ?? 0),
  profiles: z
    .object({
      username: z.string().nullish(),
      display_name: z.string().nullish(),
      avatar_url: z.string().nullish(),
    })
    .nullish(),
});

export function rankDailyScores({ rows: input }: { rows: unknown }) {
  const rows = z.array(dailyScoreRowSchema).parse(input);
  const userMap = new Map<
    string,
    { username: string; display_name: string | null; avatar_url: string | null; score: number }
  >();
  for (const row of rows) {
    const existing = userMap.get(row.user_id);
    if (existing) {
      existing.score += row.score;
    } else {
      userMap.set(row.user_id, {
        username: row.profiles?.username ?? "unknown",
        display_name: row.profiles?.display_name ?? null,
        avatar_url: row.profiles?.avatar_url ?? null,
        score: row.score,
      });
    }
  }

  return Array.from(userMap.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 50)
    .map(([user_id, info], i) => ({
      user_id,
      username: info.username,
      display_name: info.display_name,
      avatar_url: info.avatar_url,
      score: info.score,
      rank: i + 1,
    }));
}
