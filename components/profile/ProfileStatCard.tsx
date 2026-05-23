import { Text, View, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";

type ProfileStatCardProps = ViewProps & {
  value: string;
  label: string;
  isDark: boolean;
  isRTL: boolean;
  valueSize?: number;
};

export function ProfileStatCard({
  value,
  label,
  isDark,
  isRTL,
  valueSize = 22,
  className,
  style,
  ...props
}: ProfileStatCardProps) {
  const textAlign = isRTL ? "right" : "left";
  const writingDirection = isRTL ? "rtl" : "ltr";

  return (
    <View
      className={cn("rounded-2xl px-4 py-3", className)}
      style={[
        {
          minHeight: 74,
          justifyContent: "space-between",
          backgroundColor: isDark ? "#141414" : "#FFF8F1",
          borderColor: isDark ? "rgba(45, 212, 191, 0.16)" : "rgba(13, 148, 136, 0.16)",
          borderWidth: 1,
        },
        style,
      ]}
      {...props}
    >
      <View
        style={{
          alignSelf: isRTL ? "flex-end" : "flex-start",
          width: 24,
          height: 3,
          borderRadius: 999,
          backgroundColor: isDark ? "#2dd4bf" : "#0d9488",
          opacity: 0.82,
        }}
      />
      <Text
        className="text-charcoal dark:text-neutral-100"
        style={{
          fontFamily: "NotoSerif_700Bold",
          fontSize: valueSize,
          textAlign,
          writingDirection,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
      <Text
        className="mt-1 text-warm-400 dark:text-neutral-500"
        style={{
          fontFamily: "Manrope_500Medium",
          fontSize: 10,
          lineHeight: 13,
          textAlign,
          writingDirection,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
