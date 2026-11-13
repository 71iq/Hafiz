import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { enqueueSync } from "@/lib/database/sync-queue";
import { deviceTimeZone, localDateOf, type LocalDate } from "@/lib/habit/dates";
import { createId } from "@/lib/id";

/** 4.4 session kinds. `cards` is the existing deck review. */
const SESSION_KINDS = [
  "cards",
  "wird",
  "sabaq",
  "mistakes",
  "juz_check",
  "portion_check",
  "welcome_back",
  "seams",
  "mutashabihat",
  "listening",
  "full_juz",
  "salah",
] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];
export type SessionSource = "app" | "salah" | "listener";

export type ReviewSessionRow = {
  id: string;
  kind: SessionKind;
  deck_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  local_date: LocalDate;
  tz: string;
  cards_reviewed: number;
  pages_reviewed: number;
  new_lines: number;
  clean_pages: number;
  errors: number;
  minimum_met: number;
  full_met: number;
  source: SessionSource;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/** The session a screen is running. Its row is written on the first grade, so empty sessions leave nothing. */
export type ReviewSessionRef = Readonly<{
  id: string;
  kind: SessionKind;
  deckId: string | null;
  startedAt: string;
  source: SessionSource;
}>;

export function startReviewSession(
  kind: SessionKind,
  { deckId = null, source = "app", now = new Date() }: { deckId?: string | null; source?: SessionSource; now?: Date } = {},
): ReviewSessionRef {
  return { id: createId("session"), kind, deckId, startedAt: now.toISOString(), source };
}

const SESSION_COLUMNS =
  "id, kind, deck_id, started_at, ended_at, duration_ms, local_date, tz, cards_reviewed, pages_reviewed, new_lines, clean_pages, errors, minimum_met, full_met, source, created_at, updated_at, deleted_at";

function sessionSyncData(row: ReviewSessionRow): Record<string, unknown> {
  return { ...row, minimum_met: row.minimum_met === 1, full_met: row.full_met === 1 };
}

async function writeSession(db: DatabaseExecutor, row: ReviewSessionRow): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO review_sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.kind,
      row.deck_id,
      row.started_at,
      row.ended_at,
      row.duration_ms,
      row.local_date,
      row.tz,
      row.cards_reviewed,
      row.pages_reviewed,
      row.new_lines,
      row.clean_pages,
      row.errors,
      row.minimum_met,
      row.full_met,
      row.source,
      row.created_at,
      row.updated_at,
      row.deleted_at,
    ],
  );
  await enqueueSync(db, "review_sessions", "UPDATE", row.id, sessionSyncData(row));
}

export async function readReviewSession(db: DatabaseExecutor, id: string): Promise<ReviewSessionRow | null> {
  return db.getFirstAsync<ReviewSessionRow>(`SELECT ${SESSION_COLUMNS} FROM review_sessions WHERE id = ?`, [id]);
}

export type SessionProgressDelta = Readonly<{
  cards?: number;
  pages?: number;
  newLines?: number;
  cleanPages?: number;
  errors?: number;
  minimumMet?: boolean;
}>;

function elapsedMs(startedAt: string, now: Date): number {
  return Math.max(0, now.getTime() - new Date(startedAt).getTime());
}

/** Add one grade's counts to the session row, creating it on the first grade (DB-01). */
export async function recordSessionProgress(
  db: DatabaseExecutor,
  session: ReviewSessionRef,
  delta: SessionProgressDelta,
  now: Date,
): Promise<ReviewSessionRow> {
  const at = now.toISOString();
  const existing = await readReviewSession(db, session.id);
  const base: ReviewSessionRow = existing ?? {
    id: session.id,
    kind: session.kind,
    deck_id: session.deckId,
    started_at: session.startedAt,
    ended_at: null,
    duration_ms: 0,
    local_date: localDateOf(new Date(session.startedAt)),
    tz: deviceTimeZone(),
    cards_reviewed: 0,
    pages_reviewed: 0,
    new_lines: 0,
    clean_pages: 0,
    errors: 0,
    minimum_met: 0,
    full_met: 0,
    source: session.source,
    created_at: at,
    updated_at: at,
    deleted_at: null,
  };
  const next: ReviewSessionRow = {
    ...base,
    duration_ms: elapsedMs(base.started_at, now),
    cards_reviewed: base.cards_reviewed + (delta.cards ?? 0),
    pages_reviewed: base.pages_reviewed + (delta.pages ?? 0),
    new_lines: base.new_lines + (delta.newLines ?? 0),
    clean_pages: base.clean_pages + (delta.cleanPages ?? 0),
    errors: base.errors + (delta.errors ?? 0),
    minimum_met: base.minimum_met === 1 || delta.minimumMet ? 1 : 0,
    updated_at: at,
  };
  await writeSession(db, next);
  return next;
}

/** Close a session that graded at least one card. A session with no grades has no row and is left alone. */
export async function endReviewSession(
  database: AppDatabase,
  { session, now = new Date(), fullMet = false }: { session: ReviewSessionRef; now?: Date; fullMet?: boolean },
): Promise<ReviewSessionRow | null> {
  let ended: ReviewSessionRow | null = null;
  await database.withTransactionAsync(async (db) => {
    const row = await readReviewSession(db, session.id);
    if (!row || row.ended_at !== null) {
      ended = row;
      return;
    }
    const at = now.toISOString();
    ended = {
      ...row,
      ended_at: at,
      duration_ms: elapsedMs(row.started_at, now),
      full_met: row.full_met === 1 || fullMet ? 1 : 0,
      updated_at: at,
    };
    await writeSession(db, ended);
  });
  return ended;
}

