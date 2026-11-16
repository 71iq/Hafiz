import { getSmartCardContent } from "@/lib/fsrs/smart-decks";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

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
