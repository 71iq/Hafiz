/**
 * The text rules of the similar-verse cards, kept free of the database so the card loader
 * (lib/fsrs/smart-decks.ts), the exclusion generator (scripts/build-similar-card-exclusions.mjs) and
 * the tests apply the same ones.
 */

/** The Unicode words of an ayah text, marks and numbers removed, as the card prompts split it. */
export function splitQuranWords(text: string): string[] {
  return text
    .replace(/[۞۩﴿﴾0-9٠-٩]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

/** Plain-text words with marks removed and alef, hamza seat, ى and ة forms written one way. */
export function normalizeArabicWords(text: string): string[] {
  const normalized = text
    .replace(/\(و\)/g, " ")
    .replace(/لا(?=[ء-ي])/g, "لا ")
    .replace(/[ً-ٰٟۖ-ۭ]/g, "")
    .replace(/[ٱأإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/[^ء-ي\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.split(" ") : [];
}

/**
 * One word's letters for matching a tail cue: marks and tatweel removed, every hamza form and alef
 * written as ا, ى as ي and ة as ه, so the cue's "رءوف" meets the text's "رَءُوفٌ" and "رؤوف" alike.
 */
export function tailLetters(word: string): string {
  return word
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, "")
    .replace(/[ءأإآٱؤئ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^ء-ي]/g, "");
}

/** One cue word and the prefixes its notation allows: "(و)" is optional, "(و)-(ف)" either or none. */
type CueToken = { word: string; prefixes: string[]; alternation: boolean };

/**
 * The cue's words. "(x)" before a word, with or without a space, marks an optional prefix of that
 * word; "(x)-(y)" marks alternative prefixes, either one or none.
 */
export function parseTailCue(cue: string): CueToken[] {
  const tokens: CueToken[] = [];
  const pattern = /((?:\([^()]*\)\s*-?\s*)+)?([^\s()\-]+)/gu;
  for (const match of cue.matchAll(pattern)) {
    const word = tailLetters(match[2]);
    if (!word) continue;
    const marks = [...(match[1] ?? "").matchAll(/\(([^()]*)\)/gu)].map((mark) => tailLetters(mark[1])).filter(Boolean);
    tokens.push({ word, prefixes: ["", ...marks], alternation: marks.length > 1 });
  }
  return tokens;
}

export type TailSplit = {
  /** How many words at the ayah's end the card hides. */
  hiddenWordCount: number;
  /**
   * "cue": the hidden words are the cue's, letter for letter. "cueVariant": the same but for one
   * letter at the end of a word ("غفور" for "غفورا") or a joining و or ف on the first word.
   * "cueInside": the cue ends before the ayah does, so the card hides from the cue to the end.
   * "tail5": the cue is not in the ayah, so the stored last five words are hidden. "fallback":
   * neither is, and the card hides as many words as the cue has.
   */
  source: "cue" | "cueVariant" | "cueInside" | "tail5" | "fallback";
};

type CueChoice = { words: string[]; bare: boolean[] };

/** The cue's words with one choice of prefix for each word that allows some, and the choices made. */
function cueChoices(tokens: readonly CueToken[]): CueChoice[] {
  let choices: CueChoice[] = [{ words: [], bare: [] }];
  for (const token of tokens) {
    choices = choices.flatMap((choice) =>
      token.prefixes.map((prefix) => ({
        words: [...choice.words, prefix + token.word],
        bare: [...choice.bare, prefix === ""],
      })),
    );
  }
  return choices;
}

const JOINING_LETTERS = ["و", "ف"];

/**
 * The same choices with a joining و or ف before the first word, which the cue does not mark: the
 * cue "إن الله كان بكل شيء عليما" ends 33:54 as "فَإِنَّ ٱللَّهَ ...". A word cannot be split, so
 * the card hides the whole word.
 */
function joinedCueChoices(choices: readonly CueChoice[]): CueChoice[] {
  return choices.flatMap((choice) =>
    JOINING_LETTERS.filter((letter) => !choice.words[0].startsWith(letter)).map((letter) => ({
      words: [letter + choice.words[0], ...choice.words.slice(1)],
      bare: [false, ...choice.bare.slice(1)],
    })),
  );
}

/**
 * Whether `longer` is `shorter` with one letter more, where that letter ends a word of `longer`
 * (`wordEnds` holds the index of each word's last letter).
 */
function oneExtraFinalLetter(longer: string, shorter: string, wordEnds: ReadonlySet<number>): boolean {
  if (longer.length !== shorter.length + 1) return false;
  let p = 0;
  while (p < shorter.length && longer[p] === shorter[p]) p++;
  return wordEnds.has(p) && longer.slice(p + 1) === shorter.slice(p);
}

function wordEndIndexes(words: readonly string[]): Set<number> {
  const ends = new Set<number>();
  let offset = 0;
  for (const word of words) {
    offset += word.length;
    if (word.length > 0) ends.add(offset - 1);
  }
  return ends;
}

/** Whether the letters of `tail` and `cue` differ by one letter at the end of a word of each. */
function differsByFinalLetter(
  tail: string,
  tailEnds: ReadonlySet<number>,
  cue: string,
  cueEnds: ReadonlySet<number>,
): boolean {
  const gap = tail.length - cue.length;
  if (gap === 1) return oneExtraFinalLetter(tail, cue, tailEnds);
  if (gap === -1) return oneExtraFinalLetter(cue, tail, cueEnds);
  if (gap !== 0) return false;
  let differing = -1;
  for (let index = 0; index < tail.length; index++) {
    if (tail[index] === cue[index]) continue;
    if (differing >= 0) return false;
    differing = index;
  }
  return differing >= 0 && tailEnds.has(differing) && cueEnds.has(differing);
}

type Alignment = { count: number; bare: boolean[] };

/**
 * How many words from the ayah's end the cue starts, for the first choice whose letters are the
 * last words' letters. Spaces do not count, so the cue's "أكثرالناس" and "لايحب" align with the
 * text's "أكثر الناس" and "لا يحب". With `finalLetterVariant`, one letter may differ at the end of
 * a word, added, missing or changed ("إنه كان حليما غفور" for 17:44's "إِنَّهُۥ كَانَ حَلِيمًا غَفُورًا").
 */
function alignAtEnd(
  choices: readonly CueChoice[],
  ayahWords: readonly string[],
  finalLetterVariant: boolean,
): Alignment | null {
  const prepared = choices.map((choice) => ({
    ...choice,
    letters: choice.words.join(""),
    ends: wordEndIndexes(choice.words),
  }));
  for (let count = 1; count <= ayahWords.length; count++) {
    const tailWords = ayahWords.slice(ayahWords.length - count);
    const tail = tailWords.join("");
    const tailEnds = finalLetterVariant ? wordEndIndexes(tailWords) : null;
    for (const choice of prepared) {
      if (tail === choice.letters) return { count, bare: choice.bare };
      if (tailEnds && differsByFinalLetter(tail, tailEnds, choice.letters, choice.ends))
        return { count, bare: choice.bare };
    }
  }
  return null;
}

/**
 * Where the cue's last occurrence starts inside the ayah, as a number of words from the end, when
 * the ayah goes on after it: 11:86 "... خَيْرٌ لَّكُمْ إِن كُنتُم مُّؤْمِنِينَ ۚ وَمَآ أَنَا۠ عَلَيْكُم بِحَفِيظٍ".
 */
function alignInside(choices: readonly CueChoice[], ayahWords: readonly string[]): Alignment | null {
  for (let start = ayahWords.length - 2; start >= 0; start--) {
    for (const choice of choices) {
      const letters = choice.words.join("");
      let joined = "";
      for (let end = start; end < ayahWords.length - 1 && joined.length < letters.length; end++) {
        joined += ayahWords[end];
        if (joined === letters) return { count: ayahWords.length - start, bare: choice.bare };
      }
    }
  }
  return null;
}

/**
 * The hidden tail of a Similar tails card: exactly the cue's words at the ayah's end. The ayah is
 * read in its plain text (`text_clean`), whose words count as the Uthmani words do at the end of an
 * ayah. The cue's prefix marks and spacing, a one-letter spelling slip at a word's end and a joining
 * و or ف on its first word still align. One exception from the owner: an alternation cue
 * ("(و)-(ف)أولئك ...") whose first word stands bare after "بل" hides "بل" too (24:50, "بَلْ
 * أُو۟لَٰٓئِكَ هُمُ ٱلظَّٰلِمُونَ"). The stored last five words (`tail_5`) are hidden only when the cue
 * is not in the ayah at all.
 */
export function tailSplit(cue: string, tail5: string | null, textClean: string): TailSplit {
  const ayahWords = splitQuranWords(textClean).map(tailLetters);
  if (ayahWords.length === 0) return { hiddenWordCount: 0, source: "fallback" };

  const tokens = parseTailCue(cue);
  if (tokens.length > 0) {
    const choices = cueChoices(tokens);
    const exact = alignAtEnd(choices, ayahWords, false);
    if (exact) return { hiddenWordCount: withBal(exact, tokens, ayahWords), source: "cue" };
    const variant = alignAtEnd(choices, ayahWords, true) ?? alignAtEnd(joinedCueChoices(choices), ayahWords, false);
    if (variant) return { hiddenWordCount: withBal(variant, tokens, ayahWords), source: "cueVariant" };
    const inside = alignInside(choices, ayahWords);
    if (inside) return { hiddenWordCount: withBal(inside, tokens, ayahWords), source: "cueInside" };
  }

  const normalizedAyah = normalizeArabicWords(textClean);
  const tail5Words = normalizeArabicWords(tail5 ?? "");
  const tail5Match = suffixMatchCount(normalizedAyah, tail5Words);
  if (tail5Match > 0) return { hiddenWordCount: tail5Match, source: "tail5" };

  const fallback = tokens.length || tail5Words.length || 1;
  return { hiddenWordCount: Math.min(fallback, ayahWords.length), source: "fallback" };
}

/** The owner's 24:50 exception: "بل" before a bare alternation word is hidden with it. */
function withBal(alignment: Alignment, tokens: readonly CueToken[], ayahWords: readonly string[]): number {
  const before = ayahWords[ayahWords.length - alignment.count - 1];
  return alignment.count + (tokens[0].alternation && alignment.bare[0] && before === "بل" ? 1 : 0);
}

export function tailHiddenWordCount(cue: string, tail5: string | null, textClean: string): number {
  return tailSplit(cue, tail5, textClean).hiddenWordCount;
}

function suffixMatchCount(words: readonly string[], suffix: readonly string[]): number {
  if (suffix.length === 0 || suffix.length > words.length) return 0;
  const start = words.length - suffix.length;
  for (let i = 0; i < suffix.length; i++) {
    if (words[start + i] !== suffix[i]) return 0;
  }
  return suffix.length;
}

/** A vocative the plain text writes apart from the next word and the Uthmani text joins to it ("يا أيها", "يَٰٓأَيُّهَا"). */
const JOINED_VOCATIVES: ReadonlySet<string> = new Set(["يا", "ويا", "فيا", "ها"]);

/** Longer joins, by ayah: [first plain word, plain words in the one Uthmani word]. */
const JOINED_SPANS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  "20:94": [[1, 3]], // "يا ابن أم", "يَبْنَؤُمَّ"
  "72:16": [[0, 2]], // "وأن لو", "وَأَلَّوِ"
};

/**
 * For each plain word of an ayah (normalizeArabicWords of `text_clean`, which `text_search` also
 * splits into), the index of the Uthmani word (splitQuranWords) that holds it. The two texts count
 * alike except in 363 ayat, where a vocative and the word after it are one Uthmani word, and in the
 * two JOINED_SPANS ayat. tests/unit/smart-deck-similar-prompt.test.ts checks every ayah.
 */
export function uthmaniIndexOfPlainWords(plainWords: readonly string[], surah?: number, ayah?: number): number[] {
  const spans = surah !== undefined && ayah !== undefined ? JOINED_SPANS[`${surah}:${ayah}`] ?? [] : [];
  const index: number[] = [];
  let uthmani = 0;
  for (let plain = 0; plain < plainWords.length; uthmani++) {
    const span = spans.find(([start]) => start === plain);
    const joined = span ? span[1] : JOINED_VOCATIVES.has(plainWords[plain]) && plain + 1 < plainWords.length ? 2 : 1;
    for (let k = 0; k < joined && plain < plainWords.length; k++, plain++) index.push(uthmani);
  }
  return index;
}

/** The Uthmani words that show the first `plainCount` plain words, a joined word counting whole. */
function uthmaniCountOf(index: readonly number[], plainCount: number): number {
  return plainCount <= 0 ? 0 : index[Math.min(plainCount, index.length) - 1] + 1;
}

/** The plain words the first `uthmaniCount` Uthmani words hold. */
function plainCountOf(index: readonly number[], uthmaniCount: number): number {
  const count = index.findIndex((uthmani) => uthmani >= uthmaniCount);
  return count === -1 ? index.length : count;
}

/** The fields of a similar-verse ref the card front is built from. */
export type FrontRef = {
  sortOrder: number;
  /** The ayah, for the few joins JOINED_SPANS lists; without it only vocatives are joined. */
  surah?: number;
  ayah?: number;
  textUthmani: string;
  textClean: string;
  preText?: string | null;
  similarText?: string | null;
};

export type MutashabihatFront = {
  /** How many Uthmani words of the ayah the front shows, from its start. */
  prefixWordCount: number;
  /** The same front in plain words (`text_clean`, `text_search`). */
  plainWordCount: number;
  /** The front's words do not single the ayah out in its group. */
  needsExplicitRefLabel: boolean;
};

/**
 * The front of a similar-verse card: the ayah up to the end of its similar words when the row
 * holds them, otherwise its shortest opening that no other ayah of the group shares, otherwise the
 * whole ayah with a label naming it.
 */
export function mutashabihatFront(targetRef: FrontRef, refs: readonly FrontRef[]): MutashabihatFront {
  return segmentedFront(targetRef, refs) ?? uniqueOpeningFront(targetRef, refs);
}

/**
 * A front of `uthmaniCount` Uthmani words, in both counts, and whether its plain words single the
 * ayah out in its group. Fronts are compared in plain words, which every ayah of a group counts alike.
 */
function frontOf(targetRef: FrontRef, refs: readonly FrontRef[], targetWords: readonly string[], index: readonly number[], uthmaniCount: number): MutashabihatFront {
  const plainWordCount = plainCountOf(index, uthmaniCount);
  const targetPrefix = targetWords.slice(0, plainWordCount).join(" ");
  const matches = refs.filter(
    (ref) => normalizeArabicWords(ref.textClean).slice(0, plainWordCount).join(" ") === targetPrefix,
  );
  const needsExplicitRefLabel = !(matches.length === 1 && matches[0].sortOrder === targetRef.sortOrder);
  return { prefixWordCount: uthmaniCount, plainWordCount, needsExplicitRefLabel };
}

function uniqueOpeningFront(targetRef: FrontRef, refs: readonly FrontRef[]): MutashabihatFront {
  const uthmaniWords = splitQuranWords(targetRef.textUthmani);
  const targetWords = normalizeArabicWords(targetRef.textClean);
  const index = uthmaniIndexOfPlainWords(targetWords, targetRef.surah, targetRef.ayah);
  const normalizedRefs = refs.map((ref) => ({ ref, words: normalizeArabicWords(ref.textClean) }));
  for (let count = 1; count <= targetWords.length; count++) {
    const targetPrefix = targetWords.slice(0, count).join(" ");
    const matches = normalizedRefs.filter((item) => item.words.slice(0, count).join(" ") === targetPrefix);
    if (matches.length === 1 && matches[0].ref.sortOrder === targetRef.sortOrder) {
      return frontOf(targetRef, refs, targetWords, index, Math.min(uthmaniCountOf(index, count), uthmaniWords.length));
    }
  }
  return { prefixWordCount: uthmaniWords.length, plainWordCount: targetWords.length, needsExplicitRefLabel: true };
}

/**
 * The ayah up to the end of its similar words. The end is found in the plain text and carried over to
 * the Uthmani words, so a vocative before the similar words ("يا أيها", one Uthmani word) does not
 * move it one word on (5:2's front would show "أَن", the word that tells it from 5:8). Where the plain
 * text does not hold the similar words, the Uthmani text is searched directly.
 */
function segmentedFront(targetRef: FrontRef, refs: readonly FrontRef[]): MutashabihatFront | null {
  const similarWords = normalizeArabicWords(targetRef.similarText ?? "");
  if (similarWords.length === 0) return null;

  const targetWords = normalizeArabicWords(targetRef.textClean);
  if (targetWords.length === 0) return null;

  const uthmaniWords = splitQuranWords(targetRef.textUthmani);
  const index = uthmaniIndexOfPlainWords(targetWords, targetRef.surah, targetRef.ayah);
  const plainEnd = findSegmentPromptWordCount(targetWords, normalizeArabicWords(targetRef.preText ?? ""), similarWords);
  const uthmaniEnd = plainEnd > 0 ? uthmaniCountOf(index, plainEnd) : uthmaniSegmentEnd(targetRef);
  const prefixWordCount = Math.min(uthmaniEnd, uthmaniWords.length);
  if (prefixWordCount <= 0) return null;
  return frontOf(targetRef, refs, targetWords, index, prefixWordCount);
}

/**
 * Where the similar words end in the ayah, matched word for word against its Uthmani text. The bundled
 * segments are built from the Uthmani text, whose spelling the plain text does not always share
 * ("أَزْوَٰجًا", "أَزْوَاجًا"), so this is tried when the plain text does not hold them. Similar words
 * that cross an ayah end are only partly in the ayah (crossingSimilarEnd).
 */
function uthmaniSegmentEnd(ref: FrontRef): number {
  const keys = (text: string) => splitQuranWords(text).map((word) => normalizeArabicWords(word).join(""));
  const ayahWords = keys(ref.textUthmani);
  const similarWords = keys(ref.similarText ?? "");
  return (
    findSegmentPromptWordCount(ayahWords, keys(ref.preText ?? ""), similarWords) ||
    crossingSimilarEnd(ayahWords, similarWords)
  );
}

/**
 * The prompt end for similar words that cross an ayah end, or 0: ones that start in the ayah and run
 * on into the next (101:6's "فَأَمَّا مَن ثَقُلَتْ مَوَٰزِينُهُۥ" into 101:7) end with the ayah; ones that
 * run in from the ayah before end at their last word here. The longest overlap counts, and it takes
 * two words, so a word that merely recurs does not (a one-word ayah such as "طسٓمٓ" keeps the prompt
 * mutashabihatFront gives it otherwise).
 */
function crossingSimilarEnd(ayahWords: string[], similarWords: string[]): number {
  for (let overlap = Math.min(ayahWords.length, similarWords.length - 1); overlap >= 2; overlap--) {
    const tail = ayahWords.slice(ayahWords.length - overlap);
    if (similarWords.slice(0, overlap).every((word, k) => word === tail[k])) return ayahWords.length;
    if (similarWords.slice(similarWords.length - overlap).every((word, k) => word === ayahWords[k])) return overlap;
  }
  return 0;
}

function findSegmentPromptWordCount(targetWords: string[], preWords: string[], similarWords: string[]): number {
  if (preWords.length > 0) {
    const combinedWords = [...preWords, ...similarWords];
    const combinedStart = findSubsequenceStart(targetWords, combinedWords);
    if (combinedStart >= 0) return combinedStart + combinedWords.length;
  }
  const similarStart = findSubsequenceStart(targetWords, similarWords);
  if (similarStart >= 0) return similarStart + similarWords.length;
  return 0;
}

function findSubsequenceStart(words: string[], needle: string[]): number {
  if (needle.length === 0 || needle.length > words.length) return -1;
  for (let start = 0; start <= words.length - needle.length; start++) {
    let matched = true;
    for (let i = 0; i < needle.length; i++) {
      if (words[start + i] !== needle[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return start;
  }
  return -1;
}

/**
 * Whether a similar-verse card that answers the rest of an ayah asks what the Similar tails card
 * of the same ayah asks. Both answers end the same ayah, so they differ only in where they start.
 * They count as the same when they start at the same word or one word apart: "لَا يَهْدِى ٱلْقَوْمَ
 * ٱلْكَٰفِرِينَ" against the tail "وَٱللَّهُ لَا يَهْدِى ٱلْقَوْمَ ٱلْكَٰفِرِينَ" (2:264). Two or more
 * words more are the similar verse's own difference ("لِّلَّذِينَ يَتَّقُونَ" before "أَفَلَا
 * تَعْقِلُونَ" in 6:32), so that card stays.
 */
export function sameAnswerAsTail(restWordCount: number, tailWordCount: number): boolean {
  return Math.abs(restWordCount - tailWordCount) <= 1;
}

/** The rows the exclusion list is computed from, as the shipped rows file holds them. */
export type SimilarCardRows = {
  groups: readonly { id: string; kind: string; cue: string }[];
  refs: readonly {
    groupId: string;
    sortOrder: number;
    surah: number;
    ayah: number;
    tail5: string | null;
    preText: string | null;
    similarText: string | null;
  }[];
};

export type ExcludedSimilarCard = {
  id: string;
  tailId: string;
  surah: number;
  ayah: number;
  /** The similar-verse card's answer: the ayah after its front. */
  restUthmani: string;
  /** The Similar tails card's answer. */
  tailUthmani: string;
};

/**
 * The similar-verse cards not offered (sameAnswerAsTail), with both answers, sorted by card id.
 * `ayahText` gives an ayah's Uthmani and plain text. A tail card that hides its whole ayah is not
 * offered, so it excludes nothing.
 */
export function excludedSimilarCards(
  rows: SimilarCardRows,
  ayahText: (surah: number, ayah: number) => { textUthmani: string; textClean: string } | undefined,
): ExcludedSimilarCard[] {
  const groups = new Map(rows.groups.map((group) => [group.id, group]));
  const refsByGroup = new Map<string, SimilarCardRows["refs"][number][]>();
  for (const ref of rows.refs) {
    const list = refsByGroup.get(ref.groupId) ?? [];
    list.push(ref);
    refsByGroup.set(ref.groupId, list);
  }

  const tailsByAyah = new Map<string, { id: string; hiddenWordCount: number }[]>();
  for (const ref of rows.refs) {
    const group = groups.get(ref.groupId);
    const text = ayahText(ref.surah, ref.ayah);
    if (group?.kind !== "tail" || !text) continue;
    const hiddenWordCount = tailHiddenWordCount(group.cue, ref.tail5, text.textClean);
    if (hiddenWordCount >= splitQuranWords(text.textUthmani).length) continue;
    const key = `${ref.surah}:${ref.ayah}`;
    tailsByAyah.set(key, [
      ...(tailsByAyah.get(key) ?? []),
      { id: `similar-tail:${ref.groupId}:${ref.sortOrder}`, hiddenWordCount },
    ]);
  }

  const excluded: ExcludedSimilarCard[] = [];
  for (const [groupId, refs] of refsByGroup) {
    if (groups.get(groupId)?.kind !== "similar") continue;
    const fronts = refs.flatMap((ref) => {
      const text = ayahText(ref.surah, ref.ayah);
      return text
        ? [{ ref, front: { sortOrder: ref.sortOrder, surah: ref.surah, ayah: ref.ayah, ...text, preText: ref.preText, similarText: ref.similarText } }]
        : [];
    });
    for (const { ref, front } of fronts) {
      const tails = tailsByAyah.get(`${ref.surah}:${ref.ayah}`);
      if (!tails) continue;
      const words = splitQuranWords(front.textUthmani);
      const { prefixWordCount } = mutashabihatFront(
        front,
        fronts.map((item) => item.front),
      );
      const restWordCount = words.length - prefixWordCount;
      if (restWordCount <= 0) continue;
      const tail = tails.find((item) => sameAnswerAsTail(restWordCount, item.hiddenWordCount));
      if (!tail) continue;
      excluded.push({
        id: `mutashabihat:${groupId}:${ref.sortOrder}`,
        tailId: tail.id,
        surah: ref.surah,
        ayah: ref.ayah,
        restUthmani: words.slice(prefixWordCount).join(" "),
        tailUthmani: words.slice(words.length - tail.hiddenWordCount).join(" "),
      });
    }
  }
  return excluded.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
