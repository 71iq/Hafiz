#!/usr/bin/env node

import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = path.join(ROOT, "assets", "data");
const DB_PATH = path.join(DATA_DIR, "quran.db");
const SCHEMA_PATH = path.join(ROOT, "lib", "database", "schema.ts");

const ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0640]/g;
const NON_ARABIC_RE = /[^\u0600-\u06FF]/g;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, relativePath), "utf8"));
}

function stripHtml(html) {
  return String(html ?? "").replace(/<[^>]*>/g, "").trim();
}

function stripDiacritics(text) {
  return String(text ?? "").replace(ARABIC_DIACRITICS_RE, "");
}

function normalizeArabicWord(text) {
  return String(text ?? "")
    .replace(ARABIC_DIACRITICS_RE, "")
    .replace(/[ٱأإآ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(NON_ARABIC_RE, "")
    .trim();
}

function normalizeArabicCore(text) {
  let normalized = normalizeArabicWord(text);
  while (normalized.length > 3 && /^[وفبكس]/.test(normalized)) {
    normalized = normalized.slice(1);
  }
  while (normalized.length > 3 && normalized.startsWith("لل")) {
    normalized = normalized.slice(1);
  }
  if (normalized.length > 3 && normalized.startsWith("ال")) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/\0/g, "").replace(/'/g, "''")}'`;
}

function extractCreateSchemaSql() {
  const source = fs.readFileSync(SCHEMA_PATH, "utf8");
  const match = source.match(/export async function createSchema[\s\S]*?await db\.execAsync\(`([\s\S]*?)`\);/);
  if (!match) {
    throw new Error("Could not extract createSchema SQL from lib/database/schema.ts");
  }
  return match[1];
}

class SqliteWriter {
  constructor(dbPath) {
    this.child = spawn("sqlite3", [dbPath], {
      cwd: ROOT,
      stdio: ["pipe", "inherit", "inherit"],
    });
    this.exited = false;
    this.exitCode = null;
    this.child.on("exit", (code) => {
      this.exited = true;
      this.exitCode = code;
    });
  }

  async write(sql) {
    if (this.exited) {
      throw new Error(`sqlite3 exited early with code ${this.exitCode}`);
    }
    if (!this.child.stdin.write(sql)) {
      await once(this.child.stdin, "drain");
    }
  }

  async exec(sql) {
    await this.write(`${sql.trim()}\n`);
  }

  async insertRows(table, columns, rows, batchSize = 250) {
    if (rows.length === 0) return;
    const columnSql = columns.join(", ");
    await this.exec("BEGIN;");
    for (let i = 0; i < rows.length; i += batchSize) {
      const values = rows
        .slice(i, i + batchSize)
        .map((row) => `(${row.map(sqlValue).join(", ")})`)
        .join(",\n");
      await this.write(`INSERT OR REPLACE INTO ${table} (${columnSql}) VALUES\n${values};\n`);
    }
    await this.exec("COMMIT;");
  }

  async close() {
    this.child.stdin.end();
    const [code] = await once(this.child, "exit");
    if (code !== 0) {
      throw new Error(`sqlite3 exited with code ${code}`);
    }
  }
}

function splitArabicParts(text) {
  return String(text ?? "")
    .split(/\s+/)
    .map(normalizeArabicWord)
    .filter(Boolean);
}

function arabicVariants(value) {
  const core = normalizeArabicCore(value);
  const variants = [value, core];
  if (core.length > 2 && core.startsWith("ا")) variants.push(core.slice(1));
  return Array.from(new Set(variants.filter((v) => v.length > 0)));
}

function compatibleArabicToken(a, b) {
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

function buildSourceWordMatch(text) {
  const parts = splitArabicParts(text);
  if (parts.length === 0) return null;
  return {
    parts,
    text: parts.join(""),
    coreText: parts.map(normalizeArabicCore).join(""),
  };
}

function scoreCanonicalSpan(canonicalWords, start, end, source) {
  const span = canonicalWords.slice(start, end);
  if (span.length === 0 || source.parts.length === 0) return -1;

  const spanParts = span.map((word) => word.normalized).filter(Boolean);
  const spanText = spanParts.join("");
  const spanCore = span.map((word) => word.core).join("");

  let score = -1;
  if (
    spanParts.length === source.parts.length &&
    spanParts.every((part, index) => compatibleArabicToken(part, source.parts[index]))
  ) {
    score = 1000;
  } else if (spanText === source.text) {
    score = 920;
  } else if (spanCore && source.coreText && spanCore === source.coreText) {
    score = 880;
  } else {
    const min = Math.min(spanText.length, source.text.length);
    if (min >= 4 && (spanText.endsWith(source.text) || source.text.endsWith(spanText))) {
      score = 760;
    } else if (min >= 5 && (spanText.includes(source.text) || source.text.includes(spanText))) {
      score = 620;
    }
  }

  if (score < 0) return -1;
  score -= Math.abs(spanParts.length - source.parts.length) * 20;
  score -= spanParts.length;
  return score;
}

function findCanonicalSpan(canonicalWords, source, cursor) {
  if (canonicalWords.length === 0 || source.parts.length === 0) return null;

  let best = null;
  const scan = (from) => {
    for (let start = from; start < canonicalWords.length; start++) {
      const maxEnd = Math.min(canonicalWords.length, start + Math.max(source.parts.length + 2, 3));
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
  return best ? { start: best.start, end: best.end } : null;
}

function appendMappedWordRow(rowsByKey, surah, ayah, wordPos, word, value, valueSeparator) {
  const key = `${surah}:${ayah}:${wordPos}`;
  const existing = rowsByKey.get(key);
  if (!existing) {
    rowsByKey.set(key, [surah, ayah, wordPos, word, value]);
    return;
  }

  if (word && existing[3] && !existing[3].includes(word)) {
    existing[3] = `${existing[3]} / ${word}`;
  } else if (word && !existing[3]) {
    existing[3] = word;
  }

  if (value && existing[4] && !existing[4].includes(value)) {
    existing[4] = `${existing[4]}${valueSeparator}${value}`;
  } else if (value && !existing[4]) {
    existing[4] = value;
  }
}

function buildCanonicalWordsByAyah(masaqData) {
  const byAyah = new Map();
  for (const row of masaqData) {
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

function mapRowsToCanonicalWords(canonicalByAyah, sourceRows, getTargets, getValue, valueSeparator) {
  const cursors = new Map();
  const rowsByKey = new Map();

  for (const source of sourceRows) {
    const word = source.word ? String(source.word) : null;
    const wordMatch = buildSourceWordMatch(word);
    if (!wordMatch) continue;
    const value = getValue(source);
    for (const target of getTargets(source)) {
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

function buildQiraatRows(data) {
  const objects = new Map();
  const refs = [];
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (typeof value === "string") {
      refs.push([key, value]);
    } else if (value && typeof value === "object" && typeof value.text === "string") {
      const group = Array.isArray(value.ayah_keys) && value.ayah_keys.length > 0
        ? value.ayah_keys.map(String)
        : [key];
      objects.set(key, { text: stripHtml(value.text), group });
    }
  }

  const rowsByKey = new Map();
  for (const [key, entry] of objects) {
    const groupJson = JSON.stringify(entry.group);
    for (const groupKey of entry.group) {
      const [surah, ayah] = groupKey.split(":").map((n) => parseInt(n, 10));
      if (Number.isFinite(surah) && Number.isFinite(ayah)) {
        rowsByKey.set(groupKey, [surah, ayah, entry.text, groupJson]);
      }
    }
    const [surah, ayah] = key.split(":").map((n) => parseInt(n, 10));
    if (Number.isFinite(surah) && Number.isFinite(ayah) && !rowsByKey.has(key)) {
      rowsByKey.set(key, [surah, ayah, entry.text, groupJson]);
    }
  }

  for (const [key, target] of refs) {
    const resolved = rowsByKey.get(target);
    if (!resolved) continue;
    const [surah, ayah] = key.split(":").map((n) => parseInt(n, 10));
    if (Number.isFinite(surah) && Number.isFinite(ayah)) {
      rowsByKey.set(key, [surah, ayah, resolved[2], resolved[3]]);
    }
  }

  return Array.from(rowsByKey.values());
}

function buildMutashabihatRows(data) {
  const groupRows = [];
  const refRows = [];
  let sortOrder = 0;

  const appendGroups = (groups, kind) => {
    for (const group of groups) {
      const refs = Array.isArray(group.refs) ? group.refs : [];
      const validRefs = refs.filter((ref) => Number.isInteger(ref.surah) && Number.isInteger(ref.ayah));
      if (validRefs.length < 2) continue;

      const id = typeof group.id === "string" ? group.id : null;
      const cue = kind === "similar" ? group.phrase : group.tail;
      if (!id || typeof cue !== "string" || cue.trim().length === 0) continue;

      groupRows.push([id, kind, cue.trim(), String(group.source ?? data.source?.name ?? "nourquran"), sortOrder++]);
      validRefs.forEach((ref, index) => {
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

  appendGroups(Array.isArray(data.similar_groups) ? data.similar_groups : [], "similar");
  appendGroups(Array.isArray(data.tail_groups) ? data.tail_groups : [], "tail");
  return { groupRows, refRows };
}

function buildReflectionJourneyRows(data) {
  if (!Array.isArray(data.levels)) return [];
  return data.levels.map((level) => [
    level.id,
    level.slug,
    level.order,
    level.title?.en,
    level.title?.ar,
    level.summary?.en ?? null,
    level.summary?.ar ?? null,
    level.responsePrompt?.en,
    level.responsePrompt?.ar,
    level.estimatedMinutes ?? null,
    JSON.stringify(level.blocks ?? []),
  ]);
}

async function main() {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
  }

  const db = new SqliteWriter(DB_PATH);
  const quranData = readJson("quran-data.json");
  const qcf2Data = readJson("quran-qcf2.json");
  const masaqData = readJson("masaq/masaq-aggregated.json");

  await db.exec(".bail on");
  await db.exec(extractCreateSchemaSql());

  const qcf2Map = new Map(qcf2Data.map((row) => [row.verse_key, row]));
  const canonicalByAyah = buildCanonicalWordsByAyah(masaqData);

  await db.insertRows("surahs", ["number", "name_arabic", "name_english", "ayah_count", "revelation_type"],
    quranData.tables.surahs.map((row) => [row.number, row.name_arabic, row.name_english, row.ayah_count, row.revelation_type]));

  await db.insertRows("quran_text", ["surah", "ayah", "text_uthmani", "text_clean", "text_qcf2", "v2_page", "text_search"],
    quranData.tables.quran_text.map((row) => {
      const qcf2 = qcf2Map.get(`${row.surah}:${row.ayah}`);
      return [row.surah, row.ayah, row.text_uthmani, row.text_clean, qcf2?.code_v2 ?? "", qcf2?.v2_page ?? 0, stripDiacritics(row.text_clean)];
    }));

  await db.insertRows("juz_map", ["juz", "surah", "ayah_start", "ayah_end"],
    quranData.tables.juz_map.map((row) => [row.juz, row.surah, row.ayah_start, row.ayah_end]));

  await db.insertRows("hizb_map", ["hizb", "surah_start", "ayah_start", "surah_end", "ayah_end"],
    quranData.tables.hizb_map.map((row) => [row.hizb, row.surah_start, row.ayah_start, row.surah_end, row.ayah_end]));

  await db.insertRows("word_roots", ["surah", "ayah", "word_pos", "word_text", "root", "lemma"],
    quranData.tables.word_roots.map((row) => [row.surah, row.ayah, row.word_pos, row.word_text, row.root ?? null, row.lemma ?? null]));

  await db.insertRows("surah_info", ["surah", "language", "summary", "sections_json", "source_name", "source_url"],
    readJson("surah-info.json").map((entry) => [entry.surah, entry.language, entry.summary, JSON.stringify(Array.isArray(entry.sections) ? entry.sections : []), entry.sourceName, entry.sourceUrl ?? null]));

  await db.insertRows("page_map", ["page", "surah_start", "ayah_start", "surah_end", "ayah_end"],
    readJson("page-map.json").map((row) => [row.page, row.start.surah_number, row.start.verse, row.end.surah_number, row.end.verse]));

  await db.insertRows("page_lines", ["page_number", "line_number", "line_type", "is_centered", "first_word_id", "last_word_id", "surah_number"],
    readJson("layout/page-lines.json").map((row) => [row.page_number, row.line_number, row.line_type, row.is_centered, row.first_word_id === "" ? null : row.first_word_id, row.last_word_id === "" ? null : row.last_word_id, row.surah_number === "" ? null : row.surah_number]));

  const muyassarRows = [];
  for (let surah = 1; surah <= 114; surah++) {
    const data = readJson(`tafseer/${surah}.json`);
    const ayahs = data.ayahs || data;
    for (const entry of ayahs) {
      muyassarRows.push([entry.surah ?? surah, entry.ayah, "muyassar", entry.text]);
    }
  }
  await db.insertRows("tafseer", ["surah", "ayah", "source", "text"], muyassarRows, 100);

  const zilalRows = [];
  const zilalData = readJson("zilal.json").data;
  for (const surahNum of Object.keys(zilalData)) {
    const surah = zilalData[surahNum];
    if (!surah?.ayahs) continue;
    for (const ayahNum of Object.keys(surah.ayahs)) {
      const entry = surah.ayahs[ayahNum];
      if (entry?.tafsir?.trim()) {
        zilalRows.push([parseInt(surahNum, 10), parseInt(ayahNum, 10), "zilal", entry.tafsir]);
      }
    }
  }
  await db.insertRows("tafseer", ["surah", "ayah", "source", "text"], zilalRows, 50);

  const translationRows = [];
  for (const surah of readJson("translation-sahih.json")) {
    for (const verse of surah.verses) {
      translationRows.push([surah.id, verse.id, verse.translation]);
    }
  }
  await db.insertRows("translations", ["surah", "ayah", "text_en"], translationRows);

  await db.insertRows("word_translations", ["surah", "ayah", "word_pos", "word_arabic", "translation_en", "transliteration"],
    readJson("wbw/wbw.json").map((row) => [row.surah_number, row.ayah_number, row.word_number, null, stripHtml(row.text), null]));

  await db.insertRows("word_irab", ["surah", "ayah", "word_pos", "arabic_word", "morphological_tag", "syntactic_function", "root", "lemma", "pattern"],
    masaqData.map((row) => [row.surah, row.ayah, row.word_pos, row.arabic_word ?? null, row.morphological_tag ?? null, row.syntactic_function ?? null, null, null, null]));

  const tajweedRows = [];
  for (const ayah of readJson("tajweed.json")) {
    for (const annotation of ayah.annotations ?? []) {
      tajweedRows.push([ayah.surah, ayah.ayah, annotation.rule, annotation.start, annotation.end]);
    }
  }
  await db.insertRows("tajweed_rules", ["surah", "ayah", "rule", "start_offset", "end_offset"], tajweedRows);

  const wordMeaningRows = mapRowsToCanonicalWords(
    canonicalByAyah,
    readJson("wbw-arabic-meanings.json"),
    (row) => [`${row.surah}:${row.ayah}`],
    (row) => row.meaning ? String(row.meaning) : null,
    "\n\n",
  );
  await db.insertRows("word_meanings_ar", ["surah", "ayah", "word_pos", "word", "meaning"], wordMeaningRows, 100);

  const daasRows = mapRowsToCanonicalWords(
    canonicalByAyah,
    readJson("irab-per-word.json"),
    (row) => Array.isArray(row.ayah_group) && row.ayah_group.length > 0 ? row.ayah_group.map(String) : [`${row.surah}:${row.ayah}`],
    (row) => row.irab ? stripHtml(String(row.irab)) : null,
    "\n",
  );
  await db.insertRows("word_irab_daas", ["surah", "ayah", "word_pos", "word", "irab"], daasRows, 100);

  const tajweedRulesAr = readJson("tajweed-rules-ar.json");
  await db.insertRows("tajweed_rules_ar", ["rule_key", "name_ar", "short_ar", "description_ar"],
    Object.keys(tajweedRulesAr).filter((key) => !key.startsWith("_")).map((key) => [key, tajweedRulesAr[key]?.name_ar ?? null, tajweedRulesAr[key]?.short_ar ?? null, tajweedRulesAr[key]?.description_ar ?? null]));

  const tajweedRulesEn = readJson("tajweed-rules-en.json");
  await db.insertRows("tajweed_rules_en", ["rule_key", "name", "name_ar", "short", "description"],
    Object.keys(tajweedRulesEn).filter((key) => !key.startsWith("_")).map((key) => [key, tajweedRulesEn[key]?.name ?? null, tajweedRulesEn[key]?.name_ar ?? null, tajweedRulesEn[key]?.short ?? null, tajweedRulesEn[key]?.description ?? null]));

  await db.insertRows("qiraat_encyclopedia", ["surah", "ayah", "text", "ayah_group"],
    buildQiraatRows(readJson("al-qira-at-al-mawsoo-ah-al-qur-aniyyah.json")), 100);

  const mutashabihat = buildMutashabihatRows(readJson("mutashabihat/nourquran_hafiz.json"));
  await db.insertRows("mutashabihat_groups", ["id", "kind", "cue", "source", "sort_order"], mutashabihat.groupRows);
  await db.insertRows("mutashabihat_refs", ["group_id", "sort_order", "surah", "ayah", "surah_name_ar", "tail_5", "pre_text", "similar_text", "post_text"], mutashabihat.refRows, 100);

  await db.insertRows("reflection_journey_levels", ["id", "slug", "order_index", "title_en", "title_ar", "summary_en", "summary_ar", "response_prompt_en", "response_prompt_ar", "estimated_minutes", "content_json"],
    buildReflectionJourneyRows(readJson("reflection-journey.json")), 100);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tafseer_source ON tafseer(source);
    CREATE INDEX IF NOT EXISTS idx_quran_text_search ON quran_text(text_search);
    CREATE INDEX IF NOT EXISTS idx_word_roots_surah_ayah_pos ON word_roots(surah, ayah, word_pos);
    PRAGMA user_version = 1;
    PRAGMA wal_checkpoint(TRUNCATE);
    PRAGMA journal_mode = DELETE;
    VACUUM;
  `);
  await db.close();

  for (const suffix of ["-wal", "-shm"]) {
    fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
  }

  const sizeMb = fs.statSync(DB_PATH).size / 1024 / 1024;
  console.log(`Built ${path.relative(ROOT, DB_PATH)} (${sizeMb.toFixed(1)} MB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
