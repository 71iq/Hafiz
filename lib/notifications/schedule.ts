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
  advanceIgnoredTally,
  deleteLogRows,
  findConversions,
  insertLogRow,
  isFired,
  markCancelled,
  markConverted,
  markDelivered,
  markInferredDelivered,
  markOpened,
  pruneLog,
  readBackoffRows,
  readLatestSessionAt,
  readLogRow,
  readLogSince,
  readSessionStartsSince,
  type IgnoredTally,
} from "@/lib/notifications/log";
import {
  backoffLevel,
  isCoveredToday,
  PLAN_HORIZON_DAYS,
  planNotifications,
  streakFingerprint,
  type DeliveredReminder,
  type PlannerInput,
  type PlanResult,
  type ReminderFactValues,
  type SkippedSlot,
} from "@/lib/notifications/planner";
import { reminderPlatform } from "@/lib/notifications/platform";
import type { PresentedReminder, ReminderData, ReminderResponse, ScheduledReminder } from "@/lib/notifications/platform-types";
import { hijriDateOf, isRamadan, RAMADAN_MONTH } from "@/lib/notifications/ramadan";
import {
  backoffSchema,
  type BackoffState,
  type GroupBatch,
  groupPendingSchema,
  LOCAL_KEYS,
  readLocalSetting,
  readReminderPrefs,
  readUiLanguage,
  remindLaterSchema,
  writeLocalSetting,
} from "@/lib/notifications/settings";
import { NO_REPEAT_DAYS, renderNotification, type Language, type SurahNames } from "@/lib/notifications/templates";
import { HIFZ_PAGES_DECK_ID, HIFZ_SABAQ_DECK_ID } from "@/lib/hifz/units";
import { WIRD_TYPES, type NotificationLogRow, type PlannedSlot, type ReminderPrefs } from "@/lib/notifications/types";

const DAY_MS = 86_400_000;
const GROUP_BATCH_RETENTION_MS = 7 * DAY_MS;
const NEAR_FIRE_MS = 2 * 60_000;
const REMIND_LATER_DELAY_MS = 60 * 60_000;

export type GroupBatches = Readonly<{ batches: GroupBatch[]; planned: GroupBatch | null; changed: boolean }>;

export type ReminderContext = Readonly<{
  prefs: ReminderPrefs;
  input: PlannerInput;
  log: NotificationLogRow[];
  sessionStarts: string[];
  ignored: IgnoredTally;
  stillScheduled: ReadonlySet<string> | undefined;
  group: GroupBatches;
  language: Language;
  surahNames: SurahNames;
}>;

let reminderAccount: () => string | null = () => null;

export function setReminderAccountSource(source: () => string | null): void {
  reminderAccount = source;
}

const SURAH_CARD = /^(\d{1,3}):\d{1,3}$/;

async function readDueSurahs(db: DatabaseExecutor, through: Date): Promise<{ surah: number; due: string }[]> {
  const rows = await db.getAllAsync<{ id: string; due: string }>(
    `SELECT id, due FROM study_cards
     WHERE deleted_at IS NULL AND suspended_at IS NULL AND due <= ? AND deck_id NOT IN (?, ?)
     ORDER BY due LIMIT 300`,
    [through.toISOString(), HIFZ_PAGES_DECK_ID, HIFZ_SABAQ_DECK_ID],
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

function byFirstReceived(a: GroupBatch, b: GroupBatch): number {
  return Date.parse(a.first_received_at) - Date.parse(b.first_received_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function settleGroupBatches(
  stored: readonly GroupBatch[],
  log: readonly NotificationLogRow[],
  now: Date,
  stillScheduled: ReadonlySet<string> | undefined,
  account: string | null,
): GroupBatches {
  const rows = new Map(log.map((row) => [row.id, row]));
  const batches: GroupBatch[] = [];
  let changed = false;
  for (const batch of stored) {
    const row = batch.log_id === null ? undefined : rows.get(batch.log_id);
    const age = now.getTime() - Date.parse(batch.first_received_at);
    if ((row && isFired(row, now, stillScheduled)) || !(age <= GROUP_BATCH_RETENTION_MS)) {
      changed = true;
    } else if (batch.log_id !== null && (!row || row.cancelled_at !== null)) {
      batches.push({ ...batch, log_id: null });
      changed = true;
    } else {
      batches.push(batch);
    }
  }
  const own = account === null ? [] : batches.filter((batch) => batch.account_id === account).sort(byFirstReceived);
  return { batches, planned: own[0] ?? null, changed };
}

export async function loadReminderContext(
  db: DatabaseExecutor,
  {
    now,
    language,
    clock = deviceClock,
    stillScheduled,
  }: { now: Date; language?: Language; clock?: DayClock; stillScheduled?: ReadonlySet<string> },
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
  const previous: IgnoredTally | null =
    storedBackoff && storedBackoff.since !== undefined
      ? { count: storedBackoff.consecutive_ignored, since: storedBackoff.since, cursor: storedBackoff.cursor ?? null }
      : null;
  const tallyFrom = previous?.since === latestSession && previous.cursor ? previous.cursor.at : latestSession;
  const [surahNames, backoffRows] = await Promise.all([
    readSurahNames(
      db,
      due.map((item) => item.surah),
    ),
    readBackoffRows(db, tallyFrom),
  ]);
  const facts = (date: LocalDate): ReminderFactValues => {
    const endOfDate = clock.at(addDays(date, 1), 0).toISOString();
    const first = due.find((item) => item.due <= endOfDate && surahNames(item.surah, "en") !== null);
    return first ? { surah: first.surah } : {};
  };
  const ignored = advanceIgnoredTally(previous, backoffRows, latestSession, now, stillScheduled);
  const asDelivered = (row: NotificationLogRow): DeliveredReminder => ({
    type: row.type,
    templateId: row.template_id,
    localDate: row.local_date,
    at: new Date(row.scheduled_for),
  });
  const delivered = log.filter((row) => isFired(row, now, stillScheduled)).map(asDelivered);
  const late = log
    .filter(
      (row) =>
        stillScheduled?.has(row.id) &&
        row.cancelled_at === null &&
        !row.delivered_at &&
        Date.parse(row.scheduled_for) <= now.getTime(),
    )
    .map(asDelivered);
  const group = settleGroupBatches(groupPending?.batches ?? [], log, now, stillScheduled, reminderAccount());
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
    backoff: backoffLevel(ignored.count),
    ignoredCount: ignored.count,
    delivered,
    late,
    remindLater,
    groupPending: group.planned ? { first_received_at: group.planned.first_received_at, count: group.planned.count } : null,
    facts,
    preferredTemplates,
  };
  return { prefs, input, log, sessionStarts, ignored, stillScheduled, group, language: lang, surahNames };
}

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

export function reconcileReminders(
  scheduled: readonly ScheduledReminder[],
  desired: readonly DesiredReminder[],
  now: Date,
  skipped: readonly SkippedSlot[] = [],
): { keep: ScheduledReminder[]; cancel: ScheduledReminder[]; create: DesiredReminder[] } {
  const nearFireBy = now.getTime() + NEAR_FIRE_MS;
  const keep: ScheduledReminder[] = [];
  const cancel: ScheduledReminder[] = [];
  const later: ScheduledReminder[] = [];
  const sameSlot = (item: ScheduledReminder) => (slot: Pick<PlannedSlot, "type" | "localDate">) =>
    slot.type === item.data.type && slot.localDate === item.data.localDate;
  const existingOnly = desired.filter((wanted) => wanted.slot.existingOnly);
  const remaining = desired.filter((wanted) => !wanted.slot.existingOnly);
  const pending: ScheduledReminder[] = [];
  for (const item of scheduled) {
    const index = existingOnly.findIndex((wanted) => sameSlot(item)(wanted.slot));
    if (index >= 0) {
      keep.push(item);
      existingOnly.splice(index, 1);
    } else {
      pending.push(item);
    }
  }
  for (const item of pending) {
    if (item.data.at > nearFireBy) {
      later.push(item);
      continue;
    }
    const index = remaining.findIndex((wanted) => sameSlot(item)(wanted.slot));
    if (index >= 0) {
      keep.push(item);
      remaining.splice(index, 1);
    } else if (item.data.at <= now.getTime() && skipped.some((slot) => slot.reason === "past" && sameSlot(item)(slot))) {
      keep.push(item);
    } else {
      cancel.push(item);
    }
  }
  const rest = diffReminders(later, remaining);
  return { keep: [...keep, ...rest.keep], cancel: [...cancel, ...rest.cancel], create: rest.create };
}

async function recordCancelled(db: DatabaseExecutor, cancelled: readonly ScheduledReminder[], now: Date): Promise<void> {
  const nearFireBy = now.getTime() + NEAR_FIRE_MS;
  await deleteLogRows(
    db,
    cancelled.filter((item) => item.data.at > nearFireBy).map((item) => item.data.logId),
  );
  await markCancelled(
    db,
    cancelled.filter((item) => item.data.at <= nearFireBy).map((item) => item.data.logId),
    now,
  );
}

function renderDesired(context: ReminderContext, slots: readonly PlannedSlot[]): DesiredReminder[] {
  const { prefs, input, language, surahNames } = context;
  return slots.map((slot) => {
    const { title, body } = renderNotification(slot, language, surahNames);
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
  await markConverted(db, findConversions(context.log, context.sessionStarts, now, context.stillScheduled));
  const { count, since, cursor } = context.ignored;
  const level = backoffLevel(count);
  const stored = await readLocalSetting(db, LOCAL_KEYS.backoff, backoffSchema);
  const unchanged =
    stored !== null &&
    stored.consecutive_ignored === count &&
    stored.level === level &&
    stored.since === since &&
    stored.cursor?.at === cursor?.at &&
    stored.cursor?.id === cursor?.id;
  if (!unchanged) {
    const state: BackoffState = { consecutive_ignored: count, level, since, cursor };
    await writeLocalSetting(db, LOCAL_KEYS.backoff, state);
  }
  await pruneLog(db, now);
}

async function clearSpentRemindLater(db: DatabaseExecutor, context: ReminderContext, plan: PlanResult): Promise<void> {
  const spent = context.input.remindLater;
  if (spent && !plan.slots.some((slot) => slot.type === "remind_later")) {
    const stored = await readLocalSetting(db, LOCAL_KEYS.remindLater, remindLaterSchema);
    if (!stored || stored.at !== spent.at || stored.local_date !== spent.local_date || stored.fingerprint !== spent.fingerprint) return;
    await writeLocalSetting(db, LOCAL_KEYS.remindLater, null);
  }
}

async function saveGroupBatches(db: DatabaseExecutor, batches: readonly GroupBatch[]): Promise<void> {
  await writeLocalSetting(db, LOCAL_KEYS.groupPending, batches.length > 0 ? { batches } : null);
}

function isForeignEncouragement(data: ReminderData, account: string | null): boolean {
  return data.type === "group_encouragement" && (account === null || data.accountId !== account);
}

export function shouldPresentReminder(data: ReminderData): boolean {
  return !isForeignEncouragement(data, reminderAccount());
}

const hiddenReminders = new Set<string>();

export function configureReminderPlatform(labels: Readonly<{ channelName: string; remindLaterAction: string }>): Promise<void> {
  return reminderPlatform.configure({
    ...labels,
    shouldPresent: shouldPresentReminder,
    onHidden: (data) => hiddenReminders.add(data.logId),
  });
}

async function recordHidden(db: DatabaseExecutor, now: Date): Promise<void> {
  const ids = [...hiddenReminders];
  if (ids.length === 0) return;
  await markCancelled(db, ids, now);
  for (const id of ids) hiddenReminders.delete(id);
}

async function dismissForeignEncouragement(
  presented: readonly PresentedReminder[],
  account: string | null,
): Promise<PresentedReminder[]> {
  const foreign = presented.filter((item) => isForeignEncouragement(item.data, account));
  if (foreign.length > 0) await reminderPlatform.dismiss(foreign.map((item) => item.osId));
  return presented.filter((item) => !foreign.includes(item));
}

async function dismissStale(
  presented: readonly PresentedReminder[],
  context: ReminderContext,
  now: Date,
  covered: boolean,
  makeUpOpen: boolean,
): Promise<void> {
  const today = context.input.clock.dateOf(now);
  const stale = presented.filter(
    (item) =>
      item.data.localDate < today ||
      (covered &&
        item.data.localDate === today &&
        WIRD_TYPES.has(item.data.type) &&
        !(makeUpOpen && item.data.type === "makeup_window")),
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
  const empty = { plan: null, kept: 0, created: 0, cancelled: 0, failed: 0 };
  if (!reminderPlatform.supportsScheduling) {
    await recordOutcomes(db, await loadReminderContext(db, { now, language }), now);
    return { status: "unsupported", ...empty };
  }

  const account = reminderAccount();
  const listed = await reminderPlatform.listScheduled();
  const foreign = listed.filter((item) => isForeignEncouragement(item.data, account));
  if (foreign.length > 0) await reminderPlatform.cancel(foreign.map((item) => item.osId));
  const scheduled = listed.filter((item) => !foreign.includes(item));
  const presented = await reminderPlatform.listPresented();

  const stillScheduled = new Set(listed.map((item) => item.data.logId));
  await markDelivered(
    db,
    presented.map((item) => item.data.logId),
    now,
  );
  await recordHidden(db, now);
  await markInferredDelivered(db, stillScheduled, now);
  await recordCancelled(db, foreign, now);
  const shown = await dismissForeignEncouragement(presented, account);
  const context = await loadReminderContext(db, { now, language, stillScheduled });
  await recordOutcomes(db, context, now);
  const { group } = context;

  const permission = await reminderPlatform.getPermission();
  const permitted = permission.status === "granted";
  const today = context.input.clock.dateOf(now);
  const snapshot = projectHabit(context.input, today, now).snapshot;
  const covered = isCoveredToday(snapshot);
  const makeUpOpen = snapshot.headline.kind === "make_up_open";
  await updateBadge(context, permitted, covered);
  await dismissStale(shown, context, now, covered, makeUpOpen);
  if (!permitted || !context.prefs.enabled) {
    const cancelled = foreign.length + (await cancelEverything(db, scheduled, now));
    if (group.changed) await saveGroupBatches(db, group.batches);
    return { status: permitted ? "disabled" : "no_permission", ...empty, cancelled };
  }

  const plan = planNotifications(context.input);
  await clearSpentRemindLater(db, context, plan);
  const desired = renderDesired(context, plan.slots);
  const planned = group.planned;
  const isForeignGroup = (item: ScheduledReminder) =>
    item.data.type === "group_encouragement" && (planned === null || item.data.logId !== planned.log_id);
  const reconciled = reconcileReminders(
    scheduled.filter((item) => !isForeignGroup(item)),
    desired,
    now,
    plan.skipped,
  );
  const { keep, create } = reconciled;
  const cancel = [...scheduled.filter(isForeignGroup), ...reconciled.cancel];

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

  let groupLogId = planned?.log_id ?? null;
  if (groupLogId !== null && cancel.some((item) => item.data.logId === groupLogId)) groupLogId = null;
  let created = 0;
  let failed = 0;
  for (const item of create) {
    if (item.slot.type === "group_encouragement" && (planned === null || reminderAccount() !== planned.account_id)) continue;
    const logId = createId("notif");
    const data: ReminderData = {
      source: "hafiz-reminder",
      logId,
      type: item.slot.type,
      localDate: item.slot.localDate,
      route: item.slot.route,
      at: item.slot.at.getTime(),
      contentKey: item.contentKey,
      ...(item.slot.type === "group_encouragement" && planned !== null ? { accountId: planned.account_id } : {}),
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
      if (item.slot.type === "group_encouragement") groupLogId = logId;
      created += 1;
    } catch (error) {
      failed += 1;
      console.warn("[Reminders] Could not schedule a reminder:", error);
    }
  }
  if (planned !== null && groupLogId !== planned.log_id) {
    await saveGroupBatches(
      db,
      group.batches.map((batch) => (batch.id === planned.id ? { ...batch, log_id: groupLogId } : batch)),
    );
  } else if (group.changed) {
    await saveGroupBatches(db, group.batches);
  }
  return { status: "scheduled", plan, kept: keep.length, created, cancelled: foreign.length + cancel.length, failed };
}

let queued: Promise<RescheduleResult> | null = null;
let chain: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work);
  chain = run.catch(() => undefined);
  return run;
}

export function rescheduleReminders(
  db: AppDatabase,
  options: { now?: Date; language?: Language } = {},
): Promise<RescheduleResult> {
  if (queued) return queued;
  const run: Promise<RescheduleResult> = serialized(() => {
    if (queued === run) queued = null;
    return runReschedule(db, options.now ?? new Date(), options.language);
  });
  queued = run;
  return run;
}

export type ReminderPreview = Readonly<{
  next: PlannedSlot | null;
  prayerTimesSet: boolean;
}>;

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

export async function recordReminderOpened(db: DatabaseExecutor, data: ReminderData, now = new Date()): Promise<void> {
  await markOpened(db, data.logId, now);
}

export async function requestRemindLater(
  db: AppDatabase,
  response: ReminderResponse,
  { now = new Date(), clock = deviceClock }: { now?: Date; clock?: DayClock } = {},
): Promise<boolean> {
  const recorded = await serialized(async () => {
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
    return true;
  });
  if (!recorded) return false;
  const result = await rescheduleReminders(db, { now });
  const planned = result.plan?.slots.some((slot) => slot.type === "remind_later") ?? false;
  const date = response.data.localDate;
  const scheduled =
    planned &&
    (await reminderPlatform
      .listScheduled()
      .then((items) => items.some((item) => item.data.type === "remind_later" && item.data.localDate === date))
      .catch(() => false));
  if (scheduled && response.osId) await reminderPlatform.dismiss([response.osId]).catch(() => undefined);
  return scheduled;
}

export type ReminderAccount = Readonly<{ userId: string; isCurrent: () => boolean }>;

export async function notifyGroupEncouragement(
  db: AppDatabase,
  { account, now = new Date(), count = 1 }: { account: ReminderAccount; now?: Date; count?: number },
): Promise<boolean> {
  const recorded = await serialized(async () => {
    if (!account.isCurrent()) return false;
    const stored = await readLocalSetting(db, LOCAL_KEYS.groupPending, groupPendingSchema);
    if (!account.isCurrent()) return false;
    const batches = stored?.batches ?? [];
    const own = batches.filter((batch) => batch.account_id === account.userId).sort(byFirstReceived);
    const latest = own.length > 0 ? own[own.length - 1] : null;
    const row = latest?.log_id ? await readLogRow(db, latest.log_id) : null;
    if (!account.isCurrent()) return false;
    const sent =
      row !== null &&
      row.cancelled_at === null &&
      (row.delivered_at !== null || Date.parse(row.scheduled_for) <= now.getTime() + NEAR_FIRE_MS);
    const added = Math.max(1, Math.floor(count));
    const next: GroupBatch[] =
      latest !== null && !sent
        ? batches.map((batch) => (batch.id === latest.id ? { ...batch, count: batch.count + added } : batch))
        : [
            ...batches,
            { id: createId("group"), account_id: account.userId, first_received_at: now.toISOString(), count: added, log_id: null },
          ];
    await saveGroupBatches(db, next);
    return true;
  });
  if (recorded) {
    await rescheduleReminders(db, { now }).catch((error: unknown) => {
      console.warn("[Reminders] Could not schedule halaqa encouragement:", error);
    });
  }
  return recorded;
}
