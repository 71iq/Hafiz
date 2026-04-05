import { Platform } from "react-native";
import type { SQLiteDatabase } from "expo-sqlite";
import { createSchema, createTextSearchIndex } from "./schema";

// ─── Platform-aware data loading ─────────────────────────────
// On web: fetch from /data/ (static files served from public/)
// On native: use require() (Metro handles large assets fine)

// Native-only require map — these are stripped from the web bundle
// because the loadData() web path uses fetch() instead.
const nativeRequires: Record<string, () => any> = Platform.OS !== "web"
  ? {
      "quran-data.json": () => require("../../assets/data/quran-data.json"),
      "quran-qcf2.json": () => require("../../assets/data/quran-qcf2.json"),
      "translation-sahih.json": () => require("../../assets/data/translation-sahih.json"),
      "page-map.json": () => require("../../assets/data/page-map.json"),
      "tajweed.json": () => require("../../assets/data/tajweed.json"),
      "wbw/wbw.json": () => require("../../assets/data/wbw/wbw.json"),
      "masaq/masaq-aggregated.json": () => require("../../assets/data/masaq/masaq-aggregated.json"),
      "layout/page-lines.json": () => require("../../assets/data/layout/page-lines.json"),
      "zilal.json": () => require("../../assets/data/zilal.json"),
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

async function loadData(filename: string): Promise<any> {
  if (Platform.OS === "web") {
    const resp = await fetch(`/data/${filename}`);
    return resp.json();
  }
  const loader = nativeRequires[filename];
  return loader ? loader() : null;
}

async function loadTafseerFile(surahNumber: number): Promise<any> {
  if (Platform.OS === "web") {
    const resp = await fetch(`/data/tafseer/${surahNumber}.json`);
    return resp.json();
  }
  const loader = nativeTafseerRequires[surahNumber];
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

const TOTAL_STEPS = 12;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/** Strip Arabic diacritics (tashkeel) for search-friendly text */
const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0640]/g;
function stripDiacritics(text: string): string {
  return text.replace(ARABIC_DIACRITICS, "");
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

  let totalRows = 0;
  const allRows: any[][] = [];
  for (let i = 1; i <= 114; i++) {
    const data = await loadTafseerFile(i);
    const ayahs = data.ayahs || data;
    for (const entry of ayahs) {
      allRows.push([entry.surah ?? i, entry.ayah, "muyassar", entry.text]);
    }
    totalRows += ayahs.length;
  }

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

async function importTranslations(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  onProgress({ step: "Translations", current: 7, total: TOTAL_STEPS, detail: "Sahih International" });
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
  onProgress({ step: "Page Map", current: 8, total: TOTAL_STEPS, detail: "604 pages" });
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
  onProgress({ step: "Word-by-Word", current: 9, total: TOTAL_STEPS, detail: `${wbwData.length} words` });
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
  onProgress({ step: "Grammar (إعراب)", current: 10, total: TOTAL_STEPS, detail: `${masaqData.length} words` });
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
  onProgress({ step: "Page Layout", current: 12, total: TOTAL_STEPS, detail: `${pageLinesData.length} lines` });
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
  onProgress({ step: "Tajweed Rules", current: 11, total: TOTAL_STEPS, detail: `${tajweedData.length} ayahs` });
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

// ─── Main initialization ─────────────────────────────────────

export async function initializeDatabase(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  console.log("[Import] Creating schema...");
  await createSchema(db);

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

    console.log("[Import] Database already populated, skipping import.");
    onProgress({ step: "Complete", current: TOTAL_STEPS, total: TOTAL_STEPS, detail: "Already imported" });
    return;
  }

  console.log("[Import] Starting first-launch data import...");
  const startTime = Date.now();

  await importSurahs(db, onProgress);
  await importQuranText(db, onProgress);
  await importJuzAndHizb(db, onProgress);
  await importWordRoots(db, onProgress);
  await importTafseer(db, onProgress);
  await importZilal(db, onProgress);
  await importTranslations(db, onProgress);
  await importPageMap(db, onProgress);
  await importWordTranslations(db, onProgress);
  await importWordIrab(db, onProgress);
  await importTajweed(db, onProgress);
  await importPageLines(db, onProgress);

  // Create tafseer source index (not in schema.ts to avoid error on old tables without source column)
  await db.execAsync("CREATE INDEX IF NOT EXISTS idx_tafseer_source ON tafseer(source)");

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Import] All imports complete in ${elapsed}s`);
  onProgress({ step: "Complete", current: TOTAL_STEPS, total: TOTAL_STEPS, detail: `Done in ${elapsed}s` });
}

export async function getTableCounts(
  db: SQLiteDatabase
): Promise<Record<string, number>> {
  const tables = [
    "surahs",
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
