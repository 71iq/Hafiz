import { addComment, createReflection, fetchComments, fetchReflectionFeed } from "@/lib/reflections/api";
import { SavedRowUnreadableError } from "@/lib/reflections/rows";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args), rpc: (...args: unknown[]) => mockRpc(...args) },
  isSupabaseConfigured: () => true,
}));

type Result = { data?: unknown; error?: unknown };
let results: Result[] = [];

function makeBuilder() {
  const result = results.shift() ?? { data: [] };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "lte", "gte", "in", "or", "ilike", "order", "range", "insert"]) {
    builder[method] = () => builder;
  }
  builder.single = () => Promise.resolve(result);
  builder.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

const reflection = (overrides: Record<string, unknown> = {}) => ({
  id: "r1",
  user_id: "author",
  surah: 2,
  ayah_start: 255,
  ayah_end: 255,
  juz_start: 3,
  juz_end: 3,
  content: "A sanitized reflection",
  likes_count: 4,
  comments_count: 1,
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  profiles: { username: "author", display_name: null, avatar_url: null },
  ...overrides,
});
const comment = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  reflection_id: "r1",
  user_id: "author",
  content: "A sanitized comment",
  likes_count: 2,
  created_at: "2026-01-01T00:00:00Z",
  profiles: { username: "author", display_name: "Author", avatar_url: null },
  ...overrides,
});

const feed = () => fetchReflectionFeed({ filter: { type: "all" }, sort: "newest", page: 0 });

beforeEach(() => {
  results = [];
  mockFrom.mockReset().mockImplementation(() => makeBuilder());
  mockRpc.mockReset().mockImplementation(() => makeBuilder());
});

describe("RF-192 reflection rows from the server", () => {
  it("keeps valid rows and the null fallbacks", async () => {
    results = [
      {
        data: [
          reflection(),
          reflection({ id: "r2", likes_count: null, comments_count: null, juz_start: null, profiles: null }),
        ],
      },
    ];

    const page = await feed();

    expect(page.data[0]).toMatchObject({ id: "r1", likes_count: 4, profiles: { username: "author" } });
    expect(page.data[1]).toMatchObject({ id: "r2", likes_count: 0, comments_count: 0, juz_start: null });
    expect(page.data[1].profiles).toBeUndefined();
  });

  it.each([
    ["a count sent as text", { likes_count: "4" }],
    ["missing content", { content: undefined }],
    ["an unknown status", { status: "archived" }],
    ["a profile without a username", { profiles: { username: null, display_name: null, avatar_url: null } }],
  ])("rejects a feed page with %s instead of showing it", async (_label, overrides) => {
    results = [{ data: [reflection(), reflection({ id: "r2", ...overrides })] }];

    await expect(feed()).rejects.toThrow();
  });

  it("reports a created reflection that comes back malformed as saved but unreadable", async () => {
    results = [{ data: reflection({ ayah_start: "255" }) }];

    await expect(createReflection("author", 2, 255, 255, 3, 3, "A sanitized reflection", false)).rejects.toBeInstanceOf(
      SavedRowUnreadableError,
    );
  });

  it("rejects a comment page with a wrongly typed row and keeps valid comments", async () => {
    results = [{ data: [comment(), comment({ id: "c2", likes_count: null })] }];
    await expect(fetchComments("r1", 0)).resolves.toMatchObject({
      data: [
        { id: "c1", likes_count: 2 },
        { id: "c2", likes_count: 0 },
      ],
    });

    results = [{ data: [comment({ content: 7 })] }];
    await expect(fetchComments("r1", 0)).rejects.toThrow();
  });

  it("reports an added comment that comes back malformed as saved but unreadable", async () => {
    results = [{ data: comment({ id: null }) }];

    await expect(addComment("author", "r1", "A sanitized comment", false)).rejects.toBeInstanceOf(
      SavedRowUnreadableError,
    );
  });
});
