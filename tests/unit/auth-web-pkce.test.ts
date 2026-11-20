import { createRootAuthRuntime } from "@/lib/auth/root-runtime";
import type { AuthOwner } from "@/lib/auth/coordinator";
import type { Session, User } from "@supabase/supabase-js";

// Web sign-in uses PKCE: a link can no longer carry a session into the browser that opens it.
const ORIGIN = "https://synthetic.example.invalid";
const KEY = "synthetic-auth-token";
const names = ["window", "document", "navigator", "localStorage", "BroadcastChannel"] as const;
const originals = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));

const user = (n: number): User => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01",
  email: `user${n}@example.invalid`,
});
function session(n: number): Session {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    user: user(n),
    access_token: [
      { alg: "HS256" },
      { sub: user(n).id, session_id: `10000000-0000-4000-8000-00000000000${n}`, exp },
      "synthetic",
    ]
      .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
      .join("."),
    refresh_token: `synthetic-refresh-${n}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
  };
}

type Request = { method: string; path: string; search: string; body: Record<string, unknown> };
function browser(address: string) {
  const values = new Map<string, string>();
  const storage = {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      values.set(name, value);
    },
    removeItem: (name: string) => {
      values.delete(name);
    },
  };
  const location = { href: "", pathname: "", search: "", hash: "" };
  const navigate = (next: string) => {
    const url = new URL(next, ORIGIN);
    Object.assign(location, { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash });
  };
  navigate(address);
  const history = {
    state: { marker: "router-state" },
    replaceState: jest.fn((_state: unknown, _title: string, next: string) => navigate(next)),
  };
  const globals: Record<(typeof names)[number], unknown> = {
    window: { location, history },
    document: {},
    navigator: {},
    localStorage: storage,
    BroadcastChannel: undefined,
  };
  for (const name of names)
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: globals[name] });
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    requests.push({ method: init?.method ?? "GET", path: url.pathname, search: url.search, body });
    const reply = url.pathname.endsWith("/user")
      ? session(2).user
      : url.pathname.endsWith("/logout") || url.pathname.endsWith("/recover")
        ? {}
        : url.pathname.endsWith("/signup")
          ? user(3)
          : session(1);
    return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const runtime = createRootAuthRuntime({
    url: ORIGIN,
    anonKey: "public-synthetic-key",
    storageKey: KEY,
    isWeb: true,
    nativeStorage: storage,
    fetch,
  });
  return { runtime, values, location, history, requests };
}
const owner: AuthOwner = { isCurrent: () => true, cancel: () => {} };
let opened: ReturnType<typeof browser>["runtime"][] = [];
function open(address: string) {
  const value = browser(address);
  opened.push(value.runtime);
  return value;
}
afterEach(async () => {
  for (const runtime of opened) await runtime.auth.stopAutoRefresh();
  opened = [];
  for (let i = 0; i < names.length; i++) {
    const original = originals[i];
    if (original) Object.defineProperty(globalThis, names[i], original);
    else Reflect.deleteProperty(globalThis, names[i]);
  }
});
function fragment(value: Session, extra = "") {
  return `#access_token=${value.access_token}&refresh_token=${value.refresh_token}&expires_in=3600&token_type=bearer${extra}`;
}

it.each(["/", "/home", "/auth/login"])(
  "a link carrying another account's tokens at %s does not sign the visitor in",
  async (path) => {
    const f = open(path + "?keep=1" + fragment(session(2), "&type=signup"));
    await f.runtime.auth.initialize();
    expect((await f.runtime.auth.getSession()).data.session).toBeNull();
    expect(f.values.has(KEY)).toBe(false);
    expect(f.requests).toEqual([]);
    // The tokens leave the address unused; the path, query and router state stay.
    expect(f.location.hash).toBe("");
    expect(f.location.pathname + f.location.search).toBe(path + "?keep=1");
    expect(f.history.replaceState).toHaveBeenCalledWith({ marker: "router-state" }, "", path + "?keep=1");
  },
);

it("a link's tokens leave an existing session in place", async () => {
  const f = open("/" + fragment(session(2)));
  f.values.set(KEY, JSON.stringify(session(1)));
  await f.runtime.auth.initialize();
  expect((await f.runtime.auth.getSession()).data.session?.user.id).toBe(user(1).id);
});

it("web Google sign-in requests a code that only this browser's verifier can exchange", async () => {
  const start = open("/auth/login");
  await start.runtime.auth.initialize();
  const { data, error } = await start.runtime.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: ORIGIN, skipBrowserRedirect: true },
  });
  expect(error).toBeNull();
  const authorize = new URL(data.url!);
  expect(authorize.searchParams.get("code_challenge_method")).toBe("s256");
  expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
  const verifier = start.values.get(`${KEY}-code-verifier`);
  expect(verifier).toBeTruthy();
  await start.runtime.auth.stopAutoRefresh();

  // The provider returns to the site with a code; the same browser's storage still holds the verifier.
  const back = open("/?code=synthetic-code");
  back.values.set(`${KEY}-code-verifier`, verifier!);
  await back.runtime.auth.initialize();
  const exchange = back.requests.find((request) => request.path.endsWith("/token"));
  expect(exchange?.search).toBe("?grant_type=pkce");
  expect(exchange?.body).toMatchObject({
    auth_code: "synthetic-code",
    code_verifier: (JSON.parse(verifier!) as string).split("/")[0],
  });
  expect(JSON.parse(back.values.get(KEY) ?? "null")?.user.id).toBe(user(1).id);
  expect(back.location.search).toBe("");
});

it("a code without this browser's verifier is not exchanged", async () => {
  const f = open("/?code=someone-elses-code");
  await f.runtime.auth.initialize();
  expect(f.requests).toEqual([]);
  expect((await f.runtime.auth.getSession()).data.session).toBeNull();
});

it("web signup asks for a PKCE confirmation the main client can finish", async () => {
  const f = open("/auth/signup");
  await f.runtime.auth.initialize();
  const { error } = await f.runtime.signUp(owner, null, {
    email: "user3@example.invalid",
    password: "synthetic",
    options: { emailRedirectTo: ORIGIN },
  });
  expect(error).toBeNull();
  const signup = f.requests.find((request) => request.path.endsWith("/signup"));
  expect(signup?.body).toMatchObject({ code_challenge_method: "s256" });
  expect(signup?.body.code_challenge).toBeTruthy();
  // The command client's verifier lands under the main key, where the confirmation return finds it.
  expect(f.values.get(`${KEY}-code-verifier`)).toBeTruthy();
});

it("web reset emails stay on the implicit flow so they work on another device", async () => {
  const f = open("/auth/forgot-password");
  await f.runtime.auth.initialize();
  const { error } = await f.runtime.requestPasswordReset("user2@example.invalid", `${ORIGIN}/auth/reset-password`);
  expect(error).toBeNull();
  const recover = f.requests.find((request) => request.path.endsWith("/recover"));
  expect(recover?.body).toMatchObject({ email: "user2@example.invalid", code_challenge: null });
  expect(recover?.search).toBe(`?redirect_to=${encodeURIComponent(`${ORIGIN}/auth/reset-password`)}`);
  expect([...f.values.keys()]).toEqual([]);
});

it("the reset route leaves its link tokens for the isolated recovery session", async () => {
  const f = open("/auth/reset-password" + fragment(session(2), "&type=recovery"));
  await f.runtime.auth.initialize();
  expect(f.location.hash).not.toBe("");
  expect(f.values.has(KEY)).toBe(false);

  const recovery = await f.runtime.openPasswordRecovery({
    access_token: session(2).access_token,
    refresh_token: session(2).refresh_token,
  });
  expect(recovery?.userId).toBe(user(2).id);
  await recovery!.updatePassword("synthetic-new-password");
  await recovery!.finish();
  expect(f.requests.map((request) => `${request.method} ${request.path}${request.search}`)).toEqual([
    "GET /auth/v1/user",
    "PUT /auth/v1/user",
    "POST /auth/v1/logout?scope=global",
  ]);
  // The link's session never reached the app's storage or its signed-in state.
  expect([...f.values.keys()]).toEqual([]);
  expect((await f.runtime.auth.getSession()).data.session).toBeNull();
});

it("native keeps the implicit flow that its OAuth callback reads", async () => {
  const values = new Map<string, string>();
  const runtime = createRootAuthRuntime({
    url: ORIGIN,
    anonKey: "public-synthetic-key",
    storageKey: KEY,
    isWeb: false,
    nativeStorage: {
      getItem: (name) => values.get(name) ?? null,
      setItem: (name, value) => {
        values.set(name, value);
      },
      removeItem: (name) => {
        values.delete(name);
      },
    },
    fetch: async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  opened.push(runtime);
  await runtime.auth.initialize();
  const { data } = await runtime.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: "hafiz://auth/callback", skipBrowserRedirect: true },
  });
  expect(new URL(data.url!).searchParams.has("code_challenge")).toBe(false);
  expect(values.has(`${KEY}-code-verifier`)).toBe(false);
});
