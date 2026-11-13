import { importQulPhrases } from "@/lib/hifz/qul-import";

// A hand-written fixture in the QUL export format (4.7.1 D-3); no QUL data is copied here.
const fixture = {
  "7": {
    surahs: 2,
    ayahs: 9,
    count: 99,
    source: { key: "2:5", from: 1, to: 4 },
    ayah: {
      "2:5": [[1, 4]],
      "31:5": [
        [1, 4],
        [1, 4],
      ],
      "3:200": [[2, 50]],
    },
  },
  "9": {
    source: { key: "1:1", from: 1, to: 3 },
    ayah: { "1:2": [[1, 3]], "9:999": [[1, 2]], "1:3": [[3, 1]] },
  },
};

const words: Record<string, number> = { "2:5": 12, "31:5": 10, "3:200": 15, "1:1": 4, "1:2": 4, "1:3": 2 };

describe("QUL similar-phrase importer (MUT-08 to MUT-11)", () => {
  const result = importQulPhrases(fixture, (key) => words[key] ?? null);

  it("recomputes counts from the ranges it keeps instead of the stored values (MUT-08)", () => {
    expect(result.phrases.find((phrase) => phrase.id === 7)).toMatchObject({ ayahs: 2, count: 2, lengthWords: 4 });
  });

  it("drops duplicate ranges within an ayah (MUT-09)", () => {
    expect(result.occurrences.filter((row) => row.phraseId === 7 && row.surah === 31)).toEqual([
      { phraseId: 7, surah: 31, ayah: 5, wordFrom: 1, wordTo: 4 },
    ]);
  });

  it("adds a missing source ayah to its own phrase (MUT-10)", () => {
    expect(result.occurrences.filter((row) => row.phraseId === 9).map((row) => `${row.surah}:${row.ayah}`)).toEqual(["1:1", "1:2"]);
  });

  it("rejects and reports ranges outside the ayah, reversed ranges and unknown ayat (MUT-11)", () => {
    expect(result.issues).toEqual([
      { phraseId: 7, key: "3:200", reason: "out_of_range" },
      { phraseId: 9, key: "1:3", reason: "reversed" },
      { phraseId: 9, key: "9:999", reason: "unknown_ayah" },
    ]);
  });

  it("rejects a file that is not in the export format", () => {
    expect(() => importQulPhrases({ x: {} }, () => 1)).toThrow();
  });
});
