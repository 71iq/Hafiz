import { Pressable, Text, View } from "react-native";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";

export function QuranLoadError({ onRetry }: { onRetry: () => void }) {
  const s = useStrings();
  const { isRTL } = useSettings();
  return (
    <View accessibilityRole="alert" className="flex-1 items-center justify-center gap-3 px-6">
      <Text
        className="text-center text-warm-600 dark:text-neutral-300"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 15, writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {s.readerQuranLoadFailed}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        className="min-h-[44px] justify-center rounded-full bg-primary-accent/10 px-5 dark:bg-primary-bright/10"
      >
        <Text
          className="text-primary-accent dark:text-primary-bright"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
        >
          {s.mushafPageRetry}
        </Text>
      </Pressable>
    </View>
  );
}
