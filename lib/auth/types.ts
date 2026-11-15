import type { AuthOwner, AuthCommandResult } from "@/lib/auth/coordinator";
import type { Session, User } from "@supabase/supabase-js";

export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  country: string | null;
  created_at: string;
  /** Client-only: a neutral stand-in shown while the real profile row cannot be read. */
  is_fallback?: boolean;
};

export type SignUpResult = {
  status: "signedIn" | "needsEmailConfirmation" | "alreadyRegistered";
};

export type AuthActionHandle<T> = { isCurrent: () => boolean; result: Promise<AuthCommandResult<T>> };

export type AuthState = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  isInitialized: boolean;
  /** True only after a confirmed session end (rejected renewal or a sign-out elsewhere). */
  sessionEnded: boolean;
  error: string | null;
};

export type AuthActions = {
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => AuthActionHandle<void>;
  signInWithQuranFoundation: () => Promise<void>;
  linkQuranFoundation: () => Promise<void>;
  signUp: (email: string, password: string, username: string, displayName: string) => AuthActionHandle<SignUpResult>;
  signOut: () => Promise<void>;
  resendSignupConfirmation: (email: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string, owner?: AuthOwner) => Promise<AuthCommandResult<void>>;
  ensureProfile: (owner?: AuthOwner) => Promise<Profile | null>;
  fetchProfile: () => Promise<void>;
  updateProfile: (
    updates: {
      displayName?: string | null;
      avatarUrl?: string | null;
      bio?: string | null;
      country?: string | null;
    },
    owner?: AuthOwner,
  ) => Promise<AuthCommandResult<Profile>>;
  clearError: () => void;
};
