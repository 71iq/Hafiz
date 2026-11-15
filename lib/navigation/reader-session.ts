/**
 * Pure rules for the reader's C06 target contract: which position is saved, when saved-position
 * hydration may move the reader, and the transient "Back to where I was" token. The Mushaf screen
 * owns the React state; these helpers keep the decisions testable without rendering it.
 */
import { isValidAyah, isValidPage } from "@/lib/search/reference";

/** The stored `last_mushaf_position` value. Its JSON shape is unchanged from earlier releases. */
export type ReaderPosition = { mode: "page"; page: number } | { mode: "verse"; surah: number; ayah: number };

/** How long the return pill stays available after an explicit jump. */
export const RETURN_PILL_MS = 5000;
/** How long an arrival wash stays when the reader does not tap first. */
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
    // An unreadable value falls back to the reader's default position.
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

/**
 * Saved-position bookkeeping for one reader visit. An explicit target outranks hydration, and an
 * arrival is not saved until the reader deliberately scrolls, pages or switches view.
 */
export type ReaderPositionSession = {
  /** The saved-position restore attempt finished (applied, skipped or failed). */
  restoreSettled: boolean;
  /** An explicit target arrived; a later hydration result must not move the reader. */
  explicitTarget: boolean;
  /** The reader is resting on an arrival it has not engaged with. */
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

/** Hydration may move the reader only when no explicit target has arrived during this visit. */
export function mayApplySavedPosition(session: ReaderPositionSession): boolean {
  return !session.explicitTarget;
}

/** The visible position is saved once restore settled and the reader engaged with it. */
export function mayPersistPosition(session: ReaderPositionSession): boolean {
  return session.restoreSettled && !session.held;
}

/** One captured pre-jump position for the shared "Back to where I was" pill. */
export type ReturnToken = {
  id: number;
  position: ReaderPosition;
  /** Account or guest owner at capture; another owner never restores it. */
  owner: string | null;
};

/** A later jump replaces the token; with no previous position there is no pill. */
export function captureReturnToken(
  position: ReaderPosition | null,
  owner: string | null,
  id: number,
): ReturnToken | null {
  return position ? { id, position, owner } : null;
}

/** A timer may clear only the token it was started for. */
export function expireReturnToken(current: ReturnToken | null, id: number): ReturnToken | null {
  return current?.id === id ? null : current;
}

/** Restores the captured position once; afterwards the token is gone. */
export function takeReturnToken(
  current: ReturnToken | null,
  id: number,
  owner: string | null,
): { position: ReaderPosition | null; next: ReturnToken | null } {
  if (!current || current.id !== id) return { position: null, next: current };
  if (current.owner !== owner) return { position: null, next: null };
  return { position: current.position, next: null };
}
