import { Platform, Pressable, Text, View, type ViewStyle } from "react-native";
import { Minus, Plus } from "lucide-react-native";

type Props = {
  variant: "pill" | "sheet";
  decrementLabel: string;
  incrementLabel: string;
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementDisabled: boolean;
  incrementDisabled: boolean;
  isDark: boolean;
  isRTL: boolean;
  compact?: boolean;
};

export function ReadingStepper({
  variant,
  decrementLabel,
  incrementLabel,
  value,
  onDecrement,
  onIncrement,
  decrementDisabled,
  incrementDisabled,
  isDark,
  isRTL,
  compact = false,
}: Props) {
  const isPill = variant === "pill";
  const iconColor = isDark ? "#d4d4d4" : isPill ? "#6e5a47" : "#6E6258";
  const iconSize = isPill && !compact ? 17 : 15;
  const buttonClassName = isPill
    ? "items-center justify-center rounded-full"
    : "h-8 w-8 items-center justify-center rounded-full";

  function buttonStyle(disabled: boolean, pressed: boolean): ViewStyle {
    if (isPill) {
      return {
        height: compact ? 30 : 36,
        opacity: disabled ? 0.35 : pressed ? 0.68 : 1,
        transform: [{ scale: pressed && !disabled ? 0.96 : 1 }],
        width: compact ? 30 : 36,
      };
    }
    return {
      opacity: disabled ? 0.35 : pressed ? 0.68 : 1,
      transform: [{ scale: pressed && !disabled ? 0.96 : 1 }],
      cursor: Platform.OS === "web" ? (disabled ? "auto" : "pointer") : undefined,
    };
  }

  return (
    <View
      className={
        isPill
          ? "self-start rounded-full bg-surface-high dark:bg-surface-dark-high p-1"
          : "rounded-lg border border-warm-200/40 bg-surface-low/60 p-0.5 dark:border-neutral-800 dark:bg-surface-dark-high/70"
      }
      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={decrementLabel}
        accessibilityState={{ disabled: decrementDisabled }}
        onPress={onDecrement}
        disabled={decrementDisabled}
        className={buttonClassName}
        style={({ pressed }) => buttonStyle(decrementDisabled, pressed)}
      >
        <Minus size={iconSize} color={iconColor} />
      </Pressable>
      <View
        className={
          isPill
            ? "items-center justify-center"
            : `${compact ? "min-w-11" : "min-w-12"} items-center justify-center px-1`
        }
        style={isPill ? { minWidth: compact ? 42 : 64, paddingHorizontal: compact ? 8 : 12 } : undefined}
      >
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={
            isPill
              ? { fontFamily: "Manrope_700Bold", fontSize: compact ? 13 : 14 }
              : { fontFamily: "Manrope_600SemiBold", fontSize: 12.5 }
          }
        >
          {value}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={incrementLabel}
        accessibilityState={{ disabled: incrementDisabled }}
        onPress={onIncrement}
        disabled={incrementDisabled}
        className={buttonClassName}
        style={({ pressed }) => buttonStyle(incrementDisabled, pressed)}
      >
        <Plus size={iconSize} color={iconColor} />
      </Pressable>
    </View>
  );
}
