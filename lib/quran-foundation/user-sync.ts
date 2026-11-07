import type { SQLiteDatabase } from "expo-sqlite";
import { enqueueSync } from "@/lib/database/sync-queue";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { getQfConnectionStatus, invokeQfUser } from "./user";
import { captureQfRequestOwner, type QfSessionOwner } from "./request-owner";
import {
  readQfBookmarkAcknowledgement,
  readQfBookmarkRow,
  readQfNoteAcknowledgement,
  readQfNoteRow,
  requireQfDeleteAcknowledgement,
} from "./user-payloads";
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
type QfSyncConnectionState = "connected" | "not_connected" | "needs_reauth" | "failed";

export type QfSyncResult = {
  status: "synced" | "not_connected" | "needs_reauth" | "failed";
  pushed: number;
  pulled: number;
  message?: string;
};

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

type QfSyncOwner = QfSessionOwner;

function captureQfSyncOwner(): QfSyncOwner | null {
  if (!isSupabaseConfigured()) return null;
  return captureQfRequestOwner({
    getState: useAuthStore.getState,
    readSession: () => supabase.auth.getSession(),
  });
}

async function enqueueSupabase(...args: Parameters<typeof enqueueSync>): Promise<void> {
  try {
    await enqueueSync(...args);
  } catch (error) {
    console.warn(error);
  }
}

export async function enqueueQfSync(
  db: SQLiteDatabase,
  entityType: QfEntityType,
  operation: QfOperation,
  localId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO qf_sync_queue
      (entity_type, operation, local_id, data, status, attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [entityType, operation, localId, JSON.stringify(data), now, now],
  );
}

export async function getPendingQfSyncCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM qf_sync_queue WHERE status IN ('pending', 'failed')",
  );
  return row?.count ?? 0;
}

export async function runInitialQfUserSync(
  db: SQLiteDatabase,
  initiatingOwner?: QfSessionOwner | null,
): Promise<QfSyncResult> {
  const owner = initiatingOwner === undefined ? captureQfSyncOwner() : initiatingOwner;
  if (!owner) return { status: "not_connected", pushed: 0, pulled: 0 };
  owner.requireCurrent();
  const connection = await getQfSyncConnectionState(owner);
  owner.requireCurrent();
  if (connection !== "connected") return { status: connection, pushed: 0, pulled: 0 };

  const firstPull = await pullQfRemoteChanges(owner, db);
  owner.requireCurrent();
  await enqueueAllActiveLocalRows(owner, db);
  owner.requireCurrent();
  await markInitialLocalEnqueueDone(owner, db);
  owner.requireCurrent();
  const pushed = await pushQfSyncQueue(owner, db);
  owner.requireCurrent();
  const secondPull = await pullQfRemoteChanges(owner, db);
  owner.requireCurrent();
  return readQfSyncResult(owner, db, pushed, firstPull + secondPull);
}

export async function fullQfUserSync(db: SQLiteDatabase): Promise<QfSyncResult> {
  const owner = captureQfSyncOwner();
  if (!owner) return { status: "not_connected", pushed: 0, pulled: 0 };
  const connection = await getQfSyncConnectionState(owner);
  owner.requireCurrent();
  if (connection !== "connected") return { status: connection, pushed: 0, pulled: 0 };
  const needsInitial = await needsInitialLocalEnqueue(owner, db);
  owner.requireCurrent();
  if (needsInitial) {
    const firstPull = await pullQfRemoteChanges(owner, db);
    owner.requireCurrent();
    await enqueueAllActiveLocalRows(owner, db);
    owner.requireCurrent();
    await markInitialLocalEnqueueDone(owner, db);
    owner.requireCurrent();
    const pushed = await pushQfSyncQueue(owner, db);
    owner.requireCurrent();
    const secondPull = await pullQfRemoteChanges(owner, db);
    owner.requireCurrent();
    const result = await readQfSyncResult(owner, db, pushed, firstPull + secondPull);
    owner.requireCurrent();
    if (result.status === "synced") {
      await db.runAsync("INSERT OR REPLACE INTO user_settings (key, value) VALUES ('qf_last_sync_at', ?)", [
        new Date().toISOString(),
      ]);
      owner.requireCurrent();
    }
    return result;
  }
  const pushed = await pushQfSyncQueue(owner, db);
  owner.requireCurrent();
  const pulled = await pullQfRemoteChanges(owner, db);
  owner.requireCurrent();
  const result = await readQfSyncResult(owner, db, pushed, pulled);
  owner.requireCurrent();
  if (result.status === "synced") {
    await db.runAsync("INSERT OR REPLACE INTO user_settings (key, value) VALUES ('qf_last_sync_at', ?)", [
      new Date().toISOString(),
    ]);
    owner.requireCurrent();
  }
  return result;
}

async function readQfSyncResult(
  owner: QfSyncOwner,
  db: SQLiteDatabase,
  pushed: number,
  pulled: number,
): Promise<QfSyncResult> {
  owner.requireCurrent();
  const pending = await getPendingQfSyncCount(db);
  owner.requireCurrent();
  return { status: pending === 0 ? "synced" : "failed", pushed, pulled };
}

async function needsInitialLocalEnqueue(owner: QfSyncOwner, db: SQLiteDatabase): Promise<boolean> {
  owner.requireCurrent();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = 'qf_initial_local_enqueue_done'",
  );
  owner.requireCurrent();
  return row?.value !== "true";
}

async function markInitialLocalEnqueueDone(owner: QfSyncOwner, db: SQLiteDatabase): Promise<void> {
  owner.requireCurrent();
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('qf_initial_local_enqueue_done', 'true')",
  );
  owner.requireCurrent();
}

async function getQfSyncConnectionState(owner: QfSyncOwner): Promise<QfSyncConnectionState> {
  owner.requireCurrent();
  if (!isSupabaseConfigured()) return "not_connected";
  if (!useAuthStore.getState().user) return "not_connected";
  const status = await getQfConnectionStatus(owner);
  owner.requireCurrent();
  if (!status.ok) return status.code === "needs_reauth" ? "needs_reauth" : "failed";
  if (status.status === "needs_reauth") return "needs_reauth";
  return status.status === "connected" ? "connected" : "not_connected";
}

async function enqueueAllActiveLocalRows(owner: QfSyncOwner, db: SQLiteDatabase): Promise<void> {
  owner.requireCurrent();
  const bookmarks = await db.getAllAsync<LocalBookmarkRow>("SELECT * FROM bookmarks WHERE deleted_at IS NULL");
  owner.requireCurrent();
  for (const bookmark of bookmarks) {
    await enqueueQfSync(db, "bookmark", "UPSERT", bookmarkLocalId(bookmark.surah, bookmark.ayah), {
      surah: bookmark.surah,
      ayah: bookmark.ayah,
    });
    owner.requireCurrent();
  }

  const notes = await db.getAllAsync<LocalPrivateNoteRow>("SELECT * FROM private_notes WHERE deleted_at IS NULL");
  owner.requireCurrent();
  for (const note of notes) {
    await enqueueQfSync(db, "private_note", "UPSERT", note.id, noteToPayload(note));
    owner.requireCurrent();
  }
}

async function pushQfSyncQueue(owner: QfSyncOwner, db: SQLiteDatabase): Promise<number> {
  owner.requireCurrent();
  const entries = await db.getAllAsync<QfSyncQueueEntry>(
    `SELECT * FROM qf_sync_queue
     WHERE status IN ('pending', 'failed') AND attempt_count < 5
     ORDER BY id ASC
     LIMIT 100`,
  );
  owner.requireCurrent();
  let pushed = 0;

  for (const entry of entries) {
    try {
      if (entry.entity_type === "bookmark") {
        await pushBookmarkEntry(owner, db, entry);
        owner.requireCurrent();
      } else {
        await pushPrivateNoteEntry(owner, db, entry);
        owner.requireCurrent();
      }
      await markQfSynced(owner, db, entry.id);
      owner.requireCurrent();
      pushed += 1;
    } catch (error) {
      await markQfFailed(owner, db, entry.id, errorMessage(error));
      owner.requireCurrent();
    }
  }

  await cleanSyncedQfEntries(owner, db);
  owner.requireCurrent();
  return pushed;
}

async function pushBookmarkEntry(owner: QfSyncOwner, db: SQLiteDatabase, entry: QfSyncQueueEntry): Promise<void> {
  owner.requireCurrent();
  const parsedId = parseBookmarkLocalId(entry.local_id);
  if (!parsedId) return;
  const local = await db.getFirstAsync<LocalBookmarkRow>("SELECT * FROM bookmarks WHERE surah = ? AND ayah = ?", [
    parsedId.surah,
    parsedId.ayah,
  ]);
  owner.requireCurrent();

  if (entry.operation === "DELETE") {
    const data = safeJson<Record<string, unknown>>(entry.data) ?? {};
    const qfBookmarkId =
      stringOrNull(data.qfBookmarkId) ??
      local?.qf_bookmark_id ??
      (await findRemoteBookmarkId(owner, parsedId.surah, parsedId.ayah));
    owner.requireCurrent();
    if (!qfBookmarkId) return;

    const isInDefaultCollection =
      booleanFromUnknown(data.qfIsInDefaultCollection) || Boolean(local?.qf_is_in_default_collection);
    const collectionsCount = numberFromUnknown(data.qfCollectionsCount) ?? local?.qf_collections_count ?? 0;
    if (isInDefaultCollection || collectionsCount > 0) return;

    const response = await invokeQfUser({ action: "delete-bookmark", qfBookmarkId }, owner);
    owner.requireCurrent();
    if (!response.ok) throw new Error(response.message);
    requireQfDeleteAcknowledgement(response);
    await db.runAsync(
      `UPDATE bookmarks
       SET qf_bookmark_id = NULL, qf_synced_at = ?, qf_sync_error = NULL
       WHERE surah = ? AND ayah = ?`,
      [new Date().toISOString(), parsedId.surah, parsedId.ayah],
    );
    owner.requireCurrent();
    return;
  }

  if (!local || local.deleted_at) return;
  if (local.qf_bookmark_id) {
    await db.runAsync("UPDATE bookmarks SET qf_synced_at = ?, qf_sync_error = NULL WHERE surah = ? AND ayah = ?", [
      new Date().toISOString(),
      local.surah,
      local.ayah,
    ]);
    owner.requireCurrent();
    return;
  }

  const response = await invokeQfUser(
    {
      action: "upsert-bookmark",
      bookmark: { surah: local.surah, ayah: local.ayah, mushafId: QF_DEFAULT_MUSHAF_ID },
    },
    owner,
  );
  owner.requireCurrent();
  if (!response.ok) throw new Error(response.message);
  const bookmark = readQfBookmarkAcknowledgement(response, local);
  await attachQfBookmark(db, local, bookmark, {
    updateActiveState: false,
    enqueueMainSync: enqueueSupabase,
    requireCurrent: owner.requireCurrent,
  });
  owner.requireCurrent();
}

async function pushPrivateNoteEntry(owner: QfSyncOwner, db: SQLiteDatabase, entry: QfSyncQueueEntry): Promise<void> {
  owner.requireCurrent();
  const local = await db.getFirstAsync<LocalPrivateNoteRow>("SELECT * FROM private_notes WHERE id = ?", [
    entry.local_id,
  ]);
  owner.requireCurrent();

  if (entry.operation === "DELETE") {
    const data = safeJson<Record<string, unknown>>(entry.data) ?? {};
    const qfNoteId = stringOrNull(data.qfNoteId) ?? local?.qf_note_id;
    if (!qfNoteId) return;
    const response = await invokeQfUser({ action: "delete-note", qfNoteId }, owner);
    owner.requireCurrent();
    if (!response.ok) throw new Error(response.message);
    requireQfDeleteAcknowledgement(response);
    await db.runAsync("UPDATE private_notes SET qf_synced_at = ?, qf_sync_error = NULL WHERE id = ?", [
      new Date().toISOString(),
      entry.local_id,
    ]);
    owner.requireCurrent();
    return;
  }

  if (!local || local.deleted_at) return;
  if (!isQfSyncableNoteContent(local.content)) {
    await db.runAsync("UPDATE private_notes SET qf_sync_error = ?, qf_synced_at = ? WHERE id = ?", [
      "Quran Foundation notes must be 6 to 10000 characters.",
      new Date().toISOString(),
      local.id,
    ]);
    owner.requireCurrent();
    return;
  }

  const range = buildQfRange(local.surah, local.ayah_start, local.ayah_end);
  const response = local.qf_note_id
    ? await invokeQfUser(
        {
          action: "update-note",
          qfNoteId: local.qf_note_id,
          body: local.content,
          saveToQR: false,
        },
        owner,
      )
    : await invokeQfUser(
        {
          action: "create-note",
          note: { body: local.content, ranges: [range], saveToQR: false },
        },
        owner,
      );
  owner.requireCurrent();
  if (!response.ok) throw new Error(response.message);
  const note = readQfNoteAcknowledgement(response, local.qf_note_id || undefined);
  await attachQfNote(db, local.id, note, [range], {
    enqueueSupabase: true,
    enqueueMainSync: enqueueSupabase,
    requireCurrent: owner.requireCurrent,
  });
  owner.requireCurrent();
}

async function pullQfRemoteChanges(owner: QfSyncOwner, db: SQLiteDatabase): Promise<number> {
  owner.requireCurrent();
  const startedAt = new Date().toISOString();
  const [bookmarks, notes] = await Promise.all([listAllQfBookmarks(owner), listAllQfNotes(owner)]);
  owner.requireCurrent();

  let pulled = 0;
  await db.withTransactionAsync(async () => {
    // This nonexclusive transaction may already contain another local write.
    // Skip an obsolete merge without rolling that write back. Once admitted,
    // finish the existing merge before fencing its following phases.
    if (!owner.isCurrent()) return;
    for (const bookmark of bookmarks) {
      if (await mergeRemoteBookmark(db, bookmark)) pulled += 1;
    }
    await tombstoneMissingRemoteBookmarks(db, bookmarks, startedAt);

    for (const note of notes) {
      if (await mergeRemoteNote(db, note)) pulled += 1;
    }
    await tombstoneMissingRemoteNotes(db, notes, startedAt);
  });
  owner.requireCurrent();

  return pulled;
}

async function listAllQfBookmarks(owner: QfSyncOwner): Promise<QfBookmark[]> {
  owner.requireCurrent();
  const bookmarks: QfBookmark[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const response = await invokeQfUser({ action: "list-bookmarks", after }, owner);
    owner.requireCurrent();
    if (!response.ok) throw new Error(response.message);
    if (
      !("bookmarks" in response) ||
      !Array.isArray(response.bookmarks) ||
      (response.nextCursor != null && typeof response.nextCursor !== "string")
    ) {
      throw new Error("Incomplete Quran Foundation bookmarks list.");
    }
    bookmarks.push(...Array.from(response.bookmarks, readQfBookmarkRow));
    after = response.nextCursor ?? undefined;
    if (!after) return bookmarks;
  }
  throw new Error("Incomplete Quran Foundation bookmarks list.");
}

async function listAllQfNotes(owner: QfSyncOwner): Promise<QfNote[]> {
  owner.requireCurrent();
  const notes: QfNote[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const response = await invokeQfUser(
      {
        action: "list-notes",
        cursor,
        limit: 50,
        sortBy: "newest",
      },
      owner,
    );
    owner.requireCurrent();
    if (!response.ok) throw new Error(response.message);
    if (
      !("notes" in response) ||
      !Array.isArray(response.notes) ||
      (response.nextCursor != null && typeof response.nextCursor !== "string")
    ) {
      throw new Error("Incomplete Quran Foundation notes list.");
    }
    notes.push(...Array.from(response.notes, readQfNoteRow));
    cursor = response.nextCursor ?? undefined;
    if (!cursor) return notes;
  }
  throw new Error("Incomplete Quran Foundation notes list.");
}

async function mergeRemoteBookmark(db: SQLiteDatabase, remote: QfBookmark): Promise<boolean> {
  const local = await db.getFirstAsync<LocalBookmarkRow>("SELECT * FROM bookmarks WHERE surah = ? AND ayah = ?", [
    remote.surah,
    remote.ayah,
  ]);
  const remoteCreatedAt = remote.createdAt || new Date().toISOString();

  if (local?.deleted_at && local.updated_at > remoteCreatedAt) {
    return false;
  }

  if (local) {
    await attachQfBookmark(db, local, remote, { updateActiveState: true, enqueueMainSync: enqueueSync });
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
    ],
  );
  await enqueueSync(db, "bookmarks", "INSERT", bookmarkLocalId(remote.surah, remote.ayah), {
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
  });
  return true;
}

async function attachQfBookmark(
  db: SQLiteDatabase,
  local: LocalBookmarkRow,
  remote: QfBookmark,
  options: { updateActiveState: boolean; enqueueMainSync: typeof enqueueSync; requireCurrent?: () => void },
): Promise<void> {
  options.requireCurrent?.();
  const now = new Date().toISOString();
  const updatedAt =
    options.updateActiveState && local.updated_at < remote.createdAt ? remote.createdAt : local.updated_at;
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
    ],
  );
  options.requireCurrent?.();
  if (shouldEnqueueSupabase) {
    await options.enqueueMainSync(db, "bookmarks", "UPDATE", bookmarkLocalId(local.surah, local.ayah), {
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
    });
    options.requireCurrent?.();
  }
}

async function tombstoneMissingRemoteBookmarks(
  db: SQLiteDatabase,
  remoteBookmarks: QfBookmark[],
  startedAt: string,
): Promise<void> {
  const remoteIds = new Set(remoteBookmarks.map((bookmark) => bookmark.id));
  const pending = await getPendingQfLocalIds(db, "bookmark");
  const rows = await db.getAllAsync<LocalBookmarkRow>(
    "SELECT * FROM bookmarks WHERE qf_bookmark_id IS NOT NULL AND deleted_at IS NULL",
  );
  const now = new Date().toISOString();
  for (const row of rows) {
    if (!row.qf_bookmark_id || remoteIds.has(row.qf_bookmark_id)) continue;
    const localId = bookmarkLocalId(row.surah, row.ayah);
    if (pending.has(localId) || row.updated_at >= startedAt) continue;
    await db.runAsync(
      "UPDATE bookmarks SET updated_at = ?, deleted_at = ?, qf_synced_at = ?, qf_sync_error = NULL WHERE surah = ? AND ayah = ?",
      [now, now, now, row.surah, row.ayah],
    );
    await enqueueSync(db, "bookmarks", "UPDATE", localId, {
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
    });
  }
}

async function mergeRemoteNote(db: SQLiteDatabase, remote: QfNote): Promise<boolean> {
  const parsedRange = remote.ranges.map(parseQfRange).find((range) => range !== null);
  if (!parsedRange) return false;
  const remoteBody = remote.body.trim();
  if (!remoteBody) return false;

  const localByQfId = await db.getFirstAsync<LocalPrivateNoteRow>("SELECT * FROM private_notes WHERE qf_note_id = ?", [
    remote.id,
  ]);
  const updatedAt = remote.updatedAt || remote.createdAt || new Date().toISOString();
  const rangesJson = JSON.stringify(remote.ranges);

  if (localByQfId) {
    if (localByQfId.updated_at >= updatedAt) {
      await attachQfNote(db, localByQfId.id, remote, remote.ranges, {
        enqueueSupabase: false,
        enqueueMainSync: enqueueSync,
      });
      return false;
    }
    const duplicateLocal = await findExactLocalNote(
      db,
      parsedRange.surah,
      parsedRange.ayahStart,
      parsedRange.ayahEnd,
      remoteBody,
      localByQfId.id,
    );
    if (duplicateLocal) {
      await tombstoneLocalQfDuplicate(db, localByQfId);
      return true;
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
        remoteBody,
        updatedAt,
        remote.id,
        new Date().toISOString(),
        rangesJson,
        localByQfId.id,
      ],
    );
    await enqueueSync(db, "private_notes", "UPDATE", localByQfId.id, {
      id: localByQfId.id,
      surah: parsedRange.surah,
      ayah_start: parsedRange.ayahStart,
      ayah_end: parsedRange.ayahEnd,
      content: remoteBody,
      created_at: localByQfId.created_at,
      updated_at: updatedAt,
      deleted_at: null,
      qf_note_id: remote.id,
      qf_synced_at: new Date().toISOString(),
      qf_sync_error: null,
      qf_ranges_json: remote.ranges,
    });
    return true;
  }

  const exactLocal = await findExactLocalNote(
    db,
    parsedRange.surah,
    parsedRange.ayahStart,
    parsedRange.ayahEnd,
    remoteBody,
  );
  if (exactLocal) {
    if (exactLocal.qf_note_id && exactLocal.qf_note_id !== remote.id) return false;
    await attachQfNote(db, exactLocal.id, remote, remote.ranges, {
      enqueueSupabase: true,
      enqueueMainSync: enqueueSync,
    });
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
      remoteBody,
      createdAt,
      updatedAt,
      remote.id,
      new Date().toISOString(),
      rangesJson,
    ],
  );
  await enqueueSync(db, "private_notes", "INSERT", localId, {
    id: localId,
    surah: parsedRange.surah,
    ayah_start: parsedRange.ayahStart,
    ayah_end: parsedRange.ayahEnd,
    content: remoteBody,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: null,
    qf_note_id: remote.id,
    qf_synced_at: new Date().toISOString(),
    qf_sync_error: null,
    qf_ranges_json: remote.ranges,
  });
  return true;
}

async function attachQfNote(
  db: SQLiteDatabase,
  localId: string,
  remote: QfNote,
  fallbackRanges: string[],
  options: { enqueueSupabase: boolean; enqueueMainSync: typeof enqueueSync; requireCurrent?: () => void },
): Promise<void> {
  options.requireCurrent?.();
  await db.runAsync(
    "UPDATE private_notes SET qf_note_id = ?, qf_synced_at = ?, qf_sync_error = NULL, qf_ranges_json = ? WHERE id = ?",
    [
      remote.id,
      new Date().toISOString(),
      JSON.stringify(remote.ranges.length > 0 ? remote.ranges : fallbackRanges),
      localId,
    ],
  );
  options.requireCurrent?.();
  if (!options.enqueueSupabase) return;
  const row = await db.getFirstAsync<LocalPrivateNoteRow>("SELECT * FROM private_notes WHERE id = ?", [localId]);
  options.requireCurrent?.();
  if (row) {
    await options.enqueueMainSync(db, "private_notes", "UPDATE", localId, noteToPayload(row));
    options.requireCurrent?.();
  }
}

async function findExactLocalNote(
  db: SQLiteDatabase,
  surah: number,
  ayahStart: number,
  ayahEnd: number,
  body: string,
  excludeId?: string,
): Promise<LocalPrivateNoteRow | null> {
  return db.getFirstAsync<LocalPrivateNoteRow>(
    `SELECT * FROM private_notes
     WHERE deleted_at IS NULL AND surah = ? AND ayah_start = ? AND ayah_end = ? AND content = ?
       AND (? IS NULL OR id != ?)
     ORDER BY qf_note_id IS NULL DESC, updated_at DESC
     LIMIT 1`,
    [surah, ayahStart, ayahEnd, body.trim(), excludeId ?? null, excludeId ?? null],
  );
}

async function tombstoneLocalQfDuplicate(db: SQLiteDatabase, row: LocalPrivateNoteRow): Promise<void> {
  if (row.deleted_at) return;
  const now = new Date().toISOString();
  await db.runAsync(
    "UPDATE private_notes SET updated_at = ?, deleted_at = ?, qf_synced_at = ?, qf_sync_error = NULL WHERE id = ?",
    [now, now, now, row.id],
  );
  await enqueueSync(db, "private_notes", "UPDATE", row.id, {
    ...noteToPayload({ ...row, updated_at: now, deleted_at: now }),
    qf_synced_at: now,
    qf_sync_error: null,
  });
}

async function tombstoneMissingRemoteNotes(
  db: SQLiteDatabase,
  remoteNotes: QfNote[],
  startedAt: string,
): Promise<void> {
  const remoteIds = new Set(remoteNotes.map((note) => note.id));
  const pending = await getPendingQfLocalIds(db, "private_note");
  const rows = await db.getAllAsync<LocalPrivateNoteRow>(
    "SELECT * FROM private_notes WHERE qf_note_id IS NOT NULL AND deleted_at IS NULL",
  );
  const now = new Date().toISOString();
  for (const row of rows) {
    if (!row.qf_note_id || remoteIds.has(row.qf_note_id)) continue;
    if (pending.has(row.id) || row.updated_at >= startedAt) continue;
    await db.runAsync(
      "UPDATE private_notes SET updated_at = ?, deleted_at = ?, qf_synced_at = ?, qf_sync_error = NULL WHERE id = ?",
      [now, now, now, row.id],
    );
    await enqueueSync(db, "private_notes", "UPDATE", row.id, {
      ...noteToPayload({ ...row, updated_at: now, deleted_at: now }),
      qf_synced_at: now,
      qf_sync_error: null,
    });
  }
}

async function getPendingQfLocalIds(db: SQLiteDatabase, entityType: QfEntityType): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ local_id: string }>(
    "SELECT DISTINCT local_id FROM qf_sync_queue WHERE entity_type = ? AND status IN ('pending', 'failed')",
    [entityType],
  );
  return new Set(rows.map((row) => row.local_id));
}

async function findRemoteBookmarkId(owner: QfSyncOwner, surah: number, ayah: number): Promise<string | null> {
  owner.requireCurrent();
  const bookmarks = await listAllQfBookmarks(owner);
  owner.requireCurrent();
  const match = bookmarks.find(
    (bookmark) =>
      bookmark.surah === surah &&
      bookmark.ayah === ayah &&
      !bookmark.isInDefaultCollection &&
      bookmark.collectionsCount === 0,
  );
  return match?.id ?? null;
}

async function markQfSynced(owner: QfSyncOwner, db: SQLiteDatabase, id: number): Promise<void> {
  owner.requireCurrent();
  await db.runAsync(
    "UPDATE qf_sync_queue SET status = 'synced', synced_at = ?, updated_at = ?, last_error = NULL WHERE id = ?",
    [new Date().toISOString(), new Date().toISOString(), id],
  );
  owner.requireCurrent();
}

async function markQfFailed(owner: QfSyncOwner, db: SQLiteDatabase, id: number, message: string): Promise<void> {
  owner.requireCurrent();
  await db.runAsync(
    `UPDATE qf_sync_queue
     SET status = 'failed', attempt_count = attempt_count + 1, last_error = ?, updated_at = ?
     WHERE id = ?`,
    [message, new Date().toISOString(), id],
  );
  owner.requireCurrent();
}

async function cleanSyncedQfEntries(owner: QfSyncOwner, db: SQLiteDatabase): Promise<void> {
  owner.requireCurrent();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  await db.runAsync("DELETE FROM qf_sync_queue WHERE status = 'synced' AND synced_at < ?", [cutoff.toISOString()]);
  owner.requireCurrent();
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
  } catch {
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
