import { type SQLiteDatabase } from "expo-sqlite";
import { supabase } from "./supabase";
import {
  getUnsyncedEntries,
  markAsSynced,
  upsertFromRemote,
  type StudyLogEntry,
} from "../db/database";

export async function syncStudyLog(
  db: SQLiteDatabase,
  userId: string
): Promise<void> {
  // 1. Push unsynced local entries to Supabase
  const unsynced = await getUnsyncedEntries(db);
  if (unsynced.length > 0) {
    const rows = unsynced.map((e) => ({
      user_id: userId,
      surah: e.surah,
      ayah: e.ayah,
      interval: e.interval,
      repetitions: e.repetitions,
      ease_factor: e.ease_factor,
      next_review_date: e.next_review_date,
      last_review_date: e.last_review_date,
      updated_at: e.updated_at || new Date().toISOString(),
    }));

    const { error: pushError } = await supabase
      .from("study_log")
      .upsert(rows, { onConflict: "user_id,surah,ayah" });

    if (pushError) throw new Error(`Push failed: ${pushError.message}`);

    for (const e of unsynced) {
      await markAsSynced(db, e.surah, e.ayah);
    }
  }

  // 2. Pull all remote entries for this user
  const { data: remote, error: pullError } = await supabase
    .from("study_log")
    .select("*")
    .eq("user_id", userId);

  if (pullError) throw new Error(`Pull failed: ${pullError.message}`);

  if (remote) {
    for (const r of remote) {
      const entry: StudyLogEntry = {
        surah: r.surah,
        ayah: r.ayah,
        interval: r.interval,
        repetitions: r.repetitions,
        ease_factor: r.ease_factor,
        next_review_date: r.next_review_date,
        last_review_date: r.last_review_date,
        updated_at: r.updated_at,
      };
      await upsertFromRemote(db, entry);
    }
  }

  // 3. Recalculate remote score and streak
  await supabase.rpc("recalc_score", { uid: userId });
  await supabase.rpc("update_streak", { uid: userId });
}
