import { createRootAuthRuntime } from "@/lib/auth/root-runtime";
import { createAuthCoordinator } from "@/lib/auth/coordinator";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import type { Session, User } from "@supabase/supabase-js";
function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const user: User = {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01",
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session: Session = {
    user,
    access_token: [
      { alg: "HS256" },
      { sub: user.id, session_id: "10000000-0000-4000-8000-000000000001", exp },
      "synthetic",
    ]
      .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
      .join("."),
    refresh_token: "synthetic-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
  };
  const requests: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push(`${init?.method ?? "GET"} ${path}`);
    const body = path.endsWith("/logout")
      ? {}
      : path.endsWith("/user")
        ? { user: { ...user, user_metadata: init?.method === "PUT" ? { updated: true } : {} } }
        : session;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { values, storage, user, session, fetch, requests };
}
it.each([
  ["https://synthetic.example.invalid/subpath/", "/subpath/auth/v1/user"],
  ["  https://synthetic.example.invalid/subpath//  ", "/subpath//auth/v1/user"],
])("root native runtime preserves SDK auth endpoint %s", async (url, expectedPath) => {
  const f = fixture();
  const runtime = createRootAuthRuntime({
    url,
    anonKey: "public-synthetic-key",
    isWeb: false,
    nativeStorage: f.storage,
    fetch: f.fetch,
  });
  const coordinator = createAuthCoordinator(null);
  let current: Session | null = null;
  const events: string[] = [];
  const subscription = runtime.auth.onAuthStateChange((event, session) => {
    events.push(event);
    current = session;
    const identity = getAuthSessionIdentity(session);
    coordinator.observeIdentity(identity.kind === "identified" ? JSON.stringify(identity) : null);
  }).data.subscription;
  try {
    await runtime.auth.initialize();
    expect(runtime.storageKey).toBe("sb-synthetic-auth-token");
    expect(
      (await runtime.auth.signInWithPassword({ email: "a@example.invalid", password: "synthetic" })).error,
    ).toBeNull();
    expect(JSON.parse(f.values.get(runtime.storageKey) ?? "null")?.user.id).toBe(f.user.id);
    expect(runtime.supportsOwnedCommands).toBe(true);
    const updated = await runtime.updatePassword(coordinator.captureOwner(), current, "synthetic-password");
    expect(updated.error).toBeNull();
    expect(f.requests).toContain(`PUT ${expectedPath}`);
    expect(updated.data.user?.user_metadata.updated).toBe(true);
    expect(events).toContain("USER_UPDATED");
    const logoutOwner = coordinator.captureOwner();
    expect(
      (
        await coordinator.owned(
          logoutOwner,
          async () => {
            const result = await runtime.signOut(logoutOwner, current);
            if (result.error) throw result.error;
          },
          true,
        )
      ).status,
    ).toBe("completed");
    expect(f.values.has(runtime.storageKey)).toBe(false);
    expect(events).toContain("SIGNED_OUT");
  } finally {
    subscription.unsubscribe();
    await runtime.auth.stopAutoRefresh();
  }
});
it("root native runtime keeps the exact custom storage key", async () => {
  const f = fixture();
  const runtime = createRootAuthRuntime({
    url: "https://synthetic.example.invalid/",
    anonKey: "public-synthetic-key",
    isWeb: false,
    nativeStorage: f.storage,
    storageKey: "retained-key",
    fetch: f.fetch,
  });
  try {
    await runtime.auth.initialize();
    expect(
      (await runtime.auth.signInWithPassword({ email: "a@example.invalid", password: "synthetic" })).error,
    ).toBeNull();
    expect([...f.values.keys()]).toEqual(["retained-key"]);
  } finally {
    await runtime.auth.stopAutoRefresh();
  }
});
it("root SSR-style web fallback keeps ordinary auth in memory and refuses unsafe owned dispatch", async () => {
  const f = fixture();
  const runtime = createRootAuthRuntime({
    url: "https://synthetic.example.invalid/",
    anonKey: "public-synthetic-key",
    isWeb: true,
    nativeStorage: f.storage,
    fetch: f.fetch,
  });
  try {
    await runtime.auth.initialize();
    expect(
      (await runtime.auth.signInWithPassword({ email: "a@example.invalid", password: "synthetic" })).error,
    ).toBeNull();
    expect((await runtime.auth.getSession()).data.session?.user.id).toBe(f.user.id);
    expect(f.values.size).toBe(0);
    expect(runtime.supportsOwnedCommands).toBe(false);
    const owner = { isCurrent: () => true, cancel: () => {} };
    const count = f.requests.length;
    expect(() => runtime.updatePassword(owner, f.session, "synthetic-password")).toThrow(
      "Auth storage ownership is unavailable",
    );
    expect(() => runtime.signOut(owner, f.session)).toThrow("Auth storage ownership is unavailable");
    expect(f.requests).toHaveLength(count);
  } finally {
    await runtime.auth.stopAutoRefresh();
  }
});
it("unconfigured root import and offline stubs never construct the runtime", async () => {
  const oldUrl = process.env.EXPO_PUBLIC_SUPABASE_URL,
    oldKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const create = jest.fn();
  jest.resetModules();
  jest.doMock("@react-native-async-storage/async-storage", () => ({ __esModule: true, default: fixture().storage }));
  jest.doMock("@/lib/auth/root-runtime", () => ({ createRootAuthRuntime: create }));
  jest.doMock("expo-constants", () => ({ expoConfig: { extra: {} } }));
  process.env.EXPO_PUBLIC_SUPABASE_URL = "YOUR_PROJECT_URL";
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
  try {
    const module = jest.requireActual<typeof import("@/lib/supabase")>("@/lib/supabase");
    expect(create).not.toHaveBeenCalled();
    expect(module.isSupabaseConfigured()).toBe(false);
    expect((await module.supabase.auth.getSession()).data.session).toBeNull();
    expect((await module.supabase.auth.signOut()).error).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(() => module.updateOwnedPassword({ isCurrent: () => true, cancel: () => {} }, null, "synthetic")).toThrow(
      "Supabase not configured",
    );
    expect(create).not.toHaveBeenCalled();
  } finally {
    if (oldUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = oldKey;
    jest.dontMock("@/lib/auth/root-runtime");
    jest.dontMock("expo-constants");
    jest.dontMock("@react-native-async-storage/async-storage");
  }
});
it("configured root remains lazy and constructs its main runtime only once", async () => {
  const oldUrl = process.env.EXPO_PUBLIC_SUPABASE_URL,
    oldKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const from = jest.fn();
  const auth = { marker: "wrapped-auth" };
  const create = jest.fn(() => ({ client: { from }, auth }));
  jest.resetModules();
  jest.doMock("@react-native-async-storage/async-storage", () => ({ __esModule: true, default: fixture().storage }));
  jest.doMock("@/lib/auth/root-runtime", () => ({ createRootAuthRuntime: create }));
  jest.doMock("expo-constants", () => ({ expoConfig: { extra: {} } }));
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://synthetic.example.invalid/";
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "public-synthetic-key";
  try {
    const module = jest.requireActual<typeof import("@/lib/supabase")>("@/lib/supabase");
    expect(create).not.toHaveBeenCalled();
    expect(module.supabase.auth).toBe(auth);
    expect(module.supabase.from).toBe(from);
    expect(module.supabase.auth).toBe(auth);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://synthetic.example.invalid/",
        anonKey: "public-synthetic-key",
      }),
    );
  } finally {
    if (oldUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = oldKey;
    jest.dontMock("@/lib/auth/root-runtime");
    jest.dontMock("expo-constants");
    jest.dontMock("@react-native-async-storage/async-storage");
  }
});
