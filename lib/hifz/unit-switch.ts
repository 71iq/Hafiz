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

export const UNIT_SWITCH_SUSPENDED_AT = new Date(0).toISOString();
export const UNIT_SWITCH_RESUMED_BURIED_UNTIL = UNIT_SWITCH_SUSPENDED_AT;

export function isUnitSwitchSuspension(suspendedAt: string | null | undefined): boolean {
  return !!suspendedAt && Date.parse(suspendedAt) === 0;
}

export function isUnitSwitchResume(card: Pick<StudyCardRow, "suspended_at" | "buried_until">): boolean {
  return !card.suspended_at && !!card.buried_until && Date.parse(card.buried_until) === 0;
}

export const PAGE_REVIEW_CARDS_SQL = "(id LIKE 'page:%' OR id LIKE 'half:%' OR id LIKE 'seam:%')";

export async function setAsideForUnitSwitch(db: DatabaseExecutor, card: StudyCardRow, at: string): Promise<void> {
  await putCardRow(db, { ...card, suspended_at: UNIT_SWITCH_SUSPENDED_AT, buried_until: null, updated_at: at });
}

export function resumedFromUnitSwitch(card: StudyCardRow, at: string): StudyCardRow {
  return { ...card, suspended_at: null, buried_until: UNIT_SWITCH_RESUMED_BURIED_UNTIL, updated_at: at };
}

export const AYAH_NEW_CARDS_LIMIT_KEY = "hifz_ayah_new_cards_limit";

type Unit = HifzPlan["unit"];

export function reviewsPages(unit: Unit | null): boolean {
  return unit === "page" || unit === "half";
}

async function readAyahPages(db: DatabaseExecutor): Promise<Map<string, number>> {
  const rows = await db.getAllAsync<{ surah: number; ayah: number; page: number }>(
    "SELECT surah, ayah, v2_page AS page FROM quran_text WHERE v2_page > 0",
  );
  return new Map(rows.filter((row) => isValidPage(row.page)).map((row) => [`${row.surah}:${row.ayah}`, row.page]));
}

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
  return new Map([...byPage].filter(([page, list]) => list.length === ayatOnPage.get(page)));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

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
  const kept = await db.getAllAsync<StudyCardRow>(
    "SELECT * FROM study_cards WHERE deck_id = ? AND deleted_at IS NULL AND suspended_at IS NULL AND buried_until IS NOT NULL",
    [SMART_DECK_IDS.retention],
  );
  for (const card of kept.filter(isUnitSwitchResume)) await putCardRow(db, { ...card, buried_until: null, updated_at: at });
  if (migrated > 0) await ensureManzilCycleStart(db, localDateOf(now));

  const retention = await readDeckReviewSettings(db, SMART_DECK_IDS.retention);
  if (!reviewsPages(previousUnit)) await putUserSetting(db, AYAH_NEW_CARDS_LIMIT_KEY, String(retention.newCardsLimit));
  if (retention.newCardsLimit !== 0) {
    await putDeckReviewSettings(db, SMART_DECK_IDS.retention, { ...retention, newCardsLimit: 0 });
  }
  return migrated;
}

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

export type AyahSpan = Readonly<{ surah: number; first: number; last: number; count: number }>;

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
