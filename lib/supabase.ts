import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// ─── Supabase Configuration ────────────────────────────────────
// These are the PUBLIC anon key and URL — safe to embed in client code.
// All data access is controlled by Row Level Security (RLS) on the server.
//
// To connect to your own Supabase project:
// 1. Create a project at https://supabase.com
// 2. Run the SQL in supabase/schema.sql to create tables + RLS policies
// 3. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.
//    Vercel builds map Supabase integration vars in scripts/vercel-build.sh.

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  "YOUR_PROJECT_URL";
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  "YOUR_ANON_KEY";

/** Returns true if the Supabase client is configured with real credentials */
export function isSupabaseConfigured(): boolean {
  return (
    !SUPABASE_URL.includes("YOUR_PROJECT") &&
    !SUPABASE_ANON_KEY.includes("YOUR_ANON_KEY")
  );
}

// Lazy-initialize the Supabase client so the app can boot without
// valid credentials (offline-first). The client is only created when
// auth, sync, or community features actually access it.
let _client: SupabaseClient | null = null;

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_client) {
      if (!isSupabaseConfigured()) {
        // Return a safe stub for unconfigured environments.
        // Auth store's initialize() checks isSupabaseConfigured() and skips.
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
      _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          ...(Platform.OS !== "web" ? { storage: AsyncStorage } : {}),
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: Platform.OS === "web",
        },
      });
    }
    return (_client as any)[prop];
  },
});
