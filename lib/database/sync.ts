import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/lib/auth/store";
import { authCommands } from "@/lib/auth/commands";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import {
  decodeSyncPage,
  decodeSyncQueueEntry,
  decodeSyncFreshness,
  decodeSyncedStudyLogExists,
  type SyncRows,
  type SyncTable,
} from "@/lib/database/sync-payloads";
import { compareSyncTimestamps, syncTimestampKey } from "@/lib/database/sync-timestamps";
import {
  getPendingSyncEntries,
  getPendingSyncCount,
  markSynced,
  markFailed,
  cleanSyncedEntries,
  enqueueSync,
  type SyncQueueEntry,
} from "./sync-queue";
import { backfillAchievements, insertRemoteAchievementUnlock } from "@/lib/achievements/queries";
import { isSyncableUserSetting, putUserSetting, userSettingToSyncData } from "@/lib/database/user-settings";
import { errorMessage } from "@/lib/error-message";
import { applyRemoteHabitDay, habitDaySyncData } from "@/lib/habit/queries";
import { reconcileHabitDaysFromLogs } from "@/lib/habit/reconcile";
import {
  createWeakSpotCards,
  parseClozeCardId,
  removeClearedWeakSpotCards,
  removeDismissedWeakSpotCards,
  weakSpotIds,
} from "@/lib/hifz/weak-spots";
import type { HabitDayRow } from "@/lib/habit/types";
import { deviceTimeZone, localDateOf, type LocalDate } from "@/lib/habit/dates";

export type SyncStatus = "idle" | "syncing" | "synced" | "error" | "offline";

type SyncOwner = Readonly<{ userId: string; requireCurrent: () => void }>;

function captureSyncOwner(): SyncOwner | null {
  const { user, session } = useAuthStore.getState();
  if (!user) return null;
  const identity = getAuthSessionIdentity(session);
  if (identity.kind !== "identified" || identity.userId !== user.id.toLowerCase()) return null;
  const authOwner = authCommands.captureOwner();
  return {
    userId: user.id,
    requireCurrent: () => {
      if (!authOwner.isCurrent() || useAuthStore.getState().user?.id !== user.id) {
        throw new Error("Sync account changed");
      }
    },
  };
}

const INITIAL_BACKFILL_VERSION = "20260525_sync_v1";
const USER_SETTINGS_BACKFILL_VERSION = "20260528_user_settings_v1";
const ACCOUNT_RESTORE_VERSION = "20260614_account_restore_v1";
const HABIT_BACKFILL_VERSION = "20261113_habit_v1";
const REMOTE_RESTORE_TABLES = [
  "user_settings",
  "user_word_meanings",
  "study_cards",
  "study_log",
  "bookmarks",
  "highlights",
  "private_notes",
  "reflection_journey_entries",
  "achievement_unlocks",
  "habit_days",
  "review_sessions",
  "recitation_errors",
] as const;

type RemoteAccountRows = { [K in SyncTable]: SyncRows[K][] };
type AccountRestoreResult = {
  pulled: number;
  /** Data came down from the account and replaced what this device held. */
  accountRestored: boolean;
  localDataReplaced: boolean;
  /**
   * This sync finished the account's restore on this device, with or without remote data. From then
   * on the local data belongs to this account, so features that waited for it (board reporting) start.
   */
  restoreCompleted?: boolean;
};

export type SyncResult = AccountRestoreResult & {
  pushed: number;
  status: "synced" | "partial" | "failed" | "not_connected";
};

type PushResult = { pushed: number; failed: number; hadSuccessfulEntry: boolean };
type PullResult = { pulled: number; complete: boolean };

function highlightSyncId(row: {
  surah: number;
  ayah: number;
  word_start?: number | null;
  word_end?: number | null;
  color: string;
}): string {
  return `highlight:${row.surah}:${row.ayah}:${row.word_start ?? "ayah"}:${row.word_end ?? "ayah"}:${row.color}`;
}

/**
 * Process the local sync queue — push pending changes to Supabase.
 * Retains group acknowledgement counts and whether any entry completed before a failure.
 */
async function pushSyncQueue(db: AppDatabase, owner: SyncOwner): Promise<PushResult> {
  const empty = { pushed: 0, failed: 0, hadSuccessfulEntry: false };
  if (!isSupabaseConfigured()) return empty;

  owner.requireCurrent();
  const { userId } = owner;

  await enqueueInitialLocalDataForSync(db, userId);
  owner.requireCurrent();
  await enqueueSyncableUserSettingsForSync(db, userId);
  owner.requireCurrent();
  await enqueueHabitDataForSync(db, userId);
  owner.requireCurrent();

  const entries = await getPendingSyncEntries(db, 10000);
  owner.requireCurrent();
  if (entries.length === 0) return empty;

  // Group entries by table for batch operations
  const groups = groupByTable(entries);
  const syncedIds: number[] = [];
  const failedIds: number[] = [];
  let hadSuccessfulEntry = false;

  for (const tableEntries of groups.values()) {
    owner.requireCurrent();
    try {
      await pushTableEntries(tableEntries, userId, () => {
        hadSuccessfulEntry = true;
      });
      owner.requireCurrent();
      syncedIds.push(...tableEntries.map((e) => e.id));
    } catch (err) {
      owner.requireCurrent();
      console.warn("[Sync] Failed to push queued changes:", errorMessage(err));
      failedIds.push(...tableEntries.map((e) => e.id));
    }
  }

  owner.requireCurrent();
  // Mark results
  if (syncedIds.length > 0) await markSynced(db, syncedIds);
  owner.requireCurrent();
  if (failedIds.length > 0) await markFailed(db, failedIds);
  owner.requireCurrent();

  // Clean up old synced entries periodically
  await cleanSyncedEntries(db);

  return { pushed: syncedIds.length, failed: failedIds.length, hadSuccessfulEntry };
}

/**
 * Pull remote changes from Supabase to local SQLite.
 * For multi-device support: fetches data updated after last sync.
 */
async function pullRemoteChanges(db: AppDatabase, owner: SyncOwner): Promise<PullResult> {
  if (!isSupabaseConfigured()) return { pulled: 0, complete: false };

  owner.requireCurrent();
  const { userId } = owner;

  // Get last sync timestamp
  const lastSyncRow = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = 'last_pull_at'",
  );
  owner.requireCurrent();
  const lastPullAt = lastSyncRow?.value ?? PULL_EPOCH;
  const pullStartedAt = new Date().toISOString();

  let totalPulled = 0;
  let complete = false;
  const onPageApplied = (count: number) => {
    totalPulled += count;
  };
  let wordMeaningsComplete = true;

  try {
    // Pull syncable deck/review settings before cards so decks exist when rows arrive.
    await pullTable(db, "user_settings", userId, lastPullAt, upsertUserSetting, owner, onPageApplied);

    // Pull user-supplied word meanings before cards so vocabulary previews resolve.
    try {
      await pullTable(db, "user_word_meanings", userId, lastPullAt, upsertUserWordMeaning, owner, onPageApplied);
    } catch (err) {
      owner.requireCurrent();
      wordMeaningsComplete = false;
      console.warn("[Sync] Pull user_word_meanings skipped:", errorMessage(err));
    }

    // Pull study_cards. A cloze card deleted on another device is checked again once the errors are
    // in: a device missing some of a weak spot's errors can delete a card that should stay.
    const deletedClozeLocations: { surah: number; ayah: number; word: number }[] = [];
    await pullTable(
      db,
      "study_cards",
      userId,
      lastPullAt,
      async (tx, row) => {
        await upsertStudyCard(tx, row);
        const cloze = row.deleted_at ? parseClozeCardId(row.id) : null;
        if (cloze) deletedClozeLocations.push(cloze);
      },
      owner,
      onPageApplied,
    );

    // Wird days come before the review log, so reconciling pulled reviews sees the merged days.
    // Wird days merge by status precedence; sessions and errors keep the newer row. These tables are
    // newer than the shared cursor, so each account pulls them in full once: rows another device
    // uploaded before this device's last pull would otherwise never arrive.
    const habitTablesPulled = await isBackfillComplete(db, habitPullKey(userId));
    owner.requireCurrent();
    const habitSince = habitTablesPulled ? lastPullAt : PULL_EPOCH;
    await pullTable(db, "habit_days", userId, habitSince, upsertHabitDay, owner, onPageApplied);
    await pullTable(db, "review_sessions", userId, habitSince, upsertReviewSession, owner, onPageApplied);
    // ERR-06: errors from other devices can make a weak spot here, so their locations get cloze
    // cards, and a dismissal from another device can end one. Each page settles its own locations in
    // its transaction. A card is deleted only when a pulled dismissal ends a weak spot this device
    // held, never because this device has fewer of its errors than the device that made the card.
    let pageErrorLocations: ErrorLocationRow[] = [];
    let pageEndedWeakSpots: ErrorLocationRow[] = [];
    await pullTable(
      db,
      "recitation_errors",
      userId,
      habitSince,
      async (tx, row) => {
        const location = { surah: row.surah, ayah: row.ayah ?? null, word: row.word ?? null };
        const endsWeakSpot =
          row.deleted_at != null && (await isLiveRecitationError(tx, row.id)) && (await weakSpotIds(tx, [location])).size > 0;
        await upsertRecitationError(tx, row);
        pageErrorLocations.push(location);
        if (endsWeakSpot && !(await isLiveRecitationError(tx, row.id))) pageEndedWeakSpots.push(location);
      },
      owner,
      onPageApplied,
      async (tx) => {
        const [locations, ended] = [pageErrorLocations, pageEndedWeakSpots];
        pageErrorLocations = [];
        pageEndedWeakSpots = [];
        await createWeakSpotCards(tx, locations, new Date());
        await removeClearedWeakSpotCards(tx, ended);
      },
    );
    if (deletedClozeLocations.length > 0) {
      owner.requireCurrent();
      await db.withTransactionAsync(async (tx) => {
        owner.requireCurrent();
        await createWeakSpotCards(tx, deletedClozeLocations, new Date());
      });
    }

    // Pull study_log. Pulled reviews can complete a day's minimum together with this device's own
    // (or come from an older app version without wird days), so their days are reconciled after.
    const pulledReviewDates = new Set<LocalDate>();
    await pullTable(
      db,
      "study_log",
      userId,
      lastPullAt,
      async (tx, row) => {
        pulledReviewDates.add(row.local_date ?? localDateOf(new Date(row.reviewed_at)));
        if (row.makeup_for) pulledReviewDates.add(row.makeup_for);
        await upsertStudyLog(tx, row);
      },
      owner,
      onPageApplied,
    );

    // Pull bookmarks
    await pullTable(db, "bookmarks", userId, lastPullAt, upsertBookmark, owner, onPageApplied);

    // Pull highlights
    await pullTable(db, "highlights", userId, lastPullAt, upsertHighlight, owner, onPageApplied);

    // Pull private notes
    await pullTable(db, "private_notes", userId, lastPullAt, upsertPrivateNote, owner, onPageApplied);

    // Pull Reflection Journey entries
    await pullTable(
      db,
      "reflection_journey_entries",
      userId,
      lastPullAt,
      upsertReflectionJourneyEntry,
      owner,
      onPageApplied,
    );

    // Pull public badge unlocks. Pulled badges are already seen locally.
    await pullTable(db, "achievement_unlocks", userId, lastPullAt, upsertAchievementUnlock, owner, onPageApplied);

    if (pulledReviewDates.size > 0) {
      owner.requireCurrent();
      await db.withTransactionAsync(async (tx) => {
        owner.requireCurrent();
        await reconcileHabitDaysFromLogs(tx, { now: new Date(), dates: pulledReviewDates });
      });
    }

    owner.requireCurrent();
    await backfillAchievements(db, { notify: false });
    owner.requireCurrent();

    // Keep the old cursor if any table was incomplete, so its unseen rows remain eligible for retry.
    owner.requireCurrent();
    if (wordMeaningsComplete) {
      await db.runAsync("INSERT OR REPLACE INTO user_settings (key, value) VALUES ('last_pull_at', ?)", [
        pullStartedAt,
      ]);
      owner.requireCurrent();
      if (!habitTablesPulled) await markBackfillComplete(db, habitPullKey(userId));
      owner.requireCurrent();
      complete = true;
    }
  } catch (err) {
    owner.requireCurrent();
    console.warn("[Sync] Pull failed:", errorMessage(err));
  }

  return { pulled: totalPulled, complete };
}

/**
 * Full sync: restore account state before any upload, then run normal queue sync.
 */
export async function fullSync(db: AppDatabase): Promise<SyncResult> {
  const empty: SyncResult = {
    status: "not_connected",
    pushed: 0,
    pulled: 0,
    accountRestored: false,
    localDataReplaced: false,
  };
  if (!isSupabaseConfigured()) return empty;
  const owner = captureSyncOwner();
  if (!owner) return empty;
  owner.requireCurrent();
  const restored = await restoreAccountDataIfNeeded(db, owner);
  owner.requireCurrent();
  const pushed = await pushSyncQueue(db, owner);
  owner.requireCurrent();
  const pulled = await pullRemoteChanges(db, owner);
  owner.requireCurrent();
  const pending = await getPendingSyncCount(db);
  owner.requireCurrent();
  const totalPulled = restored.pulled + pulled.pulled;
  const failed = !pulled.complete || pushed.failed > 0;
  const madeProgress = pushed.hadSuccessfulEntry || totalPulled > 0 || restored.accountRestored;
  const status = !failed && pending === 0 ? "synced" : failed && !madeProgress ? "failed" : "partial";
  return {
    status,
    pushed: pushed.pushed,
    pulled: totalPulled,
    accountRestored: restored.accountRestored,
    localDataReplaced: restored.localDataReplaced,
    ...(restored.restoreCompleted ? { restoreCompleted: true } : {}),
  };
}

// ─── Internal helpers ──────────────────────────────────────────

function accountRestoreKey(userId: string): string {
  return `sync_account_restore_${userId}_${ACCOUNT_RESTORE_VERSION}`;
}

function isSyncInternalSetting(key: string): boolean {
  return (
    key === "last_pull_at" ||
    key.startsWith("sync_initial_backfill_") ||
    key.startsWith("sync_user_settings_backfill_") ||
    key.startsWith("sync_habit_backfill_") ||
    key.startsWith("sync_habit_pull_") ||
    key.startsWith("sync_account_restore_")
  );
}

export async function hasCompletedAccountRestore(db: DatabaseExecutor, userId: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [
    accountRestoreKey(userId),
  ]);
  return row?.value === "true";
}

async function markAccountRestoreComplete(
  db: DatabaseExecutor,
  userId: string,
  restoredFromRemote: boolean,
  snapshotStartedAt: string,
  owner: SyncOwner,
): Promise<void> {
  const now = new Date().toISOString();
  owner.requireCurrent();
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [accountRestoreKey(userId), now],
  );
  owner.requireCurrent();
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES ('last_pull_at', ?, ?, NULL)",
    [snapshotStartedAt, now],
  );
  owner.requireCurrent();
  // The restore snapshot covered the wird tables, so they need no separate full pull.
  await markBackfillComplete(db, habitPullKey(userId));
  owner.requireCurrent();
  if (!restoredFromRemote) return;
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [`sync_initial_backfill_${userId}_${INITIAL_BACKFILL_VERSION}`, now],
  );
  owner.requireCurrent();
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [habitBackfillKey(userId), now],
  );
  owner.requireCurrent();
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [userSettingsBackfillKey(userId), now],
  );
}

async function restoreAccountDataIfNeeded(db: AppDatabase, owner: SyncOwner): Promise<AccountRestoreResult> {
  if (!isSupabaseConfigured()) return { pulled: 0, accountRestored: false, localDataReplaced: false };

  owner.requireCurrent();
  const { userId } = owner;

  const completed = await hasCompletedAccountRestore(db, userId);
  owner.requireCurrent();
  if (completed) {
    return { pulled: 0, accountRestored: false, localDataReplaced: false };
  }

  const snapshotStartedAt = new Date().toISOString();
  const remoteRows = await fetchRemoteAccountRows(userId, owner);
  owner.requireCurrent();
  const remoteRowCount = REMOTE_RESTORE_TABLES.reduce((sum, tableName) => sum + remoteRows[tableName].length, 0);
  if (remoteRowCount === 0) {
    await markAccountRestoreComplete(db, userId, false, snapshotStartedAt, owner);
    owner.requireCurrent();
    return { pulled: 0, accountRestored: false, localDataReplaced: false, restoreCompleted: true };
  }

  const hadLocalData = await hasLocalSyncableData(db);
  owner.requireCurrent();
  await db.withTransactionAsync(async (tx) => {
    owner.requireCurrent();
    // A device that finished onboarding stays past it even when the account predates the synced flag.
    const onboarded =
      (await tx.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = 'onboarding_completed'"))
        ?.value === "true";
    await clearLocalSyncableData(tx);
    owner.requireCurrent();
    const studyLogKeysByCard = new Map<string, Set<string>>();
    await applyRemoteAccountRows(tx, remoteRows, studyLogKeysByCard);
    owner.requireCurrent();
    if (onboarded) await putUserSetting(tx, "onboarding_completed", "true");
    owner.requireCurrent();
    // Reviews from app versions before wird days were synced still count for their days.
    await reconcileHabitDaysFromLogs(tx, { now: new Date() });
    owner.requireCurrent();
    // ERR-06: weak spots that formed across devices get their cloze card from the restored errors,
    // and a card whose weak spot restored dismissals ended goes.
    const restoredErrors = remoteRows.recitation_errors.map((row) => ({
      location: { surah: row.surah, ayah: row.ayah ?? null, word: row.word ?? null },
      dismissed: row.deleted_at != null,
    }));
    await createWeakSpotCards(tx, restoredErrors.map((error) => error.location), new Date());
    await removeDismissedWeakSpotCards(
      tx,
      restoredErrors.filter((error) => error.dismissed).map((error) => error.location),
    );
    owner.requireCurrent();
    await markAccountRestoreComplete(tx, userId, true, snapshotStartedAt, owner);
    owner.requireCurrent();
  });
  owner.requireCurrent();

  return {
    pulled: remoteRowCount,
    accountRestored: true,
    localDataReplaced: hadLocalData,
    restoreCompleted: true,
  };
}

async function fetchRemoteAccountRows(userId: string, owner: SyncOwner): Promise<RemoteAccountRows> {
  return {
    user_settings: await fetchRemoteRows("user_settings", userId, owner),
    user_word_meanings: await fetchRemoteRows("user_word_meanings", userId, owner),
    study_cards: await fetchRemoteRows("study_cards", userId, owner),
    study_log: await fetchRemoteRows("study_log", userId, owner),
    bookmarks: await fetchRemoteRows("bookmarks", userId, owner),
    highlights: await fetchRemoteRows("highlights", userId, owner),
    private_notes: await fetchRemoteRows("private_notes", userId, owner),
    reflection_journey_entries: await fetchRemoteRows("reflection_journey_entries", userId, owner),
    achievement_unlocks: await fetchRemoteRows("achievement_unlocks", userId, owner),
    habit_days: await fetchRemoteRows("habit_days", userId, owner),
    review_sessions: await fetchRemoteRows("review_sessions", userId, owner),
    recitation_errors: await fetchRemoteRows("recitation_errors", userId, owner),
  };
}

async function fetchRemoteRows<K extends SyncTable>(
  tableName: K,
  userId: string,
  owner: SyncOwner,
): Promise<SyncRows[K][]> {
  const batchSize = 500;
  const rows: SyncRows[K][] = [];
  let offset = 0;
  while (true) {
    owner.requireCurrent();
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .eq("user_id", userId)
      .order("synced_at", { ascending: true })
      .range(offset, offset + batchSize - 1);
    owner.requireCurrent();
    if (error) throw error;
    const page = decodeSyncPage(tableName, data, userId);
    rows.push(...page);
    if (page.length < batchSize) break;
    offset += page.length;
  }
  return rows;
}

async function hasLocalSyncableData(db: DatabaseExecutor): Promise<boolean> {
  const [
    settings,
    cards,
    logs,
    bookmarks,
    highlights,
    notes,
    journeyEntries,
    achievements,
    wordMeanings,
    habitDays,
    reviewSessions,
    recitationErrors,
  ] =
    await Promise.all([
      db.getAllAsync<{ key: string }>("SELECT key FROM user_settings"),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM study_cards"),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM study_log"),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM bookmarks"),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM highlights"),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM private_notes"),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM reflection_journey_entries"),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM achievement_unlocks"),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM user_word_meanings"),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM habit_days"),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM review_sessions"),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM recitation_errors"),
    ]);

  return (
    settings.some((row) => isSyncableUserSetting(row.key)) ||
    [
      cards,
      logs,
      bookmarks,
      highlights,
      notes,
      journeyEntries,
      achievements,
      wordMeanings,
      habitDays,
      reviewSessions,
      recitationErrors,
    ].some(
      (row) => (row?.count ?? 0) > 0,
    )
  );
}

async function clearLocalSyncableData(db: DatabaseExecutor): Promise<void> {
  await db.runAsync("DELETE FROM study_cards");
  await db.runAsync("DELETE FROM study_log");
  await db.runAsync("DELETE FROM bookmarks");
  await db.runAsync("DELETE FROM highlights");
  await db.runAsync("DELETE FROM private_notes");
  await db.runAsync("DELETE FROM reflection_journey_entries");
  await db.runAsync("DELETE FROM achievement_unlocks");
  await db.runAsync("DELETE FROM user_word_meanings");
  await db.runAsync("DELETE FROM habit_days");
  await db.runAsync("DELETE FROM review_sessions");
  await db.runAsync("DELETE FROM recitation_errors");
  await db.runAsync("DELETE FROM sync_queue");
  await db.runAsync("DELETE FROM qf_sync_queue");

  const settings = await db.getAllAsync<{ key: string }>("SELECT key FROM user_settings");
  for (const row of settings) {
    if (isSyncableUserSetting(row.key) || isSyncInternalSetting(row.key) || isAccountDerivedDeviceSetting(row.key)) {
      await db.runAsync("DELETE FROM user_settings WHERE key = ?", [row.key]);
    }
  }
}

/**
 * Device-only state built from the replaced account's data: today's hifz page list, the monthly
 * check, today's extras and pending reminder follow-ups. Rebuilt from the restored account.
 *
 * Pending halaqa encouragement batches (notif_group_pending) stay: each batch names its account and
 * only the signed-in account's batches are scheduled, while each account's acknowledged ids stay
 * under its own key. Dropping the batches would leave those ids acknowledged and never announced.
 */
const ACCOUNT_DERIVED_DEVICE_KEYS = new Set([
  "device_hifz_today_plan",
  "device_monthly_check",
  "device_wird_extras",
  "notif_remind_later",
  "notif_banner_dismissed",
]);

function isAccountDerivedDeviceSetting(key: string): boolean {
  return ACCOUNT_DERIVED_DEVICE_KEYS.has(key);
}

async function applyRemoteAccountRows(
  db: DatabaseExecutor,
  rows: RemoteAccountRows,
  studyLogKeysByCard: Map<string, Set<string>>,
): Promise<void> {
  for (const row of rows.user_settings) await upsertUserSetting(db, row);
  for (const row of rows.user_word_meanings) await upsertUserWordMeaning(db, row);
  for (const row of rows.study_cards) await upsertStudyCard(db, row);
  for (const row of rows.study_log) await upsertStudyLog(db, row, studyLogKeysByCard);
  for (const row of rows.bookmarks) await upsertBookmark(db, row);
  for (const row of rows.highlights) await upsertHighlight(db, row);
  for (const row of rows.private_notes) await upsertPrivateNote(db, row);
  for (const row of rows.reflection_journey_entries) await upsertReflectionJourneyEntry(db, row);
  for (const row of rows.achievement_unlocks) await upsertAchievementUnlock(db, row);
  for (const row of rows.habit_days) await upsertHabitDay(db, row);
  for (const row of rows.review_sessions) await upsertReviewSession(db, row);
  for (const row of rows.recitation_errors) await upsertRecitationError(db, row);
}

function groupByTable(entries: SyncQueueEntry[]): Map<string, SyncQueueEntry[]> {
  const groups = new Map<string, SyncQueueEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.table_name) ?? [];
    group.push(entry);
    groups.set(entry.table_name, group);
  }
  return groups;
}

async function pushTableEntries(
  entries: SyncQueueEntry[],
  userId: string,
  onEntryCompleted: () => void,
): Promise<void> {
  // Validate the entire group before its first remote write. Never ACK stripped future fields.
  const decoded = entries.map((entry) => decodeSyncQueueEntry(entry, userId));
  for (const entry of decoded) {
    if (entry.operation === "DELETE") {
      await pushDelete(entry.table, entry.rowId, userId, entry.queuedAt, entry.data);
    } else {
      await pushUpsert(entry.table, entry.data, userId);
    }
    onEntryCompleted();
  }
}

async function pushUpsert(tableName: SyncTable, data: Record<string, any>, userId: string): Promise<void> {
  const syncedAt = new Date().toISOString();
  const row = normalizeRemoteRow(tableName, { ...data, user_id: userId, synced_at: syncedAt });

  // Determine conflict columns based on table
  let onConflict: string;
  switch (tableName) {
    case "user_settings":
      onConflict = "user_id,key";
      break;
    case "user_word_meanings":
      onConflict = "user_id,surah,ayah,word_pos";
      break;
    case "study_cards":
      onConflict = "user_id,id";
      break;
    case "study_log":
      await pushStudyLog(row, userId);
      return;
    case "highlights":
      onConflict = row.sync_id ? "user_id,sync_id" : "user_id,id";
      break;
    case "bookmarks":
      onConflict = "user_id,surah,ayah";
      break;
    case "private_notes":
      onConflict = "user_id,id";
      break;
    case "reflection_journey_entries":
      onConflict = "user_id,level_id";
      break;
    case "achievement_unlocks":
      onConflict = "user_id,achievement_id";
      break;
    case "habit_days":
      onConflict = "user_id,local_date";
      break;
    default:
      onConflict = "user_id,id";
  }

  // Habit days merge on the server (private.merge_habit_day), so an older upload still contributes.
  if (tableName !== "habit_days" && (await remoteIsNewer(tableName, row, userId))) return;

  const { error } = await supabase.from(tableName).upsert(row, { onConflict });

  if (error) throw error;
}

async function pushStudyLog(row: Record<string, any>, userId: string): Promise<void> {
  const { data: existing, error: existingError } = await supabase
    .from("study_log")
    .select("id")
    .eq("user_id", userId)
    .eq("card_id", row.card_id)
    .eq("reviewed_at", row.reviewed_at)
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (decodeSyncedStudyLogExists(existing, userId)) return;

  const { error: logError } = await supabase.from("study_log").insert(row);
  if (logError && !logError.message.includes("duplicate")) throw logError;
}

function normalizeRemoteRow(tableName: SyncTable, row: Record<string, any>): Record<string, any> {
  if (tableName === "highlights" && !row.sync_id && row.surah && row.ayah && row.color) {
    row.sync_id = highlightSyncId(row as any);
  }
  if (tableName === "highlights" && row.sync_id) {
    delete row.id;
  }
  // Legacy local highlights can carry an empty updated_at. The server column is TIMESTAMPTZ and the
  // freshness check needs a real instant, so use the row's own deletion or creation time.
  if (tableName === "highlights" && row.updated_at === "") {
    row.updated_at = row.deleted_at || row.created_at;
  }

  if (
    tableName === "study_cards" ||
    tableName === "highlights" ||
    tableName === "user_settings" ||
    tableName === "user_word_meanings" ||
    tableName === "review_sessions" ||
    tableName === "recitation_errors"
  ) {
    row.deleted_at = row.deleted_at ?? null;
  }

  return row;
}

function rowTimestamp(row: Record<string, any>, tableName: SyncTable): string | null {
  if (tableName === "achievement_unlocks") return row.unlocked_at ?? row.synced_at ?? null;
  return row.updated_at ?? row.created_at ?? row.synced_at ?? null;
}

async function remoteIsNewer(tableName: SyncTable, row: Record<string, any>, userId: string): Promise<boolean> {
  const localTimestamp = rowTimestamp(row, tableName);
  if (!localTimestamp || tableName === "study_log") return false;

  const timestampColumns =
    tableName === "achievement_unlocks" ? "unlocked_at, synced_at" : "updated_at, created_at, synced_at";
  let query = supabase.from(tableName).select(timestampColumns).eq("user_id", userId).limit(1);

  switch (tableName) {
    case "user_settings":
      query = query.eq("key", row.key);
      break;
    case "user_word_meanings":
      query = query.eq("surah", row.surah).eq("ayah", row.ayah).eq("word_pos", row.word_pos);
      break;
    case "study_cards":
      query = query.eq("id", row.id);
      break;
    case "bookmarks":
      query = query.eq("surah", row.surah).eq("ayah", row.ayah);
      break;
    case "highlights":
      query = row.sync_id ? query.eq("sync_id", row.sync_id) : query.eq("id", row.id);
      break;
    case "private_notes":
      query = query.eq("id", row.id);
      break;
    case "reflection_journey_entries":
      query = query.eq("level_id", row.level_id);
      break;
    case "achievement_unlocks":
      query = query.eq("achievement_id", row.achievement_id);
      break;
    default:
      if (!row.id) return false;
      query = query.eq("id", row.id);
  }

  const { data, error } = await query;
  if (error) throw error;
  const remoteTimestamp = decodeSyncFreshness(tableName, data, userId);
  return Boolean(remoteTimestamp && compareSyncTimestamps(remoteTimestamp, localTimestamp) > 0);
}

async function pushDelete(
  tableName: SyncTable,
  rowId: string,
  userId: string,
  queuedAt: string,
  data: Record<string, any> = {},
): Promise<void> {
  // A legacy entry without deleted_at was deleted no later than it was queued. Stamping the push time
  // instead would let a stale delete beat a newer edit from another device.
  const deletedAt = data.deleted_at ?? queuedAt;
  if (tableName === "user_settings") {
    await pushUpsert(
      tableName,
      {
        key: data.key ?? rowId,
        value: data.value ?? "",
        updated_at: data.updated_at ?? deletedAt,
        deleted_at: deletedAt,
      },
      userId,
    );
    return;
  }
  if (tableName === "user_word_meanings" && data.surah && data.ayah && data.word_pos) {
    await pushUpsert(
      tableName,
      {
        ...data,
        updated_at: data.updated_at ?? deletedAt,
        deleted_at: deletedAt,
      },
      userId,
    );
    return;
  }
  if (tableName === "study_cards" && data.deck_id) {
    await pushUpsert(
      tableName,
      {
        ...data,
        updated_at: data.updated_at ?? deletedAt,
        deleted_at: deletedAt,
      },
      userId,
    );
    return;
  }
  if (tableName === "highlights" && (data.sync_id || data.surah)) {
    await pushUpsert(
      tableName,
      {
        ...data,
        sync_id: data.sync_id ?? highlightSyncId(data as any),
        updated_at: data.updated_at ?? deletedAt,
        deleted_at: deletedAt,
      },
      userId,
    );
    return;
  }

  // rowId format depends on table:
  // study_cards: "surah:ayah"
  // bookmarks: "surah:ayah"
  // highlights: numeric id
  let query = supabase.from(tableName).delete().eq("user_id", userId);

  switch (tableName) {
    case "study_cards":
      query = query.eq("id", rowId);
      break;
    case "bookmarks": {
      const [surah, ayah] = rowId.split(":").map(Number);
      query = query.eq("surah", surah).eq("ayah", ayah);
      break;
    }
    case "highlights":
      query = rowId.startsWith("highlight:") ? query.eq("sync_id", rowId) : query.eq("id", rowId);
      break;
    case "user_word_meanings": {
      const [surah, ayah, wordPos] = rowId.split(":").map(Number);
      query = query.eq("surah", surah).eq("ayah", ayah).eq("word_pos", wordPos);
      break;
    }
    case "private_notes":
      query = query.eq("id", rowId);
      break;
    case "reflection_journey_entries":
      query = query.eq("level_id", rowId);
      break;
    case "achievement_unlocks":
      query = query.eq("achievement_id", rowId);
      break;
    default:
      query = query.eq("id", rowId);
  }

  // With an explicit deletion time the freshness condition is part of the DELETE itself, so a newer row
  // written by another device between queueing and pushing survives. Equal times delete, matching the
  // upload rule. Legacy entries without deleted_at keep the unrestricted delete: their rows could carry a
  // server-default time later than the queue time, and a conditional delete would bring them back.
  if (data.deleted_at) {
    if (tableName === "highlights") {
      query = query.or(`updated_at.is.null,updated_at.lte."${data.deleted_at}"`);
    } else {
      query = query.lte(tableName === "achievement_unlocks" ? "unlocked_at" : "updated_at", data.deleted_at);
    }
  }

  const { error } = await query;
  if (error) throw error;
}

// ─── Pull helpers (remote → local SQLite) ──────────────────────

async function pullTable<K extends SyncTable>(
  db: AppDatabase,
  tableName: K,
  userId: string,
  since: string,
  upsertFn: (db: DatabaseExecutor, row: SyncRows[K]) => Promise<void>,
  owner: SyncOwner,
  onPageApplied: (count: number) => void,
  /** Runs in each page's transaction after its rows, so derived state commits with them. */
  afterPage?: (db: DatabaseExecutor) => Promise<void>,
): Promise<void> {
  const timeCol = "synced_at";
  const batchSize = 500;
  let offset = 0;

  while (true) {
    owner.requireCurrent();
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .eq("user_id", userId)
      .gt(timeCol, since)
      .order(timeCol, { ascending: true })
      .range(offset, offset + batchSize - 1);

    owner.requireCurrent();
    if (error) throw error;
    const page = decodeSyncPage(tableName, data, userId);
    if (page.length === 0) break;

    await db.withTransactionAsync(async (tx) => {
      owner.requireCurrent();
      for (const row of page) {
        owner.requireCurrent();
        await upsertFn(tx, row);
        owner.requireCurrent();
      }
      if (afterPage) await afterPage(tx);
      owner.requireCurrent();
    });

    owner.requireCurrent();
    onPageApplied(page.length);
    if (page.length < batchSize) break;
    offset += page.length;
  }
}

async function upsertUserSetting(db: DatabaseExecutor, row: SyncRows["user_settings"]): Promise<void> {
  if (row.kind === "ignored") return;
  const remoteUpdatedAt = row.updated_at ?? row.created_at ?? row.synced_at;
  const local = await db.getFirstAsync<{ updated_at: string | null }>(
    "SELECT updated_at FROM user_settings WHERE key = ?",
    [row.key],
  );
  if (local?.updated_at && remoteUpdatedAt && compareSyncTimestamps(local.updated_at, remoteUpdatedAt) >= 0) return;

  if (row.deleted_at != null) {
    await db.runAsync("DELETE FROM user_settings WHERE key = ?", [row.key]);
    return;
  }

  if (typeof row.value !== "string") throw new Error("Invalid synced user_settings payload");
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, ?, ?, NULL)",
    [row.key, row.value, remoteUpdatedAt ?? new Date().toISOString()],
  );
}

async function upsertUserWordMeaning(db: DatabaseExecutor, row: SyncRows["user_word_meanings"]): Promise<void> {
  const remoteUpdatedAt = row.updated_at ?? row.created_at ?? row.synced_at;
  const local = await db.getFirstAsync<{ updated_at: string | null }>(
    "SELECT updated_at FROM user_word_meanings WHERE surah = ? AND ayah = ? AND word_pos = ?",
    [row.surah, row.ayah, row.word_pos],
  );
  if (local?.updated_at && remoteUpdatedAt && compareSyncTimestamps(local.updated_at, remoteUpdatedAt) >= 0) return;

  if (row.deleted_at != null) {
    await db.runAsync("DELETE FROM user_word_meanings WHERE surah = ? AND ayah = ? AND word_pos = ?", [
      row.surah,
      row.ayah,
      row.word_pos,
    ]);
    return;
  }

  if (typeof row.meaning !== "string") throw new Error("Invalid synced user_word_meanings payload");
  await db.runAsync(
    `INSERT OR REPLACE INTO user_word_meanings
     (surah, ayah, word_pos, word, meaning, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.surah,
      row.ayah,
      row.word_pos,
      row.word ?? null,
      row.meaning,
      row.created_at ?? remoteUpdatedAt ?? new Date().toISOString(),
      remoteUpdatedAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertStudyCard(db: DatabaseExecutor, row: SyncRows["study_cards"]): Promise<void> {
  // Last-write-wins: only update if remote is newer
  const remoteUpdatedAt = row.updated_at ?? row.created_at ?? row.synced_at;
  if (!remoteUpdatedAt) throw new Error("Invalid synced study_cards payload");
  const local = await db.getFirstAsync<{ updated_at: string; last_review: string | null }>(
    "SELECT updated_at, last_review FROM study_cards WHERE id = ?",
    [row.id],
  );

  if (local && remoteUpdatedAt && compareSyncTimestamps(local.updated_at, remoteUpdatedAt) >= 0) return; // Local is newer

  // A deletion is newer, but its schedule can be older than this device's: a device that had not
  // pulled the latest reviews deleted the card. The card is deleted either way; it keeps the more
  // recently reviewed schedule, which is what comes back if the card is restored (a cloze card whose
  // word is still weak here, lib/hifz/weak-spots.ts).
  if (row.deleted_at != null && local && !reviewedLater(row.last_review ?? null, local.last_review)) {
    await db.runAsync("UPDATE study_cards SET updated_at = ?, deleted_at = ? WHERE id = ?", [
      remoteUpdatedAt,
      row.deleted_at,
      row.id,
    ]);
    return;
  }

  if (row.deleted_at != null) {
    await db.runAsync(
      `INSERT INTO study_cards
       (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days,
        learning_steps, reps, lapses, state, last_review, suspended_at, buried_until,
        marked_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        deck_id = excluded.deck_id,
        due = excluded.due,
        stability = excluded.stability,
        difficulty = excluded.difficulty,
        elapsed_days = excluded.elapsed_days,
        scheduled_days = excluded.scheduled_days,
        learning_steps = excluded.learning_steps,
        reps = excluded.reps,
        lapses = excluded.lapses,
        state = excluded.state,
        last_review = excluded.last_review,
        suspended_at = excluded.suspended_at,
        buried_until = excluded.buried_until,
        marked_at = excluded.marked_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at`,
      [
        row.id,
        row.deck_id ?? "deleted",
        row.due ?? remoteUpdatedAt,
        row.stability ?? 0,
        row.difficulty ?? 0,
        row.elapsed_days ?? 0,
        row.scheduled_days ?? 0,
        row.learning_steps ?? 0,
        row.reps ?? 0,
        row.lapses ?? 0,
        row.state ?? 0,
        row.last_review ?? null,
        row.suspended_at ?? null,
        row.buried_until ?? null,
        row.marked_at ?? null,
        row.created_at ?? remoteUpdatedAt,
        remoteUpdatedAt,
        row.deleted_at,
      ],
    );
    return;
  }

  // The cached page tier travels with the card, so a restored device knows its manzil pages.
  await db.runAsync(
    `INSERT OR REPLACE INTO study_cards
     (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days,
      learning_steps, reps, lapses, state, last_review, suspended_at, buried_until,
      marked_at, created_at, updated_at, deleted_at, tier, tier_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      row.id,
      row.deck_id,
      row.due,
      row.stability,
      row.difficulty,
      row.elapsed_days,
      row.scheduled_days,
      row.learning_steps,
      row.reps,
      row.lapses,
      row.state,
      row.last_review ?? null,
      row.suspended_at ?? null,
      row.buried_until ?? null,
      row.marked_at ?? null,
      row.created_at,
      remoteUpdatedAt,
      row.tier ?? null,
      row.tier_changed_at ?? null,
    ],
  );
}

async function upsertStudyLog(
  db: DatabaseExecutor,
  row: SyncRows["study_log"],
  restoreKeysByCard?: Map<string, Set<string>>,
): Promise<void> {
  const restoreKey = restoreKeysByCard ? syncTimestampKey(row.reviewed_at) : null;
  const seenRestoreKeys = restoreKeysByCard?.get(row.card_id);
  if (restoreKey !== null && seenRestoreKeys?.has(restoreKey)) return;

  // Preserve the literal lookup as the fast path for incremental pulls and restore.
  const existing = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM study_log WHERE card_id = ? AND reviewed_at = ?",
    [row.card_id, row.reviewed_at],
  );
  const rememberRestoreKey = () => {
    if (restoreKeysByCard === undefined || restoreKey === null) return;
    const keys = restoreKeysByCard.get(row.card_id) ?? new Set<string>();
    keys.add(restoreKey);
    restoreKeysByCard.set(row.card_id, keys);
  };
  if (existing) {
    rememberRestoreKey();
    return;
  }

  if (restoreKeysByCard === undefined) {
    const sameCardRows = await db.getAllAsync<{ reviewed_at: string }>(
      "SELECT reviewed_at FROM study_log WHERE card_id = ?",
      [row.card_id],
    );
    const incomingKey = syncTimestampKey(row.reviewed_at);
    if (sameCardRows.some((local) => syncTimestampKey(local.reviewed_at) === incomingKey)) return;
  }

  // A review from an app version before local dates were recorded takes this device's date for its
  // instant, as the old streak did.
  const reviewedAt = new Date(row.reviewed_at);
  await db.runAsync(
    `INSERT INTO study_log
     (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at, sync_status,
      session_id, duration_ms, support_level, proposed_rating, grader, local_date, tz, error_count, makeup_for)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.card_id,
      row.rating,
      row.state,
      row.due,
      row.stability,
      row.difficulty,
      row.elapsed_days,
      row.scheduled_days,
      row.reviewed_at,
      row.session_id ?? null,
      row.duration_ms ?? null,
      row.support_level ?? null,
      row.proposed_rating ?? null,
      row.grader ?? null,
      row.local_date ?? localDateOf(reviewedAt),
      row.tz ?? (row.local_date ? null : deviceTimeZone(reviewedAt)),
      row.error_count ?? 0,
      row.makeup_for ?? null,
    ],
  );
  rememberRestoreKey();
}

function syncFlag(value: boolean | 0 | 1 | null | undefined): number {
  return value === true || value === 1 ? 1 : 0;
}

/** DB-02: a pulled wird day merges with the local one by status precedence. */
async function upsertHabitDay(db: DatabaseExecutor, row: SyncRows["habit_days"]): Promise<void> {
  const remote: HabitDayRow = {
    local_date: row.local_date,
    status: row.status,
    earned_status: row.earned_status,
    reason: row.reason,
    excuse_updated_at: row.excuse_updated_at ?? null,
    minimum_met: syncFlag(row.minimum_met),
    full_met: syncFlag(row.full_met),
    manzil_cycle_completed: syncFlag(row.manzil_cycle_completed),
    source_session_id: row.source_session_id ?? null,
    credited_through: row.credited_through ?? null,
    tz: row.tz ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  await applyRemoteHabitDay(db, remote);
}

/** DB-03: sessions keep the newer row by updated_at. */
async function upsertReviewSession(db: DatabaseExecutor, row: SyncRows["review_sessions"]): Promise<void> {
  const local = await db.getFirstAsync<{ updated_at: string }>("SELECT updated_at FROM review_sessions WHERE id = ?", [
    row.id,
  ]);
  if (local && compareSyncTimestamps(local.updated_at, row.updated_at) >= 0) return;
  await db.runAsync(
    `INSERT OR REPLACE INTO review_sessions
      (id, kind, deck_id, started_at, ended_at, duration_ms, local_date, tz, cards_reviewed, pages_reviewed, new_lines,
       clean_pages, errors, minimum_met, full_met, source, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.kind,
      row.deck_id ?? null,
      row.started_at,
      row.ended_at ?? null,
      row.duration_ms,
      row.local_date,
      row.tz,
      row.cards_reviewed,
      row.pages_reviewed,
      row.new_lines,
      row.clean_pages,
      row.errors,
      syncFlag(row.minimum_met),
      syncFlag(row.full_met),
      row.source,
      row.created_at,
      row.updated_at,
      row.deleted_at ?? null,
    ],
  );
}

type ErrorLocationRow = { surah: number; ayah: number | null; word: number | null };

/** Whether `remote` is a later review than `local`; a review beats none. */
function reviewedLater(remote: string | null, local: string | null): boolean {
  if (!remote) return false;
  if (!local) return true;
  return compareSyncTimestamps(remote, local) > 0;
}

async function isLiveRecitationError(db: DatabaseExecutor, id: string): Promise<boolean> {
  return (await db.getFirstAsync("SELECT 1 FROM recitation_errors WHERE id = ? AND deleted_at IS NULL", [id])) != null;
}

/** DB-03: recitation errors keep the newer row by updated_at, so inbox progress converges. */
async function upsertRecitationError(db: DatabaseExecutor, row: SyncRows["recitation_errors"]): Promise<void> {
  const local = await db.getFirstAsync<{ updated_at: string }>("SELECT updated_at FROM recitation_errors WHERE id = ?", [
    row.id,
  ]);
  if (local && compareSyncTimestamps(local.updated_at, row.updated_at) >= 0) return;
  await db.runAsync(
    `INSERT OR REPLACE INTO recitation_errors
      (id, card_id, session_id, surah, ayah, word, type, severity, corrected, sibling_ref, local_date, clean_count,
       last_clean_date, resolved_at, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.card_id,
      row.session_id ?? null,
      row.surah,
      row.ayah ?? null,
      row.word ?? null,
      row.type,
      row.severity,
      row.corrected,
      row.sibling_ref ?? null,
      row.local_date,
      row.clean_count,
      row.last_clean_date ?? null,
      row.resolved_at ?? null,
      row.created_at,
      row.updated_at,
      row.deleted_at ?? null,
    ],
  );
}

async function upsertBookmark(db: DatabaseExecutor, row: SyncRows["bookmarks"]): Promise<void> {
  const remoteUpdatedAt = row.updated_at ?? row.created_at;
  const local = await db.getFirstAsync<{ updated_at: string }>(
    "SELECT updated_at FROM bookmarks WHERE surah = ? AND ayah = ?",
    [row.surah, row.ayah],
  );
  if (local && compareSyncTimestamps(local.updated_at, remoteUpdatedAt) >= 0) return;

  await db.runAsync(
    `INSERT OR REPLACE INTO bookmarks
      (surah, ayah, created_at, updated_at, deleted_at, qf_bookmark_id, qf_synced_at,
       qf_sync_error, qf_is_in_default_collection, qf_collections_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.surah,
      row.ayah,
      row.created_at,
      remoteUpdatedAt,
      row.deleted_at ?? null,
      row.qf_bookmark_id ?? null,
      row.qf_synced_at ?? null,
      row.qf_sync_error ?? null,
      row.qf_is_in_default_collection ? 1 : 0,
      row.qf_collections_count ?? 0,
    ],
  );
}

async function upsertHighlight(db: DatabaseExecutor, row: SyncRows["highlights"]): Promise<void> {
  const syncId = row.sync_id ?? highlightSyncId(row);
  const remoteUpdatedAt = row.updated_at ?? row.created_at ?? row.synced_at;

  if (row.deleted_at != null) {
    const identityPredicate =
      "(sync_id = ? OR (surah = ? AND ayah = ? AND color = ? AND word_start IS ? AND word_end IS ?))";
    const identityParams = [syncId, row.surah, row.ayah, row.color, row.word_start ?? null, row.word_end ?? null];
    if (!remoteUpdatedAt) {
      await db.runAsync("DELETE FROM highlights WHERE " + identityPredicate, identityParams);
      return;
    }

    const targets = await db.getAllAsync<{ id: number; updated_at: string | null }>(
      "SELECT id, updated_at FROM highlights WHERE " + identityPredicate,
      identityParams,
    );
    const eligibleTargets = targets.filter(
      (target) => !target.updated_at || compareSyncTimestamps(target.updated_at, remoteUpdatedAt) < 0,
    );
    for (const target of eligibleTargets) {
      await db.runAsync("DELETE FROM highlights WHERE id = ? AND updated_at IS ? AND " + identityPredicate, [
        target.id,
        target.updated_at,
        ...identityParams,
      ]);
    }
    return;
  }
  if (typeof row.created_at !== "string" || remoteUpdatedAt == null)
    throw new Error("Invalid synced highlights payload");
  // An empty updated_at is only a deletion contract. A live row falls back to its creation time so the
  // freshness check still applies and no empty timestamp is stored.
  const liveUpdatedAt = remoteUpdatedAt || row.created_at;
  const existing = await db.getFirstAsync<{ id: number; updated_at: string | null }>(
    `SELECT id, updated_at FROM highlights
     WHERE sync_id = ?
        OR (surah = ? AND ayah = ? AND color = ? AND word_start IS ? AND word_end IS ?)
     LIMIT 1`,
    [syncId, row.surah, row.ayah, row.color, row.word_start ?? null, row.word_end ?? null],
  );
  if (existing?.updated_at && compareSyncTimestamps(existing.updated_at, liveUpdatedAt) >= 0) return;

  if (existing) {
    await db.runAsync(
      `UPDATE highlights
       SET sync_id = ?, surah = ?, ayah = ?, word_start = ?, word_end = ?, color = ?,
           created_at = ?, updated_at = ?, deleted_at = NULL
       WHERE id = ?`,
      [
        syncId,
        row.surah,
        row.ayah,
        row.word_start ?? null,
        row.word_end ?? null,
        row.color,
        row.created_at,
        liveUpdatedAt,
        existing.id,
      ],
    );
  } else {
    await db.runAsync(
      `INSERT INTO highlights
        (sync_id, surah, ayah, word_start, word_end, color, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        syncId,
        row.surah,
        row.ayah,
        row.word_start ?? null,
        row.word_end ?? null,
        row.color,
        row.created_at,
        liveUpdatedAt,
      ],
    );
  }
}

async function upsertPrivateNote(db: DatabaseExecutor, row: SyncRows["private_notes"]): Promise<void> {
  const remoteUpdatedAt = row.updated_at ?? row.created_at ?? row.synced_at;
  const local = await db.getFirstAsync<{ updated_at: string }>("SELECT updated_at FROM private_notes WHERE id = ?", [
    row.id,
  ]);
  if (local && remoteUpdatedAt && compareSyncTimestamps(local.updated_at, remoteUpdatedAt) >= 0) return;
  const qfRangesJson =
    typeof row.qf_ranges_json === "string"
      ? row.qf_ranges_json
      : row.qf_ranges_json
        ? JSON.stringify(row.qf_ranges_json)
        : null;

  await db.runAsync(
    `INSERT OR REPLACE INTO private_notes
      (id, surah, ayah_start, ayah_end, content, created_at, updated_at, deleted_at,
       qf_note_id, qf_synced_at, qf_sync_error, qf_ranges_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.surah,
      row.ayah_start,
      row.ayah_end,
      row.content,
      row.created_at,
      remoteUpdatedAt,
      row.deleted_at ?? null,
      row.qf_note_id ?? null,
      row.qf_synced_at ?? null,
      row.qf_sync_error ?? null,
      qfRangesJson,
    ],
  );
}

async function upsertReflectionJourneyEntry(
  db: DatabaseExecutor,
  row: SyncRows["reflection_journey_entries"],
): Promise<void> {
  const remoteUpdatedAt = row.updated_at ?? row.created_at ?? row.synced_at;
  const local = await db.getFirstAsync<{ updated_at: string }>(
    "SELECT updated_at FROM reflection_journey_entries WHERE level_id = ?",
    [row.level_id],
  );
  if (local && remoteUpdatedAt && compareSyncTimestamps(local.updated_at, remoteUpdatedAt) >= 0) return;

  await db.runAsync(
    `INSERT OR REPLACE INTO reflection_journey_entries
      (level_id, status, response_text, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.level_id, row.status, row.response_text, row.created_at, remoteUpdatedAt, row.completed_at ?? null],
  );
}

async function upsertAchievementUnlock(db: DatabaseExecutor, row: SyncRows["achievement_unlocks"]): Promise<void> {
  await insertRemoteAchievementUnlock(db, {
    achievement_id: row.achievement_id,
    unlocked_at: row.unlocked_at,
    public_payload: row.public_payload,
  });
}

function safeJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Queue every local row once per account. The queue rows and completion markers commit together,
 * so a failed queue write leaves the backfill incomplete and the next sync retries it in full.
 */
async function enqueueInitialLocalDataForSync(database: AppDatabase, userId: string): Promise<void> {
  const backfillKey = `sync_initial_backfill_${userId}_${INITIAL_BACKFILL_VERSION}`;
  const settingsBackfillKey = userSettingsBackfillKey(userId);
  if (await isBackfillComplete(database, backfillKey)) return;
  await database.withTransactionAsync((db) => enqueueInitialLocalRows(db, backfillKey, settingsBackfillKey));
}

async function enqueueInitialLocalRows(
  db: DatabaseExecutor,
  backfillKey: string,
  settingsBackfillKey: string,
): Promise<void> {
  // Another tab sharing this database may have completed the backfill while this one waited.
  if (await isBackfillComplete(db, backfillKey)) return;
  const [settings, cards, logs, bookmarks, highlights, privateNotes, journeyEntries, achievements, userWordMeanings] =
    await Promise.all([
      db.getAllAsync<{ key: string; value: string; updated_at: string | null; deleted_at: string | null }>(
        "SELECT key, value, updated_at, deleted_at FROM user_settings",
      ),
      db.getAllAsync<Record<string, any>>("SELECT * FROM study_cards"),
      db.getAllAsync<Record<string, any>>(
        `SELECT card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at,
              session_id, duration_ms, support_level, proposed_rating, grader, local_date, tz, error_count, makeup_for
       FROM study_log`,
      ),
      db.getAllAsync<Record<string, any>>("SELECT * FROM bookmarks"),
      db.getAllAsync<Record<string, any>>("SELECT * FROM highlights"),
      db.getAllAsync<Record<string, any>>("SELECT * FROM private_notes"),
      db.getAllAsync<Record<string, any>>("SELECT * FROM reflection_journey_entries"),
      db.getAllAsync<Record<string, any>>(
        "SELECT achievement_id, unlocked_at, public_payload FROM achievement_unlocks",
      ),
      db.getAllAsync<Record<string, any>>(
        "SELECT surah, ayah, word_pos, word, meaning, created_at, updated_at FROM user_word_meanings",
      ),
    ]);

  const enqueueBackfill = async (
    tableName: string,
    operation: "INSERT" | "UPDATE" | "DELETE",
    rowId: string,
    data: Record<string, any>,
  ) => {
    await enqueueSync(db, tableName, operation, rowId, data);
  };

  for (const row of settings) {
    if (!isSyncableUserSetting(row.key)) continue;
    await enqueueBackfill("user_settings", "UPDATE", row.key, userSettingToSyncData(row));
  }
  for (const row of userWordMeanings) {
    await enqueueBackfill("user_word_meanings", "UPDATE", `${row.surah}:${row.ayah}:${row.word_pos}`, row);
  }
  for (const row of cards) {
    await enqueueBackfill("study_cards", "UPDATE", row.id, row);
  }
  for (const row of logs) {
    await enqueueBackfill("study_log", "INSERT", `${row.card_id}:${row.reviewed_at}`, row);
  }
  for (const row of bookmarks) {
    await enqueueBackfill("bookmarks", "UPDATE", `${row.surah}:${row.ayah}`, row);
  }
  for (const row of highlights) {
    const syncId = row.sync_id ?? highlightSyncId(row as any);
    await enqueueBackfill("highlights", "UPDATE", syncId, {
      ...row,
      sync_id: syncId,
      updated_at: row.updated_at ?? row.created_at,
      deleted_at: row.deleted_at ?? null,
    });
  }
  for (const row of privateNotes) {
    await enqueueBackfill("private_notes", "UPDATE", row.id, {
      ...row,
      qf_ranges_json: row.qf_ranges_json ? safeJson(row.qf_ranges_json) : null,
    });
  }
  for (const row of journeyEntries) {
    await enqueueBackfill("reflection_journey_entries", "UPDATE", row.level_id, row);
  }
  for (const row of achievements) {
    await enqueueBackfill("achievement_unlocks", "INSERT", row.achievement_id, {
      achievement_id: row.achievement_id,
      unlocked_at: row.unlocked_at,
      public_payload: safeJson(row.public_payload) ?? {},
    });
  }

  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [backfillKey, new Date().toISOString()],
  );
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [settingsBackfillKey, new Date().toISOString()],
  );
}

const PULL_EPOCH = "1970-01-01T00:00:00Z";

function habitPullKey(userId: string): string {
  return `sync_habit_pull_${userId}_${HABIT_BACKFILL_VERSION}`;
}

async function markBackfillComplete(db: DatabaseExecutor, key: string): Promise<void> {
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [key, new Date().toISOString()],
  );
}

function habitBackfillKey(userId: string): string {
  return `sync_habit_backfill_${userId}_${HABIT_BACKFILL_VERSION}`;
}

/**
 * Queue wird days, sessions and recitation errors once per account, for local rows written before
 * sign-in or before these tables were synced. Restored accounts mark this done because their rows
 * came from the server.
 */
async function enqueueHabitDataForSync(database: AppDatabase, userId: string): Promise<void> {
  const backfillKey = habitBackfillKey(userId);
  if (await isBackfillComplete(database, backfillKey)) return;
  await database.withTransactionAsync(async (db) => {
    if (await isBackfillComplete(db, backfillKey)) return;
    const [days, sessions, errors] = await Promise.all([
      db.getAllAsync<HabitDayRow>("SELECT * FROM habit_days"),
      db.getAllAsync<Record<string, any>>("SELECT * FROM review_sessions"),
      db.getAllAsync<Record<string, any>>("SELECT * FROM recitation_errors"),
    ]);
    for (const day of days) await enqueueSync(db, "habit_days", "UPDATE", day.local_date, habitDaySyncData(day));
    for (const session of sessions) {
      await enqueueSync(db, "review_sessions", "UPDATE", session.id, {
        ...session,
        minimum_met: session.minimum_met === 1,
        full_met: session.full_met === 1,
      });
    }
    for (const error of errors) await enqueueSync(db, "recitation_errors", "UPDATE", error.id, error);
    await db.runAsync(
      "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
      [backfillKey, new Date().toISOString()],
    );
  });
}

async function isBackfillComplete(db: DatabaseExecutor, key: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [key]);
  return row?.value === "true";
}

function userSettingsBackfillKey(userId: string): string {
  return `sync_user_settings_backfill_${userId}_${USER_SETTINGS_BACKFILL_VERSION}`;
}

async function enqueueSyncableUserSettingsForSync(database: AppDatabase, userId: string): Promise<void> {
  const backfillKey = userSettingsBackfillKey(userId);
  if (await isBackfillComplete(database, backfillKey)) return;
  await database.withTransactionAsync((db) => enqueueSyncableUserSettingRows(db, backfillKey));
}

async function enqueueSyncableUserSettingRows(db: DatabaseExecutor, backfillKey: string): Promise<void> {
  if (await isBackfillComplete(db, backfillKey)) return;
  const settings = await db.getAllAsync<{
    key: string;
    value: string;
    updated_at: string | null;
    deleted_at: string | null;
  }>("SELECT key, value, updated_at, deleted_at FROM user_settings");
  for (const row of settings) {
    if (!isSyncableUserSetting(row.key)) continue;
    await enqueueSync(db, "user_settings", "UPDATE", row.key, userSettingToSyncData(row));
  }

  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value, updated_at, deleted_at) VALUES (?, 'true', ?, NULL)",
    [backfillKey, new Date().toISOString()],
  );
}
