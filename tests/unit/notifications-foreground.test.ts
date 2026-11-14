import { reminderPlatform } from "@/lib/notifications/platform";
import type { ReminderData } from "@/lib/notifications/platform-types";
import {
  configureReminderPlatform,
  setReminderAccountSource,
  shouldPresentReminder,
} from "@/lib/notifications/schedule";

// Fourth review, finding 3: expo-notifications asks the app's handler whether a notification that
// arrives while the app is open shows. Another account's encouragement, or one with no owner, must not.

type Behavior = { shouldShowBanner: boolean; shouldShowList: boolean };
type Handler = { handleNotification: (notification: { request: { content: { data: unknown } } }) => Promise<Behavior> };

const mockHandlers: Handler[] = [];
const mockCategories: unknown[][] = [];
jest.mock("expo-notifications", () => ({
  setNotificationHandler: (handler: unknown) => mockHandlers.push(handler as Handler),
  setNotificationChannelAsync: async () => undefined,
  setNotificationCategoryAsync: async (...args: unknown[]) => {
    mockCategories.push(args);
  },
  AndroidImportance: { DEFAULT: 3 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  SchedulableTriggerInputTypes: { DATE: "date" },
}));
// The native adapter, whatever platform Jest resolves.
jest.mock("@/lib/notifications/platform", () => jest.requireActual("@/lib/notifications/platform.native"));

const LABELS = { channelName: "Reminders", remindLaterAction: "Remind me in 1 hour" };
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
  await configureReminderPlatform(LABELS);
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

  // Fifth review, finding N5: the OS lets go of an alarm the handler hides, so the next run took it for
  // delivered. The handler reports what it hides, and the run records it as cancelled instead.
  it("reports each reminder it hides, and none it shows", async () => {
    const onHidden = jest.fn();
    await reminderPlatform.configure({ ...LABELS, shouldPresent: shouldPresentReminder, onHidden });
    try {
      const foreign = reminder("group_encouragement", ACCOUNT_B);
      expect(await arrives(foreign)).toBe(false);
      expect(await arrives(reminder("group_encouragement", ACCOUNT_A))).toBe(true);
      expect(await arrives(reminder("wird_reminder"))).toBe(true);
      // Without a log id there is nothing to record.
      expect(await arrives({ source: "hafiz-reminder", type: "group_encouragement" })).toBe(false);
      expect(onHidden.mock.calls).toEqual([[foreign]]);
    } finally {
      await configureReminderPlatform(LABELS);
    }
  });

  it("installs one handler, which follows the latest configuration", async () => {
    await configureReminderPlatform(LABELS);
    expect(mockHandlers).toHaveLength(1);
    expect(await arrives(reminder("group_encouragement", ACCOUNT_B))).toBe(false);
  });
});

describe("the remind-later action on Android (NOT-05b)", () => {
  it("opens the app, so its handler runs even after Android ended the app's process", async () => {
    await reminderPlatform.configure({ ...LABELS, shouldPresent: shouldPresentReminder, onHidden: () => undefined });
    const [, actions] = mockCategories[mockCategories.length - 1] as [string, { identifier: string; options: object }[]];
    expect(actions).toEqual([expect.objectContaining({ options: { opensAppToForeground: true } })]);
  });
});
