import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Toast } from "@/components/ui/Toast";

export type InlineNoticeAttempt = {
  report: (message: string) => "inline" | "retained" | "discarded";
  isCurrent: () => boolean;
  finish: () => void;
  retire: (reason?: "normal") => void;
};

type Notice = { id: number; message: string };
type NoticeContextValue = {
  createInlineAttempt: () => InlineNoticeAttempt;
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
  const owner = useRef({ alive: false, ready });
  useLayoutEffect(() => {
    const current = owner.current;
    current.alive = true;
    return () => {
      current.alive = false;
    };
  }, []);
  useLayoutEffect(() => {
    owner.current.ready = ready;
  }, [ready]);
  const createInlineAttempt = useCallback((): InlineNoticeAttempt => {
    let mode: "active" | "recovery" | "discarded" | "finished" = "active";
    let message: string | null = null;
    let promoted = false;
    const promote = () => {
      if (mode === "recovery" && owner.current.alive && message !== null && !promoted) {
        promoted = true;
        showNotice(message);
      }
    };
    return {
      report(value) {
        if (!owner.current.alive || mode === "discarded" || mode === "finished") return "discarded";
        if (mode === "active" && !owner.current.ready) mode = "recovery";
        message = value;
        promote();
        return mode === "active" ? "inline" : "retained";
      },
      isCurrent: () => mode === "active" && owner.current.alive && owner.current.ready,
      finish() {
        mode = "finished";
        message = null;
      },
      retire(reason) {
        if (reason === "normal") {
          mode = "discarded";
          message = null;
          return;
        }
        if (mode !== "active") return;
        mode = owner.current.alive && !owner.current.ready ? "recovery" : "discarded";
        promote();
      },
    };
  }, [showNotice]);
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
    () => ({ showNotice, createInlineAttempt, registerOverlay, notice, ready, activeOverlay, dismiss }),
    [showNotice, createInlineAttempt, registerOverlay, notice, ready, activeOverlay, dismiss],
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

export function useInlineOperationNotice(): () => InlineNoticeAttempt {
  const value = useContext(NoticeContext);
  if (!value) throw new Error("useInlineOperationNotice requires OperationNoticeProvider");
  return value.createInlineAttempt;
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
