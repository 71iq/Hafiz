import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronUp, Info } from "lucide-react-native";
import type { StudyMetricKey } from "@/lib/progress/metrics";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { textStartStyle } from "@/lib/ui/direction";
import { accentIconColor, mutedIconColor } from "@/lib/ui/theme-icons";

export type ProgressStatItem = { key: StudyMetricKey; value: string; label: string; help: string };

export function ProgressStats({
  primary,
  more,
  isLaptop,
}: {
  primary: ProgressStatItem[];
  more: ProgressStatItem[];
  isLaptop: boolean;
}) {
  const s = useStrings();
  const { isRTL, effectiveTheme } = useSettings();
  const [showMore, setShowMore] = useState(false);
  const [helpKey, setHelpKey] = useState<StudyMetricKey | null>(null);
  const items = showMore ? [...primary, ...more] : primary;
  const help = items.find((item) => item.key === helpKey) ?? null;
  const accent = accentIconColor(effectiveTheme);
  const Toggle = showMore ? ChevronUp : ChevronDown;
  const row = { direction: "ltr" as const, flexDirection: isRTL ? ("row-reverse" as const) : ("row" as const) };

  return (
    <View style={{ width: isLaptop ? 360 : "100%", paddingTop: isLaptop ? 34 : 0, gap: 12 }}>
      <View
        className="gap-3"
        style={{ ...row, flexWrap: "wrap", alignContent: "flex-start", justifyContent: "space-between" }}
      >
        {items.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={`${item.label}: ${item.value}`}
            accessibilityHint={item.help}
            accessibilityState={{ expanded: helpKey === item.key }}
            onPress={() => setHelpKey((current) => (current === item.key ? null : item.key))}
            className="rounded-2xl bg-surface-bright px-4 py-3 dark:bg-surface-dark-low"
            style={({ pressed }) => ({
              width: isLaptop ? 174 : "47%",
              minHeight: 74,
              justifyContent: "space-between",
              borderColor:
                helpKey === item.key
                  ? accent
                  : effectiveTheme === "dark" || effectiveTheme === "amoled"
                    ? "rgba(45, 212, 191, 0.16)"
                    : "rgba(13, 148, 136, 0.16)",
              borderWidth: 1,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View style={{ ...row, justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ width: 24, height: 3, borderRadius: 999, backgroundColor: accent, opacity: 0.82 }} />
              <Info size={12} color={mutedIconColor(effectiveTheme)} />
            </View>
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{
                fontFamily: "NotoSerif_700Bold",
                fontSize: 18,
                ...textStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
                fontVariant: ["tabular-nums"],
              }}
            >
              {item.value}
            </Text>
            <Text
              className="mt-1 text-warm-700 dark:text-neutral-400"
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 11,
                lineHeight: 15,
                ...textStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {help ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-warm-700 dark:text-neutral-300"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL) }}
        >
          {`${help.label}: ${help.help}`}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showMore }}
        onPress={() => {
          setShowMore((value) => !value);
          setHelpKey(null);
        }}
        className="rounded-full px-3"
        style={({ pressed }) => ({
          ...row,
          minHeight: 44,
          alignSelf: isRTL ? "flex-end" : "flex-start",
          alignItems: "center",
          gap: 6,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Text className="text-primary dark:text-primary-bright" style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}>
          {showMore ? s.progressFewerStats : s.progressMoreStats}
        </Text>
        <Toggle size={15} color={accent} />
      </Pressable>
    </View>
  );
}
