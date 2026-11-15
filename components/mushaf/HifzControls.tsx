import type { ReactNode } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { ChevronsLeft, ChevronsRight, Eye, EyeOff, Minus, Pause, Play, Plus, RotateCcw, TextCursorInput, Timer } from "lucide-react-native";
import {
  MAX_HIFZ_AUTO_DELAY_MS,
  MIN_HIFZ_AUTO_DELAY_MS,
  useSettings,
  withThemeOpacity,
} from "@/lib/settings/context";
import { toArabicNumber } from "@/lib/arabic";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";

type Props = {
  canRevealNext: boolean;
  canHidePrevious: boolean;
  autoRunning: boolean;
  /** Every ayah on the page is shown: Play gives way to Page revealed, Repeat and Next page. */
  pageComplete: boolean;
  onRevealNext: () => void;
  onRevealNextWord: () => void;
  onHidePrevious: () => void;
  onStartAuto: () => void;
  onStopAuto: () => void;
  onRepeatPage: () => void;
  /** Absent on the last page. */
  onNextPage?: () => void;
};

const HIFZ_AUTO_DELAY_OPTIONS_MS = [
  5000, 4750, 4500, 4250, 4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250, 1000, 750, 500, 333, 250,
] as const;

/** Seconds between words: "0.5s" in English, "٠٫٥ ث" in Arabic. */
export function formatSecondsPerWord(ms: number, isRTL: boolean, template: string) {
  const seconds = Math.round(ms / 10) / 100;
  const text = String(Number(seconds.toFixed(2)));
  const [whole, fraction] = text.split(".");
  const localized = isRTL
    ? `${toArabicNumber(Number(whole))}${fraction ? `٫${fraction.replace(/\d/g, (d) => toArabicNumber(Number(d)))}` : ""}`
    : text;
  return interpolate(template, { seconds: localized });
}

export function getNextFasterDelay(ms: number) {
  return HIFZ_AUTO_DELAY_OPTIONS_MS.find((option) => option < ms) ?? MIN_HIFZ_AUTO_DELAY_MS;
}

export function getNextSlowerDelay(ms: number) {
  return [...HIFZ_AUTO_DELAY_OPTIONS_MS].reverse().find((option) => option > ms) ?? MAX_HIFZ_AUTO_DELAY_MS;
}

function RailButton({
  children,
  disabled,
  label,
  hint,
  caption,
  tone = "neutral",
  onPress,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  hint?: string;
  /** A visible word under the button, shown on wide screens. */
  caption?: string;
  tone?: "neutral" | "positive" | "negative" | "active";
  onPress: () => void;
}) {
  const { isDark, themeColors } = useSettings();
  const backgroundColor =
    tone === "positive"
      ? isDark ? "rgba(45, 212, 191, 0.14)" : "rgba(13, 148, 136, 0.10)"
      : tone === "negative"
        ? isDark ? "rgba(248, 113, 113, 0.12)" : "rgba(254, 226, 226, 0.85)"
        : tone === "active"
          ? withThemeOpacity(isDark ? themeColors.surfaceBright : themeColors.surface, isDark ? 0.3 : 0.9)
          : withThemeOpacity(themeColors.surfaceHigh, 0.84);

  return (
    <View className="items-center gap-0.5">
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled: Boolean(disabled) }}
        className="h-11 w-11 items-center justify-center rounded-full"
        style={({ pressed }) => ({
          backgroundColor,
          opacity: disabled ? 0.4 : 1,
          borderWidth: tone === "active" ? 2 : 0,
          borderColor: isDark ? "#d4d4d4" : "#1f2937",
          transform: [{ scale: pressed && !disabled ? 0.98 : 1 }],
          ...(Platform.OS === "web" ? ({ cursor: disabled ? "default" : "pointer" } as any) : null),
        })}
      >
        {children}
      </Pressable>
      {caption ? (
        <Text
          aria-hidden
          className="text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, opacity: disabled ? 0.6 : 1 }}
        >
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

export function HifzControls({
  canRevealNext,
  canHidePrevious,
  autoRunning,
  pageComplete,
  onRevealNext,
  onRevealNextWord,
  onHidePrevious,
  onStartAuto,
  onStopAuto,
  onRepeatPage,
  onNextPage,
}: Props) {
  const s = useStrings();
  const { width } = useWindowDimensions();
  const {
    hifzAutoDelayMs,
    setHifzAutoDelayMs,
    isDark,
    isRTL,
    themeColors,
    themeSurface,
  } = useSettings();
  const wide = width >= SIDEBAR_BREAKPOINT;
  const iconColor = isDark ? "#d4d4d4" : "#4b4037";
  const teal = isDark ? "#2dd4bf" : "#0d9488";
  const red = isDark ? "#fca5a5" : "#dc2626";
  const speedLabel = formatSecondsPerWord(hifzAutoDelayMs, isRTL, s.revealSecondsPerWord);
  const canDecreaseSpeed = hifzAutoDelayMs < MAX_HIFZ_AUTO_DELAY_MS;
  const canIncreaseSpeed = hifzAutoDelayMs > MIN_HIFZ_AUTO_DELAY_MS;
  const decreaseSpeed = () => setHifzAutoDelayMs(getNextSlowerDelay(hifzAutoDelayMs));
  const increaseSpeed = () => setHifzAutoDelayMs(getNextFasterDelay(hifzAutoDelayMs));
  const NextPageIcon = isRTL ? ChevronsLeft : ChevronsRight;

  return (
    <View
      className="items-center justify-center gap-2 px-2 py-2"
      style={{
        flexDirection: isRTL ? "row-reverse" : "row",
        flexWrap: "wrap",
        backgroundColor: withThemeOpacity(themeSurface, 0.95),
      }}
    >
      <RailButton
        label={s.hifzHidePreviousAyah}
        caption={wide ? s.revealRailHide : undefined}
        disabled={!canHidePrevious}
        tone="negative"
        onPress={onHidePrevious}
      >
        <EyeOff size={21} color={red} strokeWidth={2.1} />
      </RailButton>

      {pageComplete ? (
        <View
          accessibilityLiveRegion="polite"
          className="items-center gap-2"
          style={{ flexDirection: isRTL ? "row-reverse" : "row", flexWrap: "wrap", justifyContent: "center" }}
        >
          <Text
            className="px-1 text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}
          >
            {s.revealPageDone}
          </Text>
          <Pressable
            onPress={onRepeatPage}
            accessibilityRole="button"
            accessibilityLabel={s.revealRepeatPage}
            className="h-11 items-center justify-center gap-1.5 rounded-full px-3"
            style={{
              flexDirection: isRTL ? "row-reverse" : "row",
              backgroundColor: withThemeOpacity(themeColors.surfaceHigh, 0.84),
            }}
          >
            <RotateCcw size={16} color={iconColor} />
            <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
              {s.revealRepeatPage}
            </Text>
          </Pressable>
          {onNextPage ? (
            <Pressable
              onPress={onNextPage}
              accessibilityRole="button"
              accessibilityLabel={s.revealNextPage}
              className="h-11 items-center justify-center gap-1.5 rounded-full bg-primary-accent px-3 dark:bg-primary-bright"
              style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 13, color: themeSurface }}>{s.revealNextPage}</Text>
              <NextPageIcon size={16} color={themeSurface} />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          <RailButton
            label={autoRunning ? s.hifzPauseAutoReveal : s.hifzContinueAutoReveal}
            tone={autoRunning ? "active" : "neutral"}
            onPress={autoRunning ? onStopAuto : onStartAuto}
          >
            {autoRunning
              ? <Pause size={20} color={teal} strokeWidth={2.2} />
              : <Play size={20} color={teal} strokeWidth={2.2} />}
          </RailButton>

          <View
            className="h-11 items-center justify-center gap-1 rounded-full px-1.5"
            accessibilityRole="adjustable"
            accessibilityLabel={s.hifzTimeBetweenWords}
            accessibilityValue={{ text: speedLabel }}
            style={{
              flexDirection: isRTL ? "row-reverse" : "row",
              backgroundColor: withThemeOpacity(themeColors.surfaceHigh, 0.84),
            }}
          >
            <RailButton
              label={s.hifzDecreaseSpeed}
              hint={canDecreaseSpeed ? undefined : s.revealSlowestSpeed}
              disabled={!canDecreaseSpeed}
              onPress={decreaseSpeed}
            >
              <Minus size={17} color={iconColor} strokeWidth={2.2} />
            </RailButton>
            <View
              className="min-w-16 items-center justify-center gap-1 px-1"
              style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              <Timer size={16} color={iconColor} strokeWidth={2.1} />
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_700Bold", fontSize: 12, fontVariant: ["tabular-nums"] }}
                numberOfLines={1}
              >
                {speedLabel}
              </Text>
            </View>
            <RailButton
              label={s.hifzIncreaseSpeed}
              hint={canIncreaseSpeed ? undefined : s.revealFastestSpeed}
              disabled={!canIncreaseSpeed}
              onPress={increaseSpeed}
            >
              <Plus size={17} color={iconColor} strokeWidth={2.2} />
            </RailButton>
          </View>

          <RailButton
            label={s.revealNextWord}
            disabled={!canRevealNext}
            tone="positive"
            onPress={onRevealNextWord}
          >
            <TextCursorInput size={20} color={teal} strokeWidth={2.1} />
          </RailButton>
        </>
      )}

      <RailButton
        label={s.hifzRevealNextAyah}
        caption={wide ? s.revealRailReveal : undefined}
        disabled={!canRevealNext}
        tone="positive"
        onPress={onRevealNext}
      >
        <Eye size={21} color={teal} strokeWidth={2.1} />
      </RailButton>
    </View>
  );
}
