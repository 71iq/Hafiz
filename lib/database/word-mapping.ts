import { normalizeArabicCore, normalizeArabicWord } from "@/lib/arabic";

export type CanonicalWord = {
  pos: number;
  word: string;
  normalized: string;
  core: string;
};

type SourceWordMatch = {
  parts: string[];
  text: string;
  coreText: string;
};

export type MappedWordRow = [number, number, number, string | null, string | null];

// quran-words.com and Da'as use source-local entry indices; map by Arabic
// text to MASAQ's canonical Mushaf word positions before storing them.
function splitArabicParts(text: string | null | undefined): string[] {
  return String(text ?? "")
    .split(/\s+/)
    .map(normalizeArabicWord)
    .filter(Boolean);
}

// The first-run import scores many candidate spans for every source word (RF195). Variants and
// span strings depend only on their inputs, so they are computed once per mapping run.
const variantCache = new Map<string, string[]>();

function arabicVariants(value: string): string[] {
  const cached = variantCache.get(value);
  if (cached) return cached;
  const variants = computeArabicVariants(value);
  variantCache.set(value, variants);
  return variants;
}

function computeArabicVariants(value: string): string[] {
  const core = normalizeArabicCore(value);
  const variants = [value, core];
  if (core.length > 2 && core.startsWith("ا")) variants.push(core.slice(1));
  return Array.from(new Set(variants.filter((v) => v.length > 0)));
}

function compatibleArabicToken(a: string, b: string): boolean {
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

function buildSourceWordMatch(text: string | null | undefined): SourceWordMatch | null {
  const parts = splitArabicParts(text);
  if (parts.length === 0) return null;
  const coreParts = parts.map(normalizeArabicCore);
  return {
    parts,
    text: parts.join(""),
    coreText: coreParts.join(""),
  };
}

type CanonicalSpan = { parts: string[]; text: string; core: string };
const spanCache = new WeakMap<CanonicalWord[], Map<number, CanonicalSpan>>();

function canonicalSpan(canonicalWords: CanonicalWord[], start: number, end: number): CanonicalSpan {
  let spans = spanCache.get(canonicalWords);
  if (!spans) {
    spans = new Map();
    spanCache.set(canonicalWords, spans);
  }
  const key = start * 65536 + end;
  let span = spans.get(key);
  if (!span) {
    const words = canonicalWords.slice(start, end);
    const parts = words.map((w) => w.normalized).filter(Boolean);
    span = { parts, text: parts.join(""), core: words.map((w) => w.core).join("") };
    spans.set(key, span);
  }
  return span;
}

function scoreCanonicalSpan(
  canonicalWords: CanonicalWord[],
  start: number,
  end: number,
  source: SourceWordMatch,
): number {
  if (end <= start || source.parts.length === 0) return -1;

  const { parts: spanParts, text: spanText, core: spanCore } = canonicalSpan(canonicalWords, start, end);
  const sourceText = source.text;
  const sourceCore = source.coreText;

  let score = -1;
  if (
    spanParts.length === source.parts.length &&
    spanParts.every((part, index) => compatibleArabicToken(part, source.parts[index]))
  ) {
    score = 1000;
  } else if (spanText === sourceText) {
    score = 920;
  } else if (spanCore && sourceCore && spanCore === sourceCore) {
    score = 880;
  } else {
    const min = Math.min(spanText.length, sourceText.length);
    if (min >= 4 && (spanText.endsWith(sourceText) || sourceText.endsWith(spanText))) {
      score = 760;
    } else if (min >= 5 && (spanText.includes(sourceText) || sourceText.includes(spanText))) {
      score = 620;
    }
  }

  if (score < 0) return -1;
  score -= Math.abs(spanParts.length - source.parts.length) * 20;
  score -= spanParts.length;
  return score;
}

function findCanonicalSpan(
  canonicalWords: CanonicalWord[],
  source: SourceWordMatch,
  cursor: number,
): { start: number; end: number } | null {
  const sourceParts = source.parts;
  if (canonicalWords.length === 0 || sourceParts.length === 0) return null;

  let best: { start: number; end: number; score: number } | null = null;
  const scan = (from: number) => {
    for (let start = from; start < canonicalWords.length; start++) {
      const maxEnd = Math.min(canonicalWords.length, start + Math.max(sourceParts.length + 2, 3));
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
  const result = best as { start: number; end: number; score: number } | null;
  return result ? { start: result.start, end: result.end } : null;
}

function appendMappedWordRow(
  rowsByKey: Map<string, MappedWordRow>,
  surah: number,
  ayah: number,
  wordPos: number,
  word: string | null,
  value: string | null,
  valueSeparator: string,
) {
  const key = `${surah}:${ayah}:${wordPos}`;
  const existing = rowsByKey.get(key);
  if (!existing) {
    rowsByKey.set(key, [surah, ayah, wordPos, word, value]);
    return;
  }

  if (word && existing[3] && !existing[3]!.includes(word)) {
    existing[3] = `${existing[3]} / ${word}`;
  } else if (word && !existing[3]) {
    existing[3] = word;
  }

  if (value && existing[4] && !existing[4]!.includes(value)) {
    existing[4] = `${existing[4]}${valueSeparator}${value}`;
  } else if (value && !existing[4]) {
    existing[4] = value;
  }
}

export function mapRowsToCanonicalWords(
  canonicalByAyah: Map<string, CanonicalWord[]>,
  sourceRows: any[],
  getTargets: (row: any) => string[],
  getValue: (row: any) => string | null,
  valueSeparator: string,
): MappedWordRow[] {
  const cursors = new Map<string, number>();
  const rowsByKey = new Map<string, MappedWordRow>();

  for (const source of sourceRows) {
    const word = source.word ? String(source.word) : null;
    const wordMatch = buildSourceWordMatch(word);
    if (!wordMatch) continue;
    const value = getValue(source);
    const targets = getTargets(source);
    for (const target of targets) {
      const [surah, ayah] = target.split(":").map((n) => parseInt(n, 10));
      if (!Number.isFinite(surah) || !Number.isFinite(ayah)) continue;

      const canonicalWords = canonicalByAyah.get(`${surah}:${ayah}`) ?? [];
      const cursor = cursors.get(target) ?? 0;
      const span = findCanonicalSpan(canonicalWords, wordMatch, cursor);
      if (!span) continue;

      cursors.set(target, span.end);
      for (let index = span.start; index < span.end; index++) {
        appendMappedWordRow(rowsByKey, surah, ayah, canonicalWords[index].pos, word, value, valueSeparator);
      }
    }
  }

  variantCache.clear();
  return Array.from(rowsByKey.values()).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}
