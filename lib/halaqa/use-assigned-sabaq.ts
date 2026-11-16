import { useEffect, useRef, useState } from "react";
import type { DatabaseExecutor } from "@/lib/database/types";
import { loadMySabaqAssignment, subscribeSabaqAssignmentChanges } from "@/lib/halaqa/sabaq-assignment";
import { assignedSabaqOpen, type AssignedSabaq } from "@/lib/hifz/sabaq";
import { useIsOffline } from "@/lib/social/use-social-query";

const FRESH_MS = 60_000;

export function useAssignedSabaq(
  db: DatabaseExecutor,
  userId: string | null,
  refreshKey: unknown,
): AssignedSabaq | null {
  const offline = useIsOffline();
  const fetched = useRef<{ userId: string | null; offline: boolean; at: number; value: AssignedSabaq | null } | null>(
    null,
  );
  const [changes, setChanges] = useState(0);
  const revision = useRef(0);
  const [open, setOpen] = useState<{ userId: string | null; value: AssignedSabaq | null }>({
    userId: null,
    value: null,
  });
  useEffect(
    () =>
      subscribeSabaqAssignmentChanges(() => {
        revision.current += 1;
        fetched.current = null;
        setOpen((shown) => ({ ...shown, value: null }));
        setChanges((count) => count + 1);
      }),
    [],
  );
  useEffect(() => {
    let cancelled = false;
    const startedAt = revision.current;
    const outdated = () => cancelled || revision.current !== startedAt;
    void (async () => {
      const last = fetched.current;
      const fresh =
        last !== null && last.userId === userId && (!last.offline || offline) && Date.now() - last.at < FRESH_MS;
      let assignment = fresh ? last.value : null;
      if (!fresh) {
        assignment = await loadMySabaqAssignment(userId, offline);
        if (outdated()) return;
        fetched.current = { userId, offline, at: Date.now(), value: assignment };
      }
      const isOpen = assignment ? await assignedSabaqOpen(db, assignment).catch(() => false) : false;
      if (!outdated()) setOpen({ userId, value: isOpen ? assignment : null });
    })();
    return () => {
      cancelled = true;
    };
  }, [db, userId, offline, refreshKey, changes]);
  return open.userId === userId ? open.value : null;
}
