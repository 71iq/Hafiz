import { matchesSurahQuery } from "@/lib/search/surah-match";

const kahf = { number: 18, name_arabic: "الكهف", name_english: "The Cave" };
const baqara = { number: 2, name_arabic: "البقرة", name_english: "The Cow" };
const yasin = { number: 36, name_arabic: "يس", name_english: "Ya Sin" };
const israa = { number: 17, name_arabic: "الإسراء", name_english: "The Night Journey" };
const nuh = { number: 71, name_arabic: "نوح", name_english: "Noah" };
const nur = { number: 24, name_arabic: "النور", name_english: "The Light" };

describe("matchesSurahQuery", () => {
  it("matches transliterated names that the stored English meaning lacks", () => {
    expect(matchesSurahQuery(kahf, "kahf")).toBe(true);
    expect(matchesSurahQuery(kahf, "Al-Kahf")).toBe(true);
    expect(matchesSurahQuery(baqara, "baqarah")).toBe(true);
    expect(matchesSurahQuery(yasin, "yaseen")).toBe(true);
  });

  it("still matches the English meaning", () => {
    expect(matchesSurahQuery(kahf, "cave")).toBe(true);
    expect(matchesSurahQuery(kahf, "the cave")).toBe(true);
  });

  it("matches Arabic names across hamza and article variants", () => {
    expect(matchesSurahQuery(kahf, "الكهف")).toBe(true);
    expect(matchesSurahQuery(kahf, "كهف")).toBe(true);
    expect(matchesSurahQuery(israa, "الاسراء")).toBe(true);
  });

  it("matches numbers by prefix, including Arabic-Indic digits", () => {
    expect(matchesSurahQuery(kahf, "18")).toBe(true);
    expect(matchesSurahQuery(kahf, "1")).toBe(true);
    expect(matchesSurahQuery(kahf, "8")).toBe(false);
    expect(matchesSurahQuery(kahf, "١٨")).toBe(true);
  });

  it("keeps short names precise", () => {
    expect(matchesSurahQuery(nuh, "nuh")).toBe(true);
    expect(matchesSurahQuery(nur, "nuh")).toBe(false);
  });

  it("rejects unrelated text and treats blank as match-all", () => {
    expect(matchesSurahQuery(kahf, "zzzz")).toBe(false);
    expect(matchesSurahQuery(kahf, "  ")).toBe(true);
  });
});
