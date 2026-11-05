import type { SessionChannel, SessionNotice } from "@/lib/auth/session-channel";
import { createOwnedAuthClient } from "@/lib/auth/client-adapter";
import { safeProcessLock } from "@/lib/auth/safe-lock";
import { createAuthCoordinator } from "@/lib/auth/coordinator";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import type { Session, User, LockFunc } from "@supabase/supabase-js";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function session(index: number, seconds = 3600): Session {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const user: User = { id, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01" };
  const payload = {
    sub: id,
    session_id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    exp: Math.floor(Date.now() / 1000) + seconds,
  };
  const token = [{ alg: "HS256" }, payload, "synthetic"]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .join(".");
  return {
    user,
    access_token: token,
    refresh_token: `synthetic-refresh-${index}`,
    token_type: "bearer",
    expires_in: seconds,
    expires_at: payload.exp,
  };
}
let sequence = 0;
async function setup(
  mode: "normal" | "put" | "logout" | "refresh" = "normal",
  custom?: { channel: SessionChannel; lock: LockFunc },
) {
  const key = `rf125-adapter-${++sequence}`;
  const initial = session(1);
  const replacement = session(2);
  const refreshed = { ...session(1), refresh_token: "synthetic-new-refresh" };
  const memory = new Map([[key, JSON.stringify(initial)]]);
  const put = deferred();
  const putRelease = deferred();
  const logout = deferred();
  const logoutRelease = deferred();
  const refresh = deferred();
  const refreshRelease = deferred();
  const events: string[] = [];
  const requests: string[] = [];
  let current: Session | null = null;
  const coordinator = createAuthCoordinator(null);
  const first = deferred();
  let signInCount = 0;
  const adapter = createOwnedAuthClient({
    url: "https://synthetic.example.invalid",
    anonKey: "public-synthetic-key",
    storageKey: key,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    lock: custom?.lock ?? safeProcessLock,
    channel: custom?.channel,
    storage: {
      getItem: (name) => memory.get(name) ?? null,
      setItem: (name, value) => {
        memory.set(name, value);
      },
      removeItem: (name) => {
        memory.delete(name);
      },
    },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      requests.push(`${method} ${String(input)}`);
      let body: unknown;
      if (path.endsWith("/user") && method === "PUT") {
        put.resolve();
        if (mode === "put") await putRelease.promise;
        body = { user: { ...initial.user, user_metadata: { password_update: true } } };
      } else if (path.endsWith("/user")) {
        body = { user: initial.user };
      } else if (path.endsWith("/logout")) {
        logout.resolve();
        if (mode === "logout") await logoutRelease.promise;
        body = {};
      } else if (String(input).includes("grant_type=refresh_token")) {
        refresh.resolve();
        await refreshRelease.promise;
        body = refreshed;
      } else if (String(input).includes("grant_type=password")) {
        body = session(++signInCount + 1);
      } else throw new Error(`Unexpected synthetic request ${method} ${String(input)}`);
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const subscription = adapter.auth.onAuthStateChange((event, value) => {
    events.push(event);
    current = value;
    const id = getAuthSessionIdentity(value);
    coordinator.observeIdentity(id.kind === "identified" ? JSON.stringify(id) : null);
    if (event === "INITIAL_SESSION") first.resolve();
  }).data.subscription;
  await first.promise;
  const password = (owner = coordinator.captureOwner()) => {
    const captured = current;
    return coordinator.owned(owner, async () => {
      const { data, error } = await adapter.updatePassword(owner, captured, "synthetic-password");
      if (error) throw error;
      return data.user;
    });
  };
  const finish = () => {
    const owner = coordinator.captureOwner();
    const captured = current;
    return coordinator.owned(
      owner,
      async () => {
        const { error } = await adapter.signOut(owner, captured);
        if (error) throw error;
      },
      true,
    );
  };
  return {
    adapter,
    key,
    memory,
    initial,
    replacement,
    refreshed,
    events,
    requests,
    coordinator,
    password,
    finish,
    current: () => current,
    put,
    putRelease,
    logout,
    logoutRelease,
    refresh,
    refreshRelease,
    close: async () => {
      subscription.unsubscribe();
      await adapter.client.auth.stopAutoRefresh();
    },
  };
}
it("actual factory preserves main API normal callback and persisted updated user", async () => {
  const f = await setup();
  try {
    expect((await f.password()).status).toBe("completed");
    expect(f.events).toContain("USER_UPDATED");
    expect((await f.adapter.auth.getSession()).data.session?.user.user_metadata).toEqual({ password_update: true });
    expect(f.current()?.user.user_metadata).toEqual({ password_update: true });
  } finally {
    await f.close();
  }
});
it("actual factory refuses old password persistence over two external sign-ins", async () => {
  const f = await setup("put");
  const p = f.password();
  try {
    await f.put.promise;
    expect(
      (await f.adapter.auth.signInWithPassword({ email: "b@example.invalid", password: "synthetic" })).error,
    ).toBeNull();
    expect(
      (await f.adapter.auth.signInWithPassword({ email: "c@example.invalid", password: "synthetic" })).error,
    ).toBeNull();
    f.putRelease.resolve();
    expect((await p).status).toBe("superseded");
    expect(f.current()?.user.id).toBe(session(3).user.id);
    expect((await f.adapter.auth.getSession()).data.session?.user.id).toBe(session(3).user.id);
  } finally {
    f.putRelease.resolve();
    await p;
    await f.close();
  }
});
it("actual factory preserves successful terminal signout", async () => {
  const f = await setup();
  try {
    expect((await f.finish()).status).toBe("completed");
    expect(f.current()).toBeNull();
    expect((await f.adapter.auth.getSession()).data.session).toBeNull();
  } finally {
    await f.close();
  }
});
it("actual factory never clears B after old A remote logout returns", async () => {
  const f = await setup("logout");
  const p = f.finish();
  try {
    await f.logout.promise;
    await f.adapter.auth.signInWithPassword({ email: "b@example.invalid", password: "synthetic" });
    f.logoutRelease.resolve();
    expect((await p).status).toBe("superseded");
    expect(f.current()?.user.id).toBe(f.replacement.user.id);
    expect((await f.adapter.auth.getSession()).data.session?.user.id).toBe(f.replacement.user.id);
  } finally {
    f.logoutRelease.resolve();
    await p;
    await f.close();
  }
});
it("actual factory retains issued refresh after screen cancellation and skips password PUT", async () => {
  const f = await setup("refresh");
  const near = session(1, 60);
  await f.adapter.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token });
  const owner = f.coordinator.captureOwner();
  const p = f.password(owner);
  try {
    await f.refresh.promise;
    owner.cancel();
    f.refreshRelease.resolve();
    expect((await p).status).toBe("superseded");
    expect(JSON.parse(f.memory.get(f.key) ?? "null")?.refresh_token).toBe("synthetic-new-refresh");
    expect(f.requests.some((x) => x.startsWith("PUT"))).toBe(false);
  } finally {
    f.refreshRelease.resolve();
    await p;
    await f.close();
  }
});

it("rejects stale reconciled realtime credentials after another factory replaces storage", async () => {
  const started = deferred();
  const release = deferred();
  let reads = 0;
  let receive: (notice: SessionNotice) => void = () => {
    throw new Error("missing subscription");
  };
  const channel: SessionChannel = {
    publish: () => {},
    subscribe: (callback) => {
      receive = callback;
      return () => {};
    },
  };
  const lock: LockFunc = async (name, timeout, work) => {
    if (name.startsWith("hafiz:auth-storage:") && reads > 0 && --reads === 0) {
      started.resolve();
      await release.promise;
    }
    return safeProcessLock(name, timeout, work);
  };
  const f = await setup("normal", { channel, lock });
  const sender = createOwnedAuthClient({
    url: "https://synthetic.example.invalid",
    anonKey: "public-synthetic-key",
    storageKey: f.key,
    storage: {
      getItem: (name) => f.memory.get(name) ?? null,
      setItem: (name, value) => {
        f.memory.set(name, value);
      },
      removeItem: (name) => {
        f.memory.delete(name);
      },
    },
    lock: safeProcessLock,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    fetch: async () =>
      new Response(JSON.stringify(f.replacement), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  try {
    await sender.auth.getSession();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const spy = jest.spyOn(f.adapter.client.realtime, "setAuth");
    reads = 2;
    receive({ event: "TOKEN_REFRESHED", identity: JSON.stringify(getAuthSessionIdentity(f.initial)) });
    await started.promise;
    expect(
      (await sender.auth.signInWithPassword({ email: "b@example.invalid", password: "synthetic" })).error,
    ).toBeNull();
    expect(JSON.parse(f.memory.get(f.key) ?? "null")?.user.id).toBe(f.replacement.user.id);
    await f.adapter.client.realtime.setAuth(f.replacement.access_token);
    spy.mockClear();
    release.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spy).not.toHaveBeenCalledWith(f.initial.access_token);
    spy.mockRestore();
  } finally {
    release.resolve();
    await sender.client.auth.stopAutoRefresh();
    await f.close();
  }
});
it("rejects anonymous logout notice for a non-null unidentified SDK session", async () => {
  let receive: (notice: SessionNotice) => void = () => {
    throw new Error("missing subscription");
  };
  const channel: SessionChannel = {
    publish: () => {},
    subscribe: (callback) => {
      receive = callback;
      return () => {};
    },
  };
  const f = await setup("normal", { channel, lock: safeProcessLock });
  try {
    const parts = f.initial.access_token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    delete payload.session_id;
    parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
    expect(
      (await f.adapter.auth.setSession({ access_token: parts.join("."), refresh_token: f.initial.refresh_token }))
        .error,
    ).toBeNull();
    const before = f.events.length;
    receive({ event: "SIGNED_OUT", identity: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.events.slice(before)).not.toContain("SIGNED_OUT");
    expect(f.current()).not.toBeNull();
  } finally {
    await f.close();
  }
});

it("retains replacement realtime credentials after a delayed anonymous SDK lookup", async () => {
  const started = deferred(),
    release = deferred();
  let armed = false;
  let lookupRequested = false;
  const lock: LockFunc = async (name, timeout, work) => {
    const result = await safeProcessLock(name, timeout, work);
    if (armed && name.startsWith("lock:")) {
      const value = result as { data?: { session?: Session | null } };
      if (value?.data?.session === null) {
        armed = false;
        started.resolve();
        await release.promise;
      }
    }
    return result;
  };
  const channel: SessionChannel = { publish: () => {}, subscribe: () => () => {} };
  const f = await setup("normal", { channel, lock });
  const original = f.adapter.client.realtime.setAuth.bind(f.adapter.client.realtime);
  const spy = jest.spyOn(f.adapter.client.realtime, "setAuth").mockImplementation((token) => {
    if (token == null) {
      armed = true;
      lookupRequested = true;
    }
    return original(token);
  });
  try {
    expect((await f.finish()).status).toBe("completed");
    if (lookupRequested) await started.promise;
    expect(
      (await f.adapter.auth.signInWithPassword({ email: "b@example.invalid", password: "synthetic" })).error,
    ).toBeNull();
    expect(f.adapter.client.realtime.accessTokenValue).toBe(f.replacement.access_token);
    release.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.adapter.client.realtime.accessTokenValue).toBe(f.replacement.access_token);
  } finally {
    release.resolve();
    spy.mockRestore();
    await f.close();
  }
});

it("bridges token refresh during first command initialization", async () => {
  const f = await setup("refresh");
  try {
    const near = session(1, 60);
    expect(
      (await f.adapter.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token })).error,
    ).toBeNull();
    const before = f.events.length;
    f.refreshRelease.resolve();
    expect((await f.password()).status).toBe("completed");
    expect(JSON.parse(f.memory.get(f.key) ?? "null")?.access_token).toBe(f.refreshed.access_token);
    expect(f.adapter.client.realtime.accessTokenValue).toBe(f.refreshed.access_token);
    expect(f.events.slice(before)).toContain("TOKEN_REFRESHED");
  } finally {
    f.refreshRelease.resolve();
    await f.close();
  }
});

it("guards the first command refresh against two replacement SDK sign-ins", async () => {
  const f = await setup("refresh");
  let pending: ReturnType<typeof f.password> | undefined;
  try {
    const near = session(1, 60);
    expect(
      (await f.adapter.auth.setSession({ access_token: near.access_token, refresh_token: near.refresh_token })).error,
    ).toBeNull();
    pending = f.password();
    await f.refresh.promise;
    expect(
      (await f.adapter.auth.signInWithPassword({ email: "b@example.invalid", password: "synthetic" })).error,
    ).toBeNull();
    expect(
      (await f.adapter.auth.signInWithPassword({ email: "c@example.invalid", password: "synthetic" })).error,
    ).toBeNull();
    const current = f.current();
    const before = f.events.length;
    f.refreshRelease.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    expect(JSON.parse(f.memory.get(f.key) ?? "null")?.user.id).toBe(current?.user.id);
    expect(f.current()?.user.id).toBe(current?.user.id);
    expect(f.events.slice(before)).not.toContain("TOKEN_REFRESHED");
    expect(f.requests.some((request) => request.startsWith("PUT "))).toBe(false);
  } finally {
    f.refreshRelease.resolve();
    await pending;
    await f.close();
  }
});
