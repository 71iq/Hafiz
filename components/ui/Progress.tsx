import { View, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";
import { forwardRef } from "react";
import { useUIDirection, type Direction } from "@/lib/ui/direction";

type ProgressProps = ViewProps & {
  value: number; // 0-100
  dir?: Direction;
};

/**
 * Hairline progress bar (2px stroke) per DESIGN.md.
 * Track uses outline-variant at 15% opacity, fill uses primary accent.
 */
export const Progress = forwardRef<View, ProgressProps>(
  ({ value, className, dir: explicitDir, style, ...props }, ref) => {
    const dir = useUIDirection(explicitDir);
    return (
      <View
        ref={ref}
        className={cn("h-0.5 w-full rounded-full overflow-hidden", className)}
        style={[
          {
            alignItems: dir === "rtl" ? "flex-end" : "flex-start",
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
  }
);

Progress.displayName = "Progress";
