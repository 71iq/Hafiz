import { View, type ViewProps } from "react-native";
import { cn } from "../../lib/utils";

interface ProgressProps extends ViewProps {
  value: number; // 0-100
  className?: string;
  indicatorClassName?: string;
}

export function Progress({
  value,
  className,
  indicatorClassName,
  ...props
}: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <View
      className={cn("h-1.5 bg-muted rounded-full overflow-hidden", className)}
      {...props}
    >
      <View
        className={cn("h-full bg-primary rounded-full", indicatorClassName)}
        style={{ width: `${clamped}%` }}
      />
    </View>
  );
}
