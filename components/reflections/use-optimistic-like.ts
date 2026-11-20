import { useCallback, useLayoutEffect, useRef } from "react";
import { useAuthStore } from "@/lib/auth/store";
import { hapticLight } from "@/lib/haptics";
import { createLatestValueSender, type LatestValueSender } from "@/lib/reflections/latest-value";
import { clearLikeOverlay, getLikeOverlay, setLikeOverlay, useLikeOverlay } from "@/lib/reflections/pending";
import { captureViewerLease } from "./use-mutation-scope";

type LikeHandlers = {
  liked: boolean;
  send: (userId: string, liked: boolean) => Promise<unknown>;
  /** The server holds `liked` now; `delta` is its change from the like this screen was given. */
  onSettled: (liked: boolean, delta: -1 | 0 | 1) => void;
  /** A send failed. The server holds `liked`, the last choice it accepted. */
  onFailed: (liked: boolean, delta: -1 | 0 | 1) => void;
};
type Entry = {
  token: object;
  isCurrent: () => boolean;
  sender: LatestValueSender<boolean>;
  handlers: { current: LikeHandlers };
};

// One sender per account and target, shared by every card showing it, so the feed and an open post
// agree and a burst of taps survives the card that started it.
const senders = new Map<string, Entry>();

const deltaOf = (liked: boolean, from: boolean): -1 | 0 | 1 => (liked === from ? 0 : liked ? 1 : -1);

/**
 * A like that answers every tap at once and never locks: the heart and count change immediately, the
 * button stays pressable, and the server receives the latest choice one request at a time
 * (lib/reflections/latest-value.ts). After a failure the heart shows the last choice the server
 * accepted. The shown value is shared through lib/reflections/pending.ts until the list it came
 * from shows the same like.
 */
export function useOptimisticLike({
  kind,
  id,
  liked: listedLiked,
  count: listedCount,
  send,
  onSettled,
  onFailed,
}: {
  kind: "reflection" | "comment";
  id: string;
  /** The like and count from the list this control shows. */
  liked: boolean;
  count: number;
} & Omit<LikeHandlers, "liked">) {
  const user = useAuthStore((state) => state.user);
  const key = user ? `${user.id}:${kind}-like:${id}` : null;
  const overlay = useLikeOverlay(key);
  const active = overlay?.isCurrent() ? overlay : null;
  const liked = active?.liked ?? listedLiked;
  const count = Math.max(0, listedCount + (active ? deltaOf(active.liked, listedLiked) : 0));

  const handlers = useRef<LikeHandlers>({ liked: listedLiked, send, onSettled, onFailed });
  useLayoutEffect(() => {
    handlers.current = { liked: listedLiked, send, onSettled, onFailed };
  });
  // A settled choice gives way once the list shows it; one from another account or session goes.
  useLayoutEffect(() => {
    if (key && overlay && (!overlay.isCurrent() || (!overlay.busy && overlay.liked === listedLiked)))
      clearLikeOverlay(key, overlay.token);
  }, [key, overlay, listedLiked]);

  const toggle = useCallback(() => {
    if (!user || !key) return;
    // Read the live value, so two taps before a render still undo each other.
    const shownOverlay = getLikeOverlay(key);
    const shown = shownOverlay?.isCurrent() ? shownOverlay.liked : handlers.current.liked;
    let entry = senders.get(key);
    if (!entry || !entry.isCurrent()) {
      const isViewer = captureViewerLease(user.id);
      if (!isViewer) return;
      const token = {};
      const created: Entry = {
        token,
        isCurrent: () => isViewer() && senders.get(key) === created,
        handlers,
        sender: createLatestValueSender<boolean>({
          confirmed: shown,
          send: (value) => created.handlers.current.send(user.id, value).then(() => undefined),
          isCurrent: () => created.isCurrent(),
          onSettled: (confirmed) => {
            settle(confirmed);
            created.handlers.current.onSettled(confirmed, deltaOf(confirmed, created.handlers.current.liked));
          },
          onFailed: (confirmed, error) => {
            console.warn(`[Reflections] ${kind} like failed:`, error);
            settle(confirmed);
            created.handlers.current.onFailed(confirmed, deltaOf(confirmed, created.handlers.current.liked));
          },
        }),
      };
      const settle = (confirmed: boolean) => {
        if (senders.get(key) === created) senders.delete(key);
        // Shown until the list catches up; from now on only an account or session change retires it.
        setLikeOverlay(key, { token, liked: confirmed, busy: false, isCurrent: isViewer });
      };
      entry = created;
      senders.set(key, entry);
    }
    // The card that tapped last receives the outcome.
    entry.handlers = handlers;
    const desired = !shown;
    setLikeOverlay(key, { token: entry.token, liked: desired, busy: true, isCurrent: entry.isCurrent });
    hapticLight();
    entry.sender.want(desired);
  }, [user, key, kind]);

  return { liked, count, toggle };
}

/** Test hook: forget senders from earlier cases. */
export function resetLikeSendersForTests() {
  senders.clear();
}
