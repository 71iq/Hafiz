import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Reflection, ReflectionComment } from "./types";

/**
 * Community writes the person made on this device that the server has not answered yet. Screens show
 * them at once (a like, a new post or comment, a delete, a report) and the write's own completion
 * keeps or takes back each entry. Entries are keyed by the account that made them, so another account
 * never sees them, and they live in memory only: the server stays the record.
 *
 * Entries outlive the screen that made them, so a post or delete still reaches the person (and a
 * failure is still taken back) after its sheet or card is gone.
 */
/** A like shown before the list it belongs to shows it. `busy` while a send for it runs. */
export type LikeOverlay = Readonly<{ token: object; liked: boolean; busy: boolean; isCurrent: () => boolean }>;
export type PendingStatus = "sending" | "saved";
export type PendingPost = Readonly<{ token: object; viewerId: string; status: PendingStatus; reflection: Reflection }>;
export type PendingComment = Readonly<{
  token: object;
  viewerId: string;
  status: PendingStatus;
  comment: ReflectionComment;
}>;
/** A draft whose post failed after its editor closed, offered again when that editor opens. */
export type RecoveredDraft = Readonly<{ content: string; failure: "post" | "privacy" }>;

type State = Readonly<{
  likes: ReadonlyMap<string, LikeOverlay>;
  hidden: ReadonlySet<string>;
  reports: ReadonlySet<string>;
  posts: readonly PendingPost[];
  comments: readonly PendingComment[];
}>;

const empty: State = {
  likes: new Map(),
  hidden: new Set(),
  reports: new Set(),
  posts: [],
  comments: [],
};
let state = empty;
const listeners = new Set<() => void>();

function update(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function useStore<T>(select: (current: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(empty),
  );
}
function withEntry<K, V>(map: ReadonlyMap<K, V>, key: K, value: V | undefined): ReadonlyMap<K, V> {
  const next = new Map(map);
  if (value === undefined) next.delete(key);
  else next.set(key, value);
  return next;
}
function withMember(set: ReadonlySet<string>, key: string, present: boolean): ReadonlySet<string> {
  if (set.has(key) === present) return set;
  const next = new Set(set);
  if (present) next.add(key);
  else next.delete(key);
  return next;
}

export const pendingKeys = {
  reflection: (viewerId: string, reflectionId: string) => `${viewerId}:reflection:${reflectionId}`,
  comment: (viewerId: string, commentId: string) => `${viewerId}:comment:${commentId}`,
  commentDraft: (viewerId: string, reflectionId: string) => `${viewerId}:comment-draft:${reflectionId}`,
  reflectionDraft: (viewerId: string, target: { surah: number; ayahStart: number; ayahEnd: number }) =>
    `${viewerId}:reflection-draft:${target.surah}:${target.ayahStart}:${target.ayahEnd}`,
};

/** Ids a pending write made up before the server named the row. Such rows take no likes or replies. */
const PENDING_ID_PREFIX = "pending:";
export function pendingId(seed: string): string {
  return `${PENDING_ID_PREFIX}${seed}`;
}
export function isPendingId(id: string): boolean {
  return id.startsWith(PENDING_ID_PREFIX);
}

// ─── Likes ─────────────────────────────────────────────────────

export function useLikeOverlay(key: string | null): LikeOverlay | null {
  return useStore((current) => (key ? (current.likes.get(key) ?? null) : null));
}
export function getLikeOverlay(key: string): LikeOverlay | null {
  return state.likes.get(key) ?? null;
}
export function setLikeOverlay(key: string, overlay: LikeOverlay | undefined) {
  update({ likes: withEntry(state.likes, key, overlay) });
}
/** Removes the overlay only while it is still the one `token` wrote. */
export function clearLikeOverlay(key: string, token: object) {
  if (state.likes.get(key)?.token === token) setLikeOverlay(key, undefined);
}

// ─── Deletes and reports ───────────────────────────────────────

export function useIsHidden(key: string | null): boolean {
  return useStore((current) => (key ? current.hidden.has(key) : false));
}
export function isHidden(key: string): boolean {
  return state.hidden.has(key);
}
export function setHidden(key: string, hidden: boolean) {
  update({ hidden: withMember(state.hidden, key, hidden) });
}
export function useHiddenSet(): ReadonlySet<string> {
  return useStore((current) => current.hidden);
}

export function useIsReported(key: string | null): boolean {
  return useStore((current) => (key ? current.reports.has(key) : false));
}
export function isReported(key: string): boolean {
  return state.reports.has(key);
}
export function setReported(key: string, reported: boolean) {
  update({ reports: withMember(state.reports, key, reported) });
}

// ─── New posts and comments ────────────────────────────────────

export function addPendingPost(entry: PendingPost) {
  update({ posts: [entry, ...state.posts] });
}
export function replacePendingPost(token: object, entry: PendingPost | null) {
  update({
    posts: entry
      ? state.posts.map((post) => (post.token === token ? entry : post))
      : state.posts.filter((post) => post.token !== token),
  });
}
/** This account's posts, newest first, that match `include` (pass a stable callback). */
export function usePendingPosts(
  viewerId: string | undefined,
  include: (reflection: Reflection) => boolean,
): Reflection[] {
  const posts = useStore((current) => current.posts);
  return useMemo(
    () =>
      viewerId
        ? posts.filter((post) => post.viewerId === viewerId && include(post.reflection)).map((post) => post.reflection)
        : [],
    [posts, viewerId, include],
  );
}

/**
 * Drops this account's saved posts that a list from the server now holds; that list shows them from
 * then on. A saved post no list has shown yet stays, so it does not vanish while a refetch fails.
 */
export function settleListedPosts(viewerId: string | undefined, listedIds: ReadonlySet<string>) {
  if (!viewerId) return;
  const kept = state.posts.filter(
    (post) => !(post.viewerId === viewerId && post.status === "saved" && listedIds.has(post.reflection.id)),
  );
  if (kept.length !== state.posts.length) update({ posts: kept });
}

export function addPendingComment(entry: PendingComment) {
  update({ comments: [...state.comments, entry] });
}
export function replacePendingComment(token: object, entry: PendingComment | null) {
  update({
    comments: entry
      ? state.comments.map((comment) => (comment.token === token ? entry : comment))
      : state.comments.filter((comment) => comment.token !== token),
  });
}
/** As settleListedPosts, for comments a loaded comment list now holds. */
export function settleListedComments(viewerId: string | undefined, listedIds: ReadonlySet<string>) {
  if (!viewerId) return;
  const kept = state.comments.filter(
    (entry) => !(entry.viewerId === viewerId && entry.status === "saved" && listedIds.has(entry.comment.id)),
  );
  if (kept.length !== state.comments.length) update({ comments: kept });
}
export function usePendingComments(viewerId: string | undefined, reflectionId: string | null): ReflectionComment[] {
  const comments = useStore((current) => current.comments);
  return useMemo(
    () =>
      viewerId && reflectionId
        ? comments
            .filter((entry) => entry.viewerId === viewerId && entry.comment.reflection_id === reflectionId)
            .map((entry) => entry.comment)
        : [],
    [comments, viewerId, reflectionId],
  );
}

// ─── Drafts of failed posts ────────────────────────────────────

// The editors open for a draft key, asked first when a post fails: one with an empty input takes the
// draft back at once. Otherwise the draft waits here, in order, until its editor opens again; each
// opening takes the oldest, so two failed posts for one ayah or reflection both come back.
const draftAdopters = new Map<string, Set<{ current: (draft: RecoveredDraft) => boolean }>>();
const storedDrafts = new Map<string, RecoveredDraft[]>();

/** Offers a failed post's draft to its open editor; true when one took it back. */
export function offerRecoveredDraft(key: string, draft: RecoveredDraft): boolean {
  for (const adopter of draftAdopters.get(key) ?? []) if (adopter.current(draft)) return true;
  storedDrafts.set(key, [...(storedDrafts.get(key) ?? []), draft]);
  return false;
}
/** Hands the oldest stored draft to the editor that opened for it, once. */
export function takeRecoveredDraft(key: string): RecoveredDraft | null {
  const [draft = null, ...rest] = storedDrafts.get(key) ?? [];
  if (rest.length > 0) storedDrafts.set(key, rest);
  else storedDrafts.delete(key);
  return draft;
}
/** While mounted, `adopt` may take back a draft for `key`; it returns false to leave it stored. */
export function useDraftAdopter(key: string | null, adopt: (draft: RecoveredDraft) => boolean) {
  const adopter = useRef(adopt);
  useLayoutEffect(() => {
    adopter.current = adopt;
  });
  useEffect(() => {
    if (!key) return;
    const adopters = draftAdopters.get(key) ?? new Set();
    adopters.add(adopter);
    draftAdopters.set(key, adopters);
    return () => {
      adopters.delete(adopter);
      if (adopters.size === 0) draftAdopters.delete(key);
    };
  }, [key]);
}

/** Test hook: forget every pending write from earlier cases. */
export function resetPendingReflectionWritesForTests() {
  state = empty;
  storedDrafts.clear();
  listeners.forEach((listener) => listener());
}
