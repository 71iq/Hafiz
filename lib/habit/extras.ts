import { z } from "zod";
import type { DatabaseExecutor } from "@/lib/database/types";
import { addDays, diffDays, isLocalDate, type LocalDate } from "@/lib/habit/dates";

/**
 * Wird extras (5.4): at most 2 optional suggestions a day under the wird, each pointing at learning
 * behavior and hidden with one tap. No points, gems or chests (QST-04): completing one only marks it
 * done with a line of encouragement.
 */
export const EXTRA_KINDS = ["strengthen", "connect", "salah", "deepen"] as const;
export type ExtraKind = (typeof EXTRA_KINDS)[number];

export const EXTRAS_PER_DAY = 2;
/** QST-03: a kind hidden 3 times in a row is not offered for 2 weeks. */
const SNOOZE_AFTER_SKIPS = 3;
const SNOOZE_DAYS = 14;

const localDate = z.string().refine(isLocalDate);
const stateSchema = z.object({
  date: localDate,
  hidden: z.array(z.enum(EXTRA_KINDS)),
  done: z.array(z.enum(EXTRA_KINDS)),
  skips: z.partialRecord(z.enum(EXTRA_KINDS), z.number().int().min(0)),
  snoozedUntil: z.partialRecord(z.enum(EXTRA_KINDS), localDate),
});
export type ExtrasState = z.infer<typeof stateSchema>;

export const EXTRAS_STATE_KEY = "device_wird_extras";

export function emptyExtrasState(today: LocalDate): ExtrasState {
  return { date: today, hidden: [], done: [], skips: {}, snoozedUntil: {} };
}

/** Today's state: a new day keeps the skip counts and snoozes but clears hidden and done. */
export function parseExtrasState(value: string | null | undefined, today: LocalDate): ExtrasState {
  if (!value) return emptyExtrasState(today);
  try {
    const parsed = stateSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return emptyExtrasState(today);
    if (parsed.data.date === today) return parsed.data;
    return { ...parsed.data, date: today, hidden: [], done: [] };
  } catch {
    return emptyExtrasState(today);
  }
}

export type ExtrasContext = Readonly<{
  today: LocalDate;
  /** Open mistake-inbox items (strengthen needs some). */
  inboxCount: number;
  /** Memorized pages exist (connect and salah need something to recite). */
  hasMemorizedPages: boolean;
  /** New lines were memorized today (deepen points at their tafsir). */
  sabaqToday: boolean;
  /** What the log shows was done today, so an extra completes without a tap. */
  doneToday: ReadonlySet<ExtraKind>;
}>;

function eligible(kind: ExtraKind, context: ExtrasContext): boolean {
  switch (kind) {
    case "strengthen":
      return context.inboxCount > 0;
    case "connect":
    case "salah":
      return context.hasMemorizedPages;
    case "deepen":
      return context.sabaqToday;
  }
}

/**
 * The extras to show today, up to 2, rotating by date so the same two are not always first. A
 * snoozed or hidden kind is skipped; a kind done today stays visible as done.
 */
export function chooseExtras(state: ExtrasState, context: ExtrasContext): ExtraKind[] {
  const offset = Math.abs(diffDays("2026-01-01", context.today)) % EXTRA_KINDS.length;
  const rotated = [...EXTRA_KINDS.slice(offset), ...EXTRA_KINDS.slice(0, offset)];
  return rotated
    .filter((kind) => eligible(kind, context) || context.doneToday.has(kind))
    .filter((kind) => !state.hidden.includes(kind))
    .filter((kind) => {
      const until = state.snoozedUntil[kind];
      return !until || until < context.today;
    })
    .slice(0, EXTRAS_PER_DAY);
}

/** Hide an extra for today and count the skip; the third skip in a row snoozes it (QST-03). */
export function hideExtra(state: ExtrasState, kind: ExtraKind): ExtrasState {
  const skips = (state.skips[kind] ?? 0) + 1;
  const snoozed = skips >= SNOOZE_AFTER_SKIPS;
  return {
    ...state,
    hidden: [...new Set([...state.hidden, kind])],
    skips: { ...state.skips, [kind]: snoozed ? 0 : skips },
    snoozedUntil: snoozed ? { ...state.snoozedUntil, [kind]: addDays(state.date, SNOOZE_DAYS) } : state.snoozedUntil,
  };
}

/** Completing an extra resets its skip count. */
export function completeExtra(state: ExtrasState, kind: ExtraKind): ExtrasState {
  return { ...state, done: [...new Set([...state.done, kind])], skips: { ...state.skips, [kind]: 0 } };
}

/** What today's log already shows: a listener's grade, a page recited in salah, 3 inbox items cleaned. */
export async function readExtrasDoneToday(db: DatabaseExecutor, today: LocalDate): Promise<Set<ExtraKind>> {
  const [graders, cleaned] = await Promise.all([
    db.getAllAsync<{ grader: string }>("SELECT DISTINCT grader FROM study_log WHERE local_date = ? AND grader IS NOT NULL", [today]),
    db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM recitation_errors WHERE last_clean_date = ? AND deleted_at IS NULL",
      [today],
    ),
  ]);
  const done = new Set<ExtraKind>();
  if (graders.some((row) => row.grader === "teacher")) done.add("connect");
  if (graders.some((row) => row.grader === "salah")) done.add("salah");
  if ((cleaned?.count ?? 0) >= 3) done.add("strengthen");
  return done;
}
