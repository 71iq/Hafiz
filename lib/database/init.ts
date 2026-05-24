import { Platform } from "react-native";
import type { SQLiteDatabase } from "expo-sqlite";
import { createSchema, createTextSearchIndex, migrateUserSchema } from "./schema";
import { normalizeArabicCore, normalizeArabicWord } from "@/lib/arabic";
import {
  buildAyahCountIndex,
  computeReflectionJourneyFingerprint,
  loadAndValidateReflectionJourneySeed,
} from "@/lib/reflection-journey/schema";
import {
  TAFSIR_SOURCES,
  SURAH_ROW_TAFSIR_SOURCES,
  type TafsirSourceConfig,
  type TafsirSourceId,
} from "@/lib/tafsir/sources";

// ─── Platform-aware data loading ─────────────────────────────
// On web: fetch from /data/ (static files served from public/)
// On native: use require() (Metro handles large assets fine)

// Native-only require map — these are stripped from the web bundle
// because the loadData() web path uses fetch() instead.
const nativeRequires: Record<string, () => any> = Platform.OS !== "web"
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
      "al-qira-at-al-mawsoo-ah-al-qur-aniyyah.json": () => require("../../assets/data/al-qira-at-al-mawsoo-ah-al-qur-aniyyah.json"),
      "asbab-al-nuzul.json": () => require("../../assets/data/asbab-al-nuzul.json"),
      "mutashabihat/nourquran_hafiz.json": () => require("../../assets/data/mutashabihat/nourquran_hafiz.json"),
    }
  : {};

const nativeTafseerRequires: Record<number, () => any> = Platform.OS !== "web"
  ? Object.fromEntries(
      Array.from({ length: 114 }, (_, i) => i + 1).map((n) => [n, () => {
        // Metro needs static string literals — we use a switch
        return tafseerRequireStatic(n);
      }])
    )
  : {};

const nativeTahrirTanwirRequires: Record<number, () => any> = Platform.OS !== "web"
  ? Object.fromEntries(
      Array.from({ length: 114 }, (_, i) => i + 1).map((n) => [n, () => tahrirTanwirRequireStatic(n)])
    )
  : {};

const nativeQurtubiRequires: Record<number, () => any> = Platform.OS !== "web"
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

const nativeKashshafRequires: Record<number, () => any> = Platform.OS !== "web"
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

const nativeAlusiRequires: Record<number, () => any> = Platform.OS !== "web"
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

const nativeNazamDurarRequires: Record<number, () => any> = Platform.OS !== "web"
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

const nativeRaziRequires: Record<number, () => any> = Platform.OS !== "web"
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

const nativeJalalaynRequires: Record<number, () => any> = Platform.OS !== "web"
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

const nativeJalalaynEnRequires: Record<number, () => any> = Platform.OS !== "web"
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

const nativeAlBahrAlMadidRequires: Record<number, () => any> = Platform.OS !== "web"
  ? Object.fromEntries(
      Array.from({ length: 114 }, (_, i) => i + 1).map((n) => [n, () => alBahrAlMadidRequireStatic(n)])
    )
  : {};

function tafseerRequireStatic(n: number): any {
  // Metro bundler requires static string literals for require() calls.
  // This function is only called on native, never on web.
  switch (n) {
    case 1: return require("../../assets/data/tafseer/1.json");
    case 2: return require("../../assets/data/tafseer/2.json");
    case 3: return require("../../assets/data/tafseer/3.json");
    case 4: return require("../../assets/data/tafseer/4.json");
    case 5: return require("../../assets/data/tafseer/5.json");
    case 6: return require("../../assets/data/tafseer/6.json");
    case 7: return require("../../assets/data/tafseer/7.json");
    case 8: return require("../../assets/data/tafseer/8.json");
    case 9: return require("../../assets/data/tafseer/9.json");
    case 10: return require("../../assets/data/tafseer/10.json");
    case 11: return require("../../assets/data/tafseer/11.json");
    case 12: return require("../../assets/data/tafseer/12.json");
    case 13: return require("../../assets/data/tafseer/13.json");
    case 14: return require("../../assets/data/tafseer/14.json");
    case 15: return require("../../assets/data/tafseer/15.json");
    case 16: return require("../../assets/data/tafseer/16.json");
    case 17: return require("../../assets/data/tafseer/17.json");
    case 18: return require("../../assets/data/tafseer/18.json");
    case 19: return require("../../assets/data/tafseer/19.json");
    case 20: return require("../../assets/data/tafseer/20.json");
    case 21: return require("../../assets/data/tafseer/21.json");
    case 22: return require("../../assets/data/tafseer/22.json");
    case 23: return require("../../assets/data/tafseer/23.json");
    case 24: return require("../../assets/data/tafseer/24.json");
    case 25: return require("../../assets/data/tafseer/25.json");
    case 26: return require("../../assets/data/tafseer/26.json");
    case 27: return require("../../assets/data/tafseer/27.json");
    case 28: return require("../../assets/data/tafseer/28.json");
    case 29: return require("../../assets/data/tafseer/29.json");
    case 30: return require("../../assets/data/tafseer/30.json");
    case 31: return require("../../assets/data/tafseer/31.json");
    case 32: return require("../../assets/data/tafseer/32.json");
    case 33: return require("../../assets/data/tafseer/33.json");
    case 34: return require("../../assets/data/tafseer/34.json");
    case 35: return require("../../assets/data/tafseer/35.json");
    case 36: return require("../../assets/data/tafseer/36.json");
    case 37: return require("../../assets/data/tafseer/37.json");
    case 38: return require("../../assets/data/tafseer/38.json");
    case 39: return require("../../assets/data/tafseer/39.json");
    case 40: return require("../../assets/data/tafseer/40.json");
    case 41: return require("../../assets/data/tafseer/41.json");
    case 42: return require("../../assets/data/tafseer/42.json");
    case 43: return require("../../assets/data/tafseer/43.json");
    case 44: return require("../../assets/data/tafseer/44.json");
    case 45: return require("../../assets/data/tafseer/45.json");
    case 46: return require("../../assets/data/tafseer/46.json");
    case 47: return require("../../assets/data/tafseer/47.json");
    case 48: return require("../../assets/data/tafseer/48.json");
    case 49: return require("../../assets/data/tafseer/49.json");
    case 50: return require("../../assets/data/tafseer/50.json");
    case 51: return require("../../assets/data/tafseer/51.json");
    case 52: return require("../../assets/data/tafseer/52.json");
    case 53: return require("../../assets/data/tafseer/53.json");
    case 54: return require("../../assets/data/tafseer/54.json");
    case 55: return require("../../assets/data/tafseer/55.json");
    case 56: return require("../../assets/data/tafseer/56.json");
    case 57: return require("../../assets/data/tafseer/57.json");
    case 58: return require("../../assets/data/tafseer/58.json");
    case 59: return require("../../assets/data/tafseer/59.json");
    case 60: return require("../../assets/data/tafseer/60.json");
    case 61: return require("../../assets/data/tafseer/61.json");
    case 62: return require("../../assets/data/tafseer/62.json");
    case 63: return require("../../assets/data/tafseer/63.json");
    case 64: return require("../../assets/data/tafseer/64.json");
    case 65: return require("../../assets/data/tafseer/65.json");
    case 66: return require("../../assets/data/tafseer/66.json");
    case 67: return require("../../assets/data/tafseer/67.json");
    case 68: return require("../../assets/data/tafseer/68.json");
    case 69: return require("../../assets/data/tafseer/69.json");
    case 70: return require("../../assets/data/tafseer/70.json");
    case 71: return require("../../assets/data/tafseer/71.json");
    case 72: return require("../../assets/data/tafseer/72.json");
    case 73: return require("../../assets/data/tafseer/73.json");
    case 74: return require("../../assets/data/tafseer/74.json");
    case 75: return require("../../assets/data/tafseer/75.json");
    case 76: return require("../../assets/data/tafseer/76.json");
    case 77: return require("../../assets/data/tafseer/77.json");
    case 78: return require("../../assets/data/tafseer/78.json");
    case 79: return require("../../assets/data/tafseer/79.json");
    case 80: return require("../../assets/data/tafseer/80.json");
    case 81: return require("../../assets/data/tafseer/81.json");
    case 82: return require("../../assets/data/tafseer/82.json");
    case 83: return require("../../assets/data/tafseer/83.json");
    case 84: return require("../../assets/data/tafseer/84.json");
    case 85: return require("../../assets/data/tafseer/85.json");
    case 86: return require("../../assets/data/tafseer/86.json");
    case 87: return require("../../assets/data/tafseer/87.json");
    case 88: return require("../../assets/data/tafseer/88.json");
    case 89: return require("../../assets/data/tafseer/89.json");
    case 90: return require("../../assets/data/tafseer/90.json");
    case 91: return require("../../assets/data/tafseer/91.json");
    case 92: return require("../../assets/data/tafseer/92.json");
    case 93: return require("../../assets/data/tafseer/93.json");
    case 94: return require("../../assets/data/tafseer/94.json");
    case 95: return require("../../assets/data/tafseer/95.json");
    case 96: return require("../../assets/data/tafseer/96.json");
    case 97: return require("../../assets/data/tafseer/97.json");
    case 98: return require("../../assets/data/tafseer/98.json");
    case 99: return require("../../assets/data/tafseer/99.json");
    case 100: return require("../../assets/data/tafseer/100.json");
    case 101: return require("../../assets/data/tafseer/101.json");
    case 102: return require("../../assets/data/tafseer/102.json");
    case 103: return require("../../assets/data/tafseer/103.json");
    case 104: return require("../../assets/data/tafseer/104.json");
    case 105: return require("../../assets/data/tafseer/105.json");
    case 106: return require("../../assets/data/tafseer/106.json");
    case 107: return require("../../assets/data/tafseer/107.json");
    case 108: return require("../../assets/data/tafseer/108.json");
    case 109: return require("../../assets/data/tafseer/109.json");
    case 110: return require("../../assets/data/tafseer/110.json");
    case 111: return require("../../assets/data/tafseer/111.json");
    case 112: return require("../../assets/data/tafseer/112.json");
    case 113: return require("../../assets/data/tafseer/113.json");
    case 114: return require("../../assets/data/tafseer/114.json");
    default: return null;
  }
}

function tahrirTanwirRequireStatic(n: number): any {
  switch (n) {
    case 1: return require("../../assets/data/tafsir-sources/tahrir-tanwir/1.json");
    case 2: return require("../../assets/data/tafsir-sources/tahrir-tanwir/2.json");
    case 3: return require("../../assets/data/tafsir-sources/tahrir-tanwir/3.json");
    case 4: return require("../../assets/data/tafsir-sources/tahrir-tanwir/4.json");
    case 5: return require("../../assets/data/tafsir-sources/tahrir-tanwir/5.json");
    case 6: return require("../../assets/data/tafsir-sources/tahrir-tanwir/6.json");
    case 7: return require("../../assets/data/tafsir-sources/tahrir-tanwir/7.json");
    case 8: return require("../../assets/data/tafsir-sources/tahrir-tanwir/8.json");
    case 9: return require("../../assets/data/tafsir-sources/tahrir-tanwir/9.json");
    case 10: return require("../../assets/data/tafsir-sources/tahrir-tanwir/10.json");
    case 11: return require("../../assets/data/tafsir-sources/tahrir-tanwir/11.json");
    case 12: return require("../../assets/data/tafsir-sources/tahrir-tanwir/12.json");
    case 13: return require("../../assets/data/tafsir-sources/tahrir-tanwir/13.json");
    case 14: return require("../../assets/data/tafsir-sources/tahrir-tanwir/14.json");
    case 15: return require("../../assets/data/tafsir-sources/tahrir-tanwir/15.json");
    case 16: return require("../../assets/data/tafsir-sources/tahrir-tanwir/16.json");
    case 17: return require("../../assets/data/tafsir-sources/tahrir-tanwir/17.json");
    case 18: return require("../../assets/data/tafsir-sources/tahrir-tanwir/18.json");
    case 19: return require("../../assets/data/tafsir-sources/tahrir-tanwir/19.json");
    case 20: return require("../../assets/data/tafsir-sources/tahrir-tanwir/20.json");
    case 21: return require("../../assets/data/tafsir-sources/tahrir-tanwir/21.json");
    case 22: return require("../../assets/data/tafsir-sources/tahrir-tanwir/22.json");
    case 23: return require("../../assets/data/tafsir-sources/tahrir-tanwir/23.json");
    case 24: return require("../../assets/data/tafsir-sources/tahrir-tanwir/24.json");
    case 25: return require("../../assets/data/tafsir-sources/tahrir-tanwir/25.json");
    case 26: return require("../../assets/data/tafsir-sources/tahrir-tanwir/26.json");
    case 27: return require("../../assets/data/tafsir-sources/tahrir-tanwir/27.json");
    case 28: return require("../../assets/data/tafsir-sources/tahrir-tanwir/28.json");
    case 29: return require("../../assets/data/tafsir-sources/tahrir-tanwir/29.json");
    case 30: return require("../../assets/data/tafsir-sources/tahrir-tanwir/30.json");
    case 31: return require("../../assets/data/tafsir-sources/tahrir-tanwir/31.json");
    case 32: return require("../../assets/data/tafsir-sources/tahrir-tanwir/32.json");
    case 33: return require("../../assets/data/tafsir-sources/tahrir-tanwir/33.json");
    case 34: return require("../../assets/data/tafsir-sources/tahrir-tanwir/34.json");
    case 35: return require("../../assets/data/tafsir-sources/tahrir-tanwir/35.json");
    case 36: return require("../../assets/data/tafsir-sources/tahrir-tanwir/36.json");
    case 37: return require("../../assets/data/tafsir-sources/tahrir-tanwir/37.json");
    case 38: return require("../../assets/data/tafsir-sources/tahrir-tanwir/38.json");
    case 39: return require("../../assets/data/tafsir-sources/tahrir-tanwir/39.json");
    case 40: return require("../../assets/data/tafsir-sources/tahrir-tanwir/40.json");
    case 41: return require("../../assets/data/tafsir-sources/tahrir-tanwir/41.json");
    case 42: return require("../../assets/data/tafsir-sources/tahrir-tanwir/42.json");
    case 43: return require("../../assets/data/tafsir-sources/tahrir-tanwir/43.json");
    case 44: return require("../../assets/data/tafsir-sources/tahrir-tanwir/44.json");
    case 45: return require("../../assets/data/tafsir-sources/tahrir-tanwir/45.json");
    case 46: return require("../../assets/data/tafsir-sources/tahrir-tanwir/46.json");
    case 47: return require("../../assets/data/tafsir-sources/tahrir-tanwir/47.json");
    case 48: return require("../../assets/data/tafsir-sources/tahrir-tanwir/48.json");
    case 49: return require("../../assets/data/tafsir-sources/tahrir-tanwir/49.json");
    case 50: return require("../../assets/data/tafsir-sources/tahrir-tanwir/50.json");
    case 51: return require("../../assets/data/tafsir-sources/tahrir-tanwir/51.json");
    case 52: return require("../../assets/data/tafsir-sources/tahrir-tanwir/52.json");
    case 53: return require("../../assets/data/tafsir-sources/tahrir-tanwir/53.json");
    case 54: return require("../../assets/data/tafsir-sources/tahrir-tanwir/54.json");
    case 55: return require("../../assets/data/tafsir-sources/tahrir-tanwir/55.json");
    case 56: return require("../../assets/data/tafsir-sources/tahrir-tanwir/56.json");
    case 57: return require("../../assets/data/tafsir-sources/tahrir-tanwir/57.json");
    case 58: return require("../../assets/data/tafsir-sources/tahrir-tanwir/58.json");
    case 59: return require("../../assets/data/tafsir-sources/tahrir-tanwir/59.json");
    case 60: return require("../../assets/data/tafsir-sources/tahrir-tanwir/60.json");
    case 61: return require("../../assets/data/tafsir-sources/tahrir-tanwir/61.json");
    case 62: return require("../../assets/data/tafsir-sources/tahrir-tanwir/62.json");
    case 63: return require("../../assets/data/tafsir-sources/tahrir-tanwir/63.json");
    case 64: return require("../../assets/data/tafsir-sources/tahrir-tanwir/64.json");
    case 65: return require("../../assets/data/tafsir-sources/tahrir-tanwir/65.json");
    case 66: return require("../../assets/data/tafsir-sources/tahrir-tanwir/66.json");
    case 67: return require("../../assets/data/tafsir-sources/tahrir-tanwir/67.json");
    case 68: return require("../../assets/data/tafsir-sources/tahrir-tanwir/68.json");
    case 69: return require("../../assets/data/tafsir-sources/tahrir-tanwir/69.json");
    case 70: return require("../../assets/data/tafsir-sources/tahrir-tanwir/70.json");
    case 71: return require("../../assets/data/tafsir-sources/tahrir-tanwir/71.json");
    case 72: return require("../../assets/data/tafsir-sources/tahrir-tanwir/72.json");
    case 73: return require("../../assets/data/tafsir-sources/tahrir-tanwir/73.json");
    case 74: return require("../../assets/data/tafsir-sources/tahrir-tanwir/74.json");
    case 75: return require("../../assets/data/tafsir-sources/tahrir-tanwir/75.json");
    case 76: return require("../../assets/data/tafsir-sources/tahrir-tanwir/76.json");
    case 77: return require("../../assets/data/tafsir-sources/tahrir-tanwir/77.json");
    case 78: return require("../../assets/data/tafsir-sources/tahrir-tanwir/78.json");
    case 79: return require("../../assets/data/tafsir-sources/tahrir-tanwir/79.json");
    case 80: return require("../../assets/data/tafsir-sources/tahrir-tanwir/80.json");
    case 81: return require("../../assets/data/tafsir-sources/tahrir-tanwir/81.json");
    case 82: return require("../../assets/data/tafsir-sources/tahrir-tanwir/82.json");
    case 83: return require("../../assets/data/tafsir-sources/tahrir-tanwir/83.json");
    case 84: return require("../../assets/data/tafsir-sources/tahrir-tanwir/84.json");
    case 85: return require("../../assets/data/tafsir-sources/tahrir-tanwir/85.json");
    case 86: return require("../../assets/data/tafsir-sources/tahrir-tanwir/86.json");
    case 87: return require("../../assets/data/tafsir-sources/tahrir-tanwir/87.json");
    case 88: return require("../../assets/data/tafsir-sources/tahrir-tanwir/88.json");
    case 89: return require("../../assets/data/tafsir-sources/tahrir-tanwir/89.json");
    case 90: return require("../../assets/data/tafsir-sources/tahrir-tanwir/90.json");
    case 91: return require("../../assets/data/tafsir-sources/tahrir-tanwir/91.json");
    case 92: return require("../../assets/data/tafsir-sources/tahrir-tanwir/92.json");
    case 93: return require("../../assets/data/tafsir-sources/tahrir-tanwir/93.json");
    case 94: return require("../../assets/data/tafsir-sources/tahrir-tanwir/94.json");
    case 95: return require("../../assets/data/tafsir-sources/tahrir-tanwir/95.json");
    case 96: return require("../../assets/data/tafsir-sources/tahrir-tanwir/96.json");
    case 97: return require("../../assets/data/tafsir-sources/tahrir-tanwir/97.json");
    case 98: return require("../../assets/data/tafsir-sources/tahrir-tanwir/98.json");
    case 99: return require("../../assets/data/tafsir-sources/tahrir-tanwir/99.json");
    case 100: return require("../../assets/data/tafsir-sources/tahrir-tanwir/100.json");
    case 101: return require("../../assets/data/tafsir-sources/tahrir-tanwir/101.json");
    case 102: return require("../../assets/data/tafsir-sources/tahrir-tanwir/102.json");
    case 103: return require("../../assets/data/tafsir-sources/tahrir-tanwir/103.json");
    case 104: return require("../../assets/data/tafsir-sources/tahrir-tanwir/104.json");
    case 105: return require("../../assets/data/tafsir-sources/tahrir-tanwir/105.json");
    case 106: return require("../../assets/data/tafsir-sources/tahrir-tanwir/106.json");
    case 107: return require("../../assets/data/tafsir-sources/tahrir-tanwir/107.json");
    case 108: return require("../../assets/data/tafsir-sources/tahrir-tanwir/108.json");
    case 109: return require("../../assets/data/tafsir-sources/tahrir-tanwir/109.json");
    case 110: return require("../../assets/data/tafsir-sources/tahrir-tanwir/110.json");
    case 111: return require("../../assets/data/tafsir-sources/tahrir-tanwir/111.json");
    case 112: return require("../../assets/data/tafsir-sources/tahrir-tanwir/112.json");
    case 113: return require("../../assets/data/tafsir-sources/tahrir-tanwir/113.json");
    case 114: return require("../../assets/data/tafsir-sources/tahrir-tanwir/114.json");
    default: return null;
  }
}

function alBahrAlMadidRequireStatic(n: number): any {
  switch (n) {
    case 1: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/1.json");
    case 2: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/2.json");
    case 3: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/3.json");
    case 4: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/4.json");
    case 5: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/5.json");
    case 6: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/6.json");
    case 7: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/7.json");
    case 8: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/8.json");
    case 9: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/9.json");
    case 10: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/10.json");
    case 11: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/11.json");
    case 12: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/12.json");
    case 13: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/13.json");
    case 14: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/14.json");
    case 15: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/15.json");
    case 16: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/16.json");
    case 17: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/17.json");
    case 18: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/18.json");
    case 19: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/19.json");
    case 20: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/20.json");
    case 21: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/21.json");
    case 22: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/22.json");
    case 23: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/23.json");
    case 24: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/24.json");
    case 25: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/25.json");
    case 26: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/26.json");
    case 27: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/27.json");
    case 28: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/28.json");
    case 29: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/29.json");
    case 30: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/30.json");
    case 31: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/31.json");
    case 32: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/32.json");
    case 33: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/33.json");
    case 34: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/34.json");
    case 35: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/35.json");
    case 36: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/36.json");
    case 37: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/37.json");
    case 38: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/38.json");
    case 39: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/39.json");
    case 40: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/40.json");
    case 41: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/41.json");
    case 42: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/42.json");
    case 43: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/43.json");
    case 44: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/44.json");
    case 45: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/45.json");
    case 46: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/46.json");
    case 47: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/47.json");
    case 48: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/48.json");
    case 49: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/49.json");
    case 50: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/50.json");
    case 51: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/51.json");
    case 52: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/52.json");
    case 53: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/53.json");
    case 54: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/54.json");
    case 55: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/55.json");
    case 56: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/56.json");
    case 57: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/57.json");
    case 58: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/58.json");
    case 59: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/59.json");
    case 60: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/60.json");
    case 61: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/61.json");
    case 62: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/62.json");
    case 63: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/63.json");
    case 64: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/64.json");
    case 65: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/65.json");
    case 66: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/66.json");
    case 67: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/67.json");
    case 68: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/68.json");
    case 69: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/69.json");
    case 70: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/70.json");
    case 71: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/71.json");
    case 72: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/72.json");
    case 73: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/73.json");
    case 74: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/74.json");
    case 75: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/75.json");
    case 76: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/76.json");
    case 77: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/77.json");
    case 78: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/78.json");
    case 79: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/79.json");
    case 80: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/80.json");
    case 81: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/81.json");
    case 82: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/82.json");
    case 83: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/83.json");
    case 84: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/84.json");
    case 85: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/85.json");
    case 86: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/86.json");
    case 87: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/87.json");
    case 88: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/88.json");
    case 89: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/89.json");
    case 90: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/90.json");
    case 91: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/91.json");
    case 92: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/92.json");
    case 93: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/93.json");
    case 94: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/94.json");
    case 95: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/95.json");
    case 96: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/96.json");
    case 97: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/97.json");
    case 98: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/98.json");
    case 99: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/99.json");
    case 100: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/100.json");
    case 101: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/101.json");
    case 102: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/102.json");
    case 103: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/103.json");
    case 104: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/104.json");
    case 105: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/105.json");
    case 106: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/106.json");
    case 107: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/107.json");
    case 108: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/108.json");
    case 109: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/109.json");
    case 110: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/110.json");
    case 111: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/111.json");
    case 112: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/112.json");
    case 113: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/113.json");
    case 114: return require("../../assets/data/tafsir-sources/al-bahr-al-madid/114.json");
    default: return null;
  }
}

// ─── Fetch cache ────────────────────────────────────────────
// Many importers load the same JSON (quran-data.json is used 4x). Caching
// the in-flight promise dedupes fetches AND lets us pre-warm loads in
// parallel while serialized SQLite inserts run. Cleared on importFinished().
const loadCache = new Map<string, Promise<any>>();
const tafseerCache = new Map<number, Promise<any>>();

function clearImportCaches() {
  loadCache.clear();
  tafseerCache.clear();
}

async function doLoad(filename: string): Promise<any> {
  if (Platform.OS === "web") {
    const resp = await fetch(`/data/${filename}`);
    return resp.json();
  }
  const loader = nativeRequires[filename];
  return loader ? loader() : null;
}

function loadData(filename: string): Promise<any> {
  const cached = loadCache.get(filename);
  if (cached) return cached;
  const p = doLoad(filename);
  loadCache.set(filename, p);
  return p;
}

async function doLoadTafseerFile(surahNumber: number): Promise<any> {
  if (Platform.OS === "web") {
    const resp = await fetch(`/data/tafseer/${surahNumber}.json`);
    return resp.json();
  }
  const loader = nativeTafseerRequires[surahNumber];
  return loader ? loader() : null;
}

function loadTafseerFile(surahNumber: number): Promise<any> {
  const cached = tafseerCache.get(surahNumber);
  if (cached) return cached;
  const p = doLoadTafseerFile(surahNumber);
  tafseerCache.set(surahNumber, p);
  return p;
}

function nativeTafsirSourceLoader(source: TafsirSourceId, surahNumber: number): (() => any) | null {
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

async function doLoadTafsirSourceFile(source: TafsirSourceId, surahNumber: number): Promise<any> {
  if (Platform.OS === "web") {
    const path = `/data/tafsir-sources/${source}/${surahNumber}.json`;
    const DecompressionStreamCtor = (globalThis as any).DecompressionStream;
    if (typeof DecompressionStreamCtor === "function") {
      const compressedResp = await fetch(`${path}.gz`);
      if (compressedResp.ok && compressedResp.body) {
        const stream = compressedResp.body.pipeThrough(new DecompressionStreamCtor("gzip"));
        return new Response(stream).json();
      }
    }
    const resp = await fetch(path);
    return resp.ok ? resp.json() : null;
  }
  const loader = nativeTafsirSourceLoader(source, surahNumber);
  return loader ? loader() : null;
}

// ─── Types & helpers ─────────────────────────────────────────

export type ImportProgress = {
  step: string;
  current: number;
  total: number;
  detail?: string;
};

type ProgressCallback = (progress: ImportProgress) => void;

// Bump this whenever a new import step is added so the progress bar caps at
// 100% and the step counter shows accurate "N / total" labels.
const TOTAL_STEPS = 22;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/** Strip Arabic diacritics (tashkeel) for search-friendly text */
const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0640]/g;
function stripDiacritics(text: string): string {
  return text.replace(ARABIC_DIACRITICS, "");
}

type CanonicalWord = {
  pos: number;
  word: string;
  normalized: string;
  core: string;
};

type SourceWordMatch = {
  parts: string[];
  text: string;
  coreText: string;
};

type MappedWordRow = [number, number, number, string | null, string | null];

// quran-words.com and Da'as use source-local entry indices; map by Arabic
// text to MASAQ's canonical Mushaf word positions before storing them.
function splitArabicParts(text: string | null | undefined): string[] {
  return String(text ?? "")
    .split(/\s+/)
    .map(normalizeArabicWord)
    .filter(Boolean);
}

function arabicVariants(value: string): string[] {
  const core = normalizeArabicCore(value);
  const variants = [value, core];
  if (core.length > 2 && core.startsWith("ا")) variants.push(core.slice(1));
  return Array.from(new Set(variants.filter((v) => v.length > 0)));
}

function compatibleArabicToken(a: string, b: string): boolean {
  const aVariants = arabicVariants(a);
  const bVariants = arabicVariants(b);
  for (const av of aVariants) {
    for (const bv of bVariants) {
      if (av === bv) return true;
      const min = Math.min(av.length, bv.length);
      if (min >= 3 && (av.endsWith(bv) || bv.endsWith(av) || av.startsWith(bv) || bv.startsWith(av))) {
        return true;
      }
    }
  }
  return false;
}

function buildSourceWordMatch(text: string | null | undefined): SourceWordMatch | null {
  const parts = splitArabicParts(text);
  if (parts.length === 0) return null;
  const coreParts = parts.map(normalizeArabicCore);
  return {
    parts,
    text: parts.join(""),
    coreText: coreParts.join(""),
  };
}

function scoreCanonicalSpan(
  canonicalWords: CanonicalWord[],
  start: number,
  end: number,
  source: SourceWordMatch,
): number {
  const span = canonicalWords.slice(start, end);
  if (span.length === 0 || source.parts.length === 0) return -1;

  const spanParts = span.map((w) => w.normalized).filter(Boolean);
  const spanText = spanParts.join("");
  const sourceText = source.text;
  const spanCore = span.map((w) => w.core).join("");
  const sourceCore = source.coreText;

  let score = -1;
  if (
    spanParts.length === source.parts.length &&
    spanParts.every((part, index) => compatibleArabicToken(part, source.parts[index]))
  ) {
    score = 1000;
  } else if (spanText === sourceText) {
    score = 920;
  } else if (spanCore && sourceCore && spanCore === sourceCore) {
    score = 880;
  } else {
    const min = Math.min(spanText.length, sourceText.length);
    if (min >= 4 && (spanText.endsWith(sourceText) || sourceText.endsWith(spanText))) {
      score = 760;
    } else if (min >= 5 && (spanText.includes(sourceText) || sourceText.includes(spanText))) {
      score = 620;
    }
  }

  if (score < 0) return -1;
  score -= Math.abs(spanParts.length - source.parts.length) * 20;
  score -= spanParts.length;
  return score;
}

function findCanonicalSpan(
  canonicalWords: CanonicalWord[],
  source: SourceWordMatch,
  cursor: number,
): { start: number; end: number } | null {
  const sourceParts = source.parts;
  if (canonicalWords.length === 0 || sourceParts.length === 0) return null;

  let best: { start: number; end: number; score: number } | null = null;
  const scan = (from: number) => {
    for (let start = from; start < canonicalWords.length; start++) {
      const maxEnd = Math.min(canonicalWords.length, start + Math.max(sourceParts.length + 2, 3));
      for (let end = start + 1; end <= maxEnd; end++) {
        const score = scoreCanonicalSpan(canonicalWords, start, end, source);
        if (
          score >= 0 &&
          (!best ||
            score > best.score ||
            (score === best.score && start >= cursor && best.start < cursor) ||
            (score === best.score && Math.abs(start - cursor) < Math.abs(best.start - cursor)))
        ) {
          best = { start, end, score };
        }
      }
    }
  };

  scan(Math.max(0, Math.min(cursor, canonicalWords.length - 1)));
  if (!best) scan(0);
  const result = best as { start: number; end: number; score: number } | null;
  return result ? { start: result.start, end: result.end } : null;
}

function appendMappedWordRow(
  rowsByKey: Map<string, MappedWordRow>,
  surah: number,
  ayah: number,
  wordPos: number,
  word: string | null,
  value: string | null,
  valueSeparator: string,
) {
  const key = `${surah}:${ayah}:${wordPos}`;
  const existing = rowsByKey.get(key);
  if (!existing) {
    rowsByKey.set(key, [surah, ayah, wordPos, word, value]);
    return;
  }

  if (word && existing[3] && !existing[3]!.includes(word)) {
    existing[3] = `${existing[3]} / ${word}`;
  } else if (word && !existing[3]) {
    existing[3] = word;
  }

  if (value && existing[4] && !existing[4]!.includes(value)) {
    existing[4] = `${existing[4]}${valueSeparator}${value}`;
  } else if (value && !existing[4]) {
    existing[4] = value;
  }
}

async function loadCanonicalWordsByAyah(db: SQLiteDatabase): Promise<Map<string, CanonicalWord[]>> {
  const rows = await db.getAllAsync<{
    surah: number;
    ayah: number;
    word_pos: number;
    arabic_word: string | null;
  }>(
    "SELECT surah, ayah, word_pos, arabic_word FROM word_irab ORDER BY surah, ayah, word_pos"
  );
  const byAyah = new Map<string, CanonicalWord[]>();
  for (const row of rows) {
    if (!row.arabic_word) continue;
    const key = `${row.surah}:${row.ayah}`;
    let words = byAyah.get(key);
    if (!words) {
      words = [];
      byAyah.set(key, words);
    }
    words.push({
      pos: row.word_pos,
      word: row.arabic_word,
      normalized: normalizeArabicWord(row.arabic_word),
      core: normalizeArabicCore(row.arabic_word),
    });
  }
  return byAyah;
}

function mapRowsToCanonicalWords(
  canonicalByAyah: Map<string, CanonicalWord[]>,
  sourceRows: any[],
  getTargets: (row: any) => string[],
  getValue: (row: any) => string | null,
  valueSeparator: string,
): MappedWordRow[] {
  const cursors = new Map<string, number>();
  const rowsByKey = new Map<string, MappedWordRow>();

  for (const source of sourceRows) {
    const word = source.word ? String(source.word) : null;
    const wordMatch = buildSourceWordMatch(word);
    if (!wordMatch) continue;
    const value = getValue(source);
    const targets = getTargets(source);
    for (const target of targets) {
      const [surah, ayah] = target.split(":").map((n) => parseInt(n, 10));
      if (!Number.isFinite(surah) || !Number.isFinite(ayah)) continue;

      const canonicalWords = canonicalByAyah.get(`${surah}:${ayah}`) ?? [];
      const cursor = cursors.get(target) ?? 0;
      const span = findCanonicalSpan(canonicalWords, wordMatch, cursor);
      if (!span) continue;

      cursors.set(target, span.end);
      for (let index = span.start; index < span.end; index++) {
        appendMappedWordRow(
          rowsByKey,
          surah,
          ayah,
          canonicalWords[index].pos,
          word,
          value,
          valueSeparator,
        );
      }
    }
  }

  return Array.from(rowsByKey.values()).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

async function isPopulated(db: SQLiteDatabase): Promise<boolean> {
  try {
    const result = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM surahs"
    );
    return (result?.count ?? 0) >= 114;
  } catch {
    return false;
  }
}

async function batchInsert(
  db: SQLiteDatabase,
  sql: string,
  rows: any[][],
  batchSize: number = 500
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await db.withTransactionAsync(async () => {
      const stmt = await db.prepareAsync(sql);
      try {
        for (const row of batch) {
          await stmt.executeAsync(row);
        }
      } finally {
        await stmt.finalizeAsync();
      }
    });
  }
}

async function readSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ?",
    [key]
  );
  return row?.value ?? null;
}

async function writeSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
    [key, value]
  );
}

// ─── Import functions ────────────────────────────────────────

async function importSurahs(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const quranData = await loadData("quran-data.json");
  const surahs = quranData.tables.surahs;
  onProgress({ step: "Surahs", current: 1, total: TOTAL_STEPS, detail: `${surahs.length} surahs` });
  console.log(`[Import] Importing ${surahs.length} surahs...`);

  const rows = surahs.map((s: any) => [
    s.number, s.name_arabic, s.name_english, s.ayah_count, s.revelation_type,
  ]);
  await batchInsert(
    db,
    "INSERT OR IGNORE INTO surahs (number, name_arabic, name_english, ayah_count, revelation_type) VALUES (?, ?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] Surahs done: ${surahs.length} rows`);
}

async function importSurahInfo(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const data = await loadData("surah-info.json");
  if (!Array.isArray(data)) throw new Error("Invalid surah-info.json");
  onProgress({ step: "Surah Information", current: 22, total: TOTAL_STEPS, detail: `${data.length} entries` });
  console.log(`[Import] Importing ${data.length} surah_info rows...`);

  const rows = data.map((entry: any) => [
    entry.surah,
    entry.language,
    entry.summary,
    JSON.stringify(Array.isArray(entry.sections) ? entry.sections : []),
    entry.sourceName,
    entry.sourceUrl ?? null,
  ]);
  await batchInsert(
    db,
    "INSERT OR REPLACE INTO surah_info (surah, language, summary, sections_json, source_name, source_url) VALUES (?, ?, ?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] Surah information done: ${rows.length} rows`);
}

async function importQuranText(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const [quranData, qcf2Data] = await Promise.all([
    loadData("quran-data.json"),
    loadData("quran-qcf2.json"),
  ]);
  const texts = quranData.tables.quran_text;
  onProgress({ step: "Quran Text", current: 2, total: TOTAL_STEPS, detail: `${texts.length} ayahs` });
  console.log(`[Import] Importing ${texts.length} quran_text rows...`);

  // Build QCF2 lookup: "surah:ayah" -> { code_v2, v2_page }
  const qcf2Map = new Map<string, { code_v2: string; v2_page: number }>();
  for (const v of qcf2Data) {
    qcf2Map.set(v.verse_key, { code_v2: v.code_v2, v2_page: v.v2_page });
  }

  const rows = texts.map((t: any) => {
    const qcf2 = qcf2Map.get(`${t.surah}:${t.ayah}`);
    return [
      t.surah, t.ayah, t.text_uthmani, t.text_clean,
      qcf2?.code_v2 ?? "", qcf2?.v2_page ?? 0,
      stripDiacritics(t.text_clean),
    ];
  });
  await batchInsert(
    db,
    "INSERT OR IGNORE INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page, text_search) VALUES (?, ?, ?, ?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] Quran text done: ${texts.length} rows`);
}

async function importJuzAndHizb(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const quranData = await loadData("quran-data.json");
  const juzMap = quranData.tables.juz_map;
  const hizbMap = quranData.tables.hizb_map;
  onProgress({ step: "Juz & Hizb Maps", current: 3, total: TOTAL_STEPS, detail: `${juzMap.length} juz + ${hizbMap.length} hizb` });
  console.log(`[Import] Importing ${juzMap.length} juz_map + ${hizbMap.length} hizb_map rows...`);

  const juzRows = juzMap.map((j: any) => [j.juz, j.surah, j.ayah_start, j.ayah_end]);
  await batchInsert(
    db,
    "INSERT INTO juz_map (juz, surah, ayah_start, ayah_end) VALUES (?, ?, ?, ?)",
    juzRows
  );

  const hizbRows = hizbMap.map((h: any) => [
    h.hizb, h.surah_start, h.ayah_start, h.surah_end, h.ayah_end,
  ]);
  await batchInsert(
    db,
    "INSERT INTO hizb_map (hizb, surah_start, ayah_start, surah_end, ayah_end) VALUES (?, ?, ?, ?, ?)",
    hizbRows
  );
  console.log(`[Import] Juz & Hizb done`);
}

async function importWordRoots(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const quranData = await loadData("quran-data.json");
  const roots = quranData.tables.word_roots;
  onProgress({ step: "Word Roots", current: 4, total: TOTAL_STEPS, detail: `${roots.length} words` });
  console.log(`[Import] Importing ${roots.length} word_roots rows...`);

  const rows = roots.map((r: any) => [
    r.surah, r.ayah, r.word_pos, r.word_text, r.root ?? null, r.lemma ?? null,
  ]);
  await batchInsert(
    db,
    "INSERT INTO word_roots (surah, ayah, word_pos, word_text, root, lemma) VALUES (?, ?, ?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] Word roots done: ${roots.length} rows`);
}

async function importTafseer(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  onProgress({ step: "Tafseer", current: 5, total: TOTAL_STEPS, detail: "Al-Muyassar (114 files)" });
  console.log(`[Import] Importing tafseer (muyassar) from 114 files...`);

  // Fetch all 114 files in parallel instead of sequentially.
  const tafseerResults = await Promise.all(
    Array.from({ length: 114 }, (_, i) => loadTafseerFile(i + 1))
  );

  let totalRows = 0;
  const allRows: any[][] = [];
  tafseerResults.forEach((data, idx) => {
    const surahNum = idx + 1;
    const ayahs = data.ayahs || data;
    for (const entry of ayahs) {
      allRows.push([entry.surah ?? surahNum, entry.ayah, "muyassar", entry.text]);
    }
    totalRows += ayahs.length;
  });

  await batchInsert(
    db,
    "INSERT OR IGNORE INTO tafseer (surah, ayah, source, text) VALUES (?, ?, ?, ?)",
    allRows
  );
  console.log(`[Import] Tafseer (muyassar) done: ${totalRows} rows`);
}

async function importZilal(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  onProgress({ step: "Tafseer", current: 6, total: TOTAL_STEPS, detail: "Fi Zilal al-Quran" });
  console.log(`[Import] Importing tafseer (zilal)...`);

  const zilalData = await loadData("zilal.json");
  const allRows: any[][] = [];
  const data = zilalData.data;
  for (const surahNum of Object.keys(data)) {
    const surah = data[surahNum];
    if (!surah?.ayahs) continue;
    for (const ayahNum of Object.keys(surah.ayahs)) {
      const entry = surah.ayahs[ayahNum];
      if (!entry?.tafsir || entry.tafsir.trim() === "") continue;
      allRows.push([parseInt(surahNum), parseInt(ayahNum), "zilal", entry.tafsir]);
    }
  }

  await batchInsert(
    db,
    "INSERT OR IGNORE INTO tafseer (surah, ayah, source, text) VALUES (?, ?, ?, ?)",
    allRows
  );
  console.log(`[Import] Tafseer (zilal) done: ${allRows.length} rows`);
}

async function importSurahRowTafsirSource(
  db: SQLiteDatabase,
  source: TafsirSourceConfig,
  onProgress: ProgressCallback
): Promise<number> {
  onProgress({ step: "Tafseer", current: 7, total: TOTAL_STEPS, detail: source.progressDetail });
  console.log(`[Import] Importing tafseer (${source.id}) from 114 surah files...`);

  let inserted = 0;
  for (let surahNumber = 1; surahNumber <= 114; surahNumber++) {
    const data = await doLoadTafsirSourceFile(source.id, surahNumber);
    if (!Array.isArray(data)) continue;
    const rows: any[][] = [];
    for (const row of data) {
      const surah = Array.isArray(row) ? row[0] : row?.surah;
      const ayah = Array.isArray(row) ? row[1] : row?.ayah;
      const text = Array.isArray(row) ? row[2] : row?.text;
      if (!Number.isInteger(surah) || !Number.isInteger(ayah)) continue;
      const cleanText = stripHtml(String(text ?? ""));
      if (cleanText.length === 0) continue;
      rows.push([surah, ayah, source.id, cleanText]);
    }
    await batchInsert(
      db,
      "INSERT OR REPLACE INTO tafseer (surah, ayah, source, text) VALUES (?, ?, ?, ?)",
      rows
    );
    inserted += rows.length;
  }

  console.log(`[Import] Tafseer (${source.id}) done: ${inserted} rows`);
  return inserted;
}

export async function ensureTafsirSourceImported(
  db: SQLiteDatabase,
  sourceId: TafsirSourceId
): Promise<void> {
  const source = TAFSIR_SOURCES.find((item) => item.id === sourceId);
  if (!source || source.importKind !== "surahRows") return;

  const sourceCount = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM tafseer WHERE source = ?",
    [source.id]
  );
  if ((sourceCount?.count ?? 0) >= (source.expectedRows ?? 6236)) return;

  await db.runAsync("DELETE FROM tafseer WHERE source = ?", [source.id]);
  const inserted = await importSurahRowTafsirSource(db, source, () => {});
  if (inserted === 0) {
    throw new Error(`Tafsir source ${source.id} is unavailable`);
  }
}

async function importConfiguredTafsirSources(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  for (const source of SURAH_ROW_TAFSIR_SOURCES) {
    await importSurahRowTafsirSource(db, source, onProgress);
  }
}

async function importTranslations(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  onProgress({ step: "Translations", current: 8, total: TOTAL_STEPS, detail: "Sahih International" });
  console.log(`[Import] Importing translations...`);

  const translationData = await loadData("translation-sahih.json");
  const allRows: any[][] = [];
  // translation-sahih.json is an array of 114 surah objects
  for (const surah of translationData) {
    for (const verse of surah.verses) {
      allRows.push([surah.id, verse.id, verse.translation]);
    }
  }

  await batchInsert(
    db,
    "INSERT OR IGNORE INTO translations (surah, ayah, text_en) VALUES (?, ?, ?)",
    allRows
  );
  console.log(`[Import] Translations done: ${allRows.length} rows`);
}

async function importPageMap(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const pageMapData = await loadData("page-map.json");
  onProgress({ step: "Page Map", current: 9, total: TOTAL_STEPS, detail: "604 pages" });
  console.log(`[Import] Importing ${pageMapData.length} page_map rows...`);

  const rows = pageMapData.map((p: any) => [
    p.page,
    p.start.surah_number,
    p.start.verse,
    p.end.surah_number,
    p.end.verse,
  ]);
  await batchInsert(
    db,
    "INSERT OR IGNORE INTO page_map (page, surah_start, ayah_start, surah_end, ayah_end) VALUES (?, ?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] Page map done: ${pageMapData.length} rows`);
}

async function importWordTranslations(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const wbwData = await loadData("wbw/wbw.json");
  onProgress({ step: "Word-by-Word", current: 10, total: TOTAL_STEPS, detail: `${wbwData.length} words` });
  console.log(`[Import] Importing ${wbwData.length} word_translations rows...`);

  const rows = wbwData.map((w: any) => [
    w.surah_number,
    w.ayah_number,
    w.word_number,
    null, // word_arabic (not in this dataset, will come from word_roots)
    stripHtml(w.text),
    null, // transliteration (not in this dataset)
  ]);
  await batchInsert(
    db,
    "INSERT OR IGNORE INTO word_translations (surah, ayah, word_pos, word_arabic, translation_en, transliteration) VALUES (?, ?, ?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] Word translations done: ${wbwData.length} rows`);
}

async function importWordIrab(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const masaqData = await loadData("masaq/masaq-aggregated.json");
  onProgress({ step: "Grammar (إعراب)", current: 11, total: TOTAL_STEPS, detail: `${masaqData.length} words` });
  console.log(`[Import] Importing ${masaqData.length} word_irab rows...`);

  const rows = masaqData.map((m: any) => [
    m.surah,
    m.ayah,
    m.word_pos,
    m.arabic_word ?? null,
    m.morphological_tag ?? null,
    m.syntactic_function ?? null,
    null, // root (not in aggregated MASAQ)
    null, // lemma
    null, // pattern
  ]);
  await batchInsert(
    db,
    "INSERT OR IGNORE INTO word_irab (surah, ayah, word_pos, arabic_word, morphological_tag, syntactic_function, root, lemma, pattern) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] Word irab done: ${masaqData.length} rows`);
}

async function importPageLines(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const pageLinesData = await loadData("layout/page-lines.json");
  onProgress({ step: "Page Layout", current: 13, total: TOTAL_STEPS, detail: `${pageLinesData.length} lines` });
  console.log(`[Import] Importing ${pageLinesData.length} page_lines rows...`);

  const rows = pageLinesData.map((l: any) => [
    l.page_number,
    l.line_number,
    l.line_type,
    l.is_centered,
    l.first_word_id === "" ? null : l.first_word_id,
    l.last_word_id === "" ? null : l.last_word_id,
    l.surah_number === "" ? null : l.surah_number,
  ]);
  await batchInsert(
    db,
    "INSERT OR IGNORE INTO page_lines (page_number, line_number, line_type, is_centered, first_word_id, last_word_id, surah_number) VALUES (?, ?, ?, ?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] Page lines done: ${pageLinesData.length} rows`);
}

async function importTajweed(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const tajweedData = await loadData("tajweed.json");
  onProgress({ step: "Tajweed Rules", current: 12, total: TOTAL_STEPS, detail: `${tajweedData.length} ayahs` });
  console.log(`[Import] Importing tajweed rules...`);

  const allRows: any[][] = [];
  for (const ayah of tajweedData) {
    if (ayah.annotations) {
      for (const ann of ayah.annotations) {
        allRows.push([ayah.surah, ayah.ayah, ann.rule, ann.start, ann.end]);
      }
    }
  }

  await batchInsert(
    db,
    "INSERT INTO tajweed_rules (surah, ayah, rule, start_offset, end_offset) VALUES (?, ?, ?, ?, ?)",
    allRows
  );
  console.log(`[Import] Tajweed done: ${allRows.length} rows`);
}

// ─── New tab dataset importers ───────────────────────────────

async function importWordMeaningsAr(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const data = await loadData("wbw-arabic-meanings.json");
  if (!Array.isArray(data)) return;
  onProgress({ step: "Arabic Meanings", current: 14, total: TOTAL_STEPS, detail: `${data.length} words` });
  console.log(`[Import] Importing ${data.length} word_meanings_ar rows with canonical word mapping...`);

  const canonicalByAyah = await loadCanonicalWordsByAyah(db);
  const rows = mapRowsToCanonicalWords(
    canonicalByAyah,
    data,
    (w) => [`${w.surah}:${w.ayah}`],
    (w) => w.meaning ? String(w.meaning) : null,
    "\n\n",
  );
  await batchInsert(
    db,
    "INSERT OR REPLACE INTO word_meanings_ar (surah, ayah, word_pos, word, meaning) VALUES (?, ?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] word_meanings_ar done: ${rows.length} canonical rows`);
}

async function importWordIrabDaas(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const data = await loadData("irab-per-word.json");
  if (!Array.isArray(data)) return;
  onProgress({ step: "Da'as Iʿrab", current: 15, total: TOTAL_STEPS, detail: `${data.length} words` });
  console.log(`[Import] Importing ${data.length} word_irab_daas rows (expanding ayah_group)...`);

  const canonicalByAyah = await loadCanonicalWordsByAyah(db);
  const rows = mapRowsToCanonicalWords(
    canonicalByAyah,
    data,
    (w) =>
      Array.isArray(w.ayah_group) && w.ayah_group.length > 0
        ? w.ayah_group.map(String)
        : [`${w.surah}:${w.ayah}`],
    (w) => w.irab ? stripHtml(String(w.irab)) : null,
    "\n",
  );
  await batchInsert(
    db,
    "INSERT OR REPLACE INTO word_irab_daas (surah, ayah, word_pos, word, irab) VALUES (?, ?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] word_irab_daas done: ${rows.length} canonical rows (from ${data.length} source entries)`);
}

async function importTajweedRulesAr(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const data = await loadData("tajweed-rules-ar.json");
  if (!data || typeof data !== "object") return;
  const keys = Object.keys(data).filter((k) => !k.startsWith("_"));
  onProgress({ step: "Tajweed (AR)", current: 16, total: TOTAL_STEPS, detail: `${keys.length} rules` });
  console.log(`[Import] Importing ${keys.length} tajweed_rules_ar rows...`);

  const rows = keys.map((key) => {
    const v = (data as any)[key] ?? {};
    return [key, v.name_ar ?? null, v.short_ar ?? null, v.description_ar ?? null];
  });
  await batchInsert(
    db,
    "INSERT OR REPLACE INTO tajweed_rules_ar (rule_key, name_ar, short_ar, description_ar) VALUES (?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] tajweed_rules_ar done: ${rows.length} rows`);
}

async function importTajweedRulesEn(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const data = await loadData("tajweed-rules-en.json");
  if (!data || typeof data !== "object") return;
  const keys = Object.keys(data).filter((k) => !k.startsWith("_"));
  onProgress({ step: "Tajweed (EN)", current: 17, total: TOTAL_STEPS, detail: `${keys.length} rules` });
  console.log(`[Import] Importing ${keys.length} tajweed_rules_en rows...`);

  const rows = keys.map((key) => {
    const v = (data as any)[key] ?? {};
    return [key, v.name ?? null, v.name_ar ?? null, v.short ?? null, v.description ?? null];
  });
  await batchInsert(
    db,
    "INSERT OR REPLACE INTO tajweed_rules_en (rule_key, name, name_ar, short, description) VALUES (?, ?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] tajweed_rules_en done: ${rows.length} rows`);
}

async function importQiraatEncyclopedia(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const data = await loadData("al-qira-at-al-mawsoo-ah-al-qur-aniyyah.json");
  if (!data || typeof data !== "object") return;
  onProgress({ step: "Qiraʾat", current: 18, total: TOTAL_STEPS, detail: "…" });
  console.log(`[Import] Building qiraat_encyclopedia rows...`);

  // Two pass: first collect object entries (with text). Second pass: resolve string refs.
  type Entry = { text: string; group: string[] };
  const objects = new Map<string, Entry>();
  const refs: Array<[string, string]> = [];

  for (const key of Object.keys(data)) {
    const v = (data as any)[key];
    if (typeof v === "string") {
      refs.push([key, v]);
    } else if (v && typeof v === "object" && typeof v.text === "string") {
      const group = Array.isArray(v.ayah_keys) && v.ayah_keys.length > 0
        ? v.ayah_keys.map(String)
        : [key];
      const plain = stripHtml(v.text);
      objects.set(key, { text: plain, group });
    }
  }

  // Rows for object entries — insert one row per key in ayah_keys (or just the entry key if no group)
  const rowsByKey = new Map<string, [number, number, string, string]>();
  for (const [key, entry] of objects) {
    const { text, group } = entry;
    const groupJson = JSON.stringify(group);
    for (const k of group) {
      const [s, a] = k.split(":").map((n) => parseInt(n, 10));
      if (Number.isFinite(s) && Number.isFinite(a)) {
        rowsByKey.set(k, [s, a, text, groupJson]);
      }
    }
    // Also make sure the primary key itself is present even if ayah_keys was empty
    const [sk, ak] = key.split(":").map((n) => parseInt(n, 10));
    if (Number.isFinite(sk) && Number.isFinite(ak) && !rowsByKey.has(key)) {
      rowsByKey.set(key, [sk, ak, text, groupJson]);
    }
  }

  // String refs: resolve to the target's text + group
  for (const [key, target] of refs) {
    const resolved = rowsByKey.get(target);
    if (!resolved) continue;
    const [sk, ak] = key.split(":").map((n) => parseInt(n, 10));
    if (!Number.isFinite(sk) || !Number.isFinite(ak)) continue;
    rowsByKey.set(key, [sk, ak, resolved[2], resolved[3]]);
  }

  const rows = Array.from(rowsByKey.values());
  await batchInsert(
    db,
    "INSERT OR REPLACE INTO qiraat_encyclopedia (surah, ayah, text, ayah_group) VALUES (?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] qiraat_encyclopedia done: ${rows.length} rows`);
}

async function importAsbabAlNuzul(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const data = await loadData("asbab-al-nuzul.json");
  if (!data || typeof data !== "object" || data.schema_version !== "1.0") {
    throw new Error("Unsupported asbab_al_nuzul schema_version");
  }
  const source = typeof data.source?.repository === "string"
    ? data.source.repository
    : "asbab-al-nuzul-dataset";
  const rows = (Array.isArray(data.rows) ? data.rows : [])
    .map((row: any) => {
      const surah = Number(row.surah);
      const ayah = Number(row.ayah);
      const occasions = Array.isArray(row.occasions)
        ? row.occasions.map((text: unknown) => stripHtml(String(text ?? "")).trim()).filter(Boolean)
        : [];
      const ayahGroup = Array.isArray(row.ayah_group) ? row.ayah_group.map(String) : [`${surah}:${ayah}`];
      if (!Number.isInteger(surah) || !Number.isInteger(ayah) || occasions.length === 0) return null;
      return [surah, ayah, JSON.stringify(occasions), JSON.stringify(ayahGroup), source];
    })
    .filter(Boolean) as any[][];

  onProgress({
    step: "Asbab al-Nuzul",
    current: 19,
    total: TOTAL_STEPS,
    detail: `${rows.length} ayahs`,
  });

  await batchInsert(
    db,
    "INSERT OR REPLACE INTO asbab_al_nuzul (surah, ayah, occasions_json, ayah_group, source) VALUES (?, ?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] asbab_al_nuzul done: ${rows.length} rows`);
}

async function importMutashabihat(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const data = await loadData("mutashabihat/nourquran_hafiz.json");
  if (!data || typeof data !== "object" || data.schema_version !== "1.0") {
    throw new Error("Unsupported Nour Quran mutashabihat schema_version");
  }

  const similarGroups = Array.isArray(data.similar_groups) ? data.similar_groups : [];
  const tailGroups = Array.isArray(data.tail_groups) ? data.tail_groups : [];
  onProgress({
    step: "Mutashabihat",
    current: 20,
    total: TOTAL_STEPS,
    detail: `${similarGroups.length} similar + ${tailGroups.length} tails`,
  });

  const groupRows: any[][] = [];
  const refRows: any[][] = [];
  let sortOrder = 0;

  const appendGroups = (groups: any[], kind: "similar" | "tail") => {
    for (const group of groups) {
      const refs = Array.isArray(group.refs) ? group.refs : [];
      const validRefs = refs.filter((ref: any) => Number.isInteger(ref.surah) && Number.isInteger(ref.ayah));
      if (validRefs.length < 2) continue;

      const id = typeof group.id === "string" ? group.id : null;
      const cue = kind === "similar" ? group.phrase : group.tail;
      if (!id || typeof cue !== "string" || cue.trim().length === 0) continue;

      groupRows.push([id, kind, cue.trim(), String(group.source ?? data.source?.name ?? "nourquran"), sortOrder++]);
      validRefs.forEach((ref: any, index: number) => {
        refRows.push([
          id,
          index,
          ref.surah,
          ref.ayah,
          typeof ref.surah_name_ar === "string" ? ref.surah_name_ar : null,
          typeof ref.tail_5 === "string" ? ref.tail_5 : null,
          kind === "similar" && typeof ref.pre_text === "string" ? ref.pre_text : null,
          kind === "similar" && typeof ref.similar_text === "string" ? ref.similar_text : null,
          kind === "similar" && typeof ref.post_text === "string" ? ref.post_text : null,
        ]);
      });
    }
  };

  appendGroups(similarGroups, "similar");
  appendGroups(tailGroups, "tail");

  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM mutashabihat_refs");
    await db.runAsync("DELETE FROM mutashabihat_groups");
  });

  await batchInsert(
    db,
    "INSERT OR REPLACE INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES (?, ?, ?, ?, ?)",
    groupRows
  );
  await batchInsert(
    db,
    "INSERT OR REPLACE INTO mutashabihat_refs (group_id, sort_order, surah, ayah, surah_name_ar, tail_5, pre_text, similar_text, post_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    refRows
  );

  console.log(`[Import] mutashabihat done: ${groupRows.length} groups + ${refRows.length} refs`);
}

async function importReflectionJourneyLevels(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  const [seedData, quranData, storedFingerprint, existingCountRow] = await Promise.all([
    loadData("reflection-journey.json"),
    loadData("quran-data.json"),
    readSetting(db, "reflection_journey_content_fingerprint"),
    db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM reflection_journey_levels"),
  ]);

  const ayahCountIndex = buildAyahCountIndex(quranData);
  const parsed = loadAndValidateReflectionJourneySeed(seedData, ayahCountIndex);
  const fingerprint = computeReflectionJourneyFingerprint(parsed);
  const existingCount = existingCountRow?.count ?? 0;
  const shouldReimport =
    storedFingerprint !== fingerprint || existingCount !== parsed.levels.length;

  onProgress({
    step: "Reflection Journey",
    current: 21,
    total: TOTAL_STEPS,
    detail: `${parsed.levels.length} levels`,
  });

  if (!shouldReimport) {
    return;
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM reflection_journey_levels");

    if (parsed.levels.length > 0) {
      const stmt = await db.prepareAsync(
        `INSERT INTO reflection_journey_levels
          (id, slug, order_index, title_en, title_ar, summary_en, summary_ar, response_prompt_en, response_prompt_ar, estimated_minutes, content_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      try {
        for (const level of parsed.levels) {
          await stmt.executeAsync([
            level.id,
            level.slug,
            level.order,
            level.title.en,
            level.title.ar,
            level.summary?.en ?? null,
            level.summary?.ar ?? null,
            level.responsePrompt.en,
            level.responsePrompt.ar,
            level.estimatedMinutes ?? null,
            JSON.stringify(level.blocks),
          ]);
        }
      } finally {
        await stmt.finalizeAsync();
      }
    }

    await writeSetting(db, "reflection_journey_content_fingerprint", fingerprint);
  });

  console.log(`[Import] Reflection Journey done: ${parsed.levels.length} levels`);
}

async function runNewTabImports(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  // Idempotent: only import tables that are empty. Safe to call on fresh
  // installs and existing installs alike. Wrap each in try/catch so a
  // single bad dataset doesn't block the rest.
  const tableExists = async (table: string): Promise<boolean> => {
    try {
      await db.getFirstAsync(`SELECT 1 FROM ${table} LIMIT 1`);
      return true;
    } catch {
      return false;
    }
  };

  const safeCount = async (table: string): Promise<number> => {
    try {
      const r = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) as c FROM ${table}`);
      return r?.c ?? 0;
    } catch {
      return 0;
    }
  };

  const safeImport = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      console.error(`[Import] ${label} failed:`, e);
    }
  };

  if (await tableExists("word_meanings_ar")) {
    const staleMeaningAtSourcePos = await db.getFirstAsync<{ word: string | null }>(
      "SELECT word FROM word_meanings_ar WHERE surah = 2 AND ayah = 255 AND word_pos = 1"
    );
    const missingCanonicalMeaning = await db.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) as c FROM word_meanings_ar WHERE surah = 2 AND ayah = 255 AND word_pos = 6"
    );
    const stale =
      !!staleMeaningAtSourcePos?.word ||
      (await safeCount("word_meanings_ar")) > 0 && (missingCanonicalMeaning?.c ?? 0) === 0;
    if (stale) {
      console.log("[Import] word_meanings_ar: stale source-position data detected — re-importing");
      await db.execAsync("DELETE FROM word_meanings_ar");
    }
  }
  if ((await safeCount("word_meanings_ar")) === 0) {
    await safeImport("word_meanings_ar", () => importWordMeaningsAr(db, onProgress));
  }

  // Detect old Da'as data. Earlier imports copied source positions directly,
  // so grouped Fatiha rows made 1:2 word 1 point at "اسْمَ" instead of
  // "الْحَمْدُ". Rebuild with canonical MASAQ word positions.
  if (await tableExists("word_irab_daas")) {
    const staleFatihaRow = await db.getFirstAsync<{ word: string | null }>(
      "SELECT word FROM word_irab_daas WHERE surah = 1 AND ayah = 2 AND word_pos = 1"
    );
    const c11 = await db.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) as c FROM word_irab_daas WHERE surah = 1 AND ayah = 1"
    );
    const stale =
      ((c11?.c ?? 0) > 0 && staleFatihaRow?.word == null) ||
      (staleFatihaRow?.word != null && normalizeArabicWord(staleFatihaRow.word) !== normalizeArabicWord("الْحَمْدُ")) ||
      ((c11?.c ?? 0) > 0 && (await safeCount("word_irab_daas")) < 1000);
    if (stale) {
      console.log("[Import] word_irab_daas: stale source-position data detected — re-importing");
      await db.execAsync("DELETE FROM word_irab_daas");
    }
  }
  if ((await safeCount("word_irab_daas")) === 0) {
    await safeImport("word_irab_daas", () => importWordIrabDaas(db, onProgress));
  }

  if ((await safeCount("tajweed_rules_ar")) === 0) {
    await safeImport("tajweed_rules_ar", () => importTajweedRulesAr(db, onProgress));
  }
  if ((await safeCount("tajweed_rules_en")) === 0) {
    await safeImport("tajweed_rules_en", () => importTajweedRulesEn(db, onProgress));
  }
  if ((await safeCount("qiraat_encyclopedia")) === 0) {
    await safeImport("qiraat_encyclopedia", () => importQiraatEncyclopedia(db, onProgress));
  }
  if ((await safeCount("asbab_al_nuzul")) === 0) {
    await safeImport("asbab_al_nuzul", () => importAsbabAlNuzul(db, onProgress));
  }
  const missingMutashabihatSegments = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c
       FROM mutashabihat_refs r
       JOIN mutashabihat_groups g ON g.id = r.group_id
      WHERE g.kind = 'similar'
        AND TRIM(COALESCE(r.similar_text, '')) = ''`
  ).catch(() => ({ c: 0 }));
  if (
    (await safeCount("mutashabihat_groups")) === 0 ||
    (await safeCount("mutashabihat_refs")) === 0 ||
    (missingMutashabihatSegments?.c ?? 0) > 0
  ) {
    await safeImport("mutashabihat", () => importMutashabihat(db, onProgress));
  }
  if (Platform.OS !== "web") {
    await safeImport("reflection_journey_levels", () => importReflectionJourneyLevels(db, onProgress));
  }
}

async function ensureQfUserSyncSchema(db: SQLiteDatabase): Promise<void> {
  try { await db.execAsync("ALTER TABLE bookmarks ADD COLUMN updated_at TEXT"); } catch (_) {}
  try { await db.execAsync("ALTER TABLE bookmarks ADD COLUMN deleted_at TEXT"); } catch (_) {}
  try { await db.execAsync("ALTER TABLE bookmarks ADD COLUMN qf_bookmark_id TEXT"); } catch (_) {}
  try { await db.execAsync("ALTER TABLE bookmarks ADD COLUMN qf_synced_at TEXT"); } catch (_) {}
  try { await db.execAsync("ALTER TABLE bookmarks ADD COLUMN qf_sync_error TEXT"); } catch (_) {}
  try { await db.execAsync("ALTER TABLE bookmarks ADD COLUMN qf_is_in_default_collection INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
  try { await db.execAsync("ALTER TABLE bookmarks ADD COLUMN qf_collections_count INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
  await db.execAsync("UPDATE bookmarks SET updated_at = created_at WHERE updated_at IS NULL");

  try { await db.execAsync("ALTER TABLE study_cards ADD COLUMN updated_at TEXT"); } catch (_) {}
  try { await db.execAsync("ALTER TABLE study_cards ADD COLUMN suspended_at TEXT"); } catch (_) {}
  try { await db.execAsync("ALTER TABLE study_cards ADD COLUMN buried_until TEXT"); } catch (_) {}
  try { await db.execAsync("ALTER TABLE study_cards ADD COLUMN marked_at TEXT"); } catch (_) {}
  await db.execAsync("UPDATE study_cards SET updated_at = created_at WHERE updated_at IS NULL");

  try { await db.execAsync("ALTER TABLE private_notes ADD COLUMN updated_at TEXT"); } catch (_) {}
  await db.execAsync("UPDATE private_notes SET updated_at = created_at WHERE updated_at IS NULL");
  try { await db.execAsync("ALTER TABLE private_notes ADD COLUMN qf_note_id TEXT"); } catch (_) {}
  try { await db.execAsync("ALTER TABLE private_notes ADD COLUMN qf_synced_at TEXT"); } catch (_) {}
  try { await db.execAsync("ALTER TABLE private_notes ADD COLUMN qf_sync_error TEXT"); } catch (_) {}
  try { await db.execAsync("ALTER TABLE private_notes ADD COLUMN qf_ranges_json TEXT"); } catch (_) {}

  try { await db.execAsync("ALTER TABLE reflection_journey_entries ADD COLUMN updated_at TEXT"); } catch (_) {}
  await db.execAsync("UPDATE reflection_journey_entries SET updated_at = created_at WHERE updated_at IS NULL");

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS qf_sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('bookmark', 'private_note')),
      operation TEXT NOT NULL CHECK (operation IN ('UPSERT', 'DELETE')),
      local_id TEXT NOT NULL,
      data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      synced_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_qf_sync_queue_status ON qf_sync_queue(status, id);
    CREATE INDEX IF NOT EXISTS idx_qf_sync_queue_local ON qf_sync_queue(entity_type, local_id);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_updated ON bookmarks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_qf_id ON bookmarks(qf_bookmark_id);
    CREATE INDEX IF NOT EXISTS idx_private_notes_qf_id ON private_notes(qf_note_id);
  `);
}

// ─── Main initialization ─────────────────────────────────────

export async function initializeDatabase(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  console.log("[Import] Creating schema...");
  await createSchema(db);
  await migrateUserSchema(db);
  await ensureQfUserSyncSchema(db);

  const populated = await isPopulated(db);
  if (populated) {
    // Check if page_lines needs migration (added after initial import)
    const plCount = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM page_lines"
    );
    if ((plCount?.count ?? 0) === 0) {
      console.log("[Import] Migrating: importing page_lines...");
      await importPageLines(db, onProgress);
    }

    // Ensure QCF2 columns exist (added after initial import)
    try { await db.execAsync("ALTER TABLE quran_text ADD COLUMN text_qcf2 TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    try { await db.execAsync("ALTER TABLE quran_text ADD COLUMN v2_page INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

    // Check if QCF2 data needs populating or updating (word grouping fix)
    const qcf2Check = await db.getFirstAsync<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM quran_text WHERE text_qcf2 != ''"
    );
    // Detect old char-level splitting: verse 66:1 has 17 individual PUA chars
    // but should have 15 word groups (2 words use 2 PUA chars each).
    const needsQcf2Rewrite = (qcf2Check?.cnt ?? 0) > 0
      ? await db.getFirstAsync<{ text_qcf2: string }>(
          "SELECT text_qcf2 FROM quran_text WHERE surah = 66 AND ayah = 1"
        ).then(row => {
          const tokens = (row?.text_qcf2 ?? "").split(/\s+/).filter(Boolean).length;
          return tokens === 17; // old data has 17 individual chars; correct data has 15 word groups
        })
      : false;

    if ((qcf2Check?.cnt ?? 0) === 0 || needsQcf2Rewrite) {
      console.log("[Import] Migrating: populating QCF2 text data...");
      const qcf2Data = await loadData("quran-qcf2.json");
      const qcf2Map = new Map<string, { code_v2: string; v2_page: number }>();
      for (const v of qcf2Data) {
        qcf2Map.set(v.verse_key, { code_v2: v.code_v2, v2_page: v.v2_page });
      }
      const updateRows: any[][] = [];
      for (const [key, val] of qcf2Map) {
        const [s, a] = key.split(":");
        updateRows.push([val.code_v2, val.v2_page, parseInt(s), parseInt(a)]);
      }
      await batchInsert(
        db,
        "UPDATE quran_text SET text_qcf2 = ?, v2_page = ? WHERE surah = ? AND ayah = ?",
        updateRows
      );
      console.log(`[Import] QCF2 migration done: ${updateRows.length} rows updated`);
    }

    // Migrate tafseer table to multi-source schema if needed
    try {
      // Check if source column exists by trying to select it
      let hasSource = false;
      try {
        await db.getFirstAsync("SELECT source FROM tafseer LIMIT 1");
        hasSource = true;
      } catch (_) {
        hasSource = false;
      }
      if (!hasSource) {
        console.log("[Import] Migrating tafseer table to multi-source schema...");
        await db.execAsync(`
          CREATE TABLE tafseer_new (
            surah INTEGER NOT NULL,
            ayah INTEGER NOT NULL,
            source TEXT NOT NULL DEFAULT 'muyassar',
            text TEXT NOT NULL,
            PRIMARY KEY (surah, ayah, source)
          );
          INSERT INTO tafseer_new (surah, ayah, source, text)
            SELECT surah, ayah, 'muyassar', text FROM tafseer;
          DROP TABLE tafseer;
          ALTER TABLE tafseer_new RENAME TO tafseer;
          CREATE INDEX IF NOT EXISTS idx_tafseer_source ON tafseer(source);
        `);
        console.log("[Import] Tafseer migration done.");
      }
    } catch (e) {
      console.warn("[Import] Tafseer migration check:", e);
    }

    // Import zilal if not yet imported
    const zilalCount = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM tafseer WHERE source = 'zilal'"
    );
    if ((zilalCount?.count ?? 0) === 0) {
      console.log("[Import] Importing zilal tafseer...");
      await importZilal(db, onProgress);
    }

    if (Platform.OS !== "web") {
      for (const source of SURAH_ROW_TAFSIR_SOURCES) {
        const sourceCount = await db.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) as count FROM tafseer WHERE source = ?",
          [source.id]
        );
        if ((sourceCount?.count ?? 0) < (source.expectedRows ?? 6236)) {
          console.log(`[Import] Importing ${source.id} tafseer...`);
          await db.runAsync("DELETE FROM tafseer WHERE source = ?", [source.id]);
          await importSurahRowTafsirSource(db, source, onProgress);
        }
      }
    }

    // Add text_search column for diacritics-stripped search (Phase 4 migration)
    try { await db.execAsync("ALTER TABLE quran_text ADD COLUMN text_search TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    const searchCheck = await db.getFirstAsync<{ text_search: string }>(
      "SELECT text_search FROM quran_text WHERE surah = 1 AND ayah = 1"
    );
    if (!searchCheck?.text_search) {
      console.log("[Import] Migrating: populating text_search column...");
      const allTexts = await db.getAllAsync<{ surah: number; ayah: number; text_clean: string }>(
        "SELECT surah, ayah, text_clean FROM quran_text"
      );
      const updateRows = allTexts.map(t => [stripDiacritics(t.text_clean), t.surah, t.ayah]);
      await batchInsert(
        db,
        "UPDATE quran_text SET text_search = ? WHERE surah = ? AND ayah = ?",
        updateRows
      );
      console.log(`[Import] text_search migration done: ${updateRows.length} rows`);
    }

    // Create text_search index (must happen after column migration)
    await createTextSearchIndex(db);

    // Migrate sync_queue table to add row_id, status, synced_at columns (Phase 6)
    try {
      await db.getFirstAsync("SELECT row_id FROM sync_queue LIMIT 1");
    } catch (_) {
      console.log("[Import] Migrating sync_queue table...");
      try {
        await db.execAsync(`
          DROP TABLE IF EXISTS sync_queue;
          CREATE TABLE sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            operation TEXT NOT NULL,
            row_id TEXT NOT NULL,
            data TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            synced_at TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(table_name);
        `);
        console.log("[Import] sync_queue migration done.");
      } catch (e) {
        console.warn("[Import] sync_queue migration error:", e);
      }
    }

    // Import new tab datasets if their tables are empty (migration for existing installs).
    await runNewTabImports(db, onProgress);
    const surahInfoCount = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM surah_info"
    );
    if ((surahInfoCount?.count ?? 0) < 228) {
      await importSurahInfo(db, onProgress);
    }

    console.log("[Import] Database already populated, skipping import.");
    onProgress({ step: "Complete", current: TOTAL_STEPS, total: TOTAL_STEPS, detail: "Already imported" });
    return;
  }

  console.log("[Import] Starting first-launch data import...");
  const startTime = Date.now();

  // Pre-warm: kick off every network fetch in parallel (web only — native
  // uses require() which is synchronous). Each call primes loadCache so
  // importers await already-in-flight promises instead of triggering fresh
  // sequential downloads.
  if (Platform.OS === "web") {
    void loadData("quran-data.json");
    void loadData("quran-qcf2.json");
    void loadData("surah-info.json");
    void loadData("reflection-journey.json");
    void loadData("zilal.json");
    void loadData("translation-sahih.json");
    void loadData("page-map.json");
    void loadData("wbw/wbw.json");
    void loadData("masaq/masaq-aggregated.json");
    void loadData("tajweed.json");
    void loadData("layout/page-lines.json");
    void loadData("wbw-arabic-meanings.json");
    void loadData("irab-per-word.json");
    void loadData("tajweed-rules-ar.json");
    void loadData("tajweed-rules-en.json");
    void loadData("al-qira-at-al-mawsoo-ah-al-qur-aniyyah.json");
    void loadData("asbab-al-nuzul.json");
    void loadData("mutashabihat/nourquran_hafiz.json");
    for (let i = 1; i <= 114; i++) void loadTafseerFile(i);
  }

  await importSurahs(db, onProgress);
  await importQuranText(db, onProgress);
  await importJuzAndHizb(db, onProgress);
  await importWordRoots(db, onProgress);
  await importTafseer(db, onProgress);
  await importZilal(db, onProgress);
  if (Platform.OS !== "web") {
    await importConfiguredTafsirSources(db, onProgress);
  }
  await importTranslations(db, onProgress);
  await importPageMap(db, onProgress);
  await importWordTranslations(db, onProgress);
  await importWordIrab(db, onProgress);
  await importTajweed(db, onProgress);
  await importPageLines(db, onProgress);
  await runNewTabImports(db, onProgress);
  await importSurahInfo(db, onProgress);

  // Create tafseer source index (not in schema.ts to avoid error on old tables without source column)
  await db.execAsync("CREATE INDEX IF NOT EXISTS idx_tafseer_source ON tafseer(source)");

  // Free the fetch cache — the parsed JSON (~50MB) has been inserted into
  // SQLite and is no longer needed in memory.
  clearImportCaches();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Import] All imports complete in ${elapsed}s`);
  onProgress({ step: "Complete", current: TOTAL_STEPS, total: TOTAL_STEPS, detail: `Done in ${elapsed}s` });
}

export async function getTableCounts(
  db: SQLiteDatabase
): Promise<Record<string, number>> {
  const tables = [
    "surahs",
    "surah_info",
    "quran_text",
    "juz_map",
    "hizb_map",
    "word_roots",
    "page_map",
    "tafseer",
    "translations",
    "word_translations",
    "word_irab",
    "tajweed_rules",
    "asbab_al_nuzul",
    "page_lines",
  ];

  const counts: Record<string, number> = {};
  for (const table of tables) {
    const result = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${table}`
    );
    counts[table] = result?.count ?? 0;
  }
  return counts;
}
