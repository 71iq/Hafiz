import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DatabaseExecutor } from "@/lib/database/types";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { subscribeHabitChanged } from "@/lib/habit/use-habit-overview";
import { readMemorizedPageNumbers } from "@/lib/hifz/pages";
import { similarGroupsOnPages, withMemorizedSiblings, type SimilarGroup } from "@/lib/hifz/similar";
import { isValidPage } from "@/lib/hifz/units";
import { subscribeSyncCompleted } from "@/lib/sync/events";

export type SimilarMarks = ReadonlyMap<string, readonly SimilarGroup[]>;

type Store = Readonly<{
  db: DatabaseExecutor | null;
  memorized: ReadonlySet<number> | null;
  memorizedFailed: boolean;
  pages: ReadonlyMap<number, readonly SimilarGroup[]>;
  failedPages: ReadonlySet<number>;
}>;

const EMPTY_STORE: Store = {
  db: null,
  memorized: null,
  memorizedFailed: false,
  pages: new Map(),
  failedPages: new Set(),
};
let store: Store = EMPTY_STORE;
const listeners = new Set<() => void>();
const pagesInFlight = new Set<number>();
let memorizedReading = false;
let memorizedStale = false;
let generation = 0;
let stopEvents: (() => void) | null = null;

const NO_MARKS: SimilarMarks = new Map();
const NO_GROUPS: readonly SimilarGroup[] = [];

function publish(next: Partial<Store>): void {
  store = { ...store, ...next };
  for (const listener of listeners) listener();
}

function adoptConnection(db: DatabaseExecutor): void {
  if (store.db === db) return;
  generation += 1;
  pagesInFlight.clear();
  memorizedReading = false;
  memorizedStale = false;
  store = { ...EMPTY_STORE, db };
}

function sameSet(a: ReadonlySet<number> | null, b: ReadonlySet<number>): boolean {
  return a !== null && a.size === b.size && [...b].every((page) => a.has(page));
}

function readMemorized(db: DatabaseExecutor): void {
  if (memorizedReading) {
    memorizedStale = true;
    return;
  }
  const load = generation;
  memorizedReading = true;
  memorizedStale = false;
  readMemorizedPageNumbers(db)
    .then((pages) => {
      if (load !== generation) return;
      if (!sameSet(store.memorized, pages) || store.memorizedFailed)
        publish({ memorized: pages, memorizedFailed: false });
    })
    .catch((error: unknown) => {
      if (load !== generation) return;
      console.warn("[SimilarMarkers] Memorized pages failed to load:", error);
      publish({ memorizedFailed: true });
    })
    .finally(() => {
      if (load !== generation) return;
      memorizedReading = false;
      if (memorizedStale && listeners.size > 0) readMemorized(db);
    });
}

function readPage(db: DatabaseExecutor, page: number): void {
  if (store.pages.has(page) || store.failedPages.has(page) || pagesInFlight.has(page)) return;
  const load = generation;
  pagesInFlight.add(page);
  similarGroupsOnPages(db, [page])
    .then((groups) => {
      if (load !== generation) return;
      publish({ pages: new Map(store.pages).set(page, groups) });
    })
    .catch((error: unknown) => {
      if (load !== generation) return;
      console.warn(`[SimilarMarkers] Similar verses failed to load for page ${page}:`, error);
      publish({ failedPages: new Set(store.failedPages).add(page) });
    })
    .finally(() => {
      if (load === generation) pagesInFlight.delete(page);
    });
}

function ensure(db: DatabaseExecutor, page: number): void {
  adoptConnection(db);
  if (store.memorized === null && !store.memorizedFailed) readMemorized(db);
  readPage(db, page);
}

function refresh(): void {
  const db = store.db;
  if (!db || listeners.size === 0) return;
  readMemorized(db);
  const retry = [...store.failedPages];
  if (retry.length === 0) return;
  publish({ failedPages: new Set() });
  for (const page of retry) readPage(db, page);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!stopEvents) {
    const stops = [
      subscribeReviewActivity(refresh),
      subscribeHabitChanged(refresh),
      subscribeSyncCompleted(({ pulled }) => {
        if (pulled > 0) refresh();
      }),
    ];
    stopEvents = () => stops.forEach((stop) => stop());
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopEvents) {
      stopEvents();
      stopEvents = null;
      publish({ memorized: null });
    }
  };
}

const subscribeNever = () => () => undefined;

export function similarMarksOf(groups: readonly SimilarGroup[], memorized: ReadonlySet<number>): SimilarMarks {
  const marks = new Map<string, SimilarGroup[]>();
  for (const group of withMemorizedSiblings(groups, memorized)) {
    const key = `${group.self.surah}:${group.self.ayah}`;
    marks.set(key, [...(marks.get(key) ?? []), group]);
  }
  return marks;
}

type PageState = Readonly<{ marks: SimilarMarks; settled: boolean }>;

function useSimilarPage(db: DatabaseExecutor | null, page: number | null | undefined, enabled: boolean): PageState {
  const pageNumber = typeof page === "number" && isValidPage(page) ? page : null;
  const active = enabled && db !== null && pageNumber !== null;
  useEffect(() => {
    if (active && db && pageNumber !== null) ensure(db, pageNumber);
  }, [active, db, pageNumber]);
  const subscribeWhileActive = active ? subscribe : subscribeNever;
  const select =
    <T>(pick: (current: Store) => T, idle: T) =>
    () =>
      active && store.db === db ? pick(store) : idle;
  const pageGroups = useSyncExternalStore(
    subscribeWhileActive,
    select((current) => (pageNumber === null ? undefined : current.pages.get(pageNumber)), undefined),
    () => undefined,
  );
  const pageFailed = useSyncExternalStore(
    subscribeWhileActive,
    select((current) => pageNumber !== null && current.failedPages.has(pageNumber), false),
    () => false,
  );
  const memorized = useSyncExternalStore(
    subscribeWhileActive,
    select((current) => current.memorized, null),
    () => null,
  );
  const memorizedFailed = useSyncExternalStore(
    subscribeWhileActive,
    select((current) => current.memorizedFailed, false),
    () => false,
  );
  const marks = useMemo(
    () => (pageGroups && memorized ? similarMarksOf(pageGroups, memorized) : NO_MARKS),
    [memorized, pageGroups],
  );
  const settled = !active || ((pageGroups !== undefined || pageFailed) && (memorized !== null || memorizedFailed));
  return useMemo(() => ({ marks, settled }), [marks, settled]);
}

export function useSimilarMarks(
  db: DatabaseExecutor | null,
  page: number | null | undefined,
  enabled: boolean,
): SimilarMarks {
  return useSimilarPage(db, page, enabled).marks;
}

export function useSimilarAyah(
  db: DatabaseExecutor | null,
  target: { surah: number; ayah: number } | null,
  page: number | null | undefined,
  enabled: boolean,
): Readonly<{ groups: readonly SimilarGroup[]; settled: boolean }> {
  const { marks, settled } = useSimilarPage(db, page, enabled && target !== null);
  const groups = (target && marks.get(`${target.surah}:${target.ayah}`)) || NO_GROUPS;
  const known = settled && (!enabled || target === null || typeof page === "number");
  return useMemo(() => ({ groups, settled: known }), [groups, known]);
}
