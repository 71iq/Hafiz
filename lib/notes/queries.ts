import type { SQLiteDatabase } from "expo-sqlite";
import { enqueueSync } from "@/lib/database/sync-queue";
import { recordAchievementEvent } from "@/lib/achievements/queries";

export type PrivateNote = {
  id: string;
  surah: number;
  ayahStart: number;
  ayahEnd: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
};

export async function createPrivateNote(
  db: SQLiteDatabase,
  input: CreatePrivateNoteInput
): Promise<PrivateNote> {
  const now = new Date().toISOString();
  const id = createId();
  const content = input.content.trim();
  await db.runAsync(
    `INSERT INTO private_notes
      (id, surah, ayah_start, ayah_end, content, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [id, input.surah, input.ayahStart, input.ayahEnd, content, now, now]
  );
  const data = {
    id,
    surah: input.surah,
    ayah_start: input.ayahStart,
    ayah_end: input.ayahEnd,
    content,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  enqueueSync(db, "private_notes", "INSERT", id, data).catch(console.warn);
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
  await db.runAsync(
    "UPDATE private_notes SET content = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    [content.trim(), now, id]
  );
  const row = await db.getFirstAsync<PrivateNoteRow>("SELECT * FROM private_notes WHERE id = ?", [id]);
  if (row) {
    enqueueSync(db, "private_notes", "UPDATE", id, rowToSyncData(row)).catch(console.warn);
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
  };
}

function createId(): string {
  const maybeCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (maybeCrypto && typeof maybeCrypto.randomUUID === "function") {
    return maybeCrypto.randomUUID();
  }
  return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
