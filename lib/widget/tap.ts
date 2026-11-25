import { useNavigationContainerRef, usePathname, useRootNavigationState } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { Linking } from "react-native";
import { useDatabaseStatus } from "@/lib/database/provider";
import { openEntryRoute } from "@/lib/navigation/entry-route";
import { widgetPlatform } from "@/lib/widget/platform";
import type { WidgetTap } from "@/lib/widget/types";

/**
 * Spec 6.7: a widget tap opens MainActivity with hafiz://widget?to=wird or ?to=home. Expo Router hands
 * cold and warm links to +native-intent, which keeps the target here, and useWidgetTaps opens it once
 * the root route has redirected, through the same entry helper notification taps use (SPEC 3.9).
 *
 * On Android, Expo Router gives up on the launch URL when Linking.getInitialURL takes more than 150 ms
 * (useLinking.native.js), which a cold start often does, so a cold tap would only open Hafiz.
 * useWidgetTaps therefore also reads the launch URL itself. MainActivity adds a one-time `launch`
 * number to a fresh widget launch and clears the link of a launch restored from saved state or from
 * Recents, so each launch link is acted on once, by whichever reader sees it first, and a launch
 * replayed after process death opens nothing.
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

/**
 * The last launch link acted on: its `launch` number, so each new launch is taken once. A link
 * without one (from a build before the number) is taken once per app process, as before.
 */
let lastLaunch: string | null = null;
let unnumberedLaunchTaken = false;

function launchNumber(path: string): string | null {
  return /[?&]launch=([^&#]+)/.exec(path)?.[1] ?? null;
}

/** True the first time a launch link is seen; false for one already taken. */
function takeLaunch(path: string): boolean {
  const number = launchNumber(path);
  if (number === null) {
    if (unnumberedLaunchTaken) return false;
    unnumberedLaunchTaken = true;
    return true;
  }
  if (number === lastLaunch) return false;
  lastLaunch = number;
  return true;
}

/**
 * undefined when the path is not a widget link. Otherwise the target is kept, and a cold start goes
 * to the root entry (onboarding or Home, UI-02) while a warm start stays where the app is.
 */
export function redirectWidgetTapPath(path: string, initial: boolean): string | null | undefined {
  const tap = parseWidgetTapPath(path);
  if (tap === null) return undefined;
  // A numbered link is taken once whichever way it arrives: MainActivity numbers a tap delivered to a
  // running activity too, so a later launch-link read of the same tap does not open it again.
  const taken = initial || launchNumber(path) !== null ? takeLaunch(path) : true;
  if (taken) setPendingWidgetTap(tap);
  return initial ? "/" : null;
}

/** Clears the pending tap and the launch flag between tests. */
export function resetWidgetTapsForTests(): void {
  pendingTap = null;
  lastLaunch = null;
  unnumberedLaunchTaken = false;
}

/** The widget tap that launched the app, when Expo Router has not already taken it. */
export function takeLaunchWidgetTap(url: string | null): void {
  const tap = url ? parseWidgetTapPath(url) : null;
  if (tap === null || !takeLaunch(url!)) return;
  setPendingWidgetTap(tap);
}

/**
 * Opens a pending widget tap once the database is ready and the root route has redirected. A session
 * with work under way, onboarding and setup keep their screen (openEntryRoute): the tap only brings
 * Hafiz forward.
 */
export function useWidgetTaps(): void {
  const { db, isReady } = useDatabaseStatus();
  const pathname = usePathname();
  const navigationKey = useRootNavigationState()?.key;
  const container = useNavigationContainerRef();
  const pending = useSyncExternalStore(subscribePendingWidgetTap, peekPendingWidgetTap, peekPendingWidgetTap);

  useEffect(() => {
    if (!widgetPlatform.supported) return;
    Linking.getInitialURL()
      .then(takeLaunchWidgetTap)
      .catch((error: unknown) => console.warn("[Widget] Could not read the launch link:", error));
  }, []);

  useEffect(() => {
    if (!db || !isReady || pending === null || !navigationKey || pathname === "/") return;
    const tap = consumePendingWidgetTap();
    if (tap === null) return;
    openEntryRoute(db, tap, { pathname, getRootState: () => container.getRootState() }).catch((error: unknown) =>
      console.warn("[Widget] Could not open the widget tap:", error),
    );
  }, [db, isReady, pending, navigationKey, pathname, container]);
}
