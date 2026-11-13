import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { AppDatabase } from "@/lib/database/types";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { NO_PRAYER_TIMES, type DhuhrResolver } from "@/lib/habit/cutoff";
import { loadHabitOverview, settleHabitDays, type HabitOverview } from "@/lib/habit/queries";
import { subscribeSyncCompleted } from "@/lib/sync/events";

type Listener = () => void;
const habitListeners = new Set<Listener>();

/** Tell open screens that a habit setting or excuse changed. */
export function emitHabitChanged(): void {
  for (const listener of habitListeners) listener();
}

export function subscribeHabitChanged(listener: Listener): () => void {
  habitListeners.add(listener);
  return () => {
    habitListeners.delete(listener);
  };
}

/**
 * The wird overview for a screen. Each load first runs the idempotent settle pass (8.4), on focus,
 * after reviews, after sync and after habit changes, so grace and paused days are recorded before
 * they are shown. A failed load keeps the last good overview.
 */
export function useHabitOverview(db: AppDatabase, dhuhr: DhuhrResolver = NO_PRAYER_TIMES) {
  const [overview, setOverview] = useState<HabitOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const load = ++latest.current;
    try {
      const now = new Date();
      await settleHabitDays(db, { now, dhuhr });
      const next = await loadHabitOverview(db, { now, dhuhr });
      if (load !== latest.current) return;
      setOverview(next);
      setFailed(false);
    } catch (error) {
      console.warn("[Habit] Overview failed to load:", error);
      if (load === latest.current) setFailed(true);
    }
  }, [db, dhuhr]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  useEffect(() => subscribeReviewActivity(refresh), [refresh]);
  useEffect(() => subscribeHabitChanged(refresh), [refresh]);
  useEffect(
    () =>
      subscribeSyncCompleted(({ pulled }) => {
        if (pulled > 0) refresh();
      }),
    [refresh],
  );

  return { overview, failed, refresh };
}
