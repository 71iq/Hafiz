import type { ReminderPlatform } from "@/lib/notifications/platform-types";

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
