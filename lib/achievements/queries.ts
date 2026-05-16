import type { SQLiteDatabase } from "expo-sqlite";
import { enqueueSync } from "@/lib/database/sync-queue";
import { ACHIEVEMENTS, getAchievementDefinition, type AchievementDefinition } from "./catalog";
import type { AchievementEvent, AchievementProgress, AchievementUnlock } from "./types";

type UnlockRow = {
  achievement_id: string;
  unlocked_at: string;
  seen_at: string | null;
  local_payload: string;
  public_payload: string;
};

type ProgressRow = {
  achievement_id: string;
  current_value: number;
  target_value: number;
  payload: string;
};

export type AchievementDashboardItem = AchievementDefinition & {
  unlockedAt: string | null;
  seenAt: string | null;
  localPayload: Record<string, unknown>;
  publicPayload: Record<string, unknown>;
  progress: AchievementProgress | null;
};

export type AchievementDashboard = {
  items: AchievementDashboardItem[];
  unlockedCount: number;
  totalCount: number;
  recentUnlocks: AchievementUnlock[];
};

type AchievementUnlockListener = (unlock: AchievementUnlock) => void;

const listeners = new Set<AchievementUnlockListener>();

export function subscribeAchievementUnlocks(listener: AchievementUnlockListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function recordAchievementEvent(
  db: SQLiteDatabase,
  event: AchievementEvent
): Promise<void> {
  switch (event.type) {
    case "review_logged":
      await backfillReviewAchievements(db, true);
      await backfillCompletionAchievements(db, true);
      break;
    case "deck_created":
      await upsertProgress(db, "first_deck_created", 1, 1, { deckId: event.deckId });
      await unlockAchievement(db, "first_deck_created", event.createdAt, { deckId: event.deckId }, { deckId: event.deckId }, true);
      break;
    case "private_note_created":
      await backfillPrivateNoteAchievements(db, true);
      break;
    case "public_reflection_created":
      await incrementProgress(db, "public_reflections_10", 1, 10, { reflectionId: event.reflectionId });
      await incrementProgress(db, "first_public_reflection", 1, 1, { reflectionId: event.reflectionId });
      await unlockAchievement(
        db,
        "first_public_reflection",
        event.createdAt,
        { reflectionId: event.reflectionId, surah: event.surah, ayahStart: event.ayahStart, ayahEnd: event.ayahEnd },
        { surah: event.surah, ayahStart: event.ayahStart, ayahEnd: event.ayahEnd },
        true
      );
      await unlockIfProgressReached(db, "public_reflections_10", event.createdAt, true);
      break;
    case "vocab_saved":
      await backfillVocabAchievements(db, true);
      break;
    case "mutashabih_pair_reviewed":
      await upsertProgress(db, "first_mutashabih_pair", 1, 1, { pairId: event.pairId });
      await unlockAchievement(db, "first_mutashabih_pair", event.reviewedAt, { pairId: event.pairId }, { pairId: event.pairId }, true);
      break;
  }
}

export async function backfillAchievements(
  db: SQLiteDatabase,
  options: { notify?: boolean } = {}
): Promise<void> {
  const notify = options.notify ?? false;
  await backfillReviewAchievements(db, notify);
  await backfillDeckAchievements(db, notify);
  await backfillCompletionAchievements(db, notify);
  await backfillPrivateNoteAchievements(db, notify);
  await backfillReflectionAchievements(db, notify);
  await backfillVocabAchievements(db, notify);
}

export async function getAchievementDashboard(db: SQLiteDatabase): Promise<AchievementDashboard> {
  await backfillAchievements(db, { notify: false });

  const [unlockRows, progressRows, recentUnlocks] = await Promise.all([
    db.getAllAsync<UnlockRow>("SELECT * FROM achievement_unlocks"),
    db.getAllAsync<ProgressRow>("SELECT * FROM achievement_progress"),
    getRecentUnlocks(db, 5),
  ]);
  const unlockMap = new Map(unlockRows.map((row) => [row.achievement_id, row]));
  const progressMap = new Map(progressRows.map((row) => [row.achievement_id, row]));
  const activeAchievements = ACHIEVEMENTS.filter((achievement) => achievement.active);

  const items = activeAchievements.map((definition) => {
    const unlock = unlockMap.get(definition.id);
    const progress = progressMap.get(definition.id);
    return {
      ...definition,
      unlockedAt: unlock?.unlocked_at ?? null,
      seenAt: unlock?.seen_at ?? null,
      localPayload: parseJsonRecord(unlock?.local_payload),
      publicPayload: parseJsonRecord(unlock?.public_payload),
      progress: progress
        ? {
            achievementId: progress.achievement_id,
            currentValue: progress.current_value,
            targetValue: progress.target_value,
          }
        : null,
    };
  });

  return {
    items,
    unlockedCount: items.filter((item) => item.unlockedAt).length,
    totalCount: items.length,
    recentUnlocks,
  };
}

export async function getRecentUnlocks(
  db: SQLiteDatabase,
  limit: number
): Promise<AchievementUnlock[]> {
  const activeIds = new Set(ACHIEVEMENTS.filter((achievement) => achievement.active).map((achievement) => achievement.id));
  const rows = await db.getAllAsync<UnlockRow>(
    "SELECT * FROM achievement_unlocks ORDER BY unlocked_at DESC LIMIT ?",
    [Math.max(limit * 2, limit)]
  );
  return rows
    .filter((row) => activeIds.has(row.achievement_id))
    .slice(0, limit)
    .map(rowToUnlock);
}

export async function getLatestUnseenUnlock(db: SQLiteDatabase): Promise<AchievementUnlock | null> {
  const activeIds = new Set(ACHIEVEMENTS.filter((achievement) => achievement.active).map((achievement) => achievement.id));
  const rows = await db.getAllAsync<UnlockRow>(
    "SELECT * FROM achievement_unlocks WHERE seen_at IS NULL ORDER BY unlocked_at DESC LIMIT 10"
  );
  const row = rows.find((candidate) => activeIds.has(candidate.achievement_id));
  return row ? rowToUnlock(row) : null;
}

export async function markAchievementSeen(
  db: SQLiteDatabase,
  achievementId: string
): Promise<void> {
  await db.runAsync(
    "UPDATE achievement_unlocks SET seen_at = COALESCE(seen_at, ?) WHERE achievement_id = ?",
    [new Date().toISOString(), achievementId]
  );
}

export async function insertRemoteAchievementUnlock(
  db: SQLiteDatabase,
  row: { achievement_id: string; unlocked_at: string; public_payload?: unknown }
): Promise<void> {
  const publicPayload = parseJsonRecord(row.public_payload);
  await db.runAsync(
    `INSERT OR IGNORE INTO achievement_unlocks
      (achievement_id, unlocked_at, seen_at, local_payload, public_payload, sync_status)
     VALUES (?, ?, ?, '{}', ?, 'synced')`,
    [row.achievement_id, row.unlocked_at, row.unlocked_at, JSON.stringify(publicPayload)]
  );
}

async function backfillReviewAchievements(db: SQLiteDatabase, notify: boolean): Promise<void> {
  const totalRow = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM study_log");
  const total = totalRow?.count ?? 0;
  await upsertProgress(db, "first_review", Math.min(total, 1), 1);
  await upsertProgress(db, "first_ayah_reviewed", 0, 1);
  for (const target of [100, 500, 1000, 5000]) {
    await upsertProgress(db, `reviews_${target}`, total, target);
  }
  if (total > 0) {
    const first = await db.getFirstAsync<{ reviewed_at: string }>(
      "SELECT reviewed_at FROM study_log ORDER BY reviewed_at ASC LIMIT 1"
    );
    await unlockAchievement(db, "first_review", first?.reviewed_at ?? new Date().toISOString(), { reviews: total }, { reviews: total }, notify);
  }
  for (const target of [100, 500, 1000, 5000]) {
    if (total >= target) {
      const row = await db.getFirstAsync<{ reviewed_at: string }>(
        "SELECT reviewed_at FROM study_log ORDER BY reviewed_at ASC LIMIT 1 OFFSET ?",
        [target - 1]
      );
      await unlockAchievement(db, `reviews_${target}`, row?.reviewed_at ?? new Date().toISOString(), { reviews: total }, { reviews: target }, notify);
    }
  }

  const firstAyah = await db.getFirstAsync<{ card_id: string; reviewed_at: string }>(
    "SELECT card_id, reviewed_at FROM study_log WHERE card_id NOT LIKE 'word:%' ORDER BY reviewed_at ASC LIMIT 1"
  );
  if (firstAyah) {
    await upsertProgress(db, "first_ayah_reviewed", 1, 1, { cardId: firstAyah.card_id });
    await unlockAchievement(db, "first_ayah_reviewed", firstAyah.reviewed_at, { cardId: firstAyah.card_id }, { cardId: firstAyah.card_id }, notify);
  }

  const reviewRows = await db.getAllAsync<{ reviewed_at: string }>(
    "SELECT reviewed_at FROM study_log ORDER BY reviewed_at ASC"
  );
  const longestStreak = calculateLongestStreak([...buildLocalReviewCounts(reviewRows).keys()].sort());
  for (const target of [3, 7, 30, 100]) {
    await upsertProgress(db, `streak_${target}`, longestStreak, target);
    if (longestStreak >= target) {
      await unlockAchievement(db, `streak_${target}`, new Date().toISOString(), { streak: longestStreak }, { streak: target }, notify);
    }
  }

  const longestAyah = await db.getFirstAsync<{ surah: number; ayah: number; word_count: number }>(
    `SELECT surah, ayah, COUNT(*) as word_count
     FROM word_roots
     GROUP BY surah, ayah
     ORDER BY word_count DESC, surah ASC, ayah ASC
     LIMIT 1`
  );
  if (longestAyah) {
    const cardId = `${longestAyah.surah}:${longestAyah.ayah}`;
    const reviewed = await db.getFirstAsync<{ reviewed_at: string }>(
      "SELECT reviewed_at FROM study_log WHERE card_id = ? ORDER BY reviewed_at ASC LIMIT 1",
      [cardId]
    );
    await upsertProgress(db, "longest_ayah_reviewed", reviewed ? 1 : 0, 1, longestAyah);
    if (reviewed) {
      await unlockAchievement(db, "longest_ayah_reviewed", reviewed.reviewed_at, longestAyah, longestAyah, notify);
    }
  }
}

async function backfillDeckAchievements(db: SQLiteDatabase, notify: boolean): Promise<void> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    "SELECT key, value FROM user_settings WHERE key LIKE 'deck_%' AND key != 'deck_meanings'"
  );
  await upsertProgress(db, "first_deck_created", rows.length > 0 ? 1 : 0, 1);
  if (rows.length === 0) return;
  const decks = rows
    .map((row) => parseJsonRecord(row.value))
    .filter((deck) => typeof deck.id === "string")
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  const first = decks[0];
  await unlockAchievement(
    db,
    "first_deck_created",
    String(first?.createdAt ?? new Date().toISOString()),
    { deckId: first?.id },
    { deckId: first?.id },
    notify
  );
}

async function backfillCompletionAchievements(db: SQLiteDatabase, notify: boolean): Promise<void> {
  const surahRows = await db.getAllAsync<{ surah: number; total: number; mastered: number }>(
    `SELECT
       qt.surah as surah,
       COUNT(*) as total,
       SUM(CASE WHEN sc.state = 2 THEN 1 ELSE 0 END) as mastered
     FROM quran_text qt
     LEFT JOIN study_cards sc ON sc.id = CAST(qt.surah AS TEXT) || ':' || CAST(qt.ayah AS TEXT)
     GROUP BY qt.surah
     ORDER BY qt.surah`
  );
  const completedSurahs = surahRows.filter((row) => row.total > 0 && row.mastered >= row.total);
  const maxSurahPct = surahRows.reduce((max, row) => {
    if (row.total <= 0) return max;
    return Math.max(max, Math.round((row.mastered / row.total) * 100));
  }, 0);
  await upsertProgress(db, "first_surah_completed", completedSurahs.length > 0 ? 1 : 0, 1, { bestPercent: maxSurahPct });
  if (completedSurahs.length > 0) {
    const first = completedSurahs[0];
    await unlockAchievement(db, "first_surah_completed", new Date().toISOString(), { surah: first.surah }, { surah: first.surah }, notify);
  }

  const juzRows = await db.getAllAsync<{ juz: number; total: number; mastered: number }>(
    `SELECT
       jm.juz as juz,
       COUNT(qt.ayah) as total,
       SUM(CASE WHEN sc.state = 2 THEN 1 ELSE 0 END) as mastered
     FROM juz_map jm
     JOIN quran_text qt ON qt.surah = jm.surah AND qt.ayah BETWEEN jm.ayah_start AND jm.ayah_end
     LEFT JOIN study_cards sc ON sc.id = CAST(qt.surah AS TEXT) || ':' || CAST(qt.ayah AS TEXT)
     GROUP BY jm.juz
     ORDER BY jm.juz`
  );
  const completedJuz = juzRows.filter((row) => row.total > 0 && row.mastered >= row.total);
  await upsertProgress(db, "first_juz_completed", completedJuz.length > 0 ? 1 : 0, 1);
  if (completedJuz.length > 0) {
    await unlockAchievement(db, "first_juz_completed", new Date().toISOString(), { juz: completedJuz[0].juz }, { juz: completedJuz[0].juz }, notify);
  }

  const completedJuzSet = new Set(completedJuz.map((row) => row.juz));
  for (const row of juzRows) {
    const id = `juz_${String(row.juz).padStart(2, "0")}_completed`;
    const done = completedJuzSet.has(row.juz);
    await upsertProgress(db, id, done ? 1 : 0, 1, { juz: row.juz, mastered: row.mastered, total: row.total });
    if (done) {
      await unlockAchievement(db, id, new Date().toISOString(), { juz: row.juz }, { juz: row.juz }, notify);
    }
  }

  for (const [id, target] of [
    ["five_juz_completed", 5],
    ["ten_juz_completed", 10],
    ["quran_complete", 30],
  ] as const) {
    await upsertProgress(db, id, completedJuz.length, target);
    if (completedJuz.length >= target) {
      await unlockAchievement(db, id, new Date().toISOString(), { completedJuz: completedJuz.length }, { completedJuz: target }, notify);
    }
  }
}

async function backfillPrivateNoteAchievements(db: SQLiteDatabase, notify: boolean): Promise<void> {
  const countRow = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM private_notes WHERE deleted_at IS NULL"
  );
  const count = countRow?.count ?? 0;
  await upsertProgress(db, "first_private_note", Math.min(count, 1), 1);
  await upsertProgress(db, "private_notes_10", count, 10);
  if (count > 0) {
    const first = await db.getFirstAsync<{ id: string; created_at: string; surah: number; ayah_start: number; ayah_end: number }>(
      "SELECT id, created_at, surah, ayah_start, ayah_end FROM private_notes WHERE deleted_at IS NULL ORDER BY created_at ASC LIMIT 1"
    );
    await unlockAchievement(
      db,
      "first_private_note",
      first?.created_at ?? new Date().toISOString(),
      { noteId: first?.id, surah: first?.surah, ayahStart: first?.ayah_start, ayahEnd: first?.ayah_end },
      {},
      notify
    );
  }
  if (count >= 10) {
    const tenth = await db.getFirstAsync<{ created_at: string }>(
      "SELECT created_at FROM private_notes WHERE deleted_at IS NULL ORDER BY created_at ASC LIMIT 1 OFFSET 9"
    );
    await unlockAchievement(db, "private_notes_10", tenth?.created_at ?? new Date().toISOString(), { count }, {}, notify);
  }
}

async function backfillReflectionAchievements(db: SQLiteDatabase, notify: boolean): Promise<void> {
  const first = await db.getFirstAsync<ProgressRow>(
    "SELECT * FROM achievement_progress WHERE achievement_id = 'first_public_reflection'"
  );
  const count = await db.getFirstAsync<ProgressRow>(
    "SELECT * FROM achievement_progress WHERE achievement_id = 'public_reflections_10'"
  );
  await upsertProgress(db, "first_public_reflection", first?.current_value ?? 0, 1);
  await upsertProgress(db, "public_reflections_10", count?.current_value ?? 0, 10);
  if ((first?.current_value ?? 0) >= 1) {
    await unlockAchievement(db, "first_public_reflection", new Date().toISOString(), parseJsonRecord(first?.payload), parseJsonRecord(first?.payload), notify);
  }
  if ((count?.current_value ?? 0) >= 10) {
    await unlockAchievement(db, "public_reflections_10", new Date().toISOString(), parseJsonRecord(count?.payload), { reflections: 10 }, notify);
  }
}

async function backfillVocabAchievements(db: SQLiteDatabase, notify: boolean): Promise<void> {
  const countRow = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM study_cards WHERE id LIKE 'word:%'"
  );
  const count = countRow?.count ?? 0;
  await upsertProgress(db, "first_vocab_saved", Math.min(count, 1), 1);
  if (count > 0) {
    const first = await db.getFirstAsync<{ id: string; created_at: string }>(
      "SELECT id, created_at FROM study_cards WHERE id LIKE 'word:%' ORDER BY created_at ASC LIMIT 1"
    );
    await unlockAchievement(db, "first_vocab_saved", first?.created_at ?? new Date().toISOString(), { cardId: first?.id }, { cardId: first?.id }, notify);
  }
}

async function upsertProgress(
  db: SQLiteDatabase,
  achievementId: string,
  currentValue: number,
  targetValue: number,
  payload: Record<string, unknown> = {}
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO achievement_progress
      (achievement_id, current_value, target_value, updated_at, payload)
     VALUES (?, ?, ?, ?, ?)`,
    [achievementId, Math.max(0, Math.floor(currentValue)), targetValue, new Date().toISOString(), JSON.stringify(payload)]
  );
}

async function incrementProgress(
  db: SQLiteDatabase,
  achievementId: string,
  delta: number,
  targetValue: number,
  payload: Record<string, unknown>
): Promise<void> {
  const row = await db.getFirstAsync<ProgressRow>(
    "SELECT * FROM achievement_progress WHERE achievement_id = ?",
    [achievementId]
  );
  await upsertProgress(db, achievementId, (row?.current_value ?? 0) + delta, targetValue, payload);
}

async function unlockIfProgressReached(
  db: SQLiteDatabase,
  achievementId: string,
  unlockedAt: string,
  notify: boolean
): Promise<void> {
  const row = await db.getFirstAsync<ProgressRow>(
    "SELECT * FROM achievement_progress WHERE achievement_id = ?",
    [achievementId]
  );
  if (!row || row.current_value < row.target_value) return;
  await unlockAchievement(db, achievementId, unlockedAt, parseJsonRecord(row.payload), { count: row.target_value }, notify);
}

async function unlockAchievement(
  db: SQLiteDatabase,
  achievementId: string,
  unlockedAt: string,
  localPayload: Record<string, unknown> = {},
  publicPayload: Record<string, unknown> = {},
  notify: boolean
): Promise<void> {
  const definition = getAchievementDefinition(achievementId);
  if (!definition) return;

  const storedPublicPayload = definition.payloadPolicy.public === "none" ? {} : publicPayload;
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO achievement_unlocks
      (achievement_id, unlocked_at, seen_at, local_payload, public_payload, sync_status)
     VALUES (?, ?, NULL, ?, ?, 'pending')`,
    [achievementId, unlockedAt, JSON.stringify(localPayload), JSON.stringify(storedPublicPayload)]
  );
  if ((result.changes ?? 0) <= 0) return;

  enqueueSync(db, "achievement_unlocks", "INSERT", achievementId, {
    achievement_id: achievementId,
    unlocked_at: unlockedAt,
    public_payload: storedPublicPayload,
  }).catch(console.warn);

  if (notify) {
    const unlock: AchievementUnlock = {
      achievementId,
      unlockedAt,
      seenAt: null,
      localPayload,
      publicPayload: storedPublicPayload,
    };
    for (const listener of listeners) listener(unlock);
  }
}

function rowToUnlock(row: UnlockRow): AchievementUnlock {
  return {
    achievementId: row.achievement_id,
    unlockedAt: row.unlocked_at,
    seenAt: row.seen_at,
    localPayload: parseJsonRecord(row.local_payload),
    publicPayload: parseJsonRecord(row.public_payload),
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function buildLocalReviewCounts(rows: { reviewed_at: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const reviewedAt = new Date(row.reviewed_at);
    if (Number.isNaN(reviewedAt.getTime())) continue;
    const key = formatLocalDateKey(reviewedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayIndexFromDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.floor(new Date(year, (month || 1) - 1, day || 1).getTime() / 86400000);
}

function calculateLongestStreak(dateKeys: string[]): number {
  let maxStreak = 0;
  let runStreak = 0;
  let prevIndex: number | null = null;

  for (const dateKey of dateKeys) {
    const dayIndex = dayIndexFromDateKey(dateKey);
    runStreak = prevIndex !== null && dayIndex - prevIndex === 1 ? runStreak + 1 : 1;
    maxStreak = Math.max(maxStreak, runStreak);
    prevIndex = dayIndex;
  }

  return maxStreak;
}
