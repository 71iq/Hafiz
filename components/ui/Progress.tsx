import { View, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";
import { forwardRef, useEffect, useRef, useState } from "react";
import { useUIDirection, type Direction } from "@/lib/ui/direction";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";

type ProgressProps = ViewProps & {
  value: number;
  dir?: Direction;
};

export const PROGRESS_EASE_MS = 250;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function useEasedProgress(target: number): number {
  const reduceMotion = useReducedMotionPreference();
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);

  useEffect(() => {
    const from = shownRef.current;
    if (reduceMotion || from === target || typeof requestAnimationFrame !== "function") {
      shownRef.current = target;
      setShown(target);
      return;
    }
    let frame: number | null = null;
    let start: number | null = null;
    const step = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / PROGRESS_EASE_MS);
      const next = from + (target - from) * easeOutCubic(t);
      shownRef.current = next;
      setShown(next);
      frame = t < 1 ? requestAnimationFrame(step) : null;
    };
    frame = requestAnimationFrame(step);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [target, reduceMotion]);

  return shown;
}

export const Progress = forwardRef<View, ProgressProps>(
  ({ value: target, className, dir: explicitDir, style, ...props }, ref) => {
    const dir = useUIDirection(explicitDir);
    const value = useEasedProgress(target);
    return (
      <View
        ref={ref}
        className={cn("h-0.5 w-full rounded-full overflow-hidden", className)}
        style={[
          {
            alignItems: dir === "rtl" ? "flex-end" : "flex-start",
            direction: "ltr",
            backgroundColor: "rgba(223, 217, 209, 0.15)",
          },
          style,
        ]}
        {...props}
      >
        <View
          className="h-full rounded-full bg-primary-accent"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </View>
    );
  },
);

Progress.displayName = "Progress";
