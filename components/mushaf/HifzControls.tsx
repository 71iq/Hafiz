import { useState } from "react";
import type { ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Clock3, Minus, Plus } from "lucide-react-native";
import { Switch } from "@/components/ui/Switch";
import {
  OverlayBody,
  OverlayFooter,
  OverlayHeader,
  ResponsiveSheet,
} from "@/components/ui/ResponsiveOverlay";
import {
  HIFZ_AUTO_DELAY_STEP_MS,
  MAX_HIFZ_AUTO_DELAY_MS,
  MIN_HIFZ_AUTO_DELAY_MS,
  useSettings,
} from "@/lib/settings/context";
import { toArabicNumber } from "@/lib/arabic";
import { useStrings } from "@/lib/i18n/useStrings";

type Props = {
  canRevealNext: boolean;
  canHidePrevious: boolean;
  autoRunning: boolean;
  onRevealNext: () => void;
  onHidePrevious: () => void;
  onStartAuto: () => void;
  onStopAuto: () => void;
};

function formatSeconds(ms: number, isRTL: boolean) {
  const seconds = ms / 1000;
  const label = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(2).replace(/0$/, "");
  return isRTL ? toArabicNumber(Number(label)) : label;
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
      className="h-11 min-w-16 items-center justify-center rounded-full px-4"
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
    hifzAutoAdvancePage,
    setHifzAutoAdvancePage,
    isDark,
    isRTL,
  } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const iconColor = isDark ? "#d4d4d4" : "#4b4037";
  const teal = isDark ? "#2dd4bf" : "#0d9488";
  const red = isDark ? "#fca5a5" : "#dc2626";
  const speedLabel = formatSeconds(hifzAutoDelayMs, isRTL);
  const canDecreaseSpeed = hifzAutoDelayMs > MIN_HIFZ_AUTO_DELAY_MS;
  const canIncreaseSpeed = hifzAutoDelayMs < MAX_HIFZ_AUTO_DELAY_MS;

  return (
    <>
      <View
        className="items-center justify-center gap-3 px-3 py-2"
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
          <Minus size={21} color={red} strokeWidth={2.2} />
        </RailButton>
        <RailButton
          label={s.hifzAutoReveal}
          tone={autoRunning ? "active" : "neutral"}
          onPress={() => setSettingsOpen(true)}
        >
          <Clock3 size={21} color={autoRunning ? teal : iconColor} strokeWidth={2.1} />
        </RailButton>
        <RailButton
          label={s.hifzRevealNextAyah}
          disabled={!canRevealNext}
          tone="positive"
          onPress={onRevealNext}
        >
          <Plus size={23} color={teal} strokeWidth={2.2} />
        </RailButton>
      </View>

      <ResponsiveSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        maxWidth={560}
        maxHeight={420}
      >
        <OverlayHeader
          title={s.hifzAutoReveal}
          onClose={() => setSettingsOpen(false)}
          showHandle
          isRTL={isRTL}
        />
        <OverlayBody scrollEnabled={false} className="px-5 py-5">
          <View className="gap-5">
            <View
              className="items-center justify-between gap-4"
              style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              <View className={isRTL ? "items-end" : "items-start"}>
                <Text
                  className="text-charcoal dark:text-neutral-100"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, textAlign: isRTL ? "right" : "left" }}
                >
                  {s.hifzSpeedSeconds}
                </Text>
                <Text
                  className="mt-1 text-warm-500 dark:text-neutral-400"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 13, textAlign: isRTL ? "right" : "left" }}
                >
                  {s.hifzTimeBetweenWords}
                </Text>
              </View>

              <View
                className="items-center gap-2"
                style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
              >
                <RailButton
                  label={s.hifzHidePreviousAyah}
                  disabled={!canDecreaseSpeed}
                  onPress={() => setHifzAutoDelayMs(hifzAutoDelayMs - HIFZ_AUTO_DELAY_STEP_MS)}
                >
                  <Minus size={18} color={iconColor} />
                </RailButton>
                <View className="min-w-16 items-center rounded-xl bg-surface-mid px-3 py-2 dark:bg-surface-dark-mid">
                  <Text
                    className="text-charcoal dark:text-neutral-100"
                    style={{ fontFamily: "Manrope_700Bold", fontSize: 14, fontVariant: ["tabular-nums"] }}
                  >
                    {speedLabel}
                  </Text>
                </View>
                <RailButton
                  label={s.hifzRevealNextAyah}
                  disabled={!canIncreaseSpeed}
                  onPress={() => setHifzAutoDelayMs(hifzAutoDelayMs + HIFZ_AUTO_DELAY_STEP_MS)}
                >
                  <Plus size={18} color={iconColor} />
                </RailButton>
              </View>
            </View>

            <View
              className="items-center justify-between gap-4"
              style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
            >
              <Text
                className="flex-1 text-charcoal dark:text-neutral-100"
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: 15,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.hifzAutoNextPage}
              </Text>
              <Switch value={hifzAutoAdvancePage} onValueChange={setHifzAutoAdvancePage} />
            </View>
          </View>
        </OverlayBody>
        <OverlayFooter isRTL={isRTL}>
          <Pressable
            onPress={() => {
              if (autoRunning) onStopAuto();
              else onStartAuto();
              setSettingsOpen(false);
            }}
            className="flex-1 items-center rounded-xl bg-primary-accent py-3 dark:bg-primary-bright"
            style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
          >
            <Text
              className="text-white"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }}
            >
              {autoRunning ? s.hifzStop : s.hifzStart}
            </Text>
          </Pressable>
        </OverlayFooter>
      </ResponsiveSheet>
    </>
  );
}
