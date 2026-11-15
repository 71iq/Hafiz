import { Platform } from "react-native";
import { router, type Href } from "expo-router";
import { setPendingDeepLink } from "@/lib/deep-link";
import { returnToTabs, type RootStackState } from "@/lib/navigation/return-to-tabs";
import { isValidAyah } from "@/lib/search/reference";

/**
 * One allowlisted place to return to after login, signup or a provider sign-in.
 *
 * A target names a known internal context and carries only validated reference parameters. It never
 * carries guest text, a pending action or a URL, so completing a login can reopen a surface but
 * cannot publish, save or replay anything. Anything else, including protocols, protocol-relative
 * strings, external hosts, auth/reset routes and unknown routes, falls back to Home.
 */
export type AuthReturnTarget =
  | { route: "home" }
  | { route: "progress" }
  | { route: "settings-account" }
  | { route: "feed" }
  | { route: "mushaf" }
  | { route: "profile" }
  | { route: "public-profile"; userId: string }
  | { route: "ayah"; surah: number; ayah: number }
  | { route: "reflection-editor"; surah: number; ayahStart: number; ayahEnd: number }
  | { route: "comments"; reflectionId: string; surah?: number; ayah?: number };

export type AuthReturnRoute = AuthReturnTarget["route"];

/** What a caller passes to captureAuthReturn: a route name and untrusted parameters. */
export type AuthReturnInput = { route: string; params?: Record<string, unknown> | null };

/** A surface the destination should reopen once, holding only its safe target reference. */
export type AuthReopenRequest =
  | { kind: "reflection-editor"; surah: number; ayahStart: number; ayahEnd: number }
  | { kind: "comments"; reflectionId: string };

export const HOME_RETURN: AuthReturnTarget = { route: "home" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AGE_MS = 15 * 60 * 1000;
const REDIRECT_STORAGE_KEY = "hafiz_auth_return_v1";

function integer(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== "string" || !/^\d{1,4}$/.test(value)) return null;
  return Number(value);
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

/** Validates an untrusted route name and parameters. Returns null for anything not allowlisted. */
export function parseAuthReturn(input: unknown): AuthReturnTarget | null {
  if (!input || typeof input !== "object") return null;
  const { route, params: rawParams } = input as { route?: unknown; params?: unknown };
  if (typeof route !== "string") return null;
  const params = rawParams && typeof rawParams === "object" ? (rawParams as Record<string, unknown>) : {};
  switch (route) {
    case "home":
    case "progress":
    case "settings-account":
    case "feed":
    case "mushaf":
    case "profile":
      return { route };
    case "public-profile": {
      const userId = uuid(params.userId);
      return userId ? { route, userId } : null;
    }
    case "ayah": {
      const surah = integer(params.surah);
      const ayah = integer(params.ayah);
      return surah !== null && ayah !== null && isValidAyah(surah, ayah) ? { route, surah, ayah } : null;
    }
    case "reflection-editor": {
      const surah = integer(params.surah);
      const ayahStart = integer(params.ayahStart ?? params.ayah);
      const ayahEnd = integer(params.ayahEnd ?? params.ayahStart ?? params.ayah);
      if (surah === null || ayahStart === null || ayahEnd === null) return null;
      if (!isValidAyah(surah, ayahStart) || !isValidAyah(surah, ayahEnd) || ayahEnd < ayahStart) return null;
      return { route, surah, ayahStart, ayahEnd };
    }
    case "comments": {
      const reflectionId = uuid(params.reflectionId);
      if (!reflectionId) return null;
      if (params.surah === undefined && params.ayah === undefined) return { route, reflectionId };
      const surah = integer(params.surah);
      const ayah = integer(params.ayah);
      return surah !== null && ayah !== null && isValidAyah(surah, ayah) ? { route, reflectionId, surah, ayah } : null;
    }
    default:
      return null;
  }
}

/**
 * Maps an untrusted internal path, such as a web pathname, to a target. Only same-app absolute
 * paths are considered; protocols, `//host`, backslashes, auth routes and unknown routes return null.
 */
export function parseAuthReturnPath(path: unknown): AuthReturnTarget | null {
  if (typeof path !== "string" || path.length > 512) return null;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  // Control characters and whitespace can disguise a host or a protocol after decoding.
  if (/[\u0000- \u007f]/.test(path)) return null;
  let url: URL;
  try {
    url = new URL(path, "https://hafiz.invalid");
  } catch {
    return null;
  }
  if (url.host !== "hafiz.invalid") return null;
  const pathname = url.pathname.replace(/\/\(tabs\)(?=\/)/, "").replace(/\/+$/, "") || "/";
  const params = Object.fromEntries(url.searchParams.entries());
  if (pathname === "/" || pathname === "/home") return { route: "home" };
  if (pathname === "/progress") return { route: "progress" };
  if (pathname === "/settings") return params.category === "account" ? { route: "settings-account" } : null;
  if (pathname === "/reflection-feed") return { route: "feed" };
  if (pathname === "/mushaf") return { route: "mushaf" };
  if (pathname === "/profile") return { route: "profile" };
  if (pathname === "/open") return parseAuthReturn({ route: "ayah", params });
  const profile = /^\/profile\/([^/]+)$/.exec(pathname);
  if (profile) return parseAuthReturn({ route: "public-profile", params: { userId: profile[1] } });
  return null;
}

type RouteState = { name: string; params?: Record<string, unknown>; state?: RouteStackState };
type RouteStackState = { index?: number; routes?: readonly RouteState[] };

/**
 * Derives the initiating context from the screen directly below an auth screen. Used when a caller
 * opened Login without capturing a target. Tabs give their tab context; profile screens give their
 * validated profile; anything else returns null so the caller falls back to Home.
 */
export function deriveAuthReturnFromStack(state: RouteStackState | undefined): AuthReturnTarget | null {
  const routes = state?.routes;
  if (!routes?.length) return null;
  const index = state?.index ?? routes.length - 1;
  for (let i = index - 1; i >= 0; i--) {
    const route = routes[i];
    if (route.name.startsWith("auth/")) continue;
    if (route.name === "profile/index") return { route: "profile" };
    if (route.name === "profile/[userId]") return parseAuthReturn({ route: "public-profile", params: route.params });
    if (route.name !== "(tabs)") return null;
    const tabs = route.state;
    const tab = tabs?.routes?.[tabs.index ?? 0];
    if (!tab) return null;
    switch (tab.name) {
      case "home":
        return { route: "home" };
      case "progress":
        return { route: "progress" };
      case "reflection-feed":
        return { route: "feed" };
      case "mushaf":
        return { route: "mushaf" };
      case "settings":
        return tab.params?.category === "account" ? { route: "settings-account" } : null;
      default:
        return null;
    }
  }
  return null;
}

type Pending = { target: AuthReturnTarget; capturedAt: number };
let pending: Pending | null = null;
let reopen: AuthReopenRequest | null = null;
const reopenListeners = new Set<() => void>();

/** Notified when a sign-in return sets a surface to reopen, so a mounted destination can open it. */
export function subscribeAuthReopen(listener: () => void): () => void {
  reopenListeners.add(listener);
  return () => {
    reopenListeners.delete(listener);
  };
}

function notifyReopen() {
  if (reopen) reopenListeners.forEach((listener) => listener());
}
let redirectRestored = false;
let awaitingRedirect = false;

// Accepts either the input form ({ route, params }) or a flat target ({ route, ...params }).
function parseTargetLike(value: unknown): AuthReturnTarget | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return parseAuthReturn("params" in record ? record : { route: record.route, params: record });
}

function sessionStore(): Storage | null {
  if (Platform.OS !== "web") return null;
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function clearRedirectCopy(): void {
  try {
    sessionStore()?.removeItem(REDIRECT_STORAGE_KEY);
  } catch {
    // Storage can throw in private windows; the in-memory slot remains authoritative.
  }
}

// A web provider sign-in leaves the page. Its validated target comes back from this tab's session
// storage once, is validated again, and is removed whether or not it is still valid.
function restoreRedirectCopy(): void {
  if (redirectRestored) return;
  redirectRestored = true;
  const storage = sessionStore();
  if (!storage) return;
  try {
    const raw = storage.getItem(REDIRECT_STORAGE_KEY);
    storage.removeItem(REDIRECT_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { target?: unknown; capturedAt?: unknown };
    const target = parseTargetLike(parsed.target);
    const capturedAt = typeof parsed.capturedAt === "number" ? parsed.capturedAt : 0;
    if (target && Date.now() - capturedAt >= 0 && Date.now() - capturedAt < MAX_AGE_MS) {
      pending = { target, capturedAt };
      awaitingRedirect = true;
    }
  } catch {
    // Malformed or unavailable storage falls back Home.
  }
}

function current(): Pending | null {
  restoreRedirectCopy();
  if (pending && Date.now() - pending.capturedAt >= MAX_AGE_MS) pending = null;
  return pending;
}

/**
 * Records where to return after authentication. Call it immediately before opening Login or
 * Signup. Returns the accepted target, or null when the input is not allowlisted (Home is used).
 * Extra fields, such as draft text or an action name, are dropped.
 */
export function captureAuthReturn(input: AuthReturnInput | AuthReturnTarget): AuthReturnTarget | null {
  restoreRedirectCopy();
  const target = parseTargetLike(input);
  pending = target ? { target, capturedAt: Date.now() } : null;
  awaitingRedirect = false;
  clearRedirectCopy();
  return target;
}

/** Keeps an explicit capture, or adopts the derived initiating context when none is pending. */
export function adoptAuthReturn(derived: AuthReturnTarget | null): void {
  if (current() || !derived) return;
  pending = { target: derived, capturedAt: Date.now() };
}

export function peekAuthReturn(): AuthReturnTarget | null {
  return current()?.target ?? null;
}

/** Returns the pending target once and clears it. Falls back to Home. */
export function consumeAuthReturn(): AuthReturnTarget {
  const target = current()?.target ?? HOME_RETURN;
  pending = null;
  awaitingRedirect = false;
  clearRedirectCopy();
  return target;
}

export function clearAuthReturn(): void {
  pending = null;
  reopen = null;
  awaitingRedirect = false;
  clearRedirectCopy();
}

/**
 * Web only: copies the validated target to this tab's session storage before a provider redirect.
 * Returns a cancel function for a sign-in that failed before leaving the page.
 */
export function persistAuthReturnForRedirect(): () => void {
  const storage = sessionStore();
  if (!storage) return () => {};
  const value = current() ?? { target: HOME_RETURN, capturedAt: Date.now() };
  try {
    storage.setItem(REDIRECT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Without storage the provider return lands Home.
  }
  return clearRedirectCopy;
}

/** True when this page load came back from a web provider redirect with a stored target. */
export function isAwaitingRedirectReturn(): boolean {
  current();
  return awaitingRedirect && pending !== null;
}

/** Drops a stored provider return whose sign-in never produced a session. */
export function abandonRedirectReturn(): void {
  if (!awaitingRedirect) return;
  pending = null;
  awaitingRedirect = false;
  clearRedirectCopy();
}

/**
 * Returns a reopen request once when it matches `kind`. The destination surface opens empty for
 * that reference; it never receives guest text or performs the original action.
 */
export function consumeAuthReopen<K extends AuthReopenRequest["kind"]>(
  kind: K,
): Extract<AuthReopenRequest, { kind: K }> | null {
  if (reopen?.kind !== kind) return null;
  const request = reopen as Extract<AuthReopenRequest, { kind: K }>;
  reopen = null;
  return request;
}

export function peekAuthReopen(): AuthReopenRequest | null {
  return reopen;
}

function reopenFor(target: AuthReturnTarget): AuthReopenRequest | null {
  if (target.route === "reflection-editor")
    return { kind: "reflection-editor", surah: target.surah, ayahStart: target.ayahStart, ayahEnd: target.ayahEnd };
  if (target.route === "comments") return { kind: "comments", reflectionId: target.reflectionId };
  return null;
}

export type AuthReturnNavigation =
  | { kind: "tabs"; href: Href; deepLink?: { surah: number; ayah: number } }
  | { kind: "stack"; href: Href };

/** The navigation a target resolves to. Pure, so it can be tested without a router. */
export function resolveAuthReturn(target: AuthReturnTarget): AuthReturnNavigation {
  switch (target.route) {
    case "home":
      return { kind: "tabs", href: "/(tabs)/home" };
    case "progress":
      return { kind: "tabs", href: "/(tabs)/progress" };
    case "settings-account":
      return { kind: "tabs", href: { pathname: "/(tabs)/settings", params: { category: "account" } } };
    case "feed":
      return { kind: "tabs", href: "/(tabs)/reflection-feed" };
    case "mushaf":
      return { kind: "tabs", href: "/(tabs)/mushaf" };
    case "profile":
      return { kind: "stack", href: "/profile" };
    case "public-profile":
      return { kind: "stack", href: { pathname: "/profile/[userId]", params: { userId: target.userId } } };
    case "ayah":
      return { kind: "tabs", href: "/(tabs)/mushaf", deepLink: { surah: target.surah, ayah: target.ayah } };
    case "reflection-editor":
      return {
        kind: "tabs",
        href: "/(tabs)/mushaf",
        deepLink: { surah: target.surah, ayah: target.ayahStart },
      };
    case "comments":
      return target.surah !== undefined && target.ayah !== undefined
        ? { kind: "tabs", href: "/(tabs)/mushaf", deepLink: { surah: target.surah, ayah: target.ayah } }
        : { kind: "tabs", href: "/(tabs)/reflection-feed" };
  }
}

/**
 * Leaves the auth screen for the captured target after a verified session. Auth history is
 * replaced through the shared return-to-tabs helper, so Back does not reopen Login and no second
 * tab tree is stacked. Call only after the session result is current for this screen.
 */
export function completeAuthReturn(state: RootStackState): AuthReturnTarget {
  const target = consumeAuthReturn();
  reopen = reopenFor(target);
  notifyReopen();
  navigateTo(state, target);
  return target;
}

/**
 * Leaves an auth screen without a session when it has no history to go back to (a direct link):
 * goes to the captured context or Home, and never reopens an editor or comments.
 */
export function leaveAuthWithoutSession(state: RootStackState): AuthReturnTarget {
  const target = consumeAuthReturn();
  reopen = null;
  navigateTo(state, target);
  return target;
}

/**
 * Web provider return: the page reloaded at the app root with a verified session. There is no auth
 * screen to replace, so tab targets switch tab and stack targets open above the tabs.
 */
export function completeRedirectReturn(): AuthReturnTarget {
  const target = consumeAuthReturn();
  reopen = reopenFor(target);
  notifyReopen();
  const navigation = resolveAuthReturn(target);
  if (navigation.kind === "tabs") {
    if (navigation.deepLink) setPendingDeepLink(navigation.deepLink);
    router.navigate(navigation.href);
  } else {
    router.push(navigation.href);
  }
  return target;
}

function navigateTo(state: RootStackState, target: AuthReturnTarget): void {
  const navigation = resolveAuthReturn(target);
  if (navigation.kind === "tabs") {
    if (navigation.deepLink) setPendingDeepLink(navigation.deepLink);
    returnToTabs(state, navigation.href);
  } else {
    router.replace(navigation.href);
  }
}

/** Test seam: resets module state between cases. */
export function resetAuthReturnForTests(): void {
  pending = null;
  reopen = null;
  awaitingRedirect = false;
  redirectRestored = false;
}
