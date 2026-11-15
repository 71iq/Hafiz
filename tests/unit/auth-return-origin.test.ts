import { Platform } from "react-native";
import {
  captureAuthReturn,
  completeAuthReturn,
  completeRedirectReturn,
  consumeAuthReopen,
  consumeAuthReturn,
  deriveAuthReturnFromStack,
  isAwaitingRedirectReturn,
  leaveAuthWithoutSession,
  parseAuthReturnPath,
  peekAuthReopen,
  peekAuthReturn,
  persistAuthReturnForRedirect,
  resetAuthReturnForTests,
} from "@/lib/auth/return-origin";
import { classifyAuthError, readRetryAfterSeconds } from "@/lib/auth/errors";
import { consumePendingDeepLink } from "@/lib/deep-link";

const mockRouter = { replace: jest.fn(), dismissTo: jest.fn(), navigate: jest.fn(), push: jest.fn() };
jest.mock("expo-router", () => ({
  get router() {
    return mockRouter;
  },
}));

const USER_ID = "3f2b8c1e-0a4d-4c6b-9e7f-112233445566";
const REFLECTION_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const coldAuthStack = { index: 0, routes: [{ name: "auth/login" }] };
const tabsBelowAuth = { index: 1, routes: [{ name: "(tabs)" }, { name: "auth/login" }] };

beforeEach(() => {
  jest.clearAllMocks();
  resetAuthReturnForTests();
  consumePendingDeepLink();
});

describe("allowlisted auth return origin", () => {
  it.each([
    "https://evil.example/home",
    "http://evil.example",
    "//evil.example/progress",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "data:text/html,hi",
    "hafiz://open?surah=1&ayah=1",
    " /progress",
    "/progress\n//evil.example",
    "/%2F%2Fevil.example",
    "/auth/login",
    "/auth/signup",
    "/auth/reset-password",
    "/auth/callback",
    "/auth/forgot-password",
    "/admin",
    "/settings",
    "/settings?category=general",
    "/open?surah=2&ayah=300",
    "/open?surah=115&ayah=1",
    "/open?surah=2&ayah=1.5",
    "/profile/not-a-uuid",
    "/profile/../auth/login",
    "",
  ])("rejects %j and falls back Home", (path) => {
    expect(parseAuthReturnPath(path)).toBeNull();
    captureAuthReturn({ route: "progress" });
    expect(captureAuthReturn(parseAuthReturnPath(path) ?? { route: path })).toBeNull();
    completeAuthReturn(coldAuthStack);
    expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)/home");
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it.each([
    { route: "https://evil.example" },
    { route: "auth/login" },
    { route: "reset-password" },
    { route: "callback" },
    { route: "__proto__" },
    { route: "ayah", params: { surah: 2, ayah: 0 } },
    { route: "ayah", params: { surah: "2", ayah: "-1" } },
    { route: "public-profile", params: { userId: "../auth/login" } },
    { route: "comments", params: { reflectionId: "javascript:alert(1)" } },
    { route: "reflection-editor", params: { surah: 2, ayahStart: 10, ayahEnd: 5 } },
  ])("rejects untrusted route input %j", (input) => {
    expect(captureAuthReturn(input)).toBeNull();
    expect(consumeAuthReturn()).toEqual({ route: "home" });
  });

  it.each([
    ["/", { route: "home" }],
    ["/(tabs)/home", { route: "home" }],
    ["/progress", { route: "progress" }],
    ["/settings?category=account", { route: "settings-account" }],
    ["/reflection-feed", { route: "feed" }],
    ["/profile", { route: "profile" }],
    [`/profile/${USER_ID}`, { route: "public-profile", userId: USER_ID }],
    ["/open?surah=2&ayah=255", { route: "ayah", surah: 2, ayah: 255 }],
  ])("accepts the internal path %s", (path, target) => {
    expect(parseAuthReturnPath(path)).toEqual(target);
  });

  it("derives the initiating tab or profile from the screen below auth", () => {
    const tabs = (name: string, params?: Record<string, unknown>) => ({
      index: 1,
      routes: [{ name: "(tabs)", state: { index: 0, routes: [{ name, params }] } }, { name: "auth/login" }],
    });
    expect(deriveAuthReturnFromStack(tabs("progress"))).toEqual({ route: "progress" });
    expect(deriveAuthReturnFromStack(tabs("settings", { category: "account" }))).toEqual({
      route: "settings-account",
    });
    expect(deriveAuthReturnFromStack(tabs("settings", { category: "general" }))).toBeNull();
    expect(deriveAuthReturnFromStack(tabs("unknown-tab"))).toBeNull();
    expect(
      deriveAuthReturnFromStack({
        index: 2,
        routes: [
          { name: "(tabs)" },
          { name: "profile/[userId]", params: { userId: USER_ID } },
          { name: "auth/signup" },
        ],
      }),
    ).toEqual({ route: "public-profile", userId: USER_ID });
    expect(deriveAuthReturnFromStack(coldAuthStack)).toBeNull();
  });

  it("returns through the shared tab helper without stacking another tab tree", () => {
    captureAuthReturn({ route: "progress" });
    expect(completeAuthReturn(tabsBelowAuth)).toEqual({ route: "progress" });
    expect(mockRouter.dismissTo).toHaveBeenCalledWith("/(tabs)/progress");
    expect(mockRouter.replace).not.toHaveBeenCalled();
    // Consumed once: a later completion falls back Home.
    completeAuthReturn(coldAuthStack);
    expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)/home");
  });

  it("opens an ayah target through the pending Mushaf link", () => {
    captureAuthReturn({ route: "ayah", params: { surah: "2", ayah: "255" } });
    completeAuthReturn(tabsBelowAuth);
    expect(mockRouter.dismissTo).toHaveBeenCalledWith("/(tabs)/mushaf");
    expect(consumePendingDeepLink()).toEqual({ surah: 2, ayah: 255 });
  });

  it("replaces auth with a validated profile screen", () => {
    captureAuthReturn({ route: "public-profile", params: { userId: USER_ID } });
    completeAuthReturn(tabsBelowAuth);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/profile/[userId]", params: { userId: USER_ID } });
  });

  it("reopens an editor with only its reference, never guest text or an action", () => {
    const accepted = captureAuthReturn({
      route: "reflection-editor",
      params: {
        surah: 2,
        ayahStart: 255,
        ayahEnd: 256,
        content: "guest draft that must not move to the account",
        action: "publish",
        visibility: "public",
      },
    });
    expect(accepted).toEqual({ route: "reflection-editor", surah: 2, ayahStart: 255, ayahEnd: 256 });
    completeAuthReturn(tabsBelowAuth);
    expect(peekAuthReopen()).toEqual({ kind: "reflection-editor", surah: 2, ayahStart: 255, ayahEnd: 256 });
    expect(consumeAuthReopen("comments")).toBeNull();
    const reopen = consumeAuthReopen("reflection-editor");
    expect(Object.keys(reopen ?? {}).sort()).toEqual(["ayahEnd", "ayahStart", "kind", "surah"]);
    // One use only: a later screen cannot replay it.
    expect(consumeAuthReopen("reflection-editor")).toBeNull();
  });

  it("does not reopen anything when auth is left without a session", () => {
    captureAuthReturn({ route: "comments", params: { reflectionId: REFLECTION_ID } });
    leaveAuthWithoutSession(coldAuthStack);
    expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)/reflection-feed");
    expect(peekAuthReopen()).toBeNull();
  });

  it("expires an old capture", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    captureAuthReturn({ route: "progress" });
    now.mockReturnValue(1_000_000 + 16 * 60 * 1000);
    expect(peekAuthReturn()).toBeNull();
    now.mockRestore();
  });
});

describe("web provider redirect return", () => {
  const store = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  beforeEach(() => {
    store.clear();
    jest.replaceProperty(Platform, "OS", "web");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage } });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  it("keeps only the validated target across the page reload and consumes it once", () => {
    captureAuthReturn({ route: "ayah", params: { surah: 18, ayah: 10, draft: "private text" } });
    persistAuthReturnForRedirect();
    const saved = [...store.values()].join("");
    expect(saved).not.toContain("private text");
    expect(saved).not.toContain("@");

    resetAuthReturnForTests();
    expect(isAwaitingRedirectReturn()).toBe(true);
    expect(store.size).toBe(0);
    completeRedirectReturn();
    expect(mockRouter.navigate).toHaveBeenCalledWith("/(tabs)/mushaf");
    expect(consumePendingDeepLink()).toEqual({ surah: 18, ayah: 10 });
    expect(isAwaitingRedirectReturn()).toBe(false);
  });

  it("falls back Home when the stored value was tampered with", () => {
    store.set(
      "hafiz_auth_return_v1",
      JSON.stringify({ target: { route: "public-profile", userId: "//evil.example" }, capturedAt: Date.now() }),
    );
    resetAuthReturnForTests();
    expect(isAwaitingRedirectReturn()).toBe(false);
    expect(consumeAuthReturn()).toEqual({ route: "home" });
  });

  it("drops the stored copy when the sign-in fails before leaving", () => {
    captureAuthReturn({ route: "progress" });
    const cancel = persistAuthReturnForRedirect();
    expect(store.size).toBe(1);
    cancel();
    expect(store.size).toBe(0);
  });
});

describe("auth error classification", () => {
  it("maps provider codes without exposing their messages", () => {
    expect(classifyAuthError({ code: "invalid_credentials", message: "Invalid login credentials" }).kind).toBe(
      "invalid-credentials",
    );
    expect(classifyAuthError({ code: "email_not_confirmed", message: "Email not confirmed" }).kind).toBe(
      "email-not-confirmed",
    );
    expect(classifyAuthError({ name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" }).kind).toBe(
      "offline",
    );
    expect(classifyAuthError(new Error("database exploded at row 12")).kind).toBe("unknown");
  });

  it("follows an actual retry delay and otherwise reports none", () => {
    const headers = new Headers({ "Retry-After": "42" });
    expect(classifyAuthError({ status: 429, headers })).toEqual({ kind: "rate-limited", retryAfterSeconds: 42 });
    expect(
      classifyAuthError({
        code: "over_email_send_rate_limit",
        message: "For security purposes, you can only request this after 37 seconds.",
      }),
    ).toEqual({ kind: "rate-limited", retryAfterSeconds: 37 });
    expect(classifyAuthError({ code: "over_request_rate_limit" })).toEqual({
      kind: "rate-limited",
      retryAfterSeconds: null,
    });
    const now = Date.parse("2026-11-15T10:00:00Z");
    expect(readRetryAfterSeconds({ headers: { "retry-after": "Sun, 15 Nov 2026 10:01:00 GMT" } }, now)).toBe(60);
  });
});
