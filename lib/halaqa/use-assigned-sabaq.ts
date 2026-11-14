import { useEffect, useRef, useState } from "react";
import type { DatabaseExecutor } from "@/lib/database/types";
import { loadMySabaqAssignment, subscribeSabaqAssignmentChanges } from "@/lib/halaqa/sabaq-assignment";
import { assignedSabaqOpen, type AssignedSabaq } from "@/lib/hifz/sabaq";
import { useIsOffline } from "@/lib/social/use-social-query";

/** How long Home keeps an answer before it asks the server again. */
const FRESH_MS = 60_000;

/**
 * SOC-03: the signed-in member's next sabaq from a teacher while its lines still wait to be memorized,
 * for Home. Offline it is the saved copy (loadMySabaqAssignment), which also never fails. `refreshKey`
 * is anything that changes when memorized lines may have changed, such as today's wird: each change
 * checks the lines again, and asks the server again once the last answer is a minute old or was read
 * offline. Withdrawn sharing or leaving a halaqa on this device reads it again at once
 * (forgetMySabaqAssignment). What it shows belongs to one account, so another account never sees it,
 * even while its own read is still loading.
 */
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
  const [open, setOpen] = useState<{ userId: string | null; value: AssignedSabaq | null }>({
    userId: null,
    value: null,
  });
  useEffect(
    () =>
      subscribeSabaqAssignmentChanges(() => {
        fetched.current = null;
        setChanges((count) => count + 1);
      }),
    [],
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const last = fetched.current;
      const fresh =
        last !== null && last.userId === userId && (!last.offline || offline) && Date.now() - last.at < FRESH_MS;
      let assignment = fresh ? last.value : null;
      if (!fresh) {
        assignment = await loadMySabaqAssignment(userId, offline);
        if (cancelled) return;
        fetched.current = { userId, offline, at: Date.now(), value: assignment };
      }
      const isOpen = assignment ? await assignedSabaqOpen(db, assignment).catch(() => false) : false;
      if (!cancelled) setOpen({ userId, value: isOpen ? assignment : null });
    })();
    return () => {
      cancelled = true;
    };
  }, [db, userId, offline, refreshKey, changes]);
  return open.userId === userId ? open.value : null;
}
