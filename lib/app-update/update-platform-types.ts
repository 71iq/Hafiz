import type { DownloadResponse, NetworkSnapshot, UpdateFileEntry } from "./download-plan";

export type UpdateDownloadTask = Readonly<{
  /** The HTTP response once the body is written, or null when the download was paused. */
  result: Promise<DownloadResponse | null>;
  /** Stops the download and keeps what was written for resuming. */
  pause: () => Promise<void>;
}>;

export type UpdateFileInfo = Readonly<{ exists: boolean; size: number | null; md5: string | null }>;

/**
 * The device calls the Android in-app update needs. File names are relative to the app's updates
 * folder. Web and iOS get an unsupported stub; tests replace the module.
 */
export type AppUpdatePlatform = Readonly<{
  supported: boolean;
  /** Creates the updates folder when missing and lists its files. */
  listFiles: () => Promise<UpdateFileEntry[]>;
  deleteFile: (name: string) => Promise<void>;
  /** The MD5 is computed natively, and only when asked for. */
  fileInfo: (name: string, options: { md5: boolean }) => Promise<UpdateFileInfo>;
  readText: (name: string) => Promise<string>;
  writeText: (name: string, text: string) => Promise<void>;
  moveFile: (from: string, to: string) => Promise<void>;
  /** Downloads into the file, appending after `resumeFrom` bytes with an HTTP Range request. */
  download: (
    url: string,
    name: string,
    resumeFrom: number,
    onProgress: (received: number, total: number | null) => void,
  ) => UpdateDownloadTask;
  /** Opens Android's package installer for the file; resolves when the person returns to Hafiz. */
  launchInstaller: (name: string) => Promise<void>;
  getNetwork: () => Promise<NetworkSnapshot | null>;
  subscribeNetwork: (listener: (network: NetworkSnapshot) => void) => () => void;
  isAppInBackground: () => boolean;
  /** Posts one local notification when notifications are already allowed. Never asks for permission. */
  notifyUpdateReady: (content: Readonly<{ title: string; body: string; channelName: string }>) => Promise<void>;
}>;
