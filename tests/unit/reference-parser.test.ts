import fc from "fast-check";
import { readFileSync } from "fs";
import path from "path";
import { MUSHAF_PAGE_COUNT, SURAH_AYAH_COUNTS, parseAyahLinkParams, parseReference } from "@/lib/search/reference";

const quranData = JSON.parse(readFileSync(path.join(__dirname, "../../assets/data/quran-data.json"), "utf8")) as {
  tables: { surahs: { number: number; name_arabic: string; name_english: string; ayah_count: number }[] };
};
const surahs = quranData.tables.surahs;

const toArabicIndic = (text: string) => text.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
const toPersian = (text: string) => text.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

describe("shared reference parser (C06)", () => {
  it("embeds the canonical ayah counts from the bundled data", () => {
    expect(SURAH_AYAH_COUNTS).toEqual(surahs.map((surah) => surah.ayah_count));
    expect(SURAH_AYAH_COUNTS.reduce((sum, count) => sum + count, 0)).toBe(6236);
  });

  it.each([
    ["2:255", { kind: "ayah", surah: 2, ayah: 255 }],
    [" ٢:٢٥٥ ", { kind: "ayah", surah: 2, ayah: 255 }],
    ["۲:۲۵۵", { kind: "ayah", surah: 2, ayah: 255 }],
    ["2:999", { kind: "invalid", reason: "ayah-range" }],
    ["115:1", { kind: "invalid", reason: "surah-range" }],
    ["0:1", { kind: "invalid", reason: "surah-range" }],
    ["2:255abc", { kind: "invalid", reason: "malformed" }],
    ["2:2.5", { kind: "invalid", reason: "malformed" }],
    ["-2", { kind: "invalid", reason: "malformed" }],
    ["+2", { kind: "invalid", reason: "malformed" }],
    ["2.5", { kind: "invalid", reason: "malformed" }],
    ["2", { kind: "surah", surah: 2 }],
    ["115", { kind: "invalid", reason: "surah-range" }],
    ["page 2", { kind: "page", page: 2 }],
    ["P 604", { kind: "page", page: 604 }],
    ["p12", { kind: "page", page: 12 }],
    ["صفحة ٥٠", { kind: "page", page: 50 }],
    ["ص ٣", { kind: "page", page: 3 }],
    ["page 605", { kind: "invalid", reason: "page-range" }],
    ["page 2.5", { kind: "invalid", reason: "malformed" }],
    ["peace", { kind: "text", text: "peace" }],
    ["صبر", { kind: "text", text: "صبر" }],
    ["mercy", { kind: "text", text: "mercy" }],
  ])("parses %j in search", (input, expected) => {
    expect(parseReference(input)).toEqual(expected);
  });

  it("treats a bare number as a page in a page field", () => {
    expect(parseReference("2", { context: "page" })).toEqual({ kind: "page", page: 2 });
    expect(parseReference("605", { context: "page" })).toEqual({ kind: "invalid", reason: "page-range" });
  });

  it("matches exact surah names in both languages", () => {
    expect(parseReference("Al-Kahf", { surahs })).toEqual({ kind: "surah", surah: 18 });
    expect(parseReference("kahf", { surahs })).toEqual({ kind: "surah", surah: 18 });
    expect(parseReference("سورة الكهف", { surahs })).toEqual({ kind: "surah", surah: 18 });
    expect(parseReference("Yaseen", { surahs })).toEqual({ kind: "surah", surah: 36 });
    expect(parseReference("patience", { surahs })).toEqual({ kind: "text", text: "patience" });
  });

  it("accepts every canonical ayah in all digit systems and rejects the next one", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 114 }), fc.integer({ min: 1, max: 286 }), (surah, rawAyah) => {
        const ayah = ((rawAyah - 1) % SURAH_AYAH_COUNTS[surah - 1]) + 1;
        const ref = `${surah}:${ayah}`;
        for (const form of [ref, toArabicIndic(ref), toPersian(ref)]) {
          expect(parseReference(form)).toEqual({ kind: "ayah", surah, ayah });
        }
        expect(parseReference(`${surah}:${SURAH_AYAH_COUNTS[surah - 1] + 1}`)).toEqual({
          kind: "invalid",
          reason: "ayah-range",
        });
      }),
    );
  });

  it("accepts every page in a page field", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MUSHAF_PAGE_COUNT }), (page) => {
        expect(parseReference(String(page), { context: "page" })).toEqual({ kind: "page", page });
        expect(parseReference(`صفحة ${toArabicIndic(String(page))}`)).toEqual({ kind: "page", page });
      }),
    );
  });

  it("validates deep-link parameters strictly without clamping", () => {
    expect(parseAyahLinkParams({ surah: "2", ayah: "255" })).toEqual({ kind: "ayah", surah: 2, ayah: 255 });
    expect(parseAyahLinkParams({ surah: "2", ayah: "255", word: "3" })).toEqual({
      kind: "ayah",
      surah: 2,
      ayah: 255,
      wordPos: 3,
    });
    expect(parseAyahLinkParams({ surah: "2", ayah: "999" })).toEqual({ kind: "invalid", reason: "ayah-range" });
    expect(parseAyahLinkParams({ surah: "2" })).toEqual({ kind: "invalid", reason: "malformed" });
    expect(parseAyahLinkParams({ surah: "2x", ayah: "1" })).toEqual({ kind: "invalid", reason: "malformed" });
    expect(parseAyahLinkParams({ surah: ["2", "3"], ayah: "1" })).toEqual({ kind: "invalid", reason: "malformed" });
  });
});
