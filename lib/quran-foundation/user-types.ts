export const QF_OAUTH_PROVIDER = "custom:quran-foundation" as const;
export const QF_OAUTH_SCOPES = "openid offline_access bookmark note";
export const QF_DEFAULT_MUSHAF_ID = 1 as const;
export const QF_NOTE_MIN_LENGTH = 6;
export const QF_NOTE_MAX_LENGTH = 10000;

export type QfUserErrorCode =
  | "bad_request"
  | "not_configured"
  | "not_authenticated"
  | "not_connected"
  | "needs_reauth"
  | "rate_limited"
  | "upstream";

export type QfConnectionStatus = "connected" | "needs_reauth" | "disconnected";

export type QfUserError = {
  ok: false;
  code: QfUserErrorCode;
  message: string;
};

export type QfConnectionStatusResponse = {
  ok: true;
  status: QfConnectionStatus;
  env?: "prelive" | "production";
  connectedAt?: string | null;
  updatedAt?: string | null;
};

export type QfBookmark = {
  id: string;
  surah: number;
  ayah: number;
  type: "ayah";
  createdAt: string;
  isInDefaultCollection: boolean;
  collectionsCount: number;
};

export type QfNote = {
  id: string;
  body: string;
  ranges: string[];
  createdAt: string;
  updatedAt: string;
};

export type QfUserSuccess =
  | QfConnectionStatusResponse
  | { ok: true; status: "connected"; connectedAt: string }
  | { ok: true; status: "disconnected" }
  | { ok: true; bookmark: QfBookmark }
  | { ok: true; bookmarks: QfBookmark[]; nextCursor?: string | null }
  | { ok: true; note: QfNote }
  | { ok: true; notes: QfNote[]; nextCursor?: string | null }
  | { ok: true; deleted: true };

export type QfUserResponse = QfUserSuccess | QfUserError;

export type QfUserAction =
  | { action: "connect"; providerAccessToken: string; providerRefreshToken?: string; expiresAt?: string; scopes?: string[] }
  | { action: "status" }
  | { action: "disconnect" }
  | { action: "list-bookmarks"; after?: string }
  | { action: "upsert-bookmark"; bookmark: { surah: number; ayah: number; mushafId?: typeof QF_DEFAULT_MUSHAF_ID } }
  | { action: "delete-bookmark"; qfBookmarkId: string }
  | { action: "list-notes"; cursor?: string; limit?: number; sortBy?: "newest" | "oldest" }
  | { action: "create-note"; note: { body: string; ranges: string[]; saveToQR: false } }
  | { action: "update-note"; qfNoteId: string; body: string; saveToQR: false }
  | { action: "delete-note"; qfNoteId: string };

export type ParsedQfRange = {
  surah: number;
  ayahStart: number;
  ayahEnd: number;
};

export function buildQfRange(surah: number, ayahStart: number, ayahEnd: number): string {
  return `${surah}:${ayahStart}-${surah}:${ayahEnd}`;
}

export function parseQfRange(range: string): ParsedQfRange | null {
  const match = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(range.trim());
  if (!match) return null;
  const surahStart = Number(match[1]);
  const ayahStart = Number(match[2]);
  const surahEnd = Number(match[3]);
  const ayahEnd = Number(match[4]);
  if (
    !Number.isInteger(surahStart) ||
    !Number.isInteger(ayahStart) ||
    !Number.isInteger(surahEnd) ||
    !Number.isInteger(ayahEnd) ||
    surahStart !== surahEnd ||
    surahStart < 1 ||
    surahStart > 114 ||
    ayahStart < 1 ||
    ayahEnd < ayahStart
  ) {
    return null;
  }
  return { surah: surahStart, ayahStart, ayahEnd };
}

export function isQfSyncableNoteContent(content: string): boolean {
  const length = content.trim().length;
  return length >= QF_NOTE_MIN_LENGTH && length <= QF_NOTE_MAX_LENGTH;
}
