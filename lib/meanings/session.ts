import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting } from "@/lib/database/user-settings";
import {
  getDeckQueueOptions,
  loadReviewQueue,
  MEANINGS_DECK_ID,
  readDeckReviewSettings,
  type ReviewQueueItem,
} from "@/lib/fsrs/queries";
import { materializeSmartCardIds } from "@/lib/fsrs/smart-decks";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { localDateOf } from "@/lib/habit/dates";
import { pickMeaningCandidates } from "@/lib/meanings/candidates";
import { meaningCardIdAt, MAX_LEVEL } from "@/lib/meanings/lemma-index";
import { readMeaningsSettings, writeMeaningsLevel } from "@/lib/meanings/settings";

/**
 * The meanings deck opened alone from All decks: its rows, then today's generated candidates up to
 * what its limits leave, each created just before the session shows it (SPEC 3.6).
 */
export async function loadMeaningsReviewQueue(db: AppDatabase, now = new Date()): Promise<ReviewQueueItem[]> {
  const [queue, settings] = await Promise.all([
    loadReviewQueue(db, MEANINGS_DECK_ID),
    readDeckReviewSettings(db, MEANINGS_DECK_ID),
  ]);
  const options = await getDeckQueueOptions(db, MEANINGS_DECK_ID, settings);
  const newInQueue = queue.filter((item) => item.card.state === 0).length;
  const room = Math.min((options?.newCardsLimit ?? 0) - newInQueue, (options?.limit ?? 0) - queue.length);
  if (room <= 0) return queue;
  const candidates = await pickMeaningCandidates(db, { now, limit: room });
  const ids = candidates.map((candidate) => meaningCardIdAt(candidate.position));
  if (ids.length === 0) return queue;
  await materializeSmartCardIds(db, MEANINGS_DECK_ID, ids);
  const rows = await db.getAllAsync<StudyCardRow>(
    `SELECT * FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => "?").join(", ")})`,
    [MEANINGS_DECK_ID, ...ids],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return [...queue, ...ids.flatMap((id) => (byId.has(id) ? [{ card: byId.get(id)!, settings }] : []))];
}

/**
 * First reviews of new word cards, kept on this device: "I know this" five times in a row offers to
 * raise the level by one, and three failed first reviews in a row offer to lower it. A declined offer
 * is not made again the same day.
 */
const FIRST_REVIEWS_KEY = "device_meanings_first_reviews";
const KNOWN_RUN = 5;
const FAILED_RUN = 3;

type FirstReviews = { known: number; failed: number; declined: { raise?: string; lower?: string } };
export type LevelOffer = "raise" | "lower";
export type FirstReviewOutcome = "known" | "failed" | "other";

async function readFirstReviews(db: DatabaseExecutor): Promise<FirstReviews> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [
    FIRST_REVIEWS_KEY,
  ]);
  try {
    const parsed = row?.value ? (JSON.parse(row.value) as Partial<FirstReviews>) : {};
    return {
      known: Number.isInteger(parsed.known) ? parsed.known! : 0,
      failed: Number.isInteger(parsed.failed) ? parsed.failed! : 0,
      declined: parsed.declined && typeof parsed.declined === "object" ? parsed.declined : {},
    };
  } catch {
    return { known: 0, failed: 0, declined: {} };
  }
}

function writeFirstReviews(db: AppDatabase, value: FirstReviews): Promise<void> {
  return db.withTransactionAsync((tx) => putUserSetting(tx, FIRST_REVIEWS_KEY, JSON.stringify(value)));
}

/** Records a new word card's first review and returns the level offer it earns, if any. */
export async function recordFirstReview(
  db: AppDatabase,
  outcome: FirstReviewOutcome,
  now = new Date(),
): Promise<LevelOffer | null> {
  const [runs, settings] = await Promise.all([readFirstReviews(db), readMeaningsSettings(db)]);
  const today = localDateOf(now);
  const next: FirstReviews = {
    known: outcome === "known" ? runs.known + 1 : 0,
    failed: outcome === "failed" ? runs.failed + 1 : 0,
    declined: runs.declined,
  };
  let offer: LevelOffer | null = null;
  if (next.known >= KNOWN_RUN && settings.level < MAX_LEVEL && runs.declined.raise !== today) {
    offer = "raise";
    next.known = 0;
  } else if (next.failed >= FAILED_RUN && settings.level > 0 && runs.declined.lower !== today) {
    offer = "lower";
    next.failed = 0;
  }
  await writeFirstReviews(db, next);
  return offer;
}

/** Applies an accepted offer: one band more or less counted as known, within 0 to 5. */
export async function acceptLevelOffer(db: AppDatabase, offer: LevelOffer): Promise<void> {
  const { level } = await readMeaningsSettings(db);
  await writeMeaningsLevel(db, offer === "raise" ? level + 1 : level - 1);
}

export async function declineLevelOffer(db: AppDatabase, offer: LevelOffer, now = new Date()): Promise<void> {
  const runs = await readFirstReviews(db);
  await writeFirstReviews(db, { ...runs, declined: { ...runs.declined, [offer]: localDateOf(now) } });
}
