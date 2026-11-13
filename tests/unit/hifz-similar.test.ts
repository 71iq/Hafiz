import { atLocalTime } from "@/lib/habit/dates";
import { setStudyCardMarked } from "@/lib/fsrs/queries";
import { bringSimilarCardsForward, similarGroupsForAyahs, withMemorizedSiblings } from "@/lib/hifz/similar";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

let store: OutboxDatabase;

function seed() {
  store.sql.exec("INSERT INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES ('g1', 'similar', 'cue', 'test', 0)");
  const refs = [
    [0, 2, 5, "البقرة", "أُو۟لَٰٓئِكَ", "عَلَىٰ هُدًى", "مِّن رَّبِّهِمْ", 2],
    [1, 31, 5, "لقمان", "أُو۟لَٰٓئِكَ", "عَلَىٰ هُدًى", "مِّن رَّبِّهِمْ", 411],
  ] as const;
  for (const [order, surah, ayah, name, pre, similar, post, page] of refs) {
    store.sql
      .prepare("INSERT INTO mutashabihat_refs (group_id, sort_order, surah, ayah, surah_name_ar, pre_text, similar_text, post_text) VALUES ('g1', ?, ?, ?, ?, ?, ?, ?)")
      .run(order, surah, ayah, name, pre, similar, post);
    store.sql
      .prepare("INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (?, ?, 'x', 'x', 'x', ?)")
      .run(surah, ayah, page);
  }
}

beforeEach(async () => {
  store = await openOutboxDatabase();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  seed();
});
afterEach(async () => {
  await store.db.getFirstAsync("SELECT 1");
  await store.close();
  jest.restoreAllMocks();
});

describe("similar verses (4.7)", () => {
  it("finds an ayah's siblings and keeps only memorized ones (MUT-01)", async () => {
    const groups = await similarGroupsForAyahs(store.db, [{ surah: 31, ayah: 5 }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].self).toMatchObject({ surah: 31, ayah: 5, similar: "عَلَىٰ هُدًى", page: 411 });
    expect(groups[0].siblings.map((sibling) => [sibling.surah, sibling.ayah])).toEqual([[2, 5]]);
    expect(withMemorizedSiblings(groups, new Set([2]))).toHaveLength(1);
    expect(withMemorizedSiblings(groups, new Set([100]))).toHaveLength(0);
    expect(await similarGroupsForAyahs(store.db, [{ surah: 1, ayah: 1 }])).toEqual([]);
  });

  it("brings the pair's cards due within a day after a drift, and queues the change (SCH-07)", async () => {
    const card = await setStudyCardMarked(store.db, "default-mutashabihat", "mutashabihat:g1:1", false);
    store.sql.prepare("UPDATE study_cards SET due = ? WHERE id = ?").run("2027-01-01T00:00:00.000Z", card.id);
    const now = atLocalTime("2026-11-13", 600);
    const queued = Number(store.sql.prepare("SELECT COUNT(*) AS n FROM sync_queue").get()?.n);
    const moved = await store.db.withTransactionAsync(async (tx) => {
      expect(await bringSimilarCardsForward(tx, { surah: 2, ayah: 5, now })).toBe(1);
    });
    expect(moved).toBeUndefined();
    const due = String(store.sql.prepare("SELECT due FROM study_cards WHERE id = ?").get(card.id)?.due);
    expect(new Date(due).getTime()).toBe(now.getTime() + 86_400_000);
    expect(Number(store.sql.prepare("SELECT COUNT(*) AS n FROM sync_queue").get()?.n)).toBe(queued + 1);
  });
});
