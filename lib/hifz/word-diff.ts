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
  return remembered(wordKeys, word, () => {
    const spelled = word
      .replace(/\u0649\u0670/g, "\u0649")
      .replace(/\u0648\u0670/g, "ا")
      .replace(/\u0670/g, "ا");
    return normalizeArabicWord(spelled).replace(/ا+/g, "ا");
  });
}

/**
 * The keys already worked out, by word. A page's similar verses compare the same few hundred words many
 * times over (Sol round 19 measured 106 passes on page 501), so each word is normalized once. Bounded,
 * since words from every page read in a session pass through.
 */
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

/**
 * A word cut down to its consonants, for telling whether two runs of words are the same stretch of
 * the Quran when the bundled similar-verse text spells or splits them differently from the Mushaf
 * text: "يَٰبَنِىٓ" against "يا بني", "ءَامَنُوا۟" against "آمنوا", "بِهِۦ" against "به". Long vowels,
 * their seats and hamza are dropped, and a doubled letter counts once ("ٱلَّيْلِ", "الليل"). Too loose
 * to tell single words apart, which wordKey does, so only runs of words are compared this way.
 */
function skeleton(word: string): string {
  return remembered(skeletonKeys, word, () =>
    wordKey(word)
      .replace(/[^ء-ي]/g, "")
      .replace(/[اءويى]/g, "")
      .replace(/(.)\1+/g, "$1"),
  );
}

/** The skeletons of the words that have one; "يا", "أو" or ۩ have none and are skipped on both sides. */
function skeletons(words: readonly string[]): string[] {
  return words.map(skeleton).filter((key) => key !== "");
}

/** How many words a join compares on each side. */
const JOIN_WORDS = 3;

function placesOf(text: readonly string[], run: readonly string[]): number[] {
  const places: number[] = [];
  for (let at = 0; at + run.length <= text.length; at += 1) {
    if (run.every((key, offset) => text[at + offset] === key)) places.push(at);
  }
  return places;
}

/**
 * Where `run` sits in `text`, from its last words (side "end") or its first ("start"): the position
 * after its last word or of its first, taking more of its words until one place is left. Null when
 * it is not there, or not in one place, or when fewer than two words would place it.
 */
function placeOf(text: readonly string[], run: readonly string[], side: "start" | "end"): number | null {
  for (let count = Math.min(JOIN_WORDS, run.length); count >= 2 && count <= run.length; count += 1) {
    const part = side === "end" ? run.slice(-count) : run.slice(0, count);
    const places = placesOf(text, part);
    if (places.length === 0) return null;
    if (places.length === 1) return side === "end" ? places[0] + count : places[0];
  }
  return null;
}

/** Two short runs read alike when one word at most is added, left out or spelled past the skeleton. */
function alike(quran: readonly string[], shown: readonly string[]): boolean {
  return commonSubsequence(quran, shown).filter(Boolean).length >= quran.length - 1;
}

/** Whether the last words of `before` run straight into the first of `after` somewhere in `text`. */
function runsInto(text: readonly string[], before: readonly string[], after: readonly string[]): boolean {
  const run = [...before.slice(-JOIN_WORDS), ...after.slice(0, JOIN_WORDS)];
  // Joined up as well, for words the two texts split in different places ("ذَرُونَا نَتَّبِعْكُمْ").
  const joined = (keys: readonly string[]) => keys.join("").replace(/(.)\1+/g, "$1");
  return placesOf(text, run).length > 0 || joined(text).includes(joined(run));
}

/** Whether the end of `left` runs straight into the start of `right` in `quran`, word for word. */
export function runsOnIn(left: readonly string[], right: readonly string[], quran: readonly string[]): boolean {
  const before = skeletons(left);
  const after = skeletons(right);
  return before.length > 0 && after.length > 0 && runsInto(skeletons(quran), before, after);
}

/**
 * Whether the words of `right` follow on from those of `left` in the Quran, judged against `quran`,
 * the ayat around them in order. True when the end of one runs into the start of the other there,
 * false when a side is found in one place and the Quran goes on (or comes before) with other words,
 * null when that cannot be told: a side is not there, or sits at the edge of `quran`, or the two
 * sides disagree. A spelling or word split the skeleton does not cover, or a single word the bundled
 * text leaves out or adds, never counts as a break.
 */
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

/** Whether some of `words` are found in `quran` as they run: their first few or their last few. */
export function foundIn(words: readonly string[], quran: readonly string[]): boolean {
  const own = skeletons(words);
  const text = skeletons(quran);
  return (
    own.length > 0 &&
    (placesOf(text, own.slice(0, JOIN_WORDS)).length > 0 || placesOf(text, own.slice(-JOIN_WORDS)).length > 0)
  );
}

/** Whether `words` end as `ayah` does, compared over its last few words. */
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
): { first: number; last: number; hasStart: boolean; hasEnd: boolean } | null {
  const keyed = (list: readonly string[]) =>
    list.map((word, index) => ({ key: wordKey(word), index })).filter((word) => word.key !== "");
  const text = keyed(passage);
  const own = keyed(ayah).map((word) => word.key);
  if (text.length === 0 || own.length === 0) return null;
  let best: { first: number; last: number; overlap: number; hasStart: boolean; hasEnd: boolean } | null = null;
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
      best = {
        first: text[from].index,
        last: text[to - 1].index,
        overlap,
        // Whether the ayah's own first and last words are in the passage, rather than cut off.
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
