import { View, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";
import { forwardRef } from "react";

/**
 * Ghost separator per DESIGN.md — outline-variant at 10% opacity.
 * Use sparingly; prefer background color shifts between sections.
 */
export const Separator = forwardRef<View, ViewProps & { vertical?: boolean }>(
  ({ vertical, className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        vertical ? "w-px self-stretch" : "h-px w-full",
        className
      )}
      style={{ backgroundColor: "rgba(223, 217, 209, 0.10)" }}
      {...props}
    />
  )
);

Separator.displayName = "Separator";
