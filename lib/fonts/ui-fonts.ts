export const UI_FONTS = {
  Manrope_400Regular: require("@expo-google-fonts/manrope/400Regular/Manrope_400Regular.ttf"),
  Manrope_500Medium: require("@expo-google-fonts/manrope/500Medium/Manrope_500Medium.ttf"),
  Manrope_600SemiBold: require("@expo-google-fonts/manrope/600SemiBold/Manrope_600SemiBold.ttf"),
  Manrope_700Bold: require("@expo-google-fonts/manrope/700Bold/Manrope_700Bold.ttf"),
  NotoSerif_400Regular: require("@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf"),
  NotoSerif_500Medium: require("@expo-google-fonts/noto-serif/500Medium/NotoSerif_500Medium.ttf"),
  NotoSerif_700Bold: require("@expo-google-fonts/noto-serif/700Bold/NotoSerif_700Bold.ttf"),
};

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
