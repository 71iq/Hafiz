import { usePathname, useRootNavigationState } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { Linking } from "react-native";
import { useDatabaseStatus } from "@/lib/database/provider";
import { openReminderRoute } from "@/lib/notifications/reminder-route";
import { widgetPlatform } from "@/lib/widget/platform";
import type { WidgetTap } from "@/lib/widget/types";

/**
 * Spec 6.7: a widget tap opens MainActivity with hafiz://widget?to=wird or ?to=home. Expo Router hands
 * cold and warm links to +native-intent, which keeps the target here, and useWidgetTaps opens it once
 * the root route has redirected, through the same helper reminders use.
 *
 * On Android, Expo Router gives up on the launch URL when Linking.getInitialURL takes more than 150 ms
 * (useLinking.native.js), which a cold start often does, so a cold tap would only open Hafiz.
 * useWidgetTaps therefore also reads the launch URL itself, once per app process.
 */
const WIDGET_PATH = /^(?:hafiz:\/\/|\/)?widget\/?(?:\?([^#]*))?(?:#.*)?$/i;

/** The tap target of a widget link, or null when the path is not one. Unknown targets mean Home. */
export function parseWidgetTapPath(path: string): WidgetTap | null {
  const match = WIDGET_PATH.exec(path);
  if (!match) return null;
  const query = match[1] ?? "";
  const to = /(?:^|&)to=([^&]*)/.exec(query)?.[1];
  return to === "wird" ? "wird" : "home";
}

let pendingTap: WidgetTap | null = null;
const pendingListeners = new Set<() => void>();

function notifyPending() {
  for (const listener of pendingListeners) listener();
}

/** In memory only: a tap is for this launch and is never persisted. */
export function setPendingWidgetTap(tap: WidgetTap): void {
  pendingTap = tap;
  notifyPending();
}

export function peekPendingWidgetTap(): WidgetTap | null {
  return pendingTap;
}

export function consumePendingWidgetTap(): WidgetTap | null {
  const tap = pendingTap;
  if (tap === null) return null;
  pendingTap = null;
  notifyPending();
  return tap;
}

export function subscribePendingWidgetTap(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
}

/** The launch URL is taken once per app process, by Expo Router or by useWidgetTaps, whichever reads it first. */
let launchTapTaken = false;

/**
 * undefined when the path is not a widget link. Otherwise the target is kept, and a cold start goes
 * to the root entry (onboarding or Home, UI-02) while a warm start stays where the app is.
 */
export function redirectWidgetTapPath(path: string, initial: boolean): string | null | undefined {
  const tap = parseWidgetTapPath(path);
  if (tap === null) return undefined;
  if (!initial) setPendingWidgetTap(tap);
  else if (!launchTapTaken) {
    launchTapTaken = true;
    setPendingWidgetTap(tap);
  }
  return initial ? "/" : null;
}

/** Clears the pending tap and the launch flag between tests. */
export function resetWidgetTapsForTests(): void {
  pendingTap = null;
  launchTapTaken = false;
}

/** The widget tap that launched the app, when Expo Router has not already taken it. */
export function takeLaunchWidgetTap(url: string | null): void {
  const tap = url ? parseWidgetTapPath(url) : null;
  if (tap === null || launchTapTaken) return;
  launchTapTaken = true;
  setPendingWidgetTap(tap);
}

/** Onboarding and open sessions keep their screen: a tap only brings Hafiz forward. */
const GUARDED_PREFIXES = ["/flashcards/session", "/hifz/review", "/hifz/sabaq", "/hifz/setup"];

function keepsScreen(pathname: string): boolean {
  return pathname === "/onboarding" || GUARDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Opens a pending widget tap once the database is ready and the root route has redirected. */
export function useWidgetTaps(): void {
  const { db, isReady } = useDatabaseStatus();
  const pathname = usePathname();
  const navigationKey = useRootNavigationState()?.key;
  const pending = useSyncExternalStore(subscribePendingWidgetTap, peekPendingWidgetTap, peekPendingWidgetTap);

  useEffect(() => {
    if (!widgetPlatform.supported || launchTapTaken) return;
    Linking.getInitialURL()
      .then(takeLaunchWidgetTap)
      .catch((error: unknown) => console.warn("[Widget] Could not read the launch link:", error));
  }, []);

  useEffect(() => {
    if (!db || !isReady || pending === null || !navigationKey || pathname === "/") return;
    const tap = consumePendingWidgetTap();
    if (tap === null || keepsScreen(pathname)) return;
    openReminderRoute(db, tap).catch((error: unknown) =>
      console.warn("[Widget] Could not open the widget tap:", error),
    );
  }, [db, isReady, pending, navigationKey, pathname]);
}
