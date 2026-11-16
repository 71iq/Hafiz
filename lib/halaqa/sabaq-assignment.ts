import { z } from "zod";
import type { AssignedSabaq } from "@/lib/hifz/sabaq";
import { LINES_PER_PAGE, PAGE_COUNT } from "@/lib/hifz/units";
import { forgetSocialCache, readOwnSocialCache, writeOwnSocialCache } from "@/lib/social/cache";
import { requireSocialOwner, type SocialOwner } from "@/lib/social/owner";
import { callSocialRpc, callSocialRpcRaw, parseSocialPayload, socialFailureOf, voidResult } from "@/lib/social/remote";

const assignmentRow = z
  .object({
    group_id: z.string().uuid(),
    group_name: z.string().nullable(),
    teacher_name: z.string().nullable(),
    page: z.number().int().min(1).max(PAGE_COUNT),
    from_line: z.number().int().min(1).max(LINES_PER_PAGE),
    to_line: z.number().int().min(1).max(LINES_PER_PAGE),
    assigned_at: z.string().min(1),
  })
  .refine((row) => row.from_line <= row.to_line);

export const sabaqAssignmentSchema = assignmentRow.transform((row) => ({
  groupId: row.group_id,
  groupName: row.group_name,
  teacherName: row.teacher_name,
  page: row.page,
  fromLine: row.from_line,
  toLine: row.to_line,
  assignedAt: row.assigned_at,
}));
export type SabaqAssignment = z.output<typeof sabaqAssignmentSchema>;

const mineSchema = sabaqAssignmentSchema.nullable();

const SABAQ_ASSIGNMENT_CACHE = "sabaq-assignment";

let readCount = 0;
const savedRead = new Map<string, number>();
const forgets = new Map<string, number>();
const changeListeners = new Set<() => void>();

export function subscribeSabaqAssignmentChanges(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

export async function forgetMySabaqAssignment(userId: string): Promise<void> {
  forgets.set(userId, (forgets.get(userId) ?? 0) + 1);
  readCount += 1;
  savedRead.set(userId, readCount);
  await forgetSocialCache(userId, SABAQ_ASSIGNMENT_CACHE);
  for (const listener of changeListeners) listener();
}

async function readFromServer(userId: string): Promise<{ data: SabaqAssignment | null; stale: boolean }> {
  readCount += 1;
  const read = readCount;
  const owner = requireSocialOwner(userId);
  const payload = await callSocialRpcRaw("get_my_sabaq_assignment", {}, owner);
  const data = parseSocialPayload(mineSchema, payload);
  owner.requireCurrent();
  if (read < (savedRead.get(userId) ?? 0)) return { data, stale: true };
  savedRead.set(userId, read);
  await writeOwnSocialCache(userId, SABAQ_ASSIGNMENT_CACHE, payload, new Date().toISOString());
  return { data, stale: false };
}

const LOAD_TIMEOUT_MS = 5_000;

export async function loadMySabaqAssignment(userId: string | null, offline: boolean): Promise<AssignedSabaq | null> {
  if (!userId) return null;
  const forgetsBefore = forgets.get(userId) ?? 0;
  const result = await loadAssignment(userId, offline);
  return (forgets.get(userId) ?? 0) === forgetsBefore ? result : null;
}

async function loadAssignment(userId: string, offline: boolean): Promise<AssignedSabaq | null> {
  const saved = async () => {
    try {
      return (await readOwnSocialCache(userId, SABAQ_ASSIGNMENT_CACHE, mineSchema))?.data ?? null;
    } catch {
      return null;
    }
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    if (offline) return toAssigned(await saved());
    const fresh = readFromServer(userId);
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), LOAD_TIMEOUT_MS);
    });
    const result = await Promise.race([fresh, timeout]);
    if (result === "timeout") {
      fresh.catch(() => undefined);
      return toAssigned(await saved());
    }
    return toAssigned(result.stale ? await saved() : result.data);
  } catch (error) {
    if (socialFailureOf(error).kind === "account_changed") return null;
    return toAssigned(await saved());
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function toAssigned(assignment: SabaqAssignment | null): AssignedSabaq | null {
  return assignment ? { page: assignment.page, fromLine: assignment.fromLine, toLine: assignment.toLine } : null;
}

export function setSabaqAssignment(
  input: { groupId: string; memberId: string; page: number; fromLine: number; toLine: number },
  owner: SocialOwner,
): Promise<SabaqAssignment> {
  return callSocialRpc(
    "set_halaqa_sabaq_assignment",
    {
      p_group_id: input.groupId,
      p_member_id: input.memberId,
      p_page: input.page,
      p_from_line: input.fromLine,
      p_to_line: input.toLine,
    },
    sabaqAssignmentSchema,
    owner,
  );
}

export function clearSabaqAssignment(groupId: string, memberId: string, owner: SocialOwner): Promise<void> {
  return callSocialRpc(
    "clear_halaqa_sabaq_assignment",
    { p_group_id: groupId, p_member_id: memberId },
    voidResult,
    owner,
  );
}

export function parseAssignmentInput(page: string, fromLine: string, toLine: string): AssignedSabaq | null {
  const read = (value: string) => {
    const digits = value
      .trim()
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
    return /^\d{1,3}$/.test(digits) ? Number(digits) : NaN;
  };
  const parsed = { page: read(page), fromLine: read(fromLine), toLine: read(toLine) };
  if (!(parsed.page >= 1 && parsed.page <= PAGE_COUNT)) return null;
  if (!(parsed.fromLine >= 1 && parsed.toLine <= LINES_PER_PAGE && parsed.fromLine <= parsed.toLine)) return null;
  return parsed;
}
