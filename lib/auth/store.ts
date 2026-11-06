import { create } from "zustand";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import type { AuthOwner } from "@/lib/auth/coordinator";
import { authCommands, observeAuthSession, canRestoreAuthSession, canCompleteAuthRecovery } from "@/lib/auth/commands";
import { Platform } from "react-native";
import {
  supabase,
  isSupabaseConfigured,
  updateOwnedPassword,
  signOutOwnedSession,
  restoreOwnedSession,
  readOwnedSession,
} from "@/lib/supabase";
import { startAppOAuth } from "@/lib/auth/oauth";
import { isEmailAuthFlowsEnabled } from "@/lib/auth/config";
import { isQfLoginEnabled, isQfSyncEnabled } from "@/lib/quran-foundation/config";
import { connectQfFromSession } from "@/lib/quran-foundation/user";
import { QF_OAUTH_PROVIDER } from "@/lib/quran-foundation/user-types";
import type { AuthState, AuthActions, Profile } from "@/lib/auth/types";

type AuthStore = AuthState & AuthActions;

let profileOwnerGeneration = 0;
let authInitialization: Promise<void> | undefined;
let cancelAuthListener: (() => void) | undefined;

// Reads and the two profile writers share one publication boundary. Obsolete
// owners cannot keep a replacement session's reads behind an old request.
const pendingProfileWrites = new Set<{ userId: string; owner: AuthOwner }>();

function hasPendingProfileWrite(userId: string): boolean {
  let pending = false;
  for (const write of pendingProfileWrites) {
    if (!write.owner.isCurrent()) pendingProfileWrites.delete(write);
    else if (write.userId === userId) pending = true;
  }
  return pending;
}

export function beginProfileWrite(userId: string, owner: AuthOwner) {
  const hadPendingWrite = hasPendingProfileWrite(userId);
  const write = { userId, owner };
  pendingProfileWrites.add(write);
  return { hadPendingWrite, release: () => pendingProfileWrites.delete(write) };
}

function isProfileForUser(value: unknown, userId: string): boolean {
  if (value === null) return true;
  if (typeof value !== "object" || !("id" in value)) return false;
  return value.id === userId;
}

function publishProfileRead(
  userId: string,
  profileAtRead: Profile | null,
  hadPendingWrite: boolean,
  incoming: Profile | null,
): Profile | null {
  if (!isProfileForUser(incoming, userId)) throw new Error("Profile response belongs to another user");
  const current = useAuthStore.getState().profile;
  if (current?.id === userId && (current !== profileAtRead || hadPendingWrite || hasPendingProfileWrite(userId)))
    return current;
  useAuthStore.setState({ profile: incoming });
  return incoming;
}

function buildFallbackProfile(user: NonNullable<AuthState["user"]>): Profile {
  const metadata = user.user_metadata ?? {};
  const emailName = user.email?.split("@")[0];
  const providerName =
    metadata.username || metadata.preferred_username || metadata.name || metadata.full_name || metadata.sub;
  const suffix = user.id.replace(/-/g, "").slice(0, 8);
  const baseName = emailName || providerName || `user_${suffix}`;
  const sanitized =
    String(baseName)
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/^_+|_+$/g, "") || "user";
  const username = emailName
    ? sanitized.slice(0, 20)
    : `${sanitized.slice(0, Math.max(3, 19 - suffix.length))}_${suffix}`.slice(0, 20);

  return {
    id: user.id,
    username,
    display_name: typeof metadata.display_name === "string" ? metadata.display_name : null,
    avatar_url: null,
    bio: null,
    country: null,
    total_score: 0,
    current_streak: 0,
    longest_streak: 0,
    cards_reviewed: 0,
    last_review_date: null,
    created_at: user.created_at,
  };
}

function connectQfSessionIfAvailable(session: AuthState["session"]): void {
  if (!isQfSyncEnabled()) return;
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

function setSessionIdentity({ session, user }: Pick<AuthState, "session" | "user">): void {
  useAuthStore.setState((state) => ({
    session,
    user,
    profile: user && state.user?.id === user.id && state.profile?.id === user.id ? state.profile : null,
  }));
}

export async function preparePasswordRecovery(
  tokens?: { access_token: string; refresh_token: string },
  isActive: () => boolean = () => true,
) {
  let obsoleteRecovery = false;
  const result = await authCommands.replace(async (isCurrent) => {
    if (!isActive()) {
      obsoleteRecovery = true;
      return false;
    }
    const readOwner = authCommands.captureOwner();
    const response = await (
      tokens
        ? restoreOwnedSession(readOwner, useAuthStore.getState().session, tokens, isActive)
        : readOwnedSession(readOwner, useAuthStore.getState().session, isActive)
    ).catch((error) => {
      if (!isActive() || !readOwner.isCurrent()) {
        obsoleteRecovery = true;
        return null;
      }
      throw error;
    });
    if (!response) return false;
    if (!isActive()) {
      obsoleteRecovery = true;
      return false;
    }
    const { data, error } = response;
    if (error && !readOwner.isCurrent()) {
      obsoleteRecovery = true;
      return false;
    }
    if (
      !error &&
      !(tokens ? canCompleteAuthRecovery(readOwner, data.session) : canRestoreAuthSession(readOwner, data.session))
    ) {
      obsoleteRecovery = true;
      return false;
    }
    if (error) throw error;
    if (!isCurrent()) return false;
    setSessionIdentity({ session: data.session, user: data.session?.user ?? null });
    return getAuthSessionIdentity(data.session).kind === "identified";
  });
  return obsoleteRecovery ? { status: "superseded" as const } : result;
}

export function finishPasswordRecovery(owner: AuthOwner) {
  return authCommands.owned(
    owner,
    async () => {
      const { error } = await signOutOwnedSession(owner, useAuthStore.getState().session);
      if (error) throw error;
    },
    true,
  );
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

  initialize: () => {
    if (authInitialization) return authInitialization;
    if (get().isInitialized) return Promise.resolve();
    const readOwner = authCommands.captureOwner();
    authInitialization = authCommands
      .bootstrap(async () => {
        if (!isSupabaseConfigured()) {
          set({ isInitialized: true });
          return;
        }
        try {
          set({ isLoading: true });
          // The singleton store owns its listener across root remounts.
          // A new initialization retires any queued callback from its old listener.
          cancelAuthListener?.();
          let active = true;
          let acceptsStartupSession = true;
          const {
            data: { subscription },
          } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!active) return;
            if (_event === "INITIAL_SESSION") {
              if (!acceptsStartupSession || !canRestoreAuthSession(readOwner, session)) return;
              acceptsStartupSession = false;
            } else {
              acceptsStartupSession = false;
            }
            setSessionIdentity({ session, user: session?.user ?? null });
            if (session?.user) {
              connectQfSessionIfAvailable(session);
              get().ensureProfile();
            } else {
              set({ profile: null });
            }
          });
          cancelAuthListener = () => {
            active = false;
            subscription.unsubscribe();
          };
          // A published SDK notification takes precedence over the pending startup snapshot.
          // Same-session refreshes preserve command ownership but still replace older credentials.
          const {
            data: { session },
            error,
          } = await supabase.auth.getSession();
          if (error) throw error;
          if (session && acceptsStartupSession && canRestoreAuthSession(readOwner, session)) {
            acceptsStartupSession = false;
            setSessionIdentity({ session, user: session.user });
            connectQfSessionIfAvailable(session);
            get().ensureProfile();
          }
        } catch (error) {
          console.warn("[Auth] Init error:", error instanceof Error ? error.message : String(error));
        } finally {
          set({ isLoading: false, isInitialized: true });
        }
      })
      .finally(() => {
        authInitialization = undefined;
      });
    return authInitialization;
  },

  signIn: async (email: string, password: string) =>
    authCommands.transition(async () => {
      set({ isLoading: true, error: null });
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw error;
        setSessionIdentity({ session: data.session, user: data.user });
        await get().ensureProfile();
      } catch (err: any) {
        set({ error: err.message });
        throw err;
      } finally {
        set({ isLoading: false });
      }
    }),

  signInWithQuranFoundation: async () => {
    if (!isQfLoginEnabled()) throw new Error("Quran Foundation sign-in is not enabled.");
    set({ isLoading: true, error: null });
    try {
      const result = await startAppOAuth(QF_OAUTH_PROVIDER);
      if (result.session) {
        setSessionIdentity({ session: result.session, user: result.session.user });
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
    if (!isQfLoginEnabled()) throw new Error("Quran Foundation sign-in is not enabled.");
    set({ isLoading: true, error: null });
    try {
      const result = await startAppOAuth(QF_OAUTH_PROVIDER, "link");
      if (result.session) {
        setSessionIdentity({ session: result.session, user: result.session.user });
        await get().ensureProfile();
      }
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  signUp: async (email: string, password: string, username: string, displayName: string) =>
    authCommands.transition(async () => {
      if (!isEmailAuthFlowsEnabled()) throw new Error("Signup is temporarily unavailable.");
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
            status:
              identities && identities.length === 0
                ? ("alreadyRegistered" as const)
                : ("needsEmailConfirmation" as const),
          };
        }

        setSessionIdentity({ session: data.session, user: data.user });
        await get().ensureProfile();
        return { status: "signedIn" as const };
      } catch (err: any) {
        set({ error: err.message });
        throw err;
      } finally {
        set({ isLoading: false });
      }
    }),

  resendSignupConfirmation: async (email: string) => {
    if (!isEmailAuthFlowsEnabled()) throw new Error("Signup is temporarily unavailable.");
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
    if (!isEmailAuthFlowsEnabled()) throw new Error("Password reset is temporarily unavailable.");
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

  updatePassword: async (password, owner = authCommands.captureOwner()) => {
    return authCommands.owned(owner, async () => {
      if (owner.isCurrent()) set({ error: null });
      try {
        const { data, error } = await updateOwnedPassword(owner, get().session, password);
        if (error) throw error;
        if (owner.isCurrent()) set({ user: data.user });
      } catch (err: any) {
        if (owner.isCurrent()) set({ error: err.message });
        throw err;
      }
    });
  },

  signOut: async () =>
    authCommands.transition(async () => {
      set({ isLoading: true, error: null });
      try {
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw error;
      } catch (err: any) {
        console.warn("[Auth] Sign out error:", err.message);
      } finally {
        set({ session: null, user: null, profile: null, isLoading: false, error: null });
      }
    }),

  fetchProfile: async () => {
    const user = get().user;
    if (!user) return;

    const generation = profileOwnerGeneration;
    const profileAtRead = get().profile;
    const hadPendingWrite = hasPendingProfileWrite(user.id);
    const isCurrentOwner = () => generation === profileOwnerGeneration && get().user?.id === user.id;

    try {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();

      if (!isCurrentOwner()) return;

      if (error) throw error;
      publishProfileRead(user.id, profileAtRead, hadPendingWrite, data as Profile);
    } catch (err: any) {
      if (!isCurrentOwner()) return;
      console.warn("[Auth] Failed to fetch profile:", err.message);
      publishProfileRead(user.id, profileAtRead, hadPendingWrite, buildFallbackProfile(user));
    }
  },

  updateProfile: async ({ displayName, avatarUrl, bio, country }, owner = authCommands.captureOwner()) => {
    const user = get().user;
    if (!user) throw new Error("Not signed in");
    const identity = getAuthSessionIdentity(get().session);
    if (identity.kind !== "identified" || identity.userId !== user.id.toLowerCase()) return { status: "superseded" };
    const isCurrent = () => owner.isCurrent() && get().user?.id === user.id;
    const requireCurrent = () => {
      if (!isCurrent()) {
        owner.cancel();
        throw new Error("Profile operation superseded");
      }
    };
    return authCommands.owned(owner, async () => {
      requireCurrent();
      set({ error: null });
      try {
        await get().ensureProfile(owner);
        requireCurrent();
        const patch: Record<string, string | null> = {};
        if (displayName !== undefined) patch.display_name = displayName;
        if (avatarUrl !== undefined) patch.avatar_url = avatarUrl;
        if (bio !== undefined) patch.bio = bio;
        if (country !== undefined) patch.country = country;

        const profileAtWrite = get().profile;
        const write = beginProfileWrite(user.id, owner);
        try {
          const { data, error } = await supabase.from("profiles").update(patch).eq("id", user.id).select("*").single();
          requireCurrent();
          if (error) throw error;
          if (!isProfileForUser(data, user.id) || data === null)
            throw new Error("Profile save returned no matching profile");
          const saved = data as Profile;
          const current = get().profile;
          let profile = saved;
          if (current?.id === user.id && (current !== profileAtWrite || write.hadPendingWrite)) {
            profile = { ...current };
            if (displayName !== undefined) profile.display_name = saved.display_name;
            if (avatarUrl !== undefined) profile.avatar_url = saved.avatar_url;
            if (bio !== undefined) profile.bio = saved.bio;
            if (country !== undefined) profile.country = saved.country;
          }
          set({ profile });
          const published = get().profile;
          return published?.id === user.id ? published : profile;
        } finally {
          write.release();
        }
      } catch (err: any) {
        if (isCurrent()) set({ error: err.message });
        else owner.cancel();
        throw err;
      }
    });
  },

  ensureProfile: async (owner) => {
    const user = get().user;
    if (!user) return null;

    const generation = profileOwnerGeneration;
    const profileAtRead = get().profile;
    const hadPendingWrite = hasPendingProfileWrite(user.id);
    const isCurrentOwner = () =>
      generation === profileOwnerGeneration && get().user?.id === user.id && (!owner || owner.isCurrent());

    const fallback = buildFallbackProfile(user);

    try {
      const { data: existingProfile, error: existingError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (!isCurrentOwner()) return null;

      if (existingError) throw existingError;
      if (existingProfile) {
        return publishProfileRead(user.id, profileAtRead, hadPendingWrite, existingProfile as Profile);
      }

      const { data, error } = await supabase.from("profiles").insert(buildProfileInsert(user)).select("*").single();

      if (!isCurrentOwner()) return null;

      if (error) throw error;
      return publishProfileRead(user.id, profileAtRead, hadPendingWrite, (data as Profile) ?? fallback);
    } catch (err: any) {
      if (!isCurrentOwner()) return null;
      console.warn("[Auth] Failed to ensure profile:", err.message);
      return publishProfileRead(user.id, profileAtRead, hadPendingWrite, fallback);
    }
  },

  clearError: () => set({ error: null }),
}));

// This observer shares the singleton store lifetime. It never writes state or
// registers another Supabase auth listener.
useAuthStore.subscribe((state, previous) => {
  observeAuthSession(state.session);
  if (state.user?.id !== previous.user?.id || state.session !== previous.session) {
    profileOwnerGeneration += 1;
  }
});
