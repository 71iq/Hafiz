import fs from "node:fs";
import path from "node:path";
import { selectQpcV4Palette } from "@/lib/fonts/qpc-v4-palette";
import {
  DESKTOP_CONTENT_MAX_WIDTH,
  PERSISTENT_SIDEBAR_BREAKPOINT,
  SIDEBAR_BREAKPOINT,
  VIEWPORT_BREAKPOINTS,
} from "@/lib/ui/viewport";

const root = process.cwd();

describe("font and viewport contracts", () => {
  it("keeps canonical viewport breakpoints stable", () => {
    expect(VIEWPORT_BREAKPOINTS).toEqual({
      phoneCompact: 360,
      phoneLarge: 412,
      mediumWindow: 600,
      sidebar: 768,
      sidebarValidation: 1024,
      desktop: 1440,
    });
    expect(SIDEBAR_BREAKPOINT).toBe(768);
    expect(PERSISTENT_SIDEBAR_BREAKPOINT).toBe(1024);
    expect(DESKTOP_CONTENT_MAX_WIDTH).toBe(1040);
  });

  it("keeps all 604 original QCF2 pages available for the Classic download", () => {
    for (let page = 1; page <= 604; page += 1) {
      expect(fs.existsSync(path.join(root, `assets/fonts/QPC_V2/p${page}.ttf`))).toBe(true);
    }
  });

  it("keeps every QCF2 page font represented in the require map", () => {
    const source = fs.readFileSync(path.join(root, "lib/fonts/qpc-v2-fonts.ts"), "utf8");
    const pageEntries = [...source.matchAll(/^\s*(\d+): require/mg)].map((match) => Number(match[1]));

    expect(pageEntries).toHaveLength(604);
    expect(pageEntries[0]).toBe(1);
    expect(pageEntries.at(-1)).toBe(604);
  });

  it("keeps web Quran font loading on native FontFace with display swap", () => {
    const source = fs.readFileSync(path.join(root, "lib/fonts/loader.ts"), "utf8");

    const registration = fs.readFileSync(path.join(root, "lib/fonts/register-font.ts"), "utf8");
    expect(registration).toContain("new FontFace");
    expect(registration).toContain('display: "swap"');
    expect(source).toContain("font-palette");
  });

  it.each([1, 3, 4])("selects V4 palette %i on every page without changing the glyph data", (palette) => {
    for (let page = 1; page <= 604; page += 1) {
      const original = fs.readFileSync(path.join(root, `assets/fonts/QPC_V4_TAJWEED/p${page}.ttf`));
      const font = Buffer.from(original);
      const table = (tag: string) => {
        for (let index = 0; index < font.readUInt16BE(4); index += 1) {
          const entry = 12 + index * 16;
          if (font.toString("ascii", entry, entry + 4) === tag) return entry;
        }
        throw new Error(`Page ${page} does not contain a ${tag} table`);
      };
      const cpal = table("CPAL");
      const paletteIndices = font.readUInt32BE(cpal + 8) + 12;
      const adjustment = font.readUInt32BE(table("head") + 8) + 8;

      selectQpcV4Palette(font, palette);

      expect(font.readUInt16BE(paletteIndices)).toBe(original.readUInt16BE(paletteIndices + palette * 2));
      let sum = 0;
      for (let offset = 0; offset < font.length; offset += 4) sum = (sum + font.readUInt32BE(offset)) >>> 0;
      expect(sum).toBe(0xb1b0afba);

      original.copy(font, paletteIndices, paletteIndices, paletteIndices + 2);
      original.copy(font, cpal + 4, cpal + 4, cpal + 8);
      original.copy(font, adjustment, adjustment, adjustment + 4);
      expect(font.compare(original)).toBe(0);
    }
  });

  it("keeps Quran word layout protected against RTL double-reversal", () => {
    const mushafPage = fs.readFileSync(path.join(root, "components/mushaf/MushafPage.tsx"), "utf8");
    const ayahBlock = fs.readFileSync(path.join(root, "components/mushaf/AyahBlock.tsx"), "utf8");
    const flashcardText = fs.readFileSync(path.join(root, "components/flashcards/Qcf2AyahText.tsx"), "utf8");

    for (const source of [mushafPage, ayahBlock, flashcardText]) {
      expect(source).toContain('direction: "ltr"');
      expect(source).toContain('flexDirection: "row-reverse"');
    }
  });
});
