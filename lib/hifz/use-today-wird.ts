import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { AppDatabase } from "@/lib/database/types";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { localDateOf } from "@/lib/habit/dates";
import { subscribeHabitChanged } from "@/lib/habit/use-habit-overview";
import { countMistakeInbox } from "@/lib/hifz/errors";
import { loadTodayWird, type TodayWird } from "@/lib/hifz/pages";
import { subscribeSyncCompleted } from "@/lib/sync/events";

/**
 * Today's hifz wird and the mistake inbox count for a screen, refreshed on focus, after reviews,
 * after sync and after plan changes. `wird` is null when no plan is set up; undefined while loading.
 */
export function useTodayWird(db: AppDatabase) {
  const [wird, setWird] = useState<TodayWird | null | undefined>(undefined);
  const [inboxCount, setInboxCount] = useState(0);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const load = ++latest.current;
    try {
      const now = new Date();
      const [next, inbox] = await Promise.all([loadTodayWird(db, now), countMistakeInbox(db, localDateOf(now))]);
      if (load !== latest.current) return;
      setWird(next);
      setInboxCount(inbox);
    } catch (error) {
      console.warn("[Hifz] Today's wird failed to load:", error);
      if (load === latest.current) setWird((current) => current ?? null);
    }
  }, [db]);

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

  return { wird, inboxCount, refresh };
}
