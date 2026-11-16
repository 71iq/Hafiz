import { ActivityIndicator, Platform, Pressable, Text, View, type ViewStyle } from "react-native";
import { LocateFixed, Pause, Play, RotateCcw, Square } from "lucide-react-native";
import { toArabicNumber } from "@/lib/arabic";
import { useAyahAudio } from "@/lib/audio/ayah-audio";
import { audioFailureMessage, formatAudioReference } from "@/lib/audio/labels";
import { useStrings } from "@/lib/i18n/useStrings";
import { getReciterById } from "@/lib/quran-foundation/recitations";
import { useSettings } from "@/lib/settings/context";
import { textStartStyle } from "@/lib/ui/direction";

type Props = {
  bottom: number;
  fixed: boolean;
  horizontalPadding: number;
  surface: ViewStyle;
  onOpenSheet: () => void;
  showBackToAyah: boolean;
  onBackToAyah: () => void;
};

export function RecitationPlayerBar({
  bottom,
  fixed,
  horizontalPadding,
  surface,
  onOpenSheet,
  showBackToAyah,
  onBackToAyah,
}: Props) {
  const s = useStrings();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const { session, rangeState, togglePause, stop, retry } = useAyahAudio();
  if (!session || session.kind === "preview") return null;

  const accent = isDark ? "#5eead4" : "#0d9488";
  const muted = isDark ? "#d4d4d4" : "#6e5a47";
  const digits = (value: number) => (isRTL ? toArabicNumber(value) : String(value));
  const { target, status } = session;
  const isRange = session.kind === "range" && rangeState.active;
  const surahName = session.surahNames ? (uiLanguage === "ar" ? session.surahNames.ar : session.surahNames.en) : null;
  const reference = isRange
    ? `${surahName ? `${surahName} ${digits(target.ayah)}` : `${digits(target.surah)}:${digits(target.ayah)}`}${
        isRTL ? "، " : " · "
      }${digits(rangeState.currentIndex + 1)}/${digits(rangeState.totalAyahs)}`
    : formatAudioReference(uiLanguage, session.surahNames, target.surah, target.ayah);
  const reciter = getReciterById(session.recitationId);
  const reciterName = uiLanguage === "ar" ? reciter.nameAr : reciter.nameEn;
  const detail =
    status === "error" && session.failure
      ? audioFailureMessage(session.failure, s)
      : status === "paused"
        ? `${s.audioPaused} · ${reciterName}`
        : status === "loading"
          ? `${s.audioLoading} · ${reciterName}`
          : reciterName;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: Platform.OS === "web" && fixed ? ("fixed" as ViewStyle["position"]) : "absolute",
        left: 0,
        right: 0,
        bottom,
        zIndex: 71,
        alignItems: "center",
        gap: 8,
        paddingHorizontal: horizontalPadding,
      }}
    >
      {showBackToAyah && (
        <Pressable
          onPress={onBackToAyah}
          accessibilityRole="button"
          accessibilityLabel={s.audioBackToAyah}
          className="min-h-[44px] items-center justify-center gap-2 rounded-full px-4"
          style={[surface, { direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }]}
        >
          <LocateFixed size={16} color={accent} />
          <Text
            className="text-primary-accent dark:text-primary-bright"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}
          >
            {s.audioBackToAyah}
          </Text>
        </Pressable>
      )}
      <View
        accessibilityLiveRegion="polite"
        style={[
          {
            width: "100%",
            maxWidth: 520,
            flexDirection: isRTL ? "row-reverse" : "row",
            direction: "ltr",
            alignItems: "center",
            gap: 6,
            borderRadius: 28,
            paddingVertical: 4,
            paddingHorizontal: 6,
          },
          surface,
        ]}
      >
        {status === "error" ? (
          <Pressable
            onPress={() => void retry()}
            accessibilityRole="button"
            accessibilityLabel={s.audioRetry}
            className="h-11 min-w-[44px] items-center justify-center gap-1 rounded-full bg-primary-accent/15 px-3 dark:bg-primary-bright/15"
            style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
          >
            <RotateCcw size={16} color={accent} />
            <Text
              className="text-primary-accent dark:text-primary-bright"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}
            >
              {s.audioRetry}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={togglePause}
            accessibilityRole="button"
            accessibilityLabel={
              status === "loading"
                ? s.audioLoading
                : status === "paused"
                  ? s.audioResumeRecitation
                  : s.audioPauseRecitation
            }
            accessibilityState={{ busy: status === "loading" }}
            className="h-11 w-11 items-center justify-center rounded-full bg-primary-accent/15 dark:bg-primary-bright/15"
          >
            {status === "loading" ? (
              <ActivityIndicator size="small" color={accent} />
            ) : status === "paused" ? (
              <Play size={18} color={accent} />
            ) : (
              <Pause size={18} color={accent} />
            )}
          </Pressable>
        )}
        <Pressable
          onPress={onOpenSheet}
          accessibilityRole="button"
          accessibilityLabel={`${reference}, ${detail}`}
          accessibilityHint={s.audioOpenRecitation}
          className="min-h-[44px] min-w-0 flex-1 justify-center px-1"
          style={{ opacity: status === "paused" ? 0.62 : 1 }}
        >
          <Text
            className="text-charcoal dark:text-neutral-100"
            numberOfLines={1}
            style={{
              fontFamily: "Manrope_700Bold",
              fontSize: 14,
              ...textStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {reference}
          </Text>
          <Text
            className={status === "error" ? "text-red-600 dark:text-red-400" : "text-warm-500 dark:text-neutral-400"}
            numberOfLines={status === "error" ? 2 : 1}
            style={{
              fontFamily: "Manrope_500Medium",
              fontSize: 12,
              ...textStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {detail}
          </Text>
        </Pressable>
        <Pressable
          onPress={stop}
          accessibilityRole="button"
          accessibilityLabel={s.recitationStop}
          className="h-11 w-11 items-center justify-center rounded-full"
        >
          <Square size={16} color={muted} />
        </Pressable>
      </View>
    </View>
  );
}
