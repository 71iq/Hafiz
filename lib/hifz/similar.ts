import type { DatabaseExecutor } from "@/lib/database/types";
import { putCardRow } from "@/lib/fsrs/queries";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { ayahSpanIn, wordKey } from "@/lib/hifz/word-diff";

/**
 * What tells two verses of a pair apart when their wording is the same and a prompt hides their
 * references (MUT-04): the end of the preceding ayah, else the start of the following one, else,
 * when even those match, the surah name.
 */
export type PairContext = Readonly<{ before: string | null; after: string | null; surahName: boolean }>;

export type SimilarRef = Readonly<{
  surah: number;
  ayah: number;
  surahName: string;
  pre: string;
  similar: string;
  post: string;
  page: number;
  /** Set by similarPair only when the pair reads the same. */
  context?: PairContext;
  /**
   * Where an ayah ends inside the passage, which the bundled text runs across ayat: after the word at
   * `after` (counting the words of pre, similar and post together) ends ayah `ayah`. Only where the
   * ayah's own words are found with certainty (ayahSpanIn); otherwise none.
   */
  ayahEnds?: readonly { after: number; ayah: number }[];
}>;

type VerseKey = Readonly<{ surah: number; ayah: number }>;

export type SimilarGroup = Readonly<{
  groupId: string;
  kind: "similar" | "tail";
  /** The ayah the user is memorizing or reciting. */
  self: SimilarRef;
  /** Its siblings elsewhere in the Quran. */
  siblings: readonly SimilarRef[];
}>;

type RefRow = {
  group_id: string;
  kind: "similar" | "tail";
  sort_order: number;
  surah: number;
  ayah: number;
  surah_name_ar: string | null;
  pre_text: string | null;
  similar_text: string | null;
  post_text: string | null;
  v2_page: number;
  text_uthmani: string;
  /** The ayah before it in its surah, null for an ayah 1. */
  previous_text: string | null;
};

const REF_COLUMNS =
  "r.group_id, g.kind, r.sort_order, r.surah, r.ayah, r.surah_name_ar, r.pre_text, r.similar_text, r.post_text, q.v2_page, q.text_uthmani, prev.text_uthmani AS previous_text";
/** The ayah before each ref, for the ayah end before it (ayahEndsIn). */
const PREVIOUS_JOIN = "LEFT JOIN quran_text prev ON prev.surah = r.surah AND prev.ayah = r.ayah - 1";

/** Harakat, Quranic annotation marks and tatweel, which do not change which word it is. */
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const LETTER_FORMS: Record<string, string> = {
  "ٱ": "ا",
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ى": "ي",
  "ة": "ه",
  "ؤ": "ء",
  "ئ": "ء",
};

/** A word's letters only, so the same word compares equal across spellings of its marks. */
function letters(word: string): string {
  return word.replace(MARKS, "").replace(/[ٱأإآىةؤئ]/g, (form) => LETTER_FORMS[form]);
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => letters(word) !== "");
}

/** How many words two verses share at their end. */
function sharedEnding(a: readonly string[], b: readonly string[]): number {
  let shared = 0;
  while (shared < a.length && shared < b.length && letters(a[a.length - 1 - shared]) === letters(b[b.length - 1 - shared])) {
    shared += 1;
  }
  return shared;
}

function hasSegments(row: RefRow): boolean {
  return [row.pre_text, row.similar_text, row.post_text].some((segment) => segment !== null && segment.trim() !== "");
}

/**
 * One ref for display. Tail-only groups (the "similar endings" groups) carry no segments, so the verse
 * falls back to its Unicode Quran text, with the ending it shares with `others` marked: the longest
 * ending shared with any of them. Never the page-font glyphs (AGENTS.md).
 */
/**
 * A segment as shown: some refs in the bundled data carry a Latin full stop inside the Quran text, which
 * the verse never has, so it is dropped here (the data itself is protected and left as it is).
 */
function displaySegment(text: string | null): string {
  return (text ?? "").replace(/\./g, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * The ayah ends inside a passage that runs into the ayah before or after the ref's own, only where
 * they are certain, since a wrong number in Quran text misleads:
 * - its own end, when its last word is in the passage and words of another ayah follow;
 * - the previous ayah's end, when its own first word is in the passage and the words before it are
 *   the end of the previous ayah of its surah (the bundled text can carry another surah's ayah there).
 * Words with no letters, such as ۞ or a pause mark, never count as an ayah's text. The passage's
 * words are split as SimilarVerseLine splits them.
 */
function ayahEndsIn(segments: readonly string[], row: RefRow): { after: number; ayah: number }[] {
  const passage = segments.join(" ").split(/\s+/).filter(Boolean);
  const span = ayahSpanIn(passage, row.text_uthmani.split(/\s+/).filter(Boolean));
  if (!span) return [];
  const keyed = (from: number, to: number) =>
    passage
      .slice(from, to)
      .map((word, offset) => ({ key: wordKey(word), index: from + offset }))
      .filter((word) => word.key !== "");
  const ends: { after: number; ayah: number }[] = [];
  const before = keyed(0, span.first);
  if (span.hasStart && before.length > 0 && row.previous_text && endsWith(row.previous_text, before.map((word) => word.key))) {
    ends.push({ after: before[before.length - 1].index, ayah: row.ayah - 1 });
  }
  if (span.hasEnd && keyed(span.last + 1, passage.length).length > 0) ends.push({ after: span.last, ayah: row.ayah });
  return ends;
}

/** Whether an ayah's text ends with these words, compared by wordKey, one mismatch allowed in six or more. */
function endsWith(ayahText: string, tail: readonly string[]): boolean {
  const own = ayahText.split(/\s+/).map(wordKey).filter((key) => key !== "");
  if (tail.length > own.length) return false;
  const end = own.slice(own.length - tail.length);
  const mismatches = end.filter((key, index) => key !== tail[index]).length;
  return mismatches <= (tail.length >= 6 ? 1 : 0);
}

function toRef(row: RefRow, others: readonly RefRow[]): SimilarRef {
  const base = { surah: row.surah, ayah: row.ayah, surahName: row.surah_name_ar ?? "", page: row.v2_page };
  if (hasSegments(row)) {
    const pre = displaySegment(row.pre_text);
    const similar = displaySegment(row.similar_text);
    const post = displaySegment(row.post_text);
    return { ...base, pre, similar, post, ayahEnds: ayahEndsIn([pre, similar, post], row) };
  }
  const own = words(row.text_uthmani);
  const shared = Math.max(0, ...others.map((other) => sharedEnding(own, words(other.text_uthmani))));
  return { ...base, pre: own.slice(0, own.length - shared).join(" "), similar: own.slice(own.length - shared).join(" "), post: "" };
}

function sameAyah(a: { surah: number; ayah: number }, b: { surah: number; ayah: number }): boolean {
  return a.surah === b.surah && a.ayah === b.ayah;
}

/** Each group of `rows` once per ref that `isSelf` picks, with that ref's siblings. */
function groupsOf(rows: readonly RefRow[], isSelf: (row: RefRow) => boolean): SimilarGroup[] {
  const byGroup = new Map<string, RefRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.group_id) ?? [];
    list.push(row);
    byGroup.set(row.group_id, list);
  }
  const groups: SimilarGroup[] = [];
  for (const [groupId, refs] of byGroup) {
    for (const self of refs.filter(isSelf)) {
      const siblings = refs.filter((row) => row !== self && !sameAyah(row, self));
      if (siblings.length === 0) continue;
      groups.push({
        groupId,
        kind: self.kind,
        self: toRef(self, siblings),
        siblings: siblings.map((sibling) => toRef(sibling, [self])),
      });
    }
  }
  return groups;
}

async function readRefRows(db: DatabaseExecutor, ayahs: readonly VerseKey[]): Promise<RefRow[]> {
  const where = ayahs.map(() => "(surah = ? AND ayah = ?)").join(" OR ");
  return db.getAllAsync<RefRow>(
    `SELECT ${REF_COLUMNS}
       FROM mutashabihat_refs r
       JOIN mutashabihat_groups g ON g.id = r.group_id
       JOIN quran_text q ON q.surah = r.surah AND q.ayah = r.ayah
       ${PREVIOUS_JOIN}
      WHERE r.group_id IN (SELECT group_id FROM mutashabihat_refs WHERE ${where})
      ORDER BY r.group_id, r.sort_order`,
    ayahs.flatMap((ayah) => [ayah.surah, ayah.ayah]),
  );
}

/**
 * The similar-verse groups (4.7) that include any of the given ayat, from the bundled NourQuran
 * groups. The text segments come from the canonical data and are only displayed (ETH-12).
 */
export async function similarGroupsForAyahs(
  db: DatabaseExecutor,
  ayahs: readonly { surah: number; ayah: number }[],
): Promise<SimilarGroup[]> {
  if (ayahs.length === 0) return [];
  const rows = await readRefRows(db, ayahs);
  const wanted = new Set(ayahs.map((ayah) => `${ayah.surah}:${ayah.ayah}`));
  return groupsOf(rows, (row) => wanted.has(`${row.surah}:${row.ayah}`));
}

/** MUT-03: the similar-verse groups with a member on any of the given pages, one per member there. */
export async function similarGroupsOnPages(db: DatabaseExecutor, pages: readonly number[]): Promise<SimilarGroup[]> {
  const unique = [...new Set(pages)];
  if (unique.length === 0) return [];
  const rows = await db.getAllAsync<RefRow>(
    `SELECT ${REF_COLUMNS}
       FROM mutashabihat_refs r
       JOIN mutashabihat_groups g ON g.id = r.group_id
       JOIN quran_text q ON q.surah = r.surah AND q.ayah = r.ayah
       ${PREVIOUS_JOIN}
      WHERE r.group_id IN (
              SELECT m.group_id FROM mutashabihat_refs m
                JOIN quran_text p ON p.surah = m.surah AND p.ayah = m.ayah
               WHERE p.v2_page IN (${unique.map(() => "?").join(", ")}))
      ORDER BY r.group_id, r.sort_order`,
    unique,
  );
  const wanted = new Set(unique);
  return groupsOf(rows, (row) => wanted.has(row.v2_page));
}

/** MUT-01: keep only siblings on pages the user already has memorized. */
export function withMemorizedSiblings(groups: readonly SimilarGroup[], memorizedPages: ReadonlySet<number>): SimilarGroup[] {
  return groups
    .map((group) => ({ ...group, siblings: group.siblings.filter((sibling) => memorizedPages.has(sibling.page)) }))
    .filter((group) => group.siblings.length > 0);
}

/**
 * SCH-07: the sibling a drift most likely went into, from the groups of the drifted ayah. A drift goes
 * into a verse the reciter knows, so siblings on memorized pages come first, and among several the one
 * on the most firmly held page (highest stability) wins, since the stronger memory is the one that
 * takes over a recitation. Ties keep the dataset's order. With nothing memorized, an ayah with a single
 * sibling still names it; with several, the drift is left without one rather than guessed.
 */
export function pickDriftSibling(
  groups: readonly SimilarGroup[],
  memorizedPages: ReadonlySet<number>,
  pageStability: ReadonlyMap<number, number>,
): SimilarRef | null {
  const unique = (refs: readonly SimilarRef[]) => [...new Map(refs.map((ref) => [`${ref.surah}:${ref.ayah}`, ref])).values()];
  const all = unique(groups.flatMap((group) => group.siblings));
  const memorized = unique(withMemorizedSiblings(groups, memorizedPages).flatMap((group) => group.siblings));
  if (memorized.length === 0) return all.length === 1 ? all[0] : null;
  return memorized.reduce((best, ref) => ((pageStability.get(ref.page) ?? 0) > (pageStability.get(best.page) ?? 0) ? ref : best));
}

/** MUT-04: a drifted ayah and the sibling it went into, as one similar-verse pair. */
export type SimilarPair = Readonly<{ groupId: string; self: SimilarRef; sibling: SimilarRef }>;

/** One key for a pair of verses in either order, for telling whether a session already asks about it. */
export function pairKey(a: VerseKey, b: VerseKey): string {
  return [`${a.surah}:${a.ayah}`, `${b.surah}:${b.ayah}`].sort().join("|");
}

/** At least this many words of a neighbouring ayah are shown, and more when they are needed to differ. */
const CONTEXT_WORDS = 4;

function wording(text: string): string {
  return words(text).map(letters).join(" ");
}

function readsSame(a: SimilarRef, b: SimilarRef): boolean {
  return wording(`${a.pre} ${a.similar} ${a.post}`) === wording(`${b.pre} ${b.similar} ${b.post}`);
}

/**
 * The ends (or starts) of two neighbouring ayat, long enough to differ, or null when they read the
 * same or either is missing. A missing neighbour is the start or end of a surah; the next level of
 * context is tried instead.
 */
function differingParts(a: string | null, b: string | null, side: "end" | "start"): [string, string] | null {
  if (a === null || b === null || wording(a) === wording(b)) return null;
  const aWords = words(a);
  const bWords = words(b);
  const flip = (list: readonly string[]) => [...list].reverse();
  const shared = side === "end" ? sharedEnding(aWords, bWords) : sharedEnding(flip(aWords), flip(bWords));
  const n = Math.max(CONTEXT_WORDS, shared + 1);
  const part = (list: readonly string[]) => (side === "end" ? list.slice(-n) : list.slice(0, n)).join(" ");
  return [part(aWords), part(bWords)];
}

/**
 * A pair whose two verses read the same could only be told apart by the references a prompt hides,
 * so each verse gets the end of the ayah before it, or, when those match too, the start of the ayah
 * after it. In the bundled data 30 of 4,445 verse pairs read the same; only 23:7 and 70:31 also match
 * on both sides, and they show their surah names.
 */
async function withContext(db: DatabaseExecutor, pair: SimilarPair): Promise<SimilarPair> {
  const neighbours = [pair.self, pair.sibling].flatMap((ref) => [
    { surah: ref.surah, ayah: ref.ayah - 1 },
    { surah: ref.surah, ayah: ref.ayah + 1 },
  ]);
  const rows = await db.getAllAsync<{ surah: number; ayah: number; text_uthmani: string }>(
    `SELECT surah, ayah, text_uthmani FROM quran_text WHERE ${neighbours.map(() => "(surah = ? AND ayah = ?)").join(" OR ")}`,
    neighbours.flatMap((key) => [key.surah, key.ayah]),
  );
  const textOf = (surah: number, ayah: number) => rows.find((row) => row.surah === surah && row.ayah === ayah)?.text_uthmani ?? null;
  const before = differingParts(textOf(pair.self.surah, pair.self.ayah - 1), textOf(pair.sibling.surah, pair.sibling.ayah - 1), "end");
  const after = before ? null : differingParts(textOf(pair.self.surah, pair.self.ayah + 1), textOf(pair.sibling.surah, pair.sibling.ayah + 1), "start");
  const contextOf = (index: 0 | 1): PairContext => ({
    before: before?.[index] ?? null,
    after: after?.[index] ?? null,
    surahName: before === null && after === null,
  });
  return { ...pair, self: { ...pair.self, context: contextOf(0) }, sibling: { ...pair.sibling, context: contextOf(1) } };
}

/**
 * The pair of `self` and `sibling` from a group holding both, or null when no group does. A tail-only
 * verse marks the ending it shares with this sibling. When the two read the same, each carries the
 * context that tells them apart (PairContext).
 */
export async function similarPair(db: DatabaseExecutor, self: VerseKey, sibling: VerseKey): Promise<SimilarPair | null> {
  if (sameAyah(self, sibling)) return null;
  const rows = await readRefRows(db, [self]);
  for (const groupId of new Set(rows.map((row) => row.group_id))) {
    const refs = rows.filter((row) => row.group_id === groupId);
    const selfRow = refs.find((row) => sameAyah(row, self));
    const siblingRow = refs.find((row) => sameAyah(row, sibling));
    if (!selfRow || !siblingRow) continue;
    const pair = { groupId, self: toRef(selfRow, [siblingRow]), sibling: toRef(siblingRow, [selfRow]) };
    return readsSame(pair.self, pair.sibling) ? withContext(db, pair) : pair;
  }
  return null;
}

const DAY_MS = 86_400_000;

/**
 * SCH-07: after the reciter drifted into a similar verse, bring that verse's similar-verse cards due
 * within a day, so the pair is drilled soon. Cards that do not exist yet are left for the smart deck
 * to create. Runs inside the grade transaction.
 */
export async function bringSimilarCardsForward(db: DatabaseExecutor, { surah, ayah, now }: { surah: number; ayah: number; now: Date }): Promise<number> {
  const refs = await db.getAllAsync<{ group_id: string; sort_order: number; kind: string }>(
    `SELECT r.group_id, r.sort_order, g.kind FROM mutashabihat_refs r JOIN mutashabihat_groups g ON g.id = r.group_id
      WHERE r.group_id IN (SELECT group_id FROM mutashabihat_refs WHERE surah = ? AND ayah = ?)`,
    [surah, ayah],
  );
  const ids = refs.map((ref) => `${ref.kind === "tail" ? "similar-tail" : "mutashabihat"}:${ref.group_id}:${ref.sort_order}`);
  if (ids.length === 0) return 0;
  const cards = await db.getAllAsync<StudyCardRow>(
    `SELECT * FROM study_cards WHERE id IN (${ids.map(() => "?").join(", ")}) AND deleted_at IS NULL`,
    ids,
  );
  const latest = new Date(now.getTime() + DAY_MS).toISOString();
  const at = now.toISOString();
  let moved = 0;
  for (const card of cards) {
    if (card.due <= latest) continue;
    await putCardRow(db, { ...card, due: latest, updated_at: at });
    moved += 1;
  }
  return moved;
}
