import type { Session } from "@supabase/supabase-js";
import type { AuthOwner } from "@/lib/auth/coordinator";
import { createAuthCoordinator } from "@/lib/auth/coordinator";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";

export const authCommands = createAuthCoordinator(null);

export function observeAuthSession(session: Session | null): void {
  const identity = getAuthSessionIdentity(session);
  // Unidentified sessions cannot dispatch account-bound commands.
  authCommands.observeIdentity(identity.kind === "identified" ? JSON.stringify(identity) : null);
}

export function canRestoreAuthSession(owner: AuthOwner, session: Session | null): boolean {
  const identity = getAuthSessionIdentity(session);
  return authCommands.canRestore(owner, identity.kind === "identified" ? JSON.stringify(identity) : null);
}

export function canCompleteAuthRecovery(owner: AuthOwner, session: Session | null): boolean {
  const identity = getAuthSessionIdentity(session);
  return authCommands.canCompleteRecovery(owner, identity.kind === "identified" ? JSON.stringify(identity) : null);
}
