import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
import { hasOpenOverlay } from "@/components/ui/ResponsiveOverlay";
import { useFocusKeepAwake } from "./focus-keep-awake";

/** At speed 1 one page scrolls by in this many seconds; PageMushaf scales its pace by the speed. */
export const FOCUS_BASE_SECONDS_PER_PAGE = 90;
const SPEED_STEP = 0.1;

type Props = {
  playing: boolean;
  speed: number;
  onPlayPause: () => void;
  onSpeedChange: (speed: number) => void;
  onExit: () => void;
  /** Focus mode is on. The controls, the keyboard keys and the screen-awake lease follow it. */
  visible: boolean;
  /** Idle while playing: the bar shrinks to one Pause pill. */
  collapsed?: boolean;
};

function stopTouch(event: { stopPropagation?: () => void }) {
  event.stopPropagation?.();
}

const NATIVE_STOP_TOUCH = { onTouchStart: stopTouch, onTouchMove: stopTouch, onTouchEnd: stopTouch };

/** "1.5" in English, "١٫٥" in Arabic. */
function formatDecimal(value: number, isRTL: boolean): string {
  const text = String(Math.round(value * 10) / 10);
  return isRTL ? toArabicNumber(Number(text.split(".")[0])) + (text.includes(".") ? `٫${toArabicNumber(Number(text.split(".")[1]))}` : "") : text;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable === true;
}

function isActivatableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute?.("role");
  return tag === "button" || tag === "a" || role === "button" || role === "switch" || role === "slider" || role === "link";
}

/**
 * While focus mode is on and no overlay or text field has the keys, Space plays or pauses the
 * scrolling and Escape leaves focus mode (web).
 */
function useFocusModeKeys(active: boolean, onPlayPause: () => void, onExit: () => void) {
  const handlersRef = useRef({ onPlayPause, onExit });
  handlersRef.current = { onPlayPause, onExit };
  useEffect(() => {
    if (!active || Platform.OS !== "web" || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (hasOpenOverlay() || isEditableTarget(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        handlersRef.current.onExit();
        return;
      }
      if (event.key !== " " && event.key !== "Spacebar") return;
      if (isActivatableTarget(event.target)) return;
      event.preventDefault();
      if (!event.repeat) handlersRef.current.onPlayPause();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active]);
}

export function FocusModeControls({
  playing,
  speed,
  onPlayPause,
  onSpeedChange,
  onExit,
  visible,
  collapsed = false,
}: Props) {
  const { isDark, isRTL, themeSurface } = useSettings();
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const [trackWidth, setTrackWidth] = useState(0);
  useFocusKeepAwake(visible && playing);
  useFocusModeKeys(visible, onPlayPause, onExit);
  const clampedSpeed = Math.max(FOCUS_SCROLL_SPEED_MIN, Math.min(FOCUS_SCROLL_SPEED_MAX, speed));
  const progress = (clampedSpeed - FOCUS_SCROLL_SPEED_MIN) / (FOCUS_SCROLL_SPEED_MAX - FOCUS_SCROLL_SPEED_MIN);
  const speedText = interpolate(s.focusSpeedValue, {
    speed: isRTL ? toArabicNumber(Number(clampedSpeed.toFixed(1))) : clampedSpeed.toFixed(1),
  });
  const minutesText = interpolate(s.focusMinutesPerPage, {
    minutes: formatDecimal(FOCUS_BASE_SECONDS_PER_PAGE / clampedSpeed / 60, isRTL),
  });

  const commitSpeed = useCallback((value: number) => {
    const bounded = Math.max(FOCUS_SCROLL_SPEED_MIN, Math.min(FOCUS_SCROLL_SPEED_MAX, value));
    onSpeedChange(Math.round(bounded * 10) / 10);
  }, [onSpeedChange]);

  const commitSpeedFromX = useCallback(
    (x: number) => {
      if (trackWidth <= 0) return;
      // The fast end sits at the row's end: the right in English, the left in Arabic.
      const position = Math.max(0, Math.min(1, x / trackWidth));
      const ratio = isRTL ? 1 - position : position;
      const next = FOCUS_SCROLL_SPEED_MIN + ratio * (FOCUS_SCROLL_SPEED_MAX - FOCUS_SCROLL_SPEED_MIN);
      commitSpeed(next);
    },
    [commitSpeed, isRTL, trackWidth]
  );

  function onSpeedKeyDown(event: ReactKeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    let next: number;
    switch (event.key) {
      case "ArrowUp":
      case isRTL ? "ArrowLeft" : "ArrowRight":
        next = clampedSpeed + SPEED_STEP;
        break;
      case "ArrowDown":
      case isRTL ? "ArrowRight" : "ArrowLeft":
        next = clampedSpeed - SPEED_STEP;
        break;
      case "Home":
        next = FOCUS_SCROLL_SPEED_MIN;
        break;
      case "End":
        next = FOCUS_SCROLL_SPEED_MAX;
        break;
      default:
        return;
    }
    // These arrows belong to the slider while focused. The reader also uses them to turn pages.
    event.preventDefault();
    commitSpeed(next);
  }

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
  const stopProps =
    Platform.OS === "web"
      ? ({ "data-focus-mode-controls": "true" } as Record<string, unknown>)
      : NATIVE_STOP_TOUCH;

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
      {collapsed && playing ? (
        // Idle while scrolling: one persistent Pause pill, so pausing is always one tap away.
        <Pressable
          {...stopProps}
          onPress={onPlayPause}
          accessibilityRole="button"
          accessibilityLabel={s.pauseAutoScroll}
          className="h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-primary-accent dark:bg-primary-bright"
        >
          <Pause size={18} color={themeSurface} />
        </Pressable>
      ) : (
        <View
          // The reader's tap layer pauses focus mode on touch end. On web it skips this bar by its data
          // attribute; native touches bubbled up and paused right after Play resumed, so they stop here.
          {...stopProps}
          className="rounded-full border border-white/15 px-3 py-2"
          style={{
            width: "100%",
            maxWidth: 520,
            // Hand-mirrored row: pin LTR so the RTL reader root does not flip it back.
            direction: "ltr",
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
            className="h-11 w-11 items-center justify-center rounded-full bg-primary-accent dark:bg-primary-bright"
          >
            {playing ? <Pause size={18} color={themeSurface} /> : <Play size={18} color={themeSurface} />}
          </Pressable>

          <View className="flex-1 gap-1">
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
                {playing ? s.autoScrollSpeed : `${s.autoScrollSpeed} · ${s.focusPaused}`}
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
              aria-valuetext={`${speedText}, ${minutesText}`}
              {...(Platform.OS === "web" && {
                tabIndex: 0 as const,
                "aria-valuemin": FOCUS_SCROLL_SPEED_MIN,
                "aria-valuemax": FOCUS_SCROLL_SPEED_MAX,
                "aria-valuenow": clampedSpeed,
                onKeyDown: onSpeedKeyDown,
              })}
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              onAccessibilityAction={(event) => {
                const delta = event.nativeEvent.actionName === "increment" ? SPEED_STEP : -SPEED_STEP;
                commitSpeed(clampedSpeed + delta);
              }}
              style={{ direction: "ltr" }}
            >
              <View className="h-1.5 rounded-full" style={{ backgroundColor: trackColor }}>
                <View
                  className="h-1.5 rounded-full bg-primary-accent dark:bg-primary-bright"
                  style={{ width: `${progress * 100}%`, alignSelf: isRTL ? "flex-end" : "flex-start" }}
                />
              </View>
              <View
                className="absolute h-4 w-4 rounded-full border-2 border-surface dark:border-surface-dark bg-primary-accent dark:bg-primary-bright"
                style={
                  isRTL
                    ? { right: `${progress * 100}%`, marginRight: -8 }
                    : { left: `${progress * 100}%`, marginLeft: -8 }
                }
              />
            </View>
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 11, textAlign: isRTL ? "right" : "left" }}
              numberOfLines={1}
            >
              {minutesText}
            </Text>
          </View>

          <Pressable
            onPress={onExit}
            accessibilityRole="button"
            accessibilityLabel={s.exitFocusMode}
            className="h-11 w-11 items-center justify-center rounded-full bg-surface-high dark:bg-surface-dark-high"
          >
            <X size={18} color={mutedColor} />
          </Pressable>
        </View>
      )}
    </View>
  );
}
