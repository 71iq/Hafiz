import {
  addComment,
  createReflection,
  fetchComments,
  fetchReflectionFeed,
  fetchReflections,
  toggleCommentLike,
  toggleLike,
} from "@/lib/reflections/api";
import { ReflectionPrivacyChangedError } from "@/lib/reflections/errors";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args), rpc: (...args: unknown[]) => mockRpc(...args) },
  isSupabaseConfigured: () => true,
}));

type Result = { data?: unknown; error?: unknown; count?: number };
type Builder = {
  calls: Array<[string, ...unknown[]]>;
  result: Result | Promise<Result>;
  select(...args: unknown[]): Builder;
  eq(...args: unknown[]): Builder;
  lte(...args: unknown[]): Builder;
  gte(...args: unknown[]): Builder;
  in(...args: unknown[]): Builder;
  or(...args: unknown[]): Builder;
  ilike(...args: unknown[]): Builder;
  order(...args: unknown[]): Builder;
  range(...args: unknown[]): Builder;
  insert(...args: unknown[]): Builder;
  delete(...args: unknown[]): Builder;
  single(): Promise<Result>;
  then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown>;
};
const builders: Builder[] = [];
let results: (Result | Promise<Result>)[] = [];

function makeBuilder(table: string): Builder {
  const calls: Builder["calls"] = [];
  const builder = {} as Builder;
  const record = (method: string, ...args: unknown[]): Builder => {
    calls.push([method, ...args]);
    if (method === "insert") calls.push(["table", table]);
    return builder;
  };
  Object.assign(builder, {
    calls,
    result: results.shift() ?? { data: [] },
    select: (...args: unknown[]) => record("select", ...args),
    eq: (...args: unknown[]) => record("eq", ...args),
    lte: (...args: unknown[]) => record("lte", ...args),
    gte: (...args: unknown[]) => record("gte", ...args),
    in: (...args: unknown[]) => record("in", ...args),
    or: (...args: unknown[]) => record("or", ...args),
    ilike: (...args: unknown[]) => record("ilike", ...args),
    order: (...args: unknown[]) => record("order", ...args),
    range: (...args: unknown[]) => record("range", ...args),
    insert: (...args: unknown[]) => record("insert", ...args),
    delete: (...args: unknown[]) => record("delete", ...args),
    single: () => Promise.resolve(builder.result),
    then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(builder.result).then(resolve, reject),
  });
  builders.push(builder);
  return builder;
}

const reflection = (id: string) => ({
  id,
  user_id: "author",
  surah: 2,
  ayah_start: 1,
  ayah_end: 1,
  juz_start: null,
  juz_end: null,
  content: `safe ${id}`,
  likes_count: 0,
  comments_count: 0,
  status: "active" as const,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});
const comment = (id: string) => ({
  id,
  reflection_id: "post",
  user_id: "author",
  content: `safe ${id}`,
  likes_count: 0,
  created_at: "2026-01-01T00:00:00Z",
});

beforeEach(() => {
  builders.length = 0;
  results = [];
  mockFrom.mockReset().mockImplementation((table: string) => makeBuilder(table));
  mockRpc.mockReset().mockImplementation(() => makeBuilder("rpc"));
});

describe("reflection API page service behavior", () => {
  it("propagates the original viewer-like query error", async () => {
    const error = { code: "42501", message: "permission denied" };
    results = [{ data: [reflection("r1")] }, { data: null, error }];
    await expect(fetchReflections(2, 1, 0, "viewer")).rejects.toBe(error);
  });

  it.each([
    [{ code: "PGRST204", message: "unrelated cached schema error" }, false],
    [{ code: "PGRST205", message: "relation reflection_comments missing" }, false],
    [{ code: "42501", message: "likes_count is not available to this role" }, false],
    [{ code: "42703", message: "column unrelated does not exist", hint: "query also uses likes_count" }, false],
  ])("does not retry a popular comment query for unrelated error %#", async (error, shouldFallback) => {
    results = [{ data: null, error }];
    await expect(fetchComments("post", 0, "popular", "viewer")).rejects.toBe(error);
    expect(builders).toHaveLength(shouldFallback ? 3 : 1);
  });

  it("retries popular comment sort for a named missing likes_count and preserves fallback error identity", async () => {
    const missing = { code: "42703", message: "column likes_count does not exist" };
    const fallbackError = { code: "08006", message: "connection lost" };
    results = [
      { data: null, error: missing },
      { data: null, error: fallbackError },
    ];
    await expect(fetchComments("post", 0, "popular")).rejects.toBe(fallbackError);
    expect(builders).toHaveLength(2);
    expect(builders[1].calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(builders[1].calls).not.toContainEqual(["order", "likes_count", { ascending: false }]);
  });

  it.each([
    [
      { code: "PGRST205", message: "Could not find the table 'public.reflection_comment_likes' in the schema cache" },
      true,
    ],
    [{ code: "42P01", message: "relation public.reflection_comment_likes does not exist" }, true],
    [{ code: "PGRST205", message: "Could not find the table 'public.other' in the schema cache" }, false],
    [{ code: "42501", message: "permission denied for table reflection_comment_likes" }, false],
    [{ code: "08006", message: "network unavailable for reflection_comment_likes" }, false],
    [{ code: "PGRST202", message: "reflection_comment_likes missing from schema cache" }, false],
    [
      { code: "42P01", message: "relation unrelated does not exist", hint: "query uses reflection_comment_likes" },
      false,
    ],
  ])("only tolerates a genuinely missing named comment-likes table %#", async (error, tolerated) => {
    results = [{ data: [comment("c1")] }, { data: null, error }];
    const request = fetchComments("post", 0, "oldest", "viewer");
    if (tolerated) await expect(request).resolves.toMatchObject({ data: [{ id: "c1", likes_count: 0 }] });
    else await expect(request).rejects.toBe(error);
  });

  it.each([5, 10, 20])("uses adjacent inclusive %i-row windows with one lookahead and trims", async (size) => {
    const firstPageRows = Array.from({ length: size + 1 }, (_, i) => reflection(`r${i}`));
    const secondPageRows = Array.from({ length: size + 1 }, (_, i) => reflection(`r${size + i}`));
    if (size === 20) {
      results = [
        { data: Array.from({ length: size + 1 }, (_, i) => comment(`c${i}`)) },
        { data: Array.from({ length: size + 1 }, (_, i) => comment(`c${size + i}`)) },
      ];
      const first = await fetchComments("post", 0, "oldest");
      const second = await fetchComments("post", 1, "oldest");
      expect(builders[0].calls).toContainEqual(["range", 0, size]);
      expect(builders[1].calls).toContainEqual(["range", size, size * 2]);
      expect(first).toMatchObject({ hasMore: true, data: Array.from({ length: size }, (_, i) => ({ id: `c${i}` })) });
      expect(second).toMatchObject({
        hasMore: true,
        data: Array.from({ length: size }, (_, i) => ({ id: `c${size + i}` })),
      });
      expect(first.data.some((row) => row.id === second.data[0].id)).toBe(false);
    } else {
      results = [
        { data: firstPageRows },
        { data: [{ reflection_id: "r0" }] },
        { data: secondPageRows },
        { data: [{ reflection_id: `r${size}` }] },
      ];
      const fetchPage = (page: number) =>
        size === 5
          ? fetchReflections(2, 1, page, "viewer")
          : fetchReflectionFeed({ filter: { type: "all" }, sort: "newest", page, userId: "viewer" });
      const first = await fetchPage(0);
      const second = await fetchPage(1);
      expect(builders[0].calls).toContainEqual(["range", 0, size]);
      expect(builders[2].calls).toContainEqual(["range", size, size * 2]);
      expect(first.data).toHaveLength(size);
      expect(first.hasMore).toBe(true);
      expect(first.data.some((row) => row.id === firstPageRows[size].id)).toBe(false);
      expect(second.data).toHaveLength(size);
      expect(second.hasMore).toBe(true);
      expect(second.data[0].id).toBe(`r${size}`);
      expect(second.data.some((row) => row.id === secondPageRows[size].id)).toBe(false);
    }
  });

  it("attaches personalized likes and skips enrichment for no viewer and empty pages", async () => {
    results = [{ data: [reflection("r1"), reflection("r2")] }, { data: [{ reflection_id: "r2" }] }];
    await expect(fetchReflections(2, 1, 0, "viewer")).resolves.toMatchObject({
      data: [
        { id: "r1", user_has_liked: false },
        { id: "r2", user_has_liked: true },
      ],
    });
    expect(builders[1].calls).toContainEqual(["eq", "user_id", "viewer"]);

    builders.length = 0;
    results = [{ data: [reflection("r1")] }];
    await fetchReflections(2, 1, 0);
    expect(builders).toHaveLength(1);

    builders.length = 0;
    results = [{ data: [] }];
    await fetchReflections(2, 1, 0, "viewer");
    expect(builders).toHaveLength(1);
  });
});

describe("missing-object errors name the exact compatibility target", () => {
  it.each(["PGRST205", "42P01", "42501"])("rejects a different comment-likes table under %s", async (code) => {
    const error = {
      code,
      message:
        code === "42P01"
          ? 'relation "public.reflection_comment_likes_history" does not exist'
          : "Could not find the table 'public.reflection_comment_likes_history' in the schema cache",
    };
    results = [{ data: [comment("c1")] }, { data: null, error }];
    await expect(fetchComments("post", 0, "oldest", "viewer")).rejects.toBe(error);
  });
  it("preserves genuine PostgreSQL relation-qualified sort-column fallback", async () => {
    results = [
      {
        data: null,
        error: { code: "42703", message: 'column "likes_count" of relation "reflection_comments" does not exist' },
      },
      { data: [comment("c1")] },
    ];
    await expect(fetchComments("post", 0, "popular")).resolves.toMatchObject({ data: [{ id: "c1" }] });
    expect(builders).toHaveLength(2);
  });
});

describe("reflection writes go through the server functions", () => {
  it.each([true, false])("creates a reflection with the visibility the composer showed (%s)", async (promised) => {
    results = [{ data: reflection("new") }];
    await expect(createReflection("viewer", 2, 1, 2, 1, 1, "safe content", promised)).resolves.toMatchObject({
      id: "new",
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledWith("create_reflection", {
      p_user_id: "viewer",
      p_surah: 2,
      p_ayah_start: 1,
      p_ayah_end: 2,
      p_juz_start: 1,
      p_juz_end: 1,
      p_content: "safe content",
      p_private: promised,
    });
    expect(builders[0].calls[0]).toEqual([
      "select",
      "*, profiles:profiles!reflections_user_id_fkey(username, display_name, avatar_url)",
    ]);
  });

  it("adds a comment with the visibility the comment input showed", async () => {
    results = [{ data: comment("new") }];
    await expect(addComment("viewer", "post", "safe comment", true)).resolves.toMatchObject({
      id: "new",
      user_has_liked: false,
    });
    expect(mockRpc).toHaveBeenCalledWith("add_reflection_comment", {
      p_user_id: "viewer",
      p_reflection_id: "post",
      p_content: "safe comment",
      p_private: true,
    });
  });

  it("reports a refused privacy promise as its own error and passes other errors through", async () => {
    results = [{ data: null, error: { code: "P0001", message: "privacy_changed" } }];
    await expect(createReflection("viewer", 2, 1, 2, 1, 1, "safe content", true)).rejects.toBeInstanceOf(
      ReflectionPrivacyChangedError,
    );
    results = [{ data: null, error: { code: "P0001", message: "privacy_changed" } }];
    await expect(addComment("viewer", "post", "safe comment", true)).rejects.toBeInstanceOf(
      ReflectionPrivacyChangedError,
    );
    const other = { code: "P0001", message: "reflection_not_found" };
    results = [{ data: null, error: other }];
    await expect(addComment("viewer", "post", "safe comment", false)).rejects.toBe(other);
  });

  it("likes and unlikes through the server functions with the requested state", async () => {
    results = [{ data: true }, { data: false }];
    await expect(toggleLike("viewer", "post", false)).resolves.toBe(true);
    await expect(toggleCommentLike("viewer", "comment", true)).resolves.toBe(false);
    expect(mockRpc).toHaveBeenNthCalledWith(1, "set_reflection_like", {
      p_user_id: "viewer",
      p_reflection_id: "post",
      p_liked: true,
    });
    expect(mockRpc).toHaveBeenNthCalledWith(2, "set_reflection_comment_like", {
      p_user_id: "viewer",
      p_comment_id: "comment",
      p_liked: false,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("propagates a refused like", async () => {
    const error = { code: "P0001", message: "reflection_not_found" };
    results = [{ data: null, error }];
    await expect(toggleLike("viewer", "post", false)).rejects.toBe(error);
  });
});

it("creation refuses an already retired caller before calling the server", async () => {
  await expect(createReflection("viewer", 2, 1, 2, 1, 1, "safe content", false, () => false)).rejects.toThrow(
    "superseded",
  );
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
  expect(builders).toHaveLength(0);
});
