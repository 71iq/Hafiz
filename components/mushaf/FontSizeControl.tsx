import { View, Text, Pressable } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import { useSettings, FONT_SIZE_STEPS } from "@/lib/settings/context";

export function FontSizeControl() {
  const { fontSizeIndex, setFontSizeIndex } = useSettings();

  return (
    <View className="flex-row items-center gap-2">
      {/* Small A */}
      <Text className="text-xs text-warm-400 dark:text-neutral-500 font-semibold">
        A
      </Text>

      <Pressable
        onPress={() => setFontSizeIndex(fontSizeIndex - 1)}
        disabled={fontSizeIndex === 0}
        className="w-7 h-7 rounded-full bg-warm-100 dark:bg-neutral-800 items-center justify-center"
        style={{ opacity: fontSizeIndex === 0 ? 0.3 : 1 }}
      >
        <Minus size={12} className="text-warm-600 dark:text-neutral-300" />
      </Pressable>

      {/* Step dots */}
      <View className="flex-row items-center gap-1 px-1">
        {FONT_SIZE_STEPS.map((_, i) => (
          <View
            key={i}
            className={`rounded-full ${
              i === fontSizeIndex
                ? "w-2 h-2 bg-teal-500"
                : "w-1.5 h-1.5 bg-warm-300 dark:bg-neutral-600"
            }`}
          />
        ))}
      </View>

      <Pressable
        onPress={() => setFontSizeIndex(fontSizeIndex + 1)}
        disabled={fontSizeIndex === FONT_SIZE_STEPS.length - 1}
        className="w-7 h-7 rounded-full bg-warm-100 dark:bg-neutral-800 items-center justify-center"
        style={{ opacity: fontSizeIndex === FONT_SIZE_STEPS.length - 1 ? 0.3 : 1 }}
      >
        <Plus size={12} className="text-warm-600 dark:text-neutral-300" />
      </Pressable>

      {/* Large A */}
      <Text className="text-base text-warm-400 dark:text-neutral-500 font-semibold">
        A
      </Text>
    </View>
  );
}
