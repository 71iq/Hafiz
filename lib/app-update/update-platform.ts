import type { AppUpdatePlatform } from "./update-platform-types";

const unsupported = () => Promise.reject(new Error("In-app updates are Android only"));

/** Web and iOS: no in-app update. The web keeps its APK link; iOS shows nothing. */
export const appUpdatePlatform: AppUpdatePlatform = {
  supported: false,
  listFiles: async () => [],
  deleteFile: async () => undefined,
  fileSize: async () => null,
  sha256: unsupported,
  readText: unsupported,
  writeText: unsupported,
  moveFile: unsupported,
  download: () => ({ result: unsupported(), pause: async () => undefined }),
  launchInstaller: unsupported,
  getNetwork: async () => null,
  subscribeNetwork: () => () => undefined,
  isAppInBackground: () => false,
  notifyUpdateReady: async () => undefined,
};
