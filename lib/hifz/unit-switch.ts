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
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { DEFAULT_DECK_NEW_CARD_LIMIT, type StudyCardRow } from "@/lib/fsrs/types";
import { localDateOf } from "@/lib/habit/dates";
import { ensureManzilCycleStart } from "@/lib/hifz/pages";
import type { HifzPlan } from "@/lib/hifz/plan";
import { HIFZ_PAGES_DECK_ID, isValidPage, pageCardId } from "@/lib/hifz/units";

/**
 * UNIT-02, 7.6: switching the recitation unit. Moving to page review turns each page whose ayat all
 * have reviewed ayah cards into a manzil page card made from them and suspends those ayah cards.
 * Moving back to ayah review restores them.
 *
 * A card suspended by a switch has suspended_at set to the Unix epoch. The mark lives in the card
 * row, so it syncs with the card and another device can switch back too. A card the user suspends or
 * resumes later gets a real time or null, so a switch never undoes the user's own choice.
 */
export const UNIT_SWITCH_SUSPENDED_AT = new Date(0).toISOString();

/** Suspended by a unit switch. Compared as an instant, since the server can return another format. */
export function isUnitSwitchSuspension(suspendedAt: string | null | undefined): boolean {
  return !!suspendedAt && Date.parse(suspendedAt) === 0;
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
 * Switch to page or half-page review, with the caller's transaction (7.6). Page cards set aside by an
 * earlier switch to ayah review come back with their history. Each page whose ayat all have reviewed
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
  const pageRows = await db.getAllAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE deck_id = ? AND id LIKE 'page:%' AND deleted_at IS NULL",
    [HIFZ_PAGES_DECK_ID],
  );
  const pageCards = new Map<string, StudyCardRow>();
  for (const row of pageRows) {
    const current = isUnitSwitchSuspension(row.suspended_at) ? { ...row, suspended_at: null, updated_at: at } : row;
    if (current !== row) await putCardRow(db, current);
    pageCards.set(row.id, current);
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
      await putCardRow(db, { ...card, suspended_at: UNIT_SWITCH_SUSPENDED_AT, buried_until: null, updated_at: at });
    }
  }
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
 * suspended come back with their schedules. Their pages' cards are suspended the same way, kept with
 * their history for a later switch to page review, so those ayat are not reviewed twice. Coming from
 * page review, the ayah deck gets back the new-card limit it had, or the default when this device did
 * not record it, unless the user set a limit meanwhile. Returns how many ayah cards came back.
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
  for (const card of restored) await putCardRow(db, { ...card, suspended_at: null, updated_at: at });

  if (restored.length > 0) {
    const ayahPages = await readAyahPages(db);
    const pages = new Set(restored.flatMap((card) => ayahPages.get(card.id) ?? []));
    for (const page of pages) {
      const row = await db.getFirstAsync<StudyCardRow>(
        "SELECT * FROM study_cards WHERE id = ? AND deleted_at IS NULL AND suspended_at IS NULL",
        [pageCardId(page)],
      );
      if (row)
        await putCardRow(db, { ...row, suspended_at: UNIT_SWITCH_SUSPENDED_AT, buried_until: null, updated_at: at });
    }
  }

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
