import { Platform } from "react-native";
import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { insertPreparedRows } from "@/lib/database/bulk-insert";
import { createSchema, createTextSearchIndex, migrateUserSchema } from "./schema";
import { normalizeArabicCore, normalizeArabicWord } from "@/lib/arabic";
import { mapRowsToCanonicalWords, type CanonicalWord } from "@/lib/database/word-mapping";
import {
  buildAyahCountIndex,
  computeReflectionJourneyFingerprint,
  loadAndValidateReflectionJourneySeed,
} from "@/lib/reflection-journey/schema";
import { TAFSIR_SOURCES, type TafsirSourceConfig, type TafsirSourceId } from "@/lib/tafsir/sources";
import surahEnglishNameRows from "../../assets/data/surah-english-names.json";
import { nativeRequires, nativeTafseerRequires, nativeTafsirSourceLoader } from "./native-loaders";

// Platform-specific native asset loaders live in native-loaders.*.

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
    if (!resp.ok) {
      throw new Error("Failed to load tafsir source " + source + " surah " + surahNumber + ": HTTP " + resp.status);
    }
    return resp.json();
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

async function loadCanonicalWordsByAyah(db: DatabaseExecutor): Promise<Map<string, CanonicalWord[]>> {
  const rows = await db.getAllAsync<{
    surah: number;
    ayah: number;
    word_pos: number;
    arabic_word: string | null;
  }>("SELECT surah, ayah, word_pos, arabic_word FROM word_irab ORDER BY surah, ayah, word_pos");
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

async function isPopulated(db: DatabaseExecutor): Promise<boolean> {
  try {
    const result = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM surahs");
    return (result?.count ?? 0) >= 114;
  } catch {
    return false;
  }
}

// Written only after a full first-launch import. Content tables alone cannot tell a finished import
// from one that Android killed halfway, because surahs are imported first.
const CONTENT_IMPORT_MARKER = "content_import_complete_v1";

// Tables filled by the first-launch import with plain INSERTs or partial rows. A resumed import
// clears them first so it cannot duplicate rows. User-owned tables are never listed here.
const FIRST_LAUNCH_CONTENT_TABLES = [
  "quran_text",
  "juz_map",
  "hizb_map",
  "word_roots",
  "translations",
  "page_map",
  "word_translations",
  "word_irab",
  "tajweed_rules",
  "page_lines",
] as const;

export type ContentImportState = "fresh" | "resume" | "complete";

async function countRows(db: DatabaseExecutor, sql: string): Promise<number> {
  try {
    const row = await db.getFirstAsync<{ count: number }>(sql);
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Decides whether the bundled Quran content must be imported. Installs from before the marker
 * existed count as complete when their core tables are full; anything else with surahs present
 * was interrupted and resumes.
 */
export async function resolveContentImportState(db: DatabaseExecutor): Promise<ContentImportState> {
  if (!(await isPopulated(db))) return "fresh";
  if ((await readSetting(db, CONTENT_IMPORT_MARKER).catch(() => null)) === "1") return "complete";

  const coreChecks = [
    ["SELECT COUNT(*) as count FROM quran_text", 6236],
    ["SELECT COUNT(*) as count FROM translations", 6236],
    ["SELECT COUNT(*) as count FROM tafseer WHERE source = 'muyassar'", 6236],
    ["SELECT COUNT(*) as count FROM juz_map", 1],
    ["SELECT COUNT(*) as count FROM hizb_map", 1],
    ["SELECT COUNT(*) as count FROM page_map", 604],
    ["SELECT COUNT(*) as count FROM word_roots", 1],
    ["SELECT COUNT(*) as count FROM word_translations", 1],
    ["SELECT COUNT(*) as count FROM word_irab", 1],
    ["SELECT COUNT(*) as count FROM tajweed_rules", 1],
  ] as const;
  for (const [sql, minimum] of coreChecks) {
    if ((await countRows(db, sql)) < minimum) return "resume";
  }
  await writeSetting(db, CONTENT_IMPORT_MARKER, "1");
  return "complete";
}

async function clearPartialContentImport(db: AppDatabase): Promise<void> {
  for (const table of FIRST_LAUNCH_CONTENT_TABLES) {
    await db.execAsync(`DELETE FROM ${table}`);
  }
  await db.execAsync("DELETE FROM tafseer WHERE source IN ('muyassar', 'zilal')");
}

async function batchInsert(db: AppDatabase, sql: string, rows: any[][], batchSize: number = 500): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await db.withTransactionAsync((tx) => insertPreparedRows(tx, sql, batch));
  }
}

async function readSetting(db: DatabaseExecutor, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [key]);
  return row?.value ?? null;
}

async function writeSetting(db: DatabaseExecutor, key: string, value: string): Promise<void> {
  await db.runAsync("INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)", [key, value]);
}

type SurahEnglishNameRow = { number: number; name_english: string };

const DEFAULT_SURAH_ENGLISH_NAMES = new Map(
  (surahEnglishNameRows as SurahEnglishNameRow[])
    .filter(
      (row) => Number.isInteger(row.number) && typeof row.name_english === "string" && row.name_english.length > 0,
    )
    .map((row) => [row.number, row.name_english]),
);

async function ensureDefaultSurahEnglishNames(db: AppDatabase): Promise<void> {
  const baqaraName = DEFAULT_SURAH_ENGLISH_NAMES.get(2);
  if (!baqaraName) return;

  const current = await db.getFirstAsync<{ name_english: string }>("SELECT name_english FROM surahs WHERE number = 2");
  if (current?.name_english === baqaraName) return;

  await batchInsert(
    db,
    "UPDATE surahs SET name_english = ? WHERE number = ?",
    Array.from(DEFAULT_SURAH_ENGLISH_NAMES, ([number, name]) => [name, number]),
  );
}

// ─── Import functions ────────────────────────────────────────

async function importSurahs(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
  const quranData = await loadData("quran-data.json");
  const surahs = quranData.tables.surahs;
  onProgress({ step: "Surahs", current: 1, total: TOTAL_STEPS, detail: `${surahs.length} surahs` });
  console.log(`[Import] Importing ${surahs.length} surahs...`);

  const rows = surahs.map((s: any) => [
    s.number,
    s.name_arabic,
    DEFAULT_SURAH_ENGLISH_NAMES.get(s.number) ?? s.name_english,
    s.ayah_count,
    s.revelation_type,
  ]);
  await batchInsert(
    db,
    "INSERT OR IGNORE INTO surahs (number, name_arabic, name_english, ayah_count, revelation_type) VALUES (?, ?, ?, ?, ?)",
    rows,
  );
  console.log(`[Import] Surahs done: ${surahs.length} rows`);
}

async function importSurahInfo(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
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
    rows,
  );
  console.log(`[Import] Surah information done: ${rows.length} rows`);
}

async function importQuranText(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
  const [quranData, qcf2Data] = await Promise.all([loadData("quran-data.json"), loadData("quran-qcf2.json")]);
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
      t.surah,
      t.ayah,
      t.text_uthmani,
      t.text_clean,
      qcf2?.code_v2 ?? "",
      qcf2?.v2_page ?? 0,
      stripDiacritics(t.text_clean),
    ];
  });
  await batchInsert(
    db,
    "INSERT OR IGNORE INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page, text_search) VALUES (?, ?, ?, ?, ?, ?, ?)",
    rows,
  );
  console.log(`[Import] Quran text done: ${texts.length} rows`);
}

async function importJuzAndHizb(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
  const quranData = await loadData("quran-data.json");
  const juzMap = quranData.tables.juz_map;
  const hizbMap = quranData.tables.hizb_map;
  onProgress({
    step: "Juz & Hizb Maps",
    current: 3,
    total: TOTAL_STEPS,
    detail: `${juzMap.length} juz + ${hizbMap.length} hizb`,
  });
  console.log(`[Import] Importing ${juzMap.length} juz_map + ${hizbMap.length} hizb_map rows...`);

  const juzRows = juzMap.map((j: any) => [j.juz, j.surah, j.ayah_start, j.ayah_end]);
  await batchInsert(db, "INSERT INTO juz_map (juz, surah, ayah_start, ayah_end) VALUES (?, ?, ?, ?)", juzRows);

  const hizbRows = hizbMap.map((h: any) => [h.hizb, h.surah_start, h.ayah_start, h.surah_end, h.ayah_end]);
  await batchInsert(
    db,
    "INSERT INTO hizb_map (hizb, surah_start, ayah_start, surah_end, ayah_end) VALUES (?, ?, ?, ?, ?)",
    hizbRows,
  );
  console.log(`[Import] Juz & Hizb done`);
}

async function importWordRoots(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
  const quranData = await loadData("quran-data.json");
  const roots = quranData.tables.word_roots;
  onProgress({ step: "Word Roots", current: 4, total: TOTAL_STEPS, detail: `${roots.length} words` });
  console.log(`[Import] Importing ${roots.length} word_roots rows...`);

  const rows = roots.map((r: any) => [r.surah, r.ayah, r.word_pos, r.word_text, r.root ?? null, r.lemma ?? null]);
  await batchInsert(
    db,
    "INSERT INTO word_roots (surah, ayah, word_pos, word_text, root, lemma) VALUES (?, ?, ?, ?, ?, ?)",
    rows,
  );
  console.log(`[Import] Word roots done: ${roots.length} rows`);
}

async function importTafseer(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
  onProgress({ step: "Tafsir", current: 5, total: TOTAL_STEPS, detail: "Al-Muyassar (114 files)" });
  console.log(`[Import] Importing tafseer (muyassar) from 114 files...`);

  // Fetch all 114 files in parallel instead of sequentially.
  const tafseerResults = await Promise.all(Array.from({ length: 114 }, (_, i) => loadTafseerFile(i + 1)));

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

  await batchInsert(db, "INSERT OR IGNORE INTO tafseer (surah, ayah, source, text) VALUES (?, ?, ?, ?)", allRows);
  console.log(`[Import] Tafsir (muyassar) done: ${totalRows} rows`);
}

async function importZilal(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
  onProgress({ step: "Tafsir", current: 6, total: TOTAL_STEPS, detail: "Fi Zilal al-Quran" });
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

  await batchInsert(db, "INSERT OR IGNORE INTO tafseer (surah, ayah, source, text) VALUES (?, ?, ?, ?)", allRows);
  console.log(`[Import] Tafsir (zilal) done: ${allRows.length} rows`);
}

type TafsirSourceCandidateRow = [surah: number, ayah: number, source: TafsirSourceId, text: string];

function isTafsirSourceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

async function loadSurahRowTafsirSourceCandidate(source: TafsirSourceConfig): Promise<TafsirSourceCandidateRow[]> {
  console.log("[Import] Staging tafseer (" + source.id + ") from 114 surah files...");

  const rowsByCoordinate = new Map<string, TafsirSourceCandidateRow>();
  for (let surahNumber = 1; surahNumber <= 114; surahNumber++) {
    const data: unknown = await doLoadTafsirSourceFile(source.id, surahNumber);
    if (!isUnknownArray(data)) continue;
    for (const row of data) {
      let surah: unknown;
      let ayah: unknown;
      let text: unknown;
      if (Array.isArray(row)) {
        [surah, ayah, text] = row;
      } else if (isTafsirSourceRecord(row)) {
        surah = row.surah;
        ayah = row.ayah;
        text = row.text;
      } else {
        continue;
      }
      if (typeof surah !== "number" || !Number.isInteger(surah)) continue;
      if (typeof ayah !== "number" || !Number.isInteger(ayah)) continue;
      const cleanText = stripHtml(String(text ?? ""));
      if (cleanText.length === 0) continue;
      const candidateRow: TafsirSourceCandidateRow = [surah, ayah, source.id, cleanText];
      rowsByCoordinate.set(String(surah) + ":" + String(ayah), candidateRow);
    }
  }

  return [...rowsByCoordinate.values()];
}

export async function ensureTafsirSourceImported(db: AppDatabase, sourceId: TafsirSourceId): Promise<void> {
  const source = TAFSIR_SOURCES.find((item) => item.id === sourceId);
  if (!source || source.importKind !== "surahRows") return;

  const sourceCount = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM tafseer WHERE source = ?",
    [source.id],
  );
  if ((sourceCount?.count ?? 0) >= (source.expectedRows ?? 6236)) return;

  const candidateRows = await loadSurahRowTafsirSourceCandidate(source);
  if (candidateRows.length < (source.expectedRows ?? 6236)) {
    throw new Error("Tafsir source " + source.id + " is unavailable");
  }

  await db.withTransactionAsync(async (tx) => {
    await tx.runAsync("DELETE FROM tafseer WHERE source = ?", [source.id]);
    await insertPreparedRows(
      tx,
      "INSERT OR REPLACE INTO tafseer (surah, ayah, source, text) VALUES (?, ?, ?, ?)",
      candidateRows,
    );
  });
  console.log("[Import] Tafsir (" + source.id + ") done: " + candidateRows.length + " rows");
}

async function importTranslations(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
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

  await batchInsert(db, "INSERT OR IGNORE INTO translations (surah, ayah, text_en) VALUES (?, ?, ?)", allRows);
  console.log(`[Import] Translations done: ${allRows.length} rows`);
}

async function importPageMap(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
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
    rows,
  );
  console.log(`[Import] Page map done: ${pageMapData.length} rows`);
}

async function importWordTranslations(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
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
    rows,
  );
  console.log(`[Import] Word translations done: ${wbwData.length} rows`);
}

async function importWordIrab(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
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
    rows,
  );
  console.log(`[Import] Word irab done: ${masaqData.length} rows`);
}

async function importPageLines(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
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
    rows,
  );
  console.log(`[Import] Page lines done: ${pageLinesData.length} rows`);
}

async function importTajweed(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
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
    allRows,
  );
  console.log(`[Import] Tajweed done: ${allRows.length} rows`);
}

// ─── New tab dataset importers ───────────────────────────────

async function importWordMeaningsAr(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
  const data = await loadData("wbw-arabic-meanings.json");
  if (!Array.isArray(data)) return;
  onProgress({ step: "Arabic Meanings", current: 14, total: TOTAL_STEPS, detail: `${data.length} words` });
  console.log(`[Import] Importing ${data.length} word_meanings_ar rows with canonical word mapping...`);

  const canonicalByAyah = await loadCanonicalWordsByAyah(db);
  const rows = mapRowsToCanonicalWords(
    canonicalByAyah,
    data,
    (w) => [`${w.surah}:${w.ayah}`],
    (w) => (w.meaning ? String(w.meaning) : null),
    "\n\n",
  );
  await batchInsert(
    db,
    "INSERT OR REPLACE INTO word_meanings_ar (surah, ayah, word_pos, word, meaning) VALUES (?, ?, ?, ?, ?)",
    rows,
  );
  console.log(`[Import] word_meanings_ar done: ${rows.length} canonical rows`);
}

async function importWordIrabDaas(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
  const data = await loadData("irab-per-word.json");
  if (!Array.isArray(data)) return;
  onProgress({ step: "Da'as Iʿrab", current: 15, total: TOTAL_STEPS, detail: `${data.length} words` });
  console.log(`[Import] Importing ${data.length} word_irab_daas rows (expanding ayah_group)...`);

  const canonicalByAyah = await loadCanonicalWordsByAyah(db);
  const rows = mapRowsToCanonicalWords(
    canonicalByAyah,
    data,
    (w) =>
      Array.isArray(w.ayah_group) && w.ayah_group.length > 0 ? w.ayah_group.map(String) : [`${w.surah}:${w.ayah}`],
    (w) => (w.irab ? stripHtml(String(w.irab)) : null),
    "\n",
  );
  await batchInsert(
    db,
    "INSERT OR REPLACE INTO word_irab_daas (surah, ayah, word_pos, word, irab) VALUES (?, ?, ?, ?, ?)",
    rows,
  );
  console.log(`[Import] word_irab_daas done: ${rows.length} canonical rows (from ${data.length} source entries)`);
}

async function importTajweedRulesAr(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
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
    rows,
  );
  console.log(`[Import] tajweed_rules_ar done: ${rows.length} rows`);
}

async function importTajweedRulesEn(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
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
    rows,
  );
  console.log(`[Import] tajweed_rules_en done: ${rows.length} rows`);
}

async function importQiraatEncyclopedia(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
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
      const group = Array.isArray(v.ayah_keys) && v.ayah_keys.length > 0 ? v.ayah_keys.map(String) : [key];
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
    rows,
  );
  console.log(`[Import] qiraat_encyclopedia done: ${rows.length} rows`);
}

async function importAsbabAlNuzul(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
  const data = await loadData("asbab-al-nuzul.json");
  if (!data || typeof data !== "object" || data.schema_version !== "1.0") {
    throw new Error("Unsupported asbab_al_nuzul schema_version");
  }
  const source = typeof data.source?.repository === "string" ? data.source.repository : "asbab-al-nuzul-dataset";
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
    rows,
  );
  console.log(`[Import] asbab_al_nuzul done: ${rows.length} rows`);
}

async function importMutashabihat(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
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

  await db.withTransactionAsync(async (tx) => {
    await tx.runAsync("DELETE FROM mutashabihat_refs");
    await tx.runAsync("DELETE FROM mutashabihat_groups");
  });

  await batchInsert(
    db,
    "INSERT OR REPLACE INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES (?, ?, ?, ?, ?)",
    groupRows,
  );
  await batchInsert(
    db,
    "INSERT OR REPLACE INTO mutashabihat_refs (group_id, sort_order, surah, ayah, surah_name_ar, tail_5, pre_text, similar_text, post_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    refRows,
  );

  console.log(`[Import] mutashabihat done: ${groupRows.length} groups + ${refRows.length} refs`);
}

async function importReflectionJourneyLevels(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
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
  const shouldReimport = storedFingerprint !== fingerprint || existingCount !== parsed.levels.length;

  onProgress({
    step: "Reflection Journey",
    current: 21,
    total: TOTAL_STEPS,
    detail: `${parsed.levels.length} levels`,
  });

  if (!shouldReimport) {
    return;
  }

  await db.withTransactionAsync(async (tx) => {
    await tx.runAsync("DELETE FROM reflection_journey_levels");

    if (parsed.levels.length > 0) {
      const stmt = await tx.prepareAsync(
        `INSERT INTO reflection_journey_levels
          (id, slug, order_index, title_en, title_ar, summary_en, summary_ar, response_prompt_en, response_prompt_ar, estimated_minutes, content_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

    await writeSetting(tx, "reflection_journey_content_fingerprint", fingerprint);
  });

  console.log(`[Import] Reflection Journey done: ${parsed.levels.length} levels`);
}

async function runNewTabImports(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
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
      "SELECT word FROM word_meanings_ar WHERE surah = 2 AND ayah = 255 AND word_pos = 1",
    );
    const missingCanonicalMeaning = await db.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) as c FROM word_meanings_ar WHERE surah = 2 AND ayah = 255 AND word_pos = 6",
    );
    const stale =
      !!staleMeaningAtSourcePos?.word ||
      ((await safeCount("word_meanings_ar")) > 0 && (missingCanonicalMeaning?.c ?? 0) === 0);
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
      "SELECT word FROM word_irab_daas WHERE surah = 1 AND ayah = 2 AND word_pos = 1",
    );
    const c11 = await db.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) as c FROM word_irab_daas WHERE surah = 1 AND ayah = 1",
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
  const missingMutashabihatSegments = await db
    .getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c
       FROM mutashabihat_refs r
       JOIN mutashabihat_groups g ON g.id = r.group_id
      WHERE g.kind = 'similar'
        AND TRIM(COALESCE(r.similar_text, '')) = ''`,
    )
    .catch(() => ({ c: 0 }));
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

async function ensureQfUserSyncSchema(db: DatabaseExecutor): Promise<void> {
  try {
    await db.execAsync("ALTER TABLE bookmarks ADD COLUMN updated_at TEXT");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE bookmarks ADD COLUMN deleted_at TEXT");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE bookmarks ADD COLUMN qf_bookmark_id TEXT");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE bookmarks ADD COLUMN qf_synced_at TEXT");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE bookmarks ADD COLUMN qf_sync_error TEXT");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE bookmarks ADD COLUMN qf_is_in_default_collection INTEGER NOT NULL DEFAULT 0");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE bookmarks ADD COLUMN qf_collections_count INTEGER NOT NULL DEFAULT 0");
  } catch {}
  await db.execAsync("UPDATE bookmarks SET updated_at = created_at WHERE updated_at IS NULL");

  try {
    await db.execAsync("ALTER TABLE study_cards ADD COLUMN updated_at TEXT");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE study_cards ADD COLUMN suspended_at TEXT");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE study_cards ADD COLUMN buried_until TEXT");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE study_cards ADD COLUMN marked_at TEXT");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE study_cards ADD COLUMN deleted_at TEXT");
  } catch {}
  await db.execAsync("UPDATE study_cards SET updated_at = created_at WHERE updated_at IS NULL");

  try {
    await db.execAsync("ALTER TABLE private_notes ADD COLUMN updated_at TEXT");
  } catch {}
  await db.execAsync("UPDATE private_notes SET updated_at = created_at WHERE updated_at IS NULL");
  try {
    await db.execAsync("ALTER TABLE private_notes ADD COLUMN qf_note_id TEXT");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE private_notes ADD COLUMN qf_synced_at TEXT");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE private_notes ADD COLUMN qf_sync_error TEXT");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE private_notes ADD COLUMN qf_ranges_json TEXT");
  } catch {}

  try {
    await db.execAsync("ALTER TABLE reflection_journey_entries ADD COLUMN updated_at TEXT");
  } catch {}
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

export async function initializeDatabase(db: AppDatabase, onProgress: ProgressCallback): Promise<void> {
  console.log("[Import] Creating schema...");
  await createSchema(db);
  await migrateUserSchema(db);
  await ensureQfUserSyncSchema(db);

  const importState = await resolveContentImportState(db);
  if (importState === "resume") {
    console.warn("[Import] Previous first-launch import was interrupted; importing again.");
    await clearPartialContentImport(db);
  }
  if (importState === "complete") {
    await ensureDefaultSurahEnglishNames(db);

    // Check if page_lines needs migration (added after initial import)
    const plCount = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM page_lines");
    if ((plCount?.count ?? 0) === 0) {
      console.log("[Import] Migrating: importing page_lines...");
      await importPageLines(db, onProgress);
    }

    // Ensure QCF2 columns exist (added after initial import)
    try {
      await db.execAsync("ALTER TABLE quran_text ADD COLUMN text_qcf2 TEXT NOT NULL DEFAULT ''");
    } catch {}
    try {
      await db.execAsync("ALTER TABLE quran_text ADD COLUMN v2_page INTEGER NOT NULL DEFAULT 0");
    } catch {}

    // Check if QCF2 data needs populating or updating (word grouping fix)
    const qcf2Check = await db.getFirstAsync<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM quran_text WHERE text_qcf2 != ''",
    );
    // Detect old char-level splitting: verse 66:1 has 17 individual PUA chars
    // but should have 15 word groups (2 words use 2 PUA chars each).
    const needsQcf2Rewrite =
      (qcf2Check?.cnt ?? 0) > 0
        ? await db
            .getFirstAsync<{ text_qcf2: string }>("SELECT text_qcf2 FROM quran_text WHERE surah = 66 AND ayah = 1")
            .then((row) => {
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
        updateRows,
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
      } catch {
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
        console.log("[Import] Tafsir migration done.");
      }
    } catch (e) {
      console.warn("[Import] Tafsir migration check:", e);
    }

    // Import zilal if not yet imported
    const zilalCount = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM tafseer WHERE source = 'zilal'",
    );
    if ((zilalCount?.count ?? 0) === 0) {
      console.log("[Import] Importing zilal tafseer...");
      await importZilal(db, onProgress);
    }

    // Add text_search column for diacritics-stripped search (Phase 4 migration)
    try {
      await db.execAsync("ALTER TABLE quran_text ADD COLUMN text_search TEXT NOT NULL DEFAULT ''");
    } catch {}
    const searchCheck = await db.getFirstAsync<{ text_search: string }>(
      "SELECT text_search FROM quran_text WHERE surah = 1 AND ayah = 1",
    );
    if (!searchCheck?.text_search) {
      console.log("[Import] Migrating: populating text_search column...");
      const allTexts = await db.getAllAsync<{ surah: number; ayah: number; text_clean: string }>(
        "SELECT surah, ayah, text_clean FROM quran_text",
      );
      const updateRows = allTexts.map((t) => [stripDiacritics(t.text_clean), t.surah, t.ayah]);
      await batchInsert(db, "UPDATE quran_text SET text_search = ? WHERE surah = ? AND ayah = ?", updateRows);
      console.log(`[Import] text_search migration done: ${updateRows.length} rows`);
    }

    // Create text_search index (must happen after column migration)
    await createTextSearchIndex(db);

    // Migrate sync_queue table to add row_id, status, synced_at columns (Phase 6)
    try {
      await db.getFirstAsync("SELECT row_id FROM sync_queue LIMIT 1");
    } catch {
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
    const surahInfoCount = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM surah_info");
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
  await writeSetting(db, CONTENT_IMPORT_MARKER, "1");

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Import] All imports complete in ${elapsed}s`);
  onProgress({ step: "Complete", current: TOTAL_STEPS, total: TOTAL_STEPS, detail: `Done in ${elapsed}s` });
}
