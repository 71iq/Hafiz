import {
  MUTASHABIHAT_DATA_VERSION,
  MUTASHABIHAT_VERSION_SETTING,
  parseMutashabihatRows,
  refreshMutashabihatRows,
} from "@/lib/database/mutashabihat-rows";
import { getSmartCardContent, getSmartDeckCandidateCardIds, SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { similarPair } from "@/lib/hifz/similar";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

const AYAT: Record<number, string> = {
  261: "مَّثَلُ ٱلَّذِينَ يُنفِقُونَ أَمْوَٰلَهُمْ فِى سَبِيلِ ٱللَّهِ كَمَثَلِ حَبَّةٍ أَنۢبَتَتْ سَبْعَ سَنَابِلَ فِى كُلِّ سُنۢبُلَةٍ مِّا۟ئَةُ حَبَّةٍ وَٱللَّهُ يُضَٰعِفُ لِمَن يَشَآءُ وَٱللَّهُ وَٰسِعٌ عَلِيمٌ",
  264: "يَٰٓأَيُّهَا ٱلَّذِينَ ءَامَنُوا۟ لَا تُبْطِلُوا۟ صَدَقَٰتِكُم بِٱلْمَنِّ وَٱلْأَذَىٰ كَٱلَّذِى يُنفِقُ مَالَهُۥ رِئَآءَ ٱلنَّاسِ وَلَا يُؤْمِنُ بِٱللَّهِ وَٱلْيَوْمِ ٱلْـَٔاخِرِ فَمَثَلُهُۥ كَمَثَلِ صَفْوَانٍ عَلَيْهِ تُرَابٌ فَأَصَابَهُۥ وَابِلٌ فَتَرَكَهُۥ صَلْدًا لَّا يَقْدِرُونَ عَلَىٰ شَىْءٍ مِّمَّا كَسَبُوا۟ وَٱللَّهُ لَا يَهْدِى ٱلْقَوْمَ ٱلْكَٰفِرِينَ",
  265: "وَمَثَلُ ٱلَّذِينَ يُنفِقُونَ أَمْوَٰلَهُمُ ٱبْتِغَآءَ مَرْضَاتِ ٱللَّهِ وَتَثْبِيتًا مِّنْ أَنفُسِهِمْ كَمَثَلِ جَنَّةٍۭ بِرَبْوَةٍ أَصَابَهَا وَابِلٌ فَـَٔاتَتْ أُكُلَهَا ضِعْفَيْنِ فَإِن لَّمْ يُصِبْهَا وَابِلٌ فَطَلٌّ وَٱللَّهُ بِمَا تَعْمَلُونَ بَصِيرٌ",
};
const words = (ayah: number, from: number, to?: number) => AYAT[ayah].split(" ").slice(from, to).join(" ");

const GROUP = "nq-sim-6b0cb090bae7db";
const TAIL = "nq-tail-test";
const CUE = "وَمَثَلُ ٱلَّذِينَ يُنفِقُونَ أَمْوَٰلَهُمُ";
const groups = [
  [GROUP, "similar", CUE, "nourquran:similars", 0],
  [TAIL, "tail", "عَلِيمٌ", "nourquran:tails", 1],
] as const;
const tailRefs = [
  [TAIL, 0, 2, 261, "البقرة", "وٱلله وسع عليم", null, null, null],
  [TAIL, 1, 2, 265, "البقرة", "بما تعملون بصير", null, null, null],
] as const;
const OLD_REFS = [
  [
    GROUP,
    0,
    2,
    261,
    "البقرة",
    "ينفقون",
    "وَٱعْلَمْ أَنَّ ٱللَّهَ عَزِيزٌ حَكِيمٌۭ",
    words(261, 0, 3),
    words(261, 1, 8),
  ],
  [GROUP, 1, 2, 264, "البقرة", "بربوة", words(264, 18), words(265, 0, 4), words(265, 4, 13)],
  ...tailRefs,
];
const NEW_REFS = [
  [GROUP, 0, 2, 261, "البقرة", "ينفقون", "وَٱعْلَمْ أَنَّ ٱللَّهَ عَزِيزٌ حَكِيمٌ", words(261, 0, 3), words(261, 3, 8)],
  [GROUP, 2, 2, 265, "البقرة", "بربوة", words(264, 18), words(265, 0, 4), words(265, 4, 13)],
  ...tailRefs,
];
const rowsFile = (version = MUTASHABIHAT_DATA_VERSION, refs: readonly (readonly unknown[])[] = NEW_REFS) => ({
  schema_version: "1.0",
  version,
  groups,
  refs,
});

let store: OutboxDatabase;

function seedRefs(refs: readonly (readonly unknown[])[]) {
  const group = store.sql.prepare(
    "INSERT INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES (?, ?, ?, ?, ?)",
  );
  for (const row of groups) group.run(...row);
  const ref = store.sql.prepare(
    "INSERT INTO mutashabihat_refs (group_id, sort_order, surah, ayah, surah_name_ar, tail_5, pre_text, similar_text, post_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const row of refs) ref.run(...(row as never[]));
}

function seedCard(id: string, reps: number) {
  store.sql
    .prepare(
      `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
         reps, lapses, state, last_review, created_at, updated_at)
       VALUES (?, ?, '2026-11-20T00:00:00.000Z', 9.5, 4.2, 3, 9, 0, ?, 0, 2, '2026-11-11T00:00:00.000Z',
         '2026-10-01T00:00:00.000Z', '2026-11-11T00:00:00.000Z')`,
    )
    .run(id, SMART_DECK_IDS.mutashabihat, reps);
  const log = store.sql.prepare(
    `INSERT INTO study_log (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reviewed_at)
     VALUES (?, 3, 2, '2026-11-20T00:00:00.000Z', 9.5, 4.2, 3, 9, ?)`,
  );
  for (let k = 0; k < reps; k += 1) log.run(id, `2026-11-0${k + 1}T08:00:00.000Z`);
}

const card = (id: string) =>
  store.sql.prepare("SELECT * FROM study_cards WHERE id = ?").get(id) as Record<string, unknown>;
const queue = () => store.sql.prepare("SELECT table_name, operation, row_id FROM sync_queue ORDER BY id").all();
const logCount = (id: string) =>
  (store.sql.prepare("SELECT COUNT(*) AS n FROM study_log WHERE card_id = ?").get(id) as { n: number }).n;
const refsNow = () =>
  store.sql
    .prepare("SELECT group_id, sort_order, surah, ayah FROM mutashabihat_refs ORDER BY group_id, sort_order")
    .all();

beforeEach(async () => {
  store = await openOutboxDatabase();
  store.sql.exec(
    "INSERT INTO surahs (number, name_arabic, name_english, ayah_count, revelation_type) VALUES (2, 'البقرة', 'Al-Baqarah', 286, 'Madaniyah')",
  );
  const ayah = store.sql.prepare(
    "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (2, ?, ?, ?, ?, 44)",
  );
  for (const [number, text] of Object.entries(AYAT)) {
    const glyphs = text
      .split(" ")
      .map((_, index) => `G${number}-${index}`)
      .join(" ");
    ayah.run(Number(number), text, text, glyphs);
  }
});

afterEach(async () => {
  await store.close();
});

describe("the similar-verse rows refresh", () => {
  beforeEach(() => {
    seedRefs(OLD_REFS);
    seedCard(`mutashabihat:${GROUP}:0`, 2);
    seedCard(`mutashabihat:${GROUP}:1`, 3);
    seedCard("2:255", 1);
  });

  it("replaces an installed app's rows and deletes the card whose sort order now belongs to no verse", async () => {
    const before = await getSmartCardContent(store.db, `mutashabihat:${GROUP}:1`);
    expect(before?.targetRef).toMatchObject({ surah: 2, ayah: 264, similarText: words(265, 0, 4) });
    const kept = card(`mutashabihat:${GROUP}:0`);
    const load = jest.fn(async () => rowsFile());

    await expect(refreshMutashabihatRows(store.db, load)).resolves.toEqual({
      replaced: true,
      retiredCards: [`mutashabihat:${GROUP}:1`],
    });

    expect(refsNow()).toEqual([
      { group_id: GROUP, sort_order: 0, surah: 2, ayah: 261 },
      { group_id: GROUP, sort_order: 2, surah: 2, ayah: 265 },
      { group_id: TAIL, sort_order: 0, surah: 2, ayah: 261 },
      { group_id: TAIL, sort_order: 1, surah: 2, ayah: 265 },
    ]);
    expect(card(`mutashabihat:${GROUP}:1`).deleted_at).toEqual(expect.any(String));
    expect(queue()).toEqual([{ table_name: "study_cards", operation: "DELETE", row_id: `mutashabihat:${GROUP}:1` }]);
    expect(logCount(`mutashabihat:${GROUP}:1`)).toBe(3);
    expect(card(`mutashabihat:${GROUP}:0`)).toEqual(kept);
    expect(card("2:255").deleted_at).toBeNull();

    await expect(getSmartCardContent(store.db, `mutashabihat:${GROUP}:1`)).resolves.toBeNull();
    const relabelled = await getSmartCardContent(store.db, `mutashabihat:${GROUP}:2`);
    expect(relabelled?.targetRef).toMatchObject({ surah: 2, ayah: 265, similarText: words(265, 0, 4) });
    await expect(getSmartDeckCandidateCardIds(store.db, SMART_DECK_IDS.mutashabihat)).resolves.toEqual([
      `mutashabihat:${GROUP}:0`,
      `mutashabihat:${GROUP}:2`,
    ]);
    expect(
      store.sql.prepare("SELECT value FROM user_settings WHERE key = ?").get(MUTASHABIHAT_VERSION_SETTING),
    ).toEqual({
      value: MUTASHABIHAT_DATA_VERSION,
    });
  });

  it("no longer pairs a drift into 2:264 with 2:265's text, and pairs 2:261 with 2:265 itself", async () => {
    const drifted = await similarPair(store.db, { surah: 2, ayah: 261 }, { surah: 2, ayah: 264 });
    expect(drifted?.sibling).toMatchObject({ ayah: 264, similar: words(265, 0, 4) });

    await refreshMutashabihatRows(store.db, async () => rowsFile());

    await expect(similarPair(store.db, { surah: 2, ayah: 261 }, { surah: 2, ayah: 264 })).resolves.toBeNull();
    const pair = await similarPair(store.db, { surah: 2, ayah: 261 }, { surah: 2, ayah: 265 });
    expect(pair?.groupId).toBe(GROUP);
    expect(pair?.sibling).toMatchObject({ ayah: 265, similar: words(265, 0, 4) });
  });

  it("deletes a retired slot's card that arrived after the version was recorded, and no other card", async () => {
    await refreshMutashabihatRows(store.db, async () => rowsFile());
    store.sql.prepare("DELETE FROM study_cards WHERE id = ?").run(`mutashabihat:${GROUP}:1`);
    seedCard(`mutashabihat:${GROUP}:1`, 0);
    store.sql.exec("DELETE FROM sync_queue");
    const kept = card(`mutashabihat:${GROUP}:0`);
    const load = jest.fn(async () => rowsFile());

    await expect(refreshMutashabihatRows(store.db, load)).resolves.toEqual({
      replaced: false,
      retiredCards: [`mutashabihat:${GROUP}:1`],
    });
    expect(load).not.toHaveBeenCalled();
    expect(card(`mutashabihat:${GROUP}:1`).deleted_at).toEqual(expect.any(String));
    expect(queue()).toEqual([{ table_name: "study_cards", operation: "DELETE", row_id: `mutashabihat:${GROUP}:1` }]);
    expect(logCount(`mutashabihat:${GROUP}:1`)).toBe(3);
    expect(card(`mutashabihat:${GROUP}:0`)).toEqual(kept);
    expect(card("2:255").deleted_at).toBeNull();
  });

  it("does nothing once the database holds this version, without reading the file", async () => {
    await refreshMutashabihatRows(store.db, async () => rowsFile());
    const queued = queue().length;
    const load = jest.fn(async () => rowsFile());
    await expect(refreshMutashabihatRows(store.db, load)).resolves.toEqual({ replaced: false, retiredCards: [] });
    expect(load).not.toHaveBeenCalled();
    expect(queue()).toHaveLength(queued);
  });

  it("writes nothing from a stale or malformed file, so the next launch tries again", async () => {
    await expect(refreshMutashabihatRows(store.db, async () => rowsFile("0000000000000000"))).rejects.toThrow(
      /version/,
    );
    const unaligned = NEW_REFS.map((row) =>
      row[1] === 2 && row[0] === GROUP ? [...row.slice(0, 7), "", row[8]] : row,
    );
    await expect(refreshMutashabihatRows(store.db, async () => rowsFile(undefined, unaligned))).rejects.toThrow(
      /similar words/,
    );
    expect(refsNow()).toContainEqual({ group_id: GROUP, sort_order: 1, surah: 2, ayah: 264 });
    expect(card(`mutashabihat:${GROUP}:1`).deleted_at).toBeNull();
    expect(queue()).toEqual([]);
  });
});

describe("the similar-verse rows on a new install", () => {
  it("only records the version when the bundled rows are already these", async () => {
    seedRefs(NEW_REFS);
    seedCard(`mutashabihat:${GROUP}:2`, 1);
    await expect(refreshMutashabihatRows(store.db, async () => rowsFile())).resolves.toEqual({
      replaced: false,
      retiredCards: [],
    });
    expect(queue()).toEqual([]);
    expect(card(`mutashabihat:${GROUP}:2`).deleted_at).toBeNull();
  });

  it("fills empty tables from the rows file", async () => {
    await expect(refreshMutashabihatRows(store.db, async () => rowsFile())).resolves.toMatchObject({ replaced: true });
    expect(refsNow()).toHaveLength(NEW_REFS.length);
  });
});

test("the rows file is refused when a similar ref has no similar words or no group", () => {
  expect(() => parseMutashabihatRows(rowsFile())).not.toThrow();
  expect(() => parseMutashabihatRows(rowsFile(undefined, [[GROUP, 0, 2, 261, null, null, "x", "   ", "y"]]))).toThrow(
    /similar words/,
  );
  expect(() =>
    parseMutashabihatRows(rowsFile(undefined, [["missing", 0, 2, 261, null, null, null, null, null]])),
  ).toThrow(/no group/);
  expect(() => parseMutashabihatRows({ ...rowsFile(), schema_version: "2.0" })).toThrow(/Unsupported/);
});
