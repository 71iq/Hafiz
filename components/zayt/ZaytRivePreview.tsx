import { Text, View } from "react-native";
import type { ZaytRivePreviewProps } from "./types";

export function ZaytRivePreview({ errorLabel }: ZaytRivePreviewProps) {
  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text
        className="text-center text-warm-500 dark:text-neutral-400"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 19 }}
      >
        {errorLabel}
      </Text>
    </View>
  );
}
