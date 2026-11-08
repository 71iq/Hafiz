import { LogIn } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

export type AccountSyncPromptProps = {
  label: string;
  buttonLabel: string;
  isDark: boolean;
  isRTL: boolean;
  onPress: () => void;
};

export function AccountSyncPrompt({ label, buttonLabel, isDark, isRTL, onPress }: AccountSyncPromptProps) {
  return (
    <View
      className="items-center gap-3"
      style={{
        direction: "ltr",
        flexDirection: isRTL ? "row-reverse" : "row",
        justifyContent: "space-between",
      }}
    >
      <Text
        className="min-w-0 flex-1 text-charcoal dark:text-neutral-100"
        style={{
          fontFamily: "Manrope_700Bold",
          fontSize: 14,
          lineHeight: 20,
          textAlign: isRTL ? "right" : "left",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={buttonLabel}
        onPress={onPress}
        className="rounded-full px-4 py-2.5"
        style={({ pressed }) => ({
          backgroundColor: isDark ? "#1B4D4F" : "#003638",
          opacity: pressed ? 0.76 : 1,
        })}
      >
        <View
          className="flex-row items-center gap-2"
          style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
        >
          <LogIn size={15} color="#FDDC91" />
          <Text style={{ color: "#FDDC91", fontFamily: "Manrope_700Bold", fontSize: 12 }}>{buttonLabel}</Text>
        </View>
      </Pressable>
    </View>
  );
}
