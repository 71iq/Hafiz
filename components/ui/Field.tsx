import { View, type ViewProps } from "react-native";
import { type ComponentProps } from "react";
import { Text } from "@/components/ui/Text";
import { useUIDirection, textAlignForDirection, type Direction } from "@/lib/ui/direction";
import { cn } from "@/lib/utils";

type FieldProps = ViewProps & {
  dir?: Direction;
};

type LabelProps = ComponentProps<typeof Text> & {
  dir?: Direction;
};

type FieldMessageProps = ComponentProps<typeof Text> & {
  dir?: Direction;
  tone?: "error" | "muted";
};

export function Field({ dir: explicitDir, className, style, ...props }: FieldProps) {
  const dir = useUIDirection(explicitDir);
  return (
    <View
      className={cn("gap-2", dir === "rtl" ? "items-end" : "items-start", className)}
      style={[{ direction: dir }, style]}
      {...props}
    />
  );
}

export function Label({ dir: explicitDir, className, style, ...props }: LabelProps) {
  const dir = useUIDirection(explicitDir);
  return (
    <Text
      dir={dir}
      variant="title-sm"
      className={cn("text-charcoal dark:text-neutral-300", className)}
      style={[{ textAlign: textAlignForDirection(dir), writingDirection: dir }, style]}
      {...props}
    />
  );
}

export function FieldMessage({
  dir: explicitDir,
  tone = "error",
  className,
  style,
  ...props
}: FieldMessageProps) {
  const dir = useUIDirection(explicitDir);
  return (
    <Text
      dir={dir}
      variant="caption"
      className={cn(tone === "error" ? "text-red-500" : "text-warm-500 dark:text-neutral-400", className)}
      style={[{ textAlign: textAlignForDirection(dir), writingDirection: dir }, style]}
      {...props}
    />
  );
}
