import { createRootAuthRuntime } from "@/lib/auth/root-runtime";
import { authCommands } from "@/lib/auth/commands";
import { finishPasswordRecovery, preparePasswordRecovery, useAuthStore } from "@/lib/auth/store";
import type { Session, User } from "@supabase/supabase-js";
import type { AuthOwner } from "@/lib/auth/coordinator";
let mockRuntime: ReturnType<typeof createRootAuthRuntime>;
let mockLastPasswordError: unknown;
let mockLastRecoveryError: unknown;
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
  readOwnedSession: (owner: AuthOwner, session: Session | null, isActive: () => boolean) =>
    mockRuntime.readSession(owner, session, isActive),
  restoreOwnedSession: async (
    owner: AuthOwner,
    session: Session | null,
    tokens: { access_token: string; refresh_token: string },
    isActive: () => boolean,
  ) => {
    const result = await mockRuntime.restoreSession(owner, session, tokens, isActive);
    mockLastRecoveryError = result.error;
    return result;
  },
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
jest.mock("@/lib/auth/oauth", () => ({ startAppOAuth: jest.fn() }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfSyncEnabled: () => false, isQfLoginEnabled: () => false }));
jest.mock("@/lib/quran-foundation/user", () => ({ connectQfFromSession: jest.fn() }));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function session(index: number, revision = 0, seconds = 3600): Session {
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
    | "bounded-refresh-loop" = "normal",
  initializeStore = true,
) {
  const key = `rf125-store-runtime-${++sequence}`;
  const initial = session(1),
    refreshed = sameSessionRefresh(initial);
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
    setItem: (name: string, value: string) => {
      values.set(name, value);
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
      if (path.endsWith("/user") && method === "PUT") {
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
        body = { user: initial.user };
      } else if (path.endsWith("/logout")) {
        started.resolve();
        if (mode === "logout") await release.promise;
        body = {};
      } else if (url.includes("grant_type=refresh_token")) {
        started.resolve();
        if (mode === "refresh") await release.promise;
        if (mode === "refresh-error" || (mode === "bounded-refresh-loop" && ++refreshCount < 4)) {
          status = 400;
          body = { msg: "Synthetic recovery token rejected", error_code: "synthetic_recovery_rejected" };
        } else body = refreshed;
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
    holdNextSessionRead,
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
      for (const held of heldReads) held.release.resolve();
      for (const subscription of [...tracked.subscriptions]) subscription.unsubscribe();
      await runtime.auth.stopAutoRefresh();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(tracked.subscriptions.size).toBe(0);
    },
  };
}
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
