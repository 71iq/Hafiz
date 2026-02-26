const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "quran-data");
const OUTPUT_DIR = path.join(__dirname, "..", "assets");
const DB_PATH = path.join(OUTPUT_DIR, "quran.db");

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Remove existing DB if present
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
}

// Parse Tanzil pipe-delimited text file: surah|ayah|text
function parseTanzilText(filePath) {
  const lines = fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"));
  return lines.map((line) => {
    const [surah, ayah, ...textParts] = line.split("|");
    return {
      surah: parseInt(surah, 10),
      ayah: parseInt(ayah, 10),
      text: textParts.join("|"), // rejoin in case text contains |
    };
  });
}

// Parse surah metadata JSON
function parseSurahMetadata(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return data.map((s) => ({
    number: parseInt(s.index, 10),
    name_arabic: s.titleAr,
    name_english: s.title,
    ayah_count: s.count,
    revelation_type: s.type,
  }));
}

console.log("Reading Quran data...");

const uthmaniRows = parseTanzilText(
  path.join(DATA_DIR, "quran-uthmani.txt")
);
const simpleRows = parseTanzilText(
  path.join(DATA_DIR, "quran-simple.txt")
);
const surahs = parseSurahMetadata(path.join(DATA_DIR, "surahs.json"));

console.log(`  Uthmani rows: ${uthmaniRows.length}`);
console.log(`  Simple rows:  ${simpleRows.length}`);
console.log(`  Surahs:       ${surahs.length}`);

// Build a lookup for simple text keyed by "surah:ayah"
const simpleMap = new Map();
for (const row of simpleRows) {
  simpleMap.set(`${row.surah}:${row.ayah}`, row.text);
}

console.log("Creating SQLite database...");

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE quran_text (
    surah   INTEGER NOT NULL,
    ayah    INTEGER NOT NULL,
    text_uthmani TEXT NOT NULL,
    text_clean   TEXT NOT NULL,
    PRIMARY KEY (surah, ayah)
  );

  CREATE TABLE surahs (
    number          INTEGER PRIMARY KEY,
    name_arabic     TEXT NOT NULL,
    name_english    TEXT NOT NULL,
    ayah_count      INTEGER NOT NULL,
    revelation_type TEXT NOT NULL
  );

  CREATE TABLE juz_map (
    juz        INTEGER NOT NULL,
    surah      INTEGER NOT NULL,
    ayah_start INTEGER NOT NULL,
    ayah_end   INTEGER NOT NULL,
    PRIMARY KEY (juz, surah, ayah_start)
  );
`);

// Insert ayahs
const insertAyah = db.prepare(
  "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean) VALUES (?, ?, ?, ?)"
);

const insertManyAyahs = db.transaction((rows) => {
  for (const row of rows) {
    const clean = simpleMap.get(`${row.surah}:${row.ayah}`) || "";
    insertAyah.run(row.surah, row.ayah, row.text, clean);
  }
});

insertManyAyahs(uthmaniRows);
console.log(`  Inserted ${uthmaniRows.length} ayahs`);

// Insert surahs
const insertSurah = db.prepare(
  "INSERT INTO surahs (number, name_arabic, name_english, ayah_count, revelation_type) VALUES (?, ?, ?, ?, ?)"
);

const insertManySurahs = db.transaction((rows) => {
  for (const s of rows) {
    insertSurah.run(
      s.number,
      s.name_arabic,
      s.name_english,
      s.ayah_count,
      s.revelation_type
    );
  }
});

insertManySurahs(surahs);
console.log(`  Inserted ${surahs.length} surahs`);

// Insert juz_map from surahs.json juz data
const rawSurahs = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "surahs.json"), "utf-8")
);

const insertJuz = db.prepare(
  "INSERT INTO juz_map (juz, surah, ayah_start, ayah_end) VALUES (?, ?, ?, ?)"
);

const insertManyJuz = db.transaction((rows) => {
  for (const row of rows) {
    insertJuz.run(row.juz, row.surah, row.ayah_start, row.ayah_end);
  }
});

const juzRows = [];
for (const s of rawSurahs) {
  const surahNum = parseInt(s.index, 10);
  for (const j of s.juz) {
    const juzNum = parseInt(j.index, 10);
    const start = parseInt(j.verse.start.replace("verse_", ""), 10);
    const end = parseInt(j.verse.end.replace("verse_", ""), 10);
    juzRows.push({ juz: juzNum, surah: surahNum, ayah_start: start, ayah_end: end });
  }
}

insertManyJuz(juzRows);
console.log(`  Inserted ${juzRows.length} juz_map entries`);

db.close();

const stats = fs.statSync(DB_PATH);
console.log(
  `\nDone! Database saved to ${DB_PATH} (${(stats.size / 1024).toFixed(1)} KB)`
);
