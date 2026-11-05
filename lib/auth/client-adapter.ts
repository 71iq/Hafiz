import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import type { SessionChannel, SessionNotice } from "@/lib/auth/session-channel";
import { createClient, AuthClient, type Session, type LockFunc } from "@supabase/supabase-js";
import type { AuthOwner } from "@/lib/auth/coordinator";
import { createOwnedStorage, createSharedStorage } from "@/lib/auth/owned-storage";

type Backing = Parameters<typeof createSharedStorage>[0];
type Options = {
  channel?: SessionChannel;
  url: string;
  anonKey: string;
  storageKey: string;
  storage: Backing;
  lock: LockFunc;
  fetch: typeof fetch;
  autoRefreshToken: boolean;
  detectSessionInUrl: boolean;
};
export function createOwnedAuthClient(options: Options) {
  const shared = createSharedStorage(options.storage, (work) =>
    options.lock("hafiz:auth-storage:" + options.storageKey, -1, work),
  );
  const commandKey = options.storageKey + "::hafiz-password-command";
  const alias = (name: string) =>
    name.startsWith(commandKey) ? options.storageKey + name.slice(commandKey.length) : name;
  const owned = createOwnedStorage(
    {
      atomic: (work) =>
        shared.atomic((raw) =>
          work({
            getItem: (name) => raw.getItem(alias(name)),
            setItem: (name, value) => raw.setItem(alias(name), value),
            removeItem: (name) => raw.removeItem(alias(name)),
          }),
        ),
    },
    commandKey,
  );
  const client = createClient(options.url, options.anonKey, {
    auth: {
      storageKey: options.storageKey,
      storage: shared.storage,
      lock: options.lock,
      autoRefreshToken: options.autoRefreshToken,
      persistSession: true,
      detectSessionInUrl: options.detectSessionInUrl,
    },
    global: { fetch: options.fetch },
  });
  type Auth = typeof client.auth;
  type Callback = Parameters<Auth["onAuthStateChange"]>[0];
  const subscriptions = new Set<{ callback: Callback }>();
  const sessionIdentity = (session: Session | null): string | null => {
    const parsed = getAuthSessionIdentity(session);
    return parsed.kind === "identified" ? JSON.stringify(parsed) : null;
  };
  const noticeEvent = (event: string): event is SessionNotice["event"] =>
    event === "SIGNED_IN" ||
    event === "SIGNED_OUT" ||
    event === "TOKEN_REFRESHED" ||
    event === "USER_UPDATED" ||
    event === "PASSWORD_RECOVERY";
  async function deliver(event: SessionNotice["event"], session: Session | null, publish: boolean) {
    const pending: Promise<void>[] = [];
    await shared.atomic(async (raw) => {
      const value = await raw.getItem(options.storageKey);
      if (!session) {
        if (value !== null) return;
      } else {
        if (value === null) return;
        let stored: unknown;
        try {
          stored = JSON.parse(value);
        } catch {
          return;
        }
        if (
          !stored ||
          typeof stored !== "object" ||
          !("access_token" in stored) ||
          stored.access_token !== session.access_token ||
          !("refresh_token" in stored) ||
          stored.refresh_token !== session.refresh_token ||
          !("user" in stored) ||
          JSON.stringify(stored.user) !== JSON.stringify(session.user)
        )
          return;
      }
      // Start credential propagation while the matching storage transaction still owns the lock.
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")
        pending.push(client.realtime.setAuth(session?.access_token));
      else if (event === "SIGNED_OUT") {
        // Supabase uses the public key while anonymous. Avoid a second, stale async session lookup.
        pending.push(client.realtime.setAuth(options.anonKey));
      }
      if (publish && (session === null || sessionIdentity(session) !== null))
        options.channel?.publish({ event, identity: sessionIdentity(session) });
      for (const entry of subscriptions) {
        try {
          pending.push(Promise.resolve(entry.callback(event, session)));
        } catch (error) {
          pending.push(Promise.reject(error));
        }
      }
    });
    const results = await Promise.allSettled(pending);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  async function reconcile(notice: SessionNotice) {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const session = data.session;
    if (notice.identity === null ? session !== null : sessionIdentity(session) !== notice.identity) return;
    await deliver(notice.event, session, false);
  }
  options.channel?.subscribe((notice) => {
    void reconcile(notice).catch((error) => console.warn("[Auth] Session reconciliation failed", error));
  });
  let ready: Promise<Auth> | null = null;
  let commandActive = false;
  const auth = new Proxy(client.auth, {
    get(target, property, receiver) {
      if (property === "onAuthStateChange")
        return (callback: Callback) => {
          const result = target.onAuthStateChange(callback);
          const entry = { callback };
          subscriptions.add(entry);
          return {
            ...result,
            data: {
              ...result.data,
              subscription: {
                ...result.data.subscription,
                unsubscribe: () => {
                  result.data.subscription.unsubscribe();
                  subscriptions.delete(entry);
                },
              },
            },
          };
        };
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  function commandClient(): Promise<Auth> {
    if (!ready) {
      ready = (async () => {
        // Initialize SDK subscriptions against empty private storage. Real session reads start only
        // after the bridge is ready and run() has activated the command ownership scope.
        let bootstrapped = false;
        const bootstrap = new Map<string, string>();
        const commandStorage: Backing = {
          getItem: (name) => (bootstrapped ? owned.storage.getItem(name) : (bootstrap.get(name) ?? null)),
          setItem: (name, value) => {
            if (bootstrapped) return owned.storage.setItem(name, value);
            bootstrap.set(name, value);
          },
          removeItem: (name) => {
            if (bootstrapped) return owned.storage.removeItem(name);
            bootstrap.delete(name);
          },
        };
        // Command operations need the auth SDK only. A second Supabase realtime client would
        // turn rejected-recovery SIGNED_OUT cleanup into unsolicited reads/refreshes of prior A.
        const baseUrl = options.url.trim();
        const auth = new AuthClient({
          url: new URL("auth/v1", baseUrl.endsWith("/") ? baseUrl : baseUrl + "/").href,
          headers: { apikey: options.anonKey, Authorization: `Bearer ${options.anonKey}` },
          storageKey: commandKey,
          storage: commandStorage,
          lock: (_name, timeout, work) => options.lock("lock:" + options.storageKey, timeout, work),
          autoRefreshToken: false,
          persistSession: true,
          detectSessionInUrl: false,
          fetch: (input, init) => {
            const address = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (init?.method === "PUT" && new URL(address).pathname.endsWith("/user") && !owned.canDispatch())
              return Promise.resolve(
                new Response(JSON.stringify({ msg: "Auth operation superseded", error_code: "operation_superseded" }), {
                  status: 409,
                  headers: { "Content-Type": "application/json" },
                }),
              );
            return options.fetch(input, init);
          },
        });
        await auth.initialize();
        await auth.stopAutoRefresh();
        auth.onAuthStateChange((event, session) => {
          if (commandActive && noticeEvent(event)) return deliver(event, session, true);
        });
        // Drain SDK initial-session reads before activating a command ownership scope.
        await new Promise<void>((resolve) => {
          const barrier = auth.onAuthStateChange((event) => {
            if (event === "INITIAL_SESSION") {
              barrier.data.subscription.unsubscribe();
              resolve();
            }
          });
        });
        bootstrap.clear();
        bootstrapped = true;
        return auth;
      })();
    }
    return ready;
  }
  async function run<T>(
    owner: AuthOwner,
    session: Session | null,
    work: (auth: Auth) => Promise<T>,
    recovery = false,
  ): Promise<T> {
    const auth = await commandClient();
    return (recovery ? owned.restore : owned.run)(owner, session, async () => {
      commandActive = true;
      try {
        return await work(auth);
      } finally {
        commandActive = false;
      }
    });
  }
  return {
    client,
    auth,
    readSession: (owner: AuthOwner, session: Session | null, isActive: () => boolean) =>
      run(
        { isCurrent: () => owner.isCurrent() && isActive(), cancel: () => owner.cancel() },
        session,
        (auth) => auth.getSession(),
        session === null,
      ),
    restoreSession: (
      owner: AuthOwner,
      session: Session | null,
      tokens: { access_token: string; refresh_token: string },
      isActive: () => boolean,
    ) =>
      run(
        { isCurrent: () => owner.isCurrent() && isActive(), cancel: () => owner.cancel() },
        session,
        (auth) => auth.setSession(tokens),
        true,
      ),
    updatePassword: (owner: AuthOwner, session: Session | null, password: string) =>
      run(owner, session, (auth) => auth.updateUser({ password })),
    signOut: (owner: AuthOwner, session: Session | null) => run(owner, session, (auth) => auth.signOut()),
  };
}
