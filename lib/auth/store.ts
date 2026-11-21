import { create } from "zustand";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import type { AuthOwner, AuthCommandResult } from "@/lib/auth/coordinator";
import { authCommands, observeAuthSession, canRestoreAuthSession, canCompleteAuthRecovery } from "@/lib/auth/commands";
import { Platform } from "react-native";
import {
  supabase,
  isSupabaseConfigured,
  updateOwnedPassword,
  signOutOwnedSession,
  restoreOwnedSession,
  readOwnedSession,
  signInOwnedPassword,
  signUpOwnedPassword,
  requestPasswordResetEmail,
} from "@/lib/supabase";
import { startAppOAuth } from "@/lib/auth/oauth";
import { isEmailAuthFlowsEnabled } from "@/lib/auth/config";
import { isQfLoginEnabled, isQfSyncEnabled } from "@/lib/quran-foundation/config";
import { connectQfFromSession } from "@/lib/quran-foundation/user";
import { captureQfRequestOwner } from "@/lib/quran-foundation/request-owner";
import { QF_OAUTH_PROVIDER } from "@/lib/quran-foundation/user-types";
import type { AuthState, AuthActions, Profile, AuthActionHandle, SignUpResult } from "@/lib/auth/types";
import { errorMessage } from "@/lib/error-message";
import { clearAuthHandoff } from "@/lib/auth/form-handoff";
import { clearAuthReturn } from "@/lib/auth/return-origin";
import { subscribeSyncCompleted, subscribeSyncQueued } from "@/lib/sync/events";

type AuthStore = AuthState & AuthActions;

let profileOwnerGeneration = 0;
let authInitialization: Promise<void> | undefined;
let cancelAuthListener: (() => void) | undefined;
let loadingOwner: object | null = null;

// Busy state belongs to the action that set it, independently of auth authority.
function beginAuthLoading(clearError = true) {
  const token = {};
  loadingOwner = token;
  useAuthStore.setState(clearError ? { isLoading: true, error: null } : { isLoading: true });
  return {
    isCurrent: () => loadingOwner === token,
    finish: () => {
      if (loadingOwner !== token) return;
      loadingOwner = null;
      useAuthStore.setState({ isLoading: false });
    },
  };
}

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

function beginProfileWrite(userId: string, owner: AuthOwner) {
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

/**
 * The profile shown while the real row cannot be read. It never derives a name from the email:
 * the username stays empty, so screens show the neutral "Hafiz user" until the real profile loads.
 * A display name the person chose at signup is kept. The next sync retries the read.
 */
export function buildFallbackProfile(user: NonNullable<AuthState["user"]>): Profile {
  const metadata = user.user_metadata ?? {};
  const displayName = typeof metadata.display_name === "string" ? metadata.display_name.trim() : "";
  return {
    id: user.id,
    username: "",
    display_name: displayName || null,
    avatar_url: null,
    bio: null,
    country: null,
    created_at: user.created_at,
    is_fallback: true,
  };
}

/** A valid username for a missing profile row: a provider handle or user_<id>, never the email. */
export function buildInsertUsername(user: NonNullable<AuthState["user"]>): string {
  const metadata = user.user_metadata ?? {};
  const providerName = metadata.username || metadata.preferred_username || metadata.user_name;
  const suffix = user.id.replace(/-/g, "").slice(0, 8);
  const sanitized =
    typeof providerName === "string" && !providerName.includes("@")
      ? providerName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "")
      : "";
  if (sanitized.length >= 3) return `${sanitized.slice(0, Math.max(3, 19 - suffix.length))}_${suffix}`.slice(0, 20);
  return `user_${suffix}`;
}

function connectQfSessionIfAvailable(session: AuthState["session"]): void {
  if (!isQfSyncEnabled()) return;
  if (!session?.provider_token) return;
  const owner = captureQfRequestOwner({
    getState: useAuthStore.getState,
    readSession: () => supabase.auth.getSession(),
    sourceSession: session,
  });
  if (!owner) return;
  connectQfFromSession(session, owner).catch(console.warn);
}

function buildProfileInsert(user: NonNullable<AuthState["user"]>) {
  const profile = buildFallbackProfile(user);
  return {
    id: profile.id,
    username: buildInsertUsername(user),
    display_name: profile.display_name,
  };
}

function getEmailRedirectTo(): string | undefined {
  if (Platform.OS !== "web") return undefined;
  return globalThis.location?.origin;
}

// Native has no recovery deep link, so its reset email opens the public web reset page,
// where the password is changed for the same account before the user signs in on the app.
const PUBLIC_WEB_ORIGIN = "https://hafizquran.app";

export function getPasswordResetRedirectTo(): string {
  return `${getEmailRedirectTo() ?? PUBLIC_WEB_ORIGIN}/auth/reset-password`;
}

function setSessionIdentity({ session, user }: Pick<AuthState, "session" | "user">, sessionEnded?: boolean): void {
  useAuthStore.setState((state) => ({
    session,
    user,
    profile: user && state.user?.id === user.id && state.profile?.id === user.id ? state.profile : null,
    // A new signed-in session clears an earlier "session ended" notice.
    sessionEnded: sessionEnded ?? (user ? false : state.sessionEnded),
  }));
}

// Sign-outs started on this device are deliberate, so their SIGNED_OUT is not reported as expiry.
let deliberateSignOuts = 0;
// Local sign-outs (signOut) clear the account before the SDK call; see the listener.
let localSignOuts = 0;

// SDK notifications can renew credentials while the provider response is pending.
// Keep the current matching session rather than republishing the callback snapshot.
function publishOAuthSession(session: NonNullable<AuthState["session"]>): void {
  const current = useAuthStore.getState();
  const before = getAuthSessionIdentity(current.session);
  const incoming = getAuthSessionIdentity(session);
  if (
    before.kind === "identified" &&
    incoming.kind === "identified" &&
    before.userId === incoming.userId &&
    before.sessionId === incoming.sessionId &&
    current.user?.id === current.session?.user.id
  )
    return;
  setSessionIdentity({ session, user: session.user });
}

function startEmailCommand<T>(
  request: (owner: AuthOwner, session: AuthState["session"]) => Promise<{ session: AuthState["session"]; value: T }>,
): AuthActionHandle<T> {
  const loading = beginAuthLoading();
  let owner: AuthOwner | undefined;
  type Outcome = { kind: "value"; value: T } | { kind: "obsolete" };
  const obsolete: Outcome = { kind: "obsolete" };
  const reservation = authCommands.reserveReplacement<Outcome>(async (isIntentCurrent, origin) => {
    try {
      const response = await request(origin, useAuthStore.getState().session);
      if (
        !isIntentCurrent() ||
        !(response.session ? canCompleteAuthRecovery(origin, response.session) : origin.isCurrent())
      )
        return obsolete;
      if (response.session) {
        publishOAuthSession(response.session);
        owner = authCommands.captureOwner();
        await useAuthStore.getState().ensureProfile(owner);
      }
      if (!owner?.isCurrent() || !isIntentCurrent()) return obsolete;
      return { kind: "value", value: response.value };
    } catch (error) {
      if (!owner?.isCurrent() || !isIntentCurrent()) return obsolete;
      if (loading.isCurrent()) useAuthStore.setState({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  });
  owner = reservation.owner;
  const result = reservation.result
    .then((result): AuthCommandResult<T> => {
      if (result.status !== "completed" || result.value.kind !== "value" || !owner?.isCurrent())
        return { status: "superseded" };
      return { status: "completed", value: result.value.value, owner };
    })
    .finally(loading.finish);
  return { isCurrent: () => owner?.isCurrent() ?? false, result };
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
      // Leaving a recovery session is deliberate; Login shows the saved-password notice instead.
      deliberateSignOuts += 1;
      try {
        const { error } = await signOutOwnedSession(owner, useAuthStore.getState().session);
        if (error) throw error;
      } finally {
        deliberateSignOuts -= 1;
      }
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
  sessionEnded: false,
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
        const loading = beginAuthLoading(false);
        try {
          // The singleton store owns its listener across root remounts.
          // A new initialization retires any queued callback from its old listener.
          cancelAuthListener?.();
          let active = true;
          let acceptsStartupSession = true;
          const {
            data: { subscription },
          } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!active) return;
            const duringStartup = acceptsStartupSession;
            if (_event === "INITIAL_SESSION") {
              if (!acceptsStartupSession || !canRestoreAuthSession(readOwner, session)) return;
              acceptsStartupSession = false;
            } else {
              acceptsStartupSession = false;
            }
            // The SDK publishes SIGNED_OUT when it removes a stored session it could not renew at
            // startup, or a signed-in session ends (renewal rejected, or another tab signed out).
            // Transient network failures keep the session and publish nothing. Sign-outs started on
            // this device, and a guest's own sign-up or sign-in commands, are not reported.
            // signOut already cleared the account, so a session the SDK renews before removing it
            // does not bring the account back.
            if (session && localSignOuts > 0) return;
            const ended = _event === "SIGNED_OUT" && deliberateSignOuts === 0 && (get().user !== null || duringStartup);
            setSessionIdentity({ session, user: session?.user ?? null }, _event === "SIGNED_OUT" ? ended : undefined);
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
          // A rejected refresh token confirms expiry; a retryable fetch error is only connectivity.
          if (error?.name === "AuthApiError" && !get().sessionEnded && !get().session) set({ sessionEnded: true });
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
          set({ isInitialized: true });
          loading.finish();
        }
      })
      .finally(() => {
        authInitialization = undefined;
      });
    return authInitialization;
  },

  signIn: (email: string, password: string) =>
    startEmailCommand<void>(async (owner, session) => {
      const { data, error } = await signInOwnedPassword(owner, session, {
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;
      return { session: data.session, value: undefined };
    }),

  signInWithQuranFoundation: async () => {
    if (!isQfLoginEnabled()) throw new Error("Quran Foundation sign-in is not enabled.");
    const loading = beginAuthLoading();
    const flow = startAppOAuth(QF_OAUTH_PROVIDER, "sign-in", get);
    try {
      const result = await flow.result;
      if (result.status === "completed" && result.owner.isCurrent() && result.value.session) {
        publishOAuthSession(result.value.session);
        await get().ensureProfile(result.owner);
      }
    } catch (error) {
      if (!flow.isCurrent()) return;
      if (loading.isCurrent()) set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      loading.finish();
    }
  },

  linkQuranFoundation: async () => {
    if (!isQfLoginEnabled()) throw new Error("Quran Foundation sign-in is not enabled.");
    const loading = beginAuthLoading();
    const flow = startAppOAuth(QF_OAUTH_PROVIDER, "link", get);
    try {
      const result = await flow.result;
      if (result.status === "completed" && result.owner.isCurrent() && result.value.session) {
        publishOAuthSession(result.value.session);
        await get().ensureProfile(result.owner);
      }
    } catch (error) {
      if (!flow.isCurrent()) return;
      if (loading.isCurrent()) set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      loading.finish();
    }
  },

  signUp: (email: string, password: string, username: string, displayName: string) =>
    startEmailCommand<SignUpResult>(async (owner, session) => {
      if (!isEmailAuthFlowsEnabled()) throw new Error("Signup is temporarily unavailable.");
      // Metadata feeds the existing SECURITY DEFINER profile trigger.
      const { data, error } = await signUpOwnedPassword(owner, session, {
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { username: username.trim(), display_name: displayName.trim() || null },
          emailRedirectTo: getEmailRedirectTo(),
        },
      });
      if (error) throw error;
      if (!data.user) throw new Error("Signup failed — no user returned");
      return {
        session: data.session,
        value: {
          status: data.session
            ? "signedIn"
            : data.user.identities?.length === 0
              ? "alreadyRegistered"
              : "needsEmailConfirmation",
        },
      };
    }),

  resendSignupConfirmation: async (email: string) => {
    if (!isEmailAuthFlowsEnabled()) throw new Error("Signup is temporarily unavailable.");
    const loading = beginAuthLoading();
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: getEmailRedirectTo() },
      });
      if (error) throw error;
    } catch (err) {
      set({ error: errorMessage(err) ?? null });
      throw err;
    } finally {
      loading.finish();
    }
  },

  sendPasswordReset: async (email: string) => {
    if (!isEmailAuthFlowsEnabled()) throw new Error("Password reset is temporarily unavailable.");
    const loading = beginAuthLoading();
    try {
      const { error } = await requestPasswordResetEmail(email.trim().toLowerCase(), getPasswordResetRedirectTo());
      if (error) throw error;
    } catch (err) {
      set({ error: errorMessage(err) ?? null });
      throw err;
    } finally {
      loading.finish();
    }
  },

  updatePassword: async (password, owner = authCommands.captureOwner()) => {
    return authCommands.owned(owner, async () => {
      if (owner.isCurrent()) set({ error: null });
      try {
        const { data, error } = await updateOwnedPassword(owner, get().session, password);
        if (error) throw error;
        if (owner.isCurrent()) set({ user: data.user });
      } catch (err) {
        if (owner.isCurrent()) set({ error: errorMessage(err) ?? null });
        throw err;
      }
    });
  },

  // Signed out on this device without waiting for the server: the account leaves every screen as the
  // queued sign-out starts, just before the SDK call, which holds the SDK's session lock, so a read
  // that follows waits for the session to be removed rather than sending the old token. With an idle
  // queue that is at once. A failure is only logged, as before. On a network error auth-js keeps the
  // stored session, so this device can still hold it afterwards.
  signOut: async () =>
    authCommands.transition(async () => {
      deliberateSignOuts += 1;
      localSignOuts += 1;
      set({ session: null, user: null, profile: null, error: null, sessionEnded: false });
      try {
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw error;
      } catch (err) {
        console.warn("[Auth] Sign out error:", errorMessage(err));
      } finally {
        deliberateSignOuts -= 1;
        localSignOuts -= 1;
        set({ session: null, user: null, profile: null, error: null, sessionEnded: false });
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
    } catch (err) {
      if (!isCurrentOwner()) return;
      console.warn("[Auth] Failed to fetch profile:", errorMessage(err));
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
      // Registered before ensureProfile, so neither its read nor any other replaces a profile the
      // screen already shows with this save's values (ProfileModalContent shows them at once).
      const write = beginProfileWrite(user.id, owner);
      try {
        await get().ensureProfile(owner);
        requireCurrent();
        const patch: Record<string, string | null> = {};
        if (displayName !== undefined) patch.display_name = displayName;
        if (avatarUrl !== undefined) patch.avatar_url = avatarUrl;
        if (bio !== undefined) patch.bio = bio;
        if (country !== undefined) patch.country = country;

        const profileAtWrite = get().profile;
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
      } catch (err) {
        if (isCurrent()) set({ error: errorMessage(err) ?? null });
        else owner.cancel();
        throw err;
      } finally {
        write.release();
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
    } catch (err) {
      if (!isCurrentOwner()) return null;
      console.warn("[Auth] Failed to ensure profile:", errorMessage(err));
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
  if (state.user?.id !== previous.user?.id) {
    // Typed auth form values belong to the identity they were typed for.
    clearAuthHandoff();
    // A sign-out or account switch abandons a pending return; a guest's first sign-in consumes it.
    if (previous.user) clearAuthReturn();
  }
});

// A fallback profile is replaced by the real row on the next sync, without a remount.
let fallbackRetry: Promise<unknown> | null = null;
function retryFallbackProfile(): void {
  const { user, profile } = useAuthStore.getState();
  if (!user || !profile?.is_fallback || profile.id !== user.id || fallbackRetry) return;
  fallbackRetry = useAuthStore
    .getState()
    .ensureProfile()
    .catch(() => null)
    .finally(() => {
      fallbackRetry = null;
    });
}
subscribeSyncCompleted(retryFallbackProfile);
subscribeSyncQueued(retryFallbackProfile);
