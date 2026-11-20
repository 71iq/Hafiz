import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOptionalOperationNotice } from "@/components/ui/OperationNoticeProvider";
import { recordAchievementEvent } from "@/lib/achievements/queries";
import { useAuthStore } from "@/lib/auth/store";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { createId } from "@/lib/id";
import { findJuzForAyah, loadMushafIndex } from "@/lib/mushaf/position";
import { profilePrivacyKeys } from "@/lib/profile/privacy";
import {
  addComment,
  createReflection,
  deleteReflection,
  deleteReflectionComment,
  reportReflection,
} from "@/lib/reflections/api";
import {
  markCommentCountStale,
  refreshReflectionQueries,
  removeDeletedComment,
  removeDeletedReflection,
} from "@/lib/reflections/cache";
import { ReflectionPrivacyChangedError } from "@/lib/reflections/errors";
import {
  addPendingComment,
  addPendingPost,
  isHidden,
  isReported,
  offerRecoveredDraft,
  pendingId,
  pendingKeys,
  replacePendingComment,
  replacePendingPost,
  setHidden,
  setReported,
  useIsReported,
} from "@/lib/reflections/pending";
import { reflectionQueryKeys } from "@/lib/reflections/query-keys";
import { SavedRowUnreadableError } from "@/lib/reflections/rows";
import type { Reflection, ReflectionComment } from "@/lib/reflections/types";
import { captureViewerLease } from "./use-mutation-scope";

/** The author line a new post or comment shows before the server returns its own. */
function ownAuthor(viewerId: string): Reflection["profiles"] {
  const profile = useAuthStore.getState().profile;
  return profile?.id === viewerId
    ? { username: profile.username, display_name: profile.display_name, avatar_url: profile.avatar_url }
    : undefined;
}

/**
 * Posts a comment at once: it shows in the sheet, `onAdded` raises the count, and the input is the
 * caller's to clear. When the server returns the comment it replaces the shown one and `onSaved`
 * runs. A failure removes it, `onRemoved` lowers the count again, and the draft goes back to the open
 * input for this reflection, or waits for it with a notice (lib/reflections/pending.ts).
 * `promisedPrivate` is what the input told the author (ETH-07); the server refuses a stale promise.
 */
export function usePostComment({
  onAdded,
  onRemoved,
  onSaved,
}: {
  onAdded: (reflectionId: string) => void;
  onRemoved: (reflectionId: string) => void;
  onSaved: (reflectionId: string) => void;
}) {
  const s = useStrings();
  const queryClient = useQueryClient();
  const notice = useOptionalOperationNotice();
  return useCallback(
    ({
      viewerId,
      reflectionId,
      draft,
      promisedPrivate,
    }: {
      viewerId: string;
      reflectionId: string;
      draft: string;
      promisedPrivate: boolean;
    }): boolean => {
      const content = draft.trim();
      const isCurrent = captureViewerLease(viewerId);
      if (!content || !isCurrent) return false;
      const token = {},
        now = new Date().toISOString();
      addPendingComment({
        token,
        viewerId,
        status: "sending",
        comment: {
          id: pendingId(createId("comment")),
          reflection_id: reflectionId,
          user_id: viewerId,
          content,
          likes_count: 0,
          user_has_liked: false,
          created_at: now,
          profiles: ownAuthor(viewerId),
        },
      });
      onAdded(reflectionId);
      const refreshComments = () =>
        void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.comments.forReflection(reflectionId) });
      addComment(viewerId, reflectionId, content, promisedPrivate).then(
        (saved) => {
          replacePendingComment(token, isCurrent() ? { token, viewerId, status: "saved", comment: saved } : null);
          if (!isCurrent()) return;
          refreshComments();
          onSaved(reflectionId);
        },
        (error: unknown) => {
          replacePendingComment(token, null);
          const privacyChanged = error instanceof ReflectionPrivacyChangedError;
          // The account is no longer a minor on the server: reload its privacy so the note goes away,
          // and post nothing until the person sends again.
          if (privacyChanged) void queryClient.invalidateQueries({ queryKey: profilePrivacyKeys.mine(viewerId) });
          if (!isCurrent()) return;
          // Posted, but the reply could not be read: the refetch shows it instead of a duplicate retry.
          if (error instanceof SavedRowUnreadableError) {
            refreshComments();
            onSaved(reflectionId);
            return;
          }
          console.warn("[Comments] Failed to add:", error);
          onRemoved(reflectionId);
          const failure = privacyChanged ? "privacy" : "post";
          if (!offerRecoveredDraft(pendingKeys.commentDraft(viewerId, reflectionId), { content: draft, failure }))
            notice(privacyChanged ? s.commentPrivacyChanged : s.commentPostFailedDraftKept);
        },
      );
      return true;
    },
    [onAdded, onRemoved, onSaved, queryClient, notice, s.commentPrivacyChanged, s.commentPostFailedDraftKept],
  );
}

/**
 * Publishes a reflection at once: it shows at the top of its ayah and of the feed, with a "posted"
 * notice, while the request runs. When the server returns it, the saved row replaces the shown one and
 * the lists refetch. A failure removes it and returns the draft to the composer for this ayah range,
 * or keeps it for the next time the composer opens, with a notice. `promisedPrivate` works as in
 * usePostComment.
 */
export function usePostReflection() {
  const s = useStrings();
  const db = useDatabase();
  const queryClient = useQueryClient();
  const notice = useOptionalOperationNotice();
  return useCallback(
    ({
      viewerId,
      surah,
      ayahStart,
      ayahEnd,
      draft,
      promisedPrivate,
    }: {
      viewerId: string;
      surah: number;
      ayahStart: number;
      ayahEnd: number;
      draft: string;
      promisedPrivate: boolean;
    }): boolean => {
      const content = draft.trim();
      const isCurrent = captureViewerLease(viewerId);
      if (!content || !isCurrent) return false;
      const token = {},
        now = new Date().toISOString();
      addPendingPost({
        token,
        viewerId,
        status: "sending",
        reflection: {
          id: pendingId(createId("reflection")),
          user_id: viewerId,
          surah,
          ayah_start: ayahStart,
          ayah_end: ayahEnd,
          juz_start: null,
          juz_end: null,
          content,
          likes_count: 0,
          comments_count: 0,
          status: "active",
          created_at: now,
          updated_at: now,
          profiles: ownAuthor(viewerId),
          user_has_liked: false,
        },
      });
      notice(s.reflectionPosted);
      const refreshLists = () => {
        for (let ayah = ayahStart; ayah <= ayahEnd; ayah++) {
          void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.reflections.ayah({ surah, ayah }) });
          void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.countAyah({ surah, ayah }) });
        }
        void queryClient.invalidateQueries({ queryKey: reflectionQueryKeys.feed.all });
      };
      void (async () => {
        try {
          const mushafIndex = await loadMushafIndex(db);
          // Another account took over while the index loaded: nothing is sent for this one.
          if (!isCurrent()) {
            replacePendingPost(token, null);
            return;
          }
          const juzStart = findJuzForAyah(mushafIndex, surah, ayahStart);
          const juzEnd = findJuzForAyah(mushafIndex, surah, ayahEnd);
          const saved = await createReflection(
            viewerId,
            surah,
            ayahStart,
            ayahEnd,
            Math.min(juzStart, juzEnd),
            Math.max(juzStart, juzEnd),
            content,
            promisedPrivate,
            isCurrent,
          );
          replacePendingPost(token, isCurrent() ? { token, viewerId, status: "saved", reflection: saved } : null);
          if (!isCurrent()) return;
          recordAchievementEvent(db, {
            type: "public_reflection_created",
            reflectionId: saved.id,
            surah,
            ayahStart,
            ayahEnd,
            createdAt: saved.created_at,
          }).catch(console.warn);
          refreshLists();
        } catch (error) {
          replacePendingPost(token, null);
          const privacyChanged = error instanceof ReflectionPrivacyChangedError;
          // The account is no longer a minor on the server: reload its privacy so the composer stops
          // promising privacy, and post nothing until the person submits again.
          if (privacyChanged) void queryClient.invalidateQueries({ queryKey: profilePrivacyKeys.mine(viewerId) });
          if (!isCurrent()) return;
          // Posted, but the reply could not be read: refresh instead of offering a duplicate retry.
          if (error instanceof SavedRowUnreadableError) {
            refreshLists();
            return;
          }
          // Server details stay in the log; the person sees a plain message.
          console.warn("[WriteReflection] Failed to post:", error);
          const failure = privacyChanged ? "privacy" : "post";
          const key = pendingKeys.reflectionDraft(viewerId, { surah, ayahStart, ayahEnd });
          if (!offerRecoveredDraft(key, { content: draft, failure }))
            notice(privacyChanged ? s.reflectionPrivacyChanged : s.reflectionPostFailedDraftKept);
        }
      })();
      return true;
    },
    [db, queryClient, notice, s.reflectionPosted, s.reflectionPrivacyChanged, s.reflectionPostFailedDraftKept],
  );
}

/**
 * Report and delete confirm once and then act at once: the dialog closes, the screen shows the result
 * and a notice says so, while the request runs. A failure takes the change back and says so in a
 * notice, which also reaches the person after the card or sheet is gone. A completion after the
 * account or session changed only tidies its own pending entry.
 */
export type ConfirmAction = {
  open: boolean;
  request: () => void;
  cancel: () => void;
  confirm: () => void;
};

/**
 * Report a reflection through the existing reporting flow after a confirmation. It shows as Reported
 * at once, so a second report is never sent; a failure clears that and asks the person to try again.
 * In memory only: the reports table stays the record, and nothing is hidden automatically.
 */
export function useReportReflection(reflection: Reflection | null | undefined): ConfirmAction & { reported: boolean } {
  const s = useStrings();
  const user = useAuthStore((state) => state.user);
  const notice = useOptionalOperationNotice();
  const key = user && reflection ? pendingKeys.reflection(user.id, reflection.id) : null;
  const reported = useIsReported(key);
  const [open, setOpen] = useState(false);
  // A different reflection or account starts closed.
  const [owner, setOwner] = useState(key);
  if (owner !== key) {
    setOwner(key);
    setOpen(false);
  }

  const confirm = useCallback(() => {
    if (!user || !reflection || !key || isReported(key)) return;
    const isCurrent = captureViewerLease(user.id);
    if (!isCurrent) return;
    setReported(key, true);
    setOpen(false);
    notice(s.reflectionReportSent);
    reportReflection(user.id, reflection.id).catch((failure: unknown) => {
      console.warn("[Reflections] Report failed:", failure);
      setReported(key, false);
      if (isCurrent()) notice(s.reflectionReportFailed);
    });
  }, [user, reflection, key, notice, s.reflectionReportSent, s.reflectionReportFailed]);

  return {
    reported,
    open,
    request: () => {
      if (!user || reported) return;
      setOpen(true);
    },
    cancel: () => setOpen(false),
    confirm,
  };
}

/**
 * Delete the signed-in author's reflection through delete_reflection. It leaves every list at once and
 * `onGone` runs so a detail view can close. `true` then removes it from the caches; `false` means it
 * was already gone or not this account's, so the lists refresh. A failure brings it back, refreshes
 * the lists that dropped it, and says it could not be deleted.
 */
export function useDeleteReflection(reflection: Reflection, onGone?: (reflection: Reflection) => void): ConfirmAction {
  const s = useStrings();
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const notice = useOptionalOperationNotice();
  const [open, setOpen] = useState(false);
  const owner = `${user?.id ?? ""}:${reflection.id}`;
  const [shownFor, setShownFor] = useState(owner);
  if (shownFor !== owner) {
    setShownFor(owner);
    setOpen(false);
  }
  const isOwn = !!user && reflection.user_id === user.id;

  const confirm = useCallback(() => {
    if (!user || reflection.user_id !== user.id) return;
    const key = pendingKeys.reflection(user.id, reflection.id);
    if (isHidden(key)) return;
    const isCurrent = captureViewerLease(user.id);
    if (!isCurrent) return;
    setHidden(key, true);
    setOpen(false);
    notice(s.reflectionDeleted);
    onGone?.(reflection);
    deleteReflection(user.id, reflection.id).then(
      (deleted) => {
        // Gone either way, so it stays hidden; only the current account's caches change.
        if (!isCurrent()) return;
        if (deleted) removeDeletedReflection(queryClient, reflection);
        else refreshReflectionQueries(queryClient, reflection);
      },
      (failure: unknown) => {
        console.warn("[Reflections] Delete failed:", failure);
        setHidden(key, false);
        if (!isCurrent()) return;
        refreshReflectionQueries(queryClient, reflection);
        notice(s.reflectionDeleteFailed);
      },
    );
  }, [user, reflection, queryClient, notice, onGone, s.reflectionDeleted, s.reflectionDeleteFailed]);

  return {
    open,
    request: () => {
      if (isOwn) setOpen(true);
    },
    cancel: () => setOpen(false),
    confirm,
  };
}

/**
 * Delete one of the signed-in author's comments through delete_reflection_comment. It leaves the list
 * at once and `onRemoved` lowers the count shown; `onDeleted` runs once the server confirmed it. A
 * failure brings it back, `onRestored` raises the count again, and a notice says it could not be
 * deleted.
 */
export function useDeleteComment(
  reflectionId: string | null,
  {
    onRemoved,
    onRestored,
    onDeleted,
  }: {
    onRemoved: (comment: ReflectionComment) => void;
    onRestored: (comment: ReflectionComment) => void;
    onDeleted?: (comment: ReflectionComment) => void;
  },
): Omit<ConfirmAction, "request"> & {
  target: ReflectionComment | null;
  request: (comment: ReflectionComment) => void;
} {
  const s = useStrings();
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const notice = useOptionalOperationNotice();
  const [target, setTarget] = useState<ReflectionComment | null>(null);
  const owner = `${user?.id ?? ""}:${reflectionId ?? ""}`;
  const [shownFor, setShownFor] = useState(owner);
  if (shownFor !== owner) {
    setShownFor(owner);
    setTarget(null);
  }

  const confirm = useCallback(() => {
    const comment = target;
    if (!user || !comment || comment.user_id !== user.id) return;
    const key = pendingKeys.comment(user.id, comment.id);
    if (isHidden(key)) return;
    const isCurrent = captureViewerLease(user.id);
    if (!isCurrent) return;
    setHidden(key, true);
    setTarget(null);
    notice(s.commentDeleted);
    onRemoved(comment);
    deleteReflectionComment(user.id, comment.id).then(
      (deleted) => {
        if (!isCurrent()) return;
        if (deleted) {
          removeDeletedComment(queryClient, comment);
          onDeleted?.(comment);
        } else markCommentCountStale(queryClient, comment.reflection_id);
      },
      (failure: unknown) => {
        console.warn("[Comments] Delete failed:", failure);
        setHidden(key, false);
        if (!isCurrent()) return;
        onRestored(comment);
        notice(s.commentDeleteFailed);
      },
    );
  }, [target, user, queryClient, notice, onRemoved, onRestored, onDeleted, s.commentDeleted, s.commentDeleteFailed]);

  return {
    target,
    open: target !== null,
    request: (comment) => {
      if (!user || comment.user_id !== user.id) return;
      setTarget(comment);
    },
    cancel: () => setTarget(null),
    confirm,
  };
}
