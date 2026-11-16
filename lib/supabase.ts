import {
  type SupabaseClient,
  type SignInWithOAuthCredentials,
  type SignInWithPasswordCredentials,
  type SignUpWithPasswordCredentials,
  type Session,
} from "@supabase/supabase-js";
import { createRootAuthRuntime } from "@/lib/auth/root-runtime";
import type { AuthOwner } from "@/lib/auth/coordinator";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import Constants from "expo-constants";


const expoExtra = (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<
  string,
  string | undefined
>;

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  expoExtra.EXPO_PUBLIC_SUPABASE_URL ??
  expoExtra.NEXT_PUBLIC_SUPABASE_URL ??
  expoExtra.SUPABASE_URL ??
  expoExtra.supabaseUrl ??
  "YOUR_PROJECT_URL";
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  expoExtra.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  expoExtra.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  expoExtra.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  expoExtra.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  expoExtra.SUPABASE_ANON_KEY ??
  expoExtra.SUPABASE_PUBLISHABLE_KEY ??
  expoExtra.supabaseAnonKey ??
  expoExtra.supabasePublishableKey ??
  "YOUR_ANON_KEY";

export function supabaseAnonKey(): string {
  return SUPABASE_ANON_KEY;
}

export function isSupabaseConfigured(): boolean {
  return !SUPABASE_URL.includes("YOUR_PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR_ANON_KEY");
}

let _client: SupabaseClient | null = null;
let _runtime: ReturnType<typeof createRootAuthRuntime> | null = null;

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_client) {
      if (!isSupabaseConfigured()) {
        if (prop === "auth") {
          return {
            getSession: () => Promise.resolve({ data: { session: null }, error: null }),
            signInWithPassword: () => Promise.reject(new Error("Supabase not configured")),
            signUp: () => Promise.reject(new Error("Supabase not configured")),
            signOut: () => Promise.resolve({ error: null }),
            signInWithOAuth: () => Promise.reject(new Error("Supabase not configured")),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
            setSession: () => Promise.reject(new Error("Supabase not configured")),
          };
        }
        if (prop === "from") {
          return () => ({
            select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
            insert: () => Promise.resolve({ error: new Error("Supabase not configured") }),
            upsert: () => Promise.resolve({ error: new Error("Supabase not configured") }),
          });
        }
        return undefined;
      }
      _runtime = createRootAuthRuntime({
        url: SUPABASE_URL,
        anonKey: SUPABASE_ANON_KEY,
        storageKey: process.env.EXPO_PUBLIC_SUPABASE_AUTH_STORAGE_KEY || undefined,
        isWeb: Platform.OS === "web",
        nativeStorage: AsyncStorage,
      });
      _client = _runtime.client;
    }
    if (prop === "auth" && _runtime) return _runtime.auth;
    return (_client as any)[prop];
  },
});

function ownedRuntime() {
  void supabase.auth;
  if (!_runtime) throw new Error("Supabase not configured");
  return _runtime;
}
export function updateOwnedPassword(owner: AuthOwner, session: Session | null, password: string) {
  return ownedRuntime().updatePassword(owner, session, password);
}
export function signOutOwnedSession(owner: AuthOwner, session: Session | null) {
  return ownedRuntime().signOut(owner, session);
}

export function restoreOwnedSession(
  owner: AuthOwner,
  session: Session | null,
  tokens: { access_token: string; refresh_token: string },
  isActive: () => boolean,
  expectedUserId?: string,
) {
  return ownedRuntime().restoreSession(owner, session, tokens, isActive, expectedUserId);
}

export function readOwnedSession(owner: AuthOwner, session: Session | null, isActive: () => boolean) {
  return ownedRuntime().readSession(owner, session, isActive);
}

export function prepareOwnedLink(owner: AuthOwner, session: Session | null, credentials: SignInWithOAuthCredentials) {
  return ownedRuntime().prepareLink(owner, session, credentials);
}

export function signInOwnedPassword(
  owner: AuthOwner,
  session: Session | null,
  credentials: SignInWithPasswordCredentials,
) {
  return ownedRuntime().signInWithPassword(owner, session, credentials);
}
export function signUpOwnedPassword(
  owner: AuthOwner,
  session: Session | null,
  credentials: SignUpWithPasswordCredentials,
) {
  return ownedRuntime().signUp(owner, session, credentials);
}
