import React from "react";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SimilarVerseLine } from "@/components/hifz/SimilarVerseLine";
import type { SimilarRef } from "@/lib/hifz/similar";
import { differingWords } from "@/lib/hifz/word-diff";

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
