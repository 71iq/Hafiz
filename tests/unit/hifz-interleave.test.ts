import {
  INTERLEAVE_AFTER_PAGES,
  INTERLEAVE_PROMPTS_PER_SESSION,
  interleaveIndex,
  loadInterleaveCandidates,
  pickInterleavePair,
} from "@/lib/hifz/interleave";
import { declareMemorizedPages } from "@/lib/hifz/pages";
import { pairKey, similarGroupsOnPages, type SimilarGroup, type SimilarRef } from "@/lib/hifz/similar";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/** MUT-03: which similar-verse groups a reviewed page brings a "Which one" prompt for, and where it goes. */

const ref = (surah: number, ayah: number, page: number): SimilarRef => ({
  surah,
  ayah,
  surahName: "",
  pre: "",
  similar: "x",
  post: "",
  page,
});
const group = (groupId: string, self: SimilarRef, siblings: SimilarRef[]): SimilarGroup => ({
  groupId,
  kind: "similar",
  self,
  siblings,
});
const NONE = { groups: new Set<string>(), pairs: new Set<string>() };

describe("choosing a prompt", () => {
  it("skips a group or a pair the session already asks about", () => {
    const g1 = group("g1", ref(2, 5, 2), [ref(31, 5, 411)]);
    const g2 = group("g2", ref(2, 6, 2), [ref(7, 52, 157), ref(31, 6, 411)]);
    expect(pickInterleavePair([g1, g2], NONE, 0)).toMatchObject({ groupId: "g1", sibling: { surah: 31, ayah: 5 } });
    expect(pickInterleavePair([g1, g2], { groups: new Set(["g1"]), pairs: new Set() }, 0)?.groupId).toBe("g2");
    // A drift prompt for 2:6 and 7:52 leaves the group's other sibling.
    const asked = { groups: new Set(["g1"]), pairs: new Set([pairKey({ surah: 7, ayah: 52 }, { surah: 2, ayah: 6 })]) };
    expect(pickInterleavePair([g1, g2], asked, 0)?.sibling).toMatchObject({ surah: 31, ayah: 6 });
  });

  it("prefers a sibling on another page", () => {
    const g = group("g", ref(8, 75, 186), [ref(8, 74, 186), ref(9, 115, 205)]);
    expect(pickInterleavePair([g], NONE, 0)?.sibling).toMatchObject({ surah: 9, ayah: 115 });
    expect(pickInterleavePair([group("g", ref(8, 75, 186), [ref(8, 74, 186)])], NONE, 0)?.sibling).toMatchObject({
      surah: 8,
      ayah: 74,
    });
  });

  it(`stops at ${INTERLEAVE_PROMPTS_PER_SESSION} prompts a session`, () => {
    const g = group("g", ref(2, 5, 2), [ref(31, 5, 411)]);
    expect(pickInterleavePair([g], NONE, INTERLEAVE_PROMPTS_PER_SESSION - 1)).not.toBeNull();
    expect(pickInterleavePair([g], NONE, INTERLEAVE_PROMPTS_PER_SESSION)).toBeNull();
  });
});

describe("placing a prompt", () => {
  const isPage = (item: string) => item.startsWith("page");
  it(`goes after the ${INTERLEAVE_AFTER_PAGES}nd other page, or at the end when fewer follow`, () => {
    expect(interleaveIndex(["page2", "page3", "drill", "page4", "page5"], 0, isPage)).toBe(4);
    expect(interleaveIndex(["page2", "page3", "drill"], 0, isPage)).toBe(3);
    expect(interleaveIndex(["page2"], 0, isPage)).toBe(1);
  });
});

describe("candidates for a review's pages", () => {
  let store: OutboxDatabase;

  beforeEach(async () => {
    store = await openOutboxDatabase();
    store.sql.exec(
      "INSERT INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES ('g1', 'similar', 'cue', 'test', 0)",
    );
    const refs = [
      [0, 2, 5, 2],
      [1, 31, 5, 411],
      [2, 7, 52, 157],
    ] as const;
    for (const [order, surah, ayah, page] of refs) {
      store.sql
        .prepare(
          "INSERT INTO mutashabihat_refs (group_id, sort_order, surah, ayah, surah_name_ar, pre_text, similar_text, post_text) VALUES ('g1', ?, ?, ?, 'x', 'a', 'b', 'c')",
        )
        .run(order, surah, ayah);
      store.sql
        .prepare(
          "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (?, ?, 'x', 'x', 'x', ?)",
        )
        .run(surah, ayah, page);
    }
  });
  afterEach(async () => {
    await store.db.getFirstAsync("SELECT 1");
    await store.close();
  });

  it("reads the groups on the pages and keeps the siblings the person has memorized", async () => {
    const onPage2 = await similarGroupsOnPages(store.db, [2, 2, 3]);
    expect(onPage2.map((entry) => [entry.self.surah, entry.self.ayah])).toEqual([[2, 5]]);
    expect(onPage2[0].siblings).toHaveLength(2);

    expect(await loadInterleaveCandidates(store.db, [2])).toEqual(new Map());
    await declareMemorizedPages(store.db, { pages: [2, 411], cycleDays: 30 });
    const candidates = await loadInterleaveCandidates(store.db, [2, 3]);
    expect([...candidates.keys()]).toEqual([2]);
    expect(candidates.get(2)?.[0].siblings.map((sibling) => sibling.page)).toEqual([411]);
    expect(await loadInterleaveCandidates(store.db, [])).toEqual(new Map());
  });
});
