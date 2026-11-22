import { z } from "zod";
import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting, removeUserSetting, writeUserSetting } from "@/lib/database/user-settings";
import { isLocalDate } from "@/lib/habit/dates";
import { readHifzPlan, writeHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { PRAYERS } from "@/lib/prayer/times";
import {
  DEFAULT_REMINDER_PREFS,
  MAX_PRAYER_OFFSET_MINUTES,
  RAMADAN_ANCHORS,
  TOGGLEABLE_NOTIFICATION_TYPES,
  type RamadanAnchor,
  type ReminderAnchor,
  type ReminderPrefs,
  type ToggleableNotificationType,
} from "@/lib/notifications/types";

/**
 * Synced preferences live under `notif_pref_` (spec 7.6), which is on the sync allowlist.
 * Everything else here is device-local: permission prompts, back-off and pending follow-ups.
 */
const PREF_PREFIX = "notif_pref_";
const PREF_KEYS = {
  enabled: "notif_pref_enabled",
  anchor: "notif_pref_anchor",
  ramadanAnchor: "notif_pref_ramadan_anchor",
  badge: "notif_pref_badge",
} as const;

/**
 * REMIND-07: the second sitting for review, an anchor as JSON or "off". It is its own key rather than
 * part of `hifz_plan`, because released apps drop plan fields they do not know when they save a plan.
 */
export const REVIEW_ANCHOR_KEY = "notif_pref_review_anchor";

/** Only types with their own switch have a key, so `notif_pref_review_reminder` is never read or written. */
export function typePrefKey(type: ToggleableNotificationType): string {
  return `${PREF_PREFIX}${type}`;
}

/** Device-local keys. None starts with `notif_pref_`, so none is uploaded. */
export const LOCAL_KEYS = {
  optInPrompts: "notif_optin_prompts",
  backoff: "notif_backoff",
  remindLater: "notif_remind_later",
  // notif_group_pending held Halaqa encouragement batches. Halaqa is gone from the app and the server, so
  // nothing reads or writes it, and rows already stored are left as they are (lib/database/sync.ts).
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

/** The stored second sitting: an anchor, or null for "off", a missing value or one that does not parse. */
export function parseReviewAnchor(value: string | undefined | null): ReminderAnchor | null {
  return value === "off" ? null : parseJson(value, anchorSchema);
}

/** The stored form of the second sitting, for a caller that writes it inside its own transaction. */
export function reviewAnchorValue(anchor: ReminderAnchor | null): string {
  return anchor ? JSON.stringify(anchorSchema.parse(anchor)) : "off";
}

export function parseReminderPrefs(values: ReadonlyMap<string, string>): ReminderPrefs {
  const types = Object.fromEntries(
    TOGGLEABLE_NOTIFICATION_TYPES.map((type) => [type, onOff(values.get(typePrefKey(type)), DEFAULT_REMINDER_PREFS.types[type])]),
  ) as Record<ToggleableNotificationType, boolean>;
  const ramadan = values.get(PREF_KEYS.ramadanAnchor);
  return {
    enabled: onOff(values.get(PREF_KEYS.enabled), DEFAULT_REMINDER_PREFS.enabled),
    types,
    anchor: parseJson(values.get(PREF_KEYS.anchor), anchorSchema) ?? DEFAULT_REMINDER_PREFS.anchor,
    reviewAnchor: parseReviewAnchor(values.get(REVIEW_ANCHOR_KEY)),
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

/** The hifz plan's "when" (3.3) is the reminder time, so the two can never disagree. */
export function anchorFromPlan(anchor: HifzPlan["anchor"]): ReminderAnchor {
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
  // Without a hifz plan (the ayah review without setup), the reminder keeps its own anchor.
  return plan ? { ...prefs, anchor: anchorFromPlan(plan.anchor) } : prefs;
}

/** The saved second sitting alone, for screens that edit it without the other preferences. */
export async function readReviewAnchor(db: DatabaseExecutor): Promise<ReminderAnchor | null> {
  const values = await readSettings(db, "key = ?", [REVIEW_ANCHOR_KEY]);
  return parseReviewAnchor(values.get(REVIEW_ANCHOR_KEY));
}

/** Each change writes one key, so turning one type off never touches the others (NOT-11). */
export type ReminderPrefChange =
  | { kind: "enabled"; value: boolean }
  | { kind: "type"; type: ToggleableNotificationType; value: boolean }
  | { kind: "anchor"; value: ReminderAnchor }
  | { kind: "reviewAnchor"; value: ReminderAnchor | null }
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
    case "reviewAnchor":
      return writeUserSetting(db, REVIEW_ANCHOR_KEY, reviewAnchorValue(change.value));
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

/** The UI language stored by the settings provider. */
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
  /**
   * Reminders ignored since `since`, kept as a running total: log rows older than 90 days are pruned,
   * but the reminders they record stay ignored until the next session.
   */
  consecutive_ignored: z.number().int().min(0),
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  /** The latest session when the count was taken, null before any session. A new one resets it. */
  since: z.string().nullable().optional(),
  /** The last log row already counted, so a run adds only rows after it (lib/notifications/log.ts). */
  cursor: z.object({ at: z.string(), id: z.string() }).nullable().optional(),
});
export type BackoffState = z.infer<typeof backoffSchema>;

const localDate = z.string().refine(isLocalDate);

/** A "Remind me in 1 hour" follow-up waiting to fire (NOT-05b). */
export const remindLaterSchema = z.object({
  at: z.string(),
  local_date: localDate,
  /** The streak state when it was scheduled. A different state skips the follow-up. */
  fingerprint: z.string(),
});
export type RemindLaterPending = z.infer<typeof remindLaterSchema>;

export const ramadanOfferSchema = z.object({ hijri_year: z.number().int() });

export const bannerDismissedSchema = z.object({ local_date: localDate, kind: z.string() });
