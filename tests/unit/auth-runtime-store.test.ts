import { createRootAuthRuntime } from "@/lib/auth/root-runtime";
import { authCommands } from "@/lib/auth/commands";
import { startAppOAuth } from "@/lib/auth/oauth";
import { QF_OAUTH_PROVIDER } from "@/lib/quran-foundation/user-types";
import { finishPasswordRecovery, preparePasswordRecovery, useAuthStore } from "@/lib/auth/store";
import type { Session, User } from "@supabase/supabase-js";
import type { AuthOwner } from "@/lib/auth/coordinator";
import * as qfUser from "@/lib/quran-foundation/user";
let mockRuntime: ReturnType<typeof createRootAuthRuntime>;
let mockLastPasswordError: unknown;
let mockLastRecoveryError: unknown;
let mockLastReadError: unknown;
let mockQfSyncEnabled = false;
const mockProfileReads: string[] = [];
const mockProfile = (id: string) => ({
  id,
  username: id,
  display_name: null,
  avatar_url: null,
  bio: null,
  country: null,
  total_score: 0,
  current_streak: 0,
  longest_streak: 0,
  cards_reviewed: 0,
  last_review_date: null,
  created_at: "2026-01-01",
});
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  readOwnedSession: async (owner: AuthOwner, session: Session | null, isActive: () => boolean) => {
    const result = await mockRuntime.readSession(owner, session, isActive);
    mockLastReadError = result.error;
    return result;
  },
  restoreOwnedSession: async (
    owner: AuthOwner,
    session: Session | null,
    tokens: { access_token: string; refresh_token: string },
    isActive: () => boolean,
    expectedUserId?: string,
  ) => {
    const result = await mockRuntime.restoreSession(owner, session, tokens, isActive, expectedUserId);
    mockLastRecoveryError = result.error;
    return result;
  },
  prepareOwnedLink: (...args: Parameters<typeof mockRuntime.prepareLink>) => mockRuntime.prepareLink(...args),
  updateOwnedPassword: async (owner: AuthOwner, session: Session | null, password: string) => {
    const result = await mockRuntime.updatePassword(owner, session, password);
    mockLastPasswordError = result.error;
    return result;
  },
  signOutOwnedSession: (owner: AuthOwner, session: Session | null) => mockRuntime.signOut(owner, session),
  supabase: {
    get auth() {
      return mockRuntime.auth;
    },
    get functions() {
      return mockRuntime.client.functions;
    },
    from: () => {
      let id = "";
      const query = {
        select: () => query,
        eq: (_name: string, value: string) => {
          id = value;
          return query;
        },
        maybeSingle: async () => {
          mockProfileReads.push(id);
          return { data: mockProfile(id), error: null };
        },
      };
      return query;
    },
  },
}));
type BrowserResult = { type: "success"; url: string } | { type: "cancel" };
const mockBrowser = jest.fn<Promise<BrowserResult>, [string, string | undefined]>();
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (url: string, redirect: string | undefined) => mockBrowser(url, redirect),
}));
jest.mock("expo-linking", () => ({ createURL: (path: string) => "hafiz://" + path }));
jest.mock("@/lib/quran-foundation/config", () => ({
  isQfSyncEnabled: () => mockQfSyncEnabled,
  isQfLoginEnabled: () => true,
}));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function session(
  index: number,
  revision = 0,
  seconds = 3600,
  providerTokens?: { accessToken: string; refreshToken?: string },
): Session & { provider_token?: string; provider_refresh_token?: string } {
  const user: User = {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01",
  };
  const exp = Math.floor(Date.now() / 1000) + seconds;
  const payload = {
    sub: user.id,
    session_id: `10000000-0000-4000-8000-${String(index + revision * 100).padStart(12, "0")}`,
    exp,
  };
  return {
    user,
    access_token: [{ alg: "HS256" }, payload, "synthetic"]
      .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
      .join("."),
    refresh_token: `synthetic-refresh-${index}-${revision}`,
    token_type: "bearer",
    expires_in: seconds,
    expires_at: exp,
    ...(providerTokens
      ? { provider_token: providerTokens.accessToken, provider_refresh_token: providerTokens.refreshToken }
      : {}),
  };
}
function sameSessionRefresh(initial: Session): Session {
  const parts = initial.access_token.split(".");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  payload.exp = Math.floor(Date.now() / 1000) + 3600;
  payload.rotation = 1;
  parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    ...initial,
    access_token: parts.join("."),
    refresh_token: "synthetic-rotated-refresh",
    expires_in: 3600,
    expires_at: payload.exp,
  };
}
type Runtime = ReturnType<typeof createRootAuthRuntime>;
type Auth = Runtime["auth"];
type Subscription = ReturnType<Auth["onAuthStateChange"]>["data"]["subscription"];
function trackSubscriptions(auth: Auth) {
  const subscriptions = new Set<Subscription>();
  const retiredCallbacks = new Set<Parameters<Auth["onAuthStateChange"]>[0]>();
  const trackedAuth = new Proxy(auth, {
    get(target, property, receiver) {
      if (property !== "onAuthStateChange") return Reflect.get(target, property, receiver);
      return (callback: Parameters<Auth["onAuthStateChange"]>[0]) => {
        const result = target.onAuthStateChange(callback);
        const original = result.data.subscription;
        const tracked: Subscription = {
          ...original,
          unsubscribe: () => {
            if (subscriptions.delete(tracked)) {
              retiredCallbacks.add(callback);
              original.unsubscribe();
            }
          },
        };
        subscriptions.add(tracked);
        return { ...result, data: { ...result.data, subscription: tracked } };
      };
    },
  });
  return { auth: trackedAuth, subscriptions, retiredCallbacks };
}

let sequence = 0;
async function setup(
  mode:
    | "normal"
    | "put"
    | "logout"
    | "refresh"
    | "error"
    | "recovery"
    | "refresh-error"
    | "held-refresh-error"
    | "bounded-refresh-loop" = "normal",
  initializeStore = true,
  initialSession = session(1),
  qfSyncEnabled = false,
) {
  mockQfSyncEnabled = qfSyncEnabled;
  mockBrowser.mockReset().mockResolvedValue({ type: "cancel" });
  const key = `rf125-store-runtime-${++sequence}`;
  const initial = initialSession,
    refreshed = sameSessionRefresh(initial);
  let refreshResponse = refreshed;
  let callbackUser = initial.user;
  const values = new Map([[key, JSON.stringify(initial)]]);
  type HeldRead = { started: ReturnType<typeof deferred>; release: ReturnType<typeof deferred>; skip: number };
  let nextRead: HeldRead | undefined;
  const heldReads = new Set<HeldRead>();
  function holdNextSessionRead(skip = 0) {
    if (nextRead) throw new Error("A session read is already armed");
    const held: HeldRead = { started: deferred(), release: deferred(), skip };
    nextRead = held;
    heldReads.add(held);
    return {
      started: held.started.promise,
      release: held.release.resolve,
      cancel: () => {
        if (nextRead === held) nextRead = undefined;
        held.release.resolve();
        heldReads.delete(held);
      },
    };
  }
  let nextWrite: ReturnType<typeof holdNextSessionWrite> | undefined;
  function holdNextSessionWrite() {
    if (nextWrite) throw new Error("A session write is already armed");
    const started = deferred(),
      release = deferred();
    const held = {
      started: started.promise,
      committed: started.resolve,
      release: release.resolve,
      wait: release.promise,
    };
    nextWrite = held;
    return held;
  }
  const storage = {
    getItem: async (name: string) => {
      const snapshot = values.get(name) ?? null;
      if (name !== key || !nextRead) return snapshot;
      if (nextRead.skip > 0) {
        nextRead.skip -= 1;
        return snapshot;
      }
      const held = nextRead;
      nextRead = undefined;
      held.started.resolve();
      try {
        await held.release.promise;
        return snapshot;
      } finally {
        heldReads.delete(held);
      }
    },
    setItem: async (name: string, value: string) => {
      values.set(name, value);
      if (name === key && nextWrite) {
        const held = nextWrite;
        nextWrite = undefined;
        // The raw write has committed; hold its return before SDK notification.
        held.committed();
        await held.wait;
      }
    },
    removeItem: (name: string) => {
      values.delete(name);
    },
  };
  const started = deferred(),
    release = deferred();
  const events: { event: string; session: Session | null }[] = [];
  const requests: string[] = [];
  const requestHeaders: { method: string; url: string; apikey: string | null; authorization: string | null }[] = [];
  const qfRequests: {
    action: string;
    providerAccessToken?: string;
    providerRefreshToken?: string;
    authorization: string | null;
  }[] = [];
  let refreshCount = 0;
  const replacements: Session[] = [];
  useAuthStore.setState({
    session: null,
    user: null,
    profile: null,
    isLoading: false,
    isInitialized: false,
    error: null,
  });
  mockLastPasswordError = null;
  mockLastReadError = null;
  mockProfileReads.length = 0;
  const runtime = createRootAuthRuntime({
    url: "https://synthetic.example.invalid/",
    anonKey: "public-synthetic-key",
    storageKey: key,
    isWeb: false,
    nativeStorage: storage,
    fetch: async (input, init) => {
      const url = String(input),
        path = new URL(url).pathname,
        method = init?.method ?? "GET";
      requests.push(`${method} ${url}`);
      const headers = new Headers(init?.headers);
      requestHeaders.push({ method, url, apikey: headers.get("apikey"), authorization: headers.get("Authorization") });
      let body: unknown,
        status = 200;
      if (path.endsWith("/qf-user") && method === "POST") {
        const action = JSON.parse(String(init?.body ?? "{}"));
        qfRequests.push({
          action: action.action,
          providerAccessToken: action.providerAccessToken,
          providerRefreshToken: action.providerRefreshToken,
          authorization: headers.get("Authorization"),
        });
        body = { ok: true, status: "connected" };
      } else if (path.endsWith("/user/identities/authorize")) {
        body = { url: "https://synthetic.authorization.invalid/authorize" };
      } else if (path.endsWith("/user") && method === "PUT") {
        started.resolve();
        if (mode === "put") await release.promise;
        if (mode === "error") {
          status = 400;
          body = { msg: "Synthetic password rejected", error_code: "synthetic_password_rejected" };
        } else body = { user: { ...initial.user, user_metadata: { updated: true } } };
      } else if (path.endsWith("/user")) {
        if (mode === "recovery") {
          started.resolve();
          await release.promise;
        }
        body = { user: callbackUser };
      } else if (path.endsWith("/logout")) {
        started.resolve();
        if (mode === "logout") await release.promise;
        body = {};
      } else if (url.includes("grant_type=refresh_token")) {
        started.resolve();
        if (mode === "refresh" || mode === "held-refresh-error") await release.promise;
        if (
          mode === "refresh-error" ||
          mode === "held-refresh-error" ||
          (mode === "bounded-refresh-loop" && ++refreshCount < 4)
        ) {
          status = 400;
          body = { msg: "Synthetic recovery token rejected", error_code: "synthetic_recovery_rejected" };
        } else body = refreshResponse;
      } else if (url.includes("grant_type=password")) {
        body = replacements.shift();
        if (!body) throw new Error("Missing synthetic replacement");
      } else throw new Error(`Unexpected synthetic request ${method} ${url}`);
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    },
  });
  const tracked = trackSubscriptions(runtime.auth);
  runtime.auth = tracked.auth;
  mockRuntime = runtime;
  await runtime.auth.initialize();
  await runtime.auth.stopAutoRefresh();
  runtime.auth.onAuthStateChange((event, session) => {
    events.push({ event, session });
  });
  if (initializeStore) await useAuthStore.getState().initialize();
  await settleAuth();
  async function settleAuth() {
    await new Promise<void>((resolve) => {
      const barrier = runtime.auth.onAuthStateChange((event) => {
        if (event === "INITIAL_SESSION") {
          barrier.data.subscription.unsubscribe();
          resolve();
        }
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (initializeStore) expect(useAuthStore.getState().user?.id).toBe(initial.user.id);
  return {
    runtime,
    setCallbackUser: (next: User) => {
      callbackUser = next;
    },
    setRefreshResponse: (next: Session) => {
      refreshResponse = next;
    },
    holdNextSessionRead,
    holdNextSessionWrite,
    settleAuth,
    subscriptionCount: () => tracked.subscriptions.size,
    retiredCallbacks: tracked.retiredCallbacks,
    initial,
    refreshed,
    values,
    key,
    events,
    requests,
    requestHeaders,
    qfRequests,
    started,
    release,
    external: async (next: Session) => {
      replacements.push(next);
      const result = await runtime.auth.signInWithPassword({
        email: "external@example.invalid",
        password: "synthetic",
      });
      expect(result.error).toBeNull();
      return result;
    },
    persisted: () => JSON.parse(values.get(key) ?? "null") as Session | null,
    close: async () => {
      release.resolve();
      nextRead = undefined;
      nextWrite?.release();
      nextWrite = undefined;
      for (const held of heldReads) held.release.resolve();
      for (const subscription of [...tracked.subscriptions]) subscription.unsubscribe();
      await runtime.auth.stopAutoRefresh();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(tracked.subscriptions.size).toBe(0);
    },
  };
}

function trackQfConnections() {
  const calls: { session: Session | null; promise: Promise<unknown> }[] = [];
  const original = qfUser.connectQfFromSession;
  const spy = jest.spyOn(qfUser, "connectQfFromSession").mockImplementation((...args) => {
    const promise = original(...args);
    calls.push({ session: args[0], promise });
    return promise;
  });
  return {
    calls,
    settle: () => Promise.allSettled(calls.map((call) => call.promise)),
    restore: () => spy.mockRestore(),
  };
}
function gateNextSdkSessionRead(runtime: ReturnType<typeof createRootAuthRuntime>) {
  const entered = deferred();
  const release = deferred();
  const auth = runtime.client.auth;
  const original = auth.getSession.bind(auth);
  let armed = true;
  Object.defineProperty(auth, "getSession", {
    configurable: true,
    value: async (...args: Parameters<typeof auth.getSession>) => {
      await original(...args); // Finish the real read and release the SDK storage lock first.
      if (armed) {
        armed = false;
        entered.resolve();
        await release.promise;
      }
      return original(...args); // Read the current session after the replacement publishes.
    },
  });
  return {
    entered: entered.promise,
    release: release.resolve,
    restore: () => {
      delete (auth as unknown as Record<string, unknown>).getSession;
    },
  };
}
it("retires detached A provider credentials before dispatch under B app Authorization", async () => {
  const connections = trackQfConnections();
  const f = await setup("normal", true, session(1), true);
  const gate = gateNextSdkSessionRead(f.runtime);
  const a = session(1, 0, 3600, { accessToken: "provider-token-A", refreshToken: "provider-refresh-A" });
  const signingInA = f.external(a);
  try {
    await gate.entered;
    await signingInA;
    const b = session(2);
    await f.external(b);
    expect(useAuthStore.getState().session?.access_token).toBe(b.access_token);
    gate.release();
    await connections.settle();
    expect(f.qfRequests).toEqual([]);
  } finally {
    gate.release();
    await Promise.allSettled([signingInA, ...connections.calls.map((call) => call.promise)]);
    gate.restore();
    connections.restore();
    await f.close();
  }
});

it.each(["same-user-new-session", "signout", "closed-ABA"] as const)(
  "retires detached provider connect after %s",
  async (transition) => {
    const connections = trackQfConnections();
    const f = await setup("normal", true, session(1), true);
    const gate = gateNextSdkSessionRead(f.runtime);
    const a = session(1, 0, 3600, { accessToken: "provider-token-A", refreshToken: "provider-refresh-A" });
    const signingInA = f.external(a);
    try {
      await gate.entered;
      await signingInA; // A's auth callback returned while its connection is still pending.
      if (transition === "signout") {
        expect((await f.runtime.auth.signOut()).error).toBeNull();
      } else if (transition === "closed-ABA") {
        await f.external(session(2));
        await f.external(session(1)); // Same original identity, without provider tokens.
      } else {
        await f.external(session(1, 1));
      }
      gate.release();
      await connections.settle();
      expect(f.qfRequests).toEqual([]);
    } finally {
      gate.release();
      await Promise.allSettled([signingInA, ...connections.calls.map((call) => call.promise)]);
      gate.restore();
      connections.restore();
      await f.close();
    }
  },
);

it("keeps A provider credentials while a matching session refresh supplies the current app token", async () => {
  const connections = trackQfConnections();
  const f = await setup("normal", true, session(1), true);
  const gate = gateNextSdkSessionRead(f.runtime);
  const a = session(1, 0, 3600, { accessToken: "provider-token-A", refreshToken: "provider-refresh-A" });
  const signingInA = f.external(a);
  try {
    await gate.entered;
    await signingInA;
    const refreshed = sameSessionRefresh(a);
    const result = await f.runtime.auth.setSession({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
    });
    expect(result.error).toBeNull();
    expect(useAuthStore.getState().session?.access_token).toBe(refreshed.access_token);
    gate.release();
    await connections.settle();
    expect(f.qfRequests).toHaveLength(1);
    expect(f.qfRequests[0]).toMatchObject({
      action: "connect",
      providerAccessToken: "provider-token-A",
      providerRefreshToken: "provider-refresh-A",
      authorization: `Bearer ${refreshed.access_token}`,
    });
  } finally {
    gate.release();
    await Promise.allSettled([signingInA, ...connections.calls.map((call) => call.promise)]);
    gate.restore();
    connections.restore();
    await f.close();
  }
});

it("auto-connects once from the accepted startup session with matching credentials", async () => {
  const connections = trackQfConnections();
  const initial = session(1, 0, 3600, { accessToken: "startup-provider-A", refreshToken: "startup-refresh-A" });
  const f = await setup("normal", true, initial, true);
  try {
    await connections.settle();
    expect(connections.calls).toHaveLength(1);
    expect(connections.calls[0]?.session?.access_token).toBe(initial.access_token);
    expect(f.qfRequests).toHaveLength(1);
    expect(f.qfRequests[0]).toMatchObject({
      action: "connect",
      providerAccessToken: "startup-provider-A",
      providerRefreshToken: "startup-refresh-A",
      authorization: `Bearer ${initial.access_token}`,
    });
  } finally {
    await connections.settle();
    connections.restore();
    await f.close();
  }
});

it("auto-connects from a newly accepted auth event with that event's credentials", async () => {
  const f = await setup("normal", true, session(1), true);
  const connections = trackQfConnections();
  const a = session(2, 0, 3600, { accessToken: "event-provider-B", refreshToken: "event-refresh-B" });
  try {
    await f.external(a);
    await connections.settle();
    expect(connections.calls).toHaveLength(1);
    expect(connections.calls[0]?.session?.access_token).toBe(a.access_token);
    expect(f.qfRequests).toHaveLength(1);
    expect(f.qfRequests[0]).toMatchObject({
      action: "connect",
      providerAccessToken: "event-provider-B",
      providerRefreshToken: "event-refresh-B",
      authorization: `Bearer ${a.access_token}`,
    });
  } finally {
    await connections.settle();
    connections.restore();
    await f.close();
  }
});

it("keeps disabled and missing-provider auto-connect controls quiet", async () => {
  const disabledConnections = trackQfConnections();
  const disabled = await setup("normal", true, session(1, 0, 3600, { accessToken: "disabled-provider" }), false);
  try {
    await disabledConnections.settle();
    expect(disabledConnections.calls).toHaveLength(0);
    expect(disabled.qfRequests).toEqual([]);
  } finally {
    disabledConnections.restore();
    await disabled.close();
  }

  const noProviderConnections = trackQfConnections();
  const enabled = await setup("normal", true, session(1), true);
  try {
    await enabled.external(session(2));
    await noProviderConnections.settle();
    expect(noProviderConnections.calls).toHaveLength(0);
    expect(enabled.qfRequests).toEqual([]);
  } finally {
    noProviderConnections.restore();
    await enabled.close();
  }
});

it("real runtime/store preserves normal password callbacks and terminal recovery signout", async () => {
  const f = await setup();
  try {
    const result = await useAuthStore.getState().updatePassword("synthetic-password");
    expect(result.status).toBe("completed");
    expect(f.requestHeaders.find((request) => request.method === "PUT")).toMatchObject({
      apikey: "public-synthetic-key",
      authorization: `Bearer ${f.initial.access_token}`,
    });
    expect(useAuthStore.getState().user?.user_metadata.updated).toBe(true);
    expect(f.persisted()?.user.user_metadata.updated).toBe(true);
    expect(f.events.some((row) => row.event === "USER_UPDATED")).toBe(true);
    expect((await finishPasswordRecovery(authCommands.captureOwner())).status).toBe("completed");
    expect(f.persisted()).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
    expect((await f.runtime.auth.getSession()).data.session).toBeNull();
  } finally {
    await f.close();
  }
});
it.each([false, true])(
  "real runtime/store refuses old password overwrite for same-user replacement=%s",
  async (sameUser) => {
    const f = await setup("put");
    const pending = useAuthStore.getState().updatePassword("synthetic-password");
    try {
      await f.started.promise;
      const replacement = session(sameUser ? 1 : 2, 1);
      await f.external(replacement);
      useAuthStore.setState({ error: "B pending", isLoading: true });
      const before = f.events.length;
      f.release.resolve();
      expect(await pending).toEqual({ status: "superseded" });
      expect(f.persisted()?.access_token).toBe(replacement.access_token);
      expect(useAuthStore.getState().session?.access_token).toBe(replacement.access_token);
      expect(useAuthStore.getState().error).toBe("B pending");
      expect(useAuthStore.getState().isLoading).toBe(true);
      expect(f.events.slice(before).some((row) => row.event === "USER_UPDATED")).toBe(false);
    } finally {
      f.release.resolve();
      await pending;
      await f.close();
    }
  },
);
it("real runtime/store permits external B and C during an old password PUT", async () => {
  const f = await setup("put");
  const pending = useAuthStore.getState().updatePassword("synthetic-password");
  try {
    await f.started.promise;
    await f.external(session(2));
    const c = session(3);
    await f.external(c);
    f.release.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    expect(f.persisted()?.user.id).toBe(c.user.id);
    expect(useAuthStore.getState().user?.id).toBe(c.user.id);
  } finally {
    f.release.resolve();
    await pending;
    await f.close();
  }
});
it("real runtime/store never clears B when old remote logout completes", async () => {
  const f = await setup("logout");
  const pending = finishPasswordRecovery(authCommands.captureOwner());
  try {
    await f.started.promise;
    const b = session(2);
    await f.external(b);
    useAuthStore.setState({ error: "B pending", isLoading: true });
    f.release.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    expect(f.persisted()?.access_token).toBe(b.access_token);
    expect(useAuthStore.getState().session?.access_token).toBe(b.access_token);
    expect(useAuthStore.getState().error).toBe("B pending");
    expect(useAuthStore.getState().isLoading).toBe(true);
  } finally {
    f.release.resolve();
    await pending;
    await f.close();
  }
});
it("real runtime/store retains issued same-session password success after screen cancellation", async () => {
  const f = await setup("put");
  const owner = authCommands.captureOwner();
  const pending = useAuthStore.getState().updatePassword("synthetic-password", owner);
  try {
    await f.started.promise;
    owner.cancel();
    useAuthStore.setState({ error: "new screen", isLoading: true });
    f.release.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    expect(f.persisted()?.user.user_metadata.updated).toBe(true);
    expect(useAuthStore.getState().user?.user_metadata.updated).toBe(true);
    expect(useAuthStore.getState().error).toBe("new screen");
    expect(useAuthStore.getState().isLoading).toBe(true);
  } finally {
    f.release.resolve();
    await pending;
    await f.close();
  }
});
it("real runtime/store retains issued near-expiry refresh after cancellation without a password PUT", async () => {
  const f = await setup("refresh");
  let pending: ReturnType<ReturnType<typeof useAuthStore.getState>["updatePassword"]> | undefined;
  try {
    const near = session(1, 0, 60);
    expect(
      (await f.runtime.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token })).error,
    ).toBeNull();
    const owner = authCommands.captureOwner();
    pending = useAuthStore.getState().updatePassword("synthetic-password", owner);
    await f.started.promise;
    owner.cancel();
    f.release.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    expect(f.persisted()?.refresh_token).toBe(f.refreshed.refresh_token);
    expect(useAuthStore.getState().session?.refresh_token).toBe(f.refreshed.refresh_token);
    expect(f.events.some((row) => row.event === "TOKEN_REFRESHED")).toBe(true);
    expect(f.requests.some((row) => row.startsWith("PUT "))).toBe(false);
  } finally {
    f.release.resolve();
    await pending;
    await f.close();
  }
});
it("real runtime/store keeps valid sixty-second sessions usable for current password commands", async () => {
  const f = await setup("refresh");
  try {
    const near = session(1, 0, 60);
    expect(
      (await f.runtime.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token })).error,
    ).toBeNull();
    f.release.resolve();
    expect((await useAuthStore.getState().updatePassword("synthetic-password")).status).toBe("completed");
    expect(f.persisted()?.refresh_token).toBe(f.refreshed.refresh_token);
    expect(useAuthStore.getState().user?.user_metadata.updated).toBe(true);
  } finally {
    await f.close();
  }
});
it("real runtime/store refuses first-command refresh persistence over external B and C", async () => {
  const f = await setup("refresh");
  let pending: ReturnType<ReturnType<typeof useAuthStore.getState>["updatePassword"]> | undefined;
  try {
    const near = session(1, 0, 60);
    expect(
      (await f.runtime.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token })).error,
    ).toBeNull();
    pending = useAuthStore.getState().updatePassword("synthetic-password");
    await f.started.promise;
    await f.external(session(2));
    const c = session(3);
    await f.external(c);
    f.release.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    expect(f.persisted()?.access_token).toBe(c.access_token);
    expect(useAuthStore.getState().session?.access_token).toBe(c.access_token);
    expect(f.requests.some((row) => row.startsWith("PUT "))).toBe(false);
  } finally {
    f.release.resolve();
    await pending;
    await f.close();
  }
});
it("real runtime/store preserves current SDK error identity and error publication", async () => {
  const f = await setup("error");
  try {
    let caught: unknown;
    try {
      await useAuthStore.getState().updatePassword("synthetic-password");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(mockLastPasswordError);
    expect(caught).toMatchObject({ message: "Synthetic password rejected", code: "synthetic_password_rejected" });
    expect(useAuthStore.getState().error).toBe("Synthetic password rejected");
    expect(f.persisted()?.user.user_metadata.updated).toBeUndefined();
  } finally {
    await f.close();
  }
});
it("real runtime/store rejects cancelled commands before any SDK request", async () => {
  const f = await setup();
  try {
    const owner = authCommands.captureOwner();
    owner.cancel();
    const before = f.requests.length;
    useAuthStore.setState({ error: "untouched", isLoading: true });
    expect(await useAuthStore.getState().updatePassword("synthetic-password", owner)).toEqual({ status: "superseded" });
    expect(f.requests).toHaveLength(before);
    expect(useAuthStore.getState().error).toBe("untouched");
    expect(useAuthStore.getState().isLoading).toBe(true);
  } finally {
    await f.close();
  }
});

it("real runtime/store completes a current recovery session transition", async () => {
  const f = await setup("recovery");
  let pending: ReturnType<typeof preparePasswordRecovery> | undefined;
  try {
    const target = session(1, 4);
    pending = preparePasswordRecovery({ access_token: target.access_token, refresh_token: target.refresh_token });
    await f.started.promise;
    f.release.resolve();
    const result = await pending;
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.value).toBe(true);
      expect(result.owner.isCurrent()).toBe(true);
    }
    expect(f.persisted()?.access_token).toBe(target.access_token);
    expect(useAuthStore.getState().session?.access_token).toBe(target.access_token);
  } finally {
    f.release.resolve();
    await pending;
    await f.close();
  }
});
it("real runtime/store completes recovery from an actual anonymous SDK session", async () => {
  const f = await setup("recovery");
  let pending: ReturnType<typeof preparePasswordRecovery> | undefined;
  try {
    expect((await f.runtime.auth.signOut()).error).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
    const target = session(1, 4);
    pending = preparePasswordRecovery({ access_token: target.access_token, refresh_token: target.refresh_token });
    await f.started.promise;
    f.release.resolve();
    const result = await pending;
    expect(result.status).toBe("completed");
    if (result.status === "completed") expect(result.value).toBe(true);
    expect(f.persisted()?.access_token).toBe(target.access_token);
  } finally {
    f.release.resolve();
    await pending;
    await f.close();
  }
});
it.each([false, true])(
  "real runtime/store never lets late recovery replace external B, same-user=%s",
  async (sameUser) => {
    const f = await setup("recovery");
    let pending: ReturnType<typeof preparePasswordRecovery> | undefined;
    try {
      const target = session(1, 4);
      pending = preparePasswordRecovery({ access_token: target.access_token, refresh_token: target.refresh_token });
      await f.started.promise;
      const b = session(sameUser ? 1 : 2, 5);
      await f.external(b);
      const before = f.events.length;
      f.release.resolve();
      expect(await pending).toEqual({ status: "superseded" });
      expect(f.persisted()?.access_token).toBe(b.access_token);
      expect(useAuthStore.getState().session?.access_token).toBe(b.access_token);
      expect(f.events.slice(before).some((row) => row.event === "SIGNED_IN")).toBe(false);
    } finally {
      f.release.resolve();
      await pending;
      await f.close();
    }
  },
);
it("real runtime/store refuses a cancelled recovery before it can persist a new session", async () => {
  const f = await setup("recovery");
  let active = true;
  let pending: ReturnType<typeof preparePasswordRecovery> | undefined;
  try {
    const target = session(1, 4);
    pending = preparePasswordRecovery(
      { access_token: target.access_token, refresh_token: target.refresh_token },
      () => active,
    );
    await f.started.promise;
    active = false;
    const before = f.events.length;
    f.release.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    expect(f.persisted()?.access_token).toBe(f.initial.access_token);
    expect(useAuthStore.getState().session?.access_token).toBe(f.initial.access_token);
    expect(f.events.slice(before).some((row) => row.event === "SIGNED_IN")).toBe(false);
  } finally {
    f.release.resolve();
    await pending;
    await f.close();
  }
});

it("real runtime/store native recovery read cannot refresh A over external B", async () => {
  const f = await setup("refresh");
  let pending: ReturnType<typeof preparePasswordRecovery> | undefined;
  try {
    const near = session(1, 0, 60);
    expect(
      (await f.runtime.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token })).error,
    ).toBeNull();
    pending = preparePasswordRecovery();
    await f.started.promise;
    const b = session(2);
    await f.external(b);
    f.release.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    expect(f.persisted()?.access_token).toBe(b.access_token);
    expect(useAuthStore.getState().session?.access_token).toBe(b.access_token);
  } finally {
    f.release.resolve();
    await pending;
    await f.close();
  }
});

it("real runtime/store keeps a current native recovery read usable", async () => {
  const f = await setup();
  try {
    const result = await preparePasswordRecovery();
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.value).toBe(true);
      expect(result.owner.isCurrent()).toBe(true);
    }
    expect(f.persisted()?.access_token).toBe(f.initial.access_token);
  } finally {
    await f.close();
  }
});
it("real runtime/store keeps an anonymous native recovery read anonymous", async () => {
  const f = await setup();
  try {
    expect((await f.runtime.auth.signOut()).error).toBeNull();
    const result = await preparePasswordRecovery();
    expect(result.status).toBe("completed");
    if (result.status === "completed") expect(result.value).toBe(false);
    expect(f.persisted()).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
  } finally {
    await f.close();
  }
});
it("real runtime/store preserves prior session and SDK error identity for rejected expired recovery tokens", async () => {
  const f = await setup("refresh-error");
  try {
    const target = session(1, 4, -60);
    let caught: unknown;
    try {
      await preparePasswordRecovery({ access_token: target.access_token, refresh_token: target.refresh_token });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(mockLastRecoveryError);
    expect(caught).toMatchObject({ message: "Synthetic recovery token rejected", code: "synthetic_recovery_rejected" });
    expect(f.persisted()?.access_token).toBe(f.initial.access_token);
    expect(useAuthStore.getState().session?.access_token).toBe(f.initial.access_token);
    expect(f.events.some((row) => row.event === "SIGNED_OUT")).toBe(false);
  } finally {
    await f.close();
  }
});
it("real runtime/store refuses recovery before dispatch after route cancellation", async () => {
  const f = await setup();
  try {
    const before = f.requests.length;
    expect(
      await preparePasswordRecovery(
        { access_token: f.initial.access_token, refresh_token: f.initial.refresh_token },
        () => false,
      ),
    ).toEqual({ status: "superseded" });
    expect(f.requests).toHaveLength(before);
  } finally {
    await f.close();
  }
});

it("rejected recovery with a near-expiry prior session returns without extra refresh requests", async () => {
  const f = await setup("bounded-refresh-loop");
  try {
    const near = session(1, 0, 60);
    expect(
      (await f.runtime.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token })).error,
    ).toBeNull();
    const target = session(2, 4, -60);
    let caught: unknown;
    try {
      await preparePasswordRecovery({ access_token: target.access_token, refresh_token: target.refresh_token });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(mockLastRecoveryError);
    expect(caught).toMatchObject({ message: "Synthetic recovery token rejected" });
    expect(f.requests.filter((row) => row.includes("grant_type=refresh_token"))).toHaveLength(1);
    expect(f.persisted()?.access_token).toBe(near.access_token);
    expect(useAuthStore.getState().session?.access_token).toBe(near.access_token);
  } finally {
    await f.close();
  }
});

it.each([true, false])(
  "repeated and concurrent initialization retain one store listener, previously initialized=%s",
  async (initialized) => {
    const f = await setup("normal", initialized);
    try {
      await Promise.all([
        useAuthStore.getState().initialize(),
        useAuthStore.getState().initialize(),
        useAuthStore.getState().initialize(),
      ]);
      await f.settleAuth();
      const before = mockProfileReads.length;
      const b = session(2);
      await f.external(b);
      expect({ subscriptions: f.subscriptionCount(), profileReads: mockProfileReads.slice(before) }).toEqual({
        subscriptions: 2,
        profileReads: [b.user.id],
      });
    } finally {
      await f.close();
    }
  },
);
it.each([false, true].flatMap((sameUser) => [false, true].map((force) => ({ sameUser, force }))))(
  "late repeated startup cannot replace B or revoke its owner, same-user=$sameUser forced=$force",
  async ({ sameUser, force }) => {
    const f = await setup();
    if (force) useAuthStore.setState({ isInitialized: false });
    const held = f.holdNextSessionRead();
    const b = session(sameUser ? 1 : 2, 1);
    const observed: { owner?: AuthOwner; tokens: (string | null)[] } = { tokens: [] };
    const detach = useAuthStore.subscribe((state, previous) => {
      if (state.session === previous.session) return;
      const token = state.session?.access_token ?? null;
      if (token === b.access_token && !observed.owner) observed.owner = authCommands.captureOwner();
      if (observed.owner) observed.tokens.push(token);
    });
    const startup = useAuthStore.getState().initialize();
    let external: ReturnType<typeof f.external> | undefined;
    let overlap: ReturnType<typeof f.runtime.auth.getSession> | undefined;
    try {
      const path = await Promise.race([
        held.started.then(() => "read" as const),
        startup.then(() => "completed" as const),
      ]);
      if (path === "read") {
        external = f.external(b);
        overlap = f.runtime.auth.getSession();
        held.release();
      } else {
        held.cancel();
        external = f.external(b);
      }
      await Promise.all([startup, external, overlap]);
      await f.settleAuth();
      expect(observed.tokens.length).toBeGreaterThan(0);
      expect(observed.tokens.every((token) => token === b.access_token)).toBe(true);
      expect(observed.owner?.isCurrent()).toBe(true);
      expect(useAuthStore.getState().session?.access_token).toBe(b.access_token);
      expect(f.persisted()?.access_token).toBe(b.access_token);
      expect(f.subscriptionCount()).toBe(2);
    } finally {
      held.cancel();
      await Promise.allSettled([startup, external, overlap]);
      detach();
      await f.close();
    }
  },
);
it.each([false, true])(
  "first startup cannot publish old A after an actual SDK B notification, same-user=%s",
  async (sameUser) => {
    const f = await setup("normal", false);
    const held = f.holdNextSessionRead();
    const b = session(sameUser ? 1 : 2, 1);
    let replacementNotified = false;
    const publications: (string | null)[] = [];
    let owner: AuthOwner | undefined;
    const observer = f.runtime.auth.onAuthStateChange((_event, current) => {
      if (current?.access_token === b.access_token) replacementNotified = true;
    }).data.subscription;
    const detach = useAuthStore.subscribe((state, previous) => {
      if (state.session === previous.session || !replacementNotified) return;
      publications.push(state.session?.access_token ?? null);
      if (state.session?.access_token === b.access_token && !owner) owner = authCommands.captureOwner();
    });
    const startup = useAuthStore.getState().initialize();
    let external: ReturnType<typeof f.external> | undefined;
    let overlap: ReturnType<typeof f.runtime.auth.getSession> | undefined;
    try {
      await held.started;
      external = f.external(b);
      overlap = f.runtime.auth.getSession();
      held.release();
      await Promise.all([startup, external, overlap]);
      await f.settleAuth();
      expect(replacementNotified).toBe(true);
      expect(publications.length).toBeGreaterThan(0);
      expect(publications.every((token) => token === b.access_token)).toBe(true);
      expect(owner?.isCurrent()).toBe(true);
      expect(f.persisted()?.access_token).toBe(b.access_token);
    } finally {
      held.cancel();
      await Promise.allSettled([startup, external, overlap]);
      observer.unsubscribe();
      detach();
      await f.close();
    }
  },
);

it("retired store callbacks cannot restore A after a fresh initialization observes B", async () => {
  const f = await setup();
  try {
    useAuthStore.setState({ isInitialized: false });
    await useAuthStore.getState().initialize();
    await f.settleAuth();
    const b = session(2);
    await f.external(b);
    const owner = authCommands.captureOwner();
    const current = useAuthStore.getState();
    const before = mockProfileReads.length;
    for (const callback of f.retiredCallbacks) await callback("SIGNED_IN", f.initial);
    expect(f.subscriptionCount()).toBe(2);
    expect(useAuthStore.getState().session).toBe(current.session);
    expect(useAuthStore.getState().profile).toBe(current.profile);
    expect(mockProfileReads).toHaveLength(before);
    expect(owner.isCurrent()).toBe(true);
  } finally {
    await f.close();
  }
});

it.each(["refresh", "metadata", "same-session-signin"] as const)(
  "startup never restores an old snapshot after actual same-session %s notice",
  async (kind) => {
    const f = await setup();
    useAuthStore.setState({ isInitialized: false });
    const held = f.holdNextSessionRead(1);
    const fingerprint = (value: Session | null) =>
      JSON.stringify(
        value ? { access: value.access_token, refresh: value.refresh_token, metadata: value.user.user_metadata } : null,
      );
    let newerObserved = false;
    let owner: AuthOwner | undefined;
    const publications: string[] = [];
    const expected =
      kind === "metadata"
        ? { ...f.initial, user: { ...f.initial.user, user_metadata: { updated: true } } }
        : f.refreshed;
    const newer = fingerprint(expected);
    const detach = useAuthStore.subscribe((state, previous) => {
      if (state.session === previous.session) return;
      const current = fingerprint(state.session);
      if (current === newer && !newerObserved) {
        newerObserved = true;
        owner = authCommands.captureOwner();
      }
      if (newerObserved) publications.push(current);
    });
    const startup = useAuthStore.getState().initialize();
    let operation: Promise<unknown> | undefined;
    let overlap: ReturnType<typeof f.runtime.auth.getSession> | undefined;
    try {
      await held.started;
      operation =
        kind === "refresh"
          ? f.runtime.auth.refreshSession()
          : kind === "metadata"
            ? f.runtime.auth.updateUser({ data: { updated: true } })
            : f.external(f.refreshed);
      overlap = f.runtime.auth.getSession();
      held.release();
      await Promise.all([startup, operation, overlap]);
      await f.settleAuth();
      expect(newerObserved).toBe(true);
      expect(publications.length).toBeGreaterThan(0);
      expect(publications.every((value) => value === newer)).toBe(true);
      expect(fingerprint(useAuthStore.getState().session)).toBe(newer);
      expect(fingerprint(f.persisted())).toBe(newer);
      expect(owner?.isCurrent()).toBe(true);
    } finally {
      held.cancel();
      await Promise.allSettled([startup, operation, overlap]);
      detach();
      await f.close();
    }
  },
);

it.each([0, 1])(
  "startup cannot restore an old A snapshot after actual SDK A-B-A, held-read-offset=%s",
  async (offset) => {
    const f = await setup();
    useAuthStore.setState({ isInitialized: false });
    const held = f.holdNextSessionRead(offset);
    const returned = { ...f.refreshed, user: { ...f.refreshed.user, user_metadata: { returned: true } } };
    let observedB = false;
    const originalOwner = authCommands.captureOwner();
    let returnedObserved = false;
    let owner: AuthOwner | undefined;
    const publications: Session[] = [];
    const detach = useAuthStore.subscribe((state, previous) => {
      if (state.session === previous.session || !state.session) return;
      if (state.session.user.id === session(2).user.id) observedB = true;
      if (
        state.session.access_token === returned.access_token &&
        state.session.user.user_metadata.returned === true &&
        !returnedObserved &&
        observedB
      ) {
        returnedObserved = true;
        owner = authCommands.captureOwner();
      }
      if (returnedObserved) publications.push(state.session);
    });
    const startup = useAuthStore.getState().initialize();
    let away: ReturnType<typeof f.external> | undefined;
    let back: ReturnType<typeof f.external> | undefined;
    let overlap: ReturnType<typeof f.runtime.auth.getSession> | undefined;
    try {
      await held.started;
      away = f.external(session(2));
      back = f.external(returned);
      overlap = f.runtime.auth.getSession();
      held.release();
      await Promise.all([startup, away, back, overlap]);
      await f.settleAuth();
      expect(observedB).toBe(true);
      expect(originalOwner.isCurrent()).toBe(false);
      expect(returnedObserved).toBe(true);
      expect(publications.length).toBeGreaterThan(0);
      expect(
        publications.every(
          (value) => value.access_token === returned.access_token && value.user.user_metadata.returned === true,
        ),
      ).toBe(true);
      expect(owner?.isCurrent()).toBe(true);
      expect(useAuthStore.getState().session?.access_token).toBe(returned.access_token);
      expect(f.persisted()?.access_token).toBe(returned.access_token);
    } finally {
      held.cancel();
      await Promise.allSettled([startup, away, back, overlap]);
      detach();
      await f.close();
    }
  },
);

it.each(["put", "refresh", "logout"] as const)(
  "real runtime/store rejects retired same-identity %s settlement at a newer intent",
  async (mode) => {
    const f = await setup(mode);
    let pending: Promise<unknown> | undefined;
    let replacement: Promise<unknown> | undefined;
    try {
      if (mode === "refresh") {
        const near = session(1, 0, 60);
        expect(
          (await f.runtime.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token }))
            .error,
        ).toBeNull();
      }
      const before = f.persisted();
      pending =
        mode === "logout"
          ? finishPasswordRecovery(authCommands.captureOwner())
          : useAuthStore.getState().updatePassword("synthetic-password");
      await f.started.promise;
      const events = f.events.length;
      replacement = authCommands.transition(async () => undefined);
      useAuthStore.setState({ error: "new intent", isLoading: true });
      f.release.resolve();
      expect(await pending).toEqual({ status: "superseded" });
      await replacement;
      expect(f.persisted()).toEqual(before);
      expect(useAuthStore.getState().session).toEqual(before);
      expect(f.events.slice(events)).toEqual([]);
      expect(useAuthStore.getState().error).toBe("new intent");
      expect(useAuthStore.getState().isLoading).toBe(true);
      if (mode === "refresh") expect(f.requests.some((row) => row.startsWith("PUT "))).toBe(false);
    } finally {
      f.release.resolve();
      await Promise.allSettled([pending, replacement]);
      await f.close();
    }
  },
);

it.each(["put", "refresh", "logout"] as const)(
  "real runtime/store rejects closed A-B-A %s settlement",
  async (mode) => {
    const f = await setup(mode);
    let pending: Promise<unknown> | undefined;
    try {
      if (mode === "refresh") {
        const near = session(1, 0, 60);
        expect(
          (await f.runtime.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token }))
            .error,
        ).toBeNull();
      }
      const original = f.persisted();
      if (!original) throw new Error("Missing starting session");
      pending =
        mode === "logout"
          ? finishPasswordRecovery(authCommands.captureOwner())
          : useAuthStore.getState().updatePassword("synthetic-password");
      await f.started.promise;
      await f.external(session(2));
      await f.external(original);
      const events = f.events.length;
      f.release.resolve();
      expect(await pending).toEqual({ status: "superseded" });
      expect(f.persisted()).toEqual(original);
      expect(useAuthStore.getState().session).toEqual(original);
      expect(f.events.slice(events)).toEqual([]);
      if (mode === "refresh") expect(f.requests.some((row) => row.startsWith("PUT "))).toBe(false);
    } finally {
      f.release.resolve();
      await pending;
      await f.close();
    }
  },
);

it("real runtime/store cancelled recovery read cannot persist or publish an issued refresh", async () => {
  const f = await setup("refresh");
  let active = true;
  let pending: ReturnType<typeof preparePasswordRecovery> | undefined;
  try {
    const near = session(1, 0, 60);
    expect(
      (await f.runtime.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token })).error,
    ).toBeNull();
    const before = f.persisted();
    pending = preparePasswordRecovery(undefined, () => active);
    await f.started.promise;
    const events = f.events.length;
    active = false;
    f.release.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    expect(f.persisted()).toEqual(before);
    expect(useAuthStore.getState().session).toEqual(before);
    expect(f.events.slice(events)).toEqual([]);
  } finally {
    f.release.resolve();
    await pending;
    await f.close();
  }
});

it.each(["put", "recovery"] as const)(
  "real runtime/store keeps an authorized %s commit but refuses retired notification",
  async (mode) => {
    const f = await setup(mode);
    const write = f.holdNextSessionWrite();
    let pending: Promise<unknown> | undefined;
    let replacement: Promise<unknown> | undefined;
    try {
      const target = session(1, 4);
      pending =
        mode === "put"
          ? useAuthStore.getState().updatePassword("synthetic-password")
          : preparePasswordRecovery({ access_token: target.access_token, refresh_token: target.refresh_token });
      await f.started.promise;
      f.release.resolve();
      await write.started;
      const committed = f.persisted();
      if (mode === "put") expect(committed?.user.user_metadata.updated).toBe(true);
      else expect(committed?.access_token).toBe(target.access_token);
      const events = f.events.length;
      const realtime = jest.spyOn(f.runtime.client.realtime, "setAuth");
      replacement = authCommands.transition(async () => undefined);
      write.release();
      expect(await pending).toEqual({ status: "superseded" });
      await replacement;
      expect(f.persisted()).toEqual(committed);
      expect(f.events.slice(events)).toEqual([]);
      expect(useAuthStore.getState().session?.access_token).toBe(f.initial.access_token);
      expect(useAuthStore.getState().user?.user_metadata.updated).toBeUndefined();
      expect(realtime).not.toHaveBeenCalled();
      realtime.mockRestore();
    } finally {
      f.release.resolve();
      write.release();
      await Promise.allSettled([pending, replacement]);
      await f.close();
    }
  },
);
it("real runtime/store current commit still publishes through its storage barrier", async () => {
  const f = await setup("put");
  const write = f.holdNextSessionWrite();
  const pending = useAuthStore.getState().updatePassword("synthetic-password");
  try {
    await f.started.promise;
    f.release.resolve();
    await write.started;
    write.release();
    expect((await pending).status).toBe("completed");
    expect(useAuthStore.getState().user?.user_metadata.updated).toBe(true);
    expect(f.events.some((row) => row.event === "USER_UPDATED")).toBe(true);
  } finally {
    f.release.resolve();
    write.release();
    await pending;
    await f.close();
  }
});

it("real runtime/store keeps cancelled issued terminal logout anonymous without reviving UI authority", async () => {
  const f = await setup("logout");
  const owner = authCommands.captureOwner();
  const pending = finishPasswordRecovery(owner);
  try {
    await f.started.promise;
    owner.cancel();
    useAuthStore.setState({ error: "new screen", isLoading: true });
    f.release.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    expect(f.persisted()).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
    expect(f.events.some((row) => row.event === "SIGNED_OUT")).toBe(true);
    expect(useAuthStore.getState().error).toBe("new screen");
    expect(useAuthStore.getState().isLoading).toBe(true);
  } finally {
    f.release.resolve();
    await pending;
    await f.close();
  }
});

it("real runtime/store stops remaining callbacks when a listener starts a newer auth intent", async () => {
  const f = await setup("put", false);
  let replacement: Promise<unknown> | undefined;
  const retiring = f.runtime.auth.onAuthStateChange((event) => {
    if (event === "USER_UPDATED") replacement = authCommands.transition(async () => undefined);
  }).data.subscription;
  await useAuthStore.getState().initialize();
  const late = jest.fn();
  const observer = f.runtime.auth.onAuthStateChange((event) => {
    if (event === "USER_UPDATED") late();
  }).data.subscription;
  const pending = useAuthStore.getState().updatePassword("synthetic-password");
  try {
    await f.started.promise;
    f.release.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    await replacement;
    expect(f.persisted()?.user.user_metadata.updated).toBe(true);
    expect(useAuthStore.getState().user?.user_metadata.updated).toBeUndefined();
    expect(late).not.toHaveBeenCalled();
  } finally {
    f.release.resolve();
    await Promise.allSettled([pending, replacement]);
    retiring.unsubscribe();
    observer.unsubscribe();
    await f.close();
  }
});

it("real runtime/store cancellation during first session read cannot start refresh work", async () => {
  const f = await setup("refresh");
  let pending: Promise<unknown> | undefined;
  let read: ReturnType<typeof f.holdNextSessionRead> | undefined;
  try {
    const near = session(1, 0, 60);
    expect(
      (await f.runtime.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token })).error,
    ).toBeNull();
    const before = f.persisted();
    const requests = f.requests.length;
    const events = f.events.length;
    const owner = authCommands.captureOwner();
    read = f.holdNextSessionRead();
    pending = useAuthStore.getState().updatePassword("synthetic-password", owner);
    await read.started;
    owner.cancel();
    read.release();
    f.release.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    expect(f.requests.slice(requests)).toEqual([]);
    expect(f.persisted()).toEqual(before);
    expect(useAuthStore.getState().session).toEqual(before);
    expect(f.events.slice(events)).toEqual([]);
  } finally {
    f.release.resolve();
    read?.cancel();
    await pending;
    await f.close();
  }
});

it("real runtime/store cancellation after validated read cannot dispatch refresh or delete its prior session", async () => {
  const f = await setup("refresh");
  let pending: Promise<unknown> | undefined;
  let read: ReturnType<typeof f.holdNextSessionRead> | undefined;
  try {
    const near = session(1, 0, 60);
    expect(
      (await f.runtime.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token })).error,
    ).toBeNull();
    const before = f.persisted();
    f.values.set(f.key + "-user", "synthetic prior user");
    f.values.set(f.key + "-code-verifier", "synthetic prior verifier");
    const keys = [...f.values];
    const events = f.events.length;
    const requests = f.requests.length;
    const owner = authCommands.captureOwner();
    const isCurrent = owner.isCurrent;
    let armed = false;
    let cancelledAfterValidation = false;
    const spy = jest.spyOn(owner, "isCurrent").mockImplementation(() => {
      const current = isCurrent();
      if (armed && current) {
        armed = false;
        // Retire after the adapter validates this read but before the SDK resumes.
        queueMicrotask(() => {
          owner.cancel();
          cancelledAfterValidation = true;
        });
      }
      return current;
    });
    read = f.holdNextSessionRead();
    pending = useAuthStore.getState().updatePassword("synthetic-password", owner);
    await read.started;
    armed = true;
    read.release();
    f.release.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    expect(cancelledAfterValidation).toBe(true);
    expect(f.requests.slice(requests)).toEqual([]);
    expect([...f.values]).toEqual(keys);
    expect(f.persisted()).toEqual(before);
    expect(useAuthStore.getState().session).toEqual(before);
    expect(f.events.slice(events)).toEqual([]);
    spy.mockRestore();
  } finally {
    f.release.resolve();
    read?.cancel();
    await pending;
    jest.restoreAllMocks();
    await f.close();
  }
});

it("real runtime/store preserves cleanup for a refresh failure that was actually issued", async () => {
  const f = await setup("refresh-error");
  try {
    const late = jest.fn();
    const listener = f.runtime.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") late();
    }).data.subscription;
    // Drain subscriber initialization while A is still long-lived. Only the
    // subsequent private password read may issue this failing refresh.
    await f.settleAuth();
    const near = session(1, 0, 60);
    expect(
      (await f.runtime.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token })).error,
    ).toBeNull();
    f.values.set(f.key + "-user", "synthetic prior user");
    f.values.set(f.key + "-code-verifier", "synthetic prior verifier");
    expect(await useAuthStore.getState().updatePassword("synthetic-password")).toEqual({ status: "superseded" });
    expect(f.requests.filter((row) => row.includes("grant_type=refresh_token"))).toHaveLength(1);
    expect(f.persisted()).toBeNull();
    expect(f.values.has(f.key + "-user")).toBe(false);
    expect(f.values.has(f.key + "-code-verifier")).toBe(false);
    expect(useAuthStore.getState().session).toBeNull();
    expect(late).toHaveBeenCalledTimes(1);
    listener.unsubscribe();
  } finally {
    await f.close();
  }
});

function beginNativeOAuth(provider: Parameters<typeof startAppOAuth>[0], mode: "sign-in" | "link" = "sign-in") {
  return startAppOAuth(provider, mode, useAuthStore.getState).result;
}
function holdNativeBrowser() {
  const started = deferred();
  let finish!: (result: BrowserResult) => void;
  const result = new Promise<BrowserResult>((resolve) => {
    finish = resolve;
  });
  mockBrowser.mockImplementation(async () => {
    started.resolve();
    return result;
  });
  return {
    started: started.promise,
    release: (session: Session | null, extra = "") => {
      const params = new URLSearchParams();
      if (session) {
        params.set("access_token", session.access_token);
        params.set("refresh_token", session.refresh_token);
      }
      if (extra) new URLSearchParams(extra).forEach((v, k) => params.set(k, v));
      finish({ type: "success", url: "hafiz://auth/callback#" + params.toString() });
    },
    cancel: () => finish({ type: "cancel" }),
  };
}

it.each(["external", "same-user", "ABA", "intent"] as const)(
  "native OAuth browser callback cannot replace its retired %s account lifetime",
  async (retirement) => {
    const f = await setup();
    const browser = holdNativeBrowser();
    const pending = beginNativeOAuth("google");
    let newer: Promise<unknown> | undefined;
    try {
      await browser.started;
      if (retirement === "external") await f.external(session(2));
      else if (retirement === "same-user") await f.external(session(1, 3));
      else if (retirement === "ABA") {
        await f.external(session(2));
        await f.external(f.initial);
      } else newer = authCommands.transition(async () => undefined);
      const before = f.persisted();
      const events = f.events.length;
      browser.release(session(1, 4));
      await pending;
      await newer;
      expect(f.persisted()).toEqual(before);
      expect(useAuthStore.getState().session).toEqual(before);
      expect(f.events.slice(events).some((row) => row.event === "SIGNED_IN")).toBe(false);
    } finally {
      browser.cancel();
      await Promise.allSettled([pending, newer]);
      await f.close();
    }
  },
);

it("native tokenless QF callback cannot send A provider credentials under external B", async () => {
  const f = await setup();
  const browser = holdNativeBrowser();
  const pending = beginNativeOAuth(QF_OAUTH_PROVIDER);
  try {
    await browser.started;
    await f.external(session(2));
    browser.release(null, "provider_token=synthetic-provider-A&provider_refresh_token=synthetic-provider-refresh-A");
    await pending;
    expect(f.qfRequests).toEqual([]);
    expect(f.persisted()?.user.id).toBe(session(2).user.id);
  } finally {
    browser.cancel();
    await pending;
    await f.close();
  }
});

it("native expired link callback cannot persist a refreshed different user", async () => {
  const f = await setup();
  f.setRefreshResponse(session(2));
  const browser = holdNativeBrowser();
  const pending = beginNativeOAuth("google", "link").catch(() => undefined);
  try {
    await browser.started;
    const before = f.persisted();
    f.values.set(f.key + "-user", "synthetic prior user");
    f.values.set(f.key + "-code-verifier", "synthetic prior verifier");
    const keys = [...f.values];
    browser.release(session(1, 4, -60));
    await pending;
    expect(f.persisted()).toEqual(before);
    expect([...f.values]).toEqual(keys);
    expect(useAuthStore.getState().session).toEqual(before);
  } finally {
    browser.cancel();
    await pending;
    await f.close();
  }
});

it("native link URL preparation cannot refresh retired A over external B", async () => {
  const f = await setup("refresh");
  let pending: Promise<unknown> | undefined;
  try {
    const near = session(1, 0, 60);
    expect(
      (await f.runtime.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token })).error,
    ).toBeNull();
    pending = beginNativeOAuth("google", "link");
    await f.started.promise;
    const b = session(2);
    await f.external(b);
    f.release.resolve();
    await pending;
    expect(f.persisted()?.access_token).toBe(b.access_token);
    expect(useAuthStore.getState().session?.access_token).toBe(b.access_token);
    expect(mockBrowser).not.toHaveBeenCalled();
  } finally {
    f.release.resolve();
    await pending;
    await f.close();
  }
});

it.each(["sign-in", "link"] as const)("accepts current native %s and retains its accepted owner", async (mode) => {
  const f = await setup();
  const browser = holdNativeBrowser();
  const chosen = mode === "sign-in" ? session(2) : session(1, 4);
  f.setCallbackUser(chosen.user);
  const flow = startAppOAuth("google", mode, useAuthStore.getState);
  try {
    expect(flow.isCurrent()).toBe(true);
    await browser.started;
    browser.release(chosen);
    const result = await flow.result;
    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("Current OAuth was superseded");
    expect(result.value.session?.access_token).toBe(chosen.access_token);
    expect(result.owner.isCurrent()).toBe(true);
    expect(flow.isCurrent()).toBe(true);
    expect(f.persisted()?.access_token).toBe(chosen.access_token);
    expect(useAuthStore.getState().session?.access_token).toBe(chosen.access_token);
    expect(f.qfRequests).toEqual([]);
  } finally {
    browser.cancel();
    await flow.result;
    await f.close();
  }
});

it.each(["cancel", "tokenless"] as const)(
  "native sign-in %s cannot adopt a global session or connect QF",
  async (kind) => {
    const f = await setup();
    const browser = holdNativeBrowser();
    const flow = startAppOAuth(QF_OAUTH_PROVIDER, "sign-in", useAuthStore.getState);
    try {
      await browser.started;
      const before = [...f.values];
      if (kind === "cancel") browser.cancel();
      else browser.release(null, "provider_token=synthetic-provider");
      const result = await flow.result;
      expect(result).toMatchObject({
        status: "completed",
        value: { session: null, qfConnected: false, qfOwner: null },
      });
      expect([...f.values]).toEqual(before);
      expect(f.qfRequests).toEqual([]);
      expect(flow.isCurrent()).toBe(true);
    } finally {
      browser.cancel();
      await flow.result;
      await f.close();
    }
  },
);

it("tokenless native QF link reads its starting account and sends provider credentials with that bearer", async () => {
  const f = await setup();
  const browser = holdNativeBrowser();
  const flow = startAppOAuth(QF_OAUTH_PROVIDER, "link", useAuthStore.getState);
  try {
    await browser.started;
    browser.release(null, "provider_token=synthetic-provider&provider_refresh_token=synthetic-refresh");
    const result = await flow.result;
    expect(result).toMatchObject({ status: "completed", value: { qfConnected: true } });
    if (result.status !== "completed") throw new Error("Current link was superseded");
    expect(result.value.qfOwner?.isCurrent()).toBe(true);
    expect(result.value.session?.access_token).toBe(f.initial.access_token);
    expect(f.qfRequests).toEqual([
      {
        action: "connect",
        providerAccessToken: "synthetic-provider",
        providerRefreshToken: "synthetic-refresh",
        authorization: "Bearer " + f.initial.access_token,
      },
    ]);
  } finally {
    browser.cancel();
    await flow.result;
    await f.close();
  }
});

it("incomplete native credentials are a current error and preserve every prior key", async () => {
  const f = await setup();
  const browser = holdNativeBrowser();
  const flow = startAppOAuth("google", "sign-in", useAuthStore.getState);
  const result = flow.result.catch((error) => error);
  try {
    await browser.started;
    const before = [...f.values];
    browser.release(null, "access_token=synthetic-incomplete");
    expect(await result).toMatchObject({ code: "oauth_callback_invalid" });
    expect(flow.isCurrent()).toBe(true);
    expect([...f.values]).toEqual(before);
  } finally {
    browser.cancel();
    await result;
    await f.close();
  }
});

it("wrong-user refreshed link reports the original current error without cancelling its owner", async () => {
  const f = await setup();
  f.setRefreshResponse(session(2));
  const browser = holdNativeBrowser();
  const flow = startAppOAuth("google", "link", useAuthStore.getState);
  const result = flow.result.catch((error) => error);
  try {
    await browser.started;
    f.values.set(f.key + "-user", "prior user");
    f.values.set(f.key + "-code-verifier", "prior verifier");
    const before = [...f.values];
    browser.release(session(1, 4, -60));
    const error = await result;
    expect(error).toBe(mockLastRecoveryError);
    expect(error).toMatchObject({ code: "oauth_link_user_mismatch", status: 400 });
    expect(flow.isCurrent()).toBe(true);
    expect([...f.values]).toEqual(before);
  } finally {
    browser.cancel();
    await result;
    await f.close();
  }
});

it("expired same-user native link accepts a guarded refresh", async () => {
  const f = await setup();
  const browser = holdNativeBrowser();
  const flow = startAppOAuth("google", "link", useAuthStore.getState);
  try {
    await browser.started;
    browser.release(session(1, 4, -60));
    expect(await flow.result).toMatchObject({
      status: "completed",
      value: { session: { access_token: f.refreshed.access_token } },
    });
    expect(f.persisted()?.access_token).toBe(f.refreshed.access_token);
    expect(flow.isCurrent()).toBe(true);
  } finally {
    browser.cancel();
    await flow.result;
    await f.close();
  }
});

it.each(["external", "ABA"] as const)("reserves native OAuth origin before queueing across %s", async (retirement) => {
  const f = await setup();
  const gate = deferred();
  const blocking = authCommands.bootstrap(() => gate.promise);
  const flow = startAppOAuth("google", "sign-in", useAuthStore.getState);
  try {
    await f.external(session(2));
    if (retirement === "ABA") await f.external(f.initial);
    gate.resolve();
    await blocking;
    expect(await flow.result).toEqual({ status: "superseded" });
    expect(mockBrowser).not.toHaveBeenCalled();
    expect(f.requests.some((request) => request.includes("/authorize"))).toBe(false);
  } finally {
    gate.resolve();
    await blocking;
    await flow.result;
    await f.close();
  }
});

it.each([false, true])(
  "QF failure after own session adoption retains current error unless retired=%s",
  async (retire) => {
    const f = await setup();
    const browser = holdNativeBrowser();
    const entered = deferred(),
      release = deferred();
    const failure = new Error("synthetic provider failure");
    const spy = jest.spyOn(qfUser, "connectQfProviderTokens").mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      throw failure;
    });
    const chosen = session(2);
    f.setCallbackUser(chosen.user);
    const flow = startAppOAuth(QF_OAUTH_PROVIDER, "sign-in", useAuthStore.getState);
    const result = flow.result.catch((error) => error);
    try {
      await browser.started;
      browser.release(chosen, "provider_token=synthetic-provider");
      await entered.promise;
      expect(flow.isCurrent()).toBe(true);
      if (retire) await f.external(session(3));
      release.resolve();
      if (retire) expect(await result).toEqual({ status: "superseded" });
      else expect(await result).toBe(failure);
      expect(flow.isCurrent()).toBe(!retire);
      expect(f.persisted()?.user.id).toBe(session(retire ? 3 : 2).user.id);
    } finally {
      browser.cancel();
      release.resolve();
      await result;
      spy.mockRestore();
      await f.close();
    }
  },
);

it("QF caller retains a same-session credential renewal received while the provider responds", async () => {
  const f = await setup();
  const browser = holdNativeBrowser();
  const entered = deferred(),
    release = deferred();
  const spy = jest.spyOn(qfUser, "connectQfProviderTokens").mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    return { ok: true, status: "connected" };
  });
  const chosen = session(2);
  f.setCallbackUser(chosen.user);
  const pending = useAuthStore.getState().signInWithQuranFoundation();
  try {
    await browser.started;
    browser.release(chosen, "provider_token=synthetic-provider");
    await entered.promise;
    const fresh = sameSessionRefresh(chosen);
    await f.external(fresh);
    release.resolve();
    await pending;
    expect(useAuthStore.getState().session?.access_token).toBe(fresh.access_token);
    expect(f.persisted()?.access_token).toBe(fresh.access_token);
    expect(useAuthStore.getState().isLoading).toBe(false);
  } finally {
    browser.cancel();
    release.resolve();
    await pending;
    spy.mockRestore();
    await f.close();
  }
});

it("retired store OAuth cleans its own busy state but cannot clear a newer password-reset action", async () => {
  const f = await setup();
  const browser = holdNativeBrowser();
  const entered = deferred(),
    release = deferred();
  const spy = jest.spyOn(f.runtime.client.auth, "resetPasswordForEmail").mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    return { data: {}, error: null };
  });
  const oauth = useAuthStore.getState().signInWithQuranFoundation();
  let reset: Promise<void> | undefined;
  try {
    await browser.started;
    reset = useAuthStore.getState().sendPasswordReset("synthetic@example.invalid");
    await entered.promise;
    await f.external(session(2));
    browser.cancel();
    await oauth;
    expect(useAuthStore.getState().isLoading).toBe(true);
    expect(useAuthStore.getState().error).toBeNull();
    release.resolve();
    await reset;
    expect(useAuthStore.getState().isLoading).toBe(false);
  } finally {
    browser.cancel();
    release.resolve();
    await Promise.allSettled([oauth, reset]);
    spy.mockRestore();
    await f.close();
  }
});

it("retired store OAuth releases busy after external account replacement", async () => {
  const f = await setup();
  const browser = holdNativeBrowser();
  const pending = useAuthStore.getState().signInWithQuranFoundation();
  try {
    await browser.started;
    await f.external(session(2));
    browser.cancel();
    await pending;
    expect(useAuthStore.getState()).toMatchObject({ isLoading: false, error: null, user: { id: session(2).user.id } });
  } finally {
    browser.cancel();
    await pending;
    await f.close();
  }
});

it.each(["prepare", "tokenless-read"] as const)(
  "current native link %s preserves its SDK refresh error after attributed logout",
  async (phase) => {
    const f = await setup("refresh-error");
    const browser = holdNativeBrowser();
    const near = session(1, 0, 60);
    if (phase === "prepare") f.values.set(f.key, JSON.stringify(near));
    const flow = startAppOAuth("google", "link", useAuthStore.getState);
    const pending = flow.result.catch((error) => error);
    try {
      if (phase === "tokenless-read") {
        await browser.started;
        f.values.set(f.key, JSON.stringify(near));
        browser.release(null);
      }
      const error = await pending;
      expect(error).toMatchObject({ code: "synthetic_recovery_rejected", status: 400 });
      expect(flow.isCurrent()).toBe(true);
      expect(useAuthStore.getState().session).toBeNull();
      if (phase === "prepare") expect(mockBrowser).not.toHaveBeenCalled();
    } finally {
      browser.cancel();
      await pending;
      await f.close();
    }
  },
);

it.each(["sign-in", "link"] as const)(
  "current store QF %s publishes provider failure after own session adoption",
  async (mode) => {
    const f = await setup(),
      browser = holdNativeBrowser(),
      entered = deferred(),
      release = deferred();
    const error = new Error("current provider failure");
    const spy = jest.spyOn(qfUser, "connectQfProviderTokens").mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      throw error;
    });
    const chosen = mode === "sign-in" ? session(2) : session(1, 4);
    f.setCallbackUser(chosen.user);
    const work =
      mode === "sign-in"
        ? useAuthStore.getState().signInWithQuranFoundation()
        : useAuthStore.getState().linkQuranFoundation();
    const pending = work.catch((failure) => failure);
    try {
      await browser.started;
      browser.release(chosen, "provider_token=synthetic-provider");
      await entered.promise;
      release.resolve();
      expect(await pending).toBe(error);
      expect(useAuthStore.getState()).toMatchObject({
        isLoading: false,
        error: error.message,
        user: { id: chosen.user.id },
      });
      expect(useAuthStore.getState().session?.access_token).toBe(chosen.access_token);
    } finally {
      browser.cancel();
      release.resolve();
      await pending;
      spy.mockRestore();
      await f.close();
    }
  },
);

it.each(["handle", "store"] as const)(
  "QF credential-read failure delivers its own logout and SDK error through %s",
  async (caller) => {
    const f = await setup("refresh-error"),
      browser = holdNativeBrowser(),
      chosen = session(2, 0, 60);
    f.setCallbackUser(chosen.user);
    const flow = caller === "handle" ? startAppOAuth(QF_OAUTH_PROVIDER, "sign-in", useAuthStore.getState) : null;
    const pending = (flow ? flow.result : useAuthStore.getState().signInWithQuranFoundation()).catch((error) => error);
    try {
      await browser.started;
      browser.release(chosen, "provider_token=synthetic-provider");
      const error = await pending;
      expect(error).toBe(mockLastReadError);
      expect(error).toMatchObject({ code: "synthetic_recovery_rejected", status: 400 });
      expect(f.persisted()).toBeNull();
      expect(useAuthStore.getState()).toMatchObject({ session: null, user: null, profile: null, isLoading: false });
      expect(f.events.some((row) => row.event === "SIGNED_OUT")).toBe(true);
      expect(f.qfRequests).toEqual([]);
      if (flow) expect(flow.isCurrent()).toBe(true);
      else expect(useAuthStore.getState().error).toBe(error.message);
    } finally {
      browser.cancel();
      await pending;
      await f.close();
    }
  },
);

it("QF credential-read renewal retains the accepted account and uses its fresh bearer", async () => {
  const f = await setup(),
    browser = holdNativeBrowser(),
    chosen = session(2, 0, 60),
    fresh = sameSessionRefresh(chosen);
  f.setCallbackUser(chosen.user);
  f.setRefreshResponse(fresh);
  const pending = useAuthStore.getState().signInWithQuranFoundation();
  try {
    await browser.started;
    browser.release(chosen, "provider_token=synthetic-provider");
    await pending;
    expect(f.qfRequests).toEqual([
      { action: "connect", providerAccessToken: "synthetic-provider", authorization: "Bearer " + fresh.access_token },
    ]);
    expect(f.persisted()?.access_token).toBe(fresh.access_token);
    expect(useAuthStore.getState()).toMatchObject({
      session: { access_token: fresh.access_token },
      user: { id: chosen.user.id },
      error: null,
      isLoading: false,
    });
  } finally {
    browser.cancel();
    await pending;
    await f.close();
  }
});

it.each(["external", "ABA"] as const)(
  "QF credential-read error cannot log out or report under retired %s",
  async (kind) => {
    const f = await setup("held-refresh-error"),
      browser = holdNativeBrowser(),
      chosen = session(1, 4, 60);
    const flow = startAppOAuth(QF_OAUTH_PROVIDER, "sign-in", useAuthStore.getState);
    try {
      await browser.started;
      browser.release(chosen, "provider_token=synthetic-provider");
      await f.started.promise;
      await f.external(session(2));
      if (kind === "ABA") await f.external(chosen);
      const before = f.persisted(),
        events = f.events.length;
      f.release.resolve();
      expect(await flow.result).toEqual({ status: "superseded" });
      expect(f.persisted()).toEqual(before);
      expect(useAuthStore.getState().session).toEqual(before);
      expect(f.events.slice(events).some((row) => row.event === "SIGNED_OUT")).toBe(false);
      expect(f.qfRequests).toEqual([]);
    } finally {
      browser.cancel();
      f.release.resolve();
      await flow.result;
      await f.close();
    }
  },
);

it.each(["link", "recovery"] as const)(
  "OAuth-produced QF reader yields to a newer %s command without overlapping storage guards",
  async (command) => {
    const f = await setup("refresh"),
      browser = holdNativeBrowser();
    const flow = startAppOAuth(QF_OAUTH_PROVIDER, "link", useAuthStore.getState);
    let read: Promise<unknown> | undefined;
    let newer: Promise<unknown> | undefined;
    let secondBrowser: ReturnType<typeof holdNativeBrowser> | undefined;
    try {
      await browser.started;
      browser.release(null, "provider_token=synthetic-provider");
      const accepted = await flow.result;
      expect(accepted.status).toBe("completed");
      if (accepted.status !== "completed" || !accepted.value.qfOwner) throw new Error("Missing accepted QF owner");
      const qfOwner = accepted.value.qfOwner;
      const near = session(1, 0, 60);
      expect((await f.runtime.auth.setSession(near)).error).toBeNull();
      read = qfOwner.getAccessToken().catch((error) => error);
      await f.started.promise;
      let settled = false;
      const target = session(1, 4);
      secondBrowser = holdNativeBrowser();
      newer = (
        command === "link"
          ? startAppOAuth("google", "link", useAuthStore.getState).result
          : preparePasswordRecovery({ access_token: target.access_token, refresh_token: target.refresh_token })
      )
        .catch((error) => error)
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);
      f.release.resolve();
      secondBrowser.cancel();
      expect(await newer).toMatchObject({ status: "completed" });
      expect(await read).toBeInstanceOf(Error);
      expect(qfOwner.isCurrent()).toBe(false);
      expect(f.events.some((row) => row.event === "SIGNED_OUT")).toBe(false);
      const expected = command === "link" ? f.refreshed : target;
      expect(f.persisted()?.access_token).toBe(expected.access_token);
      expect(useAuthStore.getState().session?.access_token).toBe(expected.access_token);
      if (command === "link") expect(f.requests.some((row) => row.includes("/user/identities/authorize"))).toBe(true);
    } finally {
      browser.cancel();
      secondBrowser?.cancel();
      f.release.resolve();
      await Promise.allSettled([flow.result, read, newer]);
      await f.close();
    }
  },
);

it.each(["current", "cancel", "external", "ABA"] as const)(
  "private SDK queue revalidates a %s caller and drains after rejection",
  async (retirement) => {
    const f = await setup("refresh"),
      browser = holdNativeBrowser();
    const flow = startAppOAuth(QF_OAUTH_PROVIDER, "link", useAuthStore.getState);
    let read: Promise<unknown> | undefined;
    let update: Promise<unknown> | undefined;
    try {
      await browser.started;
      browser.release(null, "provider_token=synthetic-provider");
      const accepted = await flow.result;
      if (accepted.status !== "completed" || !accepted.value.qfOwner) throw new Error("Missing accepted QF owner");
      const near = session(1, 0, 60);
      expect((await f.runtime.auth.setSession(near)).error).toBeNull();
      read = accepted.value.qfOwner.getAccessToken().catch((error) => error);
      await f.started.promise;
      const queuedOwner = authCommands.captureOwner();
      let settled = false;
      update = f.runtime
        .updatePassword(queuedOwner, near, "synthetic-password")
        .catch((error) => error)
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);
      if (retirement === "cancel") queuedOwner.cancel();
      else if (retirement !== "current") {
        await f.external(session(2));
        if (retirement === "ABA") await f.external(near);
      }
      const before = f.persisted();
      f.release.resolve();
      const result = await update;
      if (retirement === "current") {
        expect(result).toMatchObject({ error: null });
        expect(await read).toBe(f.refreshed.access_token);
        expect(f.requests.filter((row) => row.startsWith("PUT "))).toHaveLength(1);
      } else {
        expect(result).toMatchObject({ code: "operation_superseded", status: 409 });
        expect(f.requests.filter((row) => row.startsWith("PUT "))).toHaveLength(0);
        if (retirement === "cancel") expect(await read).toBe(f.refreshed.access_token);
        else {
          expect(await read).toBeInstanceOf(Error);
          expect(f.persisted()).toEqual(before);
        }
      }
      const current = useAuthStore.getState().session;
      const next = await f.runtime.readSession(authCommands.captureOwner(), current, () => true);
      expect(next.error).toBeNull();
      expect(next.data.session?.access_token).toBe(f.persisted()?.access_token);
      expect(f.events.some((row) => row.event === "SIGNED_OUT")).toBe(false);
    } finally {
      browser.cancel();
      f.release.resolve();
      await Promise.allSettled([flow.result, read, update]);
      await f.close();
    }
  },
);
