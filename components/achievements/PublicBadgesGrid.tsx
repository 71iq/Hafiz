import { Text, View } from "react-native";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { ACHIEVEMENTS } from "@/lib/achievements/catalog";
import type { AchievementUnlock } from "@/lib/achievements/types";
import type { AchievementDashboardItem } from "@/lib/achievements/queries";
import { AchievementBadge } from "./AchievementBadge";

type Props = {
  unlocks: AchievementUnlock[];
};

export function PublicBadgesGrid({ unlocks }: Props) {
  const s = useStrings();
  const { isRTL } = useSettings();
  const definitions = new Map(ACHIEVEMENTS.map((achievement) => [achievement.id, achievement]));
  const items = unlocks
    .map((unlock): AchievementDashboardItem | null => {
      const definition = definitions.get(unlock.achievementId);
      if (!definition || !definition.active) return null;
      return {
        ...definition,
        unlockedAt: unlock.unlockedAt,
        seenAt: unlock.seenAt,
        localPayload: unlock.localPayload,
        publicPayload: unlock.publicPayload,
        progress: { achievementId: definition.id, currentValue: definition.target, targetValue: definition.target },
      };
    })
    .filter((item): item is AchievementDashboardItem => !!item);

  if (items.length === 0) {
    return (
      <Text
        className="text-warm-400 dark:text-neutral-500"
        style={{ fontFamily: "Manrope_400Regular", fontSize: 13, textAlign: isRTL ? "right" : "left" }}
      >
        {s.publicBadgesEmpty}
      </Text>
    );
  }

  return (
    <View className={`flex-row flex-wrap gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
      {items.map((item) => (
        <AchievementBadge key={item.id} item={item} compact />
      ))}
    </View>
  );
}
