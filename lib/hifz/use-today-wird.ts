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
import { countDueRemediation, nextRemediationAt } from "@/lib/hifz/remediation";
import { countSecondLooks } from "@/lib/hifz/sabaq";
import { REVIEW_LEARN_AHEAD_MS } from "@/lib/fsrs/review-transition";
import { subscribeSyncCompleted } from "@/lib/sync/events";

export function useTodayWird(db: AppDatabase) {
  const [wird, setWird] = useState<TodayWird | null | undefined>(undefined);
  const [inboxCount, setInboxCount] = useState(0);
  const [monthlyCheckDue, setMonthlyCheckDue] = useState(false);
  const [secondLooksDue, setSecondLooksDue] = useState(0);
  const [remediationDue, setRemediationDue] = useState(0);
  const [nextLookAt, setNextLookAt] = useState<Date | null>(null);
  const [boundary, setBoundary] = useState<number | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const load = ++latest.current;
    const now = new Date();
    let nextBoundary = nextLocalMidnight(now).getTime();
    try {
      const [next, inbox, remediation, nextRemediation, looks] = await Promise.all([
        loadTodayWird(db, now),
        countMistakeInbox(db, localDateOf(now)),
        countDueRemediation(db, now),
        nextRemediationAt(db, now),
        countSecondLooks(db, now).catch((error) => {
          console.warn("[Hifz] Second looks failed to load:", error);
          return { due: 0, nextAt: null, offeredAt: null };
        }),
      ]);
      const monthly = next ? await monthlyCheckDueFor(db, next.cards, now) : false;
      if (looks.offeredAt) nextBoundary = Math.min(nextBoundary, looks.offeredAt.getTime());
      if (nextRemediation) nextBoundary = Math.min(nextBoundary, nextRemediation.getTime());
      if (next?.nextStepAt) nextBoundary = Math.min(nextBoundary, next.nextStepAt.getTime() - REVIEW_LEARN_AHEAD_MS);
      if (load !== latest.current) return;
      setWird(next);
      setInboxCount(inbox + remediation);
      setRemediationDue(remediation);
      setMonthlyCheckDue(monthly);
      setSecondLooksDue(next ? looks.due : 0);
      setNextLookAt(next ? looks.nextAt : null);
    } catch (error) {
      console.warn("[Hifz] Today's wird failed to load:", error);
      if (load === latest.current) setWird((current) => current ?? null);
    } finally {
      if (load === latest.current) setBoundary(nextBoundary);
    }
  }, [db]);

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

  return { wird, inboxCount, remediationDue, monthlyCheckDue, secondLooksDue, nextLookAt, refresh };
}
