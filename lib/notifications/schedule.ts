import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { addDays, type LocalDate } from "@/lib/habit/dates";
import { readHabitDays } from "@/lib/habit/queries";
import { effectiveWeekStart, readHabitSettings } from "@/lib/habit/settings";
import { notificationsStrings } from "@/lib/i18n/features/notifications";
import { interpolate } from "@/lib/i18n/useStrings";
import { createId } from "@/lib/id";
import { readPrayerLocation } from "@/lib/prayer/settings";
import { createPrayerTimesLookup } from "@/lib/prayer/times";
import { deviceClock, type DayClock } from "@/lib/notifications/clock";
import { buildDayTimes, isQuietAt } from "@/lib/notifications/day-times";
import { projectHabit } from "@/lib/notifications/habit-projection";
import {
  countConsecutiveIgnored,
  deleteLogRows,
  findConversions,
  insertLogRow,
  isFired,
  markCancelled,
  markConverted,
  markDelivered,
  markOpened,
  pruneLog,
  readBackoffRows,
  readLatestSessionAt,
  readLogSince,
  readSessionStartsSince,
} from "@/lib/notifications/log";
import {
  backoffLevel,
  PLAN_HORIZON_DAYS,
  planNotifications,
  streakFingerprint,
  type DeliveredReminder,
  type PlannerInput,
  type PlanResult,
  type ReminderFactValues,
} from "@/lib/notifications/planner";
import { reminderPlatform } from "@/lib/notifications/platform";
import type { ReminderData, ReminderResponse, ScheduledReminder } from "@/lib/notifications/platform-types";
import { hijriDateOf, isRamadan, RAMADAN_MONTH } from "@/lib/notifications/ramadan";
import {
  backoffSchema,
  type BackoffState,
  groupPendingSchema,
  LOCAL_KEYS,
  readLocalSetting,
  readReminderPrefs,
  readUiLanguage,
  remindLaterSchema,
  writeLocalSetting,
} from "@/lib/notifications/settings";
import { NO_REPEAT_DAYS, renderNotification, type Language, type SurahNames } from "@/lib/notifications/templates";
import { WIRD_TYPES, type NotificationLogRow, type PlannedSlot, type ReminderPrefs } from "@/lib/notifications/types";

const DAY_MS = 86_400_000;
/**
 * A reminder due this soon may fire while the run is in progress. It is left as it is while the plan
 * still has it, because replacing it could show it twice.
 */
const NEAR_FIRE_MS = 2 * 60_000;
const REMIND_LATER_DELAY_MS = 60 * 60_000;

export type ReminderContext = Readonly<{
  prefs: ReminderPrefs;
  input: PlannerInput;
  log: NotificationLogRow[];
  sessionStarts: string[];
  /** NOT-09: reminders ignored since the latest session, which `since` names (null before any). */
  ignored: Readonly<{ consecutive: number; since: string | null }>;
  language: Language;
  surahNames: SurahNames;
}>;

const SURAH_CARD = /^(\d{1,3}):\d{1,3}$/;

/** The most overdue ayah card's surah for each date, so copy can name it (NOT-14). */
async function readDueSurahs(db: DatabaseExecutor, through: Date): Promise<{ surah: number; due: string }[]> {
  const rows = await db.getAllAsync<{ id: string; due: string }>(
    "SELECT id, due FROM study_cards WHERE deleted_at IS NULL AND suspended_at IS NULL AND due <= ? ORDER BY due LIMIT 300",
    [through.toISOString()],
  );
  return rows.flatMap((row) => {
    const match = SURAH_CARD.exec(row.id);
    return match ? [{ surah: Number(match[1]), due: row.due }] : [];
  });
}

async function readSurahNames(db: DatabaseExecutor, numbers: readonly number[]): Promise<SurahNames> {
  if (numbers.length === 0) return () => null;
  const unique = [...new Set(numbers)];
  const rows = await db.getAllAsync<{ number: number; name_arabic: string; name_english: string }>(
    `SELECT number, name_arabic, name_english FROM surahs WHERE number IN (${unique.map(() => "?").join(", ")})`,
    unique,
  );
  const byNumber = new Map(rows.map((row) => [row.number, row]));
  return (surah, language) => {
    const row = byNumber.get(surah);
    if (!row) return null;
    const name = language === "ar" ? row.name_arabic.replace(/^سورة\s+/, "") : row.name_english;
    return interpolate(notificationsStrings[language].notifSurahName, { name });
  };
}

function isRamadanStart(date: LocalDate): boolean {
  const hijri = hijriDateOf(date);
  return hijri !== null && hijri.month === RAMADAN_MONTH && hijri.day === 1;
}

/** Everything the planner needs, read from the local database. */
export async function loadReminderContext(
  db: DatabaseExecutor,
  { now, language, clock = deviceClock }: { now: Date; language?: Language; clock?: DayClock },
): Promise<ReminderContext> {
  const since = new Date(now.getTime() - (NO_REPEAT_DAYS + 1) * DAY_MS);
  const today = clock.dateOf(now);
  const horizonEnd = clock.at(addDays(today, PLAN_HORIZON_DAYS), 0);
  const [prefs, location, days, habitSettings, log, sessionStarts, remindLater, groupPending, lang, due, latestSession, storedBackoff] =
    await Promise.all([
      readReminderPrefs(db),
      readPrayerLocation(db),
      readHabitDays(db),
      readHabitSettings(db),
      readLogSince(db, since),
      readSessionStartsSince(db, since),
      readLocalSetting(db, LOCAL_KEYS.remindLater, remindLaterSchema),
      readLocalSetting(db, LOCAL_KEYS.groupPending, groupPendingSchema),
      language ? Promise.resolve(language) : readUiLanguage(db),
      readDueSurahs(db, horizonEnd),
      readLatestSessionAt(db),
      readLocalSetting(db, LOCAL_KEYS.backoff, backoffSchema),
    ]);
  const [surahNames, backoffRows] = await Promise.all([
    readSurahNames(
      db,
      due.map((item) => item.surah),
    ),
    readBackoffRows(db, latestSession),
  ]);
  const facts = (date: LocalDate): ReminderFactValues => {
    const endOfDate = clock.at(addDays(date, 1), 0).toISOString();
    const first = due.find((item) => item.due <= endOfDate && surahNames(item.surah, "en") !== null);
    return first ? { surah: first.surah } : {};
  };
  // NOT-09 counts from the latest session, not from the rows this run reads for templates and caps.
  const counted = countConsecutiveIgnored(backoffRows, latestSession === null ? [] : [latestSession], now);
  const sameSession = storedBackoff?.since !== undefined && storedBackoff.since === latestSession;
  const ignored = {
    consecutive: sameSession ? Math.max(counted, storedBackoff.consecutive_ignored) : counted,
    since: latestSession,
  };
  const delivered: DeliveredReminder[] = log
    .filter((row) => isFired(row, now))
    .map((row) => ({ type: row.type, templateId: row.template_id, localDate: row.local_date, at: new Date(row.scheduled_for) }));
  // Upcoming reminders keep their template, so an unchanged reminder keeps its OS notification.
  const preferredTemplates = new Map(
    log
      .filter((row) => row.cancelled_at === null && Date.parse(row.scheduled_for) > now.getTime())
      .map((row) => [`${row.type}|${row.local_date}`, row.template_id] as const),
  );
  const input: PlannerInput = {
    now,
    clock,
    prefs,
    prayers: createPrayerTimesLookup(location),
    isRamadan,
    isRamadanStart,
    habit: { days, pause: habitSettings.pause },
    minimum: habitSettings.minimum,
    weekStart: effectiveWeekStart(habitSettings, lang),
    backoff: backoffLevel(ignored.consecutive),
    delivered,
    remindLater,
    groupPending,
    facts,
    preferredTemplates,
  };
  return { prefs, input, log, sessionStarts, ignored, language: lang, surahNames };
}

/** A short stable hash, so an unchanged reminder keeps its OS notification. */
function contentKeyOf(parts: readonly (string | number | boolean)[]): string {
  let hash = 5381;
  for (const char of parts.join("␟")) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

export type DesiredReminder = Readonly<{
  slot: PlannedSlot;
  title: string;
  body: string;
  remindLaterAction: boolean;
  contentKey: string;
}>;

/** Match what is scheduled against what should be: unchanged reminders stay, the rest is replaced. */
export function diffReminders(
  scheduled: readonly ScheduledReminder[],
  desired: readonly DesiredReminder[],
): { keep: ScheduledReminder[]; cancel: ScheduledReminder[]; create: DesiredReminder[] } {
  const available = new Map<string, ScheduledReminder[]>();
  for (const item of scheduled) available.set(item.data.contentKey, [...(available.get(item.data.contentKey) ?? []), item]);
  const keep: ScheduledReminder[] = [];
  const create: DesiredReminder[] = [];
  for (const item of desired) {
    const match = available.get(item.contentKey)?.shift();
    if (match) keep.push(match);
    else create.push(item);
  }
  const cancel = [...available.values()].flat();
  return { keep, cancel, create };
}

/**
 * The run's reconcile step. A reminder due within NEAR_FIRE_MS stays exactly as scheduled while the
 * plan still has its type on its date, and that planned slot is dropped; one the plan no longer has
 * is cancelled. A reminder whose time has passed already fired, so it only leaves the OS schedule.
 * Everything later is matched by content.
 */
export function reconcileReminders(
  scheduled: readonly ScheduledReminder[],
  desired: readonly DesiredReminder[],
  now: Date,
): { keep: ScheduledReminder[]; cancel: ScheduledReminder[]; create: DesiredReminder[] } {
  const nearFireBy = now.getTime() + NEAR_FIRE_MS;
  const remaining = [...desired];
  const keep: ScheduledReminder[] = [];
  const cancel: ScheduledReminder[] = [];
  const later: ScheduledReminder[] = [];
  for (const item of scheduled) {
    if (item.data.at <= now.getTime()) cancel.push(item);
    else if (item.data.at > nearFireBy) later.push(item);
    else {
      const index = remaining.findIndex(
        (wanted) => wanted.slot.type === item.data.type && wanted.slot.localDate === item.data.localDate,
      );
      if (index < 0) cancel.push(item);
      else {
        keep.push(item);
        remaining.splice(index, 1);
      }
    }
  }
  const rest = diffReminders(later, remaining);
  return { keep: [...keep, ...rest.keep], cancel: [...cancel, ...rest.cancel], create: rest.create };
}

/**
 * Log rows for cancelled reminders. A row for a reminder that was never close to firing goes, as it
 * carries no signal. One cancelled within NEAR_FIRE_MS of its time is kept as cancelled, so it never
 * counts as delivered. One whose time has passed already fired and keeps its row.
 */
async function recordCancelled(db: DatabaseExecutor, cancelled: readonly ScheduledReminder[], now: Date): Promise<void> {
  const nearFireBy = now.getTime() + NEAR_FIRE_MS;
  await deleteLogRows(
    db,
    cancelled.filter((item) => item.data.at > nearFireBy).map((item) => item.data.logId),
  );
  await markCancelled(
    db,
    cancelled.filter((item) => item.data.at > now.getTime() && item.data.at <= nearFireBy).map((item) => item.data.logId),
    now,
  );
}

function renderDesired(context: ReminderContext, slots: readonly PlannedSlot[]): DesiredReminder[] {
  const { prefs, input, language, surahNames } = context;
  return slots.map((slot) => {
    const { title, body } = renderNotification(slot, language, surahNames);
    // The follow-up action appears only where an hour later is still outside quiet hours (NOT-08).
    const times = buildDayTimes(
      {
        clock: input.clock,
        prayers: input.prayers,
        anchor: prefs.anchor,
        ramadanAnchor: prefs.ramadanAnchor,
        isRamadan: input.isRamadan,
      },
      slot.localDate,
    );
    const later = new Date(slot.at.getTime() + REMIND_LATER_DELAY_MS);
    const remindLaterAction =
      prefs.types.remind_later &&
      WIRD_TYPES.has(slot.type) &&
      slot.type !== "remind_later" &&
      later.getTime() < times.endsAt.getTime() &&
      !isQuietAt(times, later);
    return {
      slot,
      title,
      body,
      remindLaterAction,
      contentKey: contentKeyOf([slot.type, slot.localDate, slot.at.getTime(), title, body, remindLaterAction]),
    };
  });
}

export type RescheduleResult = Readonly<{
  status: "scheduled" | "unsupported" | "disabled" | "no_permission";
  plan: PlanResult | null;
  kept: number;
  created: number;
  cancelled: number;
  failed: number;
}>;

async function recordOutcomes(db: DatabaseExecutor, context: ReminderContext, now: Date): Promise<void> {
  await markConverted(db, findConversions(context.log, context.sessionStarts, now));
  const { consecutive, since } = context.ignored;
  const level = backoffLevel(consecutive);
  const stored = await readLocalSetting(db, LOCAL_KEYS.backoff, backoffSchema);
  if (!stored || stored.consecutive_ignored !== consecutive || stored.level !== level || stored.since !== since) {
    const state: BackoffState = { consecutive_ignored: consecutive, level, since };
    await writeLocalSetting(db, LOCAL_KEYS.backoff, state);
  }
  await pruneLog(db, now);
}

async function clearSpentPending(db: DatabaseExecutor, context: ReminderContext, now: Date, plan: PlanResult): Promise<void> {
  const { remindLater, groupPending } = context.input;
  if (remindLater && !plan.slots.some((slot) => slot.type === "remind_later")) {
    await writeLocalSetting(db, LOCAL_KEYS.remindLater, null);
  }
  if (groupPending) {
    const first = Date.parse(groupPending.first_received_at);
    const sent = context.log.some(
      (row) => row.type === "group_encouragement" && Date.parse(row.scheduled_for) >= first && isFired(row, now),
    );
    if (sent) await writeLocalSetting(db, LOCAL_KEYS.groupPending, null);
  }
}

const COVERED_KINDS: readonly string[] = ["done_today", "excused_today", "paused"];

/** Remove reminders for past dates (NOT-06) and today's wird reminders once the day is covered (NOT-05). */
async function tidyPresented(db: DatabaseExecutor, context: ReminderContext, now: Date, covered: boolean): Promise<void> {
  const presented = await reminderPlatform.listPresented();
  await markDelivered(
    db,
    presented.map((item) => item.data.logId),
    now,
  );
  const today = context.input.clock.dateOf(now);
  const stale = presented.filter(
    (item) => item.data.localDate < today || (covered && item.data.localDate === today && WIRD_TYPES.has(item.data.type)),
  );
  if (stale.length > 0) await reminderPlatform.dismiss(stale.map((item) => item.osId));
}

async function updateBadge(context: ReminderContext, permitted: boolean, covered: boolean): Promise<void> {
  await reminderPlatform.setBadge(permitted && context.prefs.enabled && context.prefs.badge && !covered ? 1 : 0);
}

async function cancelEverything(db: DatabaseExecutor, scheduled: readonly ScheduledReminder[], now: Date): Promise<number> {
  await reminderPlatform.cancel(scheduled.map((item) => item.osId));
  await recordCancelled(db, scheduled, now);
  return scheduled.length;
}

async function runReschedule(db: AppDatabase, now: Date, language?: Language): Promise<RescheduleResult> {
  const context = await loadReminderContext(db, { now, language });
  await recordOutcomes(db, context, now);
  const empty = { plan: null, kept: 0, created: 0, cancelled: 0, failed: 0 };
  if (!reminderPlatform.supportsScheduling) return { status: "unsupported", ...empty };

  const permission = await reminderPlatform.getPermission();
  const scheduled = await reminderPlatform.listScheduled();
  const permitted = permission.status === "granted";
  const today = context.input.clock.dateOf(now);
  const covered = COVERED_KINDS.includes(projectHabit(context.input, today, now).snapshot.headline.kind);
  await updateBadge(context, permitted, covered);
  if (!permitted || !context.prefs.enabled) {
    const cancelled = await cancelEverything(db, scheduled, now);
    return { status: permitted ? "disabled" : "no_permission", ...empty, cancelled };
  }

  await tidyPresented(db, context, now, covered);
  const plan = planNotifications(context.input);
  await clearSpentPending(db, context, now, plan);
  const desired = renderDesired(context, plan.slots);
  const { keep, cancel, create } = reconcileReminders(scheduled, desired, now);

  await reminderPlatform.cancel(cancel.map((item) => item.osId));
  await recordCancelled(db, cancel, now);
  const scheduledIds = new Set(scheduled.map((item) => item.data.logId));
  const lost = context.log.filter(
    (row) => Date.parse(row.scheduled_for) > now.getTime() + NEAR_FIRE_MS && !scheduledIds.has(row.id),
  );
  await deleteLogRows(
    db,
    lost.map((row) => row.id),
  );

  let failed = 0;
  for (const item of create) {
    const logId = createId("notif");
    const data: ReminderData = {
      source: "hafiz-reminder",
      logId,
      type: item.slot.type,
      localDate: item.slot.localDate,
      route: item.slot.route,
      at: item.slot.at.getTime(),
      contentKey: item.contentKey,
    };
    try {
      const osId = await reminderPlatform.schedule({
        title: item.title,
        body: item.body,
        data,
        remindLaterAction: item.remindLaterAction,
      });
      await insertLogRow(db, {
        id: logId,
        type: item.slot.type,
        template_id: item.slot.templateId,
        local_date: item.slot.localDate,
        scheduled_for: item.slot.at.toISOString(),
        os_id: osId,
        delivered_at: null,
        opened_at: null,
        converted: 0,
        cancelled_at: null,
      });
    } catch (error) {
      failed += 1;
      console.warn("[Reminders] Could not schedule a reminder:", error);
    }
  }
  return { status: "scheduled", plan, kept: keep.length, created: create.length - failed, cancelled: cancel.length, failed };
}

let queued: Promise<RescheduleResult> | null = null;
let chain: Promise<unknown> = Promise.resolve();

/**
 * Replan and reschedule the next 7 days (NOT-04). Idempotent: unchanged reminders stay scheduled,
 * changed ones are replaced and stale ones cancelled. Calls made while one run waits share it, and
 * runs never overlap. On web it only records reminder outcomes; the banner reads state directly.
 */
export function rescheduleReminders(
  db: AppDatabase,
  options: { now?: Date; language?: Language } = {},
): Promise<RescheduleResult> {
  if (queued) return queued;
  const run = chain.then(() => {
    queued = null;
    return runReschedule(db, options.now ?? new Date(), options.language);
  });
  queued = run;
  chain = run.catch(() => undefined);
  return run;
}

export type ReminderPreview = Readonly<{
  next: PlannedSlot | null;
  /** The chosen time falls in quiet hours, so the daily reminder is not sent (NOT-08). */
  prayerTimesSet: boolean;
}>;

/** For the settings screen: the next reminder and whether the chosen time can be used. */
export async function previewReminders(
  db: DatabaseExecutor,
  { now = new Date(), language }: { now?: Date; language?: Language } = {},
): Promise<ReminderPreview> {
  const context = await loadReminderContext(db, { now, language });
  const { input, prefs } = context;
  const times = buildDayTimes(
    { clock: input.clock, prayers: input.prayers, anchor: prefs.anchor, ramadanAnchor: prefs.ramadanAnchor, isRamadan: input.isRamadan },
    input.clock.dateOf(now),
  );
  const plan = planNotifications(input);
  return {
    next: plan.slots[0] ?? null,
    prayerTimesSet: times.prayerTimesSet,
  };
}

/** A tap opened Hafiz from a reminder: record it (7.2 opened_at). */
export async function recordReminderOpened(db: DatabaseExecutor, data: ReminderData, now = new Date()): Promise<void> {
  await markOpened(db, data.logId, now);
}

/**
 * "Remind me in 1 hour" (5.8.2, NOT-05b). The follow-up is for the same local date only, never in
 * quiet hours, and is dropped at replan time when the day is done or the streak state changed. It
 * counts toward the daily cap (NOT-07). Returns false when no follow-up was scheduled.
 */
export async function requestRemindLater(
  db: AppDatabase,
  response: ReminderResponse,
  { now = new Date(), clock = deviceClock }: { now?: Date; clock?: DayClock } = {},
): Promise<boolean> {
  const context = await loadReminderContext(db, { now, clock });
  if (!context.prefs.enabled || !context.prefs.types.remind_later) return false;
  const at = new Date(now.getTime() + REMIND_LATER_DELAY_MS);
  const date = clock.dateOf(now);
  if (response.data.localDate !== date || clock.dateOf(at) !== date) return false;
  const times = buildDayTimes(
    {
      clock,
      prayers: context.input.prayers,
      anchor: context.prefs.anchor,
      ramadanAnchor: context.prefs.ramadanAnchor,
      isRamadan: context.input.isRamadan,
    },
    date,
  );
  if (isQuietAt(times, at)) return false;
  const fingerprint = streakFingerprint(projectHabit(context.input, date, now).snapshot);
  await writeLocalSetting(db, LOCAL_KEYS.remindLater, { at: at.toISOString(), local_date: date, fingerprint });
  const result = await rescheduleReminders(db, { now });
  return result.plan?.slots.some((slot) => slot.type === "remind_later") ?? false;
}

/**
 * The trigger the halaqa feature calls when encouragement arrives (5.8.2). Encouragements are
 * batched into at most one notification a day, which counts toward the daily cap.
 */
export async function notifyGroupEncouragement(
  db: AppDatabase,
  { now = new Date(), count = 1 }: { now?: Date; count?: number } = {},
): Promise<void> {
  const pending = await readLocalSetting(db, LOCAL_KEYS.groupPending, groupPendingSchema);
  await writeLocalSetting(db, LOCAL_KEYS.groupPending, {
    first_received_at: pending?.first_received_at ?? now.toISOString(),
    count: (pending?.count ?? 0) + Math.max(1, Math.floor(count)),
  });
  await rescheduleReminders(db, { now });
}
