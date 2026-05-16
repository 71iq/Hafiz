import { Pressable, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { getAchievementDefinition } from "@/lib/achievements/catalog";
import type { AchievementUnlock } from "@/lib/achievements/types";
import type { AchievementDashboardItem } from "@/lib/achievements/queries";
import { AchievementBadge } from "./AchievementBadge";

type Props = {
  unlock: AchievementUnlock;
  onDismiss: () => void;
};

export function AchievementUnlockToast({ unlock, onDismiss }: Props) {
  const definition = getAchievementDefinition(unlock.achievementId);
  const { isDark, isRTL } = useSettings();
  const s = useStrings();
  if (!definition) return null;

  const item: AchievementDashboardItem = {
    ...definition,
    unlockedAt: unlock.unlockedAt,
    seenAt: unlock.seenAt,
    localPayload: unlock.localPayload,
    publicPayload: unlock.publicPayload,
    progress: { achievementId: definition.id, currentValue: definition.target, targetValue: definition.target },
  };

  return (
    <Card elevation="low" className="mb-6 p-4">
      <View className={`mb-3 flex-row items-center justify-between ${isRTL ? "flex-row-reverse" : ""}`}>
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 14, textAlign: isRTL ? "right" : "left" }}
        >
          {s.achievementUnlocked}
        </Text>
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          className="h-7 w-7 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
        >
          <X size={13} color={isDark ? "#a3a3a3" : "#8B8178"} />
        </Pressable>
      </View>
      <AchievementBadge item={item} />
    </Card>
  );
}
