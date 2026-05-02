const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const qcf2 = JSON.parse(fs.readFileSync(path.join(root, "assets/data/quran-qcf2.json"), "utf8"));
const pageWords = JSON.parse(fs.readFileSync(path.join(root, "assets/data/layout/page-words.json"), "utf8"));
const pageLines = JSON.parse(fs.readFileSync(path.join(root, "assets/data/layout/page-lines.json"), "utf8"));

function splitGlyphs(text) {
  return String(text || "").split(/\s+/).filter(Boolean);
}

function canonicalPageGlyphs(page) {
  return qcf2
    .filter((verse) => verse.v2_page === page)
    .flatMap((verse) => splitGlyphs(verse.code_v2));
}

function pageWordGlyphs(page) {
  const lines = pageWords[page - 1] || {};
  return Object.keys(lines)
    .sort((a, b) => Number(a) - Number(b))
    .flatMap((line) => splitGlyphs(lines[line]));
}

function pageLineRanges(page) {
  return pageLines
    .filter((line) => line.page_number === page && line.line_type === "ayah")
    .map((line) => ({
      line: line.line_number,
      first: Number(line.first_word_id),
      last: Number(line.last_word_id),
    }));
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function renderedPageGlyphs(page) {
  const canonical = canonicalPageGlyphs(page);
  const fromPageWords = pageWordGlyphs(page);
  if (arraysEqual(canonical, fromPageWords)) {
    return { glyphs: fromPageWords, source: "page-words" };
  }

  const ranges = pageLineRanges(page);
  const offset = Math.min(...ranges.map((range) => range.first)) - 1;
  const glyphs = [];

  ranges.forEach((range, index) => {
    const start = Math.max(0, range.first - offset - 1);
    let end = Math.max(start, range.last - offset);
    if (index === ranges.length - 1 && end < canonical.length) {
      end = canonical.length;
    }
    glyphs.push(...canonical.slice(start, end));
  });

  return { glyphs, source: "page-lines" };
}

const failures = [];
const fallbackPages = [];

for (let page = 1; page <= 604; page++) {
  const canonical = canonicalPageGlyphs(page);
  const rendered = renderedPageGlyphs(page);
  if (rendered.source === "page-lines") fallbackPages.push(page);

  if (!arraysEqual(canonical, rendered.glyphs)) {
    failures.push({
      page,
      source: rendered.source,
      canonical: canonical.length,
      rendered: rendered.glyphs.length,
      firstDiff: canonical.findIndex((glyph, index) => glyph !== rendered.glyphs[index]),
    });
  }
}

if (failures.length > 0) {
  console.error("[verify-mushaf-page-tokens] Failures:");
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}

console.log("[verify-mushaf-page-tokens] OK");
console.log(`Verified 604 pages. Used page_lines fallback on ${fallbackPages.length} pages: ${fallbackPages.join(", ")}`);
