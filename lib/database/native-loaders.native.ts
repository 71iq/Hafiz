import { Platform } from "react-native";
import type { TafsirSourceId } from "@/lib/tafsir/sources";

// ─── Platform-aware data loading ─────────────────────────────
// On web: fetch from /data/ (static files served from public/)
// On native: use require() (Metro handles large assets fine)

// Native-only require map — these are stripped from the web bundle
// because the loadData() web path uses fetch() instead.
export const nativeRequires: Record<string, () => any> =
  Platform.OS !== "web"
    ? {
        "quran-data.json": () => require("../../assets/data/quran-data.json"),
        "quran-qcf2.json": () => require("../../assets/data/quran-qcf2.json"),
        "surah-info.json": () => require("../../assets/data/surah-info.json"),
        "reflection-journey.json": () => require("../../assets/data/reflection-journey.json"),
        "translation-sahih.json": () => require("../../assets/data/translation-sahih.json"),
        "page-map.json": () => require("../../assets/data/page-map.json"),
        "tajweed.json": () => require("../../assets/data/tajweed.json"),
        "wbw/wbw.json": () => require("../../assets/data/wbw/wbw.json"),
        "masaq/masaq-aggregated.json": () => require("../../assets/data/masaq/masaq-aggregated.json"),
        "layout/page-lines.json": () => require("../../assets/data/layout/page-lines.json"),
        "zilal.json": () => require("../../assets/data/zilal.json"),
        "wbw-arabic-meanings.json": () => require("../../assets/data/wbw-arabic-meanings.json"),
        "irab-per-word.json": () => require("../../assets/data/irab-per-word.json"),
        "tajweed-rules-ar.json": () => require("../../assets/data/tajweed-rules-ar.json"),
        "tajweed-rules-en.json": () => require("../../assets/data/tajweed-rules-en.json"),
        "al-qira-at-al-mawsoo-ah-al-qur-aniyyah.json": () =>
          require("../../assets/data/al-qira-at-al-mawsoo-ah-al-qur-aniyyah.json"),
        "asbab-al-nuzul.json": () => require("../../assets/data/asbab-al-nuzul.json"),
        "mutashabihat/nourquran_hafiz.json": () => require("../../assets/data/mutashabihat/nourquran_hafiz.json"),
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
        1: () => require("../../assets/data/tafsir-sources/qurtubi/1.json"),
        2: () => require("../../assets/data/tafsir-sources/qurtubi/2.json"),
        3: () => require("../../assets/data/tafsir-sources/qurtubi/3.json"),
        4: () => require("../../assets/data/tafsir-sources/qurtubi/4.json"),
        5: () => require("../../assets/data/tafsir-sources/qurtubi/5.json"),
        6: () => require("../../assets/data/tafsir-sources/qurtubi/6.json"),
        7: () => require("../../assets/data/tafsir-sources/qurtubi/7.json"),
        8: () => require("../../assets/data/tafsir-sources/qurtubi/8.json"),
        9: () => require("../../assets/data/tafsir-sources/qurtubi/9.json"),
        10: () => require("../../assets/data/tafsir-sources/qurtubi/10.json"),
        11: () => require("../../assets/data/tafsir-sources/qurtubi/11.json"),
        12: () => require("../../assets/data/tafsir-sources/qurtubi/12.json"),
        13: () => require("../../assets/data/tafsir-sources/qurtubi/13.json"),
        14: () => require("../../assets/data/tafsir-sources/qurtubi/14.json"),
        15: () => require("../../assets/data/tafsir-sources/qurtubi/15.json"),
        16: () => require("../../assets/data/tafsir-sources/qurtubi/16.json"),
        17: () => require("../../assets/data/tafsir-sources/qurtubi/17.json"),
        18: () => require("../../assets/data/tafsir-sources/qurtubi/18.json"),
        19: () => require("../../assets/data/tafsir-sources/qurtubi/19.json"),
        20: () => require("../../assets/data/tafsir-sources/qurtubi/20.json"),
        21: () => require("../../assets/data/tafsir-sources/qurtubi/21.json"),
        22: () => require("../../assets/data/tafsir-sources/qurtubi/22.json"),
        23: () => require("../../assets/data/tafsir-sources/qurtubi/23.json"),
        24: () => require("../../assets/data/tafsir-sources/qurtubi/24.json"),
        25: () => require("../../assets/data/tafsir-sources/qurtubi/25.json"),
        26: () => require("../../assets/data/tafsir-sources/qurtubi/26.json"),
        27: () => require("../../assets/data/tafsir-sources/qurtubi/27.json"),
        28: () => require("../../assets/data/tafsir-sources/qurtubi/28.json"),
        29: () => require("../../assets/data/tafsir-sources/qurtubi/29.json"),
        30: () => require("../../assets/data/tafsir-sources/qurtubi/30.json"),
        31: () => require("../../assets/data/tafsir-sources/qurtubi/31.json"),
        32: () => require("../../assets/data/tafsir-sources/qurtubi/32.json"),
        33: () => require("../../assets/data/tafsir-sources/qurtubi/33.json"),
        34: () => require("../../assets/data/tafsir-sources/qurtubi/34.json"),
        35: () => require("../../assets/data/tafsir-sources/qurtubi/35.json"),
        36: () => require("../../assets/data/tafsir-sources/qurtubi/36.json"),
        37: () => require("../../assets/data/tafsir-sources/qurtubi/37.json"),
        38: () => require("../../assets/data/tafsir-sources/qurtubi/38.json"),
        39: () => require("../../assets/data/tafsir-sources/qurtubi/39.json"),
        40: () => require("../../assets/data/tafsir-sources/qurtubi/40.json"),
        41: () => require("../../assets/data/tafsir-sources/qurtubi/41.json"),
        42: () => require("../../assets/data/tafsir-sources/qurtubi/42.json"),
        43: () => require("../../assets/data/tafsir-sources/qurtubi/43.json"),
        44: () => require("../../assets/data/tafsir-sources/qurtubi/44.json"),
        45: () => require("../../assets/data/tafsir-sources/qurtubi/45.json"),
        46: () => require("../../assets/data/tafsir-sources/qurtubi/46.json"),
        47: () => require("../../assets/data/tafsir-sources/qurtubi/47.json"),
        48: () => require("../../assets/data/tafsir-sources/qurtubi/48.json"),
        49: () => require("../../assets/data/tafsir-sources/qurtubi/49.json"),
        50: () => require("../../assets/data/tafsir-sources/qurtubi/50.json"),
        51: () => require("../../assets/data/tafsir-sources/qurtubi/51.json"),
        52: () => require("../../assets/data/tafsir-sources/qurtubi/52.json"),
        53: () => require("../../assets/data/tafsir-sources/qurtubi/53.json"),
        54: () => require("../../assets/data/tafsir-sources/qurtubi/54.json"),
        55: () => require("../../assets/data/tafsir-sources/qurtubi/55.json"),
        56: () => require("../../assets/data/tafsir-sources/qurtubi/56.json"),
        57: () => require("../../assets/data/tafsir-sources/qurtubi/57.json"),
        58: () => require("../../assets/data/tafsir-sources/qurtubi/58.json"),
        59: () => require("../../assets/data/tafsir-sources/qurtubi/59.json"),
        60: () => require("../../assets/data/tafsir-sources/qurtubi/60.json"),
        61: () => require("../../assets/data/tafsir-sources/qurtubi/61.json"),
        62: () => require("../../assets/data/tafsir-sources/qurtubi/62.json"),
        63: () => require("../../assets/data/tafsir-sources/qurtubi/63.json"),
        64: () => require("../../assets/data/tafsir-sources/qurtubi/64.json"),
        65: () => require("../../assets/data/tafsir-sources/qurtubi/65.json"),
        66: () => require("../../assets/data/tafsir-sources/qurtubi/66.json"),
        67: () => require("../../assets/data/tafsir-sources/qurtubi/67.json"),
        68: () => require("../../assets/data/tafsir-sources/qurtubi/68.json"),
        69: () => require("../../assets/data/tafsir-sources/qurtubi/69.json"),
        70: () => require("../../assets/data/tafsir-sources/qurtubi/70.json"),
        71: () => require("../../assets/data/tafsir-sources/qurtubi/71.json"),
        72: () => require("../../assets/data/tafsir-sources/qurtubi/72.json"),
        73: () => require("../../assets/data/tafsir-sources/qurtubi/73.json"),
        74: () => require("../../assets/data/tafsir-sources/qurtubi/74.json"),
        75: () => require("../../assets/data/tafsir-sources/qurtubi/75.json"),
        76: () => require("../../assets/data/tafsir-sources/qurtubi/76.json"),
        77: () => require("../../assets/data/tafsir-sources/qurtubi/77.json"),
        78: () => require("../../assets/data/tafsir-sources/qurtubi/78.json"),
        79: () => require("../../assets/data/tafsir-sources/qurtubi/79.json"),
        80: () => require("../../assets/data/tafsir-sources/qurtubi/80.json"),
        81: () => require("../../assets/data/tafsir-sources/qurtubi/81.json"),
        82: () => require("../../assets/data/tafsir-sources/qurtubi/82.json"),
        83: () => require("../../assets/data/tafsir-sources/qurtubi/83.json"),
        84: () => require("../../assets/data/tafsir-sources/qurtubi/84.json"),
        85: () => require("../../assets/data/tafsir-sources/qurtubi/85.json"),
        86: () => require("../../assets/data/tafsir-sources/qurtubi/86.json"),
        87: () => require("../../assets/data/tafsir-sources/qurtubi/87.json"),
        88: () => require("../../assets/data/tafsir-sources/qurtubi/88.json"),
        89: () => require("../../assets/data/tafsir-sources/qurtubi/89.json"),
        90: () => require("../../assets/data/tafsir-sources/qurtubi/90.json"),
        91: () => require("../../assets/data/tafsir-sources/qurtubi/91.json"),
        92: () => require("../../assets/data/tafsir-sources/qurtubi/92.json"),
        93: () => require("../../assets/data/tafsir-sources/qurtubi/93.json"),
        94: () => require("../../assets/data/tafsir-sources/qurtubi/94.json"),
        95: () => require("../../assets/data/tafsir-sources/qurtubi/95.json"),
        96: () => require("../../assets/data/tafsir-sources/qurtubi/96.json"),
        97: () => require("../../assets/data/tafsir-sources/qurtubi/97.json"),
        98: () => require("../../assets/data/tafsir-sources/qurtubi/98.json"),
        99: () => require("../../assets/data/tafsir-sources/qurtubi/99.json"),
        100: () => require("../../assets/data/tafsir-sources/qurtubi/100.json"),
        101: () => require("../../assets/data/tafsir-sources/qurtubi/101.json"),
        102: () => require("../../assets/data/tafsir-sources/qurtubi/102.json"),
        103: () => require("../../assets/data/tafsir-sources/qurtubi/103.json"),
        104: () => require("../../assets/data/tafsir-sources/qurtubi/104.json"),
        105: () => require("../../assets/data/tafsir-sources/qurtubi/105.json"),
        106: () => require("../../assets/data/tafsir-sources/qurtubi/106.json"),
        107: () => require("../../assets/data/tafsir-sources/qurtubi/107.json"),
        108: () => require("../../assets/data/tafsir-sources/qurtubi/108.json"),
        109: () => require("../../assets/data/tafsir-sources/qurtubi/109.json"),
        110: () => require("../../assets/data/tafsir-sources/qurtubi/110.json"),
        111: () => require("../../assets/data/tafsir-sources/qurtubi/111.json"),
        112: () => require("../../assets/data/tafsir-sources/qurtubi/112.json"),
        113: () => require("../../assets/data/tafsir-sources/qurtubi/113.json"),
        114: () => require("../../assets/data/tafsir-sources/qurtubi/114.json"),
      }
    : {};

export const nativeKashshafRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? {
        1: () => require("../../assets/data/tafsir-sources/kashshaf/1.json"),
        2: () => require("../../assets/data/tafsir-sources/kashshaf/2.json"),
        3: () => require("../../assets/data/tafsir-sources/kashshaf/3.json"),
        4: () => require("../../assets/data/tafsir-sources/kashshaf/4.json"),
        5: () => require("../../assets/data/tafsir-sources/kashshaf/5.json"),
        6: () => require("../../assets/data/tafsir-sources/kashshaf/6.json"),
        7: () => require("../../assets/data/tafsir-sources/kashshaf/7.json"),
        8: () => require("../../assets/data/tafsir-sources/kashshaf/8.json"),
        9: () => require("../../assets/data/tafsir-sources/kashshaf/9.json"),
        10: () => require("../../assets/data/tafsir-sources/kashshaf/10.json"),
        11: () => require("../../assets/data/tafsir-sources/kashshaf/11.json"),
        12: () => require("../../assets/data/tafsir-sources/kashshaf/12.json"),
        13: () => require("../../assets/data/tafsir-sources/kashshaf/13.json"),
        14: () => require("../../assets/data/tafsir-sources/kashshaf/14.json"),
        15: () => require("../../assets/data/tafsir-sources/kashshaf/15.json"),
        16: () => require("../../assets/data/tafsir-sources/kashshaf/16.json"),
        17: () => require("../../assets/data/tafsir-sources/kashshaf/17.json"),
        18: () => require("../../assets/data/tafsir-sources/kashshaf/18.json"),
        19: () => require("../../assets/data/tafsir-sources/kashshaf/19.json"),
        20: () => require("../../assets/data/tafsir-sources/kashshaf/20.json"),
        21: () => require("../../assets/data/tafsir-sources/kashshaf/21.json"),
        22: () => require("../../assets/data/tafsir-sources/kashshaf/22.json"),
        23: () => require("../../assets/data/tafsir-sources/kashshaf/23.json"),
        24: () => require("../../assets/data/tafsir-sources/kashshaf/24.json"),
        25: () => require("../../assets/data/tafsir-sources/kashshaf/25.json"),
        26: () => require("../../assets/data/tafsir-sources/kashshaf/26.json"),
        27: () => require("../../assets/data/tafsir-sources/kashshaf/27.json"),
        28: () => require("../../assets/data/tafsir-sources/kashshaf/28.json"),
        29: () => require("../../assets/data/tafsir-sources/kashshaf/29.json"),
        30: () => require("../../assets/data/tafsir-sources/kashshaf/30.json"),
        31: () => require("../../assets/data/tafsir-sources/kashshaf/31.json"),
        32: () => require("../../assets/data/tafsir-sources/kashshaf/32.json"),
        33: () => require("../../assets/data/tafsir-sources/kashshaf/33.json"),
        34: () => require("../../assets/data/tafsir-sources/kashshaf/34.json"),
        35: () => require("../../assets/data/tafsir-sources/kashshaf/35.json"),
        36: () => require("../../assets/data/tafsir-sources/kashshaf/36.json"),
        37: () => require("../../assets/data/tafsir-sources/kashshaf/37.json"),
        38: () => require("../../assets/data/tafsir-sources/kashshaf/38.json"),
        39: () => require("../../assets/data/tafsir-sources/kashshaf/39.json"),
        40: () => require("../../assets/data/tafsir-sources/kashshaf/40.json"),
        41: () => require("../../assets/data/tafsir-sources/kashshaf/41.json"),
        42: () => require("../../assets/data/tafsir-sources/kashshaf/42.json"),
        43: () => require("../../assets/data/tafsir-sources/kashshaf/43.json"),
        44: () => require("../../assets/data/tafsir-sources/kashshaf/44.json"),
        45: () => require("../../assets/data/tafsir-sources/kashshaf/45.json"),
        46: () => require("../../assets/data/tafsir-sources/kashshaf/46.json"),
        47: () => require("../../assets/data/tafsir-sources/kashshaf/47.json"),
        48: () => require("../../assets/data/tafsir-sources/kashshaf/48.json"),
        49: () => require("../../assets/data/tafsir-sources/kashshaf/49.json"),
        50: () => require("../../assets/data/tafsir-sources/kashshaf/50.json"),
        51: () => require("../../assets/data/tafsir-sources/kashshaf/51.json"),
        52: () => require("../../assets/data/tafsir-sources/kashshaf/52.json"),
        53: () => require("../../assets/data/tafsir-sources/kashshaf/53.json"),
        54: () => require("../../assets/data/tafsir-sources/kashshaf/54.json"),
        55: () => require("../../assets/data/tafsir-sources/kashshaf/55.json"),
        56: () => require("../../assets/data/tafsir-sources/kashshaf/56.json"),
        57: () => require("../../assets/data/tafsir-sources/kashshaf/57.json"),
        58: () => require("../../assets/data/tafsir-sources/kashshaf/58.json"),
        59: () => require("../../assets/data/tafsir-sources/kashshaf/59.json"),
        60: () => require("../../assets/data/tafsir-sources/kashshaf/60.json"),
        61: () => require("../../assets/data/tafsir-sources/kashshaf/61.json"),
        62: () => require("../../assets/data/tafsir-sources/kashshaf/62.json"),
        63: () => require("../../assets/data/tafsir-sources/kashshaf/63.json"),
        64: () => require("../../assets/data/tafsir-sources/kashshaf/64.json"),
        65: () => require("../../assets/data/tafsir-sources/kashshaf/65.json"),
        66: () => require("../../assets/data/tafsir-sources/kashshaf/66.json"),
        67: () => require("../../assets/data/tafsir-sources/kashshaf/67.json"),
        68: () => require("../../assets/data/tafsir-sources/kashshaf/68.json"),
        69: () => require("../../assets/data/tafsir-sources/kashshaf/69.json"),
        70: () => require("../../assets/data/tafsir-sources/kashshaf/70.json"),
        71: () => require("../../assets/data/tafsir-sources/kashshaf/71.json"),
        72: () => require("../../assets/data/tafsir-sources/kashshaf/72.json"),
        73: () => require("../../assets/data/tafsir-sources/kashshaf/73.json"),
        74: () => require("../../assets/data/tafsir-sources/kashshaf/74.json"),
        75: () => require("../../assets/data/tafsir-sources/kashshaf/75.json"),
        76: () => require("../../assets/data/tafsir-sources/kashshaf/76.json"),
        77: () => require("../../assets/data/tafsir-sources/kashshaf/77.json"),
        78: () => require("../../assets/data/tafsir-sources/kashshaf/78.json"),
        79: () => require("../../assets/data/tafsir-sources/kashshaf/79.json"),
        80: () => require("../../assets/data/tafsir-sources/kashshaf/80.json"),
        81: () => require("../../assets/data/tafsir-sources/kashshaf/81.json"),
        82: () => require("../../assets/data/tafsir-sources/kashshaf/82.json"),
        83: () => require("../../assets/data/tafsir-sources/kashshaf/83.json"),
        84: () => require("../../assets/data/tafsir-sources/kashshaf/84.json"),
        85: () => require("../../assets/data/tafsir-sources/kashshaf/85.json"),
        86: () => require("../../assets/data/tafsir-sources/kashshaf/86.json"),
        87: () => require("../../assets/data/tafsir-sources/kashshaf/87.json"),
        88: () => require("../../assets/data/tafsir-sources/kashshaf/88.json"),
        89: () => require("../../assets/data/tafsir-sources/kashshaf/89.json"),
        90: () => require("../../assets/data/tafsir-sources/kashshaf/90.json"),
        91: () => require("../../assets/data/tafsir-sources/kashshaf/91.json"),
        92: () => require("../../assets/data/tafsir-sources/kashshaf/92.json"),
        93: () => require("../../assets/data/tafsir-sources/kashshaf/93.json"),
        94: () => require("../../assets/data/tafsir-sources/kashshaf/94.json"),
        95: () => require("../../assets/data/tafsir-sources/kashshaf/95.json"),
        96: () => require("../../assets/data/tafsir-sources/kashshaf/96.json"),
        97: () => require("../../assets/data/tafsir-sources/kashshaf/97.json"),
        98: () => require("../../assets/data/tafsir-sources/kashshaf/98.json"),
        99: () => require("../../assets/data/tafsir-sources/kashshaf/99.json"),
        100: () => require("../../assets/data/tafsir-sources/kashshaf/100.json"),
        101: () => require("../../assets/data/tafsir-sources/kashshaf/101.json"),
        102: () => require("../../assets/data/tafsir-sources/kashshaf/102.json"),
        103: () => require("../../assets/data/tafsir-sources/kashshaf/103.json"),
        104: () => require("../../assets/data/tafsir-sources/kashshaf/104.json"),
        105: () => require("../../assets/data/tafsir-sources/kashshaf/105.json"),
        106: () => require("../../assets/data/tafsir-sources/kashshaf/106.json"),
        107: () => require("../../assets/data/tafsir-sources/kashshaf/107.json"),
        108: () => require("../../assets/data/tafsir-sources/kashshaf/108.json"),
        109: () => require("../../assets/data/tafsir-sources/kashshaf/109.json"),
        110: () => require("../../assets/data/tafsir-sources/kashshaf/110.json"),
        111: () => require("../../assets/data/tafsir-sources/kashshaf/111.json"),
        112: () => require("../../assets/data/tafsir-sources/kashshaf/112.json"),
        113: () => require("../../assets/data/tafsir-sources/kashshaf/113.json"),
        114: () => require("../../assets/data/tafsir-sources/kashshaf/114.json"),
      }
    : {};

export const nativeAlusiRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? {
        1: () => require("../../assets/data/tafsir-sources/alusi/1.json"),
        2: () => require("../../assets/data/tafsir-sources/alusi/2.json"),
        3: () => require("../../assets/data/tafsir-sources/alusi/3.json"),
        4: () => require("../../assets/data/tafsir-sources/alusi/4.json"),
        5: () => require("../../assets/data/tafsir-sources/alusi/5.json"),
        6: () => require("../../assets/data/tafsir-sources/alusi/6.json"),
        7: () => require("../../assets/data/tafsir-sources/alusi/7.json"),
        8: () => require("../../assets/data/tafsir-sources/alusi/8.json"),
        9: () => require("../../assets/data/tafsir-sources/alusi/9.json"),
        10: () => require("../../assets/data/tafsir-sources/alusi/10.json"),
        11: () => require("../../assets/data/tafsir-sources/alusi/11.json"),
        12: () => require("../../assets/data/tafsir-sources/alusi/12.json"),
        13: () => require("../../assets/data/tafsir-sources/alusi/13.json"),
        14: () => require("../../assets/data/tafsir-sources/alusi/14.json"),
        15: () => require("../../assets/data/tafsir-sources/alusi/15.json"),
        16: () => require("../../assets/data/tafsir-sources/alusi/16.json"),
        17: () => require("../../assets/data/tafsir-sources/alusi/17.json"),
        18: () => require("../../assets/data/tafsir-sources/alusi/18.json"),
        19: () => require("../../assets/data/tafsir-sources/alusi/19.json"),
        20: () => require("../../assets/data/tafsir-sources/alusi/20.json"),
        21: () => require("../../assets/data/tafsir-sources/alusi/21.json"),
        22: () => require("../../assets/data/tafsir-sources/alusi/22.json"),
        23: () => require("../../assets/data/tafsir-sources/alusi/23.json"),
        24: () => require("../../assets/data/tafsir-sources/alusi/24.json"),
        25: () => require("../../assets/data/tafsir-sources/alusi/25.json"),
        26: () => require("../../assets/data/tafsir-sources/alusi/26.json"),
        27: () => require("../../assets/data/tafsir-sources/alusi/27.json"),
        28: () => require("../../assets/data/tafsir-sources/alusi/28.json"),
        29: () => require("../../assets/data/tafsir-sources/alusi/29.json"),
        30: () => require("../../assets/data/tafsir-sources/alusi/30.json"),
        31: () => require("../../assets/data/tafsir-sources/alusi/31.json"),
        32: () => require("../../assets/data/tafsir-sources/alusi/32.json"),
        33: () => require("../../assets/data/tafsir-sources/alusi/33.json"),
        34: () => require("../../assets/data/tafsir-sources/alusi/34.json"),
        35: () => require("../../assets/data/tafsir-sources/alusi/35.json"),
        36: () => require("../../assets/data/tafsir-sources/alusi/36.json"),
        37: () => require("../../assets/data/tafsir-sources/alusi/37.json"),
        38: () => require("../../assets/data/tafsir-sources/alusi/38.json"),
        39: () => require("../../assets/data/tafsir-sources/alusi/39.json"),
        40: () => require("../../assets/data/tafsir-sources/alusi/40.json"),
        41: () => require("../../assets/data/tafsir-sources/alusi/41.json"),
        42: () => require("../../assets/data/tafsir-sources/alusi/42.json"),
        43: () => require("../../assets/data/tafsir-sources/alusi/43.json"),
        44: () => require("../../assets/data/tafsir-sources/alusi/44.json"),
        45: () => require("../../assets/data/tafsir-sources/alusi/45.json"),
        46: () => require("../../assets/data/tafsir-sources/alusi/46.json"),
        47: () => require("../../assets/data/tafsir-sources/alusi/47.json"),
        48: () => require("../../assets/data/tafsir-sources/alusi/48.json"),
        49: () => require("../../assets/data/tafsir-sources/alusi/49.json"),
        50: () => require("../../assets/data/tafsir-sources/alusi/50.json"),
        51: () => require("../../assets/data/tafsir-sources/alusi/51.json"),
        52: () => require("../../assets/data/tafsir-sources/alusi/52.json"),
        53: () => require("../../assets/data/tafsir-sources/alusi/53.json"),
        54: () => require("../../assets/data/tafsir-sources/alusi/54.json"),
        55: () => require("../../assets/data/tafsir-sources/alusi/55.json"),
        56: () => require("../../assets/data/tafsir-sources/alusi/56.json"),
        57: () => require("../../assets/data/tafsir-sources/alusi/57.json"),
        58: () => require("../../assets/data/tafsir-sources/alusi/58.json"),
        59: () => require("../../assets/data/tafsir-sources/alusi/59.json"),
        60: () => require("../../assets/data/tafsir-sources/alusi/60.json"),
        61: () => require("../../assets/data/tafsir-sources/alusi/61.json"),
        62: () => require("../../assets/data/tafsir-sources/alusi/62.json"),
        63: () => require("../../assets/data/tafsir-sources/alusi/63.json"),
        64: () => require("../../assets/data/tafsir-sources/alusi/64.json"),
        65: () => require("../../assets/data/tafsir-sources/alusi/65.json"),
        66: () => require("../../assets/data/tafsir-sources/alusi/66.json"),
        67: () => require("../../assets/data/tafsir-sources/alusi/67.json"),
        68: () => require("../../assets/data/tafsir-sources/alusi/68.json"),
        69: () => require("../../assets/data/tafsir-sources/alusi/69.json"),
        70: () => require("../../assets/data/tafsir-sources/alusi/70.json"),
        71: () => require("../../assets/data/tafsir-sources/alusi/71.json"),
        72: () => require("../../assets/data/tafsir-sources/alusi/72.json"),
        73: () => require("../../assets/data/tafsir-sources/alusi/73.json"),
        74: () => require("../../assets/data/tafsir-sources/alusi/74.json"),
        75: () => require("../../assets/data/tafsir-sources/alusi/75.json"),
        76: () => require("../../assets/data/tafsir-sources/alusi/76.json"),
        77: () => require("../../assets/data/tafsir-sources/alusi/77.json"),
        78: () => require("../../assets/data/tafsir-sources/alusi/78.json"),
        79: () => require("../../assets/data/tafsir-sources/alusi/79.json"),
        80: () => require("../../assets/data/tafsir-sources/alusi/80.json"),
        81: () => require("../../assets/data/tafsir-sources/alusi/81.json"),
        82: () => require("../../assets/data/tafsir-sources/alusi/82.json"),
        83: () => require("../../assets/data/tafsir-sources/alusi/83.json"),
        84: () => require("../../assets/data/tafsir-sources/alusi/84.json"),
        85: () => require("../../assets/data/tafsir-sources/alusi/85.json"),
        86: () => require("../../assets/data/tafsir-sources/alusi/86.json"),
        87: () => require("../../assets/data/tafsir-sources/alusi/87.json"),
        88: () => require("../../assets/data/tafsir-sources/alusi/88.json"),
        89: () => require("../../assets/data/tafsir-sources/alusi/89.json"),
        90: () => require("../../assets/data/tafsir-sources/alusi/90.json"),
        91: () => require("../../assets/data/tafsir-sources/alusi/91.json"),
        92: () => require("../../assets/data/tafsir-sources/alusi/92.json"),
        93: () => require("../../assets/data/tafsir-sources/alusi/93.json"),
        94: () => require("../../assets/data/tafsir-sources/alusi/94.json"),
        95: () => require("../../assets/data/tafsir-sources/alusi/95.json"),
        96: () => require("../../assets/data/tafsir-sources/alusi/96.json"),
        97: () => require("../../assets/data/tafsir-sources/alusi/97.json"),
        98: () => require("../../assets/data/tafsir-sources/alusi/98.json"),
        99: () => require("../../assets/data/tafsir-sources/alusi/99.json"),
        100: () => require("../../assets/data/tafsir-sources/alusi/100.json"),
        101: () => require("../../assets/data/tafsir-sources/alusi/101.json"),
        102: () => require("../../assets/data/tafsir-sources/alusi/102.json"),
        103: () => require("../../assets/data/tafsir-sources/alusi/103.json"),
        104: () => require("../../assets/data/tafsir-sources/alusi/104.json"),
        105: () => require("../../assets/data/tafsir-sources/alusi/105.json"),
        106: () => require("../../assets/data/tafsir-sources/alusi/106.json"),
        107: () => require("../../assets/data/tafsir-sources/alusi/107.json"),
        108: () => require("../../assets/data/tafsir-sources/alusi/108.json"),
        109: () => require("../../assets/data/tafsir-sources/alusi/109.json"),
        110: () => require("../../assets/data/tafsir-sources/alusi/110.json"),
        111: () => require("../../assets/data/tafsir-sources/alusi/111.json"),
        112: () => require("../../assets/data/tafsir-sources/alusi/112.json"),
        113: () => require("../../assets/data/tafsir-sources/alusi/113.json"),
        114: () => require("../../assets/data/tafsir-sources/alusi/114.json"),
      }
    : {};

export const nativeNazamDurarRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? {
        1: () => require("../../assets/data/tafsir-sources/nazam-durar/1.json"),
        2: () => require("../../assets/data/tafsir-sources/nazam-durar/2.json"),
        3: () => require("../../assets/data/tafsir-sources/nazam-durar/3.json"),
        4: () => require("../../assets/data/tafsir-sources/nazam-durar/4.json"),
        5: () => require("../../assets/data/tafsir-sources/nazam-durar/5.json"),
        6: () => require("../../assets/data/tafsir-sources/nazam-durar/6.json"),
        7: () => require("../../assets/data/tafsir-sources/nazam-durar/7.json"),
        8: () => require("../../assets/data/tafsir-sources/nazam-durar/8.json"),
        9: () => require("../../assets/data/tafsir-sources/nazam-durar/9.json"),
        10: () => require("../../assets/data/tafsir-sources/nazam-durar/10.json"),
        11: () => require("../../assets/data/tafsir-sources/nazam-durar/11.json"),
        12: () => require("../../assets/data/tafsir-sources/nazam-durar/12.json"),
        13: () => require("../../assets/data/tafsir-sources/nazam-durar/13.json"),
        14: () => require("../../assets/data/tafsir-sources/nazam-durar/14.json"),
        15: () => require("../../assets/data/tafsir-sources/nazam-durar/15.json"),
        16: () => require("../../assets/data/tafsir-sources/nazam-durar/16.json"),
        17: () => require("../../assets/data/tafsir-sources/nazam-durar/17.json"),
        18: () => require("../../assets/data/tafsir-sources/nazam-durar/18.json"),
        19: () => require("../../assets/data/tafsir-sources/nazam-durar/19.json"),
        20: () => require("../../assets/data/tafsir-sources/nazam-durar/20.json"),
        21: () => require("../../assets/data/tafsir-sources/nazam-durar/21.json"),
        22: () => require("../../assets/data/tafsir-sources/nazam-durar/22.json"),
        23: () => require("../../assets/data/tafsir-sources/nazam-durar/23.json"),
        24: () => require("../../assets/data/tafsir-sources/nazam-durar/24.json"),
        25: () => require("../../assets/data/tafsir-sources/nazam-durar/25.json"),
        26: () => require("../../assets/data/tafsir-sources/nazam-durar/26.json"),
        27: () => require("../../assets/data/tafsir-sources/nazam-durar/27.json"),
        28: () => require("../../assets/data/tafsir-sources/nazam-durar/28.json"),
        29: () => require("../../assets/data/tafsir-sources/nazam-durar/29.json"),
        30: () => require("../../assets/data/tafsir-sources/nazam-durar/30.json"),
        31: () => require("../../assets/data/tafsir-sources/nazam-durar/31.json"),
        32: () => require("../../assets/data/tafsir-sources/nazam-durar/32.json"),
        33: () => require("../../assets/data/tafsir-sources/nazam-durar/33.json"),
        34: () => require("../../assets/data/tafsir-sources/nazam-durar/34.json"),
        35: () => require("../../assets/data/tafsir-sources/nazam-durar/35.json"),
        36: () => require("../../assets/data/tafsir-sources/nazam-durar/36.json"),
        37: () => require("../../assets/data/tafsir-sources/nazam-durar/37.json"),
        38: () => require("../../assets/data/tafsir-sources/nazam-durar/38.json"),
        39: () => require("../../assets/data/tafsir-sources/nazam-durar/39.json"),
        40: () => require("../../assets/data/tafsir-sources/nazam-durar/40.json"),
        41: () => require("../../assets/data/tafsir-sources/nazam-durar/41.json"),
        42: () => require("../../assets/data/tafsir-sources/nazam-durar/42.json"),
        43: () => require("../../assets/data/tafsir-sources/nazam-durar/43.json"),
        44: () => require("../../assets/data/tafsir-sources/nazam-durar/44.json"),
        45: () => require("../../assets/data/tafsir-sources/nazam-durar/45.json"),
        46: () => require("../../assets/data/tafsir-sources/nazam-durar/46.json"),
        47: () => require("../../assets/data/tafsir-sources/nazam-durar/47.json"),
        48: () => require("../../assets/data/tafsir-sources/nazam-durar/48.json"),
        49: () => require("../../assets/data/tafsir-sources/nazam-durar/49.json"),
        50: () => require("../../assets/data/tafsir-sources/nazam-durar/50.json"),
        51: () => require("../../assets/data/tafsir-sources/nazam-durar/51.json"),
        52: () => require("../../assets/data/tafsir-sources/nazam-durar/52.json"),
        53: () => require("../../assets/data/tafsir-sources/nazam-durar/53.json"),
        54: () => require("../../assets/data/tafsir-sources/nazam-durar/54.json"),
        55: () => require("../../assets/data/tafsir-sources/nazam-durar/55.json"),
        56: () => require("../../assets/data/tafsir-sources/nazam-durar/56.json"),
        57: () => require("../../assets/data/tafsir-sources/nazam-durar/57.json"),
        58: () => require("../../assets/data/tafsir-sources/nazam-durar/58.json"),
        59: () => require("../../assets/data/tafsir-sources/nazam-durar/59.json"),
        60: () => require("../../assets/data/tafsir-sources/nazam-durar/60.json"),
        61: () => require("../../assets/data/tafsir-sources/nazam-durar/61.json"),
        62: () => require("../../assets/data/tafsir-sources/nazam-durar/62.json"),
        63: () => require("../../assets/data/tafsir-sources/nazam-durar/63.json"),
        64: () => require("../../assets/data/tafsir-sources/nazam-durar/64.json"),
        65: () => require("../../assets/data/tafsir-sources/nazam-durar/65.json"),
        66: () => require("../../assets/data/tafsir-sources/nazam-durar/66.json"),
        67: () => require("../../assets/data/tafsir-sources/nazam-durar/67.json"),
        68: () => require("../../assets/data/tafsir-sources/nazam-durar/68.json"),
        69: () => require("../../assets/data/tafsir-sources/nazam-durar/69.json"),
        70: () => require("../../assets/data/tafsir-sources/nazam-durar/70.json"),
        71: () => require("../../assets/data/tafsir-sources/nazam-durar/71.json"),
        72: () => require("../../assets/data/tafsir-sources/nazam-durar/72.json"),
        73: () => require("../../assets/data/tafsir-sources/nazam-durar/73.json"),
        74: () => require("../../assets/data/tafsir-sources/nazam-durar/74.json"),
        75: () => require("../../assets/data/tafsir-sources/nazam-durar/75.json"),
        76: () => require("../../assets/data/tafsir-sources/nazam-durar/76.json"),
        77: () => require("../../assets/data/tafsir-sources/nazam-durar/77.json"),
        78: () => require("../../assets/data/tafsir-sources/nazam-durar/78.json"),
        79: () => require("../../assets/data/tafsir-sources/nazam-durar/79.json"),
        80: () => require("../../assets/data/tafsir-sources/nazam-durar/80.json"),
        81: () => require("../../assets/data/tafsir-sources/nazam-durar/81.json"),
        82: () => require("../../assets/data/tafsir-sources/nazam-durar/82.json"),
        83: () => require("../../assets/data/tafsir-sources/nazam-durar/83.json"),
        84: () => require("../../assets/data/tafsir-sources/nazam-durar/84.json"),
        85: () => require("../../assets/data/tafsir-sources/nazam-durar/85.json"),
        86: () => require("../../assets/data/tafsir-sources/nazam-durar/86.json"),
        87: () => require("../../assets/data/tafsir-sources/nazam-durar/87.json"),
        88: () => require("../../assets/data/tafsir-sources/nazam-durar/88.json"),
        89: () => require("../../assets/data/tafsir-sources/nazam-durar/89.json"),
        90: () => require("../../assets/data/tafsir-sources/nazam-durar/90.json"),
        91: () => require("../../assets/data/tafsir-sources/nazam-durar/91.json"),
        92: () => require("../../assets/data/tafsir-sources/nazam-durar/92.json"),
        93: () => require("../../assets/data/tafsir-sources/nazam-durar/93.json"),
        94: () => require("../../assets/data/tafsir-sources/nazam-durar/94.json"),
        95: () => require("../../assets/data/tafsir-sources/nazam-durar/95.json"),
        96: () => require("../../assets/data/tafsir-sources/nazam-durar/96.json"),
        97: () => require("../../assets/data/tafsir-sources/nazam-durar/97.json"),
        98: () => require("../../assets/data/tafsir-sources/nazam-durar/98.json"),
        99: () => require("../../assets/data/tafsir-sources/nazam-durar/99.json"),
        100: () => require("../../assets/data/tafsir-sources/nazam-durar/100.json"),
        101: () => require("../../assets/data/tafsir-sources/nazam-durar/101.json"),
        102: () => require("../../assets/data/tafsir-sources/nazam-durar/102.json"),
        103: () => require("../../assets/data/tafsir-sources/nazam-durar/103.json"),
        104: () => require("../../assets/data/tafsir-sources/nazam-durar/104.json"),
        105: () => require("../../assets/data/tafsir-sources/nazam-durar/105.json"),
        106: () => require("../../assets/data/tafsir-sources/nazam-durar/106.json"),
        107: () => require("../../assets/data/tafsir-sources/nazam-durar/107.json"),
        108: () => require("../../assets/data/tafsir-sources/nazam-durar/108.json"),
        109: () => require("../../assets/data/tafsir-sources/nazam-durar/109.json"),
        110: () => require("../../assets/data/tafsir-sources/nazam-durar/110.json"),
        111: () => require("../../assets/data/tafsir-sources/nazam-durar/111.json"),
        112: () => require("../../assets/data/tafsir-sources/nazam-durar/112.json"),
        113: () => require("../../assets/data/tafsir-sources/nazam-durar/113.json"),
        114: () => require("../../assets/data/tafsir-sources/nazam-durar/114.json"),
      }
    : {};

export const nativeRaziRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? {
        1: () => require("../../assets/data/tafsir-sources/razi/1.json"),
        2: () => require("../../assets/data/tafsir-sources/razi/2.json"),
        3: () => require("../../assets/data/tafsir-sources/razi/3.json"),
        4: () => require("../../assets/data/tafsir-sources/razi/4.json"),
        5: () => require("../../assets/data/tafsir-sources/razi/5.json"),
        6: () => require("../../assets/data/tafsir-sources/razi/6.json"),
        7: () => require("../../assets/data/tafsir-sources/razi/7.json"),
        8: () => require("../../assets/data/tafsir-sources/razi/8.json"),
        9: () => require("../../assets/data/tafsir-sources/razi/9.json"),
        10: () => require("../../assets/data/tafsir-sources/razi/10.json"),
        11: () => require("../../assets/data/tafsir-sources/razi/11.json"),
        12: () => require("../../assets/data/tafsir-sources/razi/12.json"),
        13: () => require("../../assets/data/tafsir-sources/razi/13.json"),
        14: () => require("../../assets/data/tafsir-sources/razi/14.json"),
        15: () => require("../../assets/data/tafsir-sources/razi/15.json"),
        16: () => require("../../assets/data/tafsir-sources/razi/16.json"),
        17: () => require("../../assets/data/tafsir-sources/razi/17.json"),
        18: () => require("../../assets/data/tafsir-sources/razi/18.json"),
        19: () => require("../../assets/data/tafsir-sources/razi/19.json"),
        20: () => require("../../assets/data/tafsir-sources/razi/20.json"),
        21: () => require("../../assets/data/tafsir-sources/razi/21.json"),
        22: () => require("../../assets/data/tafsir-sources/razi/22.json"),
        23: () => require("../../assets/data/tafsir-sources/razi/23.json"),
        24: () => require("../../assets/data/tafsir-sources/razi/24.json"),
        25: () => require("../../assets/data/tafsir-sources/razi/25.json"),
        26: () => require("../../assets/data/tafsir-sources/razi/26.json"),
        27: () => require("../../assets/data/tafsir-sources/razi/27.json"),
        28: () => require("../../assets/data/tafsir-sources/razi/28.json"),
        29: () => require("../../assets/data/tafsir-sources/razi/29.json"),
        30: () => require("../../assets/data/tafsir-sources/razi/30.json"),
        31: () => require("../../assets/data/tafsir-sources/razi/31.json"),
        32: () => require("../../assets/data/tafsir-sources/razi/32.json"),
        33: () => require("../../assets/data/tafsir-sources/razi/33.json"),
        34: () => require("../../assets/data/tafsir-sources/razi/34.json"),
        35: () => require("../../assets/data/tafsir-sources/razi/35.json"),
        36: () => require("../../assets/data/tafsir-sources/razi/36.json"),
        37: () => require("../../assets/data/tafsir-sources/razi/37.json"),
        38: () => require("../../assets/data/tafsir-sources/razi/38.json"),
        39: () => require("../../assets/data/tafsir-sources/razi/39.json"),
        40: () => require("../../assets/data/tafsir-sources/razi/40.json"),
        41: () => require("../../assets/data/tafsir-sources/razi/41.json"),
        42: () => require("../../assets/data/tafsir-sources/razi/42.json"),
        43: () => require("../../assets/data/tafsir-sources/razi/43.json"),
        44: () => require("../../assets/data/tafsir-sources/razi/44.json"),
        45: () => require("../../assets/data/tafsir-sources/razi/45.json"),
        46: () => require("../../assets/data/tafsir-sources/razi/46.json"),
        47: () => require("../../assets/data/tafsir-sources/razi/47.json"),
        48: () => require("../../assets/data/tafsir-sources/razi/48.json"),
        49: () => require("../../assets/data/tafsir-sources/razi/49.json"),
        50: () => require("../../assets/data/tafsir-sources/razi/50.json"),
        51: () => require("../../assets/data/tafsir-sources/razi/51.json"),
        52: () => require("../../assets/data/tafsir-sources/razi/52.json"),
        53: () => require("../../assets/data/tafsir-sources/razi/53.json"),
        54: () => require("../../assets/data/tafsir-sources/razi/54.json"),
        55: () => require("../../assets/data/tafsir-sources/razi/55.json"),
        56: () => require("../../assets/data/tafsir-sources/razi/56.json"),
        57: () => require("../../assets/data/tafsir-sources/razi/57.json"),
        58: () => require("../../assets/data/tafsir-sources/razi/58.json"),
        59: () => require("../../assets/data/tafsir-sources/razi/59.json"),
        60: () => require("../../assets/data/tafsir-sources/razi/60.json"),
        61: () => require("../../assets/data/tafsir-sources/razi/61.json"),
        62: () => require("../../assets/data/tafsir-sources/razi/62.json"),
        63: () => require("../../assets/data/tafsir-sources/razi/63.json"),
        64: () => require("../../assets/data/tafsir-sources/razi/64.json"),
        65: () => require("../../assets/data/tafsir-sources/razi/65.json"),
        66: () => require("../../assets/data/tafsir-sources/razi/66.json"),
        67: () => require("../../assets/data/tafsir-sources/razi/67.json"),
        68: () => require("../../assets/data/tafsir-sources/razi/68.json"),
        69: () => require("../../assets/data/tafsir-sources/razi/69.json"),
        70: () => require("../../assets/data/tafsir-sources/razi/70.json"),
        71: () => require("../../assets/data/tafsir-sources/razi/71.json"),
        72: () => require("../../assets/data/tafsir-sources/razi/72.json"),
        73: () => require("../../assets/data/tafsir-sources/razi/73.json"),
        74: () => require("../../assets/data/tafsir-sources/razi/74.json"),
        75: () => require("../../assets/data/tafsir-sources/razi/75.json"),
        76: () => require("../../assets/data/tafsir-sources/razi/76.json"),
        77: () => require("../../assets/data/tafsir-sources/razi/77.json"),
        78: () => require("../../assets/data/tafsir-sources/razi/78.json"),
        79: () => require("../../assets/data/tafsir-sources/razi/79.json"),
        80: () => require("../../assets/data/tafsir-sources/razi/80.json"),
        81: () => require("../../assets/data/tafsir-sources/razi/81.json"),
        82: () => require("../../assets/data/tafsir-sources/razi/82.json"),
        83: () => require("../../assets/data/tafsir-sources/razi/83.json"),
        84: () => require("../../assets/data/tafsir-sources/razi/84.json"),
        85: () => require("../../assets/data/tafsir-sources/razi/85.json"),
        86: () => require("../../assets/data/tafsir-sources/razi/86.json"),
        87: () => require("../../assets/data/tafsir-sources/razi/87.json"),
        88: () => require("../../assets/data/tafsir-sources/razi/88.json"),
        89: () => require("../../assets/data/tafsir-sources/razi/89.json"),
        90: () => require("../../assets/data/tafsir-sources/razi/90.json"),
        91: () => require("../../assets/data/tafsir-sources/razi/91.json"),
        92: () => require("../../assets/data/tafsir-sources/razi/92.json"),
        93: () => require("../../assets/data/tafsir-sources/razi/93.json"),
        94: () => require("../../assets/data/tafsir-sources/razi/94.json"),
        95: () => require("../../assets/data/tafsir-sources/razi/95.json"),
        96: () => require("../../assets/data/tafsir-sources/razi/96.json"),
        97: () => require("../../assets/data/tafsir-sources/razi/97.json"),
        98: () => require("../../assets/data/tafsir-sources/razi/98.json"),
        99: () => require("../../assets/data/tafsir-sources/razi/99.json"),
        100: () => require("../../assets/data/tafsir-sources/razi/100.json"),
        101: () => require("../../assets/data/tafsir-sources/razi/101.json"),
        102: () => require("../../assets/data/tafsir-sources/razi/102.json"),
        103: () => require("../../assets/data/tafsir-sources/razi/103.json"),
        104: () => require("../../assets/data/tafsir-sources/razi/104.json"),
        105: () => require("../../assets/data/tafsir-sources/razi/105.json"),
        106: () => require("../../assets/data/tafsir-sources/razi/106.json"),
        107: () => require("../../assets/data/tafsir-sources/razi/107.json"),
        108: () => require("../../assets/data/tafsir-sources/razi/108.json"),
        109: () => require("../../assets/data/tafsir-sources/razi/109.json"),
        110: () => require("../../assets/data/tafsir-sources/razi/110.json"),
        111: () => require("../../assets/data/tafsir-sources/razi/111.json"),
        112: () => require("../../assets/data/tafsir-sources/razi/112.json"),
        113: () => require("../../assets/data/tafsir-sources/razi/113.json"),
        114: () => require("../../assets/data/tafsir-sources/razi/114.json"),
      }
    : {};

export const nativeJalalaynRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? {
        1: () => require("../../assets/data/tafsir-sources/jalalayn/1.json"),
        2: () => require("../../assets/data/tafsir-sources/jalalayn/2.json"),
        3: () => require("../../assets/data/tafsir-sources/jalalayn/3.json"),
        4: () => require("../../assets/data/tafsir-sources/jalalayn/4.json"),
        5: () => require("../../assets/data/tafsir-sources/jalalayn/5.json"),
        6: () => require("../../assets/data/tafsir-sources/jalalayn/6.json"),
        7: () => require("../../assets/data/tafsir-sources/jalalayn/7.json"),
        8: () => require("../../assets/data/tafsir-sources/jalalayn/8.json"),
        9: () => require("../../assets/data/tafsir-sources/jalalayn/9.json"),
        10: () => require("../../assets/data/tafsir-sources/jalalayn/10.json"),
        11: () => require("../../assets/data/tafsir-sources/jalalayn/11.json"),
        12: () => require("../../assets/data/tafsir-sources/jalalayn/12.json"),
        13: () => require("../../assets/data/tafsir-sources/jalalayn/13.json"),
        14: () => require("../../assets/data/tafsir-sources/jalalayn/14.json"),
        15: () => require("../../assets/data/tafsir-sources/jalalayn/15.json"),
        16: () => require("../../assets/data/tafsir-sources/jalalayn/16.json"),
        17: () => require("../../assets/data/tafsir-sources/jalalayn/17.json"),
        18: () => require("../../assets/data/tafsir-sources/jalalayn/18.json"),
        19: () => require("../../assets/data/tafsir-sources/jalalayn/19.json"),
        20: () => require("../../assets/data/tafsir-sources/jalalayn/20.json"),
        21: () => require("../../assets/data/tafsir-sources/jalalayn/21.json"),
        22: () => require("../../assets/data/tafsir-sources/jalalayn/22.json"),
        23: () => require("../../assets/data/tafsir-sources/jalalayn/23.json"),
        24: () => require("../../assets/data/tafsir-sources/jalalayn/24.json"),
        25: () => require("../../assets/data/tafsir-sources/jalalayn/25.json"),
        26: () => require("../../assets/data/tafsir-sources/jalalayn/26.json"),
        27: () => require("../../assets/data/tafsir-sources/jalalayn/27.json"),
        28: () => require("../../assets/data/tafsir-sources/jalalayn/28.json"),
        29: () => require("../../assets/data/tafsir-sources/jalalayn/29.json"),
        30: () => require("../../assets/data/tafsir-sources/jalalayn/30.json"),
        31: () => require("../../assets/data/tafsir-sources/jalalayn/31.json"),
        32: () => require("../../assets/data/tafsir-sources/jalalayn/32.json"),
        33: () => require("../../assets/data/tafsir-sources/jalalayn/33.json"),
        34: () => require("../../assets/data/tafsir-sources/jalalayn/34.json"),
        35: () => require("../../assets/data/tafsir-sources/jalalayn/35.json"),
        36: () => require("../../assets/data/tafsir-sources/jalalayn/36.json"),
        37: () => require("../../assets/data/tafsir-sources/jalalayn/37.json"),
        38: () => require("../../assets/data/tafsir-sources/jalalayn/38.json"),
        39: () => require("../../assets/data/tafsir-sources/jalalayn/39.json"),
        40: () => require("../../assets/data/tafsir-sources/jalalayn/40.json"),
        41: () => require("../../assets/data/tafsir-sources/jalalayn/41.json"),
        42: () => require("../../assets/data/tafsir-sources/jalalayn/42.json"),
        43: () => require("../../assets/data/tafsir-sources/jalalayn/43.json"),
        44: () => require("../../assets/data/tafsir-sources/jalalayn/44.json"),
        45: () => require("../../assets/data/tafsir-sources/jalalayn/45.json"),
        46: () => require("../../assets/data/tafsir-sources/jalalayn/46.json"),
        47: () => require("../../assets/data/tafsir-sources/jalalayn/47.json"),
        48: () => require("../../assets/data/tafsir-sources/jalalayn/48.json"),
        49: () => require("../../assets/data/tafsir-sources/jalalayn/49.json"),
        50: () => require("../../assets/data/tafsir-sources/jalalayn/50.json"),
        51: () => require("../../assets/data/tafsir-sources/jalalayn/51.json"),
        52: () => require("../../assets/data/tafsir-sources/jalalayn/52.json"),
        53: () => require("../../assets/data/tafsir-sources/jalalayn/53.json"),
        54: () => require("../../assets/data/tafsir-sources/jalalayn/54.json"),
        55: () => require("../../assets/data/tafsir-sources/jalalayn/55.json"),
        56: () => require("../../assets/data/tafsir-sources/jalalayn/56.json"),
        57: () => require("../../assets/data/tafsir-sources/jalalayn/57.json"),
        58: () => require("../../assets/data/tafsir-sources/jalalayn/58.json"),
        59: () => require("../../assets/data/tafsir-sources/jalalayn/59.json"),
        60: () => require("../../assets/data/tafsir-sources/jalalayn/60.json"),
        61: () => require("../../assets/data/tafsir-sources/jalalayn/61.json"),
        62: () => require("../../assets/data/tafsir-sources/jalalayn/62.json"),
        63: () => require("../../assets/data/tafsir-sources/jalalayn/63.json"),
        64: () => require("../../assets/data/tafsir-sources/jalalayn/64.json"),
        65: () => require("../../assets/data/tafsir-sources/jalalayn/65.json"),
        66: () => require("../../assets/data/tafsir-sources/jalalayn/66.json"),
        67: () => require("../../assets/data/tafsir-sources/jalalayn/67.json"),
        68: () => require("../../assets/data/tafsir-sources/jalalayn/68.json"),
        69: () => require("../../assets/data/tafsir-sources/jalalayn/69.json"),
        70: () => require("../../assets/data/tafsir-sources/jalalayn/70.json"),
        71: () => require("../../assets/data/tafsir-sources/jalalayn/71.json"),
        72: () => require("../../assets/data/tafsir-sources/jalalayn/72.json"),
        73: () => require("../../assets/data/tafsir-sources/jalalayn/73.json"),
        74: () => require("../../assets/data/tafsir-sources/jalalayn/74.json"),
        75: () => require("../../assets/data/tafsir-sources/jalalayn/75.json"),
        76: () => require("../../assets/data/tafsir-sources/jalalayn/76.json"),
        77: () => require("../../assets/data/tafsir-sources/jalalayn/77.json"),
        78: () => require("../../assets/data/tafsir-sources/jalalayn/78.json"),
        79: () => require("../../assets/data/tafsir-sources/jalalayn/79.json"),
        80: () => require("../../assets/data/tafsir-sources/jalalayn/80.json"),
        81: () => require("../../assets/data/tafsir-sources/jalalayn/81.json"),
        82: () => require("../../assets/data/tafsir-sources/jalalayn/82.json"),
        83: () => require("../../assets/data/tafsir-sources/jalalayn/83.json"),
        84: () => require("../../assets/data/tafsir-sources/jalalayn/84.json"),
        85: () => require("../../assets/data/tafsir-sources/jalalayn/85.json"),
        86: () => require("../../assets/data/tafsir-sources/jalalayn/86.json"),
        87: () => require("../../assets/data/tafsir-sources/jalalayn/87.json"),
        88: () => require("../../assets/data/tafsir-sources/jalalayn/88.json"),
        89: () => require("../../assets/data/tafsir-sources/jalalayn/89.json"),
        90: () => require("../../assets/data/tafsir-sources/jalalayn/90.json"),
        91: () => require("../../assets/data/tafsir-sources/jalalayn/91.json"),
        92: () => require("../../assets/data/tafsir-sources/jalalayn/92.json"),
        93: () => require("../../assets/data/tafsir-sources/jalalayn/93.json"),
        94: () => require("../../assets/data/tafsir-sources/jalalayn/94.json"),
        95: () => require("../../assets/data/tafsir-sources/jalalayn/95.json"),
        96: () => require("../../assets/data/tafsir-sources/jalalayn/96.json"),
        97: () => require("../../assets/data/tafsir-sources/jalalayn/97.json"),
        98: () => require("../../assets/data/tafsir-sources/jalalayn/98.json"),
        99: () => require("../../assets/data/tafsir-sources/jalalayn/99.json"),
        100: () => require("../../assets/data/tafsir-sources/jalalayn/100.json"),
        101: () => require("../../assets/data/tafsir-sources/jalalayn/101.json"),
        102: () => require("../../assets/data/tafsir-sources/jalalayn/102.json"),
        103: () => require("../../assets/data/tafsir-sources/jalalayn/103.json"),
        104: () => require("../../assets/data/tafsir-sources/jalalayn/104.json"),
        105: () => require("../../assets/data/tafsir-sources/jalalayn/105.json"),
        106: () => require("../../assets/data/tafsir-sources/jalalayn/106.json"),
        107: () => require("../../assets/data/tafsir-sources/jalalayn/107.json"),
        108: () => require("../../assets/data/tafsir-sources/jalalayn/108.json"),
        109: () => require("../../assets/data/tafsir-sources/jalalayn/109.json"),
        110: () => require("../../assets/data/tafsir-sources/jalalayn/110.json"),
        111: () => require("../../assets/data/tafsir-sources/jalalayn/111.json"),
        112: () => require("../../assets/data/tafsir-sources/jalalayn/112.json"),
        113: () => require("../../assets/data/tafsir-sources/jalalayn/113.json"),
        114: () => require("../../assets/data/tafsir-sources/jalalayn/114.json"),
      }
    : {};

export const nativeJalalaynEnRequires: Record<number, () => any> =
  Platform.OS !== "web"
    ? {
        1: () => require("../../assets/data/tafsir-sources/jalalayn-en/1.json"),
        2: () => require("../../assets/data/tafsir-sources/jalalayn-en/2.json"),
        3: () => require("../../assets/data/tafsir-sources/jalalayn-en/3.json"),
        4: () => require("../../assets/data/tafsir-sources/jalalayn-en/4.json"),
        5: () => require("../../assets/data/tafsir-sources/jalalayn-en/5.json"),
        6: () => require("../../assets/data/tafsir-sources/jalalayn-en/6.json"),
        7: () => require("../../assets/data/tafsir-sources/jalalayn-en/7.json"),
        8: () => require("../../assets/data/tafsir-sources/jalalayn-en/8.json"),
        9: () => require("../../assets/data/tafsir-sources/jalalayn-en/9.json"),
        10: () => require("../../assets/data/tafsir-sources/jalalayn-en/10.json"),
        11: () => require("../../assets/data/tafsir-sources/jalalayn-en/11.json"),
        12: () => require("../../assets/data/tafsir-sources/jalalayn-en/12.json"),
        13: () => require("../../assets/data/tafsir-sources/jalalayn-en/13.json"),
        14: () => require("../../assets/data/tafsir-sources/jalalayn-en/14.json"),
        15: () => require("../../assets/data/tafsir-sources/jalalayn-en/15.json"),
        16: () => require("../../assets/data/tafsir-sources/jalalayn-en/16.json"),
        17: () => require("../../assets/data/tafsir-sources/jalalayn-en/17.json"),
        18: () => require("../../assets/data/tafsir-sources/jalalayn-en/18.json"),
        19: () => require("../../assets/data/tafsir-sources/jalalayn-en/19.json"),
        20: () => require("../../assets/data/tafsir-sources/jalalayn-en/20.json"),
        21: () => require("../../assets/data/tafsir-sources/jalalayn-en/21.json"),
        22: () => require("../../assets/data/tafsir-sources/jalalayn-en/22.json"),
        23: () => require("../../assets/data/tafsir-sources/jalalayn-en/23.json"),
        24: () => require("../../assets/data/tafsir-sources/jalalayn-en/24.json"),
        25: () => require("../../assets/data/tafsir-sources/jalalayn-en/25.json"),
        26: () => require("../../assets/data/tafsir-sources/jalalayn-en/26.json"),
        27: () => require("../../assets/data/tafsir-sources/jalalayn-en/27.json"),
        28: () => require("../../assets/data/tafsir-sources/jalalayn-en/28.json"),
        29: () => require("../../assets/data/tafsir-sources/jalalayn-en/29.json"),
        30: () => require("../../assets/data/tafsir-sources/jalalayn-en/30.json"),
        31: () => require("../../assets/data/tafsir-sources/jalalayn-en/31.json"),
        32: () => require("../../assets/data/tafsir-sources/jalalayn-en/32.json"),
        33: () => require("../../assets/data/tafsir-sources/jalalayn-en/33.json"),
        34: () => require("../../assets/data/tafsir-sources/jalalayn-en/34.json"),
        35: () => require("../../assets/data/tafsir-sources/jalalayn-en/35.json"),
        36: () => require("../../assets/data/tafsir-sources/jalalayn-en/36.json"),
        37: () => require("../../assets/data/tafsir-sources/jalalayn-en/37.json"),
        38: () => require("../../assets/data/tafsir-sources/jalalayn-en/38.json"),
        39: () => require("../../assets/data/tafsir-sources/jalalayn-en/39.json"),
        40: () => require("../../assets/data/tafsir-sources/jalalayn-en/40.json"),
        41: () => require("../../assets/data/tafsir-sources/jalalayn-en/41.json"),
        42: () => require("../../assets/data/tafsir-sources/jalalayn-en/42.json"),
        43: () => require("../../assets/data/tafsir-sources/jalalayn-en/43.json"),
        44: () => require("../../assets/data/tafsir-sources/jalalayn-en/44.json"),
        45: () => require("../../assets/data/tafsir-sources/jalalayn-en/45.json"),
        46: () => require("../../assets/data/tafsir-sources/jalalayn-en/46.json"),
        47: () => require("../../assets/data/tafsir-sources/jalalayn-en/47.json"),
        48: () => require("../../assets/data/tafsir-sources/jalalayn-en/48.json"),
        49: () => require("../../assets/data/tafsir-sources/jalalayn-en/49.json"),
        50: () => require("../../assets/data/tafsir-sources/jalalayn-en/50.json"),
        51: () => require("../../assets/data/tafsir-sources/jalalayn-en/51.json"),
        52: () => require("../../assets/data/tafsir-sources/jalalayn-en/52.json"),
        53: () => require("../../assets/data/tafsir-sources/jalalayn-en/53.json"),
        54: () => require("../../assets/data/tafsir-sources/jalalayn-en/54.json"),
        55: () => require("../../assets/data/tafsir-sources/jalalayn-en/55.json"),
        56: () => require("../../assets/data/tafsir-sources/jalalayn-en/56.json"),
        57: () => require("../../assets/data/tafsir-sources/jalalayn-en/57.json"),
        58: () => require("../../assets/data/tafsir-sources/jalalayn-en/58.json"),
        59: () => require("../../assets/data/tafsir-sources/jalalayn-en/59.json"),
        60: () => require("../../assets/data/tafsir-sources/jalalayn-en/60.json"),
        61: () => require("../../assets/data/tafsir-sources/jalalayn-en/61.json"),
        62: () => require("../../assets/data/tafsir-sources/jalalayn-en/62.json"),
        63: () => require("../../assets/data/tafsir-sources/jalalayn-en/63.json"),
        64: () => require("../../assets/data/tafsir-sources/jalalayn-en/64.json"),
        65: () => require("../../assets/data/tafsir-sources/jalalayn-en/65.json"),
        66: () => require("../../assets/data/tafsir-sources/jalalayn-en/66.json"),
        67: () => require("../../assets/data/tafsir-sources/jalalayn-en/67.json"),
        68: () => require("../../assets/data/tafsir-sources/jalalayn-en/68.json"),
        69: () => require("../../assets/data/tafsir-sources/jalalayn-en/69.json"),
        70: () => require("../../assets/data/tafsir-sources/jalalayn-en/70.json"),
        71: () => require("../../assets/data/tafsir-sources/jalalayn-en/71.json"),
        72: () => require("../../assets/data/tafsir-sources/jalalayn-en/72.json"),
        73: () => require("../../assets/data/tafsir-sources/jalalayn-en/73.json"),
        74: () => require("../../assets/data/tafsir-sources/jalalayn-en/74.json"),
        75: () => require("../../assets/data/tafsir-sources/jalalayn-en/75.json"),
        76: () => require("../../assets/data/tafsir-sources/jalalayn-en/76.json"),
        77: () => require("../../assets/data/tafsir-sources/jalalayn-en/77.json"),
        78: () => require("../../assets/data/tafsir-sources/jalalayn-en/78.json"),
        79: () => require("../../assets/data/tafsir-sources/jalalayn-en/79.json"),
        80: () => require("../../assets/data/tafsir-sources/jalalayn-en/80.json"),
        81: () => require("../../assets/data/tafsir-sources/jalalayn-en/81.json"),
        82: () => require("../../assets/data/tafsir-sources/jalalayn-en/82.json"),
        83: () => require("../../assets/data/tafsir-sources/jalalayn-en/83.json"),
        84: () => require("../../assets/data/tafsir-sources/jalalayn-en/84.json"),
        85: () => require("../../assets/data/tafsir-sources/jalalayn-en/85.json"),
        86: () => require("../../assets/data/tafsir-sources/jalalayn-en/86.json"),
        87: () => require("../../assets/data/tafsir-sources/jalalayn-en/87.json"),
        88: () => require("../../assets/data/tafsir-sources/jalalayn-en/88.json"),
        89: () => require("../../assets/data/tafsir-sources/jalalayn-en/89.json"),
        90: () => require("../../assets/data/tafsir-sources/jalalayn-en/90.json"),
        91: () => require("../../assets/data/tafsir-sources/jalalayn-en/91.json"),
        92: () => require("../../assets/data/tafsir-sources/jalalayn-en/92.json"),
        93: () => require("../../assets/data/tafsir-sources/jalalayn-en/93.json"),
        94: () => require("../../assets/data/tafsir-sources/jalalayn-en/94.json"),
        95: () => require("../../assets/data/tafsir-sources/jalalayn-en/95.json"),
        96: () => require("../../assets/data/tafsir-sources/jalalayn-en/96.json"),
        97: () => require("../../assets/data/tafsir-sources/jalalayn-en/97.json"),
        98: () => require("../../assets/data/tafsir-sources/jalalayn-en/98.json"),
        99: () => require("../../assets/data/tafsir-sources/jalalayn-en/99.json"),
        100: () => require("../../assets/data/tafsir-sources/jalalayn-en/100.json"),
        101: () => require("../../assets/data/tafsir-sources/jalalayn-en/101.json"),
        102: () => require("../../assets/data/tafsir-sources/jalalayn-en/102.json"),
        103: () => require("../../assets/data/tafsir-sources/jalalayn-en/103.json"),
        104: () => require("../../assets/data/tafsir-sources/jalalayn-en/104.json"),
        105: () => require("../../assets/data/tafsir-sources/jalalayn-en/105.json"),
        106: () => require("../../assets/data/tafsir-sources/jalalayn-en/106.json"),
        107: () => require("../../assets/data/tafsir-sources/jalalayn-en/107.json"),
        108: () => require("../../assets/data/tafsir-sources/jalalayn-en/108.json"),
        109: () => require("../../assets/data/tafsir-sources/jalalayn-en/109.json"),
        110: () => require("../../assets/data/tafsir-sources/jalalayn-en/110.json"),
        111: () => require("../../assets/data/tafsir-sources/jalalayn-en/111.json"),
        112: () => require("../../assets/data/tafsir-sources/jalalayn-en/112.json"),
        113: () => require("../../assets/data/tafsir-sources/jalalayn-en/113.json"),
        114: () => require("../../assets/data/tafsir-sources/jalalayn-en/114.json"),
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
      return require("../../assets/data/tafseer/1.json");
    case 2:
      return require("../../assets/data/tafseer/2.json");
    case 3:
      return require("../../assets/data/tafseer/3.json");
    case 4:
      return require("../../assets/data/tafseer/4.json");
    case 5:
      return require("../../assets/data/tafseer/5.json");
    case 6:
      return require("../../assets/data/tafseer/6.json");
    case 7:
      return require("../../assets/data/tafseer/7.json");
    case 8:
      return require("../../assets/data/tafseer/8.json");
    case 9:
      return require("../../assets/data/tafseer/9.json");
    case 10:
      return require("../../assets/data/tafseer/10.json");
    case 11:
      return require("../../assets/data/tafseer/11.json");
    case 12:
      return require("../../assets/data/tafseer/12.json");
    case 13:
      return require("../../assets/data/tafseer/13.json");
    case 14:
      return require("../../assets/data/tafseer/14.json");
    case 15:
      return require("../../assets/data/tafseer/15.json");
    case 16:
      return require("../../assets/data/tafseer/16.json");
    case 17:
      return require("../../assets/data/tafseer/17.json");
    case 18:
      return require("../../assets/data/tafseer/18.json");
    case 19:
      return require("../../assets/data/tafseer/19.json");
    case 20:
      return require("../../assets/data/tafseer/20.json");
    case 21:
      return require("../../assets/data/tafseer/21.json");
    case 22:
      return require("../../assets/data/tafseer/22.json");
    case 23:
      return require("../../assets/data/tafseer/23.json");
    case 24:
      return require("../../assets/data/tafseer/24.json");
    case 25:
      return require("../../assets/data/tafseer/25.json");
    case 26:
      return require("../../assets/data/tafseer/26.json");
    case 27:
      return require("../../assets/data/tafseer/27.json");
    case 28:
      return require("../../assets/data/tafseer/28.json");
    case 29:
      return require("../../assets/data/tafseer/29.json");
    case 30:
      return require("../../assets/data/tafseer/30.json");
    case 31:
      return require("../../assets/data/tafseer/31.json");
    case 32:
      return require("../../assets/data/tafseer/32.json");
    case 33:
      return require("../../assets/data/tafseer/33.json");
    case 34:
      return require("../../assets/data/tafseer/34.json");
    case 35:
      return require("../../assets/data/tafseer/35.json");
    case 36:
      return require("../../assets/data/tafseer/36.json");
    case 37:
      return require("../../assets/data/tafseer/37.json");
    case 38:
      return require("../../assets/data/tafseer/38.json");
    case 39:
      return require("../../assets/data/tafseer/39.json");
    case 40:
      return require("../../assets/data/tafseer/40.json");
    case 41:
      return require("../../assets/data/tafseer/41.json");
    case 42:
      return require("../../assets/data/tafseer/42.json");
    case 43:
      return require("../../assets/data/tafseer/43.json");
    case 44:
      return require("../../assets/data/tafseer/44.json");
    case 45:
      return require("../../assets/data/tafseer/45.json");
    case 46:
      return require("../../assets/data/tafseer/46.json");
    case 47:
      return require("../../assets/data/tafseer/47.json");
    case 48:
      return require("../../assets/data/tafseer/48.json");
    case 49:
      return require("../../assets/data/tafseer/49.json");
    case 50:
      return require("../../assets/data/tafseer/50.json");
    case 51:
      return require("../../assets/data/tafseer/51.json");
    case 52:
      return require("../../assets/data/tafseer/52.json");
    case 53:
      return require("../../assets/data/tafseer/53.json");
    case 54:
      return require("../../assets/data/tafseer/54.json");
    case 55:
      return require("../../assets/data/tafseer/55.json");
    case 56:
      return require("../../assets/data/tafseer/56.json");
    case 57:
      return require("../../assets/data/tafseer/57.json");
    case 58:
      return require("../../assets/data/tafseer/58.json");
    case 59:
      return require("../../assets/data/tafseer/59.json");
    case 60:
      return require("../../assets/data/tafseer/60.json");
    case 61:
      return require("../../assets/data/tafseer/61.json");
    case 62:
      return require("../../assets/data/tafseer/62.json");
    case 63:
      return require("../../assets/data/tafseer/63.json");
    case 64:
      return require("../../assets/data/tafseer/64.json");
    case 65:
      return require("../../assets/data/tafseer/65.json");
    case 66:
      return require("../../assets/data/tafseer/66.json");
    case 67:
      return require("../../assets/data/tafseer/67.json");
    case 68:
      return require("../../assets/data/tafseer/68.json");
    case 69:
      return require("../../assets/data/tafseer/69.json");
    case 70:
      return require("../../assets/data/tafseer/70.json");
    case 71:
      return require("../../assets/data/tafseer/71.json");
    case 72:
      return require("../../assets/data/tafseer/72.json");
    case 73:
      return require("../../assets/data/tafseer/73.json");
    case 74:
      return require("../../assets/data/tafseer/74.json");
    case 75:
      return require("../../assets/data/tafseer/75.json");
    case 76:
      return require("../../assets/data/tafseer/76.json");
    case 77:
      return require("../../assets/data/tafseer/77.json");
    case 78:
      return require("../../assets/data/tafseer/78.json");
    case 79:
      return require("../../assets/data/tafseer/79.json");
    case 80:
      return require("../../assets/data/tafseer/80.json");
    case 81:
      return require("../../assets/data/tafseer/81.json");
    case 82:
      return require("../../assets/data/tafseer/82.json");
    case 83:
      return require("../../assets/data/tafseer/83.json");
    case 84:
      return require("../../assets/data/tafseer/84.json");
    case 85:
      return require("../../assets/data/tafseer/85.json");
    case 86:
      return require("../../assets/data/tafseer/86.json");
    case 87:
      return require("../../assets/data/tafseer/87.json");
    case 88:
      return require("../../assets/data/tafseer/88.json");
    case 89:
      return require("../../assets/data/tafseer/89.json");
    case 90:
      return require("../../assets/data/tafseer/90.json");
    case 91:
      return require("../../assets/data/tafseer/91.json");
    case 92:
      return require("../../assets/data/tafseer/92.json");
    case 93:
      return require("../../assets/data/tafseer/93.json");
    case 94:
      return require("../../assets/data/tafseer/94.json");
    case 95:
      return require("../../assets/data/tafseer/95.json");
    case 96:
      return require("../../assets/data/tafseer/96.json");
    case 97:
      return require("../../assets/data/tafseer/97.json");
    case 98:
      return require("../../assets/data/tafseer/98.json");
    case 99:
      return require("../../assets/data/tafseer/99.json");
    case 100:
      return require("../../assets/data/tafseer/100.json");
    case 101:
      return require("../../assets/data/tafseer/101.json");
    case 102:
      return require("../../assets/data/tafseer/102.json");
    case 103:
      return require("../../assets/data/tafseer/103.json");
    case 104:
      return require("../../assets/data/tafseer/104.json");
    case 105:
      return require("../../assets/data/tafseer/105.json");
    case 106:
      return require("../../assets/data/tafseer/106.json");
    case 107:
      return require("../../assets/data/tafseer/107.json");
    case 108:
      return require("../../assets/data/tafseer/108.json");
    case 109:
      return require("../../assets/data/tafseer/109.json");
    case 110:
      return require("../../assets/data/tafseer/110.json");
    case 111:
      return require("../../assets/data/tafseer/111.json");
    case 112:
      return require("../../assets/data/tafseer/112.json");
    case 113:
      return require("../../assets/data/tafseer/113.json");
    case 114:
      return require("../../assets/data/tafseer/114.json");
    default:
      return null;
  }
}

function tahrirTanwirRequireStatic(n: number): any {
  switch (n) {
    case 1:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/1.json");
    case 2:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/2.json");
    case 3:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/3.json");
    case 4:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/4.json");
    case 5:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/5.json");
    case 6:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/6.json");
    case 7:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/7.json");
    case 8:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/8.json");
    case 9:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/9.json");
    case 10:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/10.json");
    case 11:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/11.json");
    case 12:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/12.json");
    case 13:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/13.json");
    case 14:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/14.json");
    case 15:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/15.json");
    case 16:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/16.json");
    case 17:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/17.json");
    case 18:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/18.json");
    case 19:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/19.json");
    case 20:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/20.json");
    case 21:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/21.json");
    case 22:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/22.json");
    case 23:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/23.json");
    case 24:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/24.json");
    case 25:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/25.json");
    case 26:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/26.json");
    case 27:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/27.json");
    case 28:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/28.json");
    case 29:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/29.json");
    case 30:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/30.json");
    case 31:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/31.json");
    case 32:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/32.json");
    case 33:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/33.json");
    case 34:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/34.json");
    case 35:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/35.json");
    case 36:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/36.json");
    case 37:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/37.json");
    case 38:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/38.json");
    case 39:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/39.json");
    case 40:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/40.json");
    case 41:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/41.json");
    case 42:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/42.json");
    case 43:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/43.json");
    case 44:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/44.json");
    case 45:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/45.json");
    case 46:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/46.json");
    case 47:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/47.json");
    case 48:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/48.json");
    case 49:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/49.json");
    case 50:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/50.json");
    case 51:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/51.json");
    case 52:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/52.json");
    case 53:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/53.json");
    case 54:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/54.json");
    case 55:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/55.json");
    case 56:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/56.json");
    case 57:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/57.json");
    case 58:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/58.json");
    case 59:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/59.json");
    case 60:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/60.json");
    case 61:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/61.json");
    case 62:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/62.json");
    case 63:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/63.json");
    case 64:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/64.json");
    case 65:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/65.json");
    case 66:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/66.json");
    case 67:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/67.json");
    case 68:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/68.json");
    case 69:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/69.json");
    case 70:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/70.json");
    case 71:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/71.json");
    case 72:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/72.json");
    case 73:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/73.json");
    case 74:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/74.json");
    case 75:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/75.json");
    case 76:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/76.json");
    case 77:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/77.json");
    case 78:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/78.json");
    case 79:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/79.json");
    case 80:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/80.json");
    case 81:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/81.json");
    case 82:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/82.json");
    case 83:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/83.json");
    case 84:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/84.json");
    case 85:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/85.json");
    case 86:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/86.json");
    case 87:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/87.json");
    case 88:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/88.json");
    case 89:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/89.json");
    case 90:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/90.json");
    case 91:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/91.json");
    case 92:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/92.json");
    case 93:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/93.json");
    case 94:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/94.json");
    case 95:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/95.json");
    case 96:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/96.json");
    case 97:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/97.json");
    case 98:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/98.json");
    case 99:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/99.json");
    case 100:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/100.json");
    case 101:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/101.json");
    case 102:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/102.json");
    case 103:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/103.json");
    case 104:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/104.json");
    case 105:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/105.json");
    case 106:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/106.json");
    case 107:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/107.json");
    case 108:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/108.json");
    case 109:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/109.json");
    case 110:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/110.json");
    case 111:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/111.json");
    case 112:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/112.json");
    case 113:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/113.json");
    case 114:
      return require("../../assets/data/tafsir-sources/tahrir-tanwir/114.json");
    default:
      return null;
  }
}

function alBahrAlMadidRequireStatic(n: number): any {
  switch (n) {
    case 1:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/1.json");
    case 2:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/2.json");
    case 3:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/3.json");
    case 4:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/4.json");
    case 5:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/5.json");
    case 6:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/6.json");
    case 7:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/7.json");
    case 8:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/8.json");
    case 9:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/9.json");
    case 10:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/10.json");
    case 11:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/11.json");
    case 12:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/12.json");
    case 13:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/13.json");
    case 14:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/14.json");
    case 15:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/15.json");
    case 16:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/16.json");
    case 17:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/17.json");
    case 18:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/18.json");
    case 19:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/19.json");
    case 20:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/20.json");
    case 21:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/21.json");
    case 22:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/22.json");
    case 23:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/23.json");
    case 24:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/24.json");
    case 25:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/25.json");
    case 26:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/26.json");
    case 27:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/27.json");
    case 28:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/28.json");
    case 29:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/29.json");
    case 30:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/30.json");
    case 31:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/31.json");
    case 32:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/32.json");
    case 33:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/33.json");
    case 34:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/34.json");
    case 35:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/35.json");
    case 36:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/36.json");
    case 37:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/37.json");
    case 38:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/38.json");
    case 39:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/39.json");
    case 40:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/40.json");
    case 41:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/41.json");
    case 42:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/42.json");
    case 43:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/43.json");
    case 44:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/44.json");
    case 45:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/45.json");
    case 46:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/46.json");
    case 47:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/47.json");
    case 48:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/48.json");
    case 49:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/49.json");
    case 50:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/50.json");
    case 51:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/51.json");
    case 52:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/52.json");
    case 53:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/53.json");
    case 54:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/54.json");
    case 55:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/55.json");
    case 56:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/56.json");
    case 57:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/57.json");
    case 58:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/58.json");
    case 59:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/59.json");
    case 60:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/60.json");
    case 61:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/61.json");
    case 62:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/62.json");
    case 63:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/63.json");
    case 64:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/64.json");
    case 65:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/65.json");
    case 66:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/66.json");
    case 67:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/67.json");
    case 68:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/68.json");
    case 69:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/69.json");
    case 70:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/70.json");
    case 71:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/71.json");
    case 72:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/72.json");
    case 73:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/73.json");
    case 74:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/74.json");
    case 75:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/75.json");
    case 76:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/76.json");
    case 77:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/77.json");
    case 78:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/78.json");
    case 79:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/79.json");
    case 80:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/80.json");
    case 81:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/81.json");
    case 82:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/82.json");
    case 83:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/83.json");
    case 84:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/84.json");
    case 85:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/85.json");
    case 86:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/86.json");
    case 87:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/87.json");
    case 88:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/88.json");
    case 89:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/89.json");
    case 90:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/90.json");
    case 91:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/91.json");
    case 92:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/92.json");
    case 93:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/93.json");
    case 94:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/94.json");
    case 95:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/95.json");
    case 96:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/96.json");
    case 97:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/97.json");
    case 98:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/98.json");
    case 99:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/99.json");
    case 100:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/100.json");
    case 101:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/101.json");
    case 102:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/102.json");
    case 103:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/103.json");
    case 104:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/104.json");
    case 105:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/105.json");
    case 106:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/106.json");
    case 107:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/107.json");
    case 108:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/108.json");
    case 109:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/109.json");
    case 110:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/110.json");
    case 111:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/111.json");
    case 112:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/112.json");
    case 113:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/113.json");
    case 114:
      return require("../../assets/data/tafsir-sources/al-bahr-al-madid/114.json");
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
