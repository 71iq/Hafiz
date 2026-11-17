import type { DatabaseExecutor } from "@/lib/database/types";
import type { QfAudioResponse } from "./content";

const QF_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type CachedQfAudio = QfAudioResponse & {
  isStale: boolean;
};

type AudioCacheRow = {
  recitation_id: number;
  surah: number;
  ayah: number;
  verse_key: string;
  url: string;
  duration: number | null;
  format: string | null;
  segments_json: string | null;
  reciter_name: string | null;
  recitation_style: string | null;
  fetched_at: string;
};

export async function readCachedAyahAudio(
  db: DatabaseExecutor,
  surah: number,
  ayah: number,
  recitationId: number,
): Promise<CachedQfAudio | null> {
  const row = await db.getFirstAsync<AudioCacheRow>(
    `SELECT * FROM qf_ayah_audio_cache
     WHERE recitation_id = ? AND surah = ? AND ayah = ?`,
    [recitationId, surah, ayah],
  );
  if (!row) return null;
  return {
    ok: true,
    recitationId: row.recitation_id,
    verseKey: row.verse_key,
    audio: {
      url: row.url,
      duration: row.duration ?? undefined,
      format: row.format ?? undefined,
      segments: parseJson(row.segments_json),
      reciterName: row.reciter_name ?? undefined,
      recitationStyle: row.recitation_style ?? undefined,
    },
    fetchedAt: row.fetched_at,
    isStale: isStale(row.fetched_at),
  };
}

export async function writeCachedAyahAudio(
  db: DatabaseExecutor,
  response: QfAudioResponse,
  surah: number,
  ayah: number,
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO qf_ayah_audio_cache
      (recitation_id, surah, ayah, verse_key, url, duration, format, segments_json, reciter_name, recitation_style, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      response.recitationId,
      surah,
      ayah,
      response.verseKey,
      response.audio.url,
      response.audio.duration ?? null,
      response.audio.format ?? null,
      response.audio.segments === undefined ? null : JSON.stringify(response.audio.segments),
      response.audio.reciterName ?? null,
      response.audio.recitationStyle ?? null,
      response.fetchedAt,
    ],
  );
}

function isStale(fetchedAt: string): boolean {
  const time = Date.parse(fetchedAt);
  if (!Number.isFinite(time)) return true;
  return Date.now() - time > QF_CACHE_TTL_MS;
}

function parseJson(value: string | null): any {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
