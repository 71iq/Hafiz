import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react-native";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ZaytRivePreview } from "@/components/zayt/ZaytRivePreview";
import { useDatabaseStatus } from "@/lib/database/provider";
import { strings } from "@/lib/i18n/strings";
import { getStartupLanguage } from "@/lib/i18n/startup-language";
import { useStrings } from "@/lib/i18n/useStrings";
import { SettingsProvider, useSettings } from "@/lib/settings/context";

export default function ZaytPreviewRoute() {
  const { isReady, progress, error } = useDatabaseStatus();
  const startupStrings = strings[getStartupLanguage()];

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-surface px-6 dark:bg-surface-dark">
        <Text className="mb-4 text-red-600" style={{ fontFamily: "Manrope_700Bold", fontSize: 18 }}>
          {startupStrings.databaseError}
        </Text>
        <Text className="text-center text-red-500" style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}>
          {error}
        </Text>
      </View>
    );
  }

  if (!isReady) return <LoadingScreen progress={progress} />;

  return (
    <SettingsProvider>
      <ZaytPreviewScreen />
    </SettingsProvider>
  );
}

function ZaytPreviewScreen() {
  const router = useRouter();
  const s = useStrings();
  const { isDark, isRTL, themeSurface } = useSettings();
  const [hasError, setHasError] = useState(false);
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;
  const iconColor = isDark ? "#2dd4bf" : "#0d9488";
  const muted = isDark ? "#a3a3a3" : "#6e5a47";

  const handleRiveError = useCallback(() => {
    setHasError(true);
  }, []);

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: themeSurface, direction: isRTL ? "rtl" : "ltr" }}>
      <View className="flex-1 items-center px-5 py-5">
        <View className="w-full max-w-[560px]">
          <View
            className="mb-5 items-center justify-between gap-3"
            style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
          >
            <Pressable
              onPress={() => router.canGoBack() ? router.back() : router.replace("/" as any)}
              className="h-10 min-w-10 flex-row items-center justify-center gap-2 rounded-full bg-surface-low px-3 dark:bg-surface-dark-low"
              style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
            >
              <BackIcon size={17} color={muted} />
            </Pressable>
            <View className="flex-1 items-center">
              <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
                <Sparkles size={19} color={iconColor} />
              </View>
            </View>
            <View className="h-10 min-w-10" />
          </View>

          <View className={isRTL ? "items-end" : "items-start"}>
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{
                fontFamily: "Manrope_700Bold",
                fontSize: 24,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.zaytPreviewTitle}
            </Text>
            <Text
              className="mt-2 text-warm-500 dark:text-neutral-400"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 14,
                lineHeight: 20,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.zaytPreviewSubtitle}
            </Text>
          </View>

          <View className="mt-6 h-[420px] overflow-hidden rounded-3xl bg-surface-low dark:bg-surface-dark-low">
            <ZaytRivePreview
              loadingLabel={s.zaytPreviewLoading}
              errorLabel={s.zaytPreviewError}
              isDark={isDark}
              onError={handleRiveError}
            />
          </View>

          {hasError && (
            <Text
              className="mt-4 text-center text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18 }}
            >
              {s.zaytPreviewError}
            </Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
