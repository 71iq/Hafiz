import { isLocalDate, type LocalDate } from "@/lib/habit/dates";
import { NOTIFICATION_TYPES, type NotificationType, type ReminderRoute } from "@/lib/notifications/types";

export type PermissionState = Readonly<{
  status: "granted" | "denied" | "undetermined" | "unsupported";
  /** False when the OS will not show its prompt again, so only system settings can turn it on. */
  canAskAgain: boolean;
}>;

/** What every Hafiz reminder carries in its notification data, so it can be matched on later runs. */
export type ReminderData = Readonly<{
  source: "hafiz-reminder";
  logId: string;
  type: NotificationType;
  localDate: LocalDate;
  route: ReminderRoute;
  /** The scheduled instant in milliseconds, kept here because OS triggers differ by platform. */
  at: number;
  /** Changes whenever the time or text changes, so an unchanged reminder is left in place. */
  contentKey: string;
}>;

export type ScheduledReminder = Readonly<{ osId: string; data: ReminderData }>;
export type PresentedReminder = Readonly<{ osId: string; data: ReminderData }>;

export type ReminderRequest = Readonly<{
  title: string;
  body: string;
  data: ReminderData;
  /** Adds the "Remind me in 1 hour" action (NOT-05b). */
  remindLaterAction: boolean;
}>;

export type ReminderResponse = Readonly<{
  data: ReminderData;
  action: "open" | "remind_later";
}>;

/**
 * The platform contract. Native schedules local notifications through expo-notifications; web
 * schedules nothing and shows the in-app banner instead (NOT-03).
 */
export type ReminderPlatform = Readonly<{
  supportsScheduling: boolean;
  getPermission: () => Promise<PermissionState>;
  requestPermission: () => Promise<PermissionState>;
  /** Channel, category and foreground handler. Safe to call repeatedly. */
  configure: (labels: Readonly<{ channelName: string; remindLaterAction: string }>) => Promise<void>;
  listScheduled: () => Promise<ScheduledReminder[]>;
  listPresented: () => Promise<PresentedReminder[]>;
  schedule: (request: ReminderRequest) => Promise<string>;
  cancel: (osIds: readonly string[]) => Promise<void>;
  dismiss: (osIds: readonly string[]) => Promise<void>;
  setBadge: (count: number) => Promise<void>;
  openSystemSettings: () => Promise<void>;
  /** Taps and actions. Returns an unsubscribe function. */
  subscribeResponses: (listener: (response: ReminderResponse) => void) => () => void;
  /** The response that cold-started the app, once. */
  takeLaunchResponse: () => Promise<ReminderResponse | null>;
}>;

const ROUTES: readonly string[] = ["home", "wird", "kahf"] satisfies readonly ReminderRoute[];

/** Notification data comes back from the OS untyped; accept only what Hafiz wrote. */
export function isReminderData(value: unknown): value is ReminderData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    data.source === "hafiz-reminder" &&
    typeof data.logId === "string" &&
    (NOTIFICATION_TYPES as readonly unknown[]).includes(data.type) &&
    isLocalDate(data.localDate) &&
    ROUTES.includes(String(data.route)) &&
    typeof data.at === "number" &&
    Number.isFinite(data.at) &&
    typeof data.contentKey === "string"
  );
}
