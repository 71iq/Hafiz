import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { authCommands } from "@/lib/auth/commands";
import { useAuthStore } from "@/lib/auth/store";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";

export type ReflectionMutationLease = { isCurrent: () => boolean; release: () => void };
function sessionKey(session: ReturnType<typeof useAuthStore.getState>["session"]) {
  const identity = getAuthSessionIdentity(session);
  return identity.kind === "identified" ? JSON.stringify(identity) : null;
}
type Scope = {
  key: string;
  viewerId: string | undefined;
  database: unknown;
  session: string | null;
  active: boolean;
  pending: Map<string, object>;
};

// Community writes and manual pages share admission, but each operation owns its busy state.
export function useReflectionMutationScope(key: string, viewerId?: string, database?: unknown) {
  const session = useAuthStore((state) => sessionKey(state.session));
  const committed = useRef<Scope | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  useLayoutEffect(() => {
    const scope: Scope = { key, viewerId, database, session, active: true, pending: new Map() };
    committed.current = scope;
    setPending(new Set());
    return () => {
      scope.active = false;
    };
  }, [key, viewerId, database, session]);
  const matches = useCallback(
    (scope: Scope | null): scope is Scope =>
      !!scope &&
      scope.active &&
      scope.key === key &&
      scope.viewerId === viewerId &&
      scope.database === database &&
      scope.session === session,
    [key, viewerId, database, session],
  );
  const begin = useCallback(
    (name: string): ReflectionMutationLease | null => {
      const scope = committed.current,
        state = useAuthStore.getState();
      if (
        !matches(scope) ||
        scope.pending.has(name) ||
        state.user?.id !== viewerId ||
        sessionKey(state.session) !== session
      )
        return null;
      const token = {},
        owner = authCommands.captureOwner();
      scope.pending.set(name, token);
      setPending(new Set(scope.pending.keys()));
      return {
        isCurrent: () =>
          committed.current === scope &&
          scope.active &&
          owner.isCurrent() &&
          useAuthStore.getState().user?.id === viewerId &&
          sessionKey(useAuthStore.getState().session) === session,
        release: () => {
          if (committed.current !== scope || !scope.active || scope.pending.get(name) !== token) return;
          scope.pending.delete(name);
          setPending(new Set(scope.pending.keys()));
        },
      };
    },
    [matches, viewerId, session],
  );
  const retire = useCallback(() => {
    const scope = committed.current;
    if (!matches(scope)) return false;
    scope.active = false;
    setPending(new Set());
    return true;
  }, [matches]);
  return { begin, pending, retire };
}
