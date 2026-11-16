import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { AppDatabase } from "@/lib/database/types";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { makeUpCutoffFor, type DhuhrResolver } from "@/lib/habit/cutoff";
import { addDays, localDateOf } from "@/lib/habit/dates";
import { loadHabitOverview, settleHabitDays, type HabitOverview } from "@/lib/habit/queries";
import { nextLocalMidnight, useDayBoundaryRefresh } from "@/lib/habit/use-day-boundary";
import { readDhuhrResolver } from "@/lib/prayer/settings";
import { subscribeSyncCompleted } from "@/lib/sync/events";

type Listener = () => void;
const habitListeners = new Set<Listener>();

export function emitHabitChanged(): void {
  for (const listener of habitListeners) listener();
}

export function subscribeHabitChanged(listener: Listener): () => void {
  habitListeners.add(listener);
  return () => {
    habitListeners.delete(listener);
  };
}

export function nextHabitBoundary(now: Date, dhuhr?: DhuhrResolver): Date {
  const cutoff = makeUpCutoffFor(addDays(localDateOf(now), -1), dhuhr);
  return cutoff.getTime() > now.getTime() ? cutoff : nextLocalMidnight(now);
}

export function useHabitOverview(db: AppDatabase, dhuhr?: DhuhrResolver) {
  const [overview, setOverview] = useState<HabitOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [boundary, setBoundary] = useState<number | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const load = ++latest.current;
    const now = new Date();
    let resolver = dhuhr;
    try {
      resolver ??= await readDhuhrResolver(db);
      await settleHabitDays(db, { now, dhuhr: resolver });
      const next = await loadHabitOverview(db, { now, dhuhr: resolver });
      if (load !== latest.current) return;
      setOverview(next);
      setFailed(false);
    } catch (error) {
      console.warn("[Habit] Overview failed to load:", error);
      if (load === latest.current) setFailed(true);
    } finally {
      if (load === latest.current) setBoundary(nextHabitBoundary(now, resolver).getTime());
    }
  }, [db, dhuhr]);

  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      refresh();
      return () => {
        focused.current = false;
      };
    }, [refresh]),
  );
  const refreshIfFocused = useCallback(() => {
    if (focused.current) refresh();
  }, [refresh]);
  useEffect(() => subscribeReviewActivity(refreshIfFocused), [refreshIfFocused]);
  useEffect(() => subscribeHabitChanged(refreshIfFocused), [refreshIfFocused]);
  useEffect(
    () =>
      subscribeSyncCompleted(({ pulled }) => {
        if (pulled > 0) refreshIfFocused();
      }),
    [refreshIfFocused],
  );
  useDayBoundaryRefresh(boundary, refreshIfFocused);

  return { overview, failed, refresh };
}
