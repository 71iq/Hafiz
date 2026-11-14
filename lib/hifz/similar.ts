import type { DatabaseExecutor } from "@/lib/database/types";
import { putCardRow } from "@/lib/fsrs/queries";
import type { StudyCardRow } from "@/lib/fsrs/types";

export type SimilarRef = Readonly<{
  surah: number;
  ayah: number;
  surahName: string;
  pre: string;
  similar: string;
  post: string;
  page: number;
}>;

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
};

/**
 * The similar-verse groups (4.7) that include any of the given ayat, from the bundled NourQuran
 * groups. The text segments come from the canonical data and are only displayed (ETH-12).
 */
export async function similarGroupsForAyahs(
  db: DatabaseExecutor,
  ayahs: readonly { surah: number; ayah: number }[],
): Promise<SimilarGroup[]> {
  if (ayahs.length === 0) return [];
  const where = ayahs.map(() => "(surah = ? AND ayah = ?)").join(" OR ");
  const rows = await db.getAllAsync<RefRow>(
    `SELECT r.group_id, g.kind, r.sort_order, r.surah, r.ayah, r.surah_name_ar, r.pre_text, r.similar_text, r.post_text, q.v2_page
       FROM mutashabihat_refs r
       JOIN mutashabihat_groups g ON g.id = r.group_id
       JOIN quran_text q ON q.surah = r.surah AND q.ayah = r.ayah
      WHERE r.group_id IN (SELECT group_id FROM mutashabihat_refs WHERE ${where})
      ORDER BY r.group_id, r.sort_order`,
    ayahs.flatMap((ayah) => [ayah.surah, ayah.ayah]),
  );
  const wanted = new Set(ayahs.map((ayah) => `${ayah.surah}:${ayah.ayah}`));
  const byGroup = new Map<string, RefRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.group_id) ?? [];
    list.push(row);
    byGroup.set(row.group_id, list);
  }
  const toRef = (row: RefRow): SimilarRef => ({
    surah: row.surah,
    ayah: row.ayah,
    surahName: row.surah_name_ar ?? "",
    pre: row.pre_text ?? "",
    similar: row.similar_text ?? "",
    post: row.post_text ?? "",
    page: row.v2_page,
  });
  const groups: SimilarGroup[] = [];
  for (const [groupId, refs] of byGroup) {
    for (const self of refs.filter((row) => wanted.has(`${row.surah}:${row.ayah}`))) {
      const siblings = refs.filter((row) => row !== self && !(row.surah === self.surah && row.ayah === self.ayah));
      if (siblings.length === 0) continue;
      groups.push({ groupId, kind: self.kind, self: toRef(self), siblings: siblings.map(toRef) });
    }
  }
  return groups;
}

/** MUT-01: keep only siblings on pages the user already has memorized. */
export function withMemorizedSiblings(groups: readonly SimilarGroup[], memorizedPages: ReadonlySet<number>): SimilarGroup[] {
  return groups
    .map((group) => ({ ...group, siblings: group.siblings.filter((sibling) => memorizedPages.has(sibling.page)) }))
    .filter((group) => group.siblings.length > 0);
}

type VerseKey = Readonly<{ surah: number; ayah: number }>;

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

/** The pair of `self` and `sibling` from a group holding both, or null when no group does. */
export async function similarPair(db: DatabaseExecutor, self: VerseKey, sibling: VerseKey): Promise<SimilarPair | null> {
  const groups = await similarGroupsForAyahs(db, [self]);
  for (const group of groups) {
    const match = group.siblings.find((ref) => ref.surah === sibling.surah && ref.ayah === sibling.ayah);
    if (match) return { groupId: group.groupId, self: group.self, sibling: match };
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
