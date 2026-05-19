import type { ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Eye, EyeOff, Gauge, Minus, Pause, Play, Plus } from "lucide-react-native";
import {
  HIFZ_AUTO_DELAY_STEP_MS,
  MAX_HIFZ_AUTO_DELAY_MS,
  DEFAULT_HIFZ_AUTO_DELAY_MS,
  MIN_HIFZ_AUTO_DELAY_MS,
  useSettings,
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

function formatSpeed(ms: number, isRTL: boolean, template: string) {
  const speed = DEFAULT_HIFZ_AUTO_DELAY_MS / ms;
  const rounded = speed >= 1 ? Math.round(speed * 10) / 10 : Math.round(speed * 100) / 100;
  const label = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0$/, "");
  return interpolate(template, {
    speed: isRTL ? toArabicNumber(Number(label)) : label,
  });
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
  const { isDark } = useSettings();
  const backgroundColor =
    tone === "positive"
      ? isDark ? "rgba(45, 212, 191, 0.14)" : "rgba(13, 148, 136, 0.10)"
      : tone === "negative"
        ? isDark ? "rgba(248, 113, 113, 0.12)" : "rgba(254, 226, 226, 0.85)"
        : tone === "active"
          ? isDark ? "rgba(255,255,255,0.08)" : "rgba(255,248,241,0.90)"
          : isDark ? "rgba(38,38,38,0.84)" : "rgba(255,248,241,0.84)";

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
  } = useSettings();
  const iconColor = isDark ? "#d4d4d4" : "#4b4037";
  const teal = isDark ? "#2dd4bf" : "#0d9488";
  const red = isDark ? "#fca5a5" : "#dc2626";
  const speedLabel = formatSpeed(hifzAutoDelayMs, isRTL, s.focusSpeedValue);
  const canDecreaseSpeed = hifzAutoDelayMs < MAX_HIFZ_AUTO_DELAY_MS;
  const canIncreaseSpeed = hifzAutoDelayMs > MIN_HIFZ_AUTO_DELAY_MS;
  const decreaseSpeed = () => setHifzAutoDelayMs(hifzAutoDelayMs + HIFZ_AUTO_DELAY_STEP_MS);
  const increaseSpeed = () => setHifzAutoDelayMs(hifzAutoDelayMs - HIFZ_AUTO_DELAY_STEP_MS);

  return (
    <View
      className="items-center justify-center gap-2 px-2 py-2"
      style={{
        flexDirection: isRTL ? "row-reverse" : "row",
        backgroundColor: isDark ? "rgba(28,25,23,0.95)" : "rgba(255,248,241,0.95)",
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
          backgroundColor: isDark ? "rgba(38,38,38,0.84)" : "rgba(255,248,241,0.84)",
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
