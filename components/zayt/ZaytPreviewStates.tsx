import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { RotateCcw } from "lucide-react-native";

export function ZaytPreviewLoading({ label, isDark }: { label: string; isDark: boolean }) {
  return (
    <View className="flex-1 items-center justify-center gap-3">
      <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
      <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}>
        {label}
      </Text>
    </View>
  );
}

export function ZaytPreviewError({
  label,
  retryLabel,
  isDark,
  onRetry,
}: {
  label: string;
  retryLabel: string;
  isDark: boolean;
  onRetry: () => void;
}) {
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  return (
    <View className="flex-1 items-center justify-center gap-4 px-6">
      <Text
        accessibilityRole="alert"
        className="text-center text-warm-500 dark:text-neutral-400"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 19 }}
      >
        {label}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
        className="min-h-11 flex-row items-center gap-2 rounded-full bg-surface px-4 dark:bg-surface-dark"
        style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
      >
        <RotateCcw size={15} color={accent} />
        <Text
          className="text-primary-accent dark:text-primary-bright"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
        >
          {retryLabel}
        </Text>
      </Pressable>
    </View>
  );
}
