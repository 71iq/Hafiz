import type { ReminderPlatform } from "@/lib/notifications/platform-types";

/**
 * Web (NOT-03): a static export cannot schedule notifications while the tab is closed without a
 * push server, so nothing is scheduled. Reminders show as the in-app banner and the calendar file.
 */
export const reminderPlatform: ReminderPlatform = {
  supportsScheduling: false,
  getPermission: async () => ({ status: "unsupported", canAskAgain: false }),
  requestPermission: async () => ({ status: "unsupported", canAskAgain: false }),
  configure: async () => {},
  listScheduled: async () => [],
  listPresented: async () => [],
  schedule: async () => {
    throw new Error("Web does not schedule notifications");
  },
  cancel: async () => {},
  dismiss: async () => {},
  setBadge: async () => {},
  openSystemSettings: async () => {},
  subscribeResponses: () => () => {},
  takeLaunchResponse: async () => null,
};
