import type { ReminderData } from "@/lib/notifications/platform-types";
import { configureReminderPlatform, setReminderAccountSource } from "@/lib/notifications/schedule";

// Fourth review, finding 3: expo-notifications asks the app's handler whether a notification that
// arrives while the app is open shows. Another account's encouragement, or one with no owner, must not.

type Behavior = { shouldShowBanner: boolean; shouldShowList: boolean };
type Handler = { handleNotification: (notification: { request: { content: { data: unknown } } }) => Promise<Behavior> };

const mockHandlers: Handler[] = [];
jest.mock("expo-notifications", () => ({
  setNotificationHandler: (handler: unknown) => mockHandlers.push(handler as Handler),
  setNotificationChannelAsync: async () => undefined,
  setNotificationCategoryAsync: async () => undefined,
  AndroidImportance: { DEFAULT: 3 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  SchedulableTriggerInputTypes: { DATE: "date" },
}));
// The native adapter, whatever platform Jest resolves.
jest.mock("@/lib/notifications/platform", () => jest.requireActual("@/lib/notifications/platform.native"));

const ACCOUNT_A = "00000000-0000-4000-8000-00000000000a";
const ACCOUNT_B = "00000000-0000-4000-8000-00000000000b";
let signedInAccount: string | null = ACCOUNT_A;

function reminder(type: ReminderData["type"], accountId?: string): ReminderData {
  return {
    source: "hafiz-reminder",
    logId: `notif-${type}`,
    type,
    localDate: "2026-11-14",
    route: "home",
    at: Date.UTC(2026, 10, 14, 10, 30),
    contentKey: "synthetic",
    ...(accountId === undefined ? {} : { accountId }),
  };
}

/** Whether the notification shows when it arrives with the app open. */
async function arrives(data: unknown): Promise<boolean> {
  const handler = mockHandlers.at(-1);
  if (!handler) throw new Error("No notification handler installed");
  const behavior = await handler.handleNotification({ request: { content: { data } } });
  return behavior.shouldShowBanner || behavior.shouldShowList;
}

beforeAll(async () => {
  setReminderAccountSource(() => signedInAccount);
  await configureReminderPlatform({ channelName: "Reminders", remindLaterAction: "Remind me in 1 hour" });
});

beforeEach(() => {
  signedInAccount = ACCOUNT_A;
});

describe("reminders that arrive while the app is open (5.8.2)", () => {
  it("shows a halaqa encouragement only for the signed-in account it belongs to", async () => {
    expect(await arrives(reminder("group_encouragement", ACCOUNT_A))).toBe(true);
    expect(await arrives(reminder("group_encouragement", ACCOUNT_B))).toBe(false);
    expect(await arrives(reminder("group_encouragement"))).toBe(false);

    signedInAccount = ACCOUNT_B;
    expect(await arrives(reminder("group_encouragement", ACCOUNT_A))).toBe(false);
    signedInAccount = null;
    expect(await arrives(reminder("group_encouragement", ACCOUNT_A))).toBe(false);
  });

  it("shows other reminders whoever is signed in, and hides an encouragement it cannot read", async () => {
    signedInAccount = null;
    expect(await arrives(reminder("wird_reminder"))).toBe(true);
    expect(await arrives({ source: "hafiz-reminder", type: "group_encouragement" })).toBe(false);
  });

  it("installs one handler, which follows the latest configuration", async () => {
    await configureReminderPlatform({ channelName: "Reminders", remindLaterAction: "Remind me in 1 hour" });
    expect(mockHandlers).toHaveLength(1);
    expect(await arrives(reminder("group_encouragement", ACCOUNT_B))).toBe(false);
  });
});
