import type { AuthClient } from "@supabase/supabase-js";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";

type RecoveryAuth = Pick<InstanceType<typeof AuthClient>, "setSession" | "updateUser" | "signOut">;

/**
 * The session from a password reset link, held by a memory-only client. It never becomes the app's
 * session, so a reset link someone else sent can change only that other account's password: it
 * cannot sign this browser in or receive its local progress.
 */
export type IsolatedRecovery = {
  /** The account the link belongs to, in lower case. */
  userId: string;
  updatePassword(password: string): Promise<void>;
  /** Ends every session of the account, as a completed reset always has. */
  finish(): Promise<void>;
  /** Ends this recovery session when the reset is abandoned. */
  discard(): void;
};

export async function openIsolatedRecovery(
  auth: RecoveryAuth,
  tokens: { access_token: string; refresh_token: string },
): Promise<IsolatedRecovery | null> {
  const { data, error } = await auth.setSession(tokens);
  if (error) throw error;
  const identity = getAuthSessionIdentity(data.session);
  if (identity.kind !== "identified") return null;
  let ended = false;
  return {
    userId: identity.userId,
    async updatePassword(password) {
      const { error: updateError } = await auth.updateUser({ password });
      if (updateError) throw updateError;
    },
    async finish() {
      ended = true;
      const { error: signOutError } = await auth.signOut();
      if (signOutError) throw signOutError;
    },
    discard() {
      if (ended) return;
      ended = true;
      void auth.signOut({ scope: "local" }).catch(() => undefined);
    },
  };
}
