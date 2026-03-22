import { View, Text, Pressable } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import { useSettings, FONT_SIZE_STEPS } from "@/lib/settings/context";

export function FontSizeControl() {
  const { fontSizeIndex, setFontSizeIndex, isDark } = useSettings();

  const iconColor = isDark ? "#d4d4d4" : "#6e5a47";
  const mutedColor = isDark ? "#525252" : "#DFD9D1";

  return (
    <View className="flex-row items-center gap-2">
      <Text
        className="text-warm-400 dark:text-neutral-500"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10 }}
      >
        A
      </Text>

      <Pressable
        onPress={() => setFontSizeIndex(fontSizeIndex - 1)}
        disabled={fontSizeIndex === 0}
        className="w-7 h-7 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
        style={{ opacity: fontSizeIndex === 0 ? 0.3 : 1 }}
      >
        <Minus size={12} color={iconColor} />
      </Pressable>

      {/* Step dots */}
      <View className="flex-row items-center gap-1 px-1">
        {FONT_SIZE_STEPS.map((_, i) => (
          <View
            key={i}
            className={`rounded-full ${
              i === fontSizeIndex
                ? "w-2 h-2 bg-primary-accent"
                : i < fontSizeIndex
                  ? "w-1.5 h-1.5 bg-primary-accent/40"
                  : "w-1.5 h-1.5 bg-surface-high dark:bg-surface-dark-high"
            }`}
          />
        ))}
      </View>

      <Pressable
        onPress={() => setFontSizeIndex(fontSizeIndex + 1)}
        disabled={fontSizeIndex === FONT_SIZE_STEPS.length - 1}
        className="w-7 h-7 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
        style={{ opacity: fontSizeIndex === FONT_SIZE_STEPS.length - 1 ? 0.3 : 1 }}
      >
        <Plus size={12} color={iconColor} />
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
