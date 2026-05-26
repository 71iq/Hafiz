import type { ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Eye, EyeOff, Gauge, Minus, Pause, Play, Plus } from "lucide-react-native";
import {
  MAX_HIFZ_AUTO_DELAY_MS,
  DEFAULT_HIFZ_AUTO_DELAY_MS,
  MIN_HIFZ_AUTO_DELAY_MS,
  useSettings,
  withThemeOpacity,
} from "@/lib/settings/context";
import { toArabicNumber } from "@/lib/arabic";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";

type Props = {
  canRevealNext: boolean;
  canHidePrevious: boolean;
  autoRunning: boolean;
  onRevealNext: () => void;
  onHidePrevious: () => void;
  onStartAuto: () => void;
  onStopAuto: () => void;
};

const HIFZ_AUTO_DELAY_OPTIONS_MS = [
  5000, 4750, 4500, 4250, 4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250, 1000, 750, 500, 333, 250,
] as const;

function formatSpeed(ms: number, isRTL: boolean, template: string) {
  const speed = DEFAULT_HIFZ_AUTO_DELAY_MS / ms;
  const rounded = speed >= 1 ? Math.round(speed * 10) / 10 : Math.round(speed * 100) / 100;
  const label = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0$/, "");
  return interpolate(template, {
    speed: isRTL ? toArabicNumber(Number(label)) : label,
  });
}

function getNextFasterDelay(ms: number) {
  return HIFZ_AUTO_DELAY_OPTIONS_MS.find((option) => option < ms) ?? MIN_HIFZ_AUTO_DELAY_MS;
}

function getNextSlowerDelay(ms: number) {
  return [...HIFZ_AUTO_DELAY_OPTIONS_MS].reverse().find((option) => option > ms) ?? MAX_HIFZ_AUTO_DELAY_MS;
}

function RailButton({
  children,
  disabled,
  label,
  tone = "neutral",
  onPress,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
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
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
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
  );
}

export function HifzControls({
  canRevealNext,
  canHidePrevious,
  autoRunning,
  onRevealNext,
  onHidePrevious,
  onStartAuto,
  onStopAuto,
}: Props) {
  const s = useStrings();
  const {
    hifzAutoDelayMs,
    setHifzAutoDelayMs,
    isDark,
    isRTL,
    themeColors,
    themeSurface,
  } = useSettings();
  const iconColor = isDark ? "#d4d4d4" : "#4b4037";
  const teal = isDark ? "#2dd4bf" : "#0d9488";
  const red = isDark ? "#fca5a5" : "#dc2626";
  const speedLabel = formatSpeed(hifzAutoDelayMs, isRTL, s.focusSpeedValue);
  const canDecreaseSpeed = hifzAutoDelayMs < MAX_HIFZ_AUTO_DELAY_MS;
  const canIncreaseSpeed = hifzAutoDelayMs > MIN_HIFZ_AUTO_DELAY_MS;
  const decreaseSpeed = () => setHifzAutoDelayMs(getNextSlowerDelay(hifzAutoDelayMs));
  const increaseSpeed = () => setHifzAutoDelayMs(getNextFasterDelay(hifzAutoDelayMs));

  return (
    <View
      className="items-center justify-center gap-2 px-2 py-2"
      style={{
        flexDirection: isRTL ? "row-reverse" : "row",
        backgroundColor: withThemeOpacity(themeSurface, 0.95),
      }}
    >
      <RailButton
        label={s.hifzHidePreviousAyah}
        disabled={!canHidePrevious}
        tone="negative"
        onPress={onHidePrevious}
      >
        <EyeOff size={21} color={red} strokeWidth={2.1} />
      </RailButton>

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
        accessibilityLabel={s.hifzSpeedSeconds}
        style={{
          flexDirection: isRTL ? "row-reverse" : "row",
          backgroundColor: withThemeOpacity(themeColors.surfaceHigh, 0.84),
        }}
      >
        <RailButton
          label={s.hifzDecreaseSpeed}
          disabled={!canDecreaseSpeed}
          onPress={decreaseSpeed}
        >
          <Minus size={17} color={iconColor} strokeWidth={2.2} />
        </RailButton>
        <View
          className="min-w-16 items-center justify-center gap-1 px-1"
          style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
        >
          <Gauge size={17} color={iconColor} strokeWidth={2.1} />
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
          disabled={!canIncreaseSpeed}
          onPress={increaseSpeed}
        >
          <Plus size={17} color={iconColor} strokeWidth={2.2} />
        </RailButton>
      </View>

      <RailButton
        label={s.hifzRevealNextAyah}
        disabled={!canRevealNext}
        tone="positive"
        onPress={onRevealNext}
      >
        <Eye size={21} color={teal} strokeWidth={2.1} />
      </RailButton>
    </View>
  );
}
