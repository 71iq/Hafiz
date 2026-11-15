import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { formatNumber } from "@/lib/i18n/count";
import type { AchievementCategory } from "@/lib/achievements/catalog";
import type { AchievementDashboardItem } from "@/lib/achievements/queries";
import { AchievementBadge } from "./AchievementBadge";
import { textStartStyle } from "@/lib/ui/direction";
import { mutedIconColor } from "@/lib/ui/theme-icons";

type Props = {
  items: AchievementDashboardItem[];
};

const CATEGORY_ORDER: AchievementCategory[] = [
  "reviews",
  "streaks",
  "completion",
  "notes",
  "reflections",
  "vocab",
  "mutashabih",
];

const JUZ_BADGE = /^juz_\d{2}_completed$/;

/** Read-only badge list. The 30 juz completion badges collapse into one row that expands. */
export function AchievementGrid({ items }: Props) {
  const s = useStrings();
  const { isRTL } = useSettings();

  return (
    <View className="gap-5">
      {CATEGORY_ORDER.map((category) => {
        const categoryItems = items.filter((item) => item.category === category);
        if (categoryItems.length === 0) return null;
        const juzItems = categoryItems.filter((item) => JUZ_BADGE.test(item.id));
        const otherItems = categoryItems.filter((item) => !JUZ_BADGE.test(item.id));
        return (
          <View key={category}>
            <Text
              accessibilityRole="header"
              className="mb-2 text-charcoal dark:text-neutral-200"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 13, ...textStartStyle(isRTL)}}
            >
              {s[`achievementCategory.${category}`] ?? category}
            </Text>
            <View className="gap-2">
              {otherItems.map((item) => (
                <AchievementBadge key={item.id} item={item} />
              ))}
              {juzItems.length > 0 ? <JuzCompletionGroup items={juzItems} /> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function JuzCompletionGroup({ items }: { items: AchievementDashboardItem[] }) {
  const s = useStrings();
  const { isRTL, uiLanguage, themeColors, effectiveTheme } = useSettings();
  const [expanded, setExpanded] = useState(false);
  const unlocked = items.filter((item) => item.unlockedAt).length;
  // A bidi isolate keeps Arabic "٣/٣٠" in order.
  const label = interpolate(s.achievementJuzGroup, {
    n: `⁦${formatNumber(unlocked, uiLanguage)}`,
    total: `${formatNumber(items.length, uiLanguage)}⁩`,
  });
  const Chevron = expanded ? ChevronUp : ChevronDown;

  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={expanded ? s.achievementJuzGroupHide : s.achievementJuzGroupShow}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        className="rounded-2xl border px-3.5"
        style={({ pressed }) => ({
          minHeight: 48,
          direction: "ltr",
          flexDirection: isRTL ? "row-reverse" : "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          borderColor: themeColors.surfaceHigh,
          backgroundColor: themeColors.surface,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Text
          className="flex-1 text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 13, ...textStartStyle(isRTL) }}
        >
          {label}
        </Text>
        <Chevron size={16} color={mutedIconColor(effectiveTheme)} />
      </Pressable>
      {expanded ? items.map((item) => <AchievementBadge key={item.id} item={item} />) : null}
    </View>
  );
}
