import { router, usePathname, useRootNavigationState } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useDatabaseStatus } from "@/lib/database/provider";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { deviceTimeZone } from "@/lib/habit/dates";
import { notificationsStrings } from "@/lib/i18n/features/notifications";
import { useSettings } from "@/lib/settings/context";
import { subscribeSyncCompleted } from "@/lib/sync/events";
import { subscribeHabitChanged } from "@/lib/habit/use-habit-overview";
import { reminderPlatform } from "@/lib/notifications/platform";
import type { ReminderResponse } from "@/lib/notifications/platform-types";
import { recordReminderOpened, requestRemindLater, rescheduleReminders } from "@/lib/notifications/schedule";
import type { ReminderRoute } from "@/lib/notifications/types";

const REVIEW_SETTLE_MS = 1500;
const ZONE_CHECK_MS = 60_000;

function zoneKey(): string {
  return `${deviceTimeZone()}|${new Date().getTimezoneOffset()}`;
}

function warn(error: unknown) {
  console.warn("[Reminders]", error);
}

/**
 * NOT-04: replan the next 7 days on app start, on return to the foreground, when the time zone
 * changes, after sync, after review activity (sessions and grades) and when the language changes.
 * Mount once, under the database and settings providers.
 */
export function useReminderScheduling(): void {
  const { db, isReady } = useDatabaseStatus();
  const { uiLanguage, isLoaded } = useSettings();

  useEffect(() => {
    if (!db || !isReady || !isLoaded) return;
    let active = true;
    const run = () => {
      if (active) rescheduleReminders(db, { language: uiLanguage }).catch(warn);
    };
    const strings = notificationsStrings[uiLanguage];
    reminderPlatform
      .configure({ channelName: strings.notifChannelName, remindLaterAction: strings.notifActionRemindLater })
      .catch(warn)
      .finally(run);

    let zone = zoneKey();
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      zone = zoneKey();
      run();
    });
    const zoneTimer = setInterval(() => {
      const next = zoneKey();
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
    // Excuses, pauses, onboarding and plan changes (including its reminder time) emit a habit change.
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

function openReminderRoute(route: ReminderRoute) {
  if (route === "wird") router.push("/flashcards/session");
  else if (route === "kahf") router.push({ pathname: "/open", params: { surah: "18", ayah: "1" } });
  else router.navigate("/(tabs)/home");
}

/**
 * Notification taps open the wird review, al-Kahf or Home, and "Remind me in 1 hour" sets the
 * follow-up. A cold-start tap waits until the start route has redirected, and is not routed while
 * onboarding is open.
 */
export function useReminderResponses(): void {
  const { db, isReady } = useDatabaseStatus();
  const pathname = usePathname();
  const navigationKey = useRootNavigationState()?.key;
  const [pendingRoute, setPendingRoute] = useState<ReminderRoute | null>(null);

  useEffect(() => {
    if (!db || !isReady) return;
    let active = true;
    const handle = (response: ReminderResponse) => {
      if (!active) return;
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
    if (!pendingRoute || !navigationKey || pathname === "/") return;
    if (pathname !== "/onboarding") openReminderRoute(pendingRoute);
    setPendingRoute(null);
  }, [pendingRoute, navigationKey, pathname]);
}
