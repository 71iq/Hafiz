import { normalizeArabicWord } from "@/lib/arabic";

/**
 * The positions of a verse's words that differ from the other verses (MUT-01, MUT-04), compared as
 * sequences of normalized words, so a word that is only moved or repeated counts as different: in
 * 28:20 "وجاء رجل من أقصى المدينة" against 36:20 "وجاء من أقصى المدينة رجل", "رجل" differs in both.
 * A word differs when it is outside the longest common subsequence with at least one of `others`.
 * With no others, nothing differs.
 */
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

/**
 * A word as compared: Uthmani and plain spellings of one word match. The dagger alif of the Uthmani
 * text stands for the full alif of the plain one ("خَٰلِدِينَ", "خَالِدِينَ"), and runs of alif collapse,
 * since normalizeArabicWord drops the dagger alif but keeps a full one. Over alif maqsura it is only
 * the vowel, which plain spelling leaves out ("يَسْعَىٰ", "يَسْعَى"), so it is dropped there. A waw
 * that carries it with no vowel of its own is the Uthmani way of writing that alif ("ٱلصَّلَوٰةَ",
 * "الصَّلَاةَ"); a waw with its own vowel, as in "ٱلسَّمَٰوَٰتِ", stays a waw.
 */
export function wordKey(word: string): string {
  const spelled = word
    .replace(/\u0649\u0670/g, "\u0649")
    .replace(/\u0648\u0670/g, "ا")
    .replace(/\u0670/g, "ا");
  return normalizeArabicWord(spelled).replace(/ا+/g, "ا");
}

/** For each word of `a`, whether it is in a longest common subsequence of `a` and `b`. */
function commonSubsequence(a: readonly string[], b: readonly string[]): boolean[] {
  // lengths[i][j]: the longest common subsequence of a[i..] and b[j..].
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

/**
 * Where an ayah's own words sit in a passage that also holds the end of the ayah before it or the
 * start of the one after (the bundled similar-verse text runs across ayat): the positions of its first
 * and last word in `passage`, or null when that is not certain. The ayah may be cut at either end of
 * the passage; the words that do show must all match it (wordKey), with one mismatch allowed in a
 * long overlap for a spelling the key does not cover, and no other position may match as well.
 * Words with no letters, such as pause marks, are not counted.
 */
export function ayahSpanIn(
  passage: readonly string[],
  ayah: readonly string[],
): { first: number; last: number } | null {
  const keyed = (list: readonly string[]) =>
    list.map((word, index) => ({ key: wordKey(word), index })).filter((word) => word.key !== "");
  const text = keyed(passage);
  const own = keyed(ayah).map((word) => word.key);
  if (text.length === 0 || own.length === 0) return null;
  let best: { first: number; last: number; overlap: number } | null = null;
  let tied = false;
  // Each alignment of the ayah against the passage: `offset` is where its first word would fall.
  for (let offset = 1 - own.length; offset < text.length; offset += 1) {
    const from = Math.max(0, offset);
    const to = Math.min(text.length, offset + own.length);
    const overlap = to - from;
    if (overlap < Math.min(3, own.length)) continue;
    let mismatches = 0;
    for (let at = from; at < to; at += 1) if (text[at].key !== own[at - offset]) mismatches += 1;
    if (mismatches > (overlap >= 6 ? 1 : 0)) continue;
    // A cut ayah must reach the passage's edge; otherwise its missing words would be showing.
    if (offset < 0 && from !== 0) continue;
    if (offset + own.length > text.length && to !== text.length) continue;
    if (best === null || overlap > best.overlap) {
      best = { first: text[from].index, last: text[to - 1].index, overlap };
      tied = false;
    } else if (overlap === best.overlap) {
      tied = true;
    }
  }
  return best && !tied ? { first: best.first, last: best.last } : null;
}
