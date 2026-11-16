import { isLocalDate, type LocalDate } from "@/lib/habit/dates";
import { NOTIFICATION_TYPES, type NotificationType, type ReminderRoute } from "@/lib/notifications/types";

export type PermissionState = Readonly<{
  status: "granted" | "denied" | "undetermined" | "unsupported";
  canAskAgain: boolean;
}>;

export type ReminderData = Readonly<{
  source: "hafiz-reminder";
  logId: string;
  type: NotificationType;
  localDate: LocalDate;
  route: ReminderRoute;
  at: number;
  contentKey: string;
  accountId?: string;
}>;

export type ScheduledReminder = Readonly<{ osId: string; data: ReminderData }>;
export type PresentedReminder = Readonly<{ osId: string; data: ReminderData }>;

export type ReminderRequest = Readonly<{
  title: string;
  body: string;
  data: ReminderData;
  remindLaterAction: boolean;
}>;

export type ReminderResponse = Readonly<{
  data: ReminderData;
  action: "open" | "remind_later";
  osId?: string;
}>;

export type ReminderPlatform = Readonly<{
  supportsScheduling: boolean;
  getPermission: () => Promise<PermissionState>;
  requestPermission: () => Promise<PermissionState>;
  configure: (
    options: Readonly<{
      channelName: string;
      remindLaterAction: string;
      shouldPresent: (data: ReminderData) => boolean;
      onHidden: (data: ReminderData) => void;
    }>,
  ) => Promise<void>;
  listScheduled: () => Promise<ScheduledReminder[]>;
  listPresented: () => Promise<PresentedReminder[]>;
  schedule: (request: ReminderRequest) => Promise<string>;
  cancel: (osIds: readonly string[]) => Promise<void>;
  dismiss: (osIds: readonly string[]) => Promise<void>;
  setBadge: (count: number) => Promise<void>;
  openSystemSettings: () => Promise<void>;
  subscribeResponses: (listener: (response: ReminderResponse) => void) => () => void;
  takeLaunchResponse: () => Promise<ReminderResponse | null>;
}>;

const ROUTES: readonly string[] = ["home", "wird", "kahf"] satisfies readonly ReminderRoute[];

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
    typeof data.contentKey === "string" &&
    (data.accountId === undefined || typeof data.accountId === "string")
  );
}
