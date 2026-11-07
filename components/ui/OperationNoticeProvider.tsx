import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Toast } from "@/components/ui/Toast";

type Notice = { id: number; message: string };
type NoticeContextValue = {
  showNotice: (message: string) => void;
  registerOverlay: (id: string) => () => void;
  notice: Notice | null;
  ready: boolean;
  activeOverlay: string | null;
  dismiss: () => void;
};
const NoticeContext = createContext<NoticeContextValue | null>(null);

export function OperationNoticeProvider({ ready, children }: { ready: boolean; children: ReactNode }) {
  const sequence = useRef(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [overlays, setOverlays] = useState<string[]>([]);
  const showNotice = useCallback((message: string) => {
    setNotice({ id: ++sequence.current, message });
  }, []);
  const registerOverlay = useCallback((id: string) => {
    setOverlays((current) => [...current.filter((value) => value !== id), id]);
    return () => setOverlays((current) => current.filter((value) => value !== id));
  }, []);
  const id = notice?.id;
  const dismiss = useCallback(() => {
    setNotice((current) => (current?.id === id ? null : current));
  }, [id]);
  const activeOverlay = overlays.at(-1) ?? null;
  const value = useMemo(
    () => ({ showNotice, registerOverlay, notice, ready, activeOverlay, dismiss }),
    [showNotice, registerOverlay, notice, ready, activeOverlay, dismiss],
  );
  return (
    <NoticeContext.Provider value={value}>
      {children}
      {ready && notice && activeOverlay === null && (
        <Toast key={notice.id} message={notice.message} onDismiss={dismiss} announce />
      )}
    </NoticeContext.Provider>
  );
}

export function useOperationNotice(): (message: string) => void {
  const value = useContext(NoticeContext);
  if (!value) throw new Error("useOperationNotice requires OperationNoticeProvider");
  return value.showNotice;
}

/** Present above the clipped content in the existing modal window. */
export function OperationNoticeOverlay({ overlayId, open }: { overlayId: string; open: boolean }) {
  const value = useContext(NoticeContext);
  const registerOverlay = value?.registerOverlay;
  useEffect(() => {
    if (open) return registerOverlay?.(overlayId);
  }, [open, overlayId, registerOverlay]);
  if (!open || !value?.ready || !value.notice || value.activeOverlay !== overlayId) return null;
  return <Toast key={value.notice.id} message={value.notice.message} onDismiss={value.dismiss} announce />;
}
