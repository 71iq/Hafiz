import { useCallback, useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Platform, Text } from "react-native";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";
import { useSettings, type ThemePalette } from "@/lib/settings/context";

type Props = {
  message: string | null;
  onDismiss: () => void;
  /** Explicit hold time. Omit it to use the shared reading-time rule (C03). */
  duration?: number;
  /**
   * Notices are announced politely, once. Pass false only when the control that triggered the
   * notice already announces the same text, so it is not read twice.
   */
  announce?: boolean;
};

/** Inverse-surface pill per theme: dark on the light themes, light on the dark ones (all above 12:1). */
export const TOAST_INVERSE_COLORS: Record<ThemePalette, { surface: string; text: string }> = {
  white: { surface: "#27272A", text: "#FFFFFF" },
  beige: { surface: "#3E342B", text: "#FFF8F1" },
  dark: { surface: "#F5F5F5", text: "#0A0A0A" },
  amoled: { surface: "#E5E5E5", text: "#000000" },
};

const NOTICE_BASE_MS = 2000;
const NOTICE_PER_WORD_MS = 60;
const NOTICE_MAX_MS = 6000;

/** C03: min(6000, 2000 + 60 * visible word count) of the displayed localized text. */
export function noticeDurationMs(message: string): number {
  const words = message.trim().split(/\s+/u).filter(Boolean).length;
  return Math.min(NOTICE_MAX_MS, NOTICE_BASE_MS + NOTICE_PER_WORD_MS * words);
}

type Phase = {
  target: 0 | 1;
  deadline: number;
};

export function Toast({ message, onDismiss, duration: explicitDuration, announce = true }: Props) {
  const { effectiveTheme } = useSettings();
  const inverse = TOAST_INVERSE_COLORS[effectiveTheme] ?? TOAST_INVERSE_COLORS.white;
  const duration = explicitDuration ?? (message ? noticeDurationMs(message) : NOTICE_BASE_MS);
  const opacity = useRef(new Animated.Value(0)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const latestReduceMotion = useRef(true);
  const phase = useRef<Phase | null>(null);
  const reduceMotion = useReducedMotionPreference();

  const updateOpacity = useCallback(
    (target: 0 | 1, remaining: number) => {
      animation.current?.stop();
      animation.current = null;

      if (latestReduceMotion.current || remaining <= 0) {
        opacity.setValue(target);
        return;
      }

      const nextAnimation = Animated.timing(opacity, {
        toValue: target,
        duration: Math.min(200, remaining),
        useNativeDriver: true,
      });
      animation.current = nextAnimation;
      nextAnimation.start();
    },
    [opacity],
  );

  useEffect(() => {
    latestReduceMotion.current = reduceMotion;
    const currentPhase = phase.current;
    if (!currentPhase) return;
    updateOpacity(currentPhase.target, Math.max(0, currentPhase.deadline - Date.now()));
  }, [reduceMotion, updateOpacity]);

  useEffect(() => {
    let active = true;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let tailTimer: ReturnType<typeof setTimeout> | undefined;

    if (message) {
      // Announce once, politely. Android and web use the live region below; iOS needs an explicit
      // announcement.
      if (announce && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
      phase.current = { target: 1, deadline: Date.now() + 200 };
      updateOpacity(1, 200);

      holdTimer = setTimeout(() => {
        if (!active) return;
        phase.current = { target: 0, deadline: Date.now() + 200 };
        updateOpacity(0, 200);
        tailTimer = setTimeout(() => {
          if (!active) return;
          active = false;
          onDismiss();
        }, 200);
      }, duration);
    } else {
      phase.current = null;
      updateOpacity(0, 0);
    }

    return () => {
      active = false;
      if (holdTimer !== undefined) clearTimeout(holdTimer);
      if (tailTimer !== undefined) clearTimeout(tailTimer);
      phase.current = null;
      animation.current?.stop();
      animation.current = null;
    };
    // announce is read once per message; changing it must not restart the timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, duration, onDismiss, updateOpacity]);

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 60,
        left: 0,
        right: 0,
        alignItems: "center",
        zIndex: 9999,
        opacity,
      }}
    >
      <Text
        accessibilityLiveRegion={announce ? "polite" : undefined}
        aria-live={announce ? "polite" : undefined}
        style={{
          backgroundColor: inverse.surface,
          color: inverse.text,
          fontFamily: "Manrope_600SemiBold",
          fontSize: 13,
          paddingHorizontal: 20,
          paddingVertical: 10,
          marginHorizontal: 16,
          maxWidth: 560,
          textAlign: "center",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        {message}
      </Text>
    </Animated.View>
  );
}
