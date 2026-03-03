import type { SQLiteDatabase } from "expo-sqlite";
import { createSchema } from "./schema";

// JSON data imports via require()
const quranData = require("../../assets/data/quran-data.json");
const translationData = require("../../assets/data/translation-sahih.json");
const pageMapData = require("../../assets/data/page-map.json");
const tajweedData = require("../../assets/data/tajweed.json");
const wbwData = require("../../assets/data/wbw/wbw.json");
const masaqData = require("../../assets/data/masaq/masaq-aggregated.json");
const pageLinesData = require("../../assets/data/layout/page-lines.json");
const qcf2Data = require("../../assets/data/quran-qcf2.json");
// morphology-terms-ar.json is a terminology reference (labels), not per-word data.
// Per-word morphological data comes from the MASAQ dataset (word_irab table).
// The word_morphology table is reserved for future use with mustafa0x/quran-morphology data.

// Static require map for tafseer files (metro bundler needs static requires)
const tafseerRequires: Record<number, any> = {
  1: require("../../assets/data/tafseer/1.json"),
  2: require("../../assets/data/tafseer/2.json"),
  3: require("../../assets/data/tafseer/3.json"),
  4: require("../../assets/data/tafseer/4.json"),
  5: require("../../assets/data/tafseer/5.json"),
  6: require("../../assets/data/tafseer/6.json"),
  7: require("../../assets/data/tafseer/7.json"),
  8: require("../../assets/data/tafseer/8.json"),
  9: require("../../assets/data/tafseer/9.json"),
  10: require("../../assets/data/tafseer/10.json"),
  11: require("../../assets/data/tafseer/11.json"),
  12: require("../../assets/data/tafseer/12.json"),
  13: require("../../assets/data/tafseer/13.json"),
  14: require("../../assets/data/tafseer/14.json"),
  15: require("../../assets/data/tafseer/15.json"),
  16: require("../../assets/data/tafseer/16.json"),
  17: require("../../assets/data/tafseer/17.json"),
  18: require("../../assets/data/tafseer/18.json"),
  19: require("../../assets/data/tafseer/19.json"),
  20: require("../../assets/data/tafseer/20.json"),
  21: require("../../assets/data/tafseer/21.json"),
  22: require("../../assets/data/tafseer/22.json"),
  23: require("../../assets/data/tafseer/23.json"),
  24: require("../../assets/data/tafseer/24.json"),
  25: require("../../assets/data/tafseer/25.json"),
  26: require("../../assets/data/tafseer/26.json"),
  27: require("../../assets/data/tafseer/27.json"),
  28: require("../../assets/data/tafseer/28.json"),
  29: require("../../assets/data/tafseer/29.json"),
  30: require("../../assets/data/tafseer/30.json"),
  31: require("../../assets/data/tafseer/31.json"),
  32: require("../../assets/data/tafseer/32.json"),
  33: require("../../assets/data/tafseer/33.json"),
  34: require("../../assets/data/tafseer/34.json"),
  35: require("../../assets/data/tafseer/35.json"),
  36: require("../../assets/data/tafseer/36.json"),
  37: require("../../assets/data/tafseer/37.json"),
  38: require("../../assets/data/tafseer/38.json"),
  39: require("../../assets/data/tafseer/39.json"),
  40: require("../../assets/data/tafseer/40.json"),
  41: require("../../assets/data/tafseer/41.json"),
  42: require("../../assets/data/tafseer/42.json"),
  43: require("../../assets/data/tafseer/43.json"),
  44: require("../../assets/data/tafseer/44.json"),
  45: require("../../assets/data/tafseer/45.json"),
  46: require("../../assets/data/tafseer/46.json"),
  47: require("../../assets/data/tafseer/47.json"),
  48: require("../../assets/data/tafseer/48.json"),
  49: require("../../assets/data/tafseer/49.json"),
  50: require("../../assets/data/tafseer/50.json"),
  51: require("../../assets/data/tafseer/51.json"),
  52: require("../../assets/data/tafseer/52.json"),
  53: require("../../assets/data/tafseer/53.json"),
  54: require("../../assets/data/tafseer/54.json"),
  55: require("../../assets/data/tafseer/55.json"),
  56: require("../../assets/data/tafseer/56.json"),
  57: require("../../assets/data/tafseer/57.json"),
  58: require("../../assets/data/tafseer/58.json"),
  59: require("../../assets/data/tafseer/59.json"),
  60: require("../../assets/data/tafseer/60.json"),
  61: require("../../assets/data/tafseer/61.json"),
  62: require("../../assets/data/tafseer/62.json"),
  63: require("../../assets/data/tafseer/63.json"),
  64: require("../../assets/data/tafseer/64.json"),
  65: require("../../assets/data/tafseer/65.json"),
  66: require("../../assets/data/tafseer/66.json"),
  67: require("../../assets/data/tafseer/67.json"),
  68: require("../../assets/data/tafseer/68.json"),
  69: require("../../assets/data/tafseer/69.json"),
  70: require("../../assets/data/tafseer/70.json"),
  71: require("../../assets/data/tafseer/71.json"),
  72: require("../../assets/data/tafseer/72.json"),
  73: require("../../assets/data/tafseer/73.json"),
  74: require("../../assets/data/tafseer/74.json"),
  75: require("../../assets/data/tafseer/75.json"),
  76: require("../../assets/data/tafseer/76.json"),
  77: require("../../assets/data/tafseer/77.json"),
  78: require("../../assets/data/tafseer/78.json"),
  79: require("../../assets/data/tafseer/79.json"),
  80: require("../../assets/data/tafseer/80.json"),
  81: require("../../assets/data/tafseer/81.json"),
  82: require("../../assets/data/tafseer/82.json"),
  83: require("../../assets/data/tafseer/83.json"),
  84: require("../../assets/data/tafseer/84.json"),
  85: require("../../assets/data/tafseer/85.json"),
  86: require("../../assets/data/tafseer/86.json"),
  87: require("../../assets/data/tafseer/87.json"),
  88: require("../../assets/data/tafseer/88.json"),
  89: require("../../assets/data/tafseer/89.json"),
  90: require("../../assets/data/tafseer/90.json"),
  91: require("../../assets/data/tafseer/91.json"),
  92: require("../../assets/data/tafseer/92.json"),
  93: require("../../assets/data/tafseer/93.json"),
  94: require("../../assets/data/tafseer/94.json"),
  95: require("../../assets/data/tafseer/95.json"),
  96: require("../../assets/data/tafseer/96.json"),
  97: require("../../assets/data/tafseer/97.json"),
  98: require("../../assets/data/tafseer/98.json"),
  99: require("../../assets/data/tafseer/99.json"),
  100: require("../../assets/data/tafseer/100.json"),
  101: require("../../assets/data/tafseer/101.json"),
  102: require("../../assets/data/tafseer/102.json"),
  103: require("../../assets/data/tafseer/103.json"),
  104: require("../../assets/data/tafseer/104.json"),
  105: require("../../assets/data/tafseer/105.json"),
  106: require("../../assets/data/tafseer/106.json"),
  107: require("../../assets/data/tafseer/107.json"),
  108: require("../../assets/data/tafseer/108.json"),
  109: require("../../assets/data/tafseer/109.json"),
  110: require("../../assets/data/tafseer/110.json"),
  111: require("../../assets/data/tafseer/111.json"),
  112: require("../../assets/data/tafseer/112.json"),
  113: require("../../assets/data/tafseer/113.json"),
  114: require("../../assets/data/tafseer/114.json"),
};

export type ImportProgress = {
  step: string;
  current: number;
  total: number;
  detail?: string;
};

type ProgressCallback = (progress: ImportProgress) => void;

const TOTAL_STEPS = 11;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
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

async function importSurahs(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
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
    ];
  });
  await batchInsert(
    db,
    "INSERT OR IGNORE INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (?, ?, ?, ?, ?, ?)",
    rows
  );
  console.log(`[Import] Quran text done: ${texts.length} rows`);
}

async function importJuzAndHizb(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
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
  onProgress({ step: "Tafseer", current: 5, total: TOTAL_STEPS, detail: "114 surah files" });
  console.log(`[Import] Importing tafseer from 114 files...`);

  let totalRows = 0;
  const allRows: any[][] = [];
  for (let i = 1; i <= 114; i++) {
    const data = tafseerRequires[i];
    const ayahs = data.ayahs || data;
    for (const entry of ayahs) {
      allRows.push([entry.surah ?? i, entry.ayah, entry.text]);
    }
    totalRows += ayahs.length;
  }

  await batchInsert(
    db,
    "INSERT OR IGNORE INTO tafseer (surah, ayah, text) VALUES (?, ?, ?)",
    allRows
  );
  console.log(`[Import] Tafseer done: ${totalRows} rows`);
}

async function importTranslations(
  db: SQLiteDatabase,
  onProgress: ProgressCallback
): Promise<void> {
  onProgress({ step: "Translations", current: 6, total: TOTAL_STEPS, detail: "Sahih International" });
  console.log(`[Import] Importing translations...`);

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
  onProgress({ step: "Page Map", current: 7, total: TOTAL_STEPS, detail: "604 pages" });
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
  onProgress({ step: "Word-by-Word", current: 8, total: TOTAL_STEPS, detail: `${wbwData.length} words` });
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
  onProgress({ step: "Grammar (إعراب)", current: 9, total: TOTAL_STEPS, detail: `${masaqData.length} words` });
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
  onProgress({ step: "Page Layout", current: 11, total: TOTAL_STEPS, detail: `${pageLinesData.length} lines` });
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
  onProgress({ step: "Tajweed Rules", current: 10, total: TOTAL_STEPS, detail: `${tajweedData.length} ayahs` });
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
  await importTranslations(db, onProgress);
  await importPageMap(db, onProgress);
  await importWordTranslations(db, onProgress);
  await importWordIrab(db, onProgress);
  await importTajweed(db, onProgress);
  await importPageLines(db, onProgress);

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
