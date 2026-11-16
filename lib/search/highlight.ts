
export type HighlightSegment = { text: string; highlight: boolean };
export type MatchRange = readonly [start: number, end: number];

const ARABIC_DIACRITIC = /[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0640]/;
const ARABIC_DIACRITICS = new RegExp(ARABIC_DIACRITIC.source, "g");

export function stripSearchDiacritics(text: string): string {
  return text.replace(ARABIC_DIACRITICS, "");
}

export function arabicMatchRanges(original: string, term: string): MatchRange[] {
  const needle = stripSearchDiacritics(term.trim());
  if (!needle) return [];
  const positions: number[] = [];
  let stripped = "";
  for (let i = 0; i < original.length; i++) {
    if (ARABIC_DIACRITIC.test(original[i])) continue;
    positions.push(i);
    stripped += original[i];
  }
  const ranges: MatchRange[] = [];
  let from = 0;
  for (;;) {
    const index = stripped.indexOf(needle, from);
    if (index < 0) break;
    const start = positions[index];
    let end = positions[index + needle.length - 1] + 1;
    while (end < original.length && ARABIC_DIACRITIC.test(original[end])) end++;
    ranges.push([start, end]);
    from = index + needle.length;
  }
  return ranges;
}

export function plainMatchRanges(original: string, term: string): MatchRange[] {
  const needle = term.trim().toLowerCase();
  const haystack = original.toLowerCase();
  if (!needle || haystack.length !== original.length) return [];
  const ranges: MatchRange[] = [];
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    ranges.push([index, index + needle.length]);
    from = index + needle.length;
  }
  return ranges;
}

export function wordMatchRange(original: string, wordText: string): MatchRange[] {
  const index = wordText ? original.indexOf(wordText) : -1;
  if (index >= 0) return [[index, index + wordText.length]];
  return arabicMatchRanges(original, wordText).slice(0, 1);
}

export function snippetWindow(
  text: string,
  ranges: readonly MatchRange[],
  maxWords = 15,
): { start: number; end: number } {
  const words: [number, number][] = [];
  const pattern = /\S+/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    words.push([match.index, match.index + match[0].length]);
  }
  if (words.length <= maxWords) return { start: 0, end: text.length };
  const anchor = ranges[0]?.[0] ?? 0;
  const anchorWord = Math.max(
    0,
    words.findIndex(([, end]) => end > anchor),
  );
  const before = Math.min(5, Math.floor(maxWords / 3));
  const first = Math.max(0, Math.min(anchorWord - before, words.length - maxWords));
  return { start: words[first][0], end: words[first + maxWords - 1][1] };
}

export function highlightSegments(
  text: string,
  ranges: readonly MatchRange[],
  window: { start: number; end: number } = { start: 0, end: text.length },
): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  const push = (piece: string, highlight: boolean) => {
    if (piece) segments.push({ text: piece, highlight });
  };
  if (window.start > 0) push("… ", false);
  let cursor = window.start;
  for (const [rawStart, rawEnd] of ranges) {
    const start = Math.max(rawStart, window.start);
    const end = Math.min(rawEnd, window.end);
    if (end <= start || start < cursor) continue;
    push(text.slice(cursor, start), false);
    push(text.slice(start, end), true);
    cursor = end;
  }
  push(text.slice(cursor, window.end), false);
  if (window.end < text.length) push(" …", false);
  return segments;
}

export function snippetSegments(text: string, ranges: readonly MatchRange[], maxWords = 15): HighlightSegment[] {
  return highlightSegments(text, ranges, snippetWindow(text, ranges, maxWords));
}
