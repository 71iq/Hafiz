import { Text, View } from "react-native";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import type { AchievementCategory } from "@/lib/achievements/catalog";
import type { AchievementDashboardItem } from "@/lib/achievements/queries";
import { AchievementBadge } from "./AchievementBadge";

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
];

export function AchievementGrid({ items }: Props) {
  const s = useStrings();
  const { isRTL } = useSettings();

  return (
    <View className="gap-5">
      {CATEGORY_ORDER.map((category) => {
        const categoryItems = items.filter((item) => item.category === category);
        if (categoryItems.length === 0) return null;
        return (
          <View key={category}>
            <Text
              className="mb-2 text-charcoal dark:text-neutral-200"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 13, textAlign: isRTL ? "right" : "left" }}
            >
              {s[`achievementCategory.${category}`] ?? category}
            </Text>
            <View className="gap-2">
              {categoryItems.map((item) => (
                <AchievementBadge key={item.id} item={item} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
