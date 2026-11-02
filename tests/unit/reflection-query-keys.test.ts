import { hashKey, QueryClient } from "@tanstack/react-query";
import { reflectionQueryKeys as keys } from "@/lib/reflections/query-keys";
import type { ReflectionFeedFilter, ReflectionJuzRange } from "@/lib/reflections/types";

const filter: ReflectionFeedFilter = { type: "juz", juz: 3 };
const ranges: ReflectionJuzRange[] = [{ juz: 3, surah: 2, ayah_start: 253, ayah_end: 286 }];
const feed = (viewerId?: string) =>
  keys.feed.list({ filter, sort: "popular", viewerId, juzRanges: ranges, searchTerm: "نص_%" });
const viewers: (string | undefined)[] = [undefined, "synthetic-a", "synthetic-b", "", "عربي/[]"];

describe("reflection query keys preserve existing cache contracts", () => {
  let client: QueryClient;
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  });
  afterEach(() => client.clear());

  it.each(viewers)("feed literal and hash preserve viewer %s and every result input", (viewerId) => {
    const expected = ["reflectionFeed", filter, "popular", viewerId, ranges, "نص_%"];
    expect(feed(viewerId)).toEqual(expected);
    expect(hashKey(feed(viewerId))).toBe(hashKey(expected));
    expect(feed(viewerId)[1]).toBe(filter);
    expect(feed(viewerId)[4]).toBe(ranges);
  });
  it.each(viewers)("first-page literal and hash preserve viewer %s", (viewerId) => {
    const expected = ["reflections", 2, 255, 0, viewerId];
    const actual = keys.reflections.firstPage({ surah: 2, ayah: 255, viewerId });
    expect(actual).toEqual(expected);
    expect(hashKey(actual)).toBe(hashKey(expected));
  });
  it.each(viewers)("comments literal and hash preserve viewer %s", (viewerId) => {
    const expected = ["reflectionComments", "synthetic-post", "newest", viewerId];
    const actual = keys.comments.list({ reflectionId: "synthetic-post", sort: "newest", viewerId });
    expect(actual).toEqual(expected);
    expect(hashKey(actual)).toBe(hashKey(expected));
  });
  it.each([
    [2, 255],
    [114, 6],
    [0, -1],
  ])("preserves exact ayah/public-count prefixes %s/%s", (surah, ayah) => {
    expect(keys.reflections.ayah({ surah, ayah })).toEqual(["reflections", surah, ayah]);
    expect(keys.count({ surah, ayah })).toEqual(["reflectionCount", surah, ayah]);
  });
  it("retains family prefixes and disabled null comment target", () => {
    expect(keys.feed.all).toEqual(["reflectionFeed"]);
    expect(keys.reflections.all).toEqual(["reflections"]);
    expect(keys.comments.all).toEqual(["reflectionComments"]);
    expect(keys.comments.list({ reflectionId: null, sort: "oldest" })).toEqual([
      "reflectionComments",
      null,
      "oldest",
      undefined,
    ]);
  });
  it("does not normalize omitted ranges, empty search or supplied input objects", () => {
    const f: ReflectionFeedFilter = { type: "all" };
    const before = JSON.stringify({ filter, ranges });
    expect(keys.feed.list({ filter: f, sort: "newest", searchTerm: "" })).toEqual([
      "reflectionFeed",
      f,
      "newest",
      undefined,
      undefined,
      "",
    ]);
    feed("synthetic-a");
    expect(JSON.stringify({ filter, ranges })).toBe(before);
  });
  it("separates each result-changing feed dimension and viewer", () => {
    const base: Parameters<typeof keys.feed.list>[0] = {
      filter,
      sort: "popular",
      viewerId: "a",
      juzRanges: ranges,
      searchTerm: "term",
    };
    const variants: Parameters<typeof keys.feed.list>[0][] = [
      base,
      { ...base, viewerId: "b" },
      { ...base, sort: "oldest" },
      { ...base, filter: { type: "surah", surah: 2 } },
      { ...base, juzRanges: [] },
      { ...base, searchTerm: "other" },
    ];
    variants.forEach((v, i) => client.setQueryData(keys.feed.list(v), i));
    variants.forEach((v, i) => expect(client.getQueryData(keys.feed.list(v))).toBe(i));
    expect(client.getQueryCache().getAll()).toHaveLength(variants.length);
  });
  it("feed family invalidation reaches every viewer/filter but leaves comments/public data alone", async () => {
    const a = feed("a"),
      b = feed("b"),
      c = keys.feed.list({ filter: { type: "all" }, sort: "less", searchTerm: "" });
    const other = [
      ["publicProfile", "a"],
      keys.comments.list({ reflectionId: "p", sort: "oldest", viewerId: "a" }),
      keys.count({ surah: 2, ayah: 1 }),
    ];
    [a, b, c, ...other].forEach((k) => client.setQueryData(k, 1));
    await client.invalidateQueries({ queryKey: keys.feed.all, refetchType: "none" });
    [a, b, c].forEach((k) => expect(client.getQueryState(k)?.isInvalidated).toBe(true));
    other.forEach((k) => expect(client.getQueryState(k)?.isInvalidated).toBe(false));
  });
  it("ayah invalidation reaches all viewers only at that ayah", async () => {
    const a = keys.reflections.firstPage({ surah: 2, ayah: 1, viewerId: "a" });
    const b = keys.reflections.firstPage({ surah: 2, ayah: 1, viewerId: "b" });
    const other = [keys.reflections.firstPage({ surah: 2, ayah: 2, viewerId: "a" }), keys.count({ surah: 2, ayah: 1 })];
    [a, b, ...other].forEach((k) => client.setQueryData(k, 1));
    await client.invalidateQueries({ queryKey: keys.reflections.ayah({ surah: 2, ayah: 1 }), refetchType: "none" });
    [a, b].forEach((k) => expect(client.getQueryState(k)?.isInvalidated).toBe(true));
    other.forEach((k) => expect(client.getQueryState(k)?.isInvalidated).toBe(false));
  });
  it("comment family invalidation reaches targets, sorts and viewers but not post rows", async () => {
    const a = keys.comments.list({ reflectionId: "p", sort: "oldest", viewerId: "a" });
    const b = keys.comments.list({ reflectionId: "q", sort: "popular", viewerId: "b" });
    const other = keys.reflections.firstPage({ surah: 2, ayah: 1, viewerId: "a" });
    [a, b, other].forEach((k) => client.setQueryData(k, 1));
    await client.invalidateQueries({ queryKey: keys.comments.all, refetchType: "none" });
    [a, b].forEach((k) => expect(client.getQueryState(k)?.isInvalidated).toBe(true));
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  });
  it("real infinite-query pages remain ordered and isolated by viewer", async () => {
    for (const viewerId of ["a", "b"]) {
      const result = await client.fetchInfiniteQuery({
        queryKey: feed(viewerId),
        initialPageParam: 0,
        pages: 2,
        queryFn: async ({ pageParam }) => ({ page: pageParam, viewerId }),
        getNextPageParam: (last) => last.page + 1,
      });
      expect(result.pageParams).toEqual([0, 1]);
      expect(result.pages).toEqual([
        { page: 0, viewerId },
        { page: 1, viewerId },
      ]);
    }
    expect(client.getQueryCache().getAll()).toHaveLength(2);
  });
});
