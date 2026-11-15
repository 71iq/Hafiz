import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { DatabaseExecutor } from "@/lib/database/types";
import { getPendingSyncCount } from "@/lib/database/sync-queue";
import { formatNumber } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";

/** The pending-change line: the actual count, a checking state, or that it could not be checked. Never a guessed zero. */
export type PendingCountState = { kind: "checking" } | { kind: "known"; count: number } | { kind: "unknown" };

export function logoutConfirmMessage(pending: PendingCountState, s: UIStrings, language: "en" | "ar"): string {
  const pendingLine =
    pending.kind === "known"
      ? interpolate(s.logoutPendingCount, { count: formatNumber(pending.count, language) })
      : pending.kind === "unknown"
        ? s.logoutPendingUnknown
        : s.logoutPendingChecking;
  return `${s.logoutConfirmLocal}\n\n${pendingLine}`;
}

type Props = {
  visible: boolean;
  db: DatabaseExecutor;
  /** The signed-in account as the person knows it (email, else username). */
  accountName: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Log out confirmation. It names the account and reads the account sync queue each time it opens.
 * Sign-out keeps the existing cleanup policy: local study data stays on this device, and the copy does
 * not promise that pending changes are backed up.
 */
export function LogoutConfirmDialog({ visible, db, accountName, loading, onCancel, onConfirm }: Props) {
  const s = useStrings();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const [pending, setPending] = useState<PendingCountState>({ kind: "checking" });
  const request = useRef(0);

  useEffect(() => {
    const current = ++request.current;
    if (!visible) return;
    setPending({ kind: "checking" });
    getPendingSyncCount(db).then(
      (count) => {
        if (request.current === current) setPending({ kind: "known", count });
      },
      () => {
        if (request.current === current) setPending({ kind: "unknown" });
      },
    );
  }, [db, visible]);

  return (
    <ConfirmDialog
      visible={visible}
      title={interpolate(s.logoutConfirmAccount, { account: accountName })}
      message={logoutConfirmMessage(pending, s, uiLanguage)}
      cancelLabel={s.flashcardsCancel}
      confirmLabel={s.authLogout}
      destructive
      confirmLoading={loading}
      pendingLabel={s.sharedLoggingOut}
      isDark={isDark}
      isRTL={isRTL}
      onCancel={() => {
        if (!loading) onCancel();
      }}
      onConfirm={onConfirm}
    />
  );
}
