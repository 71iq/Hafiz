import { createRootAuthRuntime } from "@/lib/auth/root-runtime";
import { useAuthStore } from "@/lib/auth/store";
import type { AuthOwner } from "@/lib/auth/coordinator";
import type {
  Session,
  User,
  SignInWithPasswordCredentials,
  SignUpWithPasswordCredentials,
} from "@supabase/supabase-js";
import type { Profile } from "@/lib/auth/types";
let mockRuntime: ReturnType<typeof createRootAuthRuntime>;
let mockAuth: typeof mockRuntime.auth;
let mockAfterEmail: (() => Promise<void>) | undefined;
const mockSdkErrors: unknown[] = [];
const mockProfileWaits = new Map<string, Promise<void>>();
const profileReleases = new Set<() => void>();
const mockProfileReads: string[] = [];
const profile = (id: string): Profile => ({
  id,
  username: "synthetic",
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
  signInOwnedPassword: async (
    owner: AuthOwner,
    session: Session | null,
    credentials: SignInWithPasswordCredentials,
  ) => {
    const response = await mockRuntime.signInWithPassword(owner, session, credentials);
    if (response.error) mockSdkErrors.push(response.error);
    await mockAfterEmail?.();
    return response;
  },
  signUpOwnedPassword: async (
    owner: AuthOwner,
    session: Session | null,
    credentials: SignUpWithPasswordCredentials,
  ) => {
    const response = await mockRuntime.signUp(owner, session, credentials);
    if (response.error) mockSdkErrors.push(response.error);
    await mockAfterEmail?.();
    return response;
  },
  supabase: {
    get auth() {
      return mockAuth;
    },
    from: () => {
      let id = "";
      const query = {
        select: () => query,
        eq: (_key: string, value: string) => {
          id = value;
          return query;
        },
        maybeSingle: async () => {
          mockProfileReads.push(id);
          await mockProfileWaits.get(id);
          return { data: profile(id), error: null };
        },
      };
      return query;
    },
  },
}));
jest.mock("@/lib/auth/oauth", () => ({ startAppOAuth: jest.fn() }));
jest.mock("@/lib/auth/config", () => ({ isEmailAuthFlowsEnabled: () => true }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfSyncEnabled: () => false }));
jest.mock("@/lib/quran-foundation/user", () => ({ connectQfFromSession: jest.fn() }));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const session = (index: number, userIndex = index): Session => {
  const user: User = {
    id: `00000000-0000-4000-8000-${String(userIndex).padStart(12, "0")}`,
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01",
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = { sub: user.id, session_id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`, exp };
  return {
    user,
    access_token: ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "c2ln"].join("."),
    refresh_token: `synthetic-${index}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
  };
};
type Mode = "signIn" | "signUp";
const actions = new Set<Promise<unknown>>();
function begin(mode: Mode, email: string) {
  const state = useAuthStore.getState();
  const handle =
    mode === "signIn"
      ? state.signIn(email, "  synthetic-password  ")
      : state.signUp(email, "  synthetic-password  ", " synthetic_user ", " Synthetic Name ");
  actions.add(handle.result);
  void handle.result.catch(() => undefined);
  return handle;
}
let sequence = 0;
const fixtures = new Set<Awaited<ReturnType<typeof setup>>>();
async function setup(
  options: {
    noSession?: boolean;
    heldError?: boolean;
    registered?: boolean;
    invalidReply?: boolean;
    holdCommit?: boolean;
    noInitialize?: boolean;
    isWeb?: boolean;
  } = {},
) {
  useAuthStore.setState({
    session: null,
    user: null,
    profile: null,
    isInitialized: false,
    isLoading: false,
    error: null,
  });
  const initial = session(1),
    key = `rf154-email-${++sequence}`;
  const values = new Map([[key, JSON.stringify(initial)]]);
  mockAfterEmail = undefined;
  mockSdkErrors.length = 0;
  const entered = deferred<void>(),
    release = deferred<void>();
  const committed = deferred<void>(),
    releaseCommit = deferred<void>();
  let holdCommit = options.holdCommit;
  const requests: { path: string; body: Record<string, unknown> }[] = [],
    notices: (string | null)[] = [];
  const runtime = createRootAuthRuntime({
    url: "https://synthetic.example.invalid",
    anonKey: "public-synthetic-key",
    storageKey: key,
    isWeb: options.isWeb ?? false,
    nativeStorage: {
      getItem: (name) => values.get(name) ?? null,
      setItem: async (name, value) => {
        values.set(name, value);
        if (name === key && holdCommit && JSON.parse(value).user.id === session(2).user.id) {
          holdCommit = false;
          committed.resolve();
          await releaseCommit.promise;
        }
      },
      removeItem: (name) => {
        values.delete(name);
      },
    },
    fetch: async (input, init) => {
      const url = new URL(String(input)),
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ path: url.pathname + url.search, body });
      if (url.pathname.endsWith("/logout"))
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.search.includes("grant_type=refresh_token")) {
        const renewed = {
          ...session(2),
          refresh_token: "synthetic-renewed",
          user: { ...session(2).user, user_metadata: { renewed: true } },
        };
        return new Response(JSON.stringify(renewed), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (!url.pathname.endsWith("/signup") && !url.search.includes("grant_type=password"))
        throw new Error("Unexpected synthetic auth request " + url.pathname);
      const held = body.email === "held@example.invalid";
      if (held) {
        entered.resolve();
        await release.promise;
      }
      const response =
        options.heldError && held
          ? { msg: "synthetic original error", error_code: "invalid_credentials" }
          : options.noSession && url.pathname.endsWith("/signup")
            ? { user: { ...session(2).user, identities: options.registered ? [] : [{ id: "synthetic" }] } }
            : options.invalidReply
              ? { ...session(2), access_token: "invalid-synthetic-jwt" }
              : body.email === "same@example.invalid"
                ? session(3, 1)
                : body.email === "original@example.invalid"
                  ? initial
                  : session(body.email === "latest@example.invalid" ? 3 : 2);
      return new Response(JSON.stringify(response), {
        status: options.heldError && held ? 400 : 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  mockRuntime = runtime;
  const subscriptions = new Set<ReturnType<typeof runtime.auth.onAuthStateChange>["data"]["subscription"]>();
  mockAuth = new Proxy(runtime.auth, {
    get(target, property, receiver) {
      if (property !== "onAuthStateChange") return Reflect.get(target, property, receiver);
      return (callback: Parameters<typeof runtime.auth.onAuthStateChange>[0]) => {
        const result = target.onAuthStateChange(callback);
        subscriptions.add(result.data.subscription);
        return result;
      };
    },
  });
  const observer = runtime.auth.onAuthStateChange((event, value) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") notices.push(value?.user.id ?? null);
  }).data.subscription;
  if (!options.noInitialize) await useAuthStore.getState().initialize();
  else await runtime.auth.initialize();
  mockProfileReads.length = 0;
  notices.length = 0;
  const fixture = {
    runtime,
    initial,
    key,
    values,
    requests,
    notices,
    entered,
    release,
    committed,
    releaseCommit,
    close: async () => {
      release.resolve();
      releaseCommit.resolve();
      for (const subscription of subscriptions) subscription.unsubscribe();
      observer.unsubscribe();
      await runtime.client.auth.stopAutoRefresh();
    },
  };
  fixtures.add(fixture);
  return fixture;
}
afterEach(async () => {
  for (const f of fixtures) {
    f.release.resolve();
    f.releaseCommit.resolve();
  }
  for (const release of profileReleases) release();
  profileReleases.clear();
  mockProfileWaits.clear();
  mockAfterEmail = undefined;
  await Promise.allSettled(actions);
  actions.clear();
  for (const f of fixtures) await f.close();
  fixtures.clear();
  useAuthStore.setState({
    session: null,
    user: null,
    profile: null,
    isInitialized: false,
    isLoading: false,
    error: null,
  });
});
it.each<Mode>(["signIn", "signUp"])("%s cannot publish a held success after a newer queued intent", async (mode) => {
  const f = await setup();
  const old = begin(mode, "held@example.invalid");
  await f.entered.promise;
  const latest = begin("signIn", "latest@example.invalid");
  f.release.resolve();
  await latest.result;
  expect(f.notices).not.toContain(session(2).user.id);
  expect(mockProfileReads).not.toContain(session(2).user.id);
  await expect(old.result).resolves.toMatchObject({ status: "superseded" });
  expect(useAuthStore.getState().user?.id).toBe(session(3).user.id);
  expect(JSON.parse(f.values.get(f.key)!).user.id).toBe(session(3).user.id);
});
it.each(["signIn", "signUp"] as const)(
  "%s cannot overwrite an external replacement after its request starts",
  async (mode) => {
    const f = await setup();
    const old = begin(mode, "held@example.invalid");
    await f.entered.promise;
    await f.runtime.auth.signInWithPassword({ email: "latest@example.invalid", password: "synthetic" });
    f.release.resolve();
    await old.result;
    expect(useAuthStore.getState().user?.id).toBe(session(3).user.id);
    expect(JSON.parse(f.values.get(f.key)!).user.id).toBe(session(3).user.id);
    await expect(old.result).resolves.toMatchObject({ status: "superseded" });
  },
);
it("obsolete email errors cannot replace the newer intent's loading or error", async () => {
  const f = await setup({ heldError: true });
  const old = begin("signIn", "held@example.invalid");
  await f.entered.promise;
  const latest = begin("signIn", "latest@example.invalid");
  f.release.resolve();
  await expect(old.result).resolves.toMatchObject({ status: "superseded" });
  await latest.result;
  expect(useAuthStore.getState()).toMatchObject({ user: { id: session(3).user.id }, error: null, isLoading: false });
});
it("retired no-session signup cannot expose a confirmation for a replaced owner", async () => {
  const f = await setup({ noSession: true });
  const old = begin("signUp", "held@example.invalid");
  await f.entered.promise;
  await f.runtime.auth.signInWithPassword({ email: "latest@example.invalid", password: "synthetic" });
  f.release.resolve();
  await expect(old.result).resolves.toMatchObject({ status: "superseded" });
  expect(useAuthStore.getState().user?.id).toBe(session(3).user.id);
});

it.each<Mode>(["signIn", "signUp"])("%s preserves current success and credential bytes", async (mode) => {
  const f = await setup();
  const handle = begin(mode, " QA@Example.Invalid ");
  const result = await handle.result;
  expect(result.status).toBe("completed");
  expect(handle.isCurrent()).toBe(true);
  expect(result.status === "completed" && result.owner.isCurrent()).toBe(true);
  expect(f.requests[0].body).toMatchObject({ email: "qa@example.invalid", password: "  synthetic-password  " });
  if (mode === "signUp") {
    expect(result.status === "completed" && result.value).toEqual({ status: "signedIn" });
    expect(f.requests[0].body.data).toEqual({ username: "synthetic_user", display_name: "Synthetic Name" });
  }
  expect(useAuthStore.getState()).toMatchObject({
    user: { id: session(2).user.id },
    profile: { id: session(2).user.id },
    isLoading: false,
    error: null,
  });
  expect(JSON.parse(f.values.get(f.key)!).refresh_token).toBe(session(2).refresh_token);
  expect(f.notices).toEqual([session(2).user.id]);
});
it.each([false, true])("no-session signup preserves prior state, registered=%s", async (registered) => {
  const f = await setup({ noSession: true, registered });
  const before = useAuthStore.getState(),
    raw = f.values.get(f.key);
  const result = await begin("signUp", "qa@example.invalid").result;
  expect(result).toMatchObject({
    status: "completed",
    value: { status: registered ? "alreadyRegistered" : "needsEmailConfirmation" },
  });
  expect(useAuthStore.getState().session).toBe(before.session);
  expect(useAuthStore.getState().profile).toBe(before.profile);
  expect(f.values.get(f.key)).toBe(raw);
  expect(f.notices).toEqual([]);
  expect(mockProfileReads).toEqual([]);
});
it.each<Mode>(["signIn", "signUp"])("%s preserves the exact current SDK error and admits retry", async (mode) => {
  const f = await setup({ heldError: true });
  const before = f.values.get(f.key),
    old = begin(mode, "held@example.invalid");
  await f.entered.promise;
  f.release.resolve();
  const failure = await old.result.catch((error) => error);
  expect(failure).toBe(mockSdkErrors[0]);
  expect(mockSdkErrors[0]).toMatchObject({ message: "synthetic original error" });
  expect(useAuthStore.getState()).toMatchObject({ error: "synthetic original error", isLoading: false });
  expect(f.values.get(f.key)).toBe(before);
  expect(f.notices).toEqual([]);
  expect((await begin(mode, "qa@example.invalid").result).status).toBe("completed");
});
it.each<Mode>(["signIn", "signUp"])("%s skips obsolete queued dispatch and settles busy state", async (mode) => {
  const f = await setup();
  const old = begin(mode, "held@example.invalid"),
    latest = begin(mode, "latest@example.invalid");
  await expect(old.result).resolves.toMatchObject({ status: "superseded" });
  await expect(latest.result).resolves.toMatchObject({ status: "completed" });
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0].body.email).toBe("latest@example.invalid");
  expect(useAuthStore.getState().isLoading).toBe(false);
});
it.each(["signIn", "signUp"] as const)(
  "%s replaces an earlier unnotified physical commit with the newer intent",
  async (mode) => {
    const f = await setup({ holdCommit: true });
    const old = begin(mode, "qa@example.invalid");
    await f.committed.promise;
    expect(JSON.parse(f.values.get(f.key)!).user.id).toBe(session(2).user.id);
    expect(useAuthStore.getState().user?.id).toBe(f.initial.user.id);
    const latest = begin("signIn", "latest@example.invalid");
    f.releaseCommit.resolve();
    await expect(old.result).resolves.toMatchObject({ status: "superseded" });
    await expect(latest.result).resolves.toMatchObject({ status: "completed" });
    expect(f.notices).toEqual([session(3).user.id]);
    expect(useAuthStore.getState()).toMatchObject({ user: { id: session(3).user.id }, isLoading: false });
    expect(JSON.parse(f.values.get(f.key)!).user.id).toBe(session(3).user.id);
  },
);
it.each(["same", "ABA", "logout"] as const)(
  "held email credentials cannot survive external %s retirement",
  async (variant) => {
    const f = await setup();
    const old = begin("signIn", "held@example.invalid");
    await f.entered.promise;
    if (variant === "logout") {
      // Another context's logout notice does not share this process's SDK lock.
      f.values.delete(f.key);
      useAuthStore.setState({ session: null, user: null, profile: null });
    } else {
      await f.runtime.auth.signInWithPassword({
        email: variant === "same" ? "same@example.invalid" : "latest@example.invalid",
        password: "synthetic",
      });
      if (variant === "ABA")
        await f.runtime.auth.signInWithPassword({ email: "original@example.invalid", password: "synthetic" });
    }
    const before = f.values.get(f.key),
      current = useAuthStore.getState().session;
    f.release.resolve();
    await expect(old.result).resolves.toMatchObject({ status: "superseded" });
    expect(f.values.get(f.key)).toBe(before);
    expect(useAuthStore.getState().session).toBe(current);
    expect(f.notices).not.toContain(session(2).user.id);
  },
);
it.each<Mode>(["signIn", "signUp"])("%s does not roll back a same-session token and metadata renewal", async (mode) => {
  const f = await setup();
  mockAfterEmail = async () => {
    mockAfterEmail = undefined;
    expect((await f.runtime.auth.refreshSession()).error).toBeNull();
  };
  await expect(begin(mode, "qa@example.invalid").result).resolves.toMatchObject({ status: "completed" });
  expect(useAuthStore.getState().session).toMatchObject({
    refresh_token: "synthetic-renewed",
    user: { user_metadata: { renewed: true } },
  });
  expect(JSON.parse(f.values.get(f.key)!)).toMatchObject({
    refresh_token: "synthetic-renewed",
    user: { user_metadata: { renewed: true } },
  });
});
it.each([false, true])("opaque prior storage replacement is exact, changed=%s", async (changed) => {
  const f = await setup();
  f.values.set(f.key, "opaque-prior-session");
  const old = begin("signIn", "held@example.invalid");
  await f.entered.promise;
  if (changed) f.values.set(f.key, "opaque-new-session");
  f.release.resolve();
  const result = await old.result;
  if (changed) {
    expect(result.status).toBe("superseded");
    expect(f.values.get(f.key)).toBe("opaque-new-session");
    expect(useAuthStore.getState().user?.id).toBe(f.initial.user.id);
    expect(f.notices).toEqual([]);
  } else {
    expect(result.status).toBe("completed");
    expect(JSON.parse(f.values.get(f.key)!).user.id).toBe(session(2).user.id);
  }
});
it("unnotified persisted replacement after dispatch prevents overwriting its bytes", async () => {
  const f = await setup(),
    old = begin("signIn", "held@example.invalid");
  await f.entered.promise;
  const newer = JSON.stringify(session(3));
  f.values.set(f.key, newer);
  f.release.resolve();
  await expect(old.result).resolves.toMatchObject({ status: "superseded" });
  expect(f.values.get(f.key)).toBe(newer);
  expect(f.notices).toEqual([]);
});
it.each<Mode>(["signIn", "signUp"])(
  "%s rejects an invalid new session without deleting prior credentials",
  async (mode) => {
    const f = await setup({ invalidReply: true }),
      before = f.values.get(f.key),
      old = begin(mode, "qa@example.invalid");
    await expect(old.result).rejects.toMatchObject({ code: "auth_session_invalid" });
    expect(useAuthStore.getState()).toMatchObject({
      user: { id: f.initial.user.id },
      error: "Auth response has an invalid session identity",
      isLoading: false,
    });
    expect(f.values.get(f.key)).toBe(before);
    expect(f.notices).toEqual([]);
  },
);
it("email publication works before the root store initializes its listener", async () => {
  const f = await setup({ noInitialize: true });
  await expect(begin("signIn", "qa@example.invalid").result).resolves.toMatchObject({ status: "completed" });
  expect(useAuthStore.getState()).toMatchObject({
    user: { id: session(2).user.id },
    profile: { id: session(2).user.id },
  });
  expect(JSON.parse(f.values.get(f.key)!).user.id).toBe(session(2).user.id);
});
it.each<Mode>(["signIn", "signUp"])("%s completion retires while its accepted profile is pending", async (mode) => {
  const f = await setup(),
    profileGate = deferred<void>();
  mockProfileWaits.set(session(2).user.id, profileGate.promise);
  const old = begin(mode, "qa@example.invalid");
  profileReleases.add(profileGate.resolve);
  for (let i = 0; i < 200 && !mockProfileReads.includes(session(2).user.id); i++) await Promise.resolve();
  expect(mockProfileReads).toContain(session(2).user.id);
  await f.runtime.auth.signInWithPassword({ email: "latest@example.invalid", password: "synthetic" });
  profileGate.resolve();
  await expect(old.result).resolves.toMatchObject({ status: "superseded" });
  expect(useAuthStore.getState()).toMatchObject({
    user: { id: session(3).user.id },
    profile: { id: session(3).user.id },
  });
});
it.each<Mode>(["signIn", "signUp"])(
  "%s preserves web memory fallback without granting account-bound commands",
  async (mode) => {
    const f = await setup({ isWeb: true });
    expect(f.runtime.supportsOwnedCommands).toBe(false);
    await expect(begin(mode, "qa@example.invalid").result).resolves.toMatchObject({ status: "completed" });
    expect(useAuthStore.getState().user?.id).toBe(session(2).user.id);
    expect((await f.runtime.auth.getSession()).data.session?.user.id).toBe(session(2).user.id);
    expect(f.values.get(f.key)).toBe(JSON.stringify(f.initial));
    expect(() =>
      f.runtime.updatePassword({ isCurrent: () => true, cancel: () => {} }, session(2), "synthetic"),
    ).toThrow("Auth storage ownership is unavailable");
  },
);

it.each<Mode>(["signIn", "signUp"])(
  "%s refuses a receipt replaced before notification without a store notice",
  async (mode) => {
    const f = await setup({ holdCommit: true }),
      old = begin(mode, "qa@example.invalid");
    await f.committed.promise;
    const newer = JSON.stringify(session(3));
    f.values.set(f.key, newer);
    f.releaseCommit.resolve();
    await expect(old.result).resolves.toMatchObject({ status: "superseded" });
    expect(f.values.get(f.key)).toBe(newer);
    expect(f.notices).toEqual([]);
    expect(useAuthStore.getState().user?.id).toBe(f.initial.user.id);
  },
);

it.each<Mode>(["signIn", "signUp"])(
  "%s preserves persistent web fallback and compares changes without a channel",
  async (mode) => {
    const names = ["window", "document", "navigator", "localStorage", "BroadcastChannel"] as const;
    const originals = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    const key = `rf154-web-fallback-${++sequence}`,
      values = new Map([[key, JSON.stringify(session(1))]]);
    const storage = {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => {
        values.set(name, value);
      },
      removeItem: (name: string) => {
        values.delete(name);
      },
    };
    const entered = deferred<void>(),
      release = deferred<void>();
    let runtime: ReturnType<typeof createRootAuthRuntime> | undefined;
    let current = true;
    const owner: AuthOwner = {
      isCurrent: () => current,
      cancel: () => {
        current = false;
      },
    };
    try {
      const globals: Record<(typeof names)[number], unknown> = {
        window: { location: { href: "https://synthetic.example.invalid/auth/login", pathname: "/auth/login" } },
        document: {},
        navigator: {},
        localStorage: storage,
        BroadcastChannel: undefined,
      };
      for (const name of names)
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: globals[name] });
      runtime = createRootAuthRuntime({
        url: "https://synthetic.example.invalid",
        anonKey: "public-synthetic-key",
        storageKey: key,
        isWeb: true,
        nativeStorage: storage,
        fetch: async (_input, init) => {
          const body = JSON.parse(String(init?.body ?? "{}"));
          if (body.email === "held@example.invalid") {
            entered.resolve();
            await release.promise;
          }
          return new Response(JSON.stringify(session(2)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      });
      await runtime.auth.initialize();
      expect(runtime.supportsOwnedCommands).toBe(false);
      const accepted = await (mode === "signIn"
        ? runtime.signInWithPassword(owner, session(1), { email: "qa@example.invalid", password: "synthetic" })
        : runtime.signUp(owner, session(1), { email: "qa@example.invalid", password: "synthetic" }));
      expect(accepted.error).toBeNull();
      expect(JSON.parse(values.get(key)!).user.id).toBe(session(2).user.id);
      const held = runtime.signInWithPassword(owner, session(2), {
        email: "held@example.invalid",
        password: "synthetic",
      });
      await entered.promise;
      const replacement = JSON.stringify(session(3));
      values.set(key, replacement);
      release.resolve();
      expect((await held).error).toMatchObject({ code: "operation_superseded" });
      expect(values.get(key)).toBe(replacement);
      expect(current).toBe(false);
    } finally {
      release.resolve();
      await runtime?.auth.stopAutoRefresh();
      for (let i = 0; i < names.length; i++) {
        const original = originals[i];
        if (original) Object.defineProperty(globalThis, names[i], original);
        else Reflect.deleteProperty(globalThis, names[i]);
      }
    }
  },
);
