#!/usr/bin/env node

/**
 * Download Quran translations from quran.com API
 * Usage: node scripts/download-translations.js
 *
 * Fetches 20 language translations and saves as flat JSON arrays:
 * [{ "surah": 1, "ayah": 1, "text": "..." }, ...]
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const TRANSLATIONS = [
  { code: "id", id: 33, name: "Indonesian" },
  { code: "bn", id: 213, name: "Bengali" },
  { code: "ur", id: 54, name: "Urdu" },
  { code: "fa", id: 29, name: "Persian" },
  { code: "hi", id: 122, name: "Hindi" },
  { code: "tr", id: 77, name: "Turkish" },
  { code: "ha", id: 32, name: "Hausa" },
  { code: "fr", id: 31, name: "French" },
  { code: "ps", id: 118, name: "Pashto" },
  { code: "sd", id: 238, name: "Sindhi" },
  { code: "ru", id: 45, name: "Russian" },
  { code: "ku", id: 81, name: "Kurdish" },
  { code: "uz", id: 55, name: "Uzbek" },
  { code: "sw", id: 231, name: "Swahili" },
  { code: "om", id: 111, name: "Oromo" },
  { code: "am", id: 87, name: "Amharic" },
  { code: "so", id: 46, name: "Somali" },
  { code: "az", id: 75, name: "Azerbaijani" },
  { code: "kk", id: 222, name: "Kazakh" },
  { code: "ber", id: 236, name: "Tamazight" },
];

const OUT_DIR = path.join(__dirname, "..", "assets", "data", "translations");

// Standard Quran surah ayah counts (114 surahs, 6236 total)
const SURAH_AYAH_COUNTS = [
  7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,
  112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,
  89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,
  30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,
  15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function stripHtml(text) {
  // Remove <sup> footnotes and any other HTML tags
  let clean = text.replace(/<sup[^>]*>.*?<\/sup>/gi, "").replace(/<[^>]*>/g, "");
  // Decode common HTML entities
  clean = clean
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  return clean.trim();
}

async function downloadTranslation(trans) {
  const url = `https://api.quran.com/api/v4/quran/translations/${trans.id}`;
  console.log(`  Fetching ${trans.name} (${trans.code}) from API id ${trans.id}...`);

  const raw = await fetch(url);
  const json = JSON.parse(raw);

  if (!json.translations || !Array.isArray(json.translations)) {
    throw new Error(`Unexpected response for ${trans.code}: no translations array`);
  }

  // API returns translations in sequential order without verse_key.
  // Map to surah/ayah using known ayah counts.
  const rows = [];
  let idx = 0;
  for (let s = 0; s < 114; s++) {
    for (let a = 1; a <= SURAH_AYAH_COUNTS[s]; a++) {
      if (idx >= json.translations.length) break;
      rows.push({ surah: s + 1, ayah: a, text: stripHtml(json.translations[idx].text) });
      idx++;
    }
  }

  if (rows.length !== 6236) {
    console.warn(`  WARNING: ${trans.code} has ${rows.length} verses (expected 6236)`);
  }

  const outPath = path.join(OUT_DIR, `${trans.code}.json`);
  fs.writeFileSync(outPath, JSON.stringify(rows));
  console.log(`  Saved ${trans.code}.json (${rows.length} verses, ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Downloading ${TRANSLATIONS.length} translations to ${OUT_DIR}\n`);

  for (const trans of TRANSLATIONS) {
    try {
      await downloadTranslation(trans);
    } catch (err) {
      console.error(`  ERROR downloading ${trans.code}: ${err.message}`);
    }
    // Small delay to be polite to the API
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\nDone!");
}

main().catch(console.error);
