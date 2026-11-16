import { useCallback, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOptionalOperationNotice } from "@/components/ui/OperationNoticeProvider";
import { useAuthStore } from "@/lib/auth/store";
import { useStrings } from "@/lib/i18n/useStrings";
import { deleteReflection, deleteReflectionComment, reportReflection } from "@/lib/reflections/api";
import {
  markCommentCountStale,
  refreshReflectionQueries,
  removeDeletedComment,
  removeDeletedReflection,
} from "@/lib/reflections/cache";
import type { Reflection, ReflectionComment } from "@/lib/reflections/types";
import { useReflectionMutationScope } from "./use-mutation-scope";

const sentReports = new Set<string>();
const reportListeners = new Set<() => void>();
const reportKey = (viewerId: string | undefined, reflectionId: string | undefined) =>
  viewerId && reflectionId ? `${viewerId}:${reflectionId}` : null;
function subscribeReports(listener: () => void) {
  reportListeners.add(listener);
  return () => reportListeners.delete(listener);
}
function recordReport(key: string) {
  sentReports.add(key);
  reportListeners.forEach((listener) => listener());
}
export function resetSentReportsForTests() {
  sentReports.clear();
}

export type ConfirmAction = {
  open: boolean;
  pending: boolean;
  error: string | null;
  request: () => void;
  cancel: () => void;
  confirm: () => Promise<void>;
};

export function useReportReflection(reflection: Reflection | null | undefined): ConfirmAction & { reported: boolean } {
  const s = useStrings();
  const user = useAuthStore((state) => state.user);
  const notice = useOptionalOperationNotice();
  const key = reportKey(user?.id, reflection?.id);
  const { begin, pending } = useReflectionMutationScope(`report:${reflection?.id ?? ""}`, user?.id);
  const reported = useSyncExternalStore(
    subscribeReports,
    () => (key ? sentReports.has(key) : false),
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState(key);
  if (owner !== key) {
    setOwner(key);
    setOpen(false);
    setError(null);
  }

  const confirm = useCallback(async () => {
    if (!user || !reflection || !key || sentReports.has(key)) return;
    const lease = begin("report");
    if (!lease) return;
    setError(null);
    try {
      await reportReflection(user.id, reflection.id);
      if (!lease.isCurrent()) return;
      recordReport(key);
      setOpen(false);
      notice(s.reflectionReportSent);
    } catch (failure) {
      if (!lease.isCurrent()) return;
      console.warn("[Reflections] Report failed:", failure);
      setError(s.reflectionReportFailed);
    } finally {
      lease.release();
    }
  }, [user, reflection, key, begin, notice, s.reflectionReportSent, s.reflectionReportFailed]);

  return {
    reported,
    open,
    pending: pending.has("report"),
    error,
    request: () => {
      if (!user || reported) return;
      setError(null);
      setOpen(true);
    },
    cancel: () => {
      if (pending.has("report")) return;
      setOpen(false);
      setError(null);
    },
    confirm,
  };
}

export function useDeleteReflection(reflection: Reflection, onGone?: (reflection: Reflection) => void): ConfirmAction {
  const s = useStrings();
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const notice = useOptionalOperationNotice();
  const { begin, pending } = useReflectionMutationScope(`delete:${reflection.id}`, user?.id);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = `${user?.id ?? ""}:${reflection.id}`;
  const [shownFor, setShownFor] = useState(owner);
  if (shownFor !== owner) {
    setShownFor(owner);
    setOpen(false);
    setError(null);
  }
  const isOwn = !!user && reflection.user_id === user.id;

  const confirm = useCallback(async () => {
    if (!user || reflection.user_id !== user.id) return;
    const lease = begin("delete");
    if (!lease) return;
    setError(null);
    try {
      const deleted = await deleteReflection(user.id, reflection.id);
      if (!lease.isCurrent()) return;
      setOpen(false);
      if (deleted) {
        removeDeletedReflection(queryClient, reflection);
        notice(s.reflectionDeleted);
      } else {
        refreshReflectionQueries(queryClient, reflection);
        notice(s.reflectionUnavailable);
      }
      onGone?.(reflection);
    } catch (failure) {
      if (!lease.isCurrent()) return;
      console.warn("[Reflections] Delete failed:", failure);
      setError(s.reflectionDeleteFailed);
    } finally {
      lease.release();
    }
  }, [
    user,
    reflection,
    begin,
    queryClient,
    notice,
    onGone,
    s.reflectionDeleted,
    s.reflectionUnavailable,
    s.reflectionDeleteFailed,
  ]);

  return {
    open,
    pending: pending.has("delete"),
    error,
    request: () => {
      if (!isOwn) return;
      setError(null);
      setOpen(true);
    },
    cancel: () => {
      if (pending.has("delete")) return;
      setOpen(false);
      setError(null);
    },
    confirm,
  };
}

export function useDeleteComment(
  reflectionId: string | null,
  onRemoved: (comment: ReflectionComment, deleted: boolean) => void,
): Omit<ConfirmAction, "request"> & {
  target: ReflectionComment | null;
  request: (comment: ReflectionComment) => void;
} {
  const s = useStrings();
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const notice = useOptionalOperationNotice();
  const { begin, pending } = useReflectionMutationScope(`comment-delete:${reflectionId ?? ""}`, user?.id);
  const [target, setTarget] = useState<ReflectionComment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owner = `${user?.id ?? ""}:${reflectionId ?? ""}`;
  const [shownFor, setShownFor] = useState(owner);
  if (shownFor !== owner) {
    setShownFor(owner);
    setTarget(null);
    setError(null);
  }

  const confirm = useCallback(async () => {
    const comment = target;
    if (!user || !comment || comment.user_id !== user.id) return;
    const lease = begin("delete");
    if (!lease) return;
    setError(null);
    try {
      const deleted = await deleteReflectionComment(user.id, comment.id);
      if (!lease.isCurrent()) return;
      setTarget(null);
      if (deleted) {
        removeDeletedComment(queryClient, comment);
        notice(s.commentDeleted);
      } else {
        markCommentCountStale(queryClient, comment.reflection_id);
        notice(s.commentUnavailable);
      }
      onRemoved(comment, deleted);
    } catch (failure) {
      if (!lease.isCurrent()) return;
      console.warn("[Comments] Delete failed:", failure);
      setError(s.commentDeleteFailed);
    } finally {
      lease.release();
    }
  }, [
    target,
    user,
    begin,
    queryClient,
    notice,
    onRemoved,
    s.commentDeleted,
    s.commentUnavailable,
    s.commentDeleteFailed,
  ]);

  return {
    target,
    open: target !== null,
    pending: pending.has("delete"),
    error,
    request: (comment) => {
      if (!user || comment.user_id !== user.id) return;
      setError(null);
      setTarget(comment);
    },
    cancel: () => {
      if (pending.has("delete")) return;
      setTarget(null);
      setError(null);
    },
    confirm,
  };
}
