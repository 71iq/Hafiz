import { NavigationRouteContext } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { useContext, useEffect } from "react";
import type { AppDatabase } from "@/lib/database/types";
import { returnToTabs, type RootStackState } from "@/lib/navigation/return-to-tabs";
import { resolveReminderHref } from "@/lib/notifications/reminder-route";
import type { ReminderRoute } from "@/lib/notifications/types";

/**
 * What a session screen (card session, page review, memorize) says about being left by a widget or
 * notification tap (SPEC 3.9):
 * - working: work is under way that leaving would lose or interrupt (its leave guard is active);
 * - fresh: nothing done there yet;
 * - ended: its summary, empty state or error, so the next step can replace it.
 */
export type SessionLeaveState = "working" | "fresh" | "ended";

const sessionStates = new Map<string, SessionLeaveState>();

/**
 * Each session screen publishes its state under its route key while it is mounted. Read from the
 * route context rather than useRoute, which throws outside a navigator (a screen rendered alone).
 */
export function useSessionLeaveState(state: SessionLeaveState): void {
  const key = useContext(NavigationRouteContext)?.key;
  useEffect(() => {
    if (key) sessionStates.set(key, state);
  }, [key, state]);
  useEffect(
    () => () => {
      if (key) sessionStates.delete(key);
    },
    [key],
  );
}

type RouteEntry = { key: string; name: string; params?: object; state?: unknown };
type RootState = RootStackState & { routes?: readonly RouteEntry[] };

/**
 * The app's root Stack in a navigation container's state. Expo Router wraps the app's root Stack in
 * its own navigator, whose only route is "__root", so the Stack is that route's state; a state that is
 * already the Stack (a plain navigator) is returned as it is. Undefined until the Stack exists.
 */
export function rootStackOf(container: unknown): RootState | undefined {
  const state = container as RootState | undefined;
  const routes = state?.routes;
  if (!routes || routes.length === 0) return undefined;
  const top = routes[Math.min(state?.index ?? 0, routes.length - 1)];
  return top?.name === "__root" ? (top.state as RootState | undefined) : state;
}

/** The root stack's focused route: a session screen, another pushed screen, or the tabs. */
export function focusedRootRoute(state: RootState | undefined): RouteEntry | null {
  const routes = state?.routes;
  if (!routes || routes.length === 0) return null;
  return routes[Math.min(state?.index ?? routes.length - 1, routes.length - 1)] ?? null;
}

const HOME: Href = "/(tabs)/home";
/** Taps never interrupt onboarding or plan setup: the app only comes forward. */
const BLOCKED_PATHS = ["/onboarding", "/hifz/setup"];
const BLOCKED_ROUTES = ["onboarding", "hifz/setup"];

function hrefParts(href: Href): { path: string; params: Record<string, unknown> } {
  if (typeof href === "string") return { path: href.split("?")[0], params: {} };
  return { path: href.pathname, params: (href.params ?? {}) as Record<string, unknown> };
}

/** Whether a step's href opens the screen that is already focused, with the same scope. */
export function opensFocusedScreen(href: Href, route: RouteEntry): boolean {
  const { path, params } = hrefParts(href);
  if (path !== `/${route.name}`) return false;
  const focused = (route.params ?? {}) as Record<string, unknown>;
  if (route.name === "flashcards/session") {
    const daily = (p: Record<string, unknown>) => p.scope === "daily" || !p.deckId;
    return daily(params) === daily(focused) && (daily(params) || params.deckId === focused.deckId);
  }
  if (route.name === "hifz/review") return (params.mode ?? "") === (focused.mode ?? "");
  return true;
}

let entryInFlight = false;

/** Clears the in-flight entry between tests. */
export function resetEntryRouteForTests(): void {
  entryInFlight = false;
  sessionStates.clear();
}

/** Where the app is when a tap is handled: the focused root route and the state its screen published. */
function whereNow(container: () => unknown) {
  const stack = rootStackOf(container());
  const focused = focusedRootRoute(stack);
  return { stack, focused, sessionState: focused ? sessionStates.get(focused.key) : undefined };
}

/**
 * Opens what a widget or notification tap leads to, from wherever the app is (SPEC 3.9):
 * 1. Ignored on onboarding and plan setup, on a session screen whose work would be lost, and while
 *    an earlier tap is still resolving and navigating.
 * 2. The wird route asks the study resolver; Kahf and Home have their own routes.
 * 3. When the step is the focused session and nothing is done there yet, nothing changes.
 * 4. On any other pushed screen, the tap first returns to the tabs, then opens the step, so Back
 *    from it lands on Home. A Home result navigates, never pushes.
 *
 * `getRootState` reads the navigation container when the tap is decided, before the resolver runs
 * and again after it, since the user can move on while it reads (the root layout's own navigation
 * state is a snapshot from its last render).
 */
export async function openEntryRoute(
  db: AppDatabase,
  route: ReminderRoute,
  { pathname, getRootState }: { pathname: string; getRootState: () => unknown },
): Promise<void> {
  if (entryInFlight || BLOCKED_PATHS.includes(pathname)) return;
  if (whereNow(getRootState).sessionState === "working") return;
  entryInFlight = true;
  try {
    const href = await resolveReminderHref(db, route);
    const { stack, focused, sessionState } = whereNow(getRootState);
    if (sessionState === "working" || (focused && BLOCKED_ROUTES.includes(focused.name))) return;
    const isHome = href === HOME;
    if (!stack || !focused || focused.name === "(tabs)") {
      if (isHome) router.navigate(HOME);
      else router.push(href);
      return;
    }
    if (sessionState === "fresh" && !isHome && opensFocusedScreen(href, focused)) return;
    returnToTabs(stack, HOME);
    if (!isHome) router.push(href);
  } finally {
    entryInFlight = false;
  }
}
