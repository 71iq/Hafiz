import type { LocalDate } from "@/lib/habit/dates";
import type { PrayerName } from "@/lib/prayer/times";

/** Spec 5.8.2. */
export const NOTIFICATION_TYPES = [
  "wird_reminder",
  "streak_at_risk",
  "remind_later",
  "late_reminder",
  "makeup_window",
  "grace_used",
  "earnback_open",
  "friday_kahf",
  "comeback",
  "review_reminder",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Types with their own switch in Settings and their own synced `notif_pref_<type>` value. The review
 * reminder (REMIND-07) has none: `notif_pref_review_anchor` alone turns it on or off, so no second
 * value can contradict it. It stays in NOTIFICATION_TYPES so a tap on it is still recognized.
 */
export type ToggleableNotificationType = Exclude<NotificationType, "review_reminder">;
export const TOGGLEABLE_NOTIFICATION_TYPES: readonly ToggleableNotificationType[] = NOTIFICATION_TYPES.filter(
  (type): type is ToggleableNotificationType => type !== "review_reminder",
);

/** 5.8.2 defaults. late_reminder and friday_kahf are opt-in. remind_later is the "Remind me in 1 hour" action. */
const DEFAULT_TYPE_PREFS: Readonly<Record<ToggleableNotificationType, boolean>> = {
  wird_reminder: true,
  streak_at_risk: true,
  remind_later: true,
  late_reminder: false,
  makeup_window: true,
  grace_used: true,
  earnback_open: true,
  friday_kahf: false,
  comeback: true,
};

/**
 * Reminders that ask for a session, which count as ignored when no session follows within 2 hours
 * (NOT-09). Kahf messages and the review reminder are not counted, so ignoring the second sitting never
 * thins the main reminder. The planner projects the same set.
 */
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

/**
 * Types that are about today's wird. They stop once the minimum is done (NOT-05) or the day is covered.
 * The review reminder is not one: it stays due after the minimum while review is left (REMIND-07).
 */
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

/** The plan anchor (3.3, 5.5): minutes after a chosen prayer, or a clock time. */
export type ReminderAnchor =
  | Readonly<{ kind: "prayer"; prayer: PrayerName; offsetMinutes: number }>
  | Readonly<{ kind: "clock"; minutes: number }>;

/** ANC-01: after Fajr by default; 5.8.2: 20 minutes after the prayer. */
export const DEFAULT_ANCHOR: ReminderAnchor = { kind: "prayer", prayer: "fajr", offsetMinutes: 20 };
export const MAX_PRAYER_OFFSET_MINUTES = 120;

/** NOT-10: in Ramadan the user may move the anchor to after Taraweeh or before Suhoor. */
export const RAMADAN_ANCHORS = ["after_taraweeh", "before_suhoor"] as const;
export type RamadanAnchor = (typeof RAMADAN_ANCHORS)[number];

export type ReminderPrefs = Readonly<{
  /** The master switch (NOT-11). Turning it off keeps each type's own setting. */
  enabled: boolean;
  types: Readonly<Record<ToggleableNotificationType, boolean>>;
  anchor: ReminderAnchor;
  /**
   * REMIND-07: the optional second sitting for review, or null when it is off. It keeps its own time
   * in Ramadan; only the main anchor follows the Ramadan time.
   */
  reviewAnchor: ReminderAnchor | null;
  ramadanAnchor: RamadanAnchor | null;
  /** AMB-04: show 1 on the app icon while today's wird is open. */
  badge: boolean;
}>;

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  enabled: true,
  types: DEFAULT_TYPE_PREFS,
  anchor: DEFAULT_ANCHOR,
  reviewAnchor: null,
  ramadanAnchor: null,
  badge: false,
};

/** Where a tap on the notification leads. */
export type ReminderRoute = "home" | "wird" | "kahf";

/** One planned notification, before its text is rendered. */
export type PlannedSlot = Readonly<{
  type: NotificationType;
  localDate: LocalDate;
  at: Date;
  templateId: string;
  vars: Readonly<Record<string, string | number>>;
  route: ReminderRoute;
  /**
   * Keep a reminder of this type and date already scheduled, but schedule none new: today's late
   * reminder planned at 23:00 or later. It passed the same checks as any slot (completion, settings,
   * cap, back-off), so an alarm set earlier stays unless one of them now says no.
   */
  existingOnly?: boolean;
}>;

/** A notification_log row (spec 7.2). Device-local, never synced. */
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
