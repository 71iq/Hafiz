import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { getDeckQueueOptions, getDeckTodayStats, MEANINGS_DECK_ID } from "@/lib/fsrs/queries";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { createEmptyCard } from "@/lib/fsrs/scheduler";
import type { DeckReviewSettings, StudyCardRow } from "@/lib/fsrs/types";
import { localDateOf } from "@/lib/habit/dates";
import { newPageOrder } from "@/lib/hifz/memorize";
import { readMemorizedPageNumbers, readTodayPlanPageNumbers } from "@/lib/hifz/pages";
import { readHifzPlan } from "@/lib/hifz/plan";
import {
  loadLemmaIndex,
  meaningCardIdAt,
  parseMeaningCardId,
  positionKey,
  type Band,
  type WordPosition,
} from "@/lib/meanings/lemma-index";
import { readMeaningsSettings } from "@/lib/meanings/settings";

/**
 * Today's generated word-meaning candidates (SPEC 3.6): one per lemma, in the user's meaning
 * language, past the bands their level counts as known, never for a lemma that already has a `word:`
 * row (live or deleted: deleting a word removes it for good). Read only: a session creates the rows
 * of the candidates it shows.
 *
 * Scope: the memorized pages, or the whole Quran with none memorized. Order: words on today's plan
 * work first (the day's review pages and the next page to memorize, or for an ayah plan the ayat of
 * today's due Retention cards), in mushaf order; then the rest of the scope, commonest band first,
 * then in mushaf order. That is the link to the wird: the words met today come first.
 */
export type MeaningCandidate = Readonly<{ position: WordPosition; lemmaKey: string; band: Band; today: boolean }>;

const ayahPages = new WeakMap<object, Promise<Map<string, number>>>();

/** Each ayah's page in the 604-page mushaf, read once per database. */
function loadAyahPages(db: DatabaseExecutor): Promise<Map<string, number>> {
  const cached = ayahPages.get(db);
  if (cached) return cached;
  const loaded = db
    .getAllAsync<{ surah: number; ayah: number; page: number }>("SELECT surah, ayah, v2_page AS page FROM quran_text")
    .then((rows) => new Map(rows.map((row) => [`${row.surah}:${row.ayah}`, row.page])))
    .catch((error: unknown) => {
      ayahPages.delete(db);
      throw error;
    });
  ayahPages.set(db, loaded);
  return loaded;
}

const byMushaf = (a: WordPosition, b: WordPosition) => a.surah - b.surah || a.ayah - b.ayah || a.pos - b.pos;

/** The ayat of today's plan work: the day's review pages and next lesson page, or due Retention ayat. */
async function todaysAyat(db: DatabaseExecutor, now: Date, pages: Map<string, number>): Promise<Set<string>> {
  const plan = await readHifzPlan(db);
  if (!plan) return new Set();
  if (plan.unit === "ayah") {
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL AND suspended_at IS NULL
         AND state <> 0 AND due <= ?`,
      [SMART_DECK_IDS.retention, now.toISOString()],
    );
    return new Set(rows.flatMap((row) => (/^\d+:\d+$/.test(row.id) ? [row.id] : [])));
  }
  const [reviewPages, memorized] = await Promise.all([
    readTodayPlanPageNumbers(db, localDateOf(now)),
    readMemorizedPageNumbers(db),
  ]);
  const lessonPage = plan.newPerDay > 0 ? newPageOrder(plan).find((page) => !memorized.has(page)) : undefined;
  const wanted = new Set([...reviewPages, ...(lessonPage === undefined ? [] : [lessonPage])]);
  return new Set([...pages].flatMap(([ayah, page]) => (wanted.has(page) ? [ayah] : [])));
}

export async function pickMeaningCandidates(
  db: DatabaseExecutor,
  { now = new Date(), limit }: { now?: Date; limit: number },
): Promise<MeaningCandidate[]> {
  if (limit <= 0) return [];
  const [index, settings, pages, memorized, wordRows] = await Promise.all([
    loadLemmaIndex(db),
    readMeaningsSettings(db),
    loadAyahPages(db),
    readMemorizedPageNumbers(db),
    db.getAllAsync<{ id: string }>("SELECT id FROM study_cards WHERE id LIKE 'word:%'"),
  ]);
  const today = await todaysAyat(db, now, pages);
  // A lemma with any word row, live or deleted, gets no candidate.
  const taken = new Set<string>();
  for (const row of wordRows) {
    const position = parseMeaningCardId(row.id);
    const entry = position ? index.lemmaAt.get(positionKey(position.surah, position.ayah, position.pos)) : undefined;
    if (entry) taken.add(entry.key);
  }
  const inScope = (position: WordPosition) =>
    memorized.size === 0 || memorized.has(pages.get(`${position.surah}:${position.ayah}`) ?? 0);

  const todays: MeaningCandidate[] = [];
  const rest: MeaningCandidate[] = [];
  for (const entry of index.lemmas) {
    if (entry.band < settings.level || taken.has(entry.key)) continue;
    const positions = entry.positions[settings.language];
    const met = positions.find((position) => today.has(`${position.surah}:${position.ayah}`));
    if (met) {
      todays.push({ position: met, lemmaKey: entry.key, band: entry.band, today: true });
      continue;
    }
    const first = positions.find(inScope);
    if (first) rest.push({ position: first, lemmaKey: entry.key, band: entry.band, today: false });
  }
  todays.sort((a, b) => byMushaf(a.position, b.position));
  // index.lemmas is commonest first, so a stable sort by band keeps rank order inside a band; the
  // spec orders a band in mushaf order.
  rest.sort((a, b) => a.band - b.band || byMushaf(a.position, b.position));
  return [...todays, ...rest].slice(0, limit);
}

/** Candidates as the virtual rows the daily queue and the deck's counts carry until a session creates them. */
export function candidateRows(candidates: readonly MeaningCandidate[], now = new Date()): StudyCardRow[] {
  const empty = createEmptyCard(now);
  const stamp = now.toISOString();
  return candidates.map((candidate) => ({
    id: meaningCardIdAt(candidate.position),
    deck_id: MEANINGS_DECK_ID,
    due: stamp,
    stability: empty.stability,
    difficulty: empty.difficulty,
    elapsed_days: empty.elapsed_days,
    scheduled_days: empty.scheduled_days,
    learning_steps: empty.learning_steps,
    reps: empty.reps,
    lapses: empty.lapses,
    state: empty.state,
    last_review: null,
    suspended_at: null,
    buried_until: null,
    marked_at: null,
    created_at: stamp,
    updated_at: stamp,
  }));
}

/**
 * The meanings deck's counts for today with its candidates as new cards, for All decks: the deck is
 * worth opening, and shows what its session will load, before any generated row exists.
 */
export async function getMeaningsTodayStats(
  db: AppDatabase,
  settings: DeckReviewSettings,
  now = new Date(),
): Promise<Awaited<ReturnType<typeof getDeckTodayStats>>> {
  const [stats, options] = await Promise.all([
    getDeckTodayStats(db, MEANINGS_DECK_ID, settings),
    getDeckQueueOptions(db, MEANINGS_DECK_ID, settings),
  ]);
  const newRoom = Math.max(0, (options?.newCardsLimit ?? 0) - stats.newCount);
  const reviewRoom = Math.max(0, (options?.limit ?? 0) - stats.newCount - stats.dueCount);
  const candidates = await pickMeaningCandidates(db, { now, limit: Math.min(newRoom, reviewRoom) });
  return { ...stats, total: stats.total + candidates.length, newCount: stats.newCount + candidates.length };
}
