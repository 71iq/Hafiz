import { normalizeArabicWord } from "@/lib/arabic";

export function differingWords(own: readonly string[], others: readonly (readonly string[])[]): boolean[] {
  const ownKeys = own.map(wordKey);
  const differs = own.map(() => false);
  for (const other of others) {
    const kept = commonSubsequence(ownKeys, other.map(wordKey));
    kept.forEach((inCommon, index) => {
      if (!inCommon) differs[index] = true;
    });
  }
  return differs;
}

export function wordKey(word: string): string {
  return remembered(wordKeys, word, () => {
    const spelled = word
      .replace(/\u0649\u0670(?=[\u064B-\u065F\u06D6-\u06ED]*[\u0621-\u064A])/g, "ا")
      .replace(/\u0649\u0670/g, "\u0649")
      .replace(/\u0648\u0670/g, "ا")
      .replace(/\u0670/g, "ا");
    return normalizeArabicWord(spelled).replace(/ا+/g, "ا");
  });
}

const wordKeys = new Map<string, string>();
const skeletonKeys = new Map<string, string>();
const REMEMBERED_MAX = 20_000;

function remembered(store: Map<string, string>, word: string, make: () => string): string {
  const known = store.get(word);
  if (known !== undefined) return known;
  if (store.size >= REMEMBERED_MAX) store.clear();
  const key = make();
  store.set(word, key);
  return key;
}

function skeleton(word: string): string {
  return remembered(skeletonKeys, word, () =>
    wordKey(word)
      .replace(/[^ء-ي]/g, "")
      .replace(/[اءويى]/g, "")
      .replace(/(.)\1+/g, "$1"),
  );
}

function skeletons(words: readonly string[]): string[] {
  return words.map(skeleton).filter((key) => key !== "");
}

const JOIN_WORDS = 3;

function placesOf(text: readonly string[], run: readonly string[]): number[] {
  const places: number[] = [];
  for (let at = 0; at + run.length <= text.length; at += 1) {
    if (run.every((key, offset) => text[at + offset] === key)) places.push(at);
  }
  return places;
}

function placeOf(text: readonly string[], run: readonly string[], side: "start" | "end"): number | null {
  for (let count = Math.min(JOIN_WORDS, run.length); count >= 2 && count <= run.length; count += 1) {
    const part = side === "end" ? run.slice(-count) : run.slice(0, count);
    const places = placesOf(text, part);
    if (places.length === 0) return null;
    if (places.length === 1) return side === "end" ? places[0] + count : places[0];
  }
  return null;
}

function alike(quran: readonly string[], shown: readonly string[]): boolean {
  return commonSubsequence(quran, shown).filter(Boolean).length >= quran.length - 1;
}

function runsInto(text: readonly string[], before: readonly string[], after: readonly string[]): boolean {
  const run = [...before.slice(-JOIN_WORDS), ...after.slice(0, JOIN_WORDS)];
  const joined = (keys: readonly string[]) => keys.join("").replace(/(.)\1+/g, "$1");
  return placesOf(text, run).length > 0 || joined(text).includes(joined(run));
}

export function runsOnIn(left: readonly string[], right: readonly string[], quran: readonly string[]): boolean {
  const before = skeletons(left);
  const after = skeletons(right);
  return before.length > 0 && after.length > 0 && runsInto(skeletons(quran), before, after);
}

export function continuesIn(
  left: readonly string[],
  right: readonly string[],
  quran: readonly string[],
): boolean | null {
  const before = skeletons(left);
  const after = skeletons(right);
  const text = skeletons(quran);
  if (before.length === 0 || after.length === 0 || text.length === 0) return null;
  if (runsInto(text, before, after)) return true;
  const tail = before.slice(-JOIN_WORDS);
  const head = after.slice(0, JOIN_WORDS);
  const verdicts: boolean[] = [];
  const end = placeOf(text, before, "end");
  if (end !== null) {
    const next = text.slice(end, end + head.length);
    if (next.length >= 2) verdicts.push(alike(next, head.slice(0, next.length)));
  }
  const start = placeOf(text, after, "start");
  if (start !== null) {
    const previous = text.slice(Math.max(0, start - tail.length), start);
    if (previous.length >= 2) verdicts.push(alike(previous, tail.slice(tail.length - previous.length)));
  }
  if (verdicts.length === 0) return null;
  if (verdicts.every(Boolean)) return true;
  return verdicts.some(Boolean) ? null : false;
}

export function foundIn(words: readonly string[], quran: readonly string[]): boolean {
  const own = skeletons(words);
  const text = skeletons(quran);
  return (
    own.length > 0 &&
    (placesOf(text, own.slice(0, JOIN_WORDS)).length > 0 || placesOf(text, own.slice(-JOIN_WORDS)).length > 0)
  );
}

export function endsAs(words: readonly string[], ayah: readonly string[]): boolean {
  const shown = skeletons(words);
  const own = skeletons(ayah);
  const count = Math.min(JOIN_WORDS, own.length);
  return (
    count > 0 &&
    shown.length >= count &&
    shown.slice(-count).every((key, index) => key === own[own.length - count + index])
  );
}

function commonSubsequence(a: readonly string[], b: readonly string[]): boolean[] {
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const inCommon = a.map(() => false);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      inCommon[i] = true;
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return inCommon;
}

export function ayahSpanIn(
  passage: readonly string[],
  ayah: readonly string[],
): { first: number; last: number; hasStart: boolean; hasEnd: boolean } | null {
  const keyed = (list: readonly string[]) =>
    list.map((word, index) => ({ key: wordKey(word), index })).filter((word) => word.key !== "");
  const text = keyed(passage);
  const own = keyed(ayah).map((word) => word.key);
  if (text.length === 0 || own.length === 0) return null;
  let best: { first: number; last: number; overlap: number; hasStart: boolean; hasEnd: boolean } | null = null;
  let tied = false;
  for (let offset = 1 - own.length; offset < text.length; offset += 1) {
    const from = Math.max(0, offset);
    const to = Math.min(text.length, offset + own.length);
    const overlap = to - from;
    if (overlap < Math.min(3, own.length)) continue;
    let mismatches = 0;
    for (let at = from; at < to; at += 1) if (text[at].key !== own[at - offset]) mismatches += 1;
    if (mismatches > (overlap >= 6 ? 1 : 0)) continue;
    if (offset < 0 && from !== 0) continue;
    if (offset + own.length > text.length && to !== text.length) continue;
    if (best === null || overlap > best.overlap) {
      best = {
        first: text[from].index,
        last: text[to - 1].index,
        overlap,
        hasStart: offset >= 0,
        hasEnd: offset + own.length <= text.length,
      };
      tied = false;
    } else if (overlap === best.overlap) {
      tied = true;
    }
  }
  return best && !tied ? { first: best.first, last: best.last, hasStart: best.hasStart, hasEnd: best.hasEnd } : null;
}
