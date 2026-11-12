import { useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { Download, X as XIcon } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { ANDROID_LATEST_APK_URL, androidReleaseApkUrl } from "@/lib/app-update/release";
import { useAndroidUpdate } from "@/lib/app-update/use-android-update";
import { textStartStyle } from "@/lib/ui/direction";

/**
 * Home card for the sideloaded Android app: on the web it offers the APK download, and in the
 * Android app it appears only when a newer release is published. Opening the APK URL hands the
 * download to the browser, whose prompt installs it over the current app.
 */
export function AppReleaseCard() {
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const update = useAndroidUpdate();
  const [dismissed, setDismissed] = useState(false);

  const isWeb = Platform.OS === "web";
  if (dismissed || (!isWeb && !update)) return null;

  const title = update ? s.appUpdateTitle : s.appDownloadTitle;
  const subtitle = update ? interpolate(s.appUpdateSubtitle, { version: update.versionName }) : s.appDownloadSubtitle;
  const action = update ? s.appUpdateButton : s.appDownloadButton;
  const url = update ? androidReleaseApkUrl(update) : ANDROID_LATEST_APK_URL;
  const accent = isDark ? "#2dd4bf" : "#0d9488";

  return (
    <Card elevation="low" className="p-4 mb-6">
      <View className="items-start gap-3" style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}>
        <View className="w-10 h-10 rounded-full bg-primary-accent/10 dark:bg-primary-bright/15 items-center justify-center">
          <Download size={18} color={accent} />
        </View>
        <View className="flex-1" style={{ alignItems: isRTL ? "flex-end" : "flex-start" }}>
          <Text
            className="text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textStartStyle(isRTL)}}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500 mt-0.5 mb-3"
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 12,
              lineHeight: 18,
              ...textStartStyle(isRTL),
            }}
          >
            {subtitle}
          </Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`${action}, ${title}`}
            onPress={() => void Linking.openURL(url)}
            className="rounded-full bg-primary-accent px-4 py-1.5"
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}
          >
            <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
              {action}
            </Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.genericClose}
          onPress={() => setDismissed(true)}
          hitSlop={8}
          className="w-7 h-7 items-center justify-center"
        >
          <XIcon size={14} color={isDark ? "#737373" : "#8B8178"} />
        </Pressable>
      </View>
    </Card>
  );
}
