import { readFileSync } from "node:fs";
import path from "node:path";
import { getDueCardsForReview, getSmartDeckTodayRows, getSmartCardContent, getSmartDeckCandidateCardIds, SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { splitQuranWords, tailLetters } from "@/lib/fsrs/similar-card-text";
import { recordMemorizedPortion } from "@/lib/hifz/memorized-ayahs";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

// One fixture card stands in for a card on the generated exclusion list.
jest.mock("@/lib/fsrs/similar-card-exclusions", () => ({
  isExcludedSimilarCard: (id: string) => id === "mutashabihat:excluded:1",
}));

/**
 * The similar-verse card prompt shows the ayah up to the end of its similar words. The bundled
 * segments are the Uthmani text, which the plain text does not always spell the same way: in 15:88
 * the similar words carry "أَزْوَٰجًا" and the plain text "أَزْوَاجًا". The ayat and refs are copied
 * from the bundled database; the page-font glyphs are stand-ins.
 */
const AYAT: [number, number, string, string][] = [
  [
    15,
    87,
    "وَلَقَدْ ءَاتَيْنَٰكَ سَبْعًا مِّنَ ٱلْمَثَانِى وَٱلْقُرْءَانَ ٱلْعَظِيمَ",
    "وَلَقَدْ آتَيْنَاكَ سَبْعًا مِّنَ الْمَثَانِي وَالْقُرْآنَ الْعَظِيمَ",
  ],
  [
    15,
    88,
    "لَا تَمُدَّنَّ عَيْنَيْكَ إِلَىٰ مَا مَتَّعْنَا بِهِۦٓ أَزْوَٰجًا مِّنْهُمْ وَلَا تَحْزَنْ عَلَيْهِمْ وَٱخْفِضْ جَنَاحَكَ لِلْمُؤْمِنِينَ",
    "لَا تَمُدَّنَّ عَيْنَيْكَ إِلَىٰ مَا مَتَّعْنَا بِهِ أَزْوَاجًا مِّنْهُمْ وَلَا تَحْزَنْ عَلَيْهِمْ وَاخْفِضْ جَنَاحَكَ لِلْمُؤْمِنِينَ",
  ],
  [
    20,
    131,
    "وَلَا تَمُدَّنَّ عَيْنَيْكَ إِلَىٰ مَا مَتَّعْنَا بِهِۦٓ أَزْوَٰجًا مِّنْهُمْ زَهْرَةَ ٱلْحَيَوٰةِ ٱلدُّنْيَا لِنَفْتِنَهُمْ فِيهِ وَرِزْقُ رَبِّكَ خَيْرٌ وَأَبْقَىٰ",
    "وَلَا تَمُدَّنَّ عَيْنَيْكَ إِلَىٰ مَا مَتَّعْنَا بِهِ أَزْوَاجًا مِّنْهُمْ زَهْرَةَ الْحَيَاةِ الدُّنْيَا لِنَفْتِنَهُمْ فِيهِ وَرِزْقُ رَبِّكَ خَيْرٌ وَأَبْقَىٰ",
  ],
];
const SIMILAR = "لَا تَمُدَّنَّ عَيْنَيْكَ إِلَىٰ مَا مَتَّعْنَا بِهِۦٓ أَزْوَٰجًا مِّنْهُمْ";

let store: OutboxDatabase;

beforeEach(async () => {
  store = await openOutboxDatabase();
  const surah = store.sql.prepare(
    "INSERT INTO surahs (number, name_arabic, name_english, ayah_count, revelation_type) VALUES (?, ?, ?, ?, 'Makkiyah')",
  );
  surah.run(15, "الحجر", "Al-Hijr", 99);
  surah.run(20, "طه", "Ta-Ha", 135);
  const ayah = store.sql.prepare(
    "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (?, ?, ?, ?, ?, 1)",
  );
  for (const [number, ayahNumber, uthmani, clean] of AYAT) {
    const glyphs = uthmani
      .split(" ")
      .map((_, index) => `G${ayahNumber}-${index}`)
      .concat(`E${ayahNumber}`)
      .join(" ");
    ayah.run(number, ayahNumber, uthmani, clean, glyphs);
  }
  store.sql.exec(
    "INSERT INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES ('g', 'similar', 'لا - ولا تمدن عينيك', 'test', 0)",
  );
  const ref = store.sql.prepare(
    "INSERT INTO mutashabihat_refs (group_id, sort_order, surah, ayah, surah_name_ar, pre_text, similar_text, post_text) VALUES ('g', ?, ?, ?, ?, ?, ?, ?)",
  );
  ref.run(0, 15, 88, "الحجر", AYAT[0][2], SIMILAR, "وَلَا تَحْزَنْ عَلَيْهِمْ وَٱخْفِضْ جَنَاحَكَ لِلْمُؤْمِنِينَ");
  ref.run(1, 20, 131, "طه", "", `وَ${SIMILAR}`, "زَهْرَةَ ٱلْحَيَوٰةِ ٱلدُّنْيَا");
});

afterEach(async () => {
  await store.close();
});

test("a similar-verse card prompt ends with the similar words when only the Uthmani text spells them alike", async () => {
  const content = await getSmartCardContent(store.db, "mutashabihat:g:0");
  expect(content).toMatchObject({
    prefixWordCount: 9,
    promptUthmani: SIMILAR,
    promptQcf2: Array.from({ length: 9 }, (_, index) => `G88-${index}`).join(" "),
  });
});

test("the preceding ayah cue carries its own Unicode text", async () => {
  store.sql.exec("UPDATE mutashabihat_refs SET similar_text = NULL");
  store.sql.exec(
    "UPDATE quran_text SET text_clean = (SELECT text_clean FROM quran_text WHERE surah = 15 AND ayah = 88) WHERE surah = 20 AND ayah = 131",
  );

  await expect(getSmartCardContent(store.db, "mutashabihat:g:0")).resolves.toMatchObject({
    promptContextUthmani: AYAT[0][2],
    promptContextQcf2: "G87-0 G87-1 G87-2 G87-3 G87-4 G87-5 G87-6 E87",
    promptUthmani: AYAT[1][2],
    needsExplicitRefLabel: true,
  });
});

test("a tail card keeps a leading hizb mark with the first word, and uses Unicode only for an unknown layout", async () => {
  store.sql.exec("UPDATE mutashabihat_groups SET kind = 'tail', cue = 'للمؤمنين' WHERE id = 'g'");
  const cardId = "similar-tail:g:0";
  const words = AYAT[1][2].split(" ");
  const prefix = words.slice(0, -1).join(" ");
  const tail = words.at(-1);
  await expect(getSmartCardContent(store.db, cardId)).resolves.toMatchObject({
    promptUthmani: prefix,
    promptQcf2: Array.from({ length: words.length - 1 }, (_, index) => `G88-${index}`).join(" "),
    hiddenAnswerQcf2: `G88-${words.length - 1} E88`,
    hiddenAnswerUthmani: tail,
  });

  // A quarter's opening ayah has the ۞ mark as glyph 0 (lib/mushaf/glyph-words).
  store.sql.exec("UPDATE quran_text SET text_qcf2 = 'mark ' || text_qcf2 WHERE surah = 15 AND ayah = 88");
  await expect(getSmartCardContent(store.db, cardId)).resolves.toMatchObject({
    promptUthmani: prefix,
    promptQcf2: ["mark", ...Array.from({ length: words.length - 1 }, (_, index) => `G88-${index}`)].join(" "),
    hiddenAnswerQcf2: `G88-${words.length - 1} E88`,
    hiddenAnswerUthmani: tail,
  });

  // Two extra glyphs match no known layout, so both sides stay Unicode.
  store.sql.exec("UPDATE quran_text SET text_qcf2 = 'mark ' || text_qcf2 WHERE surah = 15 AND ayah = 88");
  await expect(getSmartCardContent(store.db, cardId)).resolves.toMatchObject({
    promptUthmani: prefix,
    promptQcf2: undefined,
    hiddenAnswerQcf2: undefined,
    hiddenAnswerUthmani: tail,
  });
});

/**
 * 101:6's similar words run on into 101:7 ("فَأَمَّا مَن ثَقُلَتْ مَوَٰزِينُهُۥ فَهُوَ فِى عِيشَةٍ رَّاضِيَةٍ"),
 * so only their start is in the ayah, and the prompt is the whole ayah. Copied from the bundled
 * database; glyphs are stand-ins.
 */
test("a similar-verse card prompt runs to the ayah's end when its similar words run on into the next ayah", async () => {
  store.sql.exec(
    "INSERT INTO surahs (number, name_arabic, name_english, ayah_count, revelation_type) VALUES (7, 'الأعراف', 'Al-A''raf', 206, 'Makkiyah'), (101, 'القارعة', 'Al-Qariah', 11, 'Makkiyah')",
  );
  const ayah = store.sql.prepare(
    "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (?, ?, ?, ?, ?, 1)",
  );
  const ayat: [number, number, string, string][] = [
    [101, 6, "فَأَمَّا مَن ثَقُلَتْ مَوَٰزِينُهُۥ", "فَأَمَّا مَن ثَقُلَتْ مَوَازِينُهُ"],
    [
      7,
      8,
      "وَٱلْوَزْنُ يَوْمَئِذٍ ٱلْحَقُّ فَمَن ثَقُلَتْ مَوَٰزِينُهُۥ فَأُو۟لَٰٓئِكَ هُمُ ٱلْمُفْلِحُونَ",
      "وَالْوَزْنُ يَوْمَئِذٍ الْحَقُّ فَمَن ثَقُلَتْ مَوَازِينُهُ فَأُولَٰئِكَ هُمُ الْمُفْلِحُونَ",
    ],
  ];
  for (const [surah, number, uthmani, clean] of ayat) {
    const words = uthmani.split(" ");
    const glyphs = [...words.map((_, index) => `G${number}-${index}`), `E${number}`].join(" ");
    ayah.run(surah, number, uthmani, clean, glyphs);
  }
  store.sql.exec(
    "INSERT INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES ('w', 'similar', 'ثقلت موازينه', 'test', 1)",
  );
  const ref = store.sql.prepare(
    "INSERT INTO mutashabihat_refs (group_id, sort_order, surah, ayah, surah_name_ar, pre_text, similar_text, post_text) VALUES ('w', ?, ?, ?, ?, ?, ?, ?)",
  );
  ref.run(
    3,
    7,
    8,
    "الأعراف",
    "وَٱلْوَزْنُ يَوْمَئِذٍ ٱلْحَقُّ",
    "فَمَن ثَقُلَتْ مَوَٰزِينُهُۥ فَأُو۟لَٰٓئِكَ هُمُ ٱلْمُفْلِحُونَ",
    "",
  );
  ref.run(
    5,
    101,
    6,
    "القارعة",
    "وَتَكُونُ ٱلْجِبَالُ كَٱلْعِهْنِ ٱلْمَنفُوشِ",
    "فَأَمَّا مَن ثَقُلَتْ مَوَٰزِينُهُۥ فَهُوَ فِى عِيشَةٍ رَّاضِيَةٍ",
    "وَأَمَّا مَنْ خَفَّتْ مَوَٰزِينُهُۥ فَأُمُّهُۥ هَاوِيَةٌ",
  );

  await expect(getSmartCardContent(store.db, "mutashabihat:w:5")).resolves.toMatchObject({
    prefixWordCount: 4,
    promptUthmani: "فَأَمَّا مَن ثَقُلَتْ مَوَٰزِينُهُۥ",
    promptQcf2: "G6-0 G6-1 G6-2 G6-3",
    needsExplicitRefLabel: false,
  });
});

/**
 * Real ayat from the bundled Quran text, with stand-in page-font glyphs ("2:27#0" ... "2:27#E") and
 * the diacritic-free search text the database builds.
 */
const QURAN_DATA = JSON.parse(
  readFileSync(path.join(__dirname, "..", "..", "assets", "data", "quran-data.json"), "utf8"),
).tables as {
  surahs: { number: number; name_arabic: string; name_english: string; ayah_count: number }[];
  quran_text: { surah: number; ayah: number; text_uthmani: string; text_clean: string }[];
};
const SEARCH_MARKS = /[ً-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭـ]/g;

function addAyat(...keys: string[]): void {
  const surah = store.sql.prepare(
    "INSERT OR IGNORE INTO surahs (number, name_arabic, name_english, ayah_count, revelation_type) VALUES (?, ?, ?, ?, 'Makkiyah')",
  );
  const ayah = store.sql.prepare(
    "INSERT OR IGNORE INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page, text_search) VALUES (?, ?, ?, ?, ?, 1, ?)",
  );
  for (const key of keys) {
    const [surahNumber, ayahNumber] = key.split(":").map(Number);
    const info = QURAN_DATA.surahs.find((item) => item.number === surahNumber)!;
    const row = QURAN_DATA.quran_text.find((item) => item.surah === surahNumber && item.ayah === ayahNumber)!;
    surah.run(surahNumber, info.name_arabic, info.name_english, info.ayah_count);
    const glyphs = [...splitQuranWords(row.text_uthmani).map((_, index) => `${key}#${index}`), `${key}#E`].join(" ");
    ayah.run(surahNumber, ayahNumber, row.text_uthmani, row.text_clean, glyphs, row.text_clean.replace(SEARCH_MARKS, ""));
  }
}

function quranRow(key: string) {
  const [surahNumber, ayahNumber] = key.split(":").map(Number);
  return QURAN_DATA.quran_text.find((item) => item.surah === surahNumber && item.ayah === ayahNumber)!;
}

const uthmani = (key: string) => quranRow(key).text_uthmani;
const plain = (key: string) => quranRow(key).text_clean;

/**
 * The shipped last five words (`tail_5`) of each tail ref's ayah. The old matcher fell back to them
 * when the cue did not match, which is how it hid "تسبيحهم" in 17:44, so the fixture carries them.
 */
const SHIPPED_TAIL_5 = new Map<string, string | null>(
  (
    JSON.parse(
      readFileSync(path.join(__dirname, "..", "..", "assets", "data", "mutashabihat", "nourquran_hafiz_rows.json"), "utf8"),
    ).refs as [string, number, number, number, string | null, string | null][]
  ).map(([, , surah, ayah, , tail5]) => [`${surah}:${ayah}`, tail5]),
);

/** A group of refs, each "surah:ayah" or [surah:ayah, pre_text, similar_text]. */
function addGroup(id: string, kind: "similar" | "tail", cue: string, refs: (string | [string, string, string])[]): void {
  store.sql
    .prepare("INSERT INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES (?, ?, ?, 'test', 9)")
    .run(id, kind, cue);
  const insert = store.sql.prepare(
    "INSERT INTO mutashabihat_refs (group_id, sort_order, surah, ayah, surah_name_ar, tail_5, pre_text, similar_text) VALUES (?, ?, ?, ?, '', ?, ?, ?)",
  );
  refs.forEach((ref, sortOrder) => {
    const [key, pre, similar] = typeof ref === "string" ? [ref, null, null] : ref;
    addAyat(key);
    const [surahNumber, ayahNumber] = key.split(":").map(Number);
    insert.run(id, sortOrder, surahNumber, ayahNumber, kind === "tail" ? SHIPPED_TAIL_5.get(key) ?? null : null, pre, similar);
  });
}

describe("a Similar tails card hides exactly the cue's words at the ayah's end", () => {
  // The cue, the ayah, how many words it hides and, in plain spelling, the front's last word, which
  // the owner named for each card.
  const cases: [string, string, number, string][] = [
    // "(و)-(ف)": either prefix or none on the next word, and the word before stays on the front.
    ["(و)-(ف)أولئك هم الخاسرون", "2:27", 3, "الأرض"],
    ["(و)-(ف)أولئك هم الخاسرون", "2:121", 3, "به"],
    ["(و)-(ف)أولئك هم الخاسرون", "9:69", 3, "والآخرة"],
    // The owner's exception: a bare word after "بل" takes "بل" with it (24:50 hides "بل أولئك هم الظالمون").
    ["(و)-(ف)أولئك هم الظالمون", "24:50", 4, "ورسوله"],
    ["(و)-(ف)أولئك هم الظالمون", "49:11", 3, "يتب"],
    // "(و)" attached or standing apart is an optional prefix.
    ["(و)لعلهم يتقون", "7:164", 2, "ربكم"],
    ["(و) بما كانوا يصنعون", "16:112", 3, "والخوف"],
    // The cue's "غفور" for the ayah's "غفورا": one letter at a word's end.
    ["إنه كان حليما غفور", "17:44", 4, "تسبيحهم"],
    // A joining ف the cue does not write: 33:54 hides "فإن الله كان بكل شيء عليما".
    ["إن الله كان بكل شيء عليما", "33:54", 6, "تخفوه"],
    // A cue that ends before the ayah does hides from the cue on.
    ["إن كنتم مؤمنين", "11:86", 7, "لكم"],
  ];

  test.each(cases)("%s on %s", async (cue, key, hiddenCount, lastFrontWord) => {
    addGroup("t", "tail", cue, [key]);
    const content = await getSmartCardContent(store.db, "similar-tail:t:0");
    const words = splitQuranWords(uthmani(key));
    expect(content).toMatchObject({
      hiddenAnswerUthmani: words.slice(-hiddenCount).join(" "),
      promptUthmani: words.slice(0, -hiddenCount).join(" "),
      prefixWordCount: words.length - hiddenCount,
      hiddenAnswerQcf2: [...Array.from({ length: hiddenCount }, (_, i) => `${key}#${words.length - hiddenCount + i}`), `${key}#E`].join(" "),
    });
    const plainWords = splitQuranWords(plain(key));
    expect(tailLetters(plainWords[plainWords.length - hiddenCount - 1])).toBe(tailLetters(lastFrontWord));
  });

  test("a card whose cue is the whole ayah is not offered, with the same split", async () => {
    addGroup("t", "tail", "أفلا تذكرون", ["37:155", "11:30"]);
    await expect(getSmartDeckCandidateCardIds(store.db, SMART_DECK_IDS.similarTails, { type: "all" })).resolves.toEqual([
      "similar-tail:t:1",
    ]);
    await expect(getSmartCardContent(store.db, "similar-tail:t:0")).resolves.toBeNull();
  });
});

describe("what a similar-verse card's back answers", () => {
  test("a front short of the ayah's end answers the rest of the ayah, in glyphs when the front has them", async () => {
    const content = await getSmartCardContent(store.db, "mutashabihat:g:0");
    expect(content).toMatchObject({
      answerKind: "rest",
      hiddenAnswerUthmani: AYAT[1][2].split(" ").slice(9).join(" "),
      hiddenAnswerQcf2: [...Array.from({ length: 6 }, (_, index) => `G88-${9 + index}`), "E88"].join(" "),
    });
    expect(content?.nextAyah).toBeUndefined();
  });

  test("a whole-ayah front asks for the next ayah, with the ayah before it above", async () => {
    addAyat("56:73", "56:75");
    addGroup("s", "similar", "فسبح باسم ربك العظيم", ["56:74", "56:96", "69:52"]);
    const content = await getSmartCardContent(store.db, "mutashabihat:s:0");
    expect(content).toMatchObject({
      answerKind: "nextAyah",
      promptUthmani: uthmani("56:74"),
      promptContextUthmani: uthmani("56:73"),
      promptContextQcf2: [...splitQuranWords(uthmani("56:73")).map((_, i) => `56:73#${i}`), "56:73#E"].join(" "),
      nextAyah: {
        surah: 56,
        ayah: 75,
        textUthmani: uthmani("56:75"),
        textQcf2: [...splitQuranWords(uthmani("56:75")).map((_, i) => `56:75#${i}`), "56:75#E"].join(" "),
        v2Page: 1,
      },
    });
    expect(content?.hiddenAnswerUthmani).toBeUndefined();
  });

  test("a whole-ayah front on a surah's last ayah answers that the surah ends there", async () => {
    addAyat("69:51");
    addGroup("s", "similar", "فسبح باسم ربك العظيم", ["56:74", "56:96", "69:52"]);
    const content = await getSmartCardContent(store.db, "mutashabihat:s:2");
    expect(content).toMatchObject({ answerKind: "surahEnd", promptContextUthmani: uthmani("69:51") });
    expect(content?.nextAyah).toBeUndefined();
  });

  test("a surah's first ayah has no ayah above it, not even the last ayah of the surah before", async () => {
    addAyat("1:7", "2:2");
    addGroup("a", "similar", "الم .. أول السورة", ["2:1", "3:1"]);
    const content = await getSmartCardContent(store.db, "mutashabihat:a:0");
    expect(content).toMatchObject({
      answerKind: "nextAyah",
      needsExplicitRefLabel: true,
      nextAyah: { surah: 2, ayah: 2, textUthmani: uthmani("2:2") },
    });
    expect(content?.promptContextUthmani).toBeUndefined();
    expect(content?.promptContextQcf2).toBeUndefined();
  });

  test("a whole first ayah whose opening its group tells apart is still named, since nothing stands above it", async () => {
    addAyat("89:5", "105:2");
    addGroup("f", "similar", "ألم تر كيف فعل ربك", [
      ["89:6", "هَلْ فِى ذَٰلِكَ قَسَمٌ لِّذِى حِجْرٍ", "أَلَمْ تَرَ كَيْفَ فَعَلَ رَبُّكَ بِعَادٍ"],
      ["105:1", "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ", "أَلَمْ تَرَ كَيْفَ فَعَلَ رَبُّكَ بِأَصْحَٰبِ ٱلْفِيلِ"],
    ]);
    const content = await getSmartCardContent(store.db, "mutashabihat:f:1");
    expect(content).toMatchObject({ answerKind: "nextAyah", needsExplicitRefLabel: true, promptUthmani: uthmani("105:1") });
    expect(content?.promptContextUthmani).toBeUndefined();
  });

  const FRONT_9_22 = splitQuranWords(uthmani("9:22")).slice(0, 3).join(" ");

  test("a front its group tells apart but that opens another ayah is named, with the ayah before it", async () => {
    addAyat("9:21");
    addGroup("k", "similar", "خالدين (فيها-فيه)", [
      ["3:88", "", uthmani("3:88")],
      ["9:22", "", FRONT_9_22],
    ]);
    await expect(getSmartCardContent(store.db, "mutashabihat:k:1")).resolves.toMatchObject({
      promptUthmani: FRONT_9_22,
      needsExplicitRefLabel: false,
      answerKind: "rest",
    });

    // 33:65 opens with the same three words.
    addAyat("33:65");
    await expect(getSmartCardContent(store.db, "mutashabihat:k:1")).resolves.toMatchObject({
      promptUthmani: FRONT_9_22,
      needsExplicitRefLabel: true,
      promptContextUthmani: uthmani("9:21"),
      answerKind: "rest",
    });
  });

  test("only offers a memorized target with a different memorized ayah, including outside the target filter", async () => {
    addGroup("pair", "similar", "shared", ["2:1", "3:1", "3:2"]);
    addGroup("same", "similar", "shared", ["2:1", "2:2"]);
    const deck = SMART_DECK_IDS.mutashabihat;
    const candidates = () => getSmartDeckCandidateCardIds(store.db, deck, { type: "surah", surahs: [2] });
    const saved = "mutashabihat:pair:0";
    store.sql.prepare(`INSERT INTO study_cards
      (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, state, created_at, updated_at)
      VALUES (?, ?, '2025-01-01', 4, 2, 0, 1, 0, 3, 2, '2025-01-01', '2025-01-01')`).run(saved, deck);
    expect(await candidates()).toEqual([]);
    await recordMemorizedPortion(store.db, [2], []);
    expect(await candidates()).toEqual(["mutashabihat:same:0", "mutashabihat:same:1"]);
    const today = await getSmartDeckTodayRows(store.db, deck, 5);
    expect(today.dueRows).toEqual([]);
    expect(today.virtualNew.map(row => row.id)).toEqual(["mutashabihat:same:0", "mutashabihat:same:1"]);
    expect(await getDueCardsForReview(store.db, deck)).toEqual([]);
    await recordMemorizedPortion(store.db, [2, 3], []);
    expect(await candidates()).toContain(saved);
    expect(await candidates()).not.toContain("mutashabihat:pair:1");
    expect(await getDueCardsForReview(store.db, deck)).toEqual([expect.objectContaining({ id: saved, reps: 3, stability: 4 })]);
  });

  test("a card on the exclusion list is not offered", async () => {
    addGroup("excluded", "similar", "فسبح باسم ربك العظيم", ["56:74", "56:96", "69:52"]);
    store.sql.exec("INSERT INTO user_settings (key, value, updated_at) VALUES ('habit_declared_whole_quran', 'true', '2026-11-01')");
    const ids = await getSmartDeckCandidateCardIds(store.db, SMART_DECK_IDS.mutashabihat, { type: "all" });
    expect(ids).toEqual(expect.arrayContaining(["mutashabihat:excluded:0", "mutashabihat:excluded:2"]));
    expect(ids).not.toContain("mutashabihat:excluded:1");
  });
});
