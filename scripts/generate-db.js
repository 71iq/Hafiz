const fs = require("fs");
const path = require("path");
const https = require("https");
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

const MORPHOLOGY_URL =
  "https://raw.githubusercontent.com/mustafa0x/quran-morphology/master/quran-morphology.txt";
const MORPHOLOGY_PATH = path.join(DATA_DIR, "quran-morphology.txt");

// Download a file from URL if not already cached locally
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      console.log(`  Using cached ${path.basename(dest)}`);
      return resolve();
    }
    console.log(`  Downloading ${path.basename(dest)}...`);
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          // Follow redirect
          file.close();
          fs.unlinkSync(dest);
          return downloadFile(response.headers.location, dest).then(resolve, reject);
        }
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
      })
      .on("error", (err) => {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
  });
}

// Parse morphology file: tab-delimited with surah:ayah:word:segment, arabic, POS, features
function parseMorphology(filePath) {
  const lines = fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"));

  const wordRoots = [];
  const seen = new Set(); // deduplicate by surah:ayah:word

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 4) continue;

    const [position, wordText, , features] = parts;
    if (!features || !features.includes("ROOT:")) continue;

    const posParts = position.split(":");
    if (posParts.length < 3) continue;
    const surah = parseInt(posParts[0], 10);
    const ayah = parseInt(posParts[1], 10);
    const wordPos = parseInt(posParts[2], 10);

    const key = `${surah}:${ayah}:${wordPos}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Extract ROOT and LEM from features like "ROOT:رحم|LEM:رَحْمٰن|MS|GEN|ADJ"
    let root = "";
    let lemma = "";
    for (const feat of features.split("|")) {
      if (feat.startsWith("ROOT:")) root = feat.slice(5);
      else if (feat.startsWith("LEM:")) lemma = feat.slice(4);
    }

    if (root) {
      wordRoots.push({ surah, ayah, wordPos, wordText, root, lemma: lemma || wordText });
    }
  }

  return wordRoots;
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

async function main() {
// Download morphology data
console.log("Downloading morphology data...");
await downloadFile(MORPHOLOGY_URL, MORPHOLOGY_PATH);

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

  CREATE TABLE word_roots (
    surah    INTEGER NOT NULL,
    ayah     INTEGER NOT NULL,
    word_pos INTEGER NOT NULL,
    word_text TEXT NOT NULL,
    root     TEXT NOT NULL,
    lemma    TEXT NOT NULL,
    PRIMARY KEY (surah, ayah, word_pos)
  );

  CREATE INDEX idx_word_roots_root ON word_roots(root);

  CREATE TABLE hizb_map (
    hizb       INTEGER PRIMARY KEY,
    surah_start INTEGER NOT NULL,
    ayah_start  INTEGER NOT NULL,
    surah_end   INTEGER NOT NULL,
    ayah_end    INTEGER NOT NULL
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

// Insert hizb_map
const hizbData = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "hizb.json"), "utf-8")
);

// Build surah ayah count lookup
const surahAyahCounts = new Map();
for (const s of surahs) surahAyahCounts.set(s.number, s.ayah_count);

const insertHizb = db.prepare(
  "INSERT INTO hizb_map (hizb, surah_start, ayah_start, surah_end, ayah_end) VALUES (?, ?, ?, ?, ?)"
);

const insertManyHizb = db.transaction((rows) => {
  for (let i = 0; i < rows.length; i++) {
    const start = rows[i];
    let endSurah, endAyah;
    if (i + 1 < rows.length) {
      // End is one ayah before the start of the next hizb
      const nextStart = rows[i + 1];
      if (nextStart.ayah > 1) {
        endSurah = nextStart.surah;
        endAyah = nextStart.ayah - 1;
      } else {
        // Next hizb starts at ayah 1 of a surah, so this hizb ends at the last ayah of the previous surah
        endSurah = nextStart.surah - 1;
        endAyah = surahAyahCounts.get(endSurah) || 1;
      }
    } else {
      // Last hizb ends at 114:6
      endSurah = 114;
      endAyah = 6;
    }
    insertHizb.run(start.hizb, start.surah, start.ayah, endSurah, endAyah);
  }
});

insertManyHizb(hizbData);
console.log(`  Inserted ${hizbData.length} hizb_map entries`);

// Parse and insert morphology (word roots)
console.log("Parsing morphology data...");
const wordRoots = parseMorphology(MORPHOLOGY_PATH);
console.log(`  Parsed ${wordRoots.length} word roots`);

const insertWordRoot = db.prepare(
  "INSERT INTO word_roots (surah, ayah, word_pos, word_text, root, lemma) VALUES (?, ?, ?, ?, ?, ?)"
);

const insertManyWordRoots = db.transaction((rows) => {
  for (const r of rows) {
    insertWordRoot.run(r.surah, r.ayah, r.wordPos, r.wordText, r.root, r.lemma);
  }
});

insertManyWordRoots(wordRoots);
console.log(`  Inserted ${wordRoots.length} word_roots entries`);

// Generate JSON dump for web platform (expo-sqlite deserialize is broken on web)
console.log("Generating JSON dump for web...");
const JSON_PATH = path.join(__dirname, "..", "public", "quran-data.json");
const jsonDump = {
  tables: {
    surahs: db.prepare("SELECT * FROM surahs").all(),
    quran_text: db.prepare("SELECT * FROM quran_text").all(),
    juz_map: db.prepare("SELECT * FROM juz_map").all(),
    word_roots: db.prepare("SELECT * FROM word_roots").all(),
    hizb_map: db.prepare("SELECT * FROM hizb_map").all(),
  },
};
fs.writeFileSync(JSON_PATH, JSON.stringify(jsonDump));
const jsonStats = fs.statSync(JSON_PATH);
console.log(`  JSON dump: ${(jsonStats.size / 1024 / 1024).toFixed(1)} MB`);

db.close();

const stats = fs.statSync(DB_PATH);
console.log(
  `\nDone! Database saved to ${DB_PATH} (${(stats.size / 1024).toFixed(1)} KB)`
);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
