import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { similarGroupsForAyahs } from "@/lib/hifz/similar";
import { openOutboxDatabase } from "@/tests/jest/outbox-sqlite";
import { StyleSheet } from "react-native";
import { SimilarVerseComparison } from "@/components/hifz/SimilarVerseComparison";
import { SimilarVerseLine } from "@/components/hifz/SimilarVerseLine";
import type { DatabaseExecutor } from "@/lib/database/types";
import { strings } from "@/lib/i18n/strings";
import type { SimilarGroup, SimilarRef } from "@/lib/hifz/similar";
import { ayahSpanIn, differingWords, wordKey } from "@/lib/hifz/word-diff";

/**
 * MUT-01, MUT-04: the words that tell two similar verses apart, compared in order. The passages of
 * 28:20 and 36:20 are copied from the bundled similar-verse data; "رجل" is the same word in both, only
 * moved, and the two spell the rest differently (Uthmani and plain).
 */
const QASAS: SimilarRef = {
  surah: 28,
  ayah: 20,
  surahName: "القصص",
  page: 388,
  pre: "",
  similar: "وَجَآءَ رَجُلٌۭ مِّنْ أَقْصَا ٱلْمَدِينَةِ يَسْعَىٰ",
  post: "قَالَ يَٰا مُوسَىٰٓ",
};
const YASIN: SimilarRef = {
  surah: 36,
  ayah: 20,
  surahName: "يس",
  page: 441,
  pre: "",
  similar: "وَجَآءَ مِنْ أقْصَا الْمَدِينَةِ رَجُلٌ يَسْعَى",
  post: "قَالَ يَٰاقَوْمِ ٱتَّبِعُوا۟ ٱلْمُرْسَلِينَ",
};
const words = (ref: SimilarRef) => [ref.pre, ref.similar, ref.post].join(" ").split(/\s+/).filter(Boolean);

describe("words that tell similar verses apart", () => {
  it("marks a word that only moved, in both verses, and not the words in the same order", () => {
    const passage = (ref: SimilarRef) => ref.similar.split(" ");
    expect(differingWords(passage(QASAS), [passage(YASIN)])).toEqual([false, true, false, false, false, false]);
    expect(differingWords(passage(YASIN), [passage(QASAS)])).toEqual([false, false, false, false, true, false]);
  });

  it("marks a repeated word once it is no longer matched, and nothing for identical wording", () => {
    expect(differingWords(["ان", "الله", "الله"], [["ان", "الله"]])).toEqual([false, false, true]);
    expect(differingWords(["ان", "الله"], [["ان", "الله"]])).toEqual([false, false]);
    expect(differingWords(["ان", "الله"], [])).toEqual([false, false]);
  });

  it("reads Uthmani and plain spellings of one word as the same word", () => {
    for (const [uthmani, plain] of [
      ["خَٰلِدِينَ", "خَالِدِينَ"],
      ["يَسْعَىٰ", "يَسْعَى"],
      ["ٱلصَّلَوٰةَ", "الصَّلَاةَ"],
      ["ٱلسَّمَٰوَٰتِ", "السَّمَاوَاتِ"],
      ["أُو۟لَٰٓئِكَ", "أُولَـٰئِكَ"],
    ]) {
      expect(wordKey(uthmani)).toBe(wordKey(plain));
    }
    // 3:88 and 20:101 share "خالدين"; the plain and Uthmani spellings no longer hide it.
    expect(differingWords(["خَالِدِينَ", "فِيهَا"], [["خَٰلِدِينَ", "فِيهِ"]])).toEqual([false, true]);
  });

  it("marks a word that differs from any one of several siblings", () => {
    expect(
      differingWords(
        ["قال", "رب", "اني"],
        [
          ["قال", "رب", "اني"],
          ["قال", "اني"],
        ],
      ),
    ).toEqual([false, true, false]);
  });

  it("underlines the moved word on screen and keeps the accent on the shared ones", () => {
    render(<SimilarVerseLine reference={QASAS} isRTL={false} accent="#0d9488" compareWith={[YASIN]} />);
    const style = (word: string) => StyleSheet.flatten(screen.getByText(word, { exact: false }).props.style);
    const qasas = words(QASAS);
    expect(style(qasas[1])).toMatchObject({ textDecorationLine: "underline" });
    expect(style(qasas[0])).toMatchObject({ color: "#0d9488", fontWeight: "700" });
    expect(style(qasas[2])).toMatchObject({ color: "#0d9488" });
  });
});

describe("what the comparison underlines and how much it shows", () => {
  const verse = (pre: string, similar: string, post: string, surah = 19): SimilarRef => ({
    surah,
    ayah: 4,
    surahName: "مريم",
    page: 305,
    pre,
    similar,
    post,
  });

  it("underlines the differences inside the shared passage and where the verses part, and mutes the rest", () => {
    const own = verse("فقال قال رب اني", "وهن العظم", "مني شيئا حقا ابدا");
    const other = verse("ثم قال رب انك", "وهن الجسم", "مني كثيرا حقا دوما", 20);
    render(<SimilarVerseLine reference={own} isRTL={false} accent="#0f766e" compareWith={[other]} />);
    const style = (word: string) => StyleSheet.flatten(screen.getByText(word).props.style) ?? {};
    // Inside the passage: the differing word is underlined, the shared one keeps the accent.
    expect(style("العظم")).toMatchObject({ textDecorationLine: "underline" });
    expect(style("وهن")).toMatchObject({ color: "#0f766e", fontWeight: "700" });
    // The nearest differing word on each side, where the verses part.
    expect(style("اني")).toMatchObject({ textDecorationLine: "underline" });
    expect(style("شيئا")).toMatchObject({ textDecorationLine: "underline" });
    // Farther away the text differs anyway and is not underlined.
    expect(style("فقال").textDecorationLine).toBeUndefined();
    expect(style("ابدا").textDecorationLine).toBeUndefined();
  });

  it("shows three siblings, then the rest on request, and each sibling's meaning on request", async () => {
    const siblings = [1, 2, 3, 4, 5].map((n) => verse("", "اخ", `ساق${n}`, 20 + n));
    const group: SimilarGroup = { groupId: "g", kind: "similar", self: verse("", "اخ", "اصل"), siblings };
    const db = {
      getAllAsync: async () =>
        siblings.concat(group.self).map((ref) => ({ surah: ref.surah, ayah: ref.ayah, text: `meaning ${ref.surah}` })),
    } as unknown as DatabaseExecutor;
    render(
      <SimilarVerseComparison
        db={db}
        groups={[group]}
        language="en"
        isRTL={false}
        accent="#0f766e"
        s={strings.en}
        width={358}
      />,
    );
    await act(async () => {});
    expect(screen.queryByText("ساق4")).toBeNull();
    expect(screen.getByText("meaning 19")).toBeTruthy();
    expect(screen.queryByText("meaning 21")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getByText("ساق5")).toBeTruthy();
    fireEvent.press(screen.getAllByRole("button", { name: strings.en.hifzSimilarShowMeaning })[0]);
    expect(screen.getByText("meaning 21")).toBeTruthy();
  });
});

describe("where an ayah ends inside a similar-verse passage", () => {
  // 86:5 as bundled: the end of 86:4, then 86:5, then the start of 86:6, which repeats its last word.
  const passage =
    "إِن كُلُّ نَفْسٍۢ لَّمَّا عَلَيْهَا حَافِظٌۭ فَلْيَنظُرِ ٱلْإِنسَٰانُ مِمَّ خُلِقَ خُلِقَ مِن مَّآءٍۢ دَافِقٍۢ".split(
      " ",
    );
  const ayah = "فَلْيَنظُرِ ٱلْإِنسَٰنُ مِمَّ خُلِقَ".split(" ");

  it("finds the ayah's own words, across spellings, so both of its ends can be marked", () => {
    expect(ayahSpanIn(passage, ayah)).toEqual({ first: 6, last: 9, hasStart: true, hasEnd: true });
  });

  it("finds an ayah cut at the passage's edge, and nothing it cannot place with certainty", () => {
    // Cut after its third word: its end is not in the passage, so no number may follow it.
    expect(ayahSpanIn(passage.slice(0, 9), ayah)).toEqual({ first: 6, last: 8, hasStart: true, hasEnd: false });
    // Two words are too few to be sure where the ayah starts.
    expect(ayahSpanIn(passage.slice(0, 8), ayah)).toBeNull();
    expect(ayahSpanIn("قال رب".split(" "), "قال رب انك".split(" "))).toBeNull();
    expect(ayahSpanIn(passage, "وَٱلسَّمَآءِ وَٱلطَّارِقِ".split(" "))).toBeNull();
  });

  it("numbers the ayah ends between the verses on screen", () => {
    const ref: SimilarRef = {
      surah: 86,
      ayah: 5,
      surahName: "الطارق",
      page: 591,
      pre: passage.slice(0, 6).join(" "),
      similar: passage.slice(6, 10).join(" "),
      post: passage.slice(10).join(" "),
      ayahEnds: [
        { after: 5, ayah: 4 },
        { after: 9, ayah: 5 },
      ],
    };
    render(<SimilarVerseLine reference={ref} isRTL accent="#0f766e" />);
    expect(screen.getByText(" (٤)")).toBeTruthy();
    expect(screen.getByText(" (٥)")).toBeTruthy();
  });
});

describe("ayah numbers inside similar-verse passages, only where certain", () => {
  const VERSES: [number, number, string][] = [
    [5, 1, "قال ربي اني دعوت قومي ليلا ونهارا"],
    [5, 2, "فلم يزدهم دعائي الا فرارا"],
    [5, 3, "واني كلما دعوتهم لتغفر لهم جعلوا اصابعهم في اذانهم"],
    [7, 4, "ثم توفى كل نفس ما كسبت وهم لا يظلمون"],
  ];

  it("numbers no preceding text that is not the previous ayah, and no ayah cut short at a pause", async () => {
    const store = await openOutboxDatabase();
    try {
      for (const [surah, ayah, text] of VERSES) {
        store.sql
          .prepare(
            "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (?, ?, ?, 'x', 'x', 1)",
          )
          .run(surah, ayah, text);
      }
      store.sql.exec(
        "INSERT INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES ('g', 'similar', 'cue', 'test', 0)",
      );
      const ref = store.sql.prepare(
        "INSERT INTO mutashabihat_refs (group_id, sort_order, surah, ayah, surah_name_ar, pre_text, similar_text, post_text) VALUES ('g', ?, 5, ?, 'نوح', ?, ?, ?)",
      );
      // 5:2 as bundled data can carry it: preceded by another surah's ayah, not by 5:1.
      ref.run(0, 2, "ثم توفى كل نفس ما كسبت وهم لا يظلمون", "فلم يزدهم دعائي", "الا فرارا");
      // 5:3 after the whole of 5:2, but cut before its own end, at a pause mark.
      ref.run(1, 3, "فلم يزدهم دعائي الا فرارا", "واني كلما دعوتهم", "لتغفر لهم ۗ");
      const [group] = await similarGroupsForAyahs(store.db, [{ surah: 5, ayah: 2 }]);
      expect(group.self.ayahEnds).toEqual([]);
      // Only the end of 5:2 before it, which is certain.
      expect(group.siblings[0].ayahEnds).toEqual([{ after: 4, ayah: 2 }]);
    } finally {
      await store.close();
    }
  });
});
