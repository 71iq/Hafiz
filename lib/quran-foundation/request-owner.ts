import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { authCommands } from "@/lib/auth/commands";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import type { QfRequestOwner } from "./user";

export type QfSessionOwner = QfRequestOwner & { isCurrent: () => boolean };

type Options = Readonly<{
  getState: () => { user: Pick<Session["user"], "id"> | null; session: Session | null };
  readSession: SupabaseClient["auth"]["getSession"];
  sourceSession?: Session | null;
}>;

export function captureQfRequestOwner({ getState, readSession, sourceSession }: Options): QfSessionOwner | null {
  const auth = getState();
  const source = sourceSession === undefined ? auth.session : sourceSession;
  const identity = getAuthSessionIdentity(source);
  if (!auth.user || identity.kind !== "identified" || identity.userId !== auth.user.id.toLowerCase()) return null;
  const ticket = authCommands.captureOwner();
  const isCurrent = () => {
    const current = getState();
    const currentIdentity = getAuthSessionIdentity(current.session);
    return (
      ticket.isCurrent() &&
      current.user?.id.toLowerCase() === identity.userId &&
      currentIdentity.kind === "identified" &&
      currentIdentity.userId === identity.userId &&
      currentIdentity.sessionId === identity.sessionId
    );
  };
  if (!isCurrent()) return null;
  const requireCurrent = () => {
    if (!isCurrent()) throw new Error("Quran Foundation sync account changed");
  };
  return {
    isCurrent,
    requireCurrent,
    getAccessToken: async () => {
      requireCurrent();
      // Preserve normal SDK renewal while refusing credentials from another session.
      const { data, error } = await readSession();
      requireCurrent();
      if (error) throw error;
      const session = data.session;
      const returned = getAuthSessionIdentity(session);
      if (
        !session ||
        returned.kind !== "identified" ||
        returned.userId !== identity.userId ||
        returned.sessionId !== identity.sessionId
      )
        throw new Error("Quran Foundation sync session changed");
      return session.access_token;
    },
  };
}
