#!/usr/bin/env node


const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.quran.com/api/v4";
const OUTPUT_FILE = path.join(__dirname, "../assets/data/layout/page-words.json");

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;

async function fetchPage(pageNumber) {
  const url = `${API_BASE}/verses/by_page/${pageNumber}?words=true&word_fields=code_v2,line_number&per_page=50`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error for page ${pageNumber}: ${res.status}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("Fetching per-word line mapping from quran.com API...");
  console.log(`604 pages in batches of ${BATCH_SIZE}\n`);

  const pageWords = new Array(604).fill(null);

  for (let startPage = 1; startPage <= 604; startPage += BATCH_SIZE) {
    const endPage = Math.min(startPage + BATCH_SIZE - 1, 604);
    const batch = [];

    for (let p = startPage; p <= endPage; p++) {
      batch.push(
        fetchPage(p).then((data) => {
          const lineMap = {};

          for (const verse of data.verses) {
            for (const w of verse.words) {
              const ln = String(w.line_number);
              if (!lineMap[ln]) lineMap[ln] = [];
              lineMap[ln].push(w.code_v2);
            }
          }

          const result = {};
          for (const [ln, words] of Object.entries(lineMap)) {
            result[ln] = words.join(" ");
          }

          pageWords[p - 1] = result;
          return p;
        })
      );
    }

    await Promise.all(batch);
    const done = Math.min(endPage, 604);
    if (done % 100 === 0 || done === 604) {
      console.log(`  ${done}/604 pages...`);
    }

    if (endPage < 604) await sleep(BATCH_DELAY_MS);
  }

  const missing = pageWords.reduce((acc, p, i) => (p === null ? [...acc, i + 1] : acc), []);
  if (missing.length > 0) {
    console.error("Missing pages:", missing);
    process.exit(1);
  }

  const p560 = pageWords[559];
  const line12words = p560["12"].split(/\s+/).filter(Boolean).length;
  const line14words = p560["14"].split(/\s+/).filter(Boolean).length;
  console.log(`\nPage 560 line 12: ${line12words} words`);
  console.log(`Page 560 line 14: ${line14words} words`);

  let totalLines = 0;
  let totalWords = 0;
  for (const page of pageWords) {
    for (const [ln, text] of Object.entries(page)) {
      totalLines++;
      totalWords += text.split(/\s+/).filter(Boolean).length;
    }
  }
  console.log(`\nTotal: ${totalLines} lines, ${totalWords} words across 604 pages`);

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(pageWords));
  const sizeMB = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`Saved to ${OUTPUT_FILE} (${sizeMB} MB)`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
