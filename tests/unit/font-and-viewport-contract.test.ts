import fs from "node:fs";
import path from "node:path";
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
      sidebar: 768,
      sidebarValidation: 1024,
      desktop: 1440,
    });
    expect(SIDEBAR_BREAKPOINT).toBe(768);
    expect(PERSISTENT_SIDEBAR_BREAKPOINT).toBe(1024);
    expect(DESKTOP_CONTENT_MAX_WIDTH).toBe(1040);
  });

  it("keeps all 604 native QCF2 page fonts bundled", () => {
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

    expect(source).toContain("new FontFace");
    expect(source).toContain('display: "swap"');
    expect(source).toContain("font-palette");
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
