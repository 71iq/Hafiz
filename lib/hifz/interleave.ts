import type { DatabaseExecutor } from "@/lib/database/types";
import { readMemorizedPageNumbers } from "@/lib/hifz/pages";
import {
  pairKey,
  similarGroupsOnPages,
  withMemorizedSiblings,
  type SimilarGroup,
  type SimilarRef,
} from "@/lib/hifz/similar";

export const INTERLEAVE_PROMPTS_PER_SESSION = 3;

export const INTERLEAVE_AFTER_PAGES = 2;

export type InterleaveCandidates = ReadonlyMap<number, readonly SimilarGroup[]>;

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

export type AskedPairs = Readonly<{ groups: ReadonlySet<string>; pairs: ReadonlySet<string> }>;

export type InterleavePick = Readonly<{ groupId: string; self: SimilarRef; sibling: SimilarRef }>;

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

export function interleaveIndex<T>(queue: readonly T[], from: number, isOtherPage: (item: T) => boolean): number {
  let pages = 0;
  for (let index = from + 1; index < queue.length; index += 1) {
    if (!isOtherPage(queue[index])) continue;
    pages += 1;
    if (pages === INTERLEAVE_AFTER_PAGES) return index + 1;
  }
  return queue.length;
}
