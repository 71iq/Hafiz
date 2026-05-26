import { useCallback, useMemo, useState } from "react";
import { PanResponder, Pressable, Text, View, Platform } from "react-native";
import { Pause, Play, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  FOCUS_SCROLL_SPEED_MAX,
  FOCUS_SCROLL_SPEED_MIN,
  useSettings,
  withThemeOpacity,
} from "@/lib/settings/context";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { toArabicNumber } from "@/lib/arabic";

type Props = {
  playing: boolean;
  speed: number;
  onPlayPause: () => void;
  onSpeedChange: (speed: number) => void;
  onExit: () => void;
  visible: boolean;
};

export function FocusModeControls({
  playing,
  speed,
  onPlayPause,
  onSpeedChange,
  onExit,
  visible,
}: Props) {
  const { isDark, isRTL, themeSurface } = useSettings();
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const [trackWidth, setTrackWidth] = useState(0);
  const clampedSpeed = Math.max(FOCUS_SCROLL_SPEED_MIN, Math.min(FOCUS_SCROLL_SPEED_MAX, speed));
  const progress = (clampedSpeed - FOCUS_SCROLL_SPEED_MIN) / (FOCUS_SCROLL_SPEED_MAX - FOCUS_SCROLL_SPEED_MIN);
  const speedText = interpolate(s.focusSpeedValue, {
    speed: isRTL ? toArabicNumber(Number(clampedSpeed.toFixed(1))) : clampedSpeed.toFixed(1),
  });

  const commitSpeedFromX = useCallback(
    (x: number) => {
      if (trackWidth <= 0) return;
      const ratio = Math.max(0, Math.min(1, x / trackWidth));
      const next = FOCUS_SCROLL_SPEED_MIN + ratio * (FOCUS_SCROLL_SPEED_MAX - FOCUS_SCROLL_SPEED_MIN);
      onSpeedChange(Math.round(next * 10) / 10);
    },
    [onSpeedChange, trackWidth]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          commitSpeedFromX(event.nativeEvent.locationX ?? 0);
        },
        onPanResponderMove: (event) => {
          commitSpeedFromX(event.nativeEvent.locationX ?? 0);
        },
      }),
    [commitSpeedFromX]
  );

  if (!visible) return null;

  const mutedColor = isDark ? "#a3a3a3" : "#8B8178";
  const controlSurface = withThemeOpacity(themeSurface, 0.92);
  const trackColor = isDark ? "rgba(255,255,255,0.14)" : "rgba(45,45,45,0.12)";

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: Platform.OS === "web" ? ("fixed" as any) : "absolute",
        left: 12,
        right: 12,
        bottom: Math.max(insets.bottom, 12) + 8,
        zIndex: 90,
        alignItems: "center",
      }}
    >
      <View
        {...(Platform.OS === "web"
          ? ({ "data-focus-mode-controls": "true" } as Record<string, unknown>)
          : null)}
        className="rounded-full border border-white/15 px-3 py-2"
        style={{
          width: "100%",
          maxWidth: 520,
          flexDirection: isRTL ? "row-reverse" : "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: controlSurface,
          ...(Platform.OS === "web"
            ? ({ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" } as any)
            : null),
        }}
      >
        <Pressable
          onPress={onPlayPause}
          accessibilityRole="button"
          accessibilityLabel={playing ? s.pauseAutoScroll : s.resumeAutoScroll}
          className="h-10 w-10 items-center justify-center rounded-full bg-primary"
        >
          {playing ? <Pause size={18} color="#FDDC91" /> : <Play size={18} color="#FDDC91" />}
        </Pressable>

        <View className="flex-1 gap-1.5">
          <View
            style={{
              flexDirection: isRTL ? "row-reverse" : "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
              numberOfLines={1}
            >
              {s.autoScrollSpeed}
            </Text>
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 12, fontVariant: ["tabular-nums"] }}
              numberOfLines={1}
            >
              {speedText}
            </Text>
          </View>

          <View
            {...panResponder.panHandlers}
            onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
            className="h-5 justify-center"
            accessibilityRole="adjustable"
            accessibilityLabel={s.autoScrollSpeed}
            style={{ direction: "ltr" }}
          >
            <View className="h-1.5 rounded-full" style={{ backgroundColor: trackColor }}>
              <View
                className="h-1.5 rounded-full bg-primary-accent"
                style={{ width: `${progress * 100}%` }}
              />
            </View>
            <View
              className="absolute h-4 w-4 rounded-full border-2 border-surface dark:border-surface-dark bg-primary-accent"
              style={{
                left: `${progress * 100}%`,
                marginLeft: -8,
              }}
            />
          </View>
        </View>

        <Pressable
          onPress={onExit}
          accessibilityRole="button"
          accessibilityLabel={s.exitFocusMode}
          className="h-10 w-10 items-center justify-center rounded-full bg-surface-high dark:bg-surface-dark-high"
        >
          <X size={18} color={mutedColor} />
        </Pressable>
      </View>
    </View>
  );
}
