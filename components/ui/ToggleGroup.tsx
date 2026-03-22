import { View, Pressable, Text, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";
import { forwardRef } from "react";

type ToggleGroupProps<T extends string> = ViewProps & {
  value: T;
  onValueChange: (value: T) => void;
  items: { value: T; label: string; icon?: React.ReactNode }[];
};

/**
 * Segmented toggle group with pill selection indicator.
 * Uses tonal shift for active state (no borders per DESIGN.md).
 */
export function ToggleGroup<T extends string>({
  value,
  onValueChange,
  items,
  className,
  ...props
}: ToggleGroupProps<T>) {
  return (
    <View
      className={cn(
        "flex-row rounded-full bg-surface-high dark:bg-surface-dark-high p-1",
        className
      )}
      {...props}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Pressable
            key={item.value}
            onPress={() => onValueChange(item.value)}
            className={cn(
              "flex-1 flex-row items-center justify-center rounded-full py-2 px-3",
              active && "bg-surface-bright dark:bg-surface-dark-bright"
            )}
            style={({ pressed }) => ({
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
            {item.icon}
            <Text
              className={cn(
                "font-manrope-semibold text-sm text-center",
                active
                  ? "text-primary-accent dark:text-primary-bright"
                  : "text-warm-400 dark:text-neutral-500",
                item.icon ? "ml-1.5" : ""
              )}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
