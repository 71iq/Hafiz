import { useCallback, useEffect, useRef } from "react";
import { Animated, Text } from "react-native";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";

type Props = {
  message: string | null;
  onDismiss: () => void;
  duration?: number;
  announce?: boolean;
};

type Phase = {
  target: 0 | 1;
  deadline: number;
};

export function Toast({ message, onDismiss, duration = 2000, announce = false }: Props) {
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
        accessibilityRole={announce ? "alert" : undefined}
        accessibilityLiveRegion={announce ? "polite" : undefined}
        style={{
          backgroundColor: "#003638",
          color: "#fff",
          fontFamily: "Manrope_600SemiBold",
          fontSize: 13,
          paddingHorizontal: 20,
          paddingVertical: 10,
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        {message}
      </Text>
    </Animated.View>
  );
}
