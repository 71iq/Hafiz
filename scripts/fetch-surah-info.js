#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "assets/data/surah-info.json");
const QURAN_COM_BASE = "https://api.quran.com/api/v4";
const QURANPEDIA_BASE = "https://api.quranpedia.net/v1";
const LANGUAGES = ["en", "ar"];

async function main() {
  const rows = [];

  for (let surah = 1; surah <= 114; surah++) {
    rows.push(await fetchEnglishInfo(surah));
    rows.push(await fetchArabicInfo(surah));
  }

  validateRows(rows);
  await fs.writeFile(OUT_FILE, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`Wrote ${rows.length} rows to ${path.relative(ROOT, OUT_FILE)}`);
}

async function fetchEnglishInfo(surah) {
  const sourceUrl = `${QURAN_COM_BASE}/chapters/${surah}/info?language=en`;
  const data = await fetchJson(sourceUrl);
  const info = data.chapter_info;
  const sections = htmlToSections(info?.text ?? "");
  return {
    surah,
    language: "en",
    summary: cleanText(info?.short_text ?? firstSectionText(sections)),
    sections,
    sourceName: cleanText(info?.source ?? "Quran.com Chapter Info"),
    sourceUrl,
  };
}

async function fetchArabicInfo(surah) {
  const sourceUrl = `${QURANPEDIA_BASE}/surah/information/${surah}`;
  const data = await fetchJson(sourceUrl);
  const intro = data.introduction;
  const title = cleanText(intro?.title ?? "Surah Information");
  const sections = htmlToSections(intro?.value ?? "", title);
  return {
    surah,
    language: "ar",
    summary: summarize(firstSectionText(sections)),
    sections,
    sourceName: "Quranpedia",
    sourceUrl,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Hafiz Surah Info Importer",
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${url}`);
  }
  return response.json();
}

function htmlToSections(html, fallbackTitle = null) {
  const prepared = String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "</li>\n")
    .replace(/<\/p>/gi, "</p>\n");
  const tagPattern = /<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  const sections = [];
  let current = fallbackTitle ? { title: fallbackTitle, paragraphs: [] } : null;
  let match;

  while ((match = tagPattern.exec(prepared))) {
    const tag = match[1].toLowerCase();
    const text = htmlToText(match[2]);
    if (!text) continue;

    if (tag.startsWith("h")) {
      if (current?.paragraphs.length) sections.push(current);
      current = { title: text, paragraphs: [] };
      continue;
    }

    if (!current) current = { title: fallbackTitle, paragraphs: [] };
    current.paragraphs.push(text);
  }

  if (current?.paragraphs.length) sections.push(current);
  if (sections.length === 0) {
    const text = htmlToText(prepared);
    if (text) sections.push({ title: fallbackTitle, paragraphs: [text] });
  }

  return sections
    .map((section) => ({
      title: section.title ? cleanText(section.title) : null,
      body: section.paragraphs.map(cleanText).filter(Boolean).join("\n\n"),
    }))
    .filter((section) => section.body.length > 0);
}

function htmlToText(html) {
  return decodeHtml(
    String(html ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function cleanText(value) {
  return decodeHtml(value)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function firstSectionText(sections) {
  return sections.find((section) => section.body)?.body ?? "";
}

function summarize(text) {
  const clean = cleanText(text).replace(/\n+/g, " ");
  if (clean.length <= 360) return clean;
  const sentenceEnd = clean.slice(0, 360).search(/[.!؟۔]\s/);
  if (sentenceEnd >= 120) return clean.slice(0, sentenceEnd + 1);
  return `${clean.slice(0, 340).trim()}...`;
}

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 228) {
    throw new Error(`Expected 228 rows, got ${rows.length}`);
  }

  for (const language of LANGUAGES) {
    const languageRows = rows.filter((row) => row.language === language);
    if (languageRows.length !== 114) {
      throw new Error(`Expected 114 ${language} rows, got ${languageRows.length}`);
    }
  }

  const seen = new Set();
  for (const row of rows) {
    const key = `${row.surah}:${row.language}`;
    if (seen.has(key)) throw new Error(`Duplicate row ${key}`);
    seen.add(key);
    if (!Number.isInteger(row.surah) || row.surah < 1 || row.surah > 114) {
      throw new Error(`Invalid surah in ${key}`);
    }
    if (!LANGUAGES.includes(row.language)) throw new Error(`Invalid language in ${key}`);
    if (!row.summary || !row.sourceName || !row.sourceUrl) {
      throw new Error(`Missing summary/source in ${key}`);
    }
    if (!Array.isArray(row.sections) || row.sections.length === 0) {
      throw new Error(`Missing sections in ${key}`);
    }
    for (const section of row.sections) {
      if (!section.body || hasHtml(section.body) || hasHtml(section.title ?? "")) {
        throw new Error(`Invalid section text in ${key}`);
      }
    }
  }
}

function hasHtml(text) {
  return /<\/?[a-z][\s\S]*>/i.test(text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
