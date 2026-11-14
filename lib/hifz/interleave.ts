import type { DatabaseExecutor } from "@/lib/database/types";
import { readMemorizedPageNumbers } from "@/lib/hifz/pages";
import {
  pairKey,
  similarGroupsOnPages,
  withMemorizedSiblings,
  type SimilarGroup,
  type SimilarRef,
} from "@/lib/hifz/similar";

/**
 * MUT-03: at most this many interleaved "Which one?" prompts join one wird review. At roughly 20
 * seconds each, three add about a minute, and they stay below the 6 inbox drills ERR-04 allows, so a
 * long review remains a review of pages. The groups of the earliest reviewed pages are asked first.
 */
export const INTERLEAVE_PROMPTS_PER_SESSION = 3;

/** MUT-03: a prompt follows this many other pages after the page that brought it. */
export const INTERLEAVE_AFTER_PAGES = 2;

/** The similar-verse groups on each page of a review that have a sibling the person has memorized. */
export type InterleaveCandidates = ReadonlyMap<number, readonly SimilarGroup[]>;

/** MUT-03: the candidate groups for a review's pages, read once when the review loads. */
export async function loadInterleaveCandidates(
  db: DatabaseExecutor,
  pages: readonly number[],
): Promise<InterleaveCandidates> {
  const groups = await similarGroupsOnPages(db, pages);
  if (groups.length === 0) return new Map();
  const memorized = await readMemorizedPageNumbers(db);
  const byPage = new Map<number, SimilarGroup[]>();
  for (const group of withMemorizedSiblings(groups, memorized)) {
    const list = byPage.get(group.self.page) ?? [];
    list.push(group);
    byPage.set(group.self.page, list);
  }
  return byPage;
}

/** What a session already asks about, by group and by verse pair (pairKey), drift prompts included. */
export type AskedPairs = Readonly<{ groups: ReadonlySet<string>; pairs: ReadonlySet<string> }>;

export type InterleavePick = Readonly<{ groupId: string; self: SimilarRef; sibling: SimilarRef }>;

/**
 * MUT-03: what to ask about after a page is reviewed: the first of its groups the session does not
 * already ask about, by group or by verse pair, with a sibling on another page before one on the same
 * page. Null once the session has `INTERLEAVE_PROMPTS_PER_SESSION` prompts.
 */
export function pickInterleavePair(
  groups: readonly SimilarGroup[],
  asked: AskedPairs,
  prompted: number,
): InterleavePick | null {
  if (prompted >= INTERLEAVE_PROMPTS_PER_SESSION) return null;
  for (const group of groups) {
    if (asked.groups.has(group.groupId)) continue;
    const open = group.siblings.filter((sibling) => !asked.pairs.has(pairKey(group.self, sibling)));
    const sibling = open.find((candidate) => candidate.page !== group.self.page) ?? open[0];
    if (sibling) return { groupId: group.groupId, self: group.self, sibling };
  }
  return null;
}

/**
 * MUT-03: where a prompt goes in a session's queue: right after the second other page that follows
 * `from`, or at the end when fewer follow.
 */
export function interleaveIndex<T>(queue: readonly T[], from: number, isOtherPage: (item: T) => boolean): number {
  let pages = 0;
  for (let index = from + 1; index < queue.length; index += 1) {
    if (!isOtherPage(queue[index])) continue;
    pages += 1;
    if (pages === INTERLEAVE_AFTER_PAGES) return index + 1;
  }
  return queue.length;
}
