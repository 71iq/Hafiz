#!/usr/bin/env node

/**
 * Verify bundled translations against quran.com API.
 * For each language, fetches 5 specific verses from the API and compares
 * with our bundled JSON to ensure correct surah/ayah mapping and text.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// Language code -> API resource_id mapping
const LANGUAGES = {
  en: 20, id: 33, bn: 213, ur: 54, fa: 29, hi: 122, tr: 77,
  ha: 32, fr: 31, ps: 118, sd: 238, ru: 45, ku: 81, uz: 55,
  sw: 231, om: 111, am: 87, so: 46, az: 75, kk: 222, ber: 236,
};

// 5 well-known verses to check (spread across the Quran)
const TEST_VERSES = [
  { surah: 1, ayah: 1 },   // Al-Fatiha opening
  { surah: 2, ayah: 255 },  // Ayat al-Kursi
  { surah: 36, ayah: 1 },   // Ya-Sin opening
  { surah: 112, ayah: 1 },  // Al-Ikhlas
  { surah: 114, ayah: 6 },  // An-Nas last verse
];

const TRANSLATIONS_DIR = path.join(__dirname, "..", "assets", "data", "translations");
const EN_FILE = path.join(__dirname, "..", "assets", "data", "translation-sahih.json");

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
  let clean = text.replace(/<sup[^>]*>.*?<\/sup>/gi, "").replace(/<[^>]*>/g, "");
  clean = clean.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  return clean.trim();
}

function getLocalVerse(code, surah, ayah) {
  if (code === "en") {
    const data = require(EN_FILE);
    const surahData = data.find(s => s.id === surah);
    if (!surahData) return null;
    const verse = surahData.verses.find(v => v.id === ayah);
    return verse ? verse.translation : null;
  }
  const filePath = path.join(TRANSLATIONS_DIR, `${code}.json`);
  if (!fs.existsSync(filePath)) return null;
  const data = require(filePath);
  const row = data.find(r => r.surah === surah && r.ayah === ayah);
  return row ? row.text : null;
}

async function fetchApiVerse(resourceId, surah, ayah) {
  // Use per-verse endpoint
  const url = `https://api.quran.com/api/v4/quran/translations/${resourceId}?verse_key=${surah}:${ayah}`;
  const raw = await fetch(url);
  const json = JSON.parse(raw);
  if (json.translations && json.translations.length > 0) {
    return stripHtml(json.translations[0].text);
  }
  return null;
}

async function verifyLanguage(code, resourceId) {
  const results = [];
  for (const { surah, ayah } of TEST_VERSES) {
    const local = getLocalVerse(code, surah, ayah);
    let api;
    try {
      api = await fetchApiVerse(resourceId, surah, ayah);
    } catch (e) {
      api = `ERROR: ${e.message}`;
    }

    const match = local !== null && api !== null && local === api;
    const localPreview = local ? local.slice(0, 80) : "MISSING";
    const apiPreview = api ? api.slice(0, 80) : "MISSING";

    results.push({
      verse: `${surah}:${ayah}`,
      match,
      localPreview,
      apiPreview: match ? "(same)" : apiPreview,
    });
  }
  return results;
}

async function main() {
  const codes = Object.keys(LANGUAGES);
  console.log(`Verifying ${codes.length} languages, ${TEST_VERSES.length} verses each\n`);

  const summary = {};

  for (const code of codes) {
    const resourceId = LANGUAGES[code];
    process.stdout.write(`[${code.toUpperCase().padEnd(3)}] Checking... `);

    try {
      const results = await verifyLanguage(code, resourceId);
      const allMatch = results.every(r => r.match);
      const matchCount = results.filter(r => r.match).length;

      console.log(allMatch ? `PASS (${matchCount}/${results.length})` : `ISSUES (${matchCount}/${results.length})`);

      if (!allMatch) {
        for (const r of results) {
          if (!r.match) {
            console.log(`    ${r.verse}: LOCAL="${r.localPreview}"`);
            console.log(`    ${r.verse}: API  ="${r.apiPreview}"`);
          }
        }
      }

      summary[code] = { pass: allMatch, matchCount, total: results.length, results };
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      summary[code] = { pass: false, error: e.message };
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  console.log("\n=== SUMMARY ===");
  let passCount = 0;
  for (const [code, s] of Object.entries(summary)) {
    const status = s.pass ? "PASS" : s.error ? "ERROR" : "ISSUES";
    console.log(`  ${code.toUpperCase().padEnd(3)}: ${status}${s.matchCount !== undefined ? ` (${s.matchCount}/${s.total})` : ''}`);
    if (s.pass) passCount++;
  }
  console.log(`\n${passCount}/${codes.length} languages fully verified`);
}

main().catch(console.error);
