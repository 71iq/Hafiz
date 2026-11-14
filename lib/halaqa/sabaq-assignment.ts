import { z } from "zod";
import type { AssignedSabaq } from "@/lib/hifz/sabaq";
import { LINES_PER_PAGE, PAGE_COUNT } from "@/lib/hifz/units";
import { loadWithSocialCache, readOwnSocialCache } from "@/lib/social/cache";
import type { SocialOwner } from "@/lib/social/owner";
import { callSocialRpc, socialFailureOf, voidResult, type SocialRead } from "@/lib/social/remote";

/**
 * SOC-03: a teacher's next sabaq for a member, a page and a range of its lines. A teacher sets or clears
 * it from the teacher view while the member shares their plan with teachers; the member's sabaq then
 * memorizes those lines (nextSabaqTarget) until they are memorized. Withdrawn sharing, a change of role
 * or leaving the halaqa ends it on the server.
 */
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

/** The offline copy's name under the account's social cache (lib/social/cache.ts). */
const SABAQ_ASSIGNMENT_CACHE = "sabaq-assignment";

/** The server's latest live assignment for the signed-in account, across its halaqas. */
function mySabaqAssignmentRead(): SocialRead<SabaqAssignment | null> {
  return { fn: "get_my_sabaq_assignment", args: {}, schema: mineSchema };
}

/** How long the sabaq screen waits for the server before it uses the saved copy. */
const LOAD_TIMEOUT_MS = 5_000;

/**
 * The signed-in member's next sabaq from a teacher, for choosing a lesson's lines: the server's answer,
 * kept as the offline copy, or that copy when the server cannot answer in time. Null when signed out,
 * when the account changed meanwhile, or when nothing is assigned or saved. Never throws, so a lesson
 * always loads.
 */
export async function loadMySabaqAssignment(userId: string | null, offline: boolean): Promise<AssignedSabaq | null> {
  if (!userId) return null;
  const saved = async () => {
    try {
      return (await readOwnSocialCache(userId, SABAQ_ASSIGNMENT_CACHE, mineSchema))?.data ?? null;
    } catch {
      return null;
    }
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const fresh = loadWithSocialCache({ userId, name: SABAQ_ASSIGNMENT_CACHE, read: mySabaqAssignmentRead(), offline });
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), LOAD_TIMEOUT_MS);
    });
    const result = await Promise.race([fresh, timeout]);
    // A late answer still saves its copy for the next lesson.
    if (result === "timeout") {
      fresh.catch(() => undefined);
      return toAssigned(await saved());
    }
    return toAssigned(result.data);
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

/**
 * A page and line range a teacher typed, in Western or Arabic-Indic digits, or null when it is not one
 * the server accepts.
 */
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
