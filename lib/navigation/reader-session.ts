import { isValidAyah, isValidPage } from "@/lib/search/reference";

export type ReaderPosition = { mode: "page"; page: number } | { mode: "verse"; surah: number; ayah: number };

export const RETURN_PILL_MS = 5000;
export const ARRIVAL_MS = 3000;

export function parseSavedPosition(raw: string | null | undefined): ReaderPosition | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.mode === "page" && isValidPage(value.page)) return { mode: "page", page: value.page };
    if (value?.mode === "verse" && isValidAyah(value.surah, value.ayah)) {
      return { mode: "verse", surah: value.surah, ayah: value.ayah };
    }
  } catch {
  }
  return null;
}

export function serializePosition(position: ReaderPosition): string {
  return JSON.stringify(
    position.mode === "page"
      ? { mode: "page", page: position.page }
      : { mode: "verse", surah: position.surah, ayah: position.ayah },
  );
}

export function samePosition(a: ReaderPosition | null, b: ReaderPosition | null): boolean {
  if (!a || !b || a.mode !== b.mode) return false;
  return a.mode === "page"
    ? a.page === (b as typeof a).page
    : a.surah === (b as typeof a).surah && a.ayah === (b as typeof a).ayah;
}

export type ReaderPositionSession = {
  restoreSettled: boolean;
  explicitTarget: boolean;
  held: boolean;
};

export type ReaderPositionEvent = "restore-settled" | "explicit-jump" | "deliberate-move";

export const INITIAL_POSITION_SESSION: ReaderPositionSession = {
  restoreSettled: false,
  explicitTarget: false,
  held: false,
};

export function reducePositionSession(
  session: ReaderPositionSession,
  event: ReaderPositionEvent,
): ReaderPositionSession {
  switch (event) {
    case "restore-settled":
      return session.restoreSettled ? session : { ...session, restoreSettled: true };
    case "explicit-jump":
      return { ...session, explicitTarget: true, held: true };
    case "deliberate-move":
      return session.held ? { ...session, held: false } : session;
  }
}

export function mayApplySavedPosition(session: ReaderPositionSession): boolean {
  return !session.explicitTarget;
}

export function mayPersistPosition(session: ReaderPositionSession): boolean {
  return session.restoreSettled && !session.held;
}

export type ReturnToken = {
  id: number;
  position: ReaderPosition;
  owner: string | null;
};

export function captureReturnToken(
  position: ReaderPosition | null,
  owner: string | null,
  id: number,
): ReturnToken | null {
  return position ? { id, position, owner } : null;
}

export function expireReturnToken(current: ReturnToken | null, id: number): ReturnToken | null {
  return current?.id === id ? null : current;
}

export function takeReturnToken(
  current: ReturnToken | null,
  id: number,
  owner: string | null,
): { position: ReaderPosition | null; next: ReturnToken | null } {
  if (!current || current.id !== id) return { position: null, next: current };
  if (current.owner !== owner) return { position: null, next: null };
  return { position: current.position, next: null };
}
