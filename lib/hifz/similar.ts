import type { DatabaseExecutor } from "@/lib/database/types";
import { putCardRow } from "@/lib/fsrs/queries";
import type { StudyCardRow } from "@/lib/fsrs/types";
import { ayahSpanIn, continuesIn, endsAs, foundIn, runsOnIn, wordKey } from "@/lib/hifz/word-diff";

export type PairContext = Readonly<{ before: string | null; after: string | null; surahName: boolean }>;

export type SimilarRef = Readonly<{
  surah: number;
  ayah: number;
  surahName: string;
  pre: string;
  similar: string;
  post: string;
  page: number;
  context?: PairContext;
  ayahEnds?: readonly { after: number; ayah: number }[];
  gaps?: readonly number[];
}>;

type VerseKey = Readonly<{ surah: number; ayah: number }>;

export type SimilarGroup = Readonly<{
  groupId: string;
  kind: "similar" | "tail";
  self: SimilarRef;
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
  previous_text: string | null;
  next_text: string | null;
};

const REF_COLUMNS =
  "r.group_id, g.kind, r.sort_order, r.surah, r.ayah, r.surah_name_ar, r.pre_text, r.similar_text, r.post_text, q.v2_page, q.text_uthmani, prev.text_uthmani AS previous_text, nxt.text_uthmani AS next_text";
const PREVIOUS_JOIN = "LEFT JOIN quran_text prev ON prev.surah = r.surah AND prev.ayah = r.ayah - 1";
const NEXT_JOIN = "LEFT JOIN quran_text nxt ON nxt.surah = r.surah AND nxt.ayah = r.ayah + 1";

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

function letters(word: string): string {
  return word.replace(MARKS, "").replace(/[ٱأإآىةؤئ]/g, (form) => LETTER_FORMS[form]);
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => letters(word) !== "");
}

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

const DATA_AYAH_END = /﴿\s*(\p{Nd}+)\s*﴾/gu;

type DataMark = { after: number; ayah: number | null };

function markNumber(digits: string): number | null {
  if (!/^(?:[0-9]+|[٠-٩]+|[۰-۹]+)$/.test(digits)) return null;
  return Number([...digits].map((digit) => digit.charCodeAt(0) % 16).join(""));
}

function displaySegment(text: string | null): { words: string[]; marks: DataMark[] } {
  const words: string[] = [];
  const marks: DataMark[] = [];
  for (const token of (text ?? "").replace(DATA_AYAH_END, " ﴿$1﴾ ").replace(/[.*]/g, "").split(/\s+/)) {
    const mark = /^﴿(\p{Nd}+)﴾$/u.exec(token);
    if (mark) marks.push({ after: words.length - 1, ayah: markNumber(mark[1]) });
    else if (token !== "") words.push(token);
  }
  return { words, marks };
}

function repeatedWords(before: readonly string[], post: readonly string[], quran: readonly string[]): number {
  if (runsOnIn(before, post, quran)) return 0;
  for (let count = Math.min(before.length, post.length); count > 0; count -= 1) {
    const ending = before.slice(-count).map(wordKey);
    if (ending.includes("") || ending.some((key, index) => key !== wordKey(post[index]))) continue;
    const rest = post.slice(count);
    const sure = rest.length === 0 ? continuesIn(before, post, quran) === false : runsOnIn(before, rest, quran);
    return sure ? count : 0;
  }
  return 0;
}

function withDataEnds(
  passage: readonly string[],
  marks: readonly DataMark[],
  row: RefRow,
  ends: readonly { after: number; ayah: number }[],
): { after: number; ayah: number }[] {
  const texts = new Map([
    [row.ayah - 1, row.previous_text],
    [row.ayah, row.text_uthmani],
    [row.ayah + 1, row.next_text],
  ]);
  const all = [...ends];
  for (const { after, ayah } of marks) {
    const text = ayah === null ? null : texts.get(ayah);
    if (ayah === null || !text || after < 0 || all.some((end) => end.after === after || end.ayah === ayah)) continue;
    const followed = passage.slice(after + 1).some((word) => wordKey(word) !== "");
    if (followed && endsAs(passage.slice(0, after + 1), text.split(/\s+/))) all.push({ after, ayah });
  }
  return all.sort((a, b) => a.after - b.after);
}

function ayahEndsIn(passage: readonly string[], row: RefRow, followed = false): { after: number; ayah: number }[] {
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
  const after = keyed(span.last + 1, passage.length);
  if (span.hasEnd && (after.length > 0 || followed)) ends.push({ after: span.last, ayah: row.ayah });
  const afterKeys = after.map((word) => word.key);
  const next = span.hasEnd && row.next_text ? wholeAyahAt(row.next_text, afterKeys) : null;
  if (next !== null) ends.push({ after: after[next - 1].index, ayah: row.ayah + 1 });
  return ends;
}

function wholeAyahAt(ayahText: string, words: readonly string[]): number | null {
  const own = ayahText
    .split(/\s+/)
    .map(wordKey)
    .filter((key) => key !== "");
  if (own.length === 0 || words.length <= own.length) return null;
  const mismatches = own.filter((key, index) => key !== words[index]).length;
  return mismatches <= (own.length >= 6 ? 1 : 0) ? own.length : null;
}

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
    const [pre, similar, post] = [row.pre_text, row.similar_text, row.post_text].map(displaySegment);
    const quran = [row.previous_text, row.text_uthmani, row.next_text]
      .filter((text): text is string => typeof text === "string")
      .join(" ")
      .split(/\s+/);
    const placed = foundIn(similar.words, quran);
    const repeated = placed ? repeatedWords([...pre.words, ...similar.words], post.words, quran) : 0;
    const segments = [pre.words, similar.words, post.words.slice(repeated)];
    const passage = segments.flat();
    const starts = [0, pre.words.length, pre.words.length + similar.words.length];
    const gaps = [1, 2]
      .filter((index) => placed && segments[index - 1].length > 0 && segments[index].length > 0)
      .filter((index) => continuesIn(passage.slice(0, starts[index]), passage.slice(starts[index]), quran) === false)
      .map((index) => starts[index] - 1);
    const marks = [
      pre.marks,
      similar.marks,
      post.marks.map((mark) => ({ ...mark, after: mark.after - repeated })),
    ].flatMap((list, index) =>
      list.filter((mark) => mark.after >= -1).map((mark) => ({ ...mark, after: starts[index] + mark.after })),
    );
    const runStart = gaps.includes(starts[1] - 1) ? starts[1] : 0;
    const runEnd = gaps.includes(starts[2] - 1) ? starts[2] : passage.length;
    const followed = passage.slice(runEnd).some((word) => wordKey(word) !== "");
    const ends = ayahEndsIn(passage.slice(runStart, runEnd), row, followed).map((end) => ({
      ...end,
      after: end.after + runStart,
    }));
    return {
      ...base,
      pre: segments[0].join(" "),
      similar: segments[1].join(" "),
      post: segments[2].join(" "),
      ayahEnds: withDataEnds(passage, marks, row, ends),
      gaps,
    };
  }
  const own = words(row.text_uthmani);
  const shared = Math.max(0, ...others.map((other) => sharedEnding(own, words(other.text_uthmani))));
  return { ...base, pre: own.slice(0, own.length - shared).join(" "), similar: own.slice(own.length - shared).join(" "), post: "" };
}

function sameAyah(a: { surah: number; ayah: number }, b: { surah: number; ayah: number }): boolean {
  return a.surah === b.surah && a.ayah === b.ayah;
}

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
       ${NEXT_JOIN}
      WHERE r.group_id IN (SELECT group_id FROM mutashabihat_refs WHERE ${where})
      ORDER BY r.group_id, r.sort_order`,
    ayahs.flatMap((ayah) => [ayah.surah, ayah.ayah]),
  );
}

export async function similarGroupsForAyahs(
  db: DatabaseExecutor,
  ayahs: readonly { surah: number; ayah: number }[],
): Promise<SimilarGroup[]> {
  if (ayahs.length === 0) return [];
  const rows = await readRefRows(db, ayahs);
  const wanted = new Set(ayahs.map((ayah) => `${ayah.surah}:${ayah.ayah}`));
  return groupsOf(rows, (row) => wanted.has(`${row.surah}:${row.ayah}`));
}

export async function similarGroupsOnPages(db: DatabaseExecutor, pages: readonly number[]): Promise<SimilarGroup[]> {
  const unique = [...new Set(pages)];
  if (unique.length === 0) return [];
  const rows = await db.getAllAsync<RefRow>(
    `SELECT ${REF_COLUMNS}
       FROM mutashabihat_refs r
       JOIN mutashabihat_groups g ON g.id = r.group_id
       JOIN quran_text q ON q.surah = r.surah AND q.ayah = r.ayah
       ${PREVIOUS_JOIN}
       ${NEXT_JOIN}
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

export function withMemorizedSiblings(groups: readonly SimilarGroup[], memorizedPages: ReadonlySet<number>): SimilarGroup[] {
  return groups
    .map((group) => ({ ...group, siblings: group.siblings.filter((sibling) => memorizedPages.has(sibling.page)) }))
    .filter((group) => group.siblings.length > 0);
}

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

export type SimilarPair = Readonly<{ groupId: string; self: SimilarRef; sibling: SimilarRef }>;

export function pairKey(a: VerseKey, b: VerseKey): string {
  return [`${a.surah}:${a.ayah}`, `${b.surah}:${b.ayah}`].sort().join("|");
}

const CONTEXT_WORDS = 4;

function wording(text: string): string {
  return words(text).map(letters).join(" ");
}

function readsSame(a: SimilarRef, b: SimilarRef): boolean {
  return wording(`${a.pre} ${a.similar} ${a.post}`) === wording(`${b.pre} ${b.similar} ${b.post}`);
}

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
