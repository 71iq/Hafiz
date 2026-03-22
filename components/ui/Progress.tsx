import { View, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";
import { forwardRef } from "react";

type ProgressProps = ViewProps & {
  value: number; // 0-100
};

/**
 * Hairline progress bar (2px stroke) per DESIGN.md.
 * Track uses outline-variant at 15% opacity, fill uses primary accent.
 */
export const Progress = forwardRef<View, ProgressProps>(
  ({ value, className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn("h-0.5 w-full rounded-full overflow-hidden", className)}
      style={{ backgroundColor: "rgba(223, 217, 209, 0.15)" }}
      {...props}
    >
      <View
        className="h-full rounded-full bg-primary-accent"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </View>
  )
);

Progress.displayName = "Progress";
