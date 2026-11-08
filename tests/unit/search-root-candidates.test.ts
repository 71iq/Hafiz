import * as fc from "fast-check";
import { resolveRootCandidates } from "@/lib/search/root-candidates";

type Index = Parameters<typeof resolveRootCandidates>[0]["index"];
function rootIndex(lemmas: [string, string[]][] = [], words: [string, string[]][] = []): Index {
  return {
    lemmaMap: new Map(lemmas.map(([key, roots]) => [key, new Set(roots)])),
    wordMap: new Map(words.map(([key, roots]) => [key, new Set(roots)])),
  };
}
const resolve = (trimmedTerm: string, strippedTerm = trimmedTerm, index = rootIndex()) =>
  resolveRootCandidates({ trimmedTerm, strippedTerm, index });
const snapshot = (index: Index) => [
  Array.from(index.lemmaMap, ([key, roots]) => [key, Array.from(roots)]),
  Array.from(index.wordMap, ([key, roots]) => [key, Array.from(roots)]),
];

describe("ordered search root candidates", () => {
  it("keeps the canonical direct root without needing an index match", () => {
    expect(resolve("جيأ")).toEqual(["جيأ"]);
  });
  it("puts the trimmed spelling before its supplied stripped spelling", () => {
    expect(resolve("جَاءَ", "جاء")).toEqual(["جَاءَ", "جاء"]);
  });
  it("retains every exact lemma root before every exact word root", () => {
    expect(resolve("جَاءَ", "جاء", rootIndex([["جاء", ["جيأ", "جيء"]]], [["جاء", ["جيء", "جأي"]]]))).toEqual([
      "جَاءَ",
      "جاء",
      "جيأ",
      "جيء",
      "جأي",
    ]);
  });
  it("finds exact two-code-unit matches without prefix fallback", () => {
    expect(
      resolve(
        "رح",
        "رح",
        rootIndex(
          [
            ["رحم", ["prefix"]],
            ["رح", ["lemma"]],
          ],
          [
            ["رحمة", ["prefix-word"]],
            ["رح", ["word"]],
          ],
        ),
      ),
    ).toEqual(["رح", "lemma", "word"]);
  });
  it("adds matching lemma prefixes then word prefixes in map order after exact matches", () => {
    const index = rootIndex(
      [
        ["رحمن", ["l-first"]],
        ["رحم", ["l-exact"]],
        ["رحمة", ["l-last"]],
      ],
      [
        ["رحمة", ["w-first"]],
        ["رحم", ["w-exact"]],
      ],
    );
    expect(resolve("رحم", "رحم", index)).toEqual(["رحم", "l-exact", "w-exact", "l-first", "l-last", "w-first"]);
  });
  it("does not use contains or suffix matching", () => {
    expect(
      resolve(
        "رحم",
        "رحم",
        rootIndex(
          [
            ["برحمة", ["contains"]],
            ["ارحم", ["suffix"]],
          ],
          [["يرحم", ["word-suffix"]]],
        ),
      ),
    ).toEqual(["رحم"]);
  });
  it("deduplicates across direct, exact and prefix matches without sorting", () => {
    const index = rootIndex(
      [
        ["abc", ["z", "abc", "a"]],
        ["abc-more", ["a", "y"]],
      ],
      [
        ["abc", ["z", "b"]],
        ["abc-last", ["y", "c"]],
      ],
    );
    expect(resolve("abc", "abc", index)).toEqual(["abc", "z", "a", "b", "y", "c"]);
  });
  it("filters empty candidates but preserves a whitespace-only root", () => {
    expect(resolve("", "", rootIndex([["", ["", " ", "root"]]], [["", ["root", "other"]]]))).toEqual([
      " ",
      "root",
      "other",
    ]);
  });
  it("returns an empty list for empty inputs and empty maps", () => {
    expect(resolve("")).toEqual([]);
  });
  it("does not fold English case or remove punctuation", () => {
    expect(
      resolve(
        "Ab!",
        "Ab!",
        rootIndex([
          ["ab!", ["folded"]],
          ["Ab!x", ["exact-case-prefix"]],
        ]),
      ),
    ).toEqual(["Ab!", "exact-case-prefix"]);
  });
  it.each([
    ["أبج", "ابج"],
    ["ٱبج", "ابج"],
    ["ؤمن", "ومن"],
    ["ئمن", "يمن"],
    ["فتى", "فتي"],
    ["رحمة", "رحمه"],
  ])("keeps search letter semantics for %s rather than folding it to %s", (term, folded) => {
    expect(
      resolve(
        term,
        term,
        rootIndex([
          [folded, ["folded-root"]],
          [term, ["literal-root"]],
        ]),
      ),
    ).toEqual([term, "literal-root"]);
  });
  it("preserves the existing UTF-16 length threshold", () => {
    expect(resolve("a😀", "a😀", rootIndex([["a😀b", ["prefix"]]]))).toEqual(["a😀", "prefix"]);
    expect(resolve("😀", "😀", rootIndex([["😀b", ["prefix"]]]))).toEqual(["😀"]);
  });
  it("does not mutate maps or nested root sets and returns a fresh array", () => {
    const index = rootIndex(
      [
        ["abc", ["x", "y"]],
        ["abcd", ["z"]],
      ],
      [["abc", ["w"]]],
    );
    const before = snapshot(index);
    const result = resolve("abc", "abc", index);
    result.push("caller-only");
    expect(snapshot(index)).toEqual(before);
    expect(resolve("abc", "abc", index)).toEqual(["abc", "x", "y", "w", "z"]);
  });
  it("preserves priority and first occurrence for generated overlapping sources", () => {
    const roots = fc.array(fc.constantFrom("", "z", "a", "root", "رحم", "جيأ", " "), { maxLength: 12 });
    fc.assert(
      fc.property(
        fc.constantFrom("رحم", "جاء", "abc", "أبج", "a😀"),
        roots,
        roots,
        roots,
        roots,
        (term, lemmaExact, wordExact, lemmaPrefix, wordPrefix) => {
          const index = rootIndex(
            [
              [term + "suffix", lemmaPrefix],
              [term, lemmaExact],
            ],
            [
              [term + "suffix", wordPrefix],
              [term, wordExact],
            ],
          );
          const before = snapshot(index);
          const ranked = [term + "َ", term, ...lemmaExact, ...wordExact, ...lemmaPrefix, ...wordPrefix];
          const expected = ranked.filter((root, i) => root !== "" && ranked.indexOf(root) === i);
          expect(resolve(term + "َ", term, index)).toEqual(expected);
          expect(snapshot(index)).toEqual(before);
        },
      ),
      { numRuns: 500, seed: 101 },
    );
  });
});
