import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { AppDatabase } from "@/lib/database/types";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { localDateOf } from "@/lib/habit/dates";
import { nextLocalMidnight, useDayBoundaryRefresh } from "@/lib/habit/use-day-boundary";
import { subscribeHabitChanged } from "@/lib/habit/use-habit-overview";
import { countMistakeInbox } from "@/lib/hifz/errors";
import { loadTodayWird, type TodayWird } from "@/lib/hifz/pages";
import { monthlyCheckDueFor } from "@/lib/hifz/progress";
import { countDueRemediation } from "@/lib/hifz/remediation";
import { subscribeSyncCompleted } from "@/lib/sync/events";

/**
 * Today's hifz wird and the count of spots to strengthen (inbox items, plus half pages and seams that
 * are relearning) for a screen, refreshed on focus, after reviews, after sync, after plan changes, on
 * return to the foreground and at local midnight (useDayBoundaryRefresh). Nothing here depends on the
 * make-up cutoff, so it does not reload then. `wird` is null when no plan is set up; undefined while
 * loading.
 */
export function useTodayWird(db: AppDatabase) {
  const [wird, setWird] = useState<TodayWird | null | undefined>(undefined);
  const [inboxCount, setInboxCount] = useState(0);
  const [monthlyCheckDue, setMonthlyCheckDue] = useState(false);
  const [boundary, setBoundary] = useState<number | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const load = ++latest.current;
    const now = new Date();
    try {
      const [next, inbox, remediation] = await Promise.all([
        loadTodayWird(db, now),
        countMistakeInbox(db, localDateOf(now)),
        countDueRemediation(db, now),
      ]);
      const monthly = next ? await monthlyCheckDueFor(db, next.cards, now) : false;
      if (load !== latest.current) return;
      setWird(next);
      setInboxCount(inbox + remediation);
      setMonthlyCheckDue(monthly);
    } catch (error) {
      console.warn("[Hifz] Today's wird failed to load:", error);
      if (load === latest.current) setWird((current) => current ?? null);
    } finally {
      if (load === latest.current) setBoundary(nextLocalMidnight(now).getTime());
    }
  }, [db]);

  // A screen behind another (Home behind a review) skips events: each grade would otherwise reload
  // history it cannot show. Focus always refreshes, so nothing is missed.
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

  return { wird, inboxCount, monthlyCheckDue, refresh };
}
