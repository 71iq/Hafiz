import type { LocalDate } from "@/lib/habit/dates";
import type { PrayerName } from "@/lib/prayer/times";

export const NOTIFICATION_TYPES = [
  "wird_reminder",
  "streak_at_risk",
  "remind_later",
  "late_reminder",
  "makeup_window",
  "grace_used",
  "earnback_open",
  "friday_kahf",
  "group_encouragement",
  "comeback",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const DEFAULT_TYPE_PREFS: Readonly<Record<NotificationType, boolean>> = {
  wird_reminder: true,
  streak_at_risk: true,
  remind_later: true,
  late_reminder: false,
  makeup_window: true,
  grace_used: true,
  earnback_open: true,
  friday_kahf: false,
  group_encouragement: true,
  comeback: true,
};

export const COUNTED_FOR_BACKOFF: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "wird_reminder",
  "streak_at_risk",
  "remind_later",
  "late_reminder",
  "makeup_window",
  "grace_used",
  "earnback_open",
  "comeback",
]);

export const WIRD_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "wird_reminder",
  "streak_at_risk",
  "remind_later",
  "late_reminder",
  "makeup_window",
  "grace_used",
  "earnback_open",
  "comeback",
]);

export type ReminderAnchor =
  | Readonly<{ kind: "prayer"; prayer: PrayerName; offsetMinutes: number }>
  | Readonly<{ kind: "clock"; minutes: number }>;

export const DEFAULT_ANCHOR: ReminderAnchor = { kind: "prayer", prayer: "fajr", offsetMinutes: 20 };
export const MAX_PRAYER_OFFSET_MINUTES = 120;

export const RAMADAN_ANCHORS = ["after_taraweeh", "before_suhoor"] as const;
export type RamadanAnchor = (typeof RAMADAN_ANCHORS)[number];

export type ReminderPrefs = Readonly<{
  enabled: boolean;
  types: Readonly<Record<NotificationType, boolean>>;
  anchor: ReminderAnchor;
  ramadanAnchor: RamadanAnchor | null;
  badge: boolean;
}>;

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  enabled: true,
  types: DEFAULT_TYPE_PREFS,
  anchor: DEFAULT_ANCHOR,
  ramadanAnchor: null,
  badge: false,
};

export type ReminderRoute = "home" | "wird" | "kahf";

export type PlannedSlot = Readonly<{
  type: NotificationType;
  localDate: LocalDate;
  at: Date;
  templateId: string;
  vars: Readonly<Record<string, string | number>>;
  route: ReminderRoute;
  existingOnly?: boolean;
}>;

export type NotificationLogRow = {
  id: string;
  type: string;
  template_id: string;
  local_date: LocalDate;
  scheduled_for: string;
  os_id: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  converted: number;
  cancelled_at: string | null;
};
