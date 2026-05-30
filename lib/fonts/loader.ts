import * as Font from "expo-font";
import { Platform } from "react-native";
import { QPC_V2_FONTS } from "./qpc-v2-fonts";
import { QPC_V4_TAJWEED_FONTS } from "./qpc-v4-tajweed-fonts";

const loadedFonts = new Set<string>();
const inFlight = new Map<string, Promise<void>>();
const paletteCss = new Set<string>();
const SURAH_NAME_FONT_FAMILY = "v4-surah-name";
const SURAH_NAME_FONT = require("../../assets/fonts/surah-names/surah_names_v4.ttf");
const QURAN_COMMON_FONT_FAMILY = "QuranCommon";
const QURAN_COMMON_FONT = require("../../assets/fonts/quran-common/quran-common.ttf");
export type QuranPageFontStyle = "qcf2" | "v4" | "v4-tajweed";
const SURAH_NAME_BISMILLAH_GLYPHS = "\uFC9A \uFC9B \uFC9E \uFCA4";
const SURAH_NAME_GLYPHS: Record<number, string> = {
  1: "\uFC45",
  2: "\uFC46",
  3: "\uFC47",
  4: "\uFC4A",
  5: "\uFC4B",
  6: "\uFC4E",
  7: "\uFC4F",
  8: "\uFC51",
  9: "\uFC52",
  10: "\uFC53",
  11: "\uFC55",
  12: "\uFC56",
  13: "\uFC58",
  14: "\uFC5A",
  15: "\uFC5B",
  16: "\uFC5C",
  17: "\uFC5D",
  18: "\uFC5E",
  19: "\uFC61",
  20: "\uFC62",
  21: "\uFC64",
  22: "\uFB51",
  23: "\uFB52",
  24: "\uFB54",
  25: "\uFB55",
  26: "\uFB57",
  27: "\uFB58",
  28: "\uFB5A",
  29: "\uFB5B",
  30: "\uFB5D",
  31: "\uFB5E",
  32: "\uFB60",
  33: "\uFB61",
  34: "\uFB63",
  35: "\uFB64",
  36: "\uFB66",
  37: "\uFB67",
  38: "\uFB69",
  39: "\uFB6A",
  40: "\uFB6C",
  41: "\uFB6D",
  42: "\uFB6F",
  43: "\uFB70",
  44: "\uFB72",
  45: "\uFB73",
  46: "\uFB75",
  47: "\uFB76",
  48: "\uFB78",
  49: "\uFB79",
  50: "\uFB7B",
  51: "\uFB7C",
  52: "\uFB7E",
  53: "\uFB7F",
  54: "\uFB81",
  55: "\uFB82",
  56: "\uFB84",
  57: "\uFB85",
  58: "\uFB87",
  59: "\uFB88",
  60: "\uFB8A",
  61: "\uFB8B",
  62: "\uFB8D",
  63: "\uFB8E",
  64: "\uFB90",
  65: "\uFB91",
  66: "\uFB93",
  67: "\uFB94",
  68: "\uFB96",
  69: "\uFB97",
  70: "\uFB99",
  71: "\uFB9A",
  72: "\uFB9C",
  73: "\uFB9D",
  74: "\uFB9F",
  75: "\uFBA0",
  76: "\uFBA2",
  77: "\uFBA3",
  78: "\uFBA5",
  79: "\uFBA6",
  80: "\uFBA8",
  81: "\uFBA9",
  82: "\uFBAB",
  83: "\uFBAC",
  84: "\uFBAE",
  85: "\uFBAF",
  86: "\uFBB1",
  87: "\uFBB2",
  88: "\uFBB4",
  89: "\uFBB5",
  90: "\uFBB7",
  91: "\uFBB8",
  92: "\uFBBA",
  93: "\uFBBB",
  94: "\uFBBD",
  95: "\uFBBE",
  96: "\uFBC0",
  97: "\uFBC1",
  98: "\uFBD3",
  99: "\uFBD4",
  100: "\uFBD6",
  101: "\uFBD7",
  102: "\uFBD9",
  103: "\uFBDA",
  104: "\uFBDC",
  105: "\uFBDD",
  106: "\uFBDF",
  107: "\uFBE0",
  108: "\uFBE2",
  109: "\uFBE3",
  110: "\uFBE5",
  111: "\uFBE6",
  112: "\uFBE8",
  113: "\uFBE9",
  114: "\uFBEB",
};

/** Returns the font family name for a QPC V2 page font, e.g. "QCF2_001" */
function qpcFontName(page: number): string {
  return `QCF2_${String(page).padStart(3, "0")}`;
}

function qpcV4TajweedFontName(page: number): string {
  return `p${page}-v4-tajweed`;
}

function isQpcV4Style(style: QuranPageFontStyle): boolean {
  return style === "v4" || style === "v4-tajweed";
}

export function quranPageFontName(style: QuranPageFontStyle, page: number): string {
  return isQpcV4Style(style) ? qpcV4TajweedFontName(page) : qpcFontName(page);
}

export function surahNameFontName(): string {
  return SURAH_NAME_FONT_FAMILY;
}

export function surahNameGlyph(surah: number): string | undefined {
  return SURAH_NAME_GLYPHS[surah];
}

export function surahNameBismillahGlyphs(): string {
  return SURAH_NAME_BISMILLAH_GLYPHS;
}

export function quranCommonFontName(): string {
  return QURAN_COMMON_FONT_FAMILY;
}

function formatJuzLigature(prefix: string, juz: number): string | undefined {
  if (!Number.isInteger(juz) || juz < 1 || juz > 30) return undefined;
  return `${prefix}${String(juz).padStart(3, "0")}`;
}

export function juzNameGlyph(juz: number): string | undefined {
  return formatJuzLigature("j", juz);
}

export function juzNumberGlyph(juz: number): string | undefined {
  return formatJuzLigature("juz", juz);
}

const QPC_V4_TAJWEED_PALETTES = {
  light: {
    base: 0,
    colors: [
      "#000000ff", "#A5A5A5ff", "#A5A5A5ff", "#B50000ff", "#FF7B00ff", "#CE9E00ff",
      "#09B000ff", "#3F48E6ff", "#2FADFFff", "#F40000ff", "#2CA4ABff", "#FF0080ff",
      "#D8E9D8ff", "#000000ff", "#000000ff", "#A5A5A5ff", "#CC9E00ff", "#00B000ff",
    ],
  },
  dark: {
    base: 5,
    colors: [
      "#E8E8E8ff", "#B0B0B0ff", "#B0B0B0ff", "#FF6B6Bff", "#FFA94Dff", "#FFD93Dff",
      "#6BCB77ff", "#4D96FFff", "#00D9FFff", "#FF4D6Dff", "#26C6DAff", "#FF80ABff",
      "#343A40ff", "#E8E8E8ff", "#E8E8E8ff", "#B0B0B0ff", "#FFD700ff", "#69F0AEff",
    ],
  },
  sepia: {
    base: 2,
    colors: [
      "#3D2914ff", "#5C4033ff", "#5C4033ff", "#B84000ff", "#C65D00ff", "#8B6914ff",
      "#1E7B1Eff", "#2E4A8Fff", "#0077A3ff", "#C41E3Aff", "#A32952ff", "#2D6A4Fff",
      "#FFF7EAff", "#8B0000ff", "#3D2914ff", "#5C4033ff", "#8B6508ff", "#1A6B1Aff",
    ],
  },
} as const;

const QPC_V4_PLAIN_TEXT_COLORS = {
  light: "#2D2D2Dff",
  dark: "#F5F5F5ff",
  sepia: "#2D2D2Dff",
} as const;

function qpcV4PaletteKey(theme: string): keyof typeof QPC_V4_TAJWEED_PALETTES {
  if (theme === "dark" || theme === "amoled") return "dark";
  if (theme === "beige") return "sepia";
  return "light";
}

export function qpcV4TajweedPaletteColor(theme: string, colorIndex: number): string {
  const palette = QPC_V4_TAJWEED_PALETTES[qpcV4PaletteKey(theme)];
  return palette.colors[colorIndex] ?? palette.colors[0];
}

function qpcV4TajweedPaletteName(page: number, theme: string): string {
  return `--hafiz-qpc-v4-${qpcV4PaletteKey(theme)}-p${page}`;
}

function qpcV4PlainPaletteName(page: number, theme: string): string {
  return `--hafiz-qpc-v4-plain-${qpcV4PaletteKey(theme)}-p${page}`;
}

function plainPaletteColors(themeKey: keyof typeof QPC_V4_TAJWEED_PALETTES): string[] {
  return Array(QPC_V4_TAJWEED_PALETTES[themeKey].colors.length)
    .fill(QPC_V4_PLAIN_TEXT_COLORS[themeKey]);
}

function ensureQpcV4PaletteCss(page: number, fontName: string) {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const cssKey = `qpc-v4-${page}`;
  if (paletteCss.has(cssKey)) return;

  const css = Object.entries(QPC_V4_TAJWEED_PALETTES).map(([key, palette]) => {
    const colors = palette.colors.map((color, index) => `${index} ${color}`).join(",\n      ");
    const plainColors = plainPaletteColors(key as keyof typeof QPC_V4_TAJWEED_PALETTES)
      .map((color, index) => `${index} ${color}`)
      .join(",\n      ");
    return `@font-palette-values --hafiz-qpc-v4-${key}-p${page} {
  font-family: '${fontName}';
  base-palette: ${palette.base};
  override-colors:
      ${colors};
}

@font-palette-values --hafiz-qpc-v4-plain-${key}-p${page} {
  font-family: '${fontName}';
  base-palette: ${palette.base};
  override-colors:
      ${plainColors};
}`;
  }).join("\n\n");

  const style = document.createElement("style");
  style.id = `hafiz-qpc-v4-palette-${page}`;
  style.textContent = css;
  document.head.appendChild(style);
  paletteCss.add(cssKey);
}

export function quranPageFontPaletteStyle(
  style: QuranPageFontStyle,
  page: number,
  theme: string,
): any {
  if (!isQpcV4Style(style) || Platform.OS !== "web") return null;
  return {
    fontPalette: style === "v4"
      ? qpcV4PlainPaletteName(page, theme)
      : qpcV4TajweedPaletteName(page, theme),
  };
}

/**
 * Load a QCF2 font on web using the native FontFace API with display: 'swap'.
 *
 * expo-font creates @font-face rules with font-display: auto, which gives
 * the browser discretion over when (or if) to swap in the loaded font.
 * For QCF2's Private Use Area codepoints this is fatal — the browser renders
 * Arabic Presentation Form fallback glyphs (letter pairs like "بي", "تر")
 * and may never swap to the real font.
 *
 * By using FontFace directly with display:'swap', the browser immediately
 * uses the custom font as soon as it's loaded — no post-hoc CSS patching needed.
 */
async function loadFontWeb(name: string, asset: any): Promise<void> {
  let uri: string;
  if (typeof asset === "string") {
    uri = asset;
  } else {
    const { Asset } = await import("expo-asset");
    const mod = Asset.fromModule(asset);
    await mod.downloadAsync();
    uri = mod.localUri || mod.uri;
  }

  const fontFace = new FontFace(name, `url("${uri}")`, { display: "swap" });
  (document.fonts as any).add(fontFace);
  await fontFace.load();
}

/** Load the QPC V2 font for a specific page. No-op if already loaded.
 *  Concurrent calls for the same page share one Promise. */
async function loadQpcFont(page: number): Promise<void> {
  const name = qpcFontName(page);
  if (loadedFonts.has(name)) return;

  // Share in-flight Promise so concurrent callers don't duplicate work
  const existing = inFlight.get(name);
  if (existing) return existing;

  const asset = QPC_V2_FONTS[page];
  if (!asset) {
    console.warn(`[QPC V2] No font asset for page ${page}`);
    return;
  }

  const promise = (async () => {
    try {
      if (Platform.OS === "web" && typeof document !== "undefined") {
        await loadFontWeb(name, asset);
      } else {
        await Font.loadAsync({ [name]: asset });
      }
      loadedFonts.add(name);
    } finally {
      inFlight.delete(name);
    }
  })();

  inFlight.set(name, promise);
  return promise;
}

/** Check if the QPC V2 font for a page is already loaded */
function isQpcFontLoaded(page: number): boolean {
  return loadedFonts.has(qpcFontName(page));
}

async function loadQpcV4TajweedFont(page: number): Promise<void> {
  const name = qpcV4TajweedFontName(page);
  if (loadedFonts.has(name)) {
    ensureQpcV4PaletteCss(page, name);
    return;
  }

  const existing = inFlight.get(name);
  if (existing) return existing;

  const asset = QPC_V4_TAJWEED_FONTS[page];
  if (!asset) {
    console.warn(`[QPC V4 Tajweed] No font asset for page ${page}`);
    return;
  }

  const promise = (async () => {
    try {
      if (Platform.OS === "web" && typeof document !== "undefined") {
        await loadFontWeb(name, asset);
      } else {
        await Font.loadAsync({ [name]: asset });
      }
      loadedFonts.add(name);
      ensureQpcV4PaletteCss(page, name);
    } finally {
      inFlight.delete(name);
    }
  })();

  inFlight.set(name, promise);
  return promise;
}

function isQpcV4TajweedFontLoaded(page: number): boolean {
  return loadedFonts.has(qpcV4TajweedFontName(page));
}

export async function loadQuranPageFont(style: QuranPageFontStyle, page: number): Promise<void> {
  return isQpcV4Style(style) ? loadQpcV4TajweedFont(page) : loadQpcFont(page);
}

export function isQuranPageFontLoaded(style: QuranPageFontStyle, page: number): boolean {
  return isQpcV4Style(style) ? isQpcV4TajweedFontLoaded(page) : isQpcFontLoaded(page);
}

export async function loadSurahNameFont(): Promise<void> {
  if (loadedFonts.has(SURAH_NAME_FONT_FAMILY)) return;

  const existing = inFlight.get(SURAH_NAME_FONT_FAMILY);
  if (existing) return existing;

  const promise = (async () => {
    try {
      if (Platform.OS === "web" && typeof document !== "undefined") {
        await loadFontWeb(SURAH_NAME_FONT_FAMILY, SURAH_NAME_FONT);
      } else {
        await Font.loadAsync({ [SURAH_NAME_FONT_FAMILY]: SURAH_NAME_FONT });
      }
      loadedFonts.add(SURAH_NAME_FONT_FAMILY);
    } finally {
      inFlight.delete(SURAH_NAME_FONT_FAMILY);
    }
  })();

  inFlight.set(SURAH_NAME_FONT_FAMILY, promise);
  return promise;
}

export function isSurahNameFontLoaded(): boolean {
  return loadedFonts.has(SURAH_NAME_FONT_FAMILY);
}

export async function loadQuranCommonFont(): Promise<void> {
  if (loadedFonts.has(QURAN_COMMON_FONT_FAMILY)) return;

  const existing = inFlight.get(QURAN_COMMON_FONT_FAMILY);
  if (existing) return existing;

  const promise = (async () => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      await loadFontWeb(QURAN_COMMON_FONT_FAMILY, QURAN_COMMON_FONT);
    } else {
      await Font.loadAsync({ [QURAN_COMMON_FONT_FAMILY]: QURAN_COMMON_FONT });
    }
    loadedFonts.add(QURAN_COMMON_FONT_FAMILY);
    inFlight.delete(QURAN_COMMON_FONT_FAMILY);
  })();

  inFlight.set(QURAN_COMMON_FONT_FAMILY, promise);
  return promise;
}

export function isQuranCommonFontLoaded(): boolean {
  return loadedFonts.has(QURAN_COMMON_FONT_FAMILY);
}
