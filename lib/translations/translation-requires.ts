// Platform-aware translation loader.
// On native: static require() map (Metro needs static string literals).
// On web: fetch() from /data/translations/ at runtime.

import { Platform } from "react-native";

const nativeTranslationRequires: Record<string, () => any> = Platform.OS !== "web"
  ? {
      id: () => require("../../assets/data/translations/id.json"),
      bn: () => require("../../assets/data/translations/bn.json"),
      ur: () => require("../../assets/data/translations/ur.json"),
      fa: () => require("../../assets/data/translations/fa.json"),
      hi: () => require("../../assets/data/translations/hi.json"),
      tr: () => require("../../assets/data/translations/tr.json"),
      ha: () => require("../../assets/data/translations/ha.json"),
      fr: () => require("../../assets/data/translations/fr.json"),
      ps: () => require("../../assets/data/translations/ps.json"),
      sd: () => require("../../assets/data/translations/sd.json"),
      ru: () => require("../../assets/data/translations/ru.json"),
      ku: () => require("../../assets/data/translations/ku.json"),
      uz: () => require("../../assets/data/translations/uz.json"),
      sw: () => require("../../assets/data/translations/sw.json"),
      om: () => require("../../assets/data/translations/om.json"),
      am: () => require("../../assets/data/translations/am.json"),
      so: () => require("../../assets/data/translations/so.json"),
      az: () => require("../../assets/data/translations/az.json"),
      kk: () => require("../../assets/data/translations/kk.json"),
      ber: () => require("../../assets/data/translations/ber.json"),
    }
  : {};

export async function loadTranslation(langCode: string): Promise<any> {
  if (Platform.OS === "web") {
    const resp = await fetch(`/data/translations/${langCode}.json`);
    if (!resp.ok) throw new Error(`No bundled translation for language: ${langCode}`);
    return resp.json();
  }
  const loader = nativeTranslationRequires[langCode];
  if (!loader) throw new Error(`No bundled translation for language: ${langCode}`);
  return loader();
}

// Backwards-compatible sync export for code that checks langCode membership
export const translationRequires: Record<string, true> = {
  id: true, bn: true, ur: true, fa: true, hi: true, tr: true, ha: true,
  fr: true, ps: true, sd: true, ru: true, ku: true, uz: true, sw: true,
  om: true, am: true, so: true, az: true, kk: true, ber: true,
};
