import { View, Text } from "react-native";
import { useStrings } from "@/lib/i18n/useStrings";

export function QiraatTab() {
  const s = useStrings();
  return (
    <View className="py-10 items-center px-4">
      <Text className="text-3xl mb-4">{"📖"}</Text>
      <Text className="text-base font-semibold text-charcoal dark:text-neutral-200 mb-2 text-center">
        {s.comingSoon}
      </Text>
      <Text
        className="text-lg text-warm-500 dark:text-neutral-400 text-center"
        style={{ writingDirection: "rtl" }}
      >
        بإذن الله
      </Text>
    </View>
  );
}
