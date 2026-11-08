import { Platform } from "react-native";
import { readBundledJson } from "./bundled-json";
import type { TafsirSourceId } from "@/lib/tafsir/sources";

// ─── Platform-aware data loading ─────────────────────────────
// On web: fetch from /data/ (static files served from public/)
// On native: require() the assets/native-data mirror, which Metro ships as assets rather than
// JavaScript, and read each file at runtime (RF188; see scripts/native-data-mirror.cjs)

// Native-only require map — these are stripped from the web bundle
// because the loadData() web path uses fetch() instead.
export const nativeRequires: Record<string, () => any> =
  Platform.OS !== "web"
    ? {
        "quran-data.json": () => readBundledJson(require("../../assets/native-data/quran-data.hafizdata")),
        "quran-qcf2.json": () => readBundledJson(require("../../assets/native-data/quran-qcf2.hafizdata")),
        "surah-info.json": () => readBundledJson(require("../../assets/native-data/surah-info.hafizdata")),
        "reflection-journey.json": () =>
          readBundledJson(require("../../assets/native-data/reflection-journey.hafizdata")),
        "translation-sahih.json": () =>
          readBundledJson(require("../../assets/native-data/translation-sahih.hafizdata")),
        "page-map.json": () => readBundledJson(require("../../assets/native-data/page-map.hafizdata")),
        "tajweed.json": () => readBundledJson(require("../../assets/native-data/tajweed.hafizdata")),
        "wbw/wbw.json": () => readBundledJson(require("../../assets/native-data/wbw/wbw.hafizdata")),
        "masaq/masaq-aggregated.json": () =>
          readBundledJson(require("../../assets/native-data/masaq/masaq-aggregated.hafizdata")),
        "layout/page-lines.json": () =>
          readBundledJson(require("../../assets/native-data/layout/page-lines.hafizdata")),
        "zilal.json": () => readBundledJson(require("../../assets/native-data/zilal.hafizdata")),
        "wbw-arabic-meanings.json": () =>
          readBundledJson(require("../../assets/native-data/wbw-arabic-meanings.hafizdata")),
        "irab-per-word.json": () => readBundledJson(require("../../assets/native-data/irab-per-word.hafizdata")),
        "tajweed-rules-ar.json": () => readBundledJson(require("../../assets/native-data/tajweed-rules-ar.hafizdata")),
        "tajweed-rules-en.json": () => readBundledJson(require("../../assets/native-data/tajweed-rules-en.hafizdata")),
        "al-qira-at-al-mawsoo-ah-al-qur-aniyyah.json": () =>
          readBundledJson(require("../../assets/native-data/al-qira-at-al-mawsoo-ah-al-qur-aniyyah.hafizdata")),
        "asbab-al-nuzul.json": () => readBundledJson(require("../../assets/native-data/asbab-al-nuzul.hafizdata")),
        "mutashabihat/nourquran_hafiz.json": () =>
          readBundledJson(require("../../assets/native-data/mutashabihat/nourquran_hafiz.hafizdata")),
      }
    : {};

export const nativeTafseerRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? Object.fromEntries(
        Array.from({ length: 114 }, (_, i) => i + 1).map((n) => [
          n,
          () => {
            // Metro needs static string literals — we use a switch
            return tafseerRequireStatic(n);
          },
        ]),
      )
    : {};

export const nativeTahrirTanwirRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? Object.fromEntries(
        Array.from({ length: 114 }, (_, i) => i + 1).map((n) => [n, () => tahrirTanwirRequireStatic(n)]),
      )
    : {};

export const nativeQurtubiRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? {
        1: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/1.hafizdata")),
        2: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/2.hafizdata")),
        3: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/3.hafizdata")),
        4: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/4.hafizdata")),
        5: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/5.hafizdata")),
        6: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/6.hafizdata")),
        7: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/7.hafizdata")),
        8: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/8.hafizdata")),
        9: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/9.hafizdata")),
        10: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/10.hafizdata")),
        11: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/11.hafizdata")),
        12: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/12.hafizdata")),
        13: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/13.hafizdata")),
        14: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/14.hafizdata")),
        15: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/15.hafizdata")),
        16: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/16.hafizdata")),
        17: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/17.hafizdata")),
        18: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/18.hafizdata")),
        19: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/19.hafizdata")),
        20: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/20.hafizdata")),
        21: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/21.hafizdata")),
        22: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/22.hafizdata")),
        23: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/23.hafizdata")),
        24: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/24.hafizdata")),
        25: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/25.hafizdata")),
        26: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/26.hafizdata")),
        27: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/27.hafizdata")),
        28: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/28.hafizdata")),
        29: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/29.hafizdata")),
        30: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/30.hafizdata")),
        31: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/31.hafizdata")),
        32: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/32.hafizdata")),
        33: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/33.hafizdata")),
        34: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/34.hafizdata")),
        35: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/35.hafizdata")),
        36: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/36.hafizdata")),
        37: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/37.hafizdata")),
        38: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/38.hafizdata")),
        39: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/39.hafizdata")),
        40: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/40.hafizdata")),
        41: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/41.hafizdata")),
        42: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/42.hafizdata")),
        43: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/43.hafizdata")),
        44: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/44.hafizdata")),
        45: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/45.hafizdata")),
        46: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/46.hafizdata")),
        47: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/47.hafizdata")),
        48: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/48.hafizdata")),
        49: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/49.hafizdata")),
        50: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/50.hafizdata")),
        51: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/51.hafizdata")),
        52: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/52.hafizdata")),
        53: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/53.hafizdata")),
        54: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/54.hafizdata")),
        55: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/55.hafizdata")),
        56: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/56.hafizdata")),
        57: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/57.hafizdata")),
        58: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/58.hafizdata")),
        59: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/59.hafizdata")),
        60: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/60.hafizdata")),
        61: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/61.hafizdata")),
        62: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/62.hafizdata")),
        63: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/63.hafizdata")),
        64: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/64.hafizdata")),
        65: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/65.hafizdata")),
        66: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/66.hafizdata")),
        67: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/67.hafizdata")),
        68: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/68.hafizdata")),
        69: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/69.hafizdata")),
        70: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/70.hafizdata")),
        71: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/71.hafizdata")),
        72: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/72.hafizdata")),
        73: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/73.hafizdata")),
        74: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/74.hafizdata")),
        75: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/75.hafizdata")),
        76: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/76.hafizdata")),
        77: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/77.hafizdata")),
        78: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/78.hafizdata")),
        79: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/79.hafizdata")),
        80: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/80.hafizdata")),
        81: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/81.hafizdata")),
        82: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/82.hafizdata")),
        83: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/83.hafizdata")),
        84: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/84.hafizdata")),
        85: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/85.hafizdata")),
        86: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/86.hafizdata")),
        87: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/87.hafizdata")),
        88: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/88.hafizdata")),
        89: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/89.hafizdata")),
        90: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/90.hafizdata")),
        91: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/91.hafizdata")),
        92: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/92.hafizdata")),
        93: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/93.hafizdata")),
        94: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/94.hafizdata")),
        95: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/95.hafizdata")),
        96: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/96.hafizdata")),
        97: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/97.hafizdata")),
        98: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/98.hafizdata")),
        99: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/99.hafizdata")),
        100: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/100.hafizdata")),
        101: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/101.hafizdata")),
        102: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/102.hafizdata")),
        103: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/103.hafizdata")),
        104: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/104.hafizdata")),
        105: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/105.hafizdata")),
        106: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/106.hafizdata")),
        107: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/107.hafizdata")),
        108: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/108.hafizdata")),
        109: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/109.hafizdata")),
        110: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/110.hafizdata")),
        111: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/111.hafizdata")),
        112: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/112.hafizdata")),
        113: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/113.hafizdata")),
        114: () => readBundledJson(require("../../assets/native-data/tafsir-sources/qurtubi/114.hafizdata")),
      }
    : {};

export const nativeKashshafRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? {
        1: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/1.hafizdata")),
        2: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/2.hafizdata")),
        3: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/3.hafizdata")),
        4: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/4.hafizdata")),
        5: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/5.hafizdata")),
        6: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/6.hafizdata")),
        7: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/7.hafizdata")),
        8: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/8.hafizdata")),
        9: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/9.hafizdata")),
        10: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/10.hafizdata")),
        11: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/11.hafizdata")),
        12: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/12.hafizdata")),
        13: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/13.hafizdata")),
        14: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/14.hafizdata")),
        15: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/15.hafizdata")),
        16: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/16.hafizdata")),
        17: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/17.hafizdata")),
        18: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/18.hafizdata")),
        19: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/19.hafizdata")),
        20: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/20.hafizdata")),
        21: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/21.hafizdata")),
        22: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/22.hafizdata")),
        23: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/23.hafizdata")),
        24: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/24.hafizdata")),
        25: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/25.hafizdata")),
        26: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/26.hafizdata")),
        27: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/27.hafizdata")),
        28: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/28.hafizdata")),
        29: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/29.hafizdata")),
        30: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/30.hafizdata")),
        31: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/31.hafizdata")),
        32: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/32.hafizdata")),
        33: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/33.hafizdata")),
        34: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/34.hafizdata")),
        35: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/35.hafizdata")),
        36: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/36.hafizdata")),
        37: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/37.hafizdata")),
        38: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/38.hafizdata")),
        39: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/39.hafizdata")),
        40: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/40.hafizdata")),
        41: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/41.hafizdata")),
        42: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/42.hafizdata")),
        43: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/43.hafizdata")),
        44: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/44.hafizdata")),
        45: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/45.hafizdata")),
        46: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/46.hafizdata")),
        47: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/47.hafizdata")),
        48: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/48.hafizdata")),
        49: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/49.hafizdata")),
        50: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/50.hafizdata")),
        51: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/51.hafizdata")),
        52: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/52.hafizdata")),
        53: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/53.hafizdata")),
        54: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/54.hafizdata")),
        55: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/55.hafizdata")),
        56: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/56.hafizdata")),
        57: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/57.hafizdata")),
        58: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/58.hafizdata")),
        59: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/59.hafizdata")),
        60: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/60.hafizdata")),
        61: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/61.hafizdata")),
        62: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/62.hafizdata")),
        63: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/63.hafizdata")),
        64: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/64.hafizdata")),
        65: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/65.hafizdata")),
        66: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/66.hafizdata")),
        67: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/67.hafizdata")),
        68: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/68.hafizdata")),
        69: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/69.hafizdata")),
        70: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/70.hafizdata")),
        71: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/71.hafizdata")),
        72: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/72.hafizdata")),
        73: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/73.hafizdata")),
        74: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/74.hafizdata")),
        75: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/75.hafizdata")),
        76: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/76.hafizdata")),
        77: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/77.hafizdata")),
        78: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/78.hafizdata")),
        79: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/79.hafizdata")),
        80: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/80.hafizdata")),
        81: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/81.hafizdata")),
        82: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/82.hafizdata")),
        83: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/83.hafizdata")),
        84: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/84.hafizdata")),
        85: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/85.hafizdata")),
        86: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/86.hafizdata")),
        87: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/87.hafizdata")),
        88: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/88.hafizdata")),
        89: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/89.hafizdata")),
        90: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/90.hafizdata")),
        91: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/91.hafizdata")),
        92: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/92.hafizdata")),
        93: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/93.hafizdata")),
        94: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/94.hafizdata")),
        95: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/95.hafizdata")),
        96: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/96.hafizdata")),
        97: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/97.hafizdata")),
        98: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/98.hafizdata")),
        99: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/99.hafizdata")),
        100: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/100.hafizdata")),
        101: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/101.hafizdata")),
        102: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/102.hafizdata")),
        103: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/103.hafizdata")),
        104: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/104.hafizdata")),
        105: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/105.hafizdata")),
        106: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/106.hafizdata")),
        107: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/107.hafizdata")),
        108: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/108.hafizdata")),
        109: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/109.hafizdata")),
        110: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/110.hafizdata")),
        111: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/111.hafizdata")),
        112: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/112.hafizdata")),
        113: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/113.hafizdata")),
        114: () => readBundledJson(require("../../assets/native-data/tafsir-sources/kashshaf/114.hafizdata")),
      }
    : {};

export const nativeAlusiRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? {
        1: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/1.hafizdata")),
        2: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/2.hafizdata")),
        3: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/3.hafizdata")),
        4: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/4.hafizdata")),
        5: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/5.hafizdata")),
        6: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/6.hafizdata")),
        7: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/7.hafizdata")),
        8: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/8.hafizdata")),
        9: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/9.hafizdata")),
        10: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/10.hafizdata")),
        11: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/11.hafizdata")),
        12: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/12.hafizdata")),
        13: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/13.hafizdata")),
        14: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/14.hafizdata")),
        15: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/15.hafizdata")),
        16: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/16.hafizdata")),
        17: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/17.hafizdata")),
        18: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/18.hafizdata")),
        19: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/19.hafizdata")),
        20: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/20.hafizdata")),
        21: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/21.hafizdata")),
        22: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/22.hafizdata")),
        23: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/23.hafizdata")),
        24: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/24.hafizdata")),
        25: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/25.hafizdata")),
        26: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/26.hafizdata")),
        27: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/27.hafizdata")),
        28: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/28.hafizdata")),
        29: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/29.hafizdata")),
        30: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/30.hafizdata")),
        31: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/31.hafizdata")),
        32: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/32.hafizdata")),
        33: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/33.hafizdata")),
        34: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/34.hafizdata")),
        35: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/35.hafizdata")),
        36: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/36.hafizdata")),
        37: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/37.hafizdata")),
        38: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/38.hafizdata")),
        39: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/39.hafizdata")),
        40: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/40.hafizdata")),
        41: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/41.hafizdata")),
        42: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/42.hafizdata")),
        43: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/43.hafizdata")),
        44: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/44.hafizdata")),
        45: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/45.hafizdata")),
        46: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/46.hafizdata")),
        47: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/47.hafizdata")),
        48: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/48.hafizdata")),
        49: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/49.hafizdata")),
        50: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/50.hafizdata")),
        51: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/51.hafizdata")),
        52: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/52.hafizdata")),
        53: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/53.hafizdata")),
        54: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/54.hafizdata")),
        55: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/55.hafizdata")),
        56: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/56.hafizdata")),
        57: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/57.hafizdata")),
        58: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/58.hafizdata")),
        59: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/59.hafizdata")),
        60: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/60.hafizdata")),
        61: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/61.hafizdata")),
        62: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/62.hafizdata")),
        63: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/63.hafizdata")),
        64: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/64.hafizdata")),
        65: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/65.hafizdata")),
        66: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/66.hafizdata")),
        67: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/67.hafizdata")),
        68: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/68.hafizdata")),
        69: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/69.hafizdata")),
        70: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/70.hafizdata")),
        71: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/71.hafizdata")),
        72: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/72.hafizdata")),
        73: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/73.hafizdata")),
        74: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/74.hafizdata")),
        75: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/75.hafizdata")),
        76: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/76.hafizdata")),
        77: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/77.hafizdata")),
        78: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/78.hafizdata")),
        79: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/79.hafizdata")),
        80: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/80.hafizdata")),
        81: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/81.hafizdata")),
        82: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/82.hafizdata")),
        83: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/83.hafizdata")),
        84: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/84.hafizdata")),
        85: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/85.hafizdata")),
        86: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/86.hafizdata")),
        87: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/87.hafizdata")),
        88: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/88.hafizdata")),
        89: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/89.hafizdata")),
        90: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/90.hafizdata")),
        91: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/91.hafizdata")),
        92: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/92.hafizdata")),
        93: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/93.hafizdata")),
        94: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/94.hafizdata")),
        95: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/95.hafizdata")),
        96: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/96.hafizdata")),
        97: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/97.hafizdata")),
        98: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/98.hafizdata")),
        99: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/99.hafizdata")),
        100: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/100.hafizdata")),
        101: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/101.hafizdata")),
        102: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/102.hafizdata")),
        103: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/103.hafizdata")),
        104: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/104.hafizdata")),
        105: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/105.hafizdata")),
        106: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/106.hafizdata")),
        107: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/107.hafizdata")),
        108: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/108.hafizdata")),
        109: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/109.hafizdata")),
        110: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/110.hafizdata")),
        111: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/111.hafizdata")),
        112: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/112.hafizdata")),
        113: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/113.hafizdata")),
        114: () => readBundledJson(require("../../assets/native-data/tafsir-sources/alusi/114.hafizdata")),
      }
    : {};

export const nativeNazamDurarRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? {
        1: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/1.hafizdata")),
        2: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/2.hafizdata")),
        3: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/3.hafizdata")),
        4: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/4.hafizdata")),
        5: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/5.hafizdata")),
        6: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/6.hafizdata")),
        7: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/7.hafizdata")),
        8: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/8.hafizdata")),
        9: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/9.hafizdata")),
        10: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/10.hafizdata")),
        11: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/11.hafizdata")),
        12: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/12.hafizdata")),
        13: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/13.hafizdata")),
        14: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/14.hafizdata")),
        15: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/15.hafizdata")),
        16: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/16.hafizdata")),
        17: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/17.hafizdata")),
        18: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/18.hafizdata")),
        19: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/19.hafizdata")),
        20: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/20.hafizdata")),
        21: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/21.hafizdata")),
        22: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/22.hafizdata")),
        23: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/23.hafizdata")),
        24: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/24.hafizdata")),
        25: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/25.hafizdata")),
        26: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/26.hafizdata")),
        27: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/27.hafizdata")),
        28: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/28.hafizdata")),
        29: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/29.hafizdata")),
        30: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/30.hafizdata")),
        31: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/31.hafizdata")),
        32: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/32.hafizdata")),
        33: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/33.hafizdata")),
        34: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/34.hafizdata")),
        35: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/35.hafizdata")),
        36: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/36.hafizdata")),
        37: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/37.hafizdata")),
        38: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/38.hafizdata")),
        39: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/39.hafizdata")),
        40: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/40.hafizdata")),
        41: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/41.hafizdata")),
        42: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/42.hafizdata")),
        43: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/43.hafizdata")),
        44: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/44.hafizdata")),
        45: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/45.hafizdata")),
        46: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/46.hafizdata")),
        47: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/47.hafizdata")),
        48: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/48.hafizdata")),
        49: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/49.hafizdata")),
        50: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/50.hafizdata")),
        51: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/51.hafizdata")),
        52: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/52.hafizdata")),
        53: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/53.hafizdata")),
        54: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/54.hafizdata")),
        55: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/55.hafizdata")),
        56: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/56.hafizdata")),
        57: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/57.hafizdata")),
        58: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/58.hafizdata")),
        59: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/59.hafizdata")),
        60: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/60.hafizdata")),
        61: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/61.hafizdata")),
        62: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/62.hafizdata")),
        63: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/63.hafizdata")),
        64: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/64.hafizdata")),
        65: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/65.hafizdata")),
        66: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/66.hafizdata")),
        67: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/67.hafizdata")),
        68: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/68.hafizdata")),
        69: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/69.hafizdata")),
        70: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/70.hafizdata")),
        71: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/71.hafizdata")),
        72: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/72.hafizdata")),
        73: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/73.hafizdata")),
        74: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/74.hafizdata")),
        75: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/75.hafizdata")),
        76: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/76.hafizdata")),
        77: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/77.hafizdata")),
        78: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/78.hafizdata")),
        79: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/79.hafizdata")),
        80: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/80.hafizdata")),
        81: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/81.hafizdata")),
        82: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/82.hafizdata")),
        83: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/83.hafizdata")),
        84: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/84.hafizdata")),
        85: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/85.hafizdata")),
        86: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/86.hafizdata")),
        87: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/87.hafizdata")),
        88: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/88.hafizdata")),
        89: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/89.hafizdata")),
        90: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/90.hafizdata")),
        91: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/91.hafizdata")),
        92: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/92.hafizdata")),
        93: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/93.hafizdata")),
        94: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/94.hafizdata")),
        95: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/95.hafizdata")),
        96: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/96.hafizdata")),
        97: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/97.hafizdata")),
        98: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/98.hafizdata")),
        99: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/99.hafizdata")),
        100: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/100.hafizdata")),
        101: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/101.hafizdata")),
        102: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/102.hafizdata")),
        103: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/103.hafizdata")),
        104: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/104.hafizdata")),
        105: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/105.hafizdata")),
        106: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/106.hafizdata")),
        107: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/107.hafizdata")),
        108: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/108.hafizdata")),
        109: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/109.hafizdata")),
        110: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/110.hafizdata")),
        111: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/111.hafizdata")),
        112: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/112.hafizdata")),
        113: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/113.hafizdata")),
        114: () => readBundledJson(require("../../assets/native-data/tafsir-sources/nazam-durar/114.hafizdata")),
      }
    : {};

export const nativeRaziRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? {
        1: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/1.hafizdata")),
        2: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/2.hafizdata")),
        3: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/3.hafizdata")),
        4: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/4.hafizdata")),
        5: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/5.hafizdata")),
        6: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/6.hafizdata")),
        7: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/7.hafizdata")),
        8: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/8.hafizdata")),
        9: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/9.hafizdata")),
        10: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/10.hafizdata")),
        11: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/11.hafizdata")),
        12: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/12.hafizdata")),
        13: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/13.hafizdata")),
        14: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/14.hafizdata")),
        15: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/15.hafizdata")),
        16: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/16.hafizdata")),
        17: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/17.hafizdata")),
        18: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/18.hafizdata")),
        19: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/19.hafizdata")),
        20: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/20.hafizdata")),
        21: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/21.hafizdata")),
        22: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/22.hafizdata")),
        23: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/23.hafizdata")),
        24: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/24.hafizdata")),
        25: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/25.hafizdata")),
        26: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/26.hafizdata")),
        27: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/27.hafizdata")),
        28: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/28.hafizdata")),
        29: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/29.hafizdata")),
        30: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/30.hafizdata")),
        31: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/31.hafizdata")),
        32: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/32.hafizdata")),
        33: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/33.hafizdata")),
        34: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/34.hafizdata")),
        35: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/35.hafizdata")),
        36: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/36.hafizdata")),
        37: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/37.hafizdata")),
        38: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/38.hafizdata")),
        39: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/39.hafizdata")),
        40: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/40.hafizdata")),
        41: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/41.hafizdata")),
        42: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/42.hafizdata")),
        43: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/43.hafizdata")),
        44: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/44.hafizdata")),
        45: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/45.hafizdata")),
        46: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/46.hafizdata")),
        47: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/47.hafizdata")),
        48: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/48.hafizdata")),
        49: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/49.hafizdata")),
        50: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/50.hafizdata")),
        51: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/51.hafizdata")),
        52: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/52.hafizdata")),
        53: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/53.hafizdata")),
        54: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/54.hafizdata")),
        55: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/55.hafizdata")),
        56: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/56.hafizdata")),
        57: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/57.hafizdata")),
        58: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/58.hafizdata")),
        59: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/59.hafizdata")),
        60: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/60.hafizdata")),
        61: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/61.hafizdata")),
        62: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/62.hafizdata")),
        63: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/63.hafizdata")),
        64: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/64.hafizdata")),
        65: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/65.hafizdata")),
        66: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/66.hafizdata")),
        67: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/67.hafizdata")),
        68: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/68.hafizdata")),
        69: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/69.hafizdata")),
        70: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/70.hafizdata")),
        71: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/71.hafizdata")),
        72: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/72.hafizdata")),
        73: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/73.hafizdata")),
        74: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/74.hafizdata")),
        75: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/75.hafizdata")),
        76: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/76.hafizdata")),
        77: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/77.hafizdata")),
        78: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/78.hafizdata")),
        79: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/79.hafizdata")),
        80: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/80.hafizdata")),
        81: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/81.hafizdata")),
        82: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/82.hafizdata")),
        83: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/83.hafizdata")),
        84: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/84.hafizdata")),
        85: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/85.hafizdata")),
        86: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/86.hafizdata")),
        87: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/87.hafizdata")),
        88: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/88.hafizdata")),
        89: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/89.hafizdata")),
        90: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/90.hafizdata")),
        91: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/91.hafizdata")),
        92: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/92.hafizdata")),
        93: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/93.hafizdata")),
        94: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/94.hafizdata")),
        95: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/95.hafizdata")),
        96: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/96.hafizdata")),
        97: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/97.hafizdata")),
        98: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/98.hafizdata")),
        99: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/99.hafizdata")),
        100: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/100.hafizdata")),
        101: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/101.hafizdata")),
        102: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/102.hafizdata")),
        103: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/103.hafizdata")),
        104: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/104.hafizdata")),
        105: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/105.hafizdata")),
        106: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/106.hafizdata")),
        107: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/107.hafizdata")),
        108: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/108.hafizdata")),
        109: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/109.hafizdata")),
        110: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/110.hafizdata")),
        111: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/111.hafizdata")),
        112: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/112.hafizdata")),
        113: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/113.hafizdata")),
        114: () => readBundledJson(require("../../assets/native-data/tafsir-sources/razi/114.hafizdata")),
      }
    : {};

export const nativeJalalaynRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? {
        1: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/1.hafizdata")),
        2: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/2.hafizdata")),
        3: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/3.hafizdata")),
        4: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/4.hafizdata")),
        5: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/5.hafizdata")),
        6: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/6.hafizdata")),
        7: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/7.hafizdata")),
        8: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/8.hafizdata")),
        9: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/9.hafizdata")),
        10: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/10.hafizdata")),
        11: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/11.hafizdata")),
        12: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/12.hafizdata")),
        13: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/13.hafizdata")),
        14: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/14.hafizdata")),
        15: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/15.hafizdata")),
        16: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/16.hafizdata")),
        17: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/17.hafizdata")),
        18: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/18.hafizdata")),
        19: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/19.hafizdata")),
        20: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/20.hafizdata")),
        21: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/21.hafizdata")),
        22: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/22.hafizdata")),
        23: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/23.hafizdata")),
        24: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/24.hafizdata")),
        25: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/25.hafizdata")),
        26: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/26.hafizdata")),
        27: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/27.hafizdata")),
        28: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/28.hafizdata")),
        29: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/29.hafizdata")),
        30: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/30.hafizdata")),
        31: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/31.hafizdata")),
        32: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/32.hafizdata")),
        33: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/33.hafizdata")),
        34: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/34.hafizdata")),
        35: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/35.hafizdata")),
        36: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/36.hafizdata")),
        37: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/37.hafizdata")),
        38: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/38.hafizdata")),
        39: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/39.hafizdata")),
        40: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/40.hafizdata")),
        41: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/41.hafizdata")),
        42: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/42.hafizdata")),
        43: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/43.hafizdata")),
        44: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/44.hafizdata")),
        45: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/45.hafizdata")),
        46: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/46.hafizdata")),
        47: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/47.hafizdata")),
        48: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/48.hafizdata")),
        49: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/49.hafizdata")),
        50: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/50.hafizdata")),
        51: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/51.hafizdata")),
        52: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/52.hafizdata")),
        53: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/53.hafizdata")),
        54: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/54.hafizdata")),
        55: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/55.hafizdata")),
        56: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/56.hafizdata")),
        57: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/57.hafizdata")),
        58: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/58.hafizdata")),
        59: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/59.hafizdata")),
        60: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/60.hafizdata")),
        61: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/61.hafizdata")),
        62: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/62.hafizdata")),
        63: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/63.hafizdata")),
        64: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/64.hafizdata")),
        65: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/65.hafizdata")),
        66: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/66.hafizdata")),
        67: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/67.hafizdata")),
        68: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/68.hafizdata")),
        69: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/69.hafizdata")),
        70: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/70.hafizdata")),
        71: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/71.hafizdata")),
        72: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/72.hafizdata")),
        73: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/73.hafizdata")),
        74: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/74.hafizdata")),
        75: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/75.hafizdata")),
        76: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/76.hafizdata")),
        77: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/77.hafizdata")),
        78: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/78.hafizdata")),
        79: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/79.hafizdata")),
        80: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/80.hafizdata")),
        81: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/81.hafizdata")),
        82: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/82.hafizdata")),
        83: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/83.hafizdata")),
        84: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/84.hafizdata")),
        85: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/85.hafizdata")),
        86: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/86.hafizdata")),
        87: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/87.hafizdata")),
        88: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/88.hafizdata")),
        89: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/89.hafizdata")),
        90: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/90.hafizdata")),
        91: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/91.hafizdata")),
        92: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/92.hafizdata")),
        93: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/93.hafizdata")),
        94: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/94.hafizdata")),
        95: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/95.hafizdata")),
        96: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/96.hafizdata")),
        97: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/97.hafizdata")),
        98: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/98.hafizdata")),
        99: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/99.hafizdata")),
        100: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/100.hafizdata")),
        101: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/101.hafizdata")),
        102: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/102.hafizdata")),
        103: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/103.hafizdata")),
        104: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/104.hafizdata")),
        105: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/105.hafizdata")),
        106: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/106.hafizdata")),
        107: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/107.hafizdata")),
        108: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/108.hafizdata")),
        109: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/109.hafizdata")),
        110: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/110.hafizdata")),
        111: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/111.hafizdata")),
        112: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/112.hafizdata")),
        113: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/113.hafizdata")),
        114: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn/114.hafizdata")),
      }
    : {};

export const nativeJalalaynEnRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? {
        1: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/1.hafizdata")),
        2: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/2.hafizdata")),
        3: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/3.hafizdata")),
        4: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/4.hafizdata")),
        5: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/5.hafizdata")),
        6: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/6.hafizdata")),
        7: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/7.hafizdata")),
        8: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/8.hafizdata")),
        9: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/9.hafizdata")),
        10: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/10.hafizdata")),
        11: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/11.hafizdata")),
        12: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/12.hafizdata")),
        13: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/13.hafizdata")),
        14: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/14.hafizdata")),
        15: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/15.hafizdata")),
        16: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/16.hafizdata")),
        17: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/17.hafizdata")),
        18: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/18.hafizdata")),
        19: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/19.hafizdata")),
        20: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/20.hafizdata")),
        21: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/21.hafizdata")),
        22: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/22.hafizdata")),
        23: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/23.hafizdata")),
        24: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/24.hafizdata")),
        25: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/25.hafizdata")),
        26: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/26.hafizdata")),
        27: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/27.hafizdata")),
        28: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/28.hafizdata")),
        29: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/29.hafizdata")),
        30: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/30.hafizdata")),
        31: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/31.hafizdata")),
        32: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/32.hafizdata")),
        33: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/33.hafizdata")),
        34: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/34.hafizdata")),
        35: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/35.hafizdata")),
        36: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/36.hafizdata")),
        37: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/37.hafizdata")),
        38: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/38.hafizdata")),
        39: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/39.hafizdata")),
        40: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/40.hafizdata")),
        41: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/41.hafizdata")),
        42: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/42.hafizdata")),
        43: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/43.hafizdata")),
        44: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/44.hafizdata")),
        45: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/45.hafizdata")),
        46: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/46.hafizdata")),
        47: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/47.hafizdata")),
        48: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/48.hafizdata")),
        49: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/49.hafizdata")),
        50: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/50.hafizdata")),
        51: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/51.hafizdata")),
        52: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/52.hafizdata")),
        53: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/53.hafizdata")),
        54: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/54.hafizdata")),
        55: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/55.hafizdata")),
        56: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/56.hafizdata")),
        57: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/57.hafizdata")),
        58: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/58.hafizdata")),
        59: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/59.hafizdata")),
        60: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/60.hafizdata")),
        61: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/61.hafizdata")),
        62: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/62.hafizdata")),
        63: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/63.hafizdata")),
        64: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/64.hafizdata")),
        65: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/65.hafizdata")),
        66: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/66.hafizdata")),
        67: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/67.hafizdata")),
        68: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/68.hafizdata")),
        69: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/69.hafizdata")),
        70: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/70.hafizdata")),
        71: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/71.hafizdata")),
        72: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/72.hafizdata")),
        73: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/73.hafizdata")),
        74: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/74.hafizdata")),
        75: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/75.hafizdata")),
        76: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/76.hafizdata")),
        77: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/77.hafizdata")),
        78: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/78.hafizdata")),
        79: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/79.hafizdata")),
        80: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/80.hafizdata")),
        81: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/81.hafizdata")),
        82: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/82.hafizdata")),
        83: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/83.hafizdata")),
        84: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/84.hafizdata")),
        85: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/85.hafizdata")),
        86: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/86.hafizdata")),
        87: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/87.hafizdata")),
        88: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/88.hafizdata")),
        89: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/89.hafizdata")),
        90: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/90.hafizdata")),
        91: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/91.hafizdata")),
        92: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/92.hafizdata")),
        93: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/93.hafizdata")),
        94: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/94.hafizdata")),
        95: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/95.hafizdata")),
        96: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/96.hafizdata")),
        97: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/97.hafizdata")),
        98: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/98.hafizdata")),
        99: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/99.hafizdata")),
        100: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/100.hafizdata")),
        101: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/101.hafizdata")),
        102: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/102.hafizdata")),
        103: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/103.hafizdata")),
        104: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/104.hafizdata")),
        105: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/105.hafizdata")),
        106: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/106.hafizdata")),
        107: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/107.hafizdata")),
        108: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/108.hafizdata")),
        109: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/109.hafizdata")),
        110: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/110.hafizdata")),
        111: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/111.hafizdata")),
        112: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/112.hafizdata")),
        113: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/113.hafizdata")),
        114: () => readBundledJson(require("../../assets/native-data/tafsir-sources/jalalayn-en/114.hafizdata")),
      }
    : {};

export const nativeAlBahrAlMadidRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? Object.fromEntries(
        Array.from({ length: 114 }, (_, i) => i + 1).map((n) => [n, () => alBahrAlMadidRequireStatic(n)]),
      )
    : {};

function tafseerRequireStatic(n: number): any {
  // Metro bundler requires static string literals for require() calls.
  // This function is only called on native, never on web.
  switch (n) {
    case 1:
      return readBundledJson(require("../../assets/native-data/tafseer/1.hafizdata"));
    case 2:
      return readBundledJson(require("../../assets/native-data/tafseer/2.hafizdata"));
    case 3:
      return readBundledJson(require("../../assets/native-data/tafseer/3.hafizdata"));
    case 4:
      return readBundledJson(require("../../assets/native-data/tafseer/4.hafizdata"));
    case 5:
      return readBundledJson(require("../../assets/native-data/tafseer/5.hafizdata"));
    case 6:
      return readBundledJson(require("../../assets/native-data/tafseer/6.hafizdata"));
    case 7:
      return readBundledJson(require("../../assets/native-data/tafseer/7.hafizdata"));
    case 8:
      return readBundledJson(require("../../assets/native-data/tafseer/8.hafizdata"));
    case 9:
      return readBundledJson(require("../../assets/native-data/tafseer/9.hafizdata"));
    case 10:
      return readBundledJson(require("../../assets/native-data/tafseer/10.hafizdata"));
    case 11:
      return readBundledJson(require("../../assets/native-data/tafseer/11.hafizdata"));
    case 12:
      return readBundledJson(require("../../assets/native-data/tafseer/12.hafizdata"));
    case 13:
      return readBundledJson(require("../../assets/native-data/tafseer/13.hafizdata"));
    case 14:
      return readBundledJson(require("../../assets/native-data/tafseer/14.hafizdata"));
    case 15:
      return readBundledJson(require("../../assets/native-data/tafseer/15.hafizdata"));
    case 16:
      return readBundledJson(require("../../assets/native-data/tafseer/16.hafizdata"));
    case 17:
      return readBundledJson(require("../../assets/native-data/tafseer/17.hafizdata"));
    case 18:
      return readBundledJson(require("../../assets/native-data/tafseer/18.hafizdata"));
    case 19:
      return readBundledJson(require("../../assets/native-data/tafseer/19.hafizdata"));
    case 20:
      return readBundledJson(require("../../assets/native-data/tafseer/20.hafizdata"));
    case 21:
      return readBundledJson(require("../../assets/native-data/tafseer/21.hafizdata"));
    case 22:
      return readBundledJson(require("../../assets/native-data/tafseer/22.hafizdata"));
    case 23:
      return readBundledJson(require("../../assets/native-data/tafseer/23.hafizdata"));
    case 24:
      return readBundledJson(require("../../assets/native-data/tafseer/24.hafizdata"));
    case 25:
      return readBundledJson(require("../../assets/native-data/tafseer/25.hafizdata"));
    case 26:
      return readBundledJson(require("../../assets/native-data/tafseer/26.hafizdata"));
    case 27:
      return readBundledJson(require("../../assets/native-data/tafseer/27.hafizdata"));
    case 28:
      return readBundledJson(require("../../assets/native-data/tafseer/28.hafizdata"));
    case 29:
      return readBundledJson(require("../../assets/native-data/tafseer/29.hafizdata"));
    case 30:
      return readBundledJson(require("../../assets/native-data/tafseer/30.hafizdata"));
    case 31:
      return readBundledJson(require("../../assets/native-data/tafseer/31.hafizdata"));
    case 32:
      return readBundledJson(require("../../assets/native-data/tafseer/32.hafizdata"));
    case 33:
      return readBundledJson(require("../../assets/native-data/tafseer/33.hafizdata"));
    case 34:
      return readBundledJson(require("../../assets/native-data/tafseer/34.hafizdata"));
    case 35:
      return readBundledJson(require("../../assets/native-data/tafseer/35.hafizdata"));
    case 36:
      return readBundledJson(require("../../assets/native-data/tafseer/36.hafizdata"));
    case 37:
      return readBundledJson(require("../../assets/native-data/tafseer/37.hafizdata"));
    case 38:
      return readBundledJson(require("../../assets/native-data/tafseer/38.hafizdata"));
    case 39:
      return readBundledJson(require("../../assets/native-data/tafseer/39.hafizdata"));
    case 40:
      return readBundledJson(require("../../assets/native-data/tafseer/40.hafizdata"));
    case 41:
      return readBundledJson(require("../../assets/native-data/tafseer/41.hafizdata"));
    case 42:
      return readBundledJson(require("../../assets/native-data/tafseer/42.hafizdata"));
    case 43:
      return readBundledJson(require("../../assets/native-data/tafseer/43.hafizdata"));
    case 44:
      return readBundledJson(require("../../assets/native-data/tafseer/44.hafizdata"));
    case 45:
      return readBundledJson(require("../../assets/native-data/tafseer/45.hafizdata"));
    case 46:
      return readBundledJson(require("../../assets/native-data/tafseer/46.hafizdata"));
    case 47:
      return readBundledJson(require("../../assets/native-data/tafseer/47.hafizdata"));
    case 48:
      return readBundledJson(require("../../assets/native-data/tafseer/48.hafizdata"));
    case 49:
      return readBundledJson(require("../../assets/native-data/tafseer/49.hafizdata"));
    case 50:
      return readBundledJson(require("../../assets/native-data/tafseer/50.hafizdata"));
    case 51:
      return readBundledJson(require("../../assets/native-data/tafseer/51.hafizdata"));
    case 52:
      return readBundledJson(require("../../assets/native-data/tafseer/52.hafizdata"));
    case 53:
      return readBundledJson(require("../../assets/native-data/tafseer/53.hafizdata"));
    case 54:
      return readBundledJson(require("../../assets/native-data/tafseer/54.hafizdata"));
    case 55:
      return readBundledJson(require("../../assets/native-data/tafseer/55.hafizdata"));
    case 56:
      return readBundledJson(require("../../assets/native-data/tafseer/56.hafizdata"));
    case 57:
      return readBundledJson(require("../../assets/native-data/tafseer/57.hafizdata"));
    case 58:
      return readBundledJson(require("../../assets/native-data/tafseer/58.hafizdata"));
    case 59:
      return readBundledJson(require("../../assets/native-data/tafseer/59.hafizdata"));
    case 60:
      return readBundledJson(require("../../assets/native-data/tafseer/60.hafizdata"));
    case 61:
      return readBundledJson(require("../../assets/native-data/tafseer/61.hafizdata"));
    case 62:
      return readBundledJson(require("../../assets/native-data/tafseer/62.hafizdata"));
    case 63:
      return readBundledJson(require("../../assets/native-data/tafseer/63.hafizdata"));
    case 64:
      return readBundledJson(require("../../assets/native-data/tafseer/64.hafizdata"));
    case 65:
      return readBundledJson(require("../../assets/native-data/tafseer/65.hafizdata"));
    case 66:
      return readBundledJson(require("../../assets/native-data/tafseer/66.hafizdata"));
    case 67:
      return readBundledJson(require("../../assets/native-data/tafseer/67.hafizdata"));
    case 68:
      return readBundledJson(require("../../assets/native-data/tafseer/68.hafizdata"));
    case 69:
      return readBundledJson(require("../../assets/native-data/tafseer/69.hafizdata"));
    case 70:
      return readBundledJson(require("../../assets/native-data/tafseer/70.hafizdata"));
    case 71:
      return readBundledJson(require("../../assets/native-data/tafseer/71.hafizdata"));
    case 72:
      return readBundledJson(require("../../assets/native-data/tafseer/72.hafizdata"));
    case 73:
      return readBundledJson(require("../../assets/native-data/tafseer/73.hafizdata"));
    case 74:
      return readBundledJson(require("../../assets/native-data/tafseer/74.hafizdata"));
    case 75:
      return readBundledJson(require("../../assets/native-data/tafseer/75.hafizdata"));
    case 76:
      return readBundledJson(require("../../assets/native-data/tafseer/76.hafizdata"));
    case 77:
      return readBundledJson(require("../../assets/native-data/tafseer/77.hafizdata"));
    case 78:
      return readBundledJson(require("../../assets/native-data/tafseer/78.hafizdata"));
    case 79:
      return readBundledJson(require("../../assets/native-data/tafseer/79.hafizdata"));
    case 80:
      return readBundledJson(require("../../assets/native-data/tafseer/80.hafizdata"));
    case 81:
      return readBundledJson(require("../../assets/native-data/tafseer/81.hafizdata"));
    case 82:
      return readBundledJson(require("../../assets/native-data/tafseer/82.hafizdata"));
    case 83:
      return readBundledJson(require("../../assets/native-data/tafseer/83.hafizdata"));
    case 84:
      return readBundledJson(require("../../assets/native-data/tafseer/84.hafizdata"));
    case 85:
      return readBundledJson(require("../../assets/native-data/tafseer/85.hafizdata"));
    case 86:
      return readBundledJson(require("../../assets/native-data/tafseer/86.hafizdata"));
    case 87:
      return readBundledJson(require("../../assets/native-data/tafseer/87.hafizdata"));
    case 88:
      return readBundledJson(require("../../assets/native-data/tafseer/88.hafizdata"));
    case 89:
      return readBundledJson(require("../../assets/native-data/tafseer/89.hafizdata"));
    case 90:
      return readBundledJson(require("../../assets/native-data/tafseer/90.hafizdata"));
    case 91:
      return readBundledJson(require("../../assets/native-data/tafseer/91.hafizdata"));
    case 92:
      return readBundledJson(require("../../assets/native-data/tafseer/92.hafizdata"));
    case 93:
      return readBundledJson(require("../../assets/native-data/tafseer/93.hafizdata"));
    case 94:
      return readBundledJson(require("../../assets/native-data/tafseer/94.hafizdata"));
    case 95:
      return readBundledJson(require("../../assets/native-data/tafseer/95.hafizdata"));
    case 96:
      return readBundledJson(require("../../assets/native-data/tafseer/96.hafizdata"));
    case 97:
      return readBundledJson(require("../../assets/native-data/tafseer/97.hafizdata"));
    case 98:
      return readBundledJson(require("../../assets/native-data/tafseer/98.hafizdata"));
    case 99:
      return readBundledJson(require("../../assets/native-data/tafseer/99.hafizdata"));
    case 100:
      return readBundledJson(require("../../assets/native-data/tafseer/100.hafizdata"));
    case 101:
      return readBundledJson(require("../../assets/native-data/tafseer/101.hafizdata"));
    case 102:
      return readBundledJson(require("../../assets/native-data/tafseer/102.hafizdata"));
    case 103:
      return readBundledJson(require("../../assets/native-data/tafseer/103.hafizdata"));
    case 104:
      return readBundledJson(require("../../assets/native-data/tafseer/104.hafizdata"));
    case 105:
      return readBundledJson(require("../../assets/native-data/tafseer/105.hafizdata"));
    case 106:
      return readBundledJson(require("../../assets/native-data/tafseer/106.hafizdata"));
    case 107:
      return readBundledJson(require("../../assets/native-data/tafseer/107.hafizdata"));
    case 108:
      return readBundledJson(require("../../assets/native-data/tafseer/108.hafizdata"));
    case 109:
      return readBundledJson(require("../../assets/native-data/tafseer/109.hafizdata"));
    case 110:
      return readBundledJson(require("../../assets/native-data/tafseer/110.hafizdata"));
    case 111:
      return readBundledJson(require("../../assets/native-data/tafseer/111.hafizdata"));
    case 112:
      return readBundledJson(require("../../assets/native-data/tafseer/112.hafizdata"));
    case 113:
      return readBundledJson(require("../../assets/native-data/tafseer/113.hafizdata"));
    case 114:
      return readBundledJson(require("../../assets/native-data/tafseer/114.hafizdata"));
    default:
      return null;
  }
}

function tahrirTanwirRequireStatic(n: number): any {
  switch (n) {
    case 1:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/1.hafizdata"));
    case 2:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/2.hafizdata"));
    case 3:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/3.hafizdata"));
    case 4:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/4.hafizdata"));
    case 5:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/5.hafizdata"));
    case 6:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/6.hafizdata"));
    case 7:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/7.hafizdata"));
    case 8:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/8.hafizdata"));
    case 9:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/9.hafizdata"));
    case 10:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/10.hafizdata"));
    case 11:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/11.hafizdata"));
    case 12:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/12.hafizdata"));
    case 13:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/13.hafizdata"));
    case 14:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/14.hafizdata"));
    case 15:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/15.hafizdata"));
    case 16:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/16.hafizdata"));
    case 17:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/17.hafizdata"));
    case 18:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/18.hafizdata"));
    case 19:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/19.hafizdata"));
    case 20:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/20.hafizdata"));
    case 21:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/21.hafizdata"));
    case 22:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/22.hafizdata"));
    case 23:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/23.hafizdata"));
    case 24:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/24.hafizdata"));
    case 25:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/25.hafizdata"));
    case 26:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/26.hafizdata"));
    case 27:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/27.hafizdata"));
    case 28:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/28.hafizdata"));
    case 29:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/29.hafizdata"));
    case 30:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/30.hafizdata"));
    case 31:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/31.hafizdata"));
    case 32:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/32.hafizdata"));
    case 33:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/33.hafizdata"));
    case 34:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/34.hafizdata"));
    case 35:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/35.hafizdata"));
    case 36:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/36.hafizdata"));
    case 37:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/37.hafizdata"));
    case 38:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/38.hafizdata"));
    case 39:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/39.hafizdata"));
    case 40:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/40.hafizdata"));
    case 41:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/41.hafizdata"));
    case 42:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/42.hafizdata"));
    case 43:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/43.hafizdata"));
    case 44:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/44.hafizdata"));
    case 45:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/45.hafizdata"));
    case 46:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/46.hafizdata"));
    case 47:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/47.hafizdata"));
    case 48:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/48.hafizdata"));
    case 49:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/49.hafizdata"));
    case 50:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/50.hafizdata"));
    case 51:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/51.hafizdata"));
    case 52:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/52.hafizdata"));
    case 53:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/53.hafizdata"));
    case 54:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/54.hafizdata"));
    case 55:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/55.hafizdata"));
    case 56:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/56.hafizdata"));
    case 57:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/57.hafizdata"));
    case 58:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/58.hafizdata"));
    case 59:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/59.hafizdata"));
    case 60:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/60.hafizdata"));
    case 61:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/61.hafizdata"));
    case 62:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/62.hafizdata"));
    case 63:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/63.hafizdata"));
    case 64:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/64.hafizdata"));
    case 65:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/65.hafizdata"));
    case 66:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/66.hafizdata"));
    case 67:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/67.hafizdata"));
    case 68:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/68.hafizdata"));
    case 69:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/69.hafizdata"));
    case 70:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/70.hafizdata"));
    case 71:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/71.hafizdata"));
    case 72:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/72.hafizdata"));
    case 73:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/73.hafizdata"));
    case 74:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/74.hafizdata"));
    case 75:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/75.hafizdata"));
    case 76:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/76.hafizdata"));
    case 77:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/77.hafizdata"));
    case 78:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/78.hafizdata"));
    case 79:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/79.hafizdata"));
    case 80:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/80.hafizdata"));
    case 81:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/81.hafizdata"));
    case 82:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/82.hafizdata"));
    case 83:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/83.hafizdata"));
    case 84:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/84.hafizdata"));
    case 85:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/85.hafizdata"));
    case 86:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/86.hafizdata"));
    case 87:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/87.hafizdata"));
    case 88:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/88.hafizdata"));
    case 89:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/89.hafizdata"));
    case 90:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/90.hafizdata"));
    case 91:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/91.hafizdata"));
    case 92:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/92.hafizdata"));
    case 93:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/93.hafizdata"));
    case 94:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/94.hafizdata"));
    case 95:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/95.hafizdata"));
    case 96:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/96.hafizdata"));
    case 97:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/97.hafizdata"));
    case 98:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/98.hafizdata"));
    case 99:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/99.hafizdata"));
    case 100:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/100.hafizdata"));
    case 101:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/101.hafizdata"));
    case 102:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/102.hafizdata"));
    case 103:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/103.hafizdata"));
    case 104:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/104.hafizdata"));
    case 105:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/105.hafizdata"));
    case 106:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/106.hafizdata"));
    case 107:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/107.hafizdata"));
    case 108:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/108.hafizdata"));
    case 109:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/109.hafizdata"));
    case 110:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/110.hafizdata"));
    case 111:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/111.hafizdata"));
    case 112:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/112.hafizdata"));
    case 113:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/113.hafizdata"));
    case 114:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/tahrir-tanwir/114.hafizdata"));
    default:
      return null;
  }
}

function alBahrAlMadidRequireStatic(n: number): any {
  switch (n) {
    case 1:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/1.hafizdata"));
    case 2:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/2.hafizdata"));
    case 3:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/3.hafizdata"));
    case 4:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/4.hafizdata"));
    case 5:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/5.hafizdata"));
    case 6:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/6.hafizdata"));
    case 7:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/7.hafizdata"));
    case 8:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/8.hafizdata"));
    case 9:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/9.hafizdata"));
    case 10:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/10.hafizdata"));
    case 11:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/11.hafizdata"));
    case 12:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/12.hafizdata"));
    case 13:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/13.hafizdata"));
    case 14:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/14.hafizdata"));
    case 15:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/15.hafizdata"));
    case 16:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/16.hafizdata"));
    case 17:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/17.hafizdata"));
    case 18:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/18.hafizdata"));
    case 19:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/19.hafizdata"));
    case 20:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/20.hafizdata"));
    case 21:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/21.hafizdata"));
    case 22:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/22.hafizdata"));
    case 23:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/23.hafizdata"));
    case 24:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/24.hafizdata"));
    case 25:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/25.hafizdata"));
    case 26:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/26.hafizdata"));
    case 27:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/27.hafizdata"));
    case 28:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/28.hafizdata"));
    case 29:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/29.hafizdata"));
    case 30:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/30.hafizdata"));
    case 31:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/31.hafizdata"));
    case 32:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/32.hafizdata"));
    case 33:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/33.hafizdata"));
    case 34:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/34.hafizdata"));
    case 35:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/35.hafizdata"));
    case 36:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/36.hafizdata"));
    case 37:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/37.hafizdata"));
    case 38:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/38.hafizdata"));
    case 39:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/39.hafizdata"));
    case 40:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/40.hafizdata"));
    case 41:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/41.hafizdata"));
    case 42:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/42.hafizdata"));
    case 43:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/43.hafizdata"));
    case 44:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/44.hafizdata"));
    case 45:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/45.hafizdata"));
    case 46:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/46.hafizdata"));
    case 47:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/47.hafizdata"));
    case 48:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/48.hafizdata"));
    case 49:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/49.hafizdata"));
    case 50:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/50.hafizdata"));
    case 51:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/51.hafizdata"));
    case 52:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/52.hafizdata"));
    case 53:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/53.hafizdata"));
    case 54:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/54.hafizdata"));
    case 55:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/55.hafizdata"));
    case 56:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/56.hafizdata"));
    case 57:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/57.hafizdata"));
    case 58:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/58.hafizdata"));
    case 59:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/59.hafizdata"));
    case 60:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/60.hafizdata"));
    case 61:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/61.hafizdata"));
    case 62:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/62.hafizdata"));
    case 63:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/63.hafizdata"));
    case 64:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/64.hafizdata"));
    case 65:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/65.hafizdata"));
    case 66:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/66.hafizdata"));
    case 67:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/67.hafizdata"));
    case 68:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/68.hafizdata"));
    case 69:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/69.hafizdata"));
    case 70:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/70.hafizdata"));
    case 71:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/71.hafizdata"));
    case 72:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/72.hafizdata"));
    case 73:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/73.hafizdata"));
    case 74:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/74.hafizdata"));
    case 75:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/75.hafizdata"));
    case 76:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/76.hafizdata"));
    case 77:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/77.hafizdata"));
    case 78:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/78.hafizdata"));
    case 79:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/79.hafizdata"));
    case 80:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/80.hafizdata"));
    case 81:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/81.hafizdata"));
    case 82:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/82.hafizdata"));
    case 83:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/83.hafizdata"));
    case 84:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/84.hafizdata"));
    case 85:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/85.hafizdata"));
    case 86:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/86.hafizdata"));
    case 87:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/87.hafizdata"));
    case 88:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/88.hafizdata"));
    case 89:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/89.hafizdata"));
    case 90:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/90.hafizdata"));
    case 91:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/91.hafizdata"));
    case 92:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/92.hafizdata"));
    case 93:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/93.hafizdata"));
    case 94:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/94.hafizdata"));
    case 95:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/95.hafizdata"));
    case 96:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/96.hafizdata"));
    case 97:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/97.hafizdata"));
    case 98:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/98.hafizdata"));
    case 99:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/99.hafizdata"));
    case 100:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/100.hafizdata"));
    case 101:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/101.hafizdata"));
    case 102:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/102.hafizdata"));
    case 103:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/103.hafizdata"));
    case 104:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/104.hafizdata"));
    case 105:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/105.hafizdata"));
    case 106:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/106.hafizdata"));
    case 107:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/107.hafizdata"));
    case 108:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/108.hafizdata"));
    case 109:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/109.hafizdata"));
    case 110:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/110.hafizdata"));
    case 111:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/111.hafizdata"));
    case 112:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/112.hafizdata"));
    case 113:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/113.hafizdata"));
    case 114:
      return readBundledJson(require("../../assets/native-data/tafsir-sources/al-bahr-al-madid/114.hafizdata"));
    default:
      return null;
  }
}

export function nativeTafsirSourceLoader(source: TafsirSourceId, surahNumber: number): (() => any) | null {
  if (source === "tahrir-tanwir") return nativeTahrirTanwirRequires[surahNumber] ?? null;
  if (source === "qurtubi") return nativeQurtubiRequires[surahNumber] ?? null;
  if (source === "kashshaf") return nativeKashshafRequires[surahNumber] ?? null;
  if (source === "alusi") return nativeAlusiRequires[surahNumber] ?? null;
  if (source === "nazam-durar") return nativeNazamDurarRequires[surahNumber] ?? null;
  if (source === "razi") return nativeRaziRequires[surahNumber] ?? null;
  if (source === "al-bahr-al-madid") return nativeAlBahrAlMadidRequires[surahNumber] ?? null;
  if (source === "jalalayn") return nativeJalalaynRequires[surahNumber] ?? null;
  if (source === "jalalayn-en") return nativeJalalaynEnRequires[surahNumber] ?? null;
  return null;
}
