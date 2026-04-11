/**
 * UI font loading for Manrope (body/UI) and Noto Serif (headlines).
 * Loaded at app startup via root layout.
 */
export const UI_FONTS = {
  Manrope_400Regular: require("@expo-google-fonts/manrope/400Regular/Manrope_400Regular.ttf"),
  Manrope_500Medium: require("@expo-google-fonts/manrope/500Medium/Manrope_500Medium.ttf"),
  Manrope_600SemiBold: require("@expo-google-fonts/manrope/600SemiBold/Manrope_600SemiBold.ttf"),
  Manrope_700Bold: require("@expo-google-fonts/manrope/700Bold/Manrope_700Bold.ttf"),
  NotoSerif_400Regular: require("@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf"),
  NotoSerif_500Medium: require("@expo-google-fonts/noto-serif/500Medium/NotoSerif_500Medium.ttf"),
  NotoSerif_700Bold: require("@expo-google-fonts/noto-serif/700Bold/NotoSerif_700Bold.ttf"),
};

/**
 * Load UI fonts on web via the native FontFace API with `display: swap`.
 *
 * Unlike expo-font (which uses `font-display: auto` and blocks rendering
 * on some browsers until the font is ready), `swap` lets the browser
 * immediately render text with a fallback and replace it once the real
 * font downloads. This drops first-paint from "wait for 7 TTFs" to
 * "render instantly, fonts streaming in".
 */
export async function loadUiFontsWeb(): Promise<void> {
  if (typeof document === "undefined") return;
  const { Asset } = await import("expo-asset");
  const entries = Object.entries(UI_FONTS);
  await Promise.all(
    entries.map(async ([name, asset]) => {
      const mod = Asset.fromModule(asset as any);
      await mod.downloadAsync();
      const uri = mod.localUri || mod.uri;
      const fontFace = new FontFace(name, `url("${uri}")`, { display: "swap" });
      (document.fonts as any).add(fontFace);
      try {
        await fontFace.load();
      } catch (err) {
        console.warn(`[UI Fonts] Failed to load ${name}`, err);
      }
    })
  );
}
