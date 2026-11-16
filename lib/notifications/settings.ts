import { z } from "zod";
import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting, removeUserSetting, writeUserSetting } from "@/lib/database/user-settings";
import { isLocalDate } from "@/lib/habit/dates";
import { readHifzPlan, writeHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { PRAYERS } from "@/lib/prayer/times";
import {
  DEFAULT_REMINDER_PREFS,
  MAX_PRAYER_OFFSET_MINUTES,
  NOTIFICATION_TYPES,
  RAMADAN_ANCHORS,
  type NotificationType,
  type RamadanAnchor,
  type ReminderAnchor,
  type ReminderPrefs,
} from "@/lib/notifications/types";

const PREF_PREFIX = "notif_pref_";
const PREF_KEYS = {
  enabled: "notif_pref_enabled",
  anchor: "notif_pref_anchor",
  ramadanAnchor: "notif_pref_ramadan_anchor",
  badge: "notif_pref_badge",
} as const;

export function typePrefKey(type: NotificationType): string {
  return `${PREF_PREFIX}${type}`;
}

export const LOCAL_KEYS = {
  optInPrompts: "notif_optin_prompts",
  backoff: "notif_backoff",
  remindLater: "notif_remind_later",
  groupPending: "notif_group_pending",
  ramadanOffer: "notif_ramadan_offer",
  bannerDismissed: "notif_banner_dismissed",
} as const;

const anchorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("prayer"),
    prayer: z.enum(PRAYERS),
    offsetMinutes: z.number().int().min(0).max(MAX_PRAYER_OFFSET_MINUTES),
  }),
  z.object({ kind: z.literal("clock"), minutes: z.number().int().min(0).max(24 * 60 - 1) }),
]);

function parseJson<T>(value: string | undefined | null, schema: z.ZodType<T>): T | null {
  if (!value) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function onOff(value: string | undefined, fallback: boolean): boolean {
  if (value === "on") return true;
  if (value === "off") return false;
  return fallback;
}

export function parseReminderPrefs(values: ReadonlyMap<string, string>): ReminderPrefs {
  const types = Object.fromEntries(
    NOTIFICATION_TYPES.map((type) => [type, onOff(values.get(typePrefKey(type)), DEFAULT_REMINDER_PREFS.types[type])]),
  ) as Record<NotificationType, boolean>;
  const ramadan = values.get(PREF_KEYS.ramadanAnchor);
  return {
    enabled: onOff(values.get(PREF_KEYS.enabled), DEFAULT_REMINDER_PREFS.enabled),
    types,
    anchor: parseJson(values.get(PREF_KEYS.anchor), anchorSchema) ?? DEFAULT_REMINDER_PREFS.anchor,
    ramadanAnchor: (RAMADAN_ANCHORS as readonly string[]).includes(ramadan ?? "") ? (ramadan as RamadanAnchor) : null,
    badge: onOff(values.get(PREF_KEYS.badge), DEFAULT_REMINDER_PREFS.badge),
  };
}

async function readSettings(db: DatabaseExecutor, where: string, params: string[]): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM user_settings WHERE ${where} AND deleted_at IS NULL`,
    params,
  );
  return new Map(rows.map((row) => [row.key, row.value]));
}

function anchorFromPlan(anchor: HifzPlan["anchor"]): ReminderAnchor {
  return anchor.kind === "prayer"
    ? { kind: "prayer", prayer: anchor.prayer, offsetMinutes: Math.min(anchor.offsetMin, MAX_PRAYER_OFFSET_MINUTES) }
    : { kind: "clock", minutes: anchor.minutes };
}

function anchorToPlan(anchor: ReminderAnchor): HifzPlan["anchor"] {
  return anchor.kind === "prayer"
    ? { kind: "prayer", prayer: anchor.prayer, offsetMin: anchor.offsetMinutes }
    : { kind: "clock", minutes: anchor.minutes };
}

export async function readReminderPrefs(db: DatabaseExecutor): Promise<ReminderPrefs> {
  const [values, plan] = await Promise.all([readSettings(db, "key LIKE ?", [`${PREF_PREFIX}%`]), readHifzPlan(db)]);
  const prefs = parseReminderPrefs(values);
  return plan ? { ...prefs, anchor: anchorFromPlan(plan.anchor) } : prefs;
}

export type ReminderPrefChange =
  | { kind: "enabled"; value: boolean }
  | { kind: "type"; type: NotificationType; value: boolean }
  | { kind: "anchor"; value: ReminderAnchor }
  | { kind: "ramadanAnchor"; value: RamadanAnchor | null }
  | { kind: "badge"; value: boolean };

export async function writeReminderPref(db: AppDatabase, change: ReminderPrefChange): Promise<void> {
  switch (change.kind) {
    case "enabled":
      return writeUserSetting(db, PREF_KEYS.enabled, change.value ? "on" : "off");
    case "type":
      return writeUserSetting(db, typePrefKey(change.type), change.value ? "on" : "off");
    case "anchor": {
      const anchor = anchorSchema.parse(change.value);
      const plan = await readHifzPlan(db);
      if (plan) return writeHifzPlan(db, { ...plan, anchor: anchorToPlan(anchor) });
      return writeUserSetting(db, PREF_KEYS.anchor, JSON.stringify(anchor));
    }
    case "ramadanAnchor":
      return writeUserSetting(db, PREF_KEYS.ramadanAnchor, change.value ?? "off");
    case "badge":
      return writeUserSetting(db, PREF_KEYS.badge, change.value ? "on" : "off");
  }
}

export async function readLocalSetting<T>(db: DatabaseExecutor, key: string, schema: z.ZodType<T>): Promise<T | null> {
  const values = await readSettings(db, "key = ?", [key]);
  return parseJson(values.get(key), schema);
}

export async function writeLocalSetting(db: DatabaseExecutor, key: string, value: unknown | null): Promise<void> {
  if (value === null) await removeUserSetting(db, key);
  else await putUserSetting(db, key, JSON.stringify(value));
}

export async function readUiLanguage(db: DatabaseExecutor): Promise<"en" | "ar"> {
  const values = await readSettings(db, "key = ?", ["ui_language"]);
  return values.get("ui_language") === "ar" ? "ar" : "en";
}

export const optInPromptsSchema = z.object({
  count: z.number().int().min(0),
  last_shown_at: z.string().nullable(),
});
export type OptInPrompts = z.infer<typeof optInPromptsSchema>;

export const backoffSchema = z.object({
  consecutive_ignored: z.number().int().min(0),
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  since: z.string().nullable().optional(),
  cursor: z.object({ at: z.string(), id: z.string() }).nullable().optional(),
});
export type BackoffState = z.infer<typeof backoffSchema>;

const localDate = z.string().refine(isLocalDate);

export const remindLaterSchema = z.object({
  at: z.string(),
  local_date: localDate,
  fingerprint: z.string(),
});
export type RemindLaterPending = z.infer<typeof remindLaterSchema>;

const groupBatchSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  first_received_at: z.string(),
  count: z.number().int().min(1),
  log_id: z.string().nullable(),
});
export type GroupBatch = z.infer<typeof groupBatchSchema>;
export const groupPendingSchema = z.object({ batches: z.array(groupBatchSchema) });

export type GroupPending = Readonly<Pick<GroupBatch, "first_received_at" | "count">>;

export const ramadanOfferSchema = z.object({ hijri_year: z.number().int() });

export const bannerDismissedSchema = z.object({ local_date: localDate, kind: z.string() });
