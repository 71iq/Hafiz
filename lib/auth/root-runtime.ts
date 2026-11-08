import {
  AuthError,
  navigatorLock,
  type SupportedStorage,
  type Session,
  type SignInWithOAuthCredentials,
  type SignInWithPasswordCredentials,
  type SignUpWithPasswordCredentials,
} from "@supabase/supabase-js";
import { createOwnedAuthClient } from "@/lib/auth/client-adapter";
import { createBrowserSessionChannel } from "@/lib/auth/session-channel";
import { safeProcessLock } from "@/lib/auth/safe-lock";
import type { AuthOwner } from "@/lib/auth/coordinator";

type Options = {
  url: string;
  anonKey: string;
  storageKey?: string;
  isWeb: boolean;
  nativeStorage: SupportedStorage;
  fetch?: typeof fetch;
};
function memoryStorage(): SupportedStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
function browserStorage(): SupportedStorage | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  try {
    const storage = globalThis.localStorage;
    if (typeof storage !== "object" || storage === null) return null;
    const key = `hafiz-auth-storage-test-${Math.random()}`;
    storage.setItem(key, key);
    storage.removeItem(key);
    return storage;
  } catch {
    return null;
  }
}
export function createRootAuthRuntime(options: Options) {
  const storageKey = options.storageKey || `sb-${new URL(options.url).hostname.split(".")[0]}-auth-token`;
  const persistent = options.isWeb ? browserStorage() : options.nativeStorage;
  const backing = persistent ?? memoryStorage();
  const webLock =
    options.isWeb && typeof window !== "undefined" && typeof navigator !== "undefined" && !!navigator.locks;
  let channel: ReturnType<typeof createBrowserSessionChannel> | undefined;
  if (options.isWeb && persistent && webLock && typeof BroadcastChannel !== "undefined") {
    try {
      channel = createBrowserSessionChannel(storageKey);
    } catch (error) {
      console.warn("[Auth] Session notice channel unavailable", error);
    }
  }
  const supportsOwnedCommands = !options.isWeb || !!channel;
  // The reset route installs its tokens through the guarded recovery command.
  // Other web callback routes keep the SDK's existing URL detection.
  const resetRoute =
    options.isWeb &&
    typeof window !== "undefined" &&
    typeof window.location?.pathname === "string" &&
    window.location.pathname.replace(/\/+$/, "").endsWith("/auth/reset-password");
  const runtime = createOwnedAuthClient({
    url: options.url,
    anonKey: options.anonKey,
    storageKey,
    storage: backing,
    lock: webLock ? navigatorLock : safeProcessLock,
    autoRefreshToken: true,
    detectSessionInUrl: options.isWeb && !resetRoute,
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    channel,
  });
  function requireOwnership() {
    if (!supportsOwnedCommands)
      throw new AuthError("Auth storage ownership is unavailable", 409, "auth_storage_lock_unavailable");
  }
  return {
    client: runtime.client,
    auth: runtime.auth,
    storageKey,
    supportsOwnedCommands,
    readSession: (owner: AuthOwner, session: Session | null, isActive: () => boolean) => {
      requireOwnership();
      return runtime.readSession(owner, session, isActive);
    },
    restoreSession: (
      owner: AuthOwner,
      session: Session | null,
      tokens: { access_token: string; refresh_token: string },
      isActive: () => boolean,
      expectedUserId?: string,
    ) => {
      requireOwnership();
      return runtime.restoreSession(owner, session, tokens, isActive, expectedUserId);
    },
    // Preserve email login on existing memory and browser fallbacks. The private
    // replacement still guards this runtime and persisted base; cross-tab lifetime
    // notices require the channel above, as for the main SDK's existing fallback.
    signInWithPassword: (owner: AuthOwner, session: Session | null, credentials: SignInWithPasswordCredentials) =>
      runtime.signInWithPassword(owner, session, credentials),
    signUp: (owner: AuthOwner, session: Session | null, credentials: SignUpWithPasswordCredentials) =>
      runtime.signUp(owner, session, credentials),
    prepareLink: (owner: AuthOwner, session: Session | null, credentials: SignInWithOAuthCredentials) => {
      requireOwnership();
      return runtime.prepareLink(owner, session, credentials);
    },
    updatePassword: (owner: AuthOwner, session: Session | null, password: string) => {
      requireOwnership();
      return runtime.updatePassword(owner, session, password);
    },
    signOut: (owner: AuthOwner, session: Session | null) => {
      requireOwnership();
      return runtime.signOut(owner, session);
    },
  };
}
