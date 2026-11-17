import { useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { Download, X as XIcon } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { ANDROID_LATEST_APK_URL } from "@/lib/app-update/release";
import { useAppUpdateView } from "@/lib/app-update/use-app-update";
import { textStartStyle } from "@/lib/ui/direction";
import { runUpdateAction, updateCopy } from "./update-copy";

/**
 * Home card for the sideloaded Android app. On the web it offers the APK download. In the Android
 * app it appears while a newer release exists or a download is under way: Update downloads it inside
 * the app with progress, and Install update opens Android's installer. Android never hands the APK
 * to the browser.
 */
export function AppReleaseCard() {
  const s = useStrings();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const { view } = useAppUpdateView();
  // Closing hides the card in its current state only, so a finished download shows it again.
  const stateKey = view.kind === "none" ? view.kind : `${view.kind}:${view.release.versionCode}`;
  const [dismissedState, setDismissedState] = useState<string | null>(null);

  const isWeb = Platform.OS === "web";
  const copy = isWeb ? null : updateCopy(view, s, uiLanguage);
  if (dismissedState === stateKey || (!isWeb && !copy)) return null;

  const title = copy ? copy.title : s.appDownloadTitle;
  const subtitle = copy ? copy.description : s.appDownloadSubtitle;
  const action = copy ? copy.action : s.appDownloadButton;
  const onAction = copy ? () => runUpdateAction(view) : () => void Linking.openURL(ANDROID_LATEST_APK_URL);
  const downloading = copy !== null && view.kind === "downloading";
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
          {downloading ? (
            <Progress
              value={copy.percent ?? 0}
              dir={isRTL ? "rtl" : "ltr"}
              className="mb-1"
              accessibilityRole="progressbar"
              accessibilityLabel={title}
              accessibilityValue={copy.percent === null ? undefined : { min: 0, max: 100, now: copy.percent }}
            />
          ) : null}
          {action ? (
            <Pressable
              accessibilityRole={copy ? "button" : "link"}
              accessibilityLabel={`${action}, ${title}`}
              onPress={onAction}
              className="rounded-full bg-primary-accent px-4 py-1.5"
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}
            >
              <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                {action}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.genericClose}
          onPress={() => setDismissedState(stateKey)}
          hitSlop={8}
          className="w-7 h-7 items-center justify-center"
        >
          <XIcon size={14} color={isDark ? "#737373" : "#8B8178"} />
        </Pressable>
      </View>
    </Card>
  );
}
