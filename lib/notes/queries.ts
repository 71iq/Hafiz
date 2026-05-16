import type { SQLiteDatabase } from "expo-sqlite";
import { enqueueSync } from "@/lib/database/sync-queue";
import { recordAchievementEvent } from "@/lib/achievements/queries";
import { enqueueQfSync } from "@/lib/quran-foundation/user-sync";
import {
  QF_NOTE_MAX_LENGTH,
  QF_NOTE_MIN_LENGTH,
  buildQfRange,
  isQfSyncableNoteContent,
} from "@/lib/quran-foundation/user-types";

export type PrivateNote = {
  id: string;
  surah: number;
  ayahStart: number;
  ayahEnd: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  qfNoteId: string | null;
  qfSyncedAt: string | null;
  qfSyncError: string | null;
  qfRangesJson: string | null;
};

export type CreatePrivateNoteInput = {
  surah: number;
  ayahStart: number;
  ayahEnd: number;
  content: string;
};

type PrivateNoteRow = {
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

export async function createPrivateNote(
  db: SQLiteDatabase,
  input: CreatePrivateNoteInput
): Promise<PrivateNote> {
  const now = new Date().toISOString();
  const id = createId();
  const content = input.content.trim();
  assertQfNoteContent(content);
  const rangesJson = JSON.stringify([buildQfRange(input.surah, input.ayahStart, input.ayahEnd)]);
  await db.runAsync(
    `INSERT INTO private_notes
      (id, surah, ayah_start, ayah_end, content, created_at, updated_at, deleted_at,
       qf_note_id, qf_synced_at, qf_sync_error, qf_ranges_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
    [id, input.surah, input.ayahStart, input.ayahEnd, content, now, now, rangesJson]
  );
  const data: PrivateNoteRow = {
    id,
    surah: input.surah,
    ayah_start: input.ayahStart,
    ayah_end: input.ayahEnd,
    content,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    qf_note_id: null,
    qf_synced_at: null,
    qf_sync_error: null,
    qf_ranges_json: rangesJson,
  };
  enqueueSync(db, "private_notes", "INSERT", id, rowToSyncData(data)).catch(console.warn);
  enqueueQfSync(db, "private_note", "UPSERT", id, rowToSyncData(data)).catch(console.warn);
  recordAchievementEvent(db, {
    type: "private_note_created",
    noteId: id,
    surah: input.surah,
    ayahStart: input.ayahStart,
    ayahEnd: input.ayahEnd,
    createdAt: now,
  }).catch(console.warn);
  return rowToNote(data);
}

export async function updatePrivateNote(
  db: SQLiteDatabase,
  id: string,
  content: string
): Promise<void> {
  const now = new Date().toISOString();
  const trimmed = content.trim();
  assertQfNoteContent(trimmed);
  await db.runAsync(
    "UPDATE private_notes SET content = ?, updated_at = ?, qf_sync_error = NULL WHERE id = ? AND deleted_at IS NULL",
    [trimmed, now, id]
  );
  const row = await db.getFirstAsync<PrivateNoteRow>("SELECT * FROM private_notes WHERE id = ?", [id]);
  if (row) {
    enqueueSync(db, "private_notes", "UPDATE", id, rowToSyncData(row)).catch(console.warn);
    enqueueQfSync(db, "private_note", "UPSERT", id, rowToSyncData(row)).catch(console.warn);
  }
}

export async function deletePrivateNote(db: SQLiteDatabase, id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    "UPDATE private_notes SET updated_at = ?, deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
    [now, now, id]
  );
  const row = await db.getFirstAsync<PrivateNoteRow>("SELECT * FROM private_notes WHERE id = ?", [id]);
  if (row) {
    enqueueSync(db, "private_notes", "UPDATE", id, rowToSyncData(row)).catch(console.warn);
    enqueueQfSync(db, "private_note", "DELETE", id, {
      ...rowToSyncData(row),
      qfNoteId: row.qf_note_id,
    }).catch(console.warn);
  }
}

export async function listPrivateNotesForAyah(
  db: SQLiteDatabase,
  surah: number,
  ayah: number
): Promise<PrivateNote[]> {
  const rows = await db.getAllAsync<PrivateNoteRow>(
    `SELECT * FROM private_notes
     WHERE surah = ? AND ayah_start <= ? AND ayah_end >= ? AND deleted_at IS NULL
     ORDER BY updated_at DESC`,
    [surah, ayah, ayah]
  );
  return rows.map(rowToNote);
}

function rowToNote(row: PrivateNoteRow): PrivateNote {
  return {
    id: row.id,
    surah: row.surah,
    ayahStart: row.ayah_start,
    ayahEnd: row.ayah_end,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    qfNoteId: row.qf_note_id,
    qfSyncedAt: row.qf_synced_at,
    qfSyncError: row.qf_sync_error,
    qfRangesJson: row.qf_ranges_json,
  };
}

function rowToSyncData(row: PrivateNoteRow): Record<string, unknown> {
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
    qf_ranges_json: row.qf_ranges_json ? safeJson(row.qf_ranges_json) : null,
  };
}

function assertQfNoteContent(content: string): void {
  if (!isQfSyncableNoteContent(content)) {
    throw new Error(`Private notes must be ${QF_NOTE_MIN_LENGTH}-${QF_NOTE_MAX_LENGTH} characters.`);
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (_) {
    return value;
  }
}

function createId(): string {
  const maybeCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (maybeCrypto && typeof maybeCrypto.randomUUID === "function") {
    return maybeCrypto.randomUUID();
  }
  return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
