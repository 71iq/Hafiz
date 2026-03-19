import type { TajweedRow } from "./queries";

/**
 * Build word boundaries from text_uthmani.
 * Returns an array of [startOffset, endOffset] for each word (0-indexed character positions).
 */
function buildWordBoundaries(text: string): [number, number][] {
  const boundaries: [number, number][] = [];
  let pos = 0;
  const words = text.split(" ");
  for (const word of words) {
    if (word.length > 0) {
      boundaries.push([pos, pos + word.length - 1]);
    }
    pos += word.length + 1; // +1 for the space
  }
  return boundaries;
}

/**
 * Map tajweed annotations to a specific word position.
 * wordPos is 1-indexed (matching database convention).
 *
 * Returns all tajweed rules whose character range overlaps with the given word.
 */
export function mapTajweedToWord(
  textUthmani: string,
  annotations: TajweedRow[],
  wordPos: number,
): TajweedRow[] {
  const boundaries = buildWordBoundaries(textUthmani);
  const wordIndex = wordPos - 1;

  if (wordIndex < 0 || wordIndex >= boundaries.length) {
    return [];
  }

  const [wordStart, wordEnd] = boundaries[wordIndex];

  return annotations.filter(
    (a) => a.start_offset <= wordEnd && a.end_offset >= wordStart,
  );
}
