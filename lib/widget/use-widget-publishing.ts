import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "@/lib/auth/store";
import { useDatabaseStatus } from "@/lib/database/provider";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { isStreakMilestone } from "@/lib/habit/milestones";
import { deviceZoneKey, localDateOf } from "@/lib/habit/dates";
import { useLocalToday } from "@/lib/habit/use-day-boundary";
import { subscribeHabitChanged } from "@/lib/habit/use-habit-overview";
import { useSettings } from "@/lib/settings/context";
import { subscribeSyncCompleted } from "@/lib/sync/events";
import { widgetPlatform } from "@/lib/widget/platform";
import { publishWidget, setWidgetPublishOptions, subscribeWidgetRefresh } from "@/lib/widget/publish";

/** Reviews and habit changes settle for this long before a republish, as for reminders. */
const SETTLE_MS = 1500;
const ZONE_CHECK_MS = 60_000;

/**
 * Spec 6.5: republishes the widget timeline on start, on language, theme, account and day changes,
 * on return to the foreground and on going to the background, after a time zone change, reviews,
 * habit changes, sync with new data, a Show numbers change and a widget placed or removed. Mount
 * once, beside the reminder lifecycle. Does nothing where the widget is unsupported.
 */
export function useWidgetPublishing(): void {
  const { db, isReady } = useDatabaseStatus();
  const { uiLanguage, theme, effectiveTheme, isLoaded } = useSettings();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const today = useLocalToday();
  const active = widgetPlatform.supported && db !== null && isReady && isLoaded;

  useEffect(() => {
    if (!active || !db) return;
    setWidgetPublishOptions({ language: uiLanguage, themeMode: theme, effectiveTheme });
    void publishWidget(db);
  }, [active, db, uiLanguage, theme, effectiveTheme, userId, today]);

  useEffect(() => {
    if (!active || !db) return;
    // A committed grade can earn a milestone while the launcher is covered by Hafiz.
    // Consume it on the first return to the home screen. Nothing is persisted or reconstructed.
    let milestoneDay: string | null = null;
    let owner = new AbortController();
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
    };
    const publish = () => {
      cancelSettle();
      void publishWidget(db);
    };
    const settleThenPublish = () => {
      cancelSettle();
      settleTimer = setTimeout(publish, SETTLE_MS);
    };

    let zone = deviceZoneKey();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        zone = deviceZoneKey();
        publish();
      } else if (state === "background") {
        const earnedHere = milestoneDay === localDateOf(new Date());
        milestoneDay = null;
        cancelSettle();
        void publishWidget(db, earnedHere ? owner.signal : undefined);
      }
    });
    const zoneTimer = setInterval(() => {
      const next = deviceZoneKey();
      if (next === zone) return;
      zone = next;
      publish();
    }, ZONE_CHECK_MS);
    const unsubscribeReview = subscribeReviewActivity((wird) => {
      if (wird && wird.kind !== "none" && isStreakMilestone(wird.length)) milestoneDay = localDateOf(new Date());
      settleThenPublish();
    });
    const unsubscribeHabit = subscribeHabitChanged(settleThenPublish);
    const unsubscribeSync = subscribeSyncCompleted((summary) => {
      const changed =
        summary.pulled > 0 || summary.localDataReplaced || summary.accountRestored || summary.restoreCompleted;
      if (changed) {
        if (summary.localDataReplaced || summary.accountRestored || summary.restoreCompleted) {
          milestoneDay = null;
          owner.abort();
          owner = new AbortController();
        }
        publish();
      }
    });
    const unsubscribeRefresh = subscribeWidgetRefresh(publish);
    const unsubscribePlacement = widgetPlatform.subscribePlacement(publish);
    return () => {
      owner.abort();
      cancelSettle();
      appState.remove();
      clearInterval(zoneTimer);
      unsubscribeReview();
      unsubscribeHabit();
      unsubscribeSync();
      unsubscribeRefresh();
      unsubscribePlacement();
    };
  }, [active, db, userId, today]);
}
