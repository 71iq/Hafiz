import { useEffect, useMemo } from "react";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { setPendingDeepLink } from "@/lib/deep-link";
import { navigateToMushaf } from "@/lib/navigation/open-mushaf";
import { returnToTabs, type RootStackState } from "@/lib/navigation/return-to-tabs";
import { parseAyahLinkParams } from "@/lib/search/reference";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";

/**
 * Deep link handler route.
 *
 * Handles:
 *   hafiz://open?surah=2&ayah=255
 *   https://hafizquran.app/open?surah=2&ayah=255
 *
 * The parameters go through the shared strict parser (C06). A valid link submits one target and
 * moves to the Mushaf tab; it never reads the onboarding decision, so the first linked reading works
 * before optional setup and the next ordinary launch still follows it. An invalid or partial link is
 * never clamped to another ayah: it shows a message with Home and Search and leaves the saved
 * reading position untouched.
 */
export default function OpenDeepLink() {
  const params = useLocalSearchParams<{ surah?: string; ayah?: string }>();
  const navigation = useNavigation();
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  // The word parameter is not part of the link contract; only surah and ayah are read.
  const parsed = useMemo(
    () => parseAyahLinkParams({ surah: params.surah, ayah: params.ayah }),
    [params.surah, params.ayah],
  );

  useEffect(() => {
    if (parsed.kind !== "ayah") return;
    setPendingDeepLink({ surah: parsed.surah, ayah: parsed.ayah });
    // A warm link pushes this screen on top of the open app. When the tabs are directly below,
    // return to them; replacing would stack another full tab tree under every link, growing memory
    // and the Back history (RF196). Otherwise (cold start, or a session, auth or onboarding screen
    // below) replace this screen as before so that flow stays underneath.
    navigateToMushaf(navigation.getState());
  }, [navigation, parsed]);

  const accent = isDark ? "#2dd4bf" : "#0d9488";
  const writingDirection = isRTL ? "rtl" : "ltr";

  if (parsed.kind !== "ayah") {
    const leave = (href: "/(tabs)/home" | "/(tabs)/search") =>
      returnToTabs(navigation.getState() as RootStackState, href);
    return (
      <View className="flex-1 items-center justify-center bg-surface dark:bg-surface-dark px-6">
        <View className="w-full max-w-[420px] items-center gap-3">
          <Text
            accessibilityRole="header"
            className="text-charcoal dark:text-neutral-100 text-center"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 18, lineHeight: 26, writingDirection }}
          >
            {s.openLinkInvalidTitle}
          </Text>
          <Text
            className="text-warm-600 dark:text-neutral-400 text-center"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 21, writingDirection }}
          >
            {s.openLinkInvalidBody}
          </Text>
          <View
            className="mt-2 w-full flex-row flex-wrap justify-center gap-3"
            style={{ direction: isRTL ? "rtl" : "ltr" }}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => leave("/(tabs)/home")}
              className="min-h-[44px] min-w-[120px] items-center justify-center rounded-full bg-primary-accent dark:bg-primary-bright px-5"
            >
              <Text
                className="text-white dark:text-neutral-950"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
              >
                {s.tabHome}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => leave("/(tabs)/search")}
              className="min-h-[44px] min-w-[120px] items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-5"
            >
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
              >
                {s.openLinkSearch}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // Brief loading state while redirecting
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-surface dark:bg-surface-dark">
      <ActivityIndicator size="large" color={accent} />
      <Text
        accessibilityLiveRegion="polite"
        className="text-warm-600 dark:text-neutral-400"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 14, writingDirection }}
      >
        {s.openLinkOpening}
      </Text>
    </View>
  );
}
