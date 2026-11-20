import { act, renderHook } from "@testing-library/react-native";
import {
  addPendingComment,
  addPendingPost,
  offerRecoveredDraft,
  pendingKeys,
  resetPendingReflectionWritesForTests,
  settleListedComments,
  settleListedPosts,
  takeRecoveredDraft,
  usePendingComments,
  usePendingPosts,
} from "@/lib/reflections/pending";
import type { Reflection, ReflectionComment } from "@/lib/reflections/types";

const VIEWER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const reflection = (id: string): Reflection => ({
  id,
  user_id: VIEWER,
  surah: 2,
  ayah_start: 1,
  ayah_end: 1,
  content: "Synthetic",
  likes_count: 0,
  comments_count: 0,
  status: "active",
  created_at: "2026-11-20T00:00:00Z",
  updated_at: "2026-11-20T00:00:00Z",
});
const comment = (id: string): ReflectionComment => ({
  id,
  reflection_id: "post",
  user_id: VIEWER,
  content: "Synthetic",
  likes_count: 0,
  created_at: "2026-11-20T00:00:00Z",
});

afterEach(() => act(() => resetPendingReflectionWritesForTests()));

describe("pending reflection writes", () => {
  it("keeps every failed draft for an editor and hands them back oldest first", () => {
    const key = pendingKeys.reflectionDraft(VIEWER, { surah: 2, ayahStart: 1, ayahEnd: 1 });
    expect(offerRecoveredDraft(key, { content: "First draft", failure: "post" })).toBe(false);
    expect(offerRecoveredDraft(key, { content: "Second draft", failure: "post" })).toBe(false);
    expect(takeRecoveredDraft(key)).toEqual({ content: "First draft", failure: "post" });
    expect(takeRecoveredDraft(key)).toEqual({ content: "Second draft", failure: "post" });
    expect(takeRecoveredDraft(key)).toBeNull();
    // Drafts stay with their own account and target.
    offerRecoveredDraft(key, { content: "Mine", failure: "post" });
    expect(takeRecoveredDraft(pendingKeys.reflectionDraft(OTHER, { surah: 2, ayahStart: 1, ayahEnd: 1 }))).toBeNull();
  });

  it("drops a saved post or comment once a server list holds it, and keeps one still sending or unlisted", () => {
    const posts = renderHook(() => usePendingPosts(VIEWER, () => true));
    const comments = renderHook(() => usePendingComments(VIEWER, "post"));
    act(() => {
      addPendingPost({ token: {}, viewerId: VIEWER, status: "saved", reflection: reflection("listed") });
      addPendingPost({ token: {}, viewerId: VIEWER, status: "saved", reflection: reflection("unlisted") });
      addPendingPost({ token: {}, viewerId: VIEWER, status: "sending", reflection: reflection("listed-too") });
      addPendingComment({ token: {}, viewerId: VIEWER, status: "saved", comment: comment("listed") });
      addPendingComment({ token: {}, viewerId: VIEWER, status: "saved", comment: comment("unlisted") });
    });
    expect(posts.result.current.map((row) => row.id)).toEqual(["listed-too", "unlisted", "listed"]);
    act(() => {
      settleListedPosts(VIEWER, new Set(["listed", "listed-too"]));
      settleListedComments(VIEWER, new Set(["listed"]));
    });
    expect(posts.result.current.map((row) => row.id)).toEqual(["listed-too", "unlisted"]);
    expect(comments.result.current.map((row) => row.id)).toEqual(["unlisted"]);
    // Another account's settle leaves this one's rows alone.
    act(() => settleListedPosts(OTHER, new Set(["unlisted"])));
    expect(posts.result.current.map((row) => row.id)).toEqual(["listed-too", "unlisted"]);
  });
});
