import { Linking, Platform } from "react-native";
import * as Application from "expo-application";
import { Download, Smartphone, type LucideIcon } from "lucide-react-native";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { ANDROID_LATEST_APK_URL, androidReleaseApkUrl } from "@/lib/app-update/release";
import { installedAndroidVersionCode, useAndroidRelease } from "@/lib/app-update/use-android-update";

export type AppReleaseRow = { icon: LucideIcon; title: string; description: string; onPress: () => void };

/**
 * Settings > About row for the Android app: a download link on the web; on Android the installed
 * version (tap to check again), which becomes an update action when a newer release is published.
 * Null on iOS and in the QA build.
 */
export function useAppReleaseRow(): AppReleaseRow | null {
  const s = useStrings();
  const { update, checkAgain } = useAndroidRelease();

  if (Platform.OS === "web") {
    return {
      icon: Download,
      title: s.appDownloadTitle,
      description: s.appDownloadSubtitle,
      onPress: () => void Linking.openURL(ANDROID_LATEST_APK_URL),
    };
  }
  if (update) {
    return {
      icon: Download,
      title: s.appUpdateTitle,
      description: interpolate(s.appUpdateSubtitle, { version: update.versionName }),
      onPress: () => void Linking.openURL(androidReleaseApkUrl(update)),
    };
  }
  if (installedAndroidVersionCode() === null) return null;
  return {
    icon: Smartphone,
    title: s.settingsAppVersion,
    description: interpolate(s.settingsAppVersionValue, { version: Application.nativeApplicationVersion ?? "" }),
    onPress: checkAgain,
  };
}
