import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SimilarVerseComparison } from "@/components/hifz/SimilarVerseComparison";
import { SimilarVerseLine } from "@/components/hifz/SimilarVerseLine";
import type { DatabaseExecutor } from "@/lib/database/types";
import { strings } from "@/lib/i18n/strings";
import type { SimilarGroup, SimilarRef } from "@/lib/hifz/similar";
import { differingWords, wordKey } from "@/lib/hifz/word-diff";

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
