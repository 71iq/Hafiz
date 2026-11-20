import * as Font from "expo-font";
import { Platform } from "react-native";

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
export async function registerFont(name: string, asset: string | number): Promise<void> {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    await Font.loadAsync(name, asset);
    return;
  }
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
