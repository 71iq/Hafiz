import { LogIn } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { textStartStyle } from "@/lib/ui/direction";

export type AccountSyncPromptProps = {
  label: string;
  buttonLabel: string;
  isDark: boolean;
  isRTL: boolean;
  onPress: () => void;
};

/**
 * A secondary sign-in prompt: plain text with an outline Log In button, so it reads below the
 * progress it sits beside. The caller provides the light teal card.
 */
export function AccountSyncPrompt({ label, buttonLabel, isDark, isRTL, onPress }: AccountSyncPromptProps) {
  const accent = isDark ? "#2dd4bf" : "#0f766e";
  return (
    <View
      className="items-center gap-3"
      style={{
        direction: "ltr",
        flexDirection: isRTL ? "row-reverse" : "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
      }}
    >
      <Text
        className="min-w-0 flex-1 text-charcoal dark:text-neutral-100"
        style={{
          minWidth: 180,
          fontFamily: "Manrope_500Medium",
          fontSize: 14,
          lineHeight: 20,
          ...textStartStyle(isRTL),
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={buttonLabel}
        onPress={onPress}
        className="rounded-full px-4"
        style={({ pressed }) => ({
          minHeight: 44,
          justifyContent: "center",
          borderWidth: 1.5,
          borderColor: accent,
          backgroundColor: "transparent",
          opacity: pressed ? 0.76 : 1,
        })}
      >
        <View
          className="flex-row items-center gap-2"
          style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
        >
          <LogIn size={15} color={accent} />
          <Text style={{ color: accent, fontFamily: "Manrope_700Bold", fontSize: 13 }}>{buttonLabel}</Text>
        </View>
      </Pressable>
    </View>
  );
}
