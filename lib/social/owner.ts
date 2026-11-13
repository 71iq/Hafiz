import { authCommands } from "@/lib/auth/commands";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import { useAuthStore } from "@/lib/auth/store";
import { classifyRemoteError, publicApiKey, socialError, type SocialOwner, type SocialViewer } from "@/lib/social/remote";
import { supabase } from "@/lib/supabase";

export type { SocialOwner, SocialViewer } from "@/lib/social/remote";

export function captureSocialOwner(userId: string): SocialOwner | null {
  const { user, session } = useAuthStore.getState();
  const identity = getAuthSessionIdentity(session);
  if (user?.id !== userId || identity.kind !== "identified" || identity.userId !== userId.toLowerCase()) return null;
  const ticket = authCommands.captureOwner();
  const isCurrent = () => {
    const current = useAuthStore.getState();
    const currentIdentity = getAuthSessionIdentity(current.session);
    return (
      ticket.isCurrent() &&
      current.user?.id === userId &&
      currentIdentity.kind === "identified" &&
      currentIdentity.userId === identity.userId &&
      currentIdentity.sessionId === identity.sessionId
    );
  };
  if (!isCurrent()) return null;
  const requireCurrent = () => {
    if (!isCurrent()) throw socialError({ kind: "account_changed" });
  };
  return {
    userId,
    isCurrent,
    requireCurrent,
    accessToken: async () => {
      requireCurrent();
      const { data, error } = await supabase.auth.getSession();
      requireCurrent();
      if (error) throw socialError(classifyRemoteError(error));
      const returned = getAuthSessionIdentity(data.session);
      if (
        !data.session ||
        returned.kind !== "identified" ||
        returned.userId !== identity.userId ||
        returned.sessionId !== identity.sessionId
      ) {
        throw socialError({ kind: "account_changed" });
      }
      return data.session.access_token;
    },
  };
}

/** The owner for a request that must run as this signed-in account, or an "account_changed" failure. */
export function requireSocialOwner(userId: string): SocialOwner {
  const owner = captureSocialOwner(userId);
  if (!owner) throw socialError({ kind: "account_changed" });
  return owner;
}

/**
 * A signed-out viewer. Its requests send the public key, never a session the shared client may pick
 * up from a sign-in in the meantime, and their results are refused once anyone signs in or another
 * auth command runs, as an owner's are.
 */
export function captureSignedOutViewer(): SocialViewer | null {
  const { user, session } = useAuthStore.getState();
  if (user || session) return null;
  const ticket = authCommands.captureOwner();
  const isCurrent = () => {
    const current = useAuthStore.getState();
    return ticket.isCurrent() && !current.user && !current.session;
  };
  const requireCurrent = () => {
    if (!isCurrent()) throw socialError({ kind: "account_changed" });
  };
  return {
    isCurrent,
    requireCurrent,
    accessToken: async () => {
      requireCurrent();
      return publicApiKey();
    },
  };
}

/** The viewer for a request that must run signed out, or an "account_changed" failure. */
export function requireSignedOutViewer(): SocialViewer {
  const viewer = captureSignedOutViewer();
  if (!viewer) throw socialError({ kind: "account_changed" });
  return viewer;
}
