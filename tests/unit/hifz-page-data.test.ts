import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DatabaseExecutor } from "@/lib/database/types";
import { buildRecitationPage, firstLetterOf, loadRecitationPage, type PageWordsLines } from "@/lib/hifz/page-data";
import { juzOfPage, pagesOfJuz, PAGE_COUNT, parsePageUnit, pageCardId, chunkCardId, halfCardId } from "@/lib/hifz/units";

const root = process.cwd();
const pageWords = JSON.parse(fs.readFileSync(path.join(root, "assets/data/layout/page-words.json"), "utf8")) as PageWordsLines[];

function bundled(): { sql: DatabaseSync; db: DatabaseExecutor } {
  const sql = new DatabaseSync(path.join(root, "assets/data/quran.db"), { readOnly: true });
  const db = {
    getAllAsync: async (query: string, params: unknown[] = []) => sql.prepare(query).all(...(params as never[])),
    getFirstAsync: async (query: string, params: unknown[] = []) => sql.prepare(query).get(...(params as never[])) ?? null,
  } as unknown as DatabaseExecutor;
  return { sql, db };
}

describe("recitation pages from the bundled Quran data", () => {
  it("lays out all 604 pages with every glyph exactly once, in order, on at most 15 text lines", async () => {
    const { sql, db } = bundled();
    try {
      for (let page = 1; page <= PAGE_COUNT; page += 1) {
        const built = await loadRecitationPage(db, page, pageWords[page - 1]);
        const expected = (
          sql.prepare("SELECT text_qcf2 FROM quran_text WHERE v2_page = ? ORDER BY surah, ayah").all(page) as { text_qcf2: string }[]
        ).flatMap((row) => row.text_qcf2.split(" ").filter(Boolean));
        const laidOut = built.lines.flatMap((line) => line.tokens.map((token) => token.glyph));
        expect({ page, glyphs: laidOut }).toEqual({ page, glyphs: expected });
        // Same rows as the reader: at most 15 text lines, each line number once among text lines.
        const ayahLines = built.lines.filter((line) => line.kind === "ayah").map((line) => line.lineNumber);
        expect(ayahLines.length).toBeLessThanOrEqual(15);
        expect(new Set(ayahLines).size).toBe(ayahLines.length);
        expect(built.lines.filter((line) => line.kind === "ayah").every((line) => line.tokens.length > 0)).toBe(true);
      }
    } finally {
      sql.close();
    }
  });

  it("gives aligned words their position and first letter, and markers none", async () => {
    const { sql, db } = bundled();
    try {
      const page = await loadRecitationPage(db, 3, pageWords[2]);
      const first = page.lines[0].tokens[0];
      expect(first).toMatchObject({ surah: 2, ayah: 6, wordPos: 1, isMarker: false, firstLetter: "إِ" });
      const marker = page.lines.flatMap((line) => line.tokens).find((token) => token.isMarker)!;
      expect(marker).toMatchObject({ wordPos: null, firstLetter: null });
    } finally {
      sql.close();
    }
  });
});

describe("page units", () => {
  it("round-trips card ids and rejects malformed ones", () => {
    expect(parsePageUnit(pageCardId(582))).toEqual({ kind: "page", page: 582 });
    expect(parsePageUnit(halfCardId(1, "b"))).toEqual({ kind: "half", page: 1, half: "b" });
    expect(parsePageUnit(chunkCardId(10, 1, 5))).toEqual({ kind: "chunk", page: 10, fromLine: 1, toLine: 5 });
    expect(parsePageUnit("page:madani15:605")).toBeNull();
    expect(parsePageUnit("page:indopak:5")).toBeNull();
    expect(parsePageUnit("chunk:madani15:10:5-1")).toBeNull();
    expect(parsePageUnit("2:255")).toBeNull();
  });

  it("maps pages to the juz they start in (UNIT-03)", () => {
    expect(pagesOfJuz(1)).toHaveLength(21);
    expect(pagesOfJuz(30)).toHaveLength(23);
    expect(pagesOfJuz(15)).toHaveLength(20);
    const all = Array.from({ length: 30 }, (_, i) => pagesOfJuz(i + 1)).flat();
    expect(all).toEqual(Array.from({ length: PAGE_COUNT }, (_, i) => i + 1));
    expect(all.every((page) => pagesOfJuz(juzOfPage(page)).includes(page))).toBe(true);
  });

  it("takes the first letter with its marks", () => {
    expect(firstLetterOf("ٱللَّهِ")).toBe("ٱ");
    expect(firstLetterOf("إِنَّ")).toBe("إِ");
    expect(firstLetterOf("ٱلْكِتَٰبَ")).toBe("ٱ");
    expect(firstLetterOf("بِسْمِ")).toBe("بِ");
  });

  it("puts unmatched page-words glyphs into word-id lines", () => {
    const page = buildRecitationPage(
      9,
      [{ surah: 1, ayah: 1, text_qcf2: "a b c", text_uthmani: "x y" }],
      [
        { line_number: 1, line_type: "ayah", is_centered: 0, surah_number: null, first_word_id: 1, last_word_id: 2 },
        { line_number: 2, line_type: "ayah", is_centered: 1, surah_number: null, first_word_id: 3, last_word_id: 3 },
      ],
      { "1": "a", "2": "z" },
    );
    expect(page.lines.map((line) => line.tokens.map((token) => token.glyph))).toEqual([["a", "b"], ["c"]]);
    expect(page.lines[1].centered).toBe(true);
  });
});
