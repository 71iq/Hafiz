import type { DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting, removeUserSetting } from "@/lib/database/user-settings";
import {
  insertNewStudyCard,
  newStudyCardRow,
  putCardRow,
  putDeckReviewSettings,
  readDeckReviewSettings,
  type StartingSchedule,
} from "@/lib/fsrs/queries";
import { State } from "@/lib/fsrs/scheduler";
import { putAllDecksFilter, readSmartDeckFilter, SMART_DECK_IDS, type BuiltInDeckFilter } from "@/lib/fsrs/smart-decks";
import { DEFAULT_DECK_NEW_CARD_LIMIT, type StudyCardRow, type SurahAyahRange } from "@/lib/fsrs/types";
import { localDateOf } from "@/lib/habit/dates";
import { ensureManzilCycleStart } from "@/lib/hifz/pages";
import type { HifzPlan } from "@/lib/hifz/plan";
import { HIFZ_PAGES_DECK_ID, isValidPage, pageCardId } from "@/lib/hifz/units";

/**
 * UNIT-02, 7.6: switching the recitation unit. Moving to page review turns each page whose ayat all
 * have reviewed ayah cards into a manzil page card made from them and suspends those ayah cards.
 * Moving back to ayah review restores them and sets every page card aside, so ayah review has no
 * page tasks.
 *
 * A card suspended by a switch has suspended_at set to the Unix epoch. A card a switch brings back
 * has buried_until set to the epoch, which every queue reads as not buried. The marks live in the
 * card row, so they sync with the card (buried_until comes with suspended_at from the later write),
 * and the device whose plan wins can undo a losing switch made elsewhere (lib/hifz/unit-applied). A
 * card the user suspends or resumes later gets a real time or null: setting a card aside clears
 * buried_until, so a resume by hand carries no mark, and a switch never undoes the user's own choice.
 */
export const UNIT_SWITCH_SUSPENDED_AT = new Date(0).toISOString();
export const UNIT_SWITCH_RESUMED_BURIED_UNTIL = UNIT_SWITCH_SUSPENDED_AT;

/** Suspended by a unit switch. Compared as an instant, since the server can return another format. */
export function isUnitSwitchSuspension(suspendedAt: string | null | undefined): boolean {
  return !!suspendedAt && Date.parse(suspendedAt) === 0;
}

/** Active because a switch brought it back. Compared as an instant, like isUnitSwitchSuspension. */
export function isUnitSwitchResume(card: Pick<StudyCardRow, "suspended_at" | "buried_until">): boolean {
  return !card.suspended_at && !!card.buried_until && Date.parse(card.buried_until) === 0;
}

/**
 * The cards of page review: pages, and the half pages and seams their grades relearn (SCH-06,
 * SCH-08). Weak-spot cloze cards are word cards and stay in either unit.
 */
export const PAGE_REVIEW_CARDS_SQL = "(id LIKE 'page:%' OR id LIKE 'half:%' OR id LIKE 'seam:%')";

/** Set a live card aside with the switch mark, keeping its schedule and history for a switch back. */
export async function setAsideForUnitSwitch(db: DatabaseExecutor, card: StudyCardRow, at: string): Promise<void> {
  await putCardRow(db, { ...card, suspended_at: UNIT_SWITCH_SUSPENDED_AT, buried_until: null, updated_at: at });
}

/** A card brought back from the switch mark, carrying the resume mark. */
export function resumedFromUnitSwitch(card: StudyCardRow, at: string): StudyCardRow {
  return { ...card, suspended_at: null, buried_until: UNIT_SWITCH_RESUMED_BURIED_UNTIL, updated_at: at };
}

/** The ayah deck's new-card limit from before page review set it to 0, restored when ayah review returns. */
export const AYAH_NEW_CARDS_LIMIT_KEY = "hifz_ayah_new_cards_limit";

type Unit = HifzPlan["unit"];

export function reviewsPages(unit: Unit | null): boolean {
  return unit === "page" || unit === "half";
}

/** Each ayah's page, keyed by its ayah card id (surah:ayah). */
async function readAyahPages(db: DatabaseExecutor): Promise<Map<string, number>> {
  const rows = await db.getAllAsync<{ surah: number; ayah: number; page: number }>(
    "SELECT surah, ayah, v2_page AS page FROM quran_text WHERE v2_page > 0",
  );
  return new Map(rows.filter((row) => isValidPage(row.page)).map((row) => [`${row.surah}:${row.ayah}`, row.page]));
}

/**
 * The ayah-deck cards of each page whose ayat all have one that was reviewed, which is not new and has
 * a stability. Cards the user suspended still count: they were reviewed. Other pages are left out.
 */
async function reviewedPages(db: DatabaseExecutor): Promise<Map<number, StudyCardRow[]>> {
  const [ayahPages, cards] = await Promise.all([
    readAyahPages(db),
    db.getAllAsync<StudyCardRow>("SELECT * FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL", [
      SMART_DECK_IDS.retention,
    ]),
  ]);
  const ayatOnPage = new Map<number, number>();
  for (const page of ayahPages.values()) ayatOnPage.set(page, (ayatOnPage.get(page) ?? 0) + 1);
  const byPage = new Map<number, StudyCardRow[]>();
  for (const card of cards) {
    const page = ayahPages.get(card.id);
    if (page === undefined || card.state === State.New || !(card.stability > 0)) continue;
    byPage.set(page, [...(byPage.get(page) ?? []), card]);
  }
  // Card ids are unique, so as many reviewed cards as ayat means every ayah has one.
  return new Map([...byPage].filter(([page, list]) => list.length === ayatOnPage.get(page)));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 7.6: a page card's starting schedule from its ayah cards: the median stability, the mean difficulty
 * and the earliest due date. It was last reviewed when its most recent ayah was, so the next grade
 * counts the time since the page was last practised.
 */
function scheduleFromAyahCards(cards: readonly StudyCardRow[], now: Date): { start: StartingSchedule; due: Date } {
  const instants = (values: readonly (string | null)[]) =>
    values.map((value) => (value ? Date.parse(value) : NaN)).filter((value) => Number.isFinite(value));
  const dues = instants(cards.map((card) => card.due));
  const reviews = instants(cards.map((card) => card.last_review));
  const due = dues.length > 0 ? Math.min(...dues) : now.getTime();
  const lastReview = Math.min(now.getTime(), reviews.length > 0 ? Math.max(...reviews) : now.getTime());
  return {
    due: new Date(due),
    start: {
      stability: median(cards.map((card) => card.stability)),
      difficulty: cards.reduce((sum, card) => sum + card.difficulty, 0) / cards.length,
      lastReview: new Date(lastReview).toISOString(),
      scheduledDays: Math.max(0, Math.round((due - lastReview) / 86_400_000)),
    },
  };
}

function neverReviewed(card: StudyCardRow): boolean {
  return card.state === State.New && card.reps === 0 && !card.last_review;
}

/**
 * Switch to page or half-page review, with the caller's transaction (7.6). Page, half-page and seam
 * cards set aside by an earlier switch to ayah review come back with their history, as do pages
 * memorized in ayah review (lib/hifz/sabaq). Each page whose ayat all have reviewed
 * ayah cards gets a manzil page card made from them, unless it already has a reviewed page card, and
 * its ayah cards are suspended so the same ayat are not reviewed twice. A page card declared before
 * and never reviewed takes the ayah schedule instead of staying an unverified new card. Other pages
 * follow the declared path. The ayah deck stops adding new cards, and its limit from ayah review is
 * kept for the switch back. Returns how many page cards were made from ayah cards.
 */
export async function switchToPageReview(
  db: DatabaseExecutor,
  { previousUnit, now }: { previousUnit: Unit | null; now: Date },
): Promise<number> {
  const at = now.toISOString();
  const rows = await db.getAllAsync<StudyCardRow>(
    `SELECT * FROM study_cards WHERE deck_id = ? AND ${PAGE_REVIEW_CARDS_SQL} AND deleted_at IS NULL`,
    [HIFZ_PAGES_DECK_ID],
  );
  const pageCards = new Map<string, StudyCardRow>();
  for (const row of rows) {
    const current = isUnitSwitchSuspension(row.suspended_at) ? resumedFromUnitSwitch(row, at) : row;
    if (current !== row) await putCardRow(db, current);
    if (row.id.startsWith("page:")) pageCards.set(row.id, current);
  }

  let migrated = 0;
  for (const [page, cards] of await reviewedPages(db)) {
    const id = pageCardId(page);
    const existing = pageCards.get(id);
    if (!existing || neverReviewed(existing)) {
      const { start, due } = scheduleFromAyahCards(cards, now);
      const card = { id, deckId: HIFZ_PAGES_DECK_ID, due, tier: "manzil", now: at, start };
      if (!existing) {
        if (await insertNewStudyCard(db, card)) migrated += 1;
      } else {
        const { suspended_at, buried_until, marked_at, created_at } = existing;
        await putCardRow(db, {
          ...existing,
          ...newStudyCardRow(card),
          suspended_at,
          buried_until,
          marked_at,
          created_at,
        });
        migrated += 1;
      }
    }
    for (const card of cards) {
      if (card.suspended_at) continue;
      await setAsideForUnitSwitch(db, card, at);
    }
  }
  // Ayah cards still active, on pages not all reviewed, stay in page review and drop the resume mark,
  // so a reconcile does not take them for a losing switch's and set them aside.
  const kept = await db.getAllAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL AND suspended_at IS NULL AND buried_until IS NOT NULL",
    [SMART_DECK_IDS.retention],
  );
  for (const card of kept.filter(isUnitSwitchResume)) await putCardRow(db, { ...card, buried_until: null, updated_at: at });
  // MST-04: like declared pages, pages made from ayah cards start the first manzil cycle.
  if (migrated > 0) await ensureManzilCycleStart(db, localDateOf(now));

  const retention = await readDeckReviewSettings(db, SMART_DECK_IDS.retention);
  // Only a switch from ayah review records the limit: in page review it is already 0.
  if (!reviewsPages(previousUnit)) await putUserSetting(db, AYAH_NEW_CARDS_LIMIT_KEY, String(retention.newCardsLimit));
  if (retention.newCardsLimit !== 0) {
    await putDeckReviewSettings(db, SMART_DECK_IDS.retention, { ...retention, newCardsLimit: 0 });
  }
  return migrated;
}

/**
 * Switch to ayah review, with the caller's transaction (7.6). The ayah cards a switch to page review
 * suspended come back with their schedules. Every live page, half-page and seam card is set aside the
 * same way, kept with its history for a later switch to page review: ayah review has no page tasks,
 * and the memorized ayat are reviewed in the ayah deck instead. Cards the user suspended stay as they
 * are. Coming from page review, the ayah deck gets back the new-card limit it
 * had, or the default when this device did not record it, unless the user set a limit meanwhile.
 * Returns how many ayah cards came back.
 */
export async function switchToAyahReview(
  db: DatabaseExecutor,
  { previousUnit, now }: { previousUnit: Unit | null; now: Date },
): Promise<number> {
  const at = now.toISOString();
  const suspended = await db.getAllAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL AND suspended_at IS NOT NULL",
    [SMART_DECK_IDS.retention],
  );
  const restored = suspended.filter((card) => isUnitSwitchSuspension(card.suspended_at));
  for (const card of restored) await putCardRow(db, resumedFromUnitSwitch(card, at));

  const pageReviewCards = await db.getAllAsync<StudyCardRow>(
    `SELECT * FROM study_cards WHERE deck_id = ? AND ${PAGE_REVIEW_CARDS_SQL} AND deleted_at IS NULL AND suspended_at IS NULL`,
    [HIFZ_PAGES_DECK_ID],
  );
  for (const card of pageReviewCards) await setAsideForUnitSwitch(db, card, at);

  const stored = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ? AND deleted_at IS NULL",
    [AYAH_NEW_CARDS_LIMIT_KEY],
  );
  if (reviewsPages(previousUnit)) {
    const retention = await readDeckReviewSettings(db, SMART_DECK_IDS.retention);
    const recorded = Number(stored?.value);
    const limit = stored && Number.isInteger(recorded) && recorded >= 0 ? recorded : DEFAULT_DECK_NEW_CARD_LIMIT;
    if (retention.newCardsLimit === 0 && limit !== 0) {
      await putDeckReviewSettings(db, SMART_DECK_IDS.retention, { ...retention, newCardsLimit: limit });
    }
  }
  if (stored) await removeUserSetting(db, AYAH_NEW_CARDS_LIMIT_KEY);
  return restored.length;
}

/**
 * A page memorized through sabaq in ayah review (SBQ-02, UNIT-02), with the chunk grade's transaction.
 * Its page card, created as in page review, is set aside with the switch mark, so it joins page review
 * on a switch to pages. Each of its ayat gets an ayah card that starts from the page's schedule, so the
 * new lines enter ayah review. An ayah card already reviewed, or suspended by the user, keeps its own
 * schedule; one never reviewed takes the page's.
 */
export async function addSabaqPageToAyahReview(
  db: DatabaseExecutor,
  { page, start, due, now }: { page: number; start: StartingSchedule | null; due: Date; now: Date },
): Promise<void> {
  const at = now.toISOString();
  const pageCard = await db.getFirstAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE id = ? AND deleted_at IS NULL AND suspended_at IS NULL",
    [pageCardId(page)],
  );
  if (pageCard) await setAsideForUnitSwitch(db, pageCard, at);
  const ayat = await db.getAllAsync<{ surah: number; ayah: number }>(
    "SELECT surah, ayah FROM quran_text WHERE v2_page = ? ORDER BY surah, ayah",
    [page],
  );
  for (const { surah, ayah } of ayat) {
    const card = { id: `${surah}:${ayah}`, deckId: SMART_DECK_IDS.retention, due, now: at, start };
    const existing = await db.getFirstAsync<StudyCardRow>("SELECT * FROM study_cards WHERE id = ? AND deleted_at IS NULL", [
      card.id,
    ]);
    if (!existing) {
      await insertNewStudyCard(db, card);
    } else if (start && existing.deck_id === SMART_DECK_IDS.retention && !existing.suspended_at && neverReviewed(existing)) {
      const { suspended_at, buried_until, marked_at, created_at } = existing;
      await putCardRow(db, { ...existing, ...newStudyCardRow(card), suspended_at, buried_until, marked_at, created_at });
    }
  }
}

/** One surah's ayat on a page, with the number of ayat in the surah. */
export type AyahSpan = Readonly<{ surah: number; first: number; last: number; count: number }>;

/**
 * The ayah decks' surah filter widened to cover the spans, or null when it already does. A surah
 * covered whole stays whole, a surah limited to a range grows to take the span, and a new surah comes
 * in whole when the span is all of it and as that range otherwise. The filter holds one range per
 * surah, so two separate spans of one surah also take the ayat between them. "All" covers every ayah,
 * and a juz filter stays as the person chose it.
 */
export function filterCoveringSpans(filter: BuiltInDeckFilter, spans: readonly AyahSpan[]): BuiltInDeckFilter | null {
  if (filter.type !== "surah") return null;
  const surahs = new Set(filter.surahs);
  const ranges = new Map((filter.ranges ?? []).map((range) => [range.surah, range]));
  let changed = false;
  for (const span of spans) {
    const range = ranges.get(span.surah);
    if (surahs.has(span.surah) && !range) continue;
    const ayahStart = Math.min(range?.ayahStart ?? span.first, span.first);
    const ayahEnd = Math.max(range?.ayahEnd ?? span.last, span.last);
    if (range && range.ayahStart === ayahStart && range.ayahEnd === ayahEnd) continue;
    changed = true;
    surahs.add(span.surah);
    if (ayahStart <= 1 && ayahEnd >= span.count) ranges.delete(span.surah);
    else ranges.set(span.surah, { surah: span.surah, ayahStart, ayahEnd });
  }
  if (!changed) return null;
  const sortedRanges: SurahAyahRange[] = [...ranges.values()].sort((a, b) => a.surah - b.surah);
  return { type: "surah", surahs: [...surahs].sort((a, b) => a - b), ...(sortedRanges.length > 0 ? { ranges: sortedRanges } : {}) };
}

/**
 * SBQ-02 in ayah review: the ayah decks take in a page memorized through sabaq, as setup scopes them
 * to the memorized surahs (applyHifzSetup), so its new ayah cards are reviewed. Runs inside the
 * caller's transaction, so a failed grade leaves the filters as they were.
 */
export async function coverPageInAyahReview(db: DatabaseExecutor, page: number): Promise<void> {
  const spans = await db.getAllAsync<AyahSpan>(
    `SELECT p.surah AS surah, MIN(p.ayah) AS first, MAX(p.ayah) AS last,
            (SELECT MAX(q.ayah) FROM quran_text AS q WHERE q.surah = p.surah) AS count
       FROM quran_text AS p WHERE p.v2_page = ? GROUP BY p.surah ORDER BY p.surah`,
    [page],
  );
  const widened = filterCoveringSpans(await readSmartDeckFilter(db, SMART_DECK_IDS.retention), spans);
  if (widened) await putAllDecksFilter(db, widened);
}
