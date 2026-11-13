import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import {
  isReminderData,
  type PermissionState,
  type ReminderPlatform,
  type ReminderResponse,
} from "@/lib/notifications/platform-types";

/**
 * Native reminders through expo-notifications (NOT-01). Each reminder is one dated local
 * notification (NOT-04).
 *
 * Android exactness (NOT-02): expo-notifications 55 chooses per device, not per notification. It
 * uses an exact alarm when the app may schedule exact alarms and an inexact one otherwise. The app
 * does not declare SCHEDULE_EXACT_ALARM, so on Android 12 and later every reminder, the late one
 * included, is inexact. See the report for the trade-off.
 */
const CHANNEL_ID = "wird-reminders";
const CATEGORY_ID = "wird-reminder";
const REMIND_LATER_ACTION = "remind_later";

let handlerInstalled = false;

function toPermission(response: Notifications.NotificationPermissionsStatus): PermissionState {
  const provisional = response.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (response.granted || provisional) return { status: "granted", canAskAgain: response.canAskAgain };
  return { status: response.status === "denied" ? "denied" : "undetermined", canAskAgain: response.canAskAgain };
}

function toResponse(response: Notifications.NotificationResponse): ReminderResponse | null {
  const data = response.notification.request.content.data;
  if (!isReminderData(data)) return null;
  if (response.actionIdentifier === REMIND_LATER_ACTION) return { data, action: "remind_later" };
  if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) return { data, action: "open" };
  return null;
}

export const reminderPlatform: ReminderPlatform = {
  supportsScheduling: true,

  async getPermission() {
    return toPermission(await Notifications.getPermissionsAsync());
  },

  async requestPermission() {
    return toPermission(
      await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: false } }),
    );
  },

  async configure({ channelName, remindLaterAction }) {
    if (!handlerInstalled) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      handlerInstalled = true;
    }
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: channelName,
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    await Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
      { identifier: REMIND_LATER_ACTION, buttonTitle: remindLaterAction, options: { opensAppToForeground: false } },
    ]);
  },

  async listScheduled() {
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    return requests.flatMap((request) => {
      const data = request.content.data;
      return isReminderData(data) ? [{ osId: request.identifier, data }] : [];
    });
  },

  async listPresented() {
    const presented = await Notifications.getPresentedNotificationsAsync();
    return presented.flatMap((notification) => {
      const data = notification.request.content.data;
      return isReminderData(data) ? [{ osId: notification.request.identifier, data }] : [];
    });
  },

  async schedule({ title, body, data, remindLaterAction }) {
    return Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { ...data },
        sound: false,
        ...(remindLaterAction ? { categoryIdentifier: CATEGORY_ID } : {}),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: data.at, channelId: CHANNEL_ID },
    });
  },

  async cancel(osIds) {
    for (const id of osIds) await Notifications.cancelScheduledNotificationAsync(id);
  },

  async dismiss(osIds) {
    for (const id of osIds) await Notifications.dismissNotificationAsync(id);
  },

  async setBadge(count) {
    await Notifications.setBadgeCountAsync(count);
  },

  async openSystemSettings() {
    await Linking.openSettings();
  },

  subscribeResponses(listener) {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const parsed = toResponse(response);
      if (parsed) listener(parsed);
    });
    return () => subscription.remove();
  },

  async takeLaunchResponse() {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;
    await Notifications.clearLastNotificationResponseAsync();
    return toResponse(response);
  },
};
