import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("reflection comment likes contract", () => {
  it("adds a public comment-like table with count maintenance", () => {
    const migration = read("supabase/migrations/20260614214500_reflection_comment_likes.sql");

    expect(migration).toContain("ADD COLUMN IF NOT EXISTS likes_count");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.reflection_comment_likes");
    expect(migration).toContain("ALTER TABLE public.reflection_comment_likes ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("GRANT SELECT ON public.reflection_comment_likes TO anon, authenticated");
    expect(migration).toContain("CREATE POLICY \"Comment likes are publicly readable\"");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.update_reflection_comment_likes_count");
    expect(migration).toContain("CREATE TRIGGER trg_reflection_comment_likes_count");
    expect(migration).toContain("idx_reflection_comments_popular");
  });

  it("fetches per-user comment like state and exposes a toggle API", () => {
    const api = read("lib/reflections/api.ts");

    expect(api).toContain("attachUserCommentLikes");
    expect(api).toContain('from("reflection_comment_likes")');
    expect(api).toContain("comment_id");
    expect(api).toContain("toggleCommentLike");
    expect(api).toContain('order("likes_count", { ascending: false })');
  });

  it("renders comment like buttons and applies popular sorting locally", () => {
    const sheet = read("components/reflections/CommentsSheet.tsx");

    expect(sheet).toContain("toggleCommentLike");
    expect(sheet).toContain("commentLikeOverrides");
    expect(sheet).toContain("handleCommentLike");
    expect(sheet).toContain("<Heart");
    expect(sheet).toContain('sort === "popular"');
  });
});
