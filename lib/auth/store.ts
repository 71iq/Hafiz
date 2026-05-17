import { create } from "zustand";
import { Platform } from "react-native";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { startAppOAuth } from "@/lib/auth/oauth";
import { isQfUserAuthEnabled } from "@/lib/quran-foundation/config";
import { connectQfFromSession } from "@/lib/quran-foundation/user";
import { QF_OAUTH_PROVIDER } from "@/lib/quran-foundation/user-types";
import type { AuthState, AuthActions, Profile } from "./types";

type AuthStore = AuthState & AuthActions;

function buildFallbackProfile(user: NonNullable<AuthState["user"]>): Profile {
  const metadata = user.user_metadata ?? {};
  const emailName = user.email?.split("@")[0];
  const providerName =
    metadata.username ||
    metadata.preferred_username ||
    metadata.name ||
    metadata.full_name ||
    metadata.sub;
  const suffix = user.id.replace(/-/g, "").slice(0, 8);
  const baseName = emailName || providerName || `user_${suffix}`;
  const sanitized = String(baseName).replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "user";
  const username = emailName
    ? sanitized.slice(0, 20)
    : `${sanitized.slice(0, Math.max(3, 19 - suffix.length))}_${suffix}`.slice(0, 20);

  return {
    id: user.id,
    username,
    display_name: typeof metadata.display_name === "string" ? metadata.display_name : null,
    avatar_url: null,
    total_score: 0,
    current_streak: 0,
    longest_streak: 0,
    cards_reviewed: 0,
    last_review_date: null,
    created_at: user.created_at,
  };
}

function connectQfSessionIfAvailable(session: AuthState["session"]): void {
  if (!isQfUserAuthEnabled()) return;
  if (!(session as any)?.provider_token) return;
  connectQfFromSession(session).catch(console.warn);
}

function buildProfileInsert(user: NonNullable<AuthState["user"]>) {
  const profile = buildFallbackProfile(user);
  return {
    id: profile.id,
    username: profile.username,
    display_name: profile.display_name,
  };
}

function getEmailRedirectTo(): string | undefined {
  if (Platform.OS !== "web") return undefined;
  return globalThis.location?.origin;
}

function getPasswordResetRedirectTo(): string | undefined {
  const baseUrl = getEmailRedirectTo();
  return baseUrl ? `${baseUrl}/auth/reset-password` : undefined;
}

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
        connectQfSessionIfAvailable(session);
        get().ensureProfile();
      }

      // Listen for auth state changes
      supabase.auth.onAuthStateChange((_event, session) => {
        set({
          session,
          user: session?.user ?? null,
        });

        if (session?.user) {
          connectQfSessionIfAvailable(session);
          get().ensureProfile();
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
      await get().ensureProfile();
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  signInWithQuranFoundation: async () => {
    if (!isQfUserAuthEnabled()) throw new Error("Quran Foundation sign-in is not enabled.");
    set({ isLoading: true, error: null });
    try {
      const result = await startAppOAuth(QF_OAUTH_PROVIDER);
      if (result.session) {
        set({ session: result.session, user: result.session.user });
        await get().ensureProfile();
      }
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  linkQuranFoundation: async () => {
    if (!isQfUserAuthEnabled()) throw new Error("Quran Foundation sign-in is not enabled.");
    set({ isLoading: true, error: null });
    try {
      const result = await startAppOAuth(QF_OAUTH_PROVIDER, "link");
      if (result.session) {
        set({ session: result.session, user: result.session.user });
        await get().ensureProfile();
      }
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
        options: {
          data: { username: username.trim(), display_name: displayName.trim() || null },
          emailRedirectTo: getEmailRedirectTo(),
        },
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
      await get().ensureProfile();
      return { status: "signedIn" };
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  resendSignupConfirmation: async (email: string) => {
    set({ isLoading: true, error: null });
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: getEmailRedirectTo() },
      });
      if (error) throw error;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  sendPasswordReset: async (email: string) => {
    set({ isLoading: true, error: null });
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: getPasswordResetRedirectTo(),
      });
      if (error) throw error;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  updatePassword: async (password: string) => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      set({ user: data.user });
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
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
    } catch (err: any) {
      console.warn("[Auth] Sign out error:", err.message);
    } finally {
      set({ session: null, user: null, profile: null, isLoading: false, error: null });
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
      set({ profile: buildFallbackProfile(user) });
    }
  },

  ensureProfile: async () => {
    const user = get().user;
    if (!user) return null;

    const fallback = buildFallbackProfile(user);

    try {
      const { data, error } = await supabase
        .from("profiles")
        .upsert(buildProfileInsert(user), { onConflict: "id", ignoreDuplicates: true })
        .select("*")
        .single();

      if (error) throw error;
      const profile = (data as Profile) ?? fallback;
      set({ profile });
      return profile;
    } catch (err: any) {
      console.warn("[Auth] Failed to ensure profile:", err.message);
      set({ profile: fallback });
      return fallback;
    }
  },

  clearError: () => set({ error: null }),
}));
