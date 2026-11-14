import React from "react";
import { render, screen } from "@testing-library/react-native";
import { Platform, StyleSheet } from "react-native";
import { SimilarVerseLine } from "@/components/hifz/SimilarVerseLine";
import { similarGroupsForAyahs, type SimilarRef } from "@/lib/hifz/similar";
import { continuesIn } from "@/lib/hifz/word-diff";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/**
 * MUT-01, MUT-04: a similar-verse passage from the bundled data, shown where its segments do not run
 * on in the Quran. The ayat (quran_text) and the refs (mutashabihat_refs) are copied from the bundled
 * database; only the ayat a card needs around it are seeded.
 */
const AYAT: Record<string, string> = {
  "2:177":
    "لَّيْسَ ٱلْبِرَّ أَن تُوَلُّوا۟ وُجُوهَكُمْ قِبَلَ ٱلْمَشْرِقِ وَٱلْمَغْرِبِ وَلَٰكِنَّ ٱلْبِرَّ مَنْ ءَامَنَ بِٱللَّهِ وَٱلْيَوْمِ ٱلْـَٔاخِرِ وَٱلْمَلَٰٓئِكَةِ وَٱلْكِتَٰبِ وَٱلنَّبِيِّـۧنَ وَءَاتَى ٱلْمَالَ عَلَىٰ حُبِّهِۦ ذَوِى ٱلْقُرْبَىٰ وَٱلْيَتَٰمَىٰ وَٱلْمَسَٰكِينَ وَٱبْنَ ٱلسَّبِيلِ وَٱلسَّآئِلِينَ وَفِى ٱلرِّقَابِ وَأَقَامَ ٱلصَّلَوٰةَ وَءَاتَى ٱلزَّكَوٰةَ وَٱلْمُوفُونَ بِعَهْدِهِمْ إِذَا عَٰهَدُوا۟ وَٱلصَّٰبِرِينَ فِى ٱلْبَأْسَآءِ وَٱلضَّرَّآءِ وَحِينَ ٱلْبَأْسِ أُو۟لَٰٓئِكَ ٱلَّذِينَ صَدَقُوا۟ وَأُو۟لَٰٓئِكَ هُمُ ٱلْمُتَّقُونَ",
  "2:178":
    "يَٰٓأَيُّهَا ٱلَّذِينَ ءَامَنُوا۟ كُتِبَ عَلَيْكُمُ ٱلْقِصَاصُ فِى ٱلْقَتْلَى ٱلْحُرُّ بِٱلْحُرِّ وَٱلْعَبْدُ بِٱلْعَبْدِ وَٱلْأُنثَىٰ بِٱلْأُنثَىٰ فَمَنْ عُفِىَ لَهُۥ مِنْ أَخِيهِ شَىْءٌ فَٱتِّبَاعٌۢ بِٱلْمَعْرُوفِ وَأَدَآءٌ إِلَيْهِ بِإِحْسَٰنٍ ذَٰلِكَ تَخْفِيفٌ مِّن رَّبِّكُمْ وَرَحْمَةٌ فَمَنِ ٱعْتَدَىٰ بَعْدَ ذَٰلِكَ فَلَهُۥ عَذَابٌ أَلِيمٌ",
  "2:179": "وَلَكُمْ فِى ٱلْقِصَاصِ حَيَوٰةٌ يَٰٓأُو۟لِى ٱلْأَلْبَٰبِ لَعَلَّكُمْ تَتَّقُونَ",
  "3:131": "وَٱتَّقُوا۟ ٱلنَّارَ ٱلَّتِىٓ أُعِدَّتْ لِلْكَٰفِرِينَ",
  "3:132": "وَأَطِيعُوا۟ ٱللَّهَ وَٱلرَّسُولَ لَعَلَّكُمْ تُرْحَمُونَ",
  "3:133":
    "وَسَارِعُوٓا۟ إِلَىٰ مَغْفِرَةٍ مِّن رَّبِّكُمْ وَجَنَّةٍ عَرْضُهَا ٱلسَّمَٰوَٰتُ وَٱلْأَرْضُ أُعِدَّتْ لِلْمُتَّقِينَ",
  "26:68": "وَإِنَّ رَبَّكَ لَهُوَ ٱلْعَزِيزُ ٱلرَّحِيمُ",
  "26:69": "وَٱتْلُ عَلَيْهِمْ نَبَأَ إِبْرَٰهِيمَ",
  "26:70": "إِذْ قَالَ لِأَبِيهِ وَقَوْمِهِۦ مَا تَعْبُدُونَ",
  "38:11": "جُندٌ مَّا هُنَالِكَ مَهْزُومٌ مِّنَ ٱلْأَحْزَابِ",
  "38:12": "كَذَّبَتْ قَبْلَهُمْ قَوْمُ نُوحٍ وَعَادٌ وَفِرْعَوْنُ ذُو ٱلْأَوْتَادِ",
  "38:13": "وَثَمُودُ وَقَوْمُ لُوطٍ وَأَصْحَٰبُ لْـَٔيْكَةِ أُو۟لَٰٓئِكَ ٱلْأَحْزَابُ",
  "86:4": "إِن كُلُّ نَفْسٍ لَّمَّا عَلَيْهَا حَافِظٌ",
  "86:5": "فَلْيَنظُرِ ٱلْإِنسَٰنُ مِمَّ خُلِقَ",
  "86:6": "خُلِقَ مِن مَّآءٍ دَافِقٍ",
  "95:5": "ثُمَّ رَدَدْنَٰهُ أَسْفَلَ سَٰفِلِينَ",
  "95:6": "إِلَّا ٱلَّذِينَ ءَامَنُوا۟ وَعَمِلُوا۟ ٱلصَّٰلِحَٰتِ فَلَهُمْ أَجْرٌ غَيْرُ مَمْنُونٍ",
  "95:7": "فَمَا يُكَذِّبُكَ بَعْدُ بِٱلدِّينِ",
};
const BASMALAH = "بِسْمِ اللّهِ الرَّحْمَنِ الرَّحِيمِ";
/** [surah, ayah, pre, similar, post] as bundled. */
const REFS: [number, number, string, string, string][] = [
  [
    2,
    178,
    "وَأُو۟لَٰٓئِكَ هُمُ ٱلْمُتَّقُونَ",
    "يَٰٓأَيُّهَا ٱلَّذِينَ ءَامَنُوا۟ كُتِبَ",
    "وَلَكُمْ فِى ٱلْقِصَاصِ حَيَوٰةٌۭ يَٰٓأُو۟لِى ٱلْأَلْبَٰبِ لَعَلَّكُمْ تَتَّقُونَ",
  ],
  [
    3,
    132,
    "وَٱتَّقُوا۟ ٱلنَّارَ ٱلَّتِىٓ أُعِدَّتْ لِلْكَٰفِرِينَ",
    "وَأَطِيعُوا۟ ٱللَّهَ وَٱلرَّسُولَ لَعَلَّكُمْ تُرْحَمُونَ",
    "لَعَلَّكُمْ تُرْحَمُونَ",
  ],
  [
    26,
    69,
    "وَإِنَّ رَبَّكَ لَهُوَ ٱلْعَزِيزُ ٱلرَّحِيمُ",
    "وَٱتْلُ عَلَيْهِمْ نَبَأَ إِبْرَٰاهِيمَ*",
    "إِذْ قَالَ لِأَبِيهِ وَقَوْمِهِۦ مَا تَعْبُدُونَ",
  ],
  [
    38,
    12,
    "جُندٌۭ مَّا هُنَالِكَ مَهْزُومٌۭ مِّنَ ٱلْأَحْزَابِ",
    "كَذَّبَتْ قَبْلَهُمْ قَوْمُ نُوحٍ",
    "وَعَادٌ وَفِرْعَوْنُ ذُو الْأَوْتَادِ ﴿12﴾ وَثَمُودُ وَقَوْمُ لُوطٍ وَأَصْحَابُ الْأَيْكَةِ أُولَـئِكَ الْأَحْزَابُ ﴿13﴾ إِن كُلٌّ إِلَّا كَذَّبَ الرُّسُلَ فَحَقَّ عِقَابِ",
  ],
  [
    86,
    5,
    "إِن كُلُّ نَفْسٍۢ لَّمَّا عَلَيْهَا حَافِظٌۭ",
    "فَلْيَنظُرِ ٱلْإِنسَٰانُ مِمَّ خُلِقَ",
    "خُلِقَ مِن مَّآءٍۢ دَافِقٍۢ",
  ],
  [95, 6, "إِلَّا ٱلَّذِينَ ءَامَنُوا۟ وَعَمِلُوا۟ ٱلصَّٰالِحَٰاتِ", "فَلَهُمْ أَجْرٌ غَيْرُ مَمْنُونٍۢ", BASMALAH],
];

const words = (text: string) => text.split(/\s+/).filter(Boolean);

let store: OutboxDatabase;

beforeEach(async () => {
  store = await openOutboxDatabase();
  const ayah = store.sql.prepare(
    "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (?, ?, ?, 'x', 'x', 1)",
  );
  for (const [key, text] of Object.entries(AYAT)) ayah.run(...key.split(":").map(Number), text);
  // A sibling with no segments, so each ref shows as the self of its own group.
  ayah.run(114, 1, "قُلْ أَعُوذُ بِرَبِّ ٱلنَّاسِ");
  const group = store.sql.prepare(
    "INSERT INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES (?, 'similar', 'cue', 'test', 0)",
  );
  const ref = store.sql.prepare(
    "INSERT INTO mutashabihat_refs (group_id, sort_order, surah, ayah, surah_name_ar, pre_text, similar_text, post_text) VALUES (?, ?, ?, ?, 'سورة', ?, ?, ?)",
  );
  for (const [surah, ayahNumber, pre, similar, post] of REFS) {
    const id = `${surah}:${ayahNumber}`;
    group.run(id);
    ref.run(id, 0, surah, ayahNumber, pre, similar, post);
    ref.run(id, 1, 114, 1, null, null, null);
  }
});

afterEach(async () => {
  await store.close();
});

async function shown(surah: number, ayah: number): Promise<SimilarRef> {
  const [group] = await similarGroupsForAyahs(store.db, [{ surah, ayah }]);
  return group.self;
}

describe("whether one run of words follows another in the Quran", () => {
  const around = (...keys: string[]) => words(keys.map((key) => AYAT[key]).join(" "));

  it("finds a break where the Quran goes on with other words, from either side", () => {
    // 2:178 as bundled: its first words, then 2:179.
    expect(continuesIn(words(REFS[0][3]), words(REFS[0][4]), around("2:177", "2:178", "2:179"))).toBe(false);
    // The basmalah after 95:6, where the Quran goes on with 95:7.
    expect(continuesIn(words(REFS[5][3]), words(BASMALAH), around("95:5", "95:6", "95:7"))).toBe(false);
  });

  it("reads other spellings, other word splits and one word left out as running on", () => {
    expect(
      continuesIn(
        words("وَأُولَـئِكَ هُمُ الْمُتَّقُونَ"),
        words("يَا أَيُّهَا الَّذِينَ آمَنُوا"),
        around("2:177", "2:178"),
      ),
    ).toBe(true);
    // "عَلَيْكُمُ" is left out between the two.
    expect(continuesIn(words(REFS[0][3]), words("ٱلْقِصَاصُ فِى ٱلْقَتْلَى"), around("2:178"))).toBe(true);
  });

  it("tells nothing where a side is not found or the ayat around it end", () => {
    // Nothing before 95:5 is given, so what comes before it is not known.
    expect(continuesIn(words(BASMALAH), words(AYAT["95:5"]), around("95:5", "95:6"))).toBeNull();
    expect(continuesIn(words("قُلْ أَعُوذُ بِرَبِّ"), words("مَلِكِ ٱلنَّاسِ"), around("95:5", "95:6"))).toBeNull();
  });
});

describe("a similar-verse passage as shown", () => {
  it("marks where words are left out, after the passage and its ayah end", async () => {
    const qisas = await shown(2, 178);
    // After "كُتِبَ", the last word of the passage: 2:178 goes on, the post is 2:179.
    expect(qisas.gaps).toEqual([6]);
    const tin = await shown(95, 6);
    expect(tin.gaps).toEqual([8]);
    expect(tin.ayahEnds).toEqual([{ after: 8, ayah: 6 }]);
  });

  it("drops words the data repeats where the Quran does not, and keeps a repeat the Quran has", async () => {
    const imran = await shown(3, 132);
    expect(imran.post).toBe("");
    expect(imran.gaps).toEqual([]);
    expect(imran.ayahEnds).toEqual([{ after: 4, ayah: 131 }]);
    // 86:5 ends with "خُلِقَ" and 86:6 starts with it.
    const tariq = await shown(86, 5);
    expect(tariq.post).toBe("خُلِقَ مِن مَّآءٍۢ دَافِقٍۢ");
    expect(tariq.gaps).toEqual([]);
  });

  it("drops the data's own ayah marks and stray symbols, numbering an end the Quran text confirms", async () => {
    const sad = await shown(38, 12);
    expect(sad.post).not.toMatch(/[﴿﴾0-9]/);
    const post = words(sad.post);
    const at = (word: string) => words(`${sad.pre} ${sad.similar}`).length + post.indexOf(word);
    // The app's own end of 38:12, and the end of 38:13 that the data marked and 38:13 confirms.
    expect(sad.ayahEnds).toEqual([
      { after: 5, ayah: 11 },
      { after: at("الْأَوْتَادِ"), ayah: 12 },
      { after: at("الْأَحْزَابُ"), ayah: 13 },
    ]);
    const shuara = await shown(26, 69);
    expect(shuara.similar).toBe("وَٱتْلُ عَلَيْهِمْ نَبَأَ إِبْرَٰاهِيمَ");
  });
});

describe("the left-out words on screen", () => {
  const ref: SimilarRef = {
    surah: 19,
    ayah: 4,
    surahName: "مريم",
    page: 305,
    pre: "فقال قال رب اني",
    similar: "وهن العظم",
    post: "مني شيئا حقا ابدا",
    ayahEnds: [{ after: 5, ayah: 4 }],
    gaps: [5],
  };
  const other: SimilarRef = {
    ...ref,
    surah: 20,
    pre: "ثم قال رب انك",
    similar: "وهن الجسم",
    post: "مني كثيرا حقا دوما",
    gaps: [],
  };

  it("shows a muted mark after the ayah end, and names it for a screen reader", () => {
    render(<SimilarVerseLine reference={ref} isRTL={false} accent="#0f766e" />);
    expect(screen.getByText(" …").props.className).toContain("text-warm-700");
    expect(screen.getByLabelText("فقال قال رب اني وهن العظم (٤), words left out, مني شيئا حقا ابدا")).toBeTruthy();
    screen.unmount();
    render(<SimilarVerseLine reference={ref} isRTL accent="#0f766e" />);
    expect(screen.getByLabelText("فقال قال رب اني وهن العظم (٤)، كلمات لم تُعرض، مني شيئا حقا ابدا")).toBeTruthy();
  });

  it("names the mark in place on the web, hiding the symbol itself", () => {
    const os = jest.replaceProperty(Platform, "OS", "web");
    try {
      render(<SimilarVerseLine reference={ref} isRTL={false} accent="#0f766e" />);
      expect(screen.getByText(" …", { includeHiddenElements: true }).props["aria-hidden"]).toBe(true);
      expect(screen.getByText(" words left out ")).toBeTruthy();
    } finally {
      os.restore();
    }
  });

  it("underlines the same words with a gap, which is not a word of the verse", () => {
    render(<SimilarVerseLine reference={ref} isRTL={false} accent="#0f766e" compareWith={[other]} />);
    const style = (word: string) => StyleSheet.flatten(screen.getByText(word).props.style) ?? {};
    expect(style("العظم")).toMatchObject({ textDecorationLine: "underline" });
    expect(style("وهن")).toMatchObject({ color: "#0f766e", fontWeight: "700" });
    expect(style("اني")).toMatchObject({ textDecorationLine: "underline" });
    expect(style("شيئا")).toMatchObject({ textDecorationLine: "underline" });
    expect(style("ابدا").textDecorationLine).toBeUndefined();
  });
});
