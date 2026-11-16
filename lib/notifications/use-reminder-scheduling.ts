import { usePathname, useRootNavigationState } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "@/lib/auth/store";
import { useDatabaseStatus } from "@/lib/database/provider";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { deviceZoneKey } from "@/lib/habit/dates";
import { notificationsStrings } from "@/lib/i18n/features/notifications";
import { useSettings } from "@/lib/settings/context";
import { subscribeSyncCompleted } from "@/lib/sync/events";
import { subscribeHabitChanged } from "@/lib/habit/use-habit-overview";
import { reminderPlatform } from "@/lib/notifications/platform";
import type { ReminderResponse } from "@/lib/notifications/platform-types";
import { openReminderRoute } from "@/lib/notifications/reminder-route";
import {
  configureReminderPlatform,
  recordReminderOpened,
  requestRemindLater,
  rescheduleReminders,
  setReminderAccountSource,
} from "@/lib/notifications/schedule";
import type { ReminderRoute } from "@/lib/notifications/types";

const REVIEW_SETTLE_MS = 1500;
const ZONE_CHECK_MS = 60_000;

function warn(error: unknown) {
  console.warn("[Reminders]", error);
}

export function useReminderScheduling(): void {
  const { db, isReady } = useDatabaseStatus();
  const { uiLanguage, isLoaded } = useSettings();
  const accountId = useAuthStore((state) => state.user?.id ?? null);

  useEffect(() => {
    setReminderAccountSource(() => useAuthStore.getState().user?.id ?? null);
  }, []);

  useEffect(() => {
    if (db && isReady && isLoaded) rescheduleReminders(db, { language: uiLanguage }).catch(warn);
  }, [db, isReady, isLoaded, uiLanguage, accountId]);

  useEffect(() => {
    if (!db || !isReady || !isLoaded) return;
    let active = true;
    const run = () => {
      if (active) rescheduleReminders(db, { language: uiLanguage }).catch(warn);
    };
    const strings = notificationsStrings[uiLanguage];
    configureReminderPlatform({ channelName: strings.notifChannelName, remindLaterAction: strings.notifActionRemindLater })
      .catch(warn)
      .finally(run);

    let zone = deviceZoneKey();
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      zone = deviceZoneKey();
      run();
    });
    const zoneTimer = setInterval(() => {
      const next = deviceZoneKey();
      if (next === zone) return;
      zone = next;
      run();
    }, ZONE_CHECK_MS);
    const unsubscribeSync = subscribeSyncCompleted(run);
    let reviewTimer: ReturnType<typeof setTimeout> | null = null;
    const settleThenRun = () => {
      if (reviewTimer) clearTimeout(reviewTimer);
      reviewTimer = setTimeout(run, REVIEW_SETTLE_MS);
    };
    const unsubscribeReview = subscribeReviewActivity(settleThenRun);
    const unsubscribeHabit = subscribeHabitChanged(settleThenRun);
    return () => {
      active = false;
      appState.remove();
      clearInterval(zoneTimer);
      unsubscribeSync();
      unsubscribeReview();
      unsubscribeHabit();
      if (reviewTimer) clearTimeout(reviewTimer);
    };
  }, [db, isReady, isLoaded, uiLanguage]);
}

const handledResponses = new Set<string>();

export function firstDelivery(response: ReminderResponse): boolean {
  const key = `${response.data.logId}:${response.action}`;
  if (handledResponses.has(key)) return false;
  handledResponses.add(key);
  return true;
}

export function useReminderResponses(): void {
  const { db, isReady } = useDatabaseStatus();
  const pathname = usePathname();
  const navigationKey = useRootNavigationState()?.key;
  const [pendingRoute, setPendingRoute] = useState<ReminderRoute | null>(null);

  useEffect(() => {
    if (!db || !isReady) return;
    let active = true;
    const handle = (response: ReminderResponse) => {
      if (!active || !firstDelivery(response)) return;
      if (response.action === "remind_later") {
        requestRemindLater(db, response).catch(warn);
        return;
      }
      recordReminderOpened(db, response.data).catch(warn);
      setPendingRoute(response.data.route);
    };
    reminderPlatform
      .takeLaunchResponse()
      .then((response) => {
        if (response) handle(response);
      })
      .catch(warn);
    const unsubscribe = reminderPlatform.subscribeResponses(handle);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [db, isReady]);

  useEffect(() => {
    if (!db || !pendingRoute || !navigationKey || pathname === "/") return;
    if (pathname !== "/onboarding") openReminderRoute(db, pendingRoute).catch(warn);
    setPendingRoute(null);
  }, [db, pendingRoute, navigationKey, pathname]);
}
