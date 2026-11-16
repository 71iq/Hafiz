import { parseJsonRecord as parsePayload } from "@/lib/serialization/json-record";
import { parseAchievementUnlockRows, parsePublicProfileRow, parseSurahProgressRows } from "@/lib/leaderboard/rows";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { AchievementUnlock } from "@/lib/achievements/types";

export type PublicProfile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  country: string | null;
};

export type PublicSurahProgressRow = {
  surah: number;
  totalCards: number;
  memorized: number;
};

const PROFILE_COLUMNS = "id, username, display_name, avatar_url, bio, country";

export async function fetchPublicProfile(userId: string): Promise<PublicProfile | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();

  if (error && isMissingOptionalProfileColumnError(error)) {
    const fallback = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .eq("id", userId)
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    const row = parsePublicProfileRow(fallback.data);
    return row ? { ...row, bio: null, country: null } : null;
  }

  if (error) throw error;
  return parsePublicProfileRow(data);
}

export async function fetchPublicAchievementUnlocks(userId: string): Promise<AchievementUnlock[]> {
  if (!isSupabaseConfigured() || !userId) return [];

  const { data, error } = await supabase
    .from("achievement_unlocks")
    .select("achievement_id, unlocked_at, public_payload")
    .eq("user_id", userId)
    .order("unlocked_at", { ascending: false });

  if (error) throw error;
  return parseAchievementUnlockRows(data).map((row) => ({
    achievementId: row.achievement_id,
    unlockedAt: row.unlocked_at,
    seenAt: row.unlocked_at,
    localPayload: {},
    publicPayload: parsePayload(row.public_payload),
  }));
}

export async function fetchPublicSurahProgress(userId: string): Promise<PublicSurahProgressRow[]> {
  if (!isSupabaseConfigured() || !userId) return [];

  const { data, error } = await supabase
    .from("public_surah_progress")
    .select("surah, total_cards, memorized_cards")
    .eq("user_id", userId)
    .order("surah", { ascending: true });

  if (error) throw error;
  return parseSurahProgressRows(data).map((row) => ({
    surah: row.surah,
    totalCards: row.total_cards,
    memorized: row.memorized_cards,
  }));
}

function isMissingOptionalProfileColumnError(
  error: { code?: string; message?: string; details?: string } | null,
): boolean {
  const message = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  const referencesOptionalColumn = message.includes("bio") || message.includes("country");
  return (
    referencesOptionalColumn &&
    (message.includes("column") || message.includes("schema") || message.includes("pgrst204"))
  );
}
