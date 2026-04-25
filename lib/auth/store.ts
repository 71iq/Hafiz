import { create } from "zustand";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { AuthState, AuthActions, Profile } from "./types";

type AuthStore = AuthState & AuthActions;

export const useAuthStore = create<AuthStore>((set, get) => ({
  // ─── State ──────────────────────────────────────────────────
  session: null,
  user: null,
  profile: null,
  isLoading: false,
  isInitialized: false,
  error: null,

  // ─── Actions ────────────────────────────────────────────────

  initialize: async () => {
    if (!isSupabaseConfigured()) {
      set({ isInitialized: true });
      return;
    }

    try {
      set({ isLoading: true });

      // Restore session from storage
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) throw error;

      if (session) {
        set({ session, user: session.user });
        // Fetch profile in background
        get().fetchProfile();
      }

      // Listen for auth state changes
      supabase.auth.onAuthStateChange((_event, session) => {
        set({
          session,
          user: session?.user ?? null,
        });

        if (session?.user) {
          get().fetchProfile();
        } else {
          set({ profile: null });
        }
      });
    } catch (err: any) {
      console.warn("[Auth] Init error:", err.message);
    } finally {
      set({ isLoading: false, isInitialized: true });
    }
  },

  signIn: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;
      set({ session: data.session, user: data.user });
      await get().fetchProfile();
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  signUp: async (
    email: string,
    password: string,
    username: string,
    displayName: string
  ) => {
    set({ isLoading: true, error: null });
    try {
      // Pass username and display_name as user metadata so the
      // handle_new_user() database trigger can create the profile row
      // automatically via SECURITY DEFINER (bypasses RLS).
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { username: username.trim(), display_name: displayName.trim() || null } },
      });
      if (error) throw error;
      if (!data.user) throw new Error("Signup failed — no user returned");

      if (!data.session) {
        const identities = data.user.identities;
        return {
          status: identities && identities.length === 0 ? "alreadyRegistered" : "needsEmailConfirmation",
        };
      }

      set({ session: data.session, user: data.user });
      await get().fetchProfile();
      return { status: "signedIn" };
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  signOut: async () => {
    set({ isLoading: true, error: null });
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      set({ session: null, user: null, profile: null });
    } catch (err: any) {
      set({ error: err.message });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchProfile: async () => {
    const user = get().user;
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (error) throw error;
      set({ profile: data as Profile });
    } catch (err: any) {
      console.warn("[Auth] Failed to fetch profile:", err.message);
    }
  },

  clearError: () => set({ error: null }),
}));
