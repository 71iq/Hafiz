import { useCallback, useLayoutEffect, useRef } from "react";

type SubmissionScope = {
  active: boolean;
  pending: boolean;
  token: symbol | null;
};

type EmailSubmissionLease = {
  isCurrent: () => boolean;
  release: () => void;
};

export function useEmailSubmission() {
  const scopeRef = useRef<SubmissionScope | null>(null);

  useLayoutEffect(() => {
    const scope: SubmissionScope = { active: true, pending: false, token: null };
    scopeRef.current = scope;

    return () => {
      scope.active = false;
      scope.pending = false;
      scope.token = null;
      if (scopeRef.current === scope) scopeRef.current = null;
    };
  }, []);

  const acquire = useCallback((): EmailSubmissionLease | null => {
    const scope = scopeRef.current;
    if (!scope?.active || scope.pending) return null;

    const token = Symbol("email submission");
    scope.pending = true;
    scope.token = token;

    const isCurrent = () => scope.active && scope.pending && scope.token === token;
    return {
      isCurrent,
      release: () => {
        if (!isCurrent()) return;
        scope.pending = false;
        scope.token = null;
      },
    };
  }, []);

  return { acquire };
}
