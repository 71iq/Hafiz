import { View, Text, Pressable } from "react-native";
import { ChevronLeft, ChevronRight, ExternalLink, type LucideIcon } from "lucide-react-native";
import { useSettings } from "@/lib/settings/context";
import { textStartStyle } from "@/lib/ui/direction";

export function SettingsLinkRow({
  icon: Icon,
  title,
  description,
  onPress,
  isDark,
  isRTL,
  external,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Without onPress the row is information only. */
  onPress?: () => void;
  isDark: boolean;
  isRTL: boolean;
  external?: boolean;
}) {
  const RowChevron = isRTL ? ChevronLeft : ChevronRight;
  const { themeColors } = useSettings();
  const iconColor = isDark ? "#2dd4bf" : "#0d9488";
  const chevronColor = isDark ? "#525252" : "#DFD9D1";

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? (external ? "link" : "button") : "text"}
      className={`min-h-11 items-center gap-3 rounded-2xl px-3 py-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
      style={({ pressed }) => ({
        backgroundColor: pressed ? themeColors.surfaceMid : "transparent",
        direction: "ltr",
        flexDirection: isRTL ? "row-reverse" : "row",
        opacity: pressed ? 0.86 : 1,
      })}
    >
      <View className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
        <Icon size={17} color={iconColor} />
      </View>
      <View className="min-w-0 flex-1">
        <Text
          className="text-charcoal dark:text-neutral-100"
          numberOfLines={1}
          style={{
            fontFamily: "Manrope_600SemiBold",
            fontSize: 14,
            lineHeight: 19,
            ...textStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {title}
        </Text>
        <Text
          className="mt-0.5 text-warm-400 dark:text-neutral-500"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 12,
            lineHeight: 16,
            ...textStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {description}
        </Text>
      </View>
      {onPress ? (
        <View className="h-6 w-6 shrink-0 items-center justify-center">
          {external ? <ExternalLink size={16} color={chevronColor} /> : <RowChevron size={18} color={chevronColor} />}
        </View>
      ) : null}
    </Pressable>
  );
}
