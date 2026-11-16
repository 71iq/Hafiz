import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, ArrowRight, Pause, Play, Sparkles } from "lucide-react-native";
import { ZaytRivePreview } from "@/components/zayt/ZaytRivePreview";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { textStartStyle } from "@/lib/ui/direction";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";

export function ZaytPreviewScreen() {
  const router = useRouter();
  const s = useStrings();
  const { isDark, isRTL, themeSurface } = useSettings();
  const reduceMotion = useReducedMotionPreference();
  const [userPlaying, setUserPlaying] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const playing = userPlaying ?? !reduceMotion;
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;
  const iconColor = isDark ? "#2dd4bf" : "#0d9488";
  const muted = isDark ? "#a3a3a3" : "#6e5a47";
  const PlaybackIcon = playing ? Pause : Play;
  const playbackLabel = playing ? s.zaytPreviewPause : s.zaytPreviewPlay;

  const handleReady = useCallback(() => setStatus("ready"), []);
  const handleError = useCallback(() => setStatus("error"), []);
  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((current) => current + 1);
  }, []);

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: themeSurface, direction: isRTL ? "rtl" : "ltr" }}>
      <View className="flex-1 items-center px-5 py-5">
        <View className="w-full max-w-[560px]">
          <View className="mb-5 items-center justify-between gap-3" style={{ flexDirection: "row" }}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))}
              accessibilityRole="button"
              accessibilityLabel={s.zaytPreviewBack}
              className="h-11 min-w-11 flex-row items-center justify-center gap-2 rounded-full bg-surface-low px-3 dark:bg-surface-dark-low"
              style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
            >
              <BackIcon size={17} color={muted} />
            </Pressable>
            <View className="flex-1 items-center">
              <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
                <Sparkles size={19} color={iconColor} />
              </View>
            </View>
            <View className="h-11 min-w-11" />
          </View>

          <View>
            <Text
              accessibilityRole="header"
              className="text-charcoal dark:text-neutral-100"
              style={{
                fontFamily: "Manrope_700Bold",
                fontSize: 24,
                ...textStartStyle(isRTL),
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
                ...textStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.zaytPreviewSubtitle}
            </Text>
          </View>

          <View className="mt-6 h-[420px] overflow-hidden rounded-3xl bg-surface-low dark:bg-surface-dark-low">
            <ZaytRivePreview
              key={attempt}
              loadingLabel={s.zaytPreviewLoading}
              errorLabel={s.zaytPreviewError}
              retryLabel={s.zaytPreviewRetry}
              isDark={isDark}
              playing={playing}
              onReady={handleReady}
              onError={handleError}
              onRetry={retry}
            />
          </View>

          {status === "ready" ? (
            <Pressable
              onPress={() => setUserPlaying(!playing)}
              accessibilityRole="button"
              accessibilityLabel={playbackLabel}
              className="mt-4 min-h-11 flex-row items-center justify-center gap-2 self-center rounded-full bg-surface-low px-5 dark:bg-surface-dark-low"
              style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
            >
              <PlaybackIcon size={16} color={iconColor} />
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
              >
                {playbackLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}
