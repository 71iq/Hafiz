import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// ─── Supabase Configuration ────────────────────────────────────
// These are the PUBLIC anon key and URL — safe to embed in client code.
// All data access is controlled by Row Level Security (RLS) on the server.
//
// To connect to your own Supabase project:
// 1. Create a project at https://supabase.com
// 2. Run the SQL in supabase/schema.sql to create tables + RLS policies
// 3. Replace the values below with your project's URL and anon key

const SUPABASE_URL = "YOUR_PROJECT_URL";
const SUPABASE_ANON_KEY =
  "YOUR_ANON_KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // On native, use AsyncStorage for session persistence
    // On web, Supabase defaults to localStorage
    ...(Platform.OS !== "web" ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
  },
});

/** Returns true if the Supabase client is configured with real credentials */
export function isSupabaseConfigured(): boolean {
  return (
    !SUPABASE_URL.includes("YOUR_PROJECT") &&
    !SUPABASE_ANON_KEY.includes("YOUR_ANON_KEY")
  );
}
