import { Linking, Platform } from "react-native";
import { Download, Smartphone, type LucideIcon } from "lucide-react-native";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { ANDROID_LATEST_APK_URL } from "@/lib/app-update/release";
import { installedAndroidVersionCode } from "@/lib/app-update/use-android-update";
import { useAppUpdateView } from "@/lib/app-update/use-app-update";
import { installedAppVersion, useWebRevision } from "@/lib/app-update/build-info";
import { runUpdateAction, updateCopy } from "./update-copy";

/** A row without onPress is information only (shown muted, not a button). */
export type AppReleaseRow = { key: string; icon: LucideIcon; title: string; description: string; onPress?: () => void };

/**
 * Settings > About app rows. Each row states one fact:
 * - web: the exported web version and revision, then the latest Android APK download;
 * - Android: the installed version (tap to check again), or the newer release and its in-app
 *   download: Update, the progress (information only), Install update, or Try again;
 * - iOS: the installed version, with no update check.
 * The side-by-side QA Android build shows only its installed version.
 */
export function useAppReleaseRows(): AppReleaseRow[] {
  const s = useStrings();
  const { uiLanguage } = useSettings();
  const { view, checkAgain } = useAppUpdateView();
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
  const copy = updateCopy(view, s, uiLanguage);
  if (copy) {
    return [
      {
        key: "update",
        icon: Download,
        // Ready reads "Install update" here, so the action stays reachable after Later.
        title: view.kind === "ready" ? s.appUpdateInstallButton : copy.title,
        description: copy.description,
        onPress: copy.action ? () => runUpdateAction(view) : undefined,
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
