import { Linking, Platform } from "react-native";
import { Download, Smartphone, type LucideIcon } from "lucide-react-native";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { ANDROID_LATEST_APK_URL, androidReleaseApkUrl } from "@/lib/app-update/release";
import { installedAndroidVersionCode, useAndroidRelease } from "@/lib/app-update/use-android-update";
import { installedAppVersion, useWebRevision } from "@/lib/app-update/build-info";

/** A row without onPress is information only (shown muted, not a button). */
export type AppReleaseRow = { key: string; icon: LucideIcon; title: string; description: string; onPress?: () => void };

/**
 * Settings > About app rows. Each row states one fact:
 * - web: the exported web version and revision, then the latest Android APK download;
 * - Android: the installed version (tap to check again), or the newer published release;
 * - iOS: the installed version, with no update check.
 * The side-by-side QA Android build shows only its installed version.
 */
export function useAppReleaseRows(): AppReleaseRow[] {
  const s = useStrings();
  const { update, checkAgain } = useAndroidRelease();
  const revision = useWebRevision();
  const version = installedAppVersion();

  if (Platform.OS === "web") {
    const rows: AppReleaseRow[] = [];
    if (version) {
      rows.push({
        key: "web-version",
        icon: Smartphone,
        title: interpolate(s.aboutVersion, { version }),
        description: revision ? interpolate(s.aboutWebRevision, { revision }) : s.appName,
      });
    }
    rows.push({
      key: "apk",
      icon: Download,
      title: s.appDownloadTitle,
      description: s.appDownloadSubtitle,
      onPress: () => void Linking.openURL(ANDROID_LATEST_APK_URL).catch(() => {}),
    });
    return rows;
  }
  if (update) {
    return [
      {
        key: "update",
        icon: Download,
        title: s.appUpdateTitle,
        description: interpolate(s.appUpdateSubtitle, { version: update.versionName }),
        onPress: () => void Linking.openURL(androidReleaseApkUrl(update)).catch(() => {}),
      },
    ];
  }
  if (!version) return [];
  const checksForUpdates = installedAndroidVersionCode() !== null;
  return [
    {
      key: "installed",
      icon: Smartphone,
      title: s.settingsAppVersion,
      description: checksForUpdates
        ? interpolate(s.settingsAppVersionValue, { version })
        : interpolate(s.aboutVersion, { version }),
      onPress: checksForUpdates ? checkAgain : undefined,
    },
  ];
}
