import { View, Text, Pressable } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import { useSettings, FONT_SIZE_STEPS } from "@/lib/settings/context";
import { toArabicNumber } from "@/lib/arabic";

type Props = {
  disabled?: boolean;
};

export function FontSizeControl({ disabled = false }: Props) {
  const { fontSizeIndex, setFontSizeIndex, isDark, isRTL } = useSettings();

  const iconColor = isDark ? "#d4d4d4" : "#6e5a47";
  const disabledIconColor = isDark ? "#525252" : "#B8AEA3";
  const canDecrease = !disabled && fontSizeIndex > 0;
  const canIncrease = !disabled && fontSizeIndex < FONT_SIZE_STEPS.length - 1;
  const level = fontSizeIndex + 1;
  const levelLabel = isRTL ? toArabicNumber(level) : String(level);
  const totalLabel = isRTL ? toArabicNumber(FONT_SIZE_STEPS.length) : String(FONT_SIZE_STEPS.length);

  return (
    <View className="flex-row items-center gap-2" style={{ opacity: disabled ? 0.42 : 1 }}>
      <Text
        className="text-warm-400 dark:text-neutral-500"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10 }}
      >
        A
      </Text>

      <Pressable
        onPress={() => setFontSizeIndex(fontSizeIndex - 1)}
        disabled={!canDecrease}
        className="w-7 h-7 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
        style={{ opacity: canDecrease ? 1 : 0.3 }}
      >
        <Minus size={12} color={disabled ? disabledIconColor : iconColor} />
      </Pressable>

      <View className="min-w-12 rounded-full bg-surface-high dark:bg-surface-dark-high px-2.5 py-1 items-center">
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 11 }}
        >
          {levelLabel}/{totalLabel}
        </Text>
      </View>

      <Pressable
        onPress={() => setFontSizeIndex(fontSizeIndex + 1)}
        disabled={!canIncrease}
        className="w-7 h-7 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
        style={{ opacity: canIncrease ? 1 : 0.3 }}
      >
        <Plus size={12} color={disabled ? disabledIconColor : iconColor} />
      </Pressable>

      <Text
        className="text-warm-400 dark:text-neutral-500"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
      >
        A
      </Text>
    </View>
  );
}
