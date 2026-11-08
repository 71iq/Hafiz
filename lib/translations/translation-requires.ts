// Platform-aware translation loader.
// On native: static require() map (Metro needs static string literals).
// On web: fetch() from /data/translations/ at runtime.

import { Platform } from "react-native";
import { readBundledJson } from "@/lib/database/bundled-json";

const nativeTranslationRequires: Record<string, () => any> = Platform.OS !== "web"
  ? {
      "en-bridges": () => readBundledJson(require("../../assets/native-data/translations/en-bridges.hafizdata")),
      id: () => readBundledJson(require("../../assets/native-data/translations/id.hafizdata")),
      bn: () => readBundledJson(require("../../assets/native-data/translations/bn.hafizdata")),
      ur: () => readBundledJson(require("../../assets/native-data/translations/ur.hafizdata")),
      fa: () => readBundledJson(require("../../assets/native-data/translations/fa.hafizdata")),
      hi: () => readBundledJson(require("../../assets/native-data/translations/hi.hafizdata")),
      tr: () => readBundledJson(require("../../assets/native-data/translations/tr.hafizdata")),
      ha: () => readBundledJson(require("../../assets/native-data/translations/ha.hafizdata")),
      fr: () => readBundledJson(require("../../assets/native-data/translations/fr.hafizdata")),
      ps: () => readBundledJson(require("../../assets/native-data/translations/ps.hafizdata")),
      sd: () => readBundledJson(require("../../assets/native-data/translations/sd.hafizdata")),
      ru: () => readBundledJson(require("../../assets/native-data/translations/ru.hafizdata")),
      ku: () => readBundledJson(require("../../assets/native-data/translations/ku.hafizdata")),
      uz: () => readBundledJson(require("../../assets/native-data/translations/uz.hafizdata")),
      sw: () => readBundledJson(require("../../assets/native-data/translations/sw.hafizdata")),
      om: () => readBundledJson(require("../../assets/native-data/translations/om.hafizdata")),
      am: () => readBundledJson(require("../../assets/native-data/translations/am.hafizdata")),
      so: () => readBundledJson(require("../../assets/native-data/translations/so.hafizdata")),
      az: () => readBundledJson(require("../../assets/native-data/translations/az.hafizdata")),
      kk: () => readBundledJson(require("../../assets/native-data/translations/kk.hafizdata")),
      ber: () => readBundledJson(require("../../assets/native-data/translations/ber.hafizdata")),
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
  "en-bridges": true,
  id: true, bn: true, ur: true, fa: true, hi: true, tr: true, ha: true,
  fr: true, ps: true, sd: true, ru: true, ku: true, uz: true, sw: true,
  om: true, am: true, so: true, az: true, kk: true, ber: true,
};
