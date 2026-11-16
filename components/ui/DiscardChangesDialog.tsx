import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";

export function normalizeEditableText(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n?/g, "\n").trim();
}

export function isEditableTextDirty(current: string | null | undefined, baseline: string | null | undefined) {
  return normalizeEditableText(current) !== normalizeEditableText(baseline);
}

export type DiscardGuard = {
  guard: (proceed: () => void) => void;
  confirming: boolean;
  dialogProps: { visible: boolean; onKeepEditing: () => void; onDiscard: () => void };
};

export function useDiscardGuard(isDirty: boolean, onDiscard?: () => void): DiscardGuard {
  const pending = useRef<(() => void) | null>(null);
  const [confirming, setConfirming] = useState(false);
  const dirty = useRef(isDirty);
  dirty.current = isDirty;
  const discardRef = useRef(onDiscard);
  discardRef.current = onDiscard;

  const guard = useCallback((proceed: () => void) => {
    if (!dirty.current) {
      proceed();
      return;
    }
    pending.current = proceed;
    setConfirming(true);
  }, []);

  const keepEditing = useCallback(() => {
    pending.current = null;
    setConfirming(false);
  }, []);

  const discard = useCallback(() => {
    const proceed = pending.current;
    pending.current = null;
    setConfirming(false);
    discardRef.current?.();
    proceed?.();
  }, []);

  return { guard, confirming, dialogProps: { visible: confirming, onKeepEditing: keepEditing, onDiscard: discard } };
}

export function DiscardChangesDialog({
  visible,
  onKeepEditing,
  onDiscard,
  title,
}: {
  visible: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
  title?: string;
}) {
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  return (
    <ConfirmDialog
      visible={visible}
      title={title ?? s.discardChangesTitle}
      message={s.discardChangesMessage}
      cancelLabel={s.discardChangesKeepEditing}
      confirmLabel={s.discardChangesConfirm}
      destructive
      emphasis="cancel"
      isDark={isDark}
      isRTL={isRTL}
      onCancel={onKeepEditing}
      onConfirm={onDiscard}
    />
  );
}
