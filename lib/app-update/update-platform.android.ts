import { requireNativeModule } from "expo";
import { AppState } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import * as Notifications from "expo-notifications";
import type { NetworkSnapshot } from "./download-plan";
import type { AppUpdatePlatform } from "./update-platform-types";

// The cache folder: Android may reclaim it under storage pressure and never backs it up, which suits
// a 400 MB file that is only needed until it is installed. expo-file-system's FileProvider shares
// files from this folder as content:// URIs.
const UPDATES_DIR = `${FileSystem.cacheDirectory ?? ""}app-updates/`;
const APK_MIME_TYPE = "application/vnd.android.package-archive";
const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
const CHANNEL_ID = "app-updates";

const uri = (name: string) => `${UPDATES_DIR}${name}`;

function toSnapshot(state: NetInfoState): NetworkSnapshot {
  const details = state.details as { isConnectionExpensive?: unknown } | null;
  return {
    type: state.type,
    isConnected: state.isConnected,
    isConnectionExpensive: typeof details?.isConnectionExpensive === "boolean" ? details.isConnectionExpensive : null,
  };
}

export const appUpdatePlatform: AppUpdatePlatform = {
  supported: true,

  async listFiles() {
    await FileSystem.makeDirectoryAsync(UPDATES_DIR, { intermediates: true });
    const names = await FileSystem.readDirectoryAsync(UPDATES_DIR);
    return Promise.all(
      names.map(async (name) => {
        const info = await FileSystem.getInfoAsync(uri(name));
        return { name, size: info.exists && !info.isDirectory ? info.size : 0 };
      }),
    );
  },

  async deleteFile(name) {
    await FileSystem.deleteAsync(uri(name), { idempotent: true });
  },

  async fileSize(name) {
    const info = await FileSystem.getInfoAsync(uri(name));
    return info.exists && !info.isDirectory ? info.size : null;
  },

  sha256: (name) => requireNativeModule<{ sha256(name: string): Promise<string> }>("HafizApkVerifier").sha256(name),

  readText: (name) => FileSystem.readAsStringAsync(uri(name)),

  writeText: (name, text) => FileSystem.writeAsStringAsync(uri(name), text),

  moveFile: (from, to) => FileSystem.moveAsync({ from: uri(from), to: uri(to) }),

  download(url, name, resumeFrom, onProgress) {
    const task = FileSystem.createDownloadResumable(
      url,
      uri(name),
      { cache: false },
      ({ totalBytesWritten, totalBytesExpectedToWrite }) =>
        // Without a Content-Length the native total is the offset minus one.
        onProgress(totalBytesWritten, totalBytesExpectedToWrite > resumeFrom ? totalBytesExpectedToWrite : null),
      // On Android the resume data is the byte offset that becomes the Range header.
      resumeFrom > 0 ? String(resumeFrom) : undefined,
    );
    return {
      result: task
        .downloadAsync()
        .then((response) => (response ? { status: response.status, headers: response.headers } : null)),
      pause: async () => {
        await task.pauseAsync();
      },
    };
  },

  async launchInstaller(name) {
    const contentUri = await FileSystem.getContentUriAsync(uri(name));
    // Android shows its own confirmation, and the first time asks to allow installs from Hafiz.
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: contentUri,
      type: APK_MIME_TYPE,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  },

  getNetwork: () => NetInfo.fetch().then(toSnapshot, () => null),

  subscribeNetwork: (listener) => NetInfo.addEventListener((state) => listener(toSnapshot(state))),

  isAppInBackground: () => AppState.currentState !== "active",

  async notifyUpdateReady({ title, body, channelName }) {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: channelName,
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    // Tapping it opens Hafiz, whose ready state shows the install prompt.
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { source: "hafiz-app-update" }, sound: false },
      trigger: { channelId: CHANNEL_ID },
    });
  },
};
