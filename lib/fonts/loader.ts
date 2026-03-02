import * as Font from "expo-font";
import { Platform } from "react-native";
import { QPC_V2_FONTS } from "./qpc-v2-fonts";

const loadedFonts = new Set<string>();
const inFlight = new Map<string, Promise<void>>();

/** Returns the font family name for a QPC V2 page font, e.g. "QCF2_001" */
export function qpcFontName(page: number): string {
  return `QCF2_${String(page).padStart(3, "0")}`;
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
  // On web, require('./font.ttf') goes through the metro bundler.
  // expo-asset resolves it to a servable URL.
  const { Asset } = await import("expo-asset");
  const mod = Asset.fromModule(asset);
  await mod.downloadAsync();
  const uri = mod.localUri || mod.uri;

  const fontFace = new FontFace(name, `url("${uri}")`, { display: "swap" });
  (document.fonts as any).add(fontFace);
  await fontFace.load();
  await document.fonts.ready;
}

/** Load the QPC V2 font for a specific page. No-op if already loaded.
 *  Concurrent calls for the same page share one Promise. */
export async function loadQpcFont(page: number): Promise<void> {
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
    if (Platform.OS === "web" && typeof document !== "undefined") {
      await loadFontWeb(name, asset);
    } else {
      await Font.loadAsync({ [name]: asset });
    }
    loadedFonts.add(name);
    inFlight.delete(name);
  })();

  inFlight.set(name, promise);
  return promise;
}

/** Check if the QPC V2 font for a page is already loaded */
export function isQpcFontLoaded(page: number): boolean {
  return loadedFonts.has(qpcFontName(page));
}
