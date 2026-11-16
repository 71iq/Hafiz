import { Platform } from "react-native";
import { router, type Href } from "expo-router";
import { setPendingDeepLink } from "@/lib/deep-link";
import { returnToTabs, type RootStackState } from "@/lib/navigation/return-to-tabs";
import { isValidAyah } from "@/lib/search/reference";

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

export type AuthReturnInput = { route: string; params?: Record<string, unknown> | null };

export type AuthReopenRequest =
  | { kind: "reflection-editor"; surah: number; ayahStart: number; ayahEnd: number }
  | { kind: "comments"; reflectionId: string; surface: "mushaf" | "feed" };

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

export function parseAuthReturnPath(path: unknown): AuthReturnTarget | null {
  if (typeof path !== "string" || path.length > 512) return null;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
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
  }
}

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
  }
}

function current(): Pending | null {
  restoreRedirectCopy();
  if (pending && Date.now() - pending.capturedAt >= MAX_AGE_MS) pending = null;
  return pending;
}

export function captureAuthReturn(input: AuthReturnInput | AuthReturnTarget): AuthReturnTarget | null {
  restoreRedirectCopy();
  const target = parseTargetLike(input);
  pending = target ? { target, capturedAt: Date.now() } : null;
  awaitingRedirect = false;
  clearRedirectCopy();
  return target;
}

export function adoptAuthReturn(derived: AuthReturnTarget | null): void {
  if (current() || !derived) return;
  pending = { target: derived, capturedAt: Date.now() };
}

export function peekAuthReturn(): AuthReturnTarget | null {
  return current()?.target ?? null;
}

export function consumeAuthReturn(): AuthReturnTarget {
  const target = current()?.target ?? HOME_RETURN;
  pending = null;
  awaitingRedirect = false;
  clearRedirectCopy();
  return target;
}

export function abandonPendingAuthReturn(): void {
  pending = null;
  awaitingRedirect = false;
  clearRedirectCopy();
}

export function clearAuthReturn(): void {
  pending = null;
  reopen = null;
  awaitingRedirect = false;
  clearRedirectCopy();
}

export function persistAuthReturnForRedirect(): () => void {
  const storage = sessionStore();
  if (!storage) return () => {};
  const value = current() ?? { target: HOME_RETURN, capturedAt: Date.now() };
  try {
    storage.setItem(REDIRECT_STORAGE_KEY, JSON.stringify(value));
  } catch {
  }
  return clearRedirectCopy;
}

export function isAwaitingRedirectReturn(): boolean {
  current();
  return awaitingRedirect && pending !== null;
}

export function abandonRedirectReturn(): void {
  if (!awaitingRedirect) return;
  pending = null;
  awaitingRedirect = false;
  clearRedirectCopy();
}

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
  if (target.route === "comments") {
    const surface = target.surah !== undefined && target.ayah !== undefined ? "mushaf" : "feed";
    return { kind: "comments", reflectionId: target.reflectionId, surface };
  }
  return null;
}

export type AuthReturnNavigation =
  | { kind: "tabs"; href: Href; deepLink?: { surah: number; ayah: number } }
  | { kind: "stack"; href: Href };

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

export function completeAuthReturn(state: RootStackState): AuthReturnTarget {
  const target = consumeAuthReturn();
  reopen = reopenFor(target);
  notifyReopen();
  navigateTo(state, target);
  return target;
}

export function leaveAuthWithoutSession(state: RootStackState): AuthReturnTarget {
  const target = consumeAuthReturn();
  reopen = null;
  navigateTo(state, target);
  return target;
}

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

export function resetAuthReturnForTests(): void {
  pending = null;
  reopen = null;
  awaitingRedirect = false;
  redirectRestored = false;
}
