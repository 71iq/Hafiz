import type { SQLiteDatabase } from "expo-sqlite";
import { enqueueSync } from "@/lib/database/sync-queue";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getQfConnectionStatus, invokeQfUser } from "./user";
import {
  QF_DEFAULT_MUSHAF_ID,
  buildQfRange,
  isQfSyncableNoteContent,
  parseQfRange,
  type QfBookmark,
  type QfNote,
} from "./user-types";

type QfEntityType = "bookmark" | "private_note";
type QfOperation = "UPSERT" | "DELETE";

type QfSyncQueueEntry = {
  id: number;
  entity_type: QfEntityType;
  operation: QfOperation;
  local_id: string;
  data: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
};

type LocalBookmarkRow = {
  surah: number;
  ayah: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  qf_bookmark_id: string | null;
  qf_synced_at: string | null;
  qf_sync_error: string | null;
  qf_is_in_default_collection: number | null;
  qf_collections_count: number | null;
};

type LocalPrivateNoteRow = {
  id: string;
  surah: number;
  ayah_start: number;
  ayah_end: number;
  content: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  qf_note_id: string | null;
  qf_synced_at: string | null;
  qf_sync_error: string | null;
  qf_ranges_json: string | null;
};

export async function enqueueQfSync(
  db: SQLiteDatabase,
  entityType: QfEntityType,
  operation: QfOperation,
  localId: string,
  data: Record<string, unknown>
): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO qf_sync_queue
      (entity_type, operation, local_id, data, status, attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [entityType, operation, localId, JSON.stringify(data), now, now]
  );
}

export async function getPendingQfSyncCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM qf_sync_queue WHERE status IN ('pending', 'failed')"
  );
  return row?.count ?? 0;
}

export async function runInitialQfUserSync(db: SQLiteDatabase): Promise<{ pushed: number; pulled: number }> {
  if (!(await hasConnectedQfUser())) return { pushed: 0, pulled: 0 };

  const firstPull = await pullQfRemoteChanges(db);
  await enqueueAllActiveLocalRows(db);
  await markInitialLocalEnqueueDone(db);
  const pushed = await pushQfSyncQueue(db);
  const secondPull = await pullQfRemoteChanges(db);
  return { pushed, pulled: firstPull + secondPull };
}

export async function fullQfUserSync(db: SQLiteDatabase): Promise<{ pushed: number; pulled: number }> {
  if (!(await hasConnectedQfUser())) return { pushed: 0, pulled: 0 };
  if (await needsInitialLocalEnqueue(db)) {
    const firstPull = await pullQfRemoteChanges(db);
    await enqueueAllActiveLocalRows(db);
    await markInitialLocalEnqueueDone(db);
    const pushed = await pushQfSyncQueue(db);
    const secondPull = await pullQfRemoteChanges(db);
    await db.runAsync(
      "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('qf_last_sync_at', ?)",
      [new Date().toISOString()]
    );
    return { pushed, pulled: firstPull + secondPull };
  }
  const pushed = await pushQfSyncQueue(db);
  const pulled = await pullQfRemoteChanges(db);
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('qf_last_sync_at', ?)",
    [new Date().toISOString()]
  );
  return { pushed, pulled };
}

async function needsInitialLocalEnqueue(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = 'qf_initial_local_enqueue_done'"
  );
  return row?.value !== "true";
}

async function markInitialLocalEnqueueDone(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('qf_initial_local_enqueue_done', 'true')"
  );
}

async function hasConnectedQfUser(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  if (!useAuthStore.getState().user) return false;
  const status = await getQfConnectionStatus();
  return status.ok && status.status === "connected";
}

async function enqueueAllActiveLocalRows(db: SQLiteDatabase): Promise<void> {
  const bookmarks = await db.getAllAsync<LocalBookmarkRow>(
    "SELECT * FROM bookmarks WHERE deleted_at IS NULL"
  );
  for (const bookmark of bookmarks) {
    await enqueueQfSync(db, "bookmark", "UPSERT", bookmarkLocalId(bookmark.surah, bookmark.ayah), {
      surah: bookmark.surah,
      ayah: bookmark.ayah,
    });
  }

  const notes = await db.getAllAsync<LocalPrivateNoteRow>(
    "SELECT * FROM private_notes WHERE deleted_at IS NULL"
  );
  for (const note of notes) {
    await enqueueQfSync(db, "private_note", "UPSERT", note.id, noteToPayload(note));
  }
}

async function pushQfSyncQueue(db: SQLiteDatabase): Promise<number> {
  const entries = await db.getAllAsync<QfSyncQueueEntry>(
    `SELECT * FROM qf_sync_queue
     WHERE status IN ('pending', 'failed') AND attempt_count < 5
     ORDER BY id ASC
     LIMIT 100`
  );
  let pushed = 0;

  for (const entry of entries) {
    try {
      if (entry.entity_type === "bookmark") {
        await pushBookmarkEntry(db, entry);
      } else {
        await pushPrivateNoteEntry(db, entry);
      }
      await markQfSynced(db, entry.id);
      pushed += 1;
    } catch (error) {
      await markQfFailed(db, entry.id, errorMessage(error));
    }
  }

  await cleanSyncedQfEntries(db);
  return pushed;
}

async function pushBookmarkEntry(db: SQLiteDatabase, entry: QfSyncQueueEntry): Promise<void> {
  const parsedId = parseBookmarkLocalId(entry.local_id);
  if (!parsedId) return;
  const local = await db.getFirstAsync<LocalBookmarkRow>(
    "SELECT * FROM bookmarks WHERE surah = ? AND ayah = ?",
    [parsedId.surah, parsedId.ayah]
  );

  if (entry.operation === "DELETE") {
    const data = safeJson<Record<string, unknown>>(entry.data) ?? {};
    const qfBookmarkId =
      stringOrNull(data.qfBookmarkId) ??
      local?.qf_bookmark_id ??
      (await findRemoteBookmarkId(parsedId.surah, parsedId.ayah));
    if (!qfBookmarkId) return;

    const isInDefaultCollection = booleanFromUnknown(data.qfIsInDefaultCollection) || Boolean(local?.qf_is_in_default_collection);
    const collectionsCount = numberFromUnknown(data.qfCollectionsCount) ?? local?.qf_collections_count ?? 0;
    if (isInDefaultCollection || collectionsCount > 0) return;

    const response = await invokeQfUser({ action: "delete-bookmark", qfBookmarkId });
    if (!response.ok) throw new Error(response.message);
    await db.runAsync(
      `UPDATE bookmarks
       SET qf_bookmark_id = NULL, qf_synced_at = ?, qf_sync_error = NULL
       WHERE surah = ? AND ayah = ?`,
      [new Date().toISOString(), parsedId.surah, parsedId.ayah]
    );
    return;
  }

  if (!local || local.deleted_at) return;
  if (local.qf_bookmark_id) {
    await db.runAsync(
      "UPDATE bookmarks SET qf_synced_at = ?, qf_sync_error = NULL WHERE surah = ? AND ayah = ?",
      [new Date().toISOString(), local.surah, local.ayah]
    );
    return;
  }

  const response = await invokeQfUser({
    action: "upsert-bookmark",
    bookmark: { surah: local.surah, ayah: local.ayah, mushafId: QF_DEFAULT_MUSHAF_ID },
  });
  if (!response.ok) throw new Error(response.message);
  if (!("bookmark" in response)) return;
  await attachQfBookmark(db, local, response.bookmark, { updateActiveState: false });
}

async function pushPrivateNoteEntry(db: SQLiteDatabase, entry: QfSyncQueueEntry): Promise<void> {
  const local = await db.getFirstAsync<LocalPrivateNoteRow>(
    "SELECT * FROM private_notes WHERE id = ?",
    [entry.local_id]
  );

  if (entry.operation === "DELETE") {
    const data = safeJson<Record<string, unknown>>(entry.data) ?? {};
    const qfNoteId = stringOrNull(data.qfNoteId) ?? local?.qf_note_id;
    if (!qfNoteId) return;
    const response = await invokeQfUser({ action: "delete-note", qfNoteId });
    if (!response.ok) throw new Error(response.message);
    await db.runAsync(
      "UPDATE private_notes SET qf_synced_at = ?, qf_sync_error = NULL WHERE id = ?",
      [new Date().toISOString(), entry.local_id]
    );
    return;
  }

  if (!local || local.deleted_at) return;
  if (!isQfSyncableNoteContent(local.content)) {
    await db.runAsync(
      "UPDATE private_notes SET qf_sync_error = ?, qf_synced_at = ? WHERE id = ?",
      ["Quran Foundation notes must be 6 to 10000 characters.", new Date().toISOString(), local.id]
    );
    return;
  }

  const range = buildQfRange(local.surah, local.ayah_start, local.ayah_end);
  const response = local.qf_note_id
    ? await invokeQfUser({
        action: "update-note",
        qfNoteId: local.qf_note_id,
        body: local.content,
        saveToQR: false,
      })
    : await invokeQfUser({
        action: "create-note",
        note: { body: local.content, ranges: [range], saveToQR: false },
      });
  if (!response.ok) throw new Error(response.message);
  if (!("note" in response)) return;
  await attachQfNote(db, local.id, response.note, [range], { enqueueSupabase: true });
}

async function pullQfRemoteChanges(db: SQLiteDatabase): Promise<number> {
  const startedAt = new Date().toISOString();
  const [bookmarks, notes] = await Promise.all([
    listAllQfBookmarks(),
    listAllQfNotes(),
  ]);

  let pulled = 0;
  await db.withTransactionAsync(async () => {
    for (const bookmark of bookmarks) {
      if (await mergeRemoteBookmark(db, bookmark)) pulled += 1;
    }
    await tombstoneMissingRemoteBookmarks(db, bookmarks, startedAt);

    for (const note of notes) {
      if (await mergeRemoteNote(db, note)) pulled += 1;
    }
    await tombstoneMissingRemoteNotes(db, notes, startedAt);
  });

  return pulled;
}

async function listAllQfBookmarks(): Promise<QfBookmark[]> {
  const bookmarks: QfBookmark[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const response = await invokeQfUser({ action: "list-bookmarks", after });
    if (!response.ok) throw new Error(response.message);
    if (!("bookmarks" in response)) return bookmarks;
    bookmarks.push(...response.bookmarks);
    after = response.nextCursor ?? undefined;
    if (!after) break;
  }
  return bookmarks;
}

async function listAllQfNotes(): Promise<QfNote[]> {
  const notes: QfNote[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const response = await invokeQfUser({
      action: "list-notes",
      cursor,
      limit: 50,
      sortBy: "newest",
    });
    if (!response.ok) throw new Error(response.message);
    if (!("notes" in response)) return notes;
    notes.push(...response.notes);
    cursor = response.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return notes;
}

async function mergeRemoteBookmark(db: SQLiteDatabase, remote: QfBookmark): Promise<boolean> {
  const local = await db.getFirstAsync<LocalBookmarkRow>(
    "SELECT * FROM bookmarks WHERE surah = ? AND ayah = ?",
    [remote.surah, remote.ayah]
  );
  const remoteCreatedAt = remote.createdAt || new Date().toISOString();

  if (local?.deleted_at && local.updated_at > remoteCreatedAt) {
    return false;
  }

  if (local) {
    await attachQfBookmark(db, local, remote, { updateActiveState: true });
    return true;
  }

  await db.runAsync(
    `INSERT INTO bookmarks
      (surah, ayah, created_at, updated_at, deleted_at, qf_bookmark_id, qf_synced_at,
       qf_sync_error, qf_is_in_default_collection, qf_collections_count)
     VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)`,
    [
      remote.surah,
      remote.ayah,
      remoteCreatedAt,
      remoteCreatedAt,
      remote.id,
      new Date().toISOString(),
      remote.isInDefaultCollection ? 1 : 0,
      remote.collectionsCount,
    ]
  );
  enqueueSync(db, "bookmarks", "INSERT", bookmarkLocalId(remote.surah, remote.ayah), {
    surah: remote.surah,
    ayah: remote.ayah,
    created_at: remoteCreatedAt,
    updated_at: remoteCreatedAt,
    deleted_at: null,
    qf_bookmark_id: remote.id,
    qf_synced_at: new Date().toISOString(),
    qf_sync_error: null,
    qf_is_in_default_collection: remote.isInDefaultCollection,
    qf_collections_count: remote.collectionsCount,
  }).catch(console.warn);
  return true;
}

async function attachQfBookmark(
  db: SQLiteDatabase,
  local: LocalBookmarkRow,
  remote: QfBookmark,
  options: { updateActiveState: boolean }
): Promise<void> {
  const now = new Date().toISOString();
  const updatedAt = options.updateActiveState && local.updated_at < remote.createdAt ? remote.createdAt : local.updated_at;
  const nextDeletedAt = options.updateActiveState ? null : local.deleted_at;
  const shouldEnqueueSupabase =
    local.qf_bookmark_id !== remote.id ||
    local.deleted_at !== nextDeletedAt ||
    updatedAt !== local.updated_at ||
    Boolean(local.qf_is_in_default_collection) !== remote.isInDefaultCollection ||
    (local.qf_collections_count ?? 0) !== remote.collectionsCount;
  await db.runAsync(
    `UPDATE bookmarks
     SET updated_at = ?, deleted_at = ?, qf_bookmark_id = ?, qf_synced_at = ?,
         qf_sync_error = NULL, qf_is_in_default_collection = ?, qf_collections_count = ?
     WHERE surah = ? AND ayah = ?`,
    [
      updatedAt,
      nextDeletedAt,
      remote.id,
      now,
      remote.isInDefaultCollection ? 1 : 0,
      remote.collectionsCount,
      local.surah,
      local.ayah,
    ]
  );
  if (shouldEnqueueSupabase) {
    enqueueSync(db, "bookmarks", "UPDATE", bookmarkLocalId(local.surah, local.ayah), {
      surah: local.surah,
      ayah: local.ayah,
      created_at: local.created_at,
      updated_at: updatedAt,
      deleted_at: nextDeletedAt,
      qf_bookmark_id: remote.id,
      qf_synced_at: now,
      qf_sync_error: null,
      qf_is_in_default_collection: remote.isInDefaultCollection,
      qf_collections_count: remote.collectionsCount,
    }).catch(console.warn);
  }
}

async function tombstoneMissingRemoteBookmarks(
  db: SQLiteDatabase,
  remoteBookmarks: QfBookmark[],
  startedAt: string
): Promise<void> {
  const remoteIds = new Set(remoteBookmarks.map((bookmark) => bookmark.id));
  const pending = await getPendingQfLocalIds(db, "bookmark");
  const rows = await db.getAllAsync<LocalBookmarkRow>(
    "SELECT * FROM bookmarks WHERE qf_bookmark_id IS NOT NULL AND deleted_at IS NULL"
  );
  const now = new Date().toISOString();
  for (const row of rows) {
    if (!row.qf_bookmark_id || remoteIds.has(row.qf_bookmark_id)) continue;
    const localId = bookmarkLocalId(row.surah, row.ayah);
    if (pending.has(localId) || row.updated_at >= startedAt) continue;
    await db.runAsync(
      "UPDATE bookmarks SET updated_at = ?, deleted_at = ?, qf_synced_at = ?, qf_sync_error = NULL WHERE surah = ? AND ayah = ?",
      [now, now, now, row.surah, row.ayah]
    );
    enqueueSync(db, "bookmarks", "UPDATE", localId, {
      surah: row.surah,
      ayah: row.ayah,
      created_at: row.created_at,
      updated_at: now,
      deleted_at: now,
      qf_bookmark_id: row.qf_bookmark_id,
      qf_synced_at: now,
      qf_sync_error: null,
      qf_is_in_default_collection: Boolean(row.qf_is_in_default_collection),
      qf_collections_count: row.qf_collections_count ?? 0,
    }).catch(console.warn);
  }
}

async function mergeRemoteNote(db: SQLiteDatabase, remote: QfNote): Promise<boolean> {
  const parsedRange = remote.ranges.map(parseQfRange).find((range) => range !== null);
  if (!parsedRange) return false;

  const localByQfId = await db.getFirstAsync<LocalPrivateNoteRow>(
    "SELECT * FROM private_notes WHERE qf_note_id = ?",
    [remote.id]
  );
  const updatedAt = remote.updatedAt || remote.createdAt || new Date().toISOString();
  const rangesJson = JSON.stringify(remote.ranges);

  if (localByQfId) {
    if (localByQfId.updated_at >= updatedAt) {
      await attachQfNote(db, localByQfId.id, remote, remote.ranges, { enqueueSupabase: false });
      return false;
    }
    await db.runAsync(
      `UPDATE private_notes
       SET surah = ?, ayah_start = ?, ayah_end = ?, content = ?, updated_at = ?,
           deleted_at = NULL, qf_note_id = ?, qf_synced_at = ?, qf_sync_error = NULL,
           qf_ranges_json = ?
       WHERE id = ?`,
      [
        parsedRange.surah,
        parsedRange.ayahStart,
        parsedRange.ayahEnd,
        remote.body,
        updatedAt,
        remote.id,
        new Date().toISOString(),
        rangesJson,
        localByQfId.id,
      ]
    );
    enqueueSync(db, "private_notes", "UPDATE", localByQfId.id, {
      id: localByQfId.id,
      surah: parsedRange.surah,
      ayah_start: parsedRange.ayahStart,
      ayah_end: parsedRange.ayahEnd,
      content: remote.body,
      created_at: localByQfId.created_at,
      updated_at: updatedAt,
      deleted_at: null,
      qf_note_id: remote.id,
      qf_synced_at: new Date().toISOString(),
      qf_sync_error: null,
      qf_ranges_json: remote.ranges,
    }).catch(console.warn);
    return true;
  }

  const exactLocal = await db.getFirstAsync<LocalPrivateNoteRow>(
    `SELECT * FROM private_notes
     WHERE qf_note_id IS NULL AND deleted_at IS NULL AND surah = ? AND ayah_start = ?
       AND ayah_end = ? AND content = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [parsedRange.surah, parsedRange.ayahStart, parsedRange.ayahEnd, remote.body]
  );
  if (exactLocal) {
    await attachQfNote(db, exactLocal.id, remote, remote.ranges, { enqueueSupabase: true });
    return true;
  }

  const localId = `qf:${remote.id}`;
  const createdAt = remote.createdAt || updatedAt;
  await db.runAsync(
    `INSERT OR REPLACE INTO private_notes
      (id, surah, ayah_start, ayah_end, content, created_at, updated_at, deleted_at,
       qf_note_id, qf_synced_at, qf_sync_error, qf_ranges_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?)`,
    [
      localId,
      parsedRange.surah,
      parsedRange.ayahStart,
      parsedRange.ayahEnd,
      remote.body,
      createdAt,
      updatedAt,
      remote.id,
      new Date().toISOString(),
      rangesJson,
    ]
  );
  enqueueSync(db, "private_notes", "INSERT", localId, {
    id: localId,
    surah: parsedRange.surah,
    ayah_start: parsedRange.ayahStart,
    ayah_end: parsedRange.ayahEnd,
    content: remote.body,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: null,
    qf_note_id: remote.id,
    qf_synced_at: new Date().toISOString(),
    qf_sync_error: null,
    qf_ranges_json: remote.ranges,
  }).catch(console.warn);
  return true;
}

async function attachQfNote(
  db: SQLiteDatabase,
  localId: string,
  remote: QfNote,
  fallbackRanges: string[],
  options: { enqueueSupabase: boolean }
): Promise<void> {
  await db.runAsync(
    "UPDATE private_notes SET qf_note_id = ?, qf_synced_at = ?, qf_sync_error = NULL, qf_ranges_json = ? WHERE id = ?",
    [remote.id, new Date().toISOString(), JSON.stringify(remote.ranges.length > 0 ? remote.ranges : fallbackRanges), localId]
  );
  if (!options.enqueueSupabase) return;
  const row = await db.getFirstAsync<LocalPrivateNoteRow>("SELECT * FROM private_notes WHERE id = ?", [localId]);
  if (row) {
    enqueueSync(db, "private_notes", "UPDATE", localId, noteToPayload(row)).catch(console.warn);
  }
}

async function tombstoneMissingRemoteNotes(
  db: SQLiteDatabase,
  remoteNotes: QfNote[],
  startedAt: string
): Promise<void> {
  const remoteIds = new Set(remoteNotes.map((note) => note.id));
  const pending = await getPendingQfLocalIds(db, "private_note");
  const rows = await db.getAllAsync<LocalPrivateNoteRow>(
    "SELECT * FROM private_notes WHERE qf_note_id IS NOT NULL AND deleted_at IS NULL"
  );
  const now = new Date().toISOString();
  for (const row of rows) {
    if (!row.qf_note_id || remoteIds.has(row.qf_note_id)) continue;
    if (pending.has(row.id) || row.updated_at >= startedAt) continue;
    await db.runAsync(
      "UPDATE private_notes SET updated_at = ?, deleted_at = ?, qf_synced_at = ?, qf_sync_error = NULL WHERE id = ?",
      [now, now, now, row.id]
    );
    enqueueSync(db, "private_notes", "UPDATE", row.id, {
      ...noteToPayload({ ...row, updated_at: now, deleted_at: now }),
      qf_synced_at: now,
      qf_sync_error: null,
    }).catch(console.warn);
  }
}

async function getPendingQfLocalIds(db: SQLiteDatabase, entityType: QfEntityType): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ local_id: string }>(
    "SELECT DISTINCT local_id FROM qf_sync_queue WHERE entity_type = ? AND status IN ('pending', 'failed')",
    [entityType]
  );
  return new Set(rows.map((row) => row.local_id));
}

async function findRemoteBookmarkId(surah: number, ayah: number): Promise<string | null> {
  const bookmarks = await listAllQfBookmarks();
  const match = bookmarks.find(
    (bookmark) =>
      bookmark.surah === surah &&
      bookmark.ayah === ayah &&
      !bookmark.isInDefaultCollection &&
      bookmark.collectionsCount === 0
  );
  return match?.id ?? null;
}

async function markQfSynced(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    "UPDATE qf_sync_queue SET status = 'synced', synced_at = ?, updated_at = ?, last_error = NULL WHERE id = ?",
    [new Date().toISOString(), new Date().toISOString(), id]
  );
}

async function markQfFailed(db: SQLiteDatabase, id: number, message: string): Promise<void> {
  await db.runAsync(
    `UPDATE qf_sync_queue
     SET status = 'failed', attempt_count = attempt_count + 1, last_error = ?, updated_at = ?
     WHERE id = ?`,
    [message, new Date().toISOString(), id]
  );
}

async function cleanSyncedQfEntries(db: SQLiteDatabase): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  await db.runAsync(
    "DELETE FROM qf_sync_queue WHERE status = 'synced' AND synced_at < ?",
    [cutoff.toISOString()]
  );
}

function noteToPayload(row: LocalPrivateNoteRow): Record<string, unknown> {
  const range = buildQfRange(row.surah, row.ayah_start, row.ayah_end);
  return {
    id: row.id,
    surah: row.surah,
    ayah_start: row.ayah_start,
    ayah_end: row.ayah_end,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    qf_note_id: row.qf_note_id,
    qf_synced_at: row.qf_synced_at,
    qf_sync_error: row.qf_sync_error,
    qf_ranges_json: row.qf_ranges_json ? safeJson(row.qf_ranges_json) : [range],
  };
}

function bookmarkLocalId(surah: number, ayah: number): string {
  return `${surah}:${ayah}`;
}

function parseBookmarkLocalId(localId: string): { surah: number; ayah: number } | null {
  const [surah, ayah] = localId.split(":").map(Number);
  if (!Number.isInteger(surah) || !Number.isInteger(ayah)) return null;
  return { surah, ayah };
}

function safeJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch (_) {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberFromUnknown(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanFromUnknown(value: unknown): boolean {
  return value === true || value === 1;
}
