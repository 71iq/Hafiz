import { reminderPlatform } from "@/lib/notifications/platform";
import type { ReminderData } from "@/lib/notifications/platform-types";
import { configureReminderPlatform } from "@/lib/notifications/schedule";

// expo-notifications asks the app's handler whether a notification that arrives while the app is open
// shows. Halaqa is removed for now: an encouragement reminder an earlier build scheduled may belong to
// another account on this device, so it never shows and configure clears what is left of it.

type Behavior = { shouldShowBanner: boolean; shouldShowList: boolean };
type Handler = { handleNotification: (notification: { request: { content: { data: unknown } } }) => Promise<Behavior> };
type OsNotification = { identifier: string; content: { data: unknown } };

const mockHandlers: Handler[] = [];
const mockCategories: unknown[][] = [];
const mockOs: { scheduled: OsNotification[]; presented: OsNotification[] } = { scheduled: [], presented: [] };
jest.mock("expo-notifications", () => ({
  setNotificationHandler: (handler: unknown) => mockHandlers.push(handler as Handler),
  setNotificationChannelAsync: async () => undefined,
  setNotificationCategoryAsync: async (...args: unknown[]) => {
    mockCategories.push(args);
  },
  getAllScheduledNotificationsAsync: async () => mockOs.scheduled,
  getPresentedNotificationsAsync: async () => mockOs.presented.map((request) => ({ request })),
  cancelScheduledNotificationAsync: async (id: string) => {
    mockOs.scheduled = mockOs.scheduled.filter((item) => item.identifier !== id);
  },
  dismissNotificationAsync: async (id: string) => {
    mockOs.presented = mockOs.presented.filter((item) => item.identifier !== id);
  },
  AndroidImportance: { DEFAULT: 3 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  SchedulableTriggerInputTypes: { DATE: "date" },
}));
// The native adapter, whatever platform Jest resolves.
jest.mock("@/lib/notifications/platform", () => jest.requireActual("@/lib/notifications/platform.native"));

const LABELS = { channelName: "Reminders", remindLaterAction: "Remind me in 1 hour" };
const ACCOUNT_B = "00000000-0000-4000-8000-00000000000b";

function reminder(type: ReminderData["type"]): ReminderData {
  return {
    source: "hafiz-reminder",
    logId: `notif-${type}`,
    type,
    localDate: "2026-11-14",
    route: "home",
    at: Date.UTC(2026, 10, 14, 10, 30),
    contentKey: "synthetic",
  };
}

/** What an earlier build wrote for a Halaqa encouragement reminder. */
const retired = {
  ...reminder("wird_reminder"),
  logId: "notif-group",
  type: "group_encouragement",
  accountId: ACCOUNT_B,
};

/** Whether the notification shows when it arrives with the app open. */
async function arrives(data: unknown): Promise<boolean> {
  const handler = mockHandlers.at(-1);
  if (!handler) throw new Error("No notification handler installed");
  const behavior = await handler.handleNotification({ request: { content: { data } } });
  return behavior.shouldShowBanner || behavior.shouldShowList;
}

beforeEach(async () => {
  mockOs.scheduled = [];
  mockOs.presented = [];
  await configureReminderPlatform(LABELS);
});

describe("reminders that arrive while the app is open", () => {
  it("shows Hafiz reminders and notifications it cannot read", async () => {
    expect(await arrives(reminder("wird_reminder"))).toBe(true);
    expect(await arrives(reminder("friday_kahf"))).toBe(true);
    expect(await arrives({ title: "not a Hafiz reminder" })).toBe(true);
  });

  it("never shows a Halaqa encouragement reminder an earlier build scheduled", async () => {
    expect(await arrives(retired)).toBe(false);
    expect(await arrives({ source: "hafiz-reminder", type: "group_encouragement" })).toBe(false);
  });

  it("installs one handler however often it is configured", async () => {
    await configureReminderPlatform(LABELS);
    expect(mockHandlers).toHaveLength(1);
  });
});

describe("Halaqa encouragement reminders left by an earlier build", () => {
  it("cancels them and clears them from the tray, and leaves every other reminder", async () => {
    const wird = { identifier: "os-wird", content: { data: reminder("wird_reminder") } };
    mockOs.scheduled = [wird, { identifier: "os-group", content: { data: retired } }];
    mockOs.presented = [
      { identifier: "os-kahf", content: { data: reminder("friday_kahf") } },
      { identifier: "os-group-shown", content: { data: retired } },
    ];
    await configureReminderPlatform(LABELS);
    expect(mockOs.scheduled.map((item) => item.identifier)).toEqual(["os-wird"]);
    expect(mockOs.presented.map((item) => item.identifier)).toEqual(["os-kahf"]);
    // Nothing reads them as reminders any more.
    expect((await reminderPlatform.listScheduled()).map((item) => item.osId)).toEqual(["os-wird"]);
  });
});

describe("the remind-later action on Android (NOT-05b)", () => {
  it("opens the app, so its handler runs even after Android ended the app's process", async () => {
    await reminderPlatform.configure(LABELS);
    const [, actions] = mockCategories[mockCategories.length - 1] as [
      string,
      { identifier: string; options: object }[],
    ];
    expect(actions).toEqual([expect.objectContaining({ options: { opensAppToForeground: true } })]);
  });
});
