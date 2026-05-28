import pageLines from "@/assets/data/layout/page-lines.json";
import pageMap from "@/assets/data/page-map.json";
import qcf2 from "@/assets/data/quran-qcf2.json";
import quranData from "@/assets/data/quran-data.json";

const tables = quranData.tables;

describe("bundled Quran data contracts", () => {
  it("keeps canonical Quran table row counts", () => {
    expect(tables.surahs).toHaveLength(114);
    expect(tables.quran_text).toHaveLength(6236);
    expect(tables.juz_map).toHaveLength(135);
    expect(tables.hizb_map).toHaveLength(60);
    expect(tables.word_roots).toHaveLength(50268);
  });

  it("matches summed Surah ayah counts to Quran text rows", () => {
    const ayahTotal = tables.surahs.reduce((sum, surah) => sum + surah.ayah_count, 0);
    expect(ayahTotal).toBe(tables.quran_text.length);
  });

  it("keeps first and last ayah anchors stable", () => {
    expect(tables.quran_text[0]).toMatchObject({ surah: 1, ayah: 1 });
    expect(tables.quran_text.at(-1)).toMatchObject({ surah: 114, ayah: 6 });
  });

  it("keeps QCF2 glyph rows aligned with every Quran ayah", () => {
    expect(qcf2).toHaveLength(tables.quran_text.length);
    expect(qcf2[0]).toMatchObject({ verse_key: "1:1", v2_page: 1 });
    expect(qcf2.at(-1)).toMatchObject({ verse_key: "114:6", v2_page: 604 });
  });

  it("uses v2_page values covering the full 604-page Mushaf", () => {
    const pages = new Set(qcf2.map((row) => row.v2_page));
    expect(pages.size).toBe(604);
    expect(Math.min(...pages)).toBe(1);
    expect(Math.max(...pages)).toBe(604);
  });

  it("keeps page-map coverage at 604 pages with stable endpoints", () => {
    expect(pageMap).toHaveLength(604);
    expect(pageMap[0]).toMatchObject({ page: 1, start: { surah_number: 1, verse: 1 } });
    expect(pageMap.at(-1)).toMatchObject({ page: 604, end: { surah_number: 114, verse: 6 } });
  });

  it("keeps page-lines coverage for every Mushaf page", () => {
    const pages = new Map<number, number>();
    for (const line of pageLines) {
      pages.set(line.page_number, (pages.get(line.page_number) ?? 0) + 1);
    }

    expect(pages.size).toBe(604);
    expect(pages.get(1)).toBe(8);
    expect(pages.get(2)).toBe(8);
    for (let page = 3; page <= 604; page += 1) {
      expect(pages.get(page)).toBe(15);
    }
  });
});
