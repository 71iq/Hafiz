import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { formatNumber } from "@/lib/i18n/count";
import { getAchievementDefinition } from "@/lib/achievements/catalog";
import type { AchievementUnlock } from "@/lib/achievements/types";
import type { AchievementDashboardItem } from "@/lib/achievements/queries";
import { AchievementBadge } from "./AchievementBadge";
import { textStartStyle } from "@/lib/ui/direction";

type Props = {
  unlock: AchievementUnlock;
  /** Further unseen unlocks waiting behind this one. */
  moreCount?: number;
  onDismiss: () => void;
  /** Opens the achievements list; the close button alone marks this unlock seen. */
  onOpen?: () => void;
  /** Zayt for a juz completed on this device, centred above the badge. */
  zayt?: ReactNode;
};

export function AchievementUnlockToast({ unlock, moreCount = 0, onDismiss, onOpen, zayt }: Props) {
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
  const more = moreCount > 0 ? interpolate(s.homeAchievementMore, { n: formatNumber(moreCount, isRTL ? "ar" : "en") }) : null;

  return (
    <Card elevation="low" className="mb-6 p-4">
      {/* Hand-mirrored row pins LTR coordinates; under the RTL tab root row-reverse flipped twice. */}
      <View
        className={`mb-2 flex-row items-center justify-between gap-2 ${isRTL ? "flex-row-reverse" : ""}`}
        style={{ direction: "ltr" }}
      >
        <View className={`min-w-0 flex-1 flex-row flex-wrap items-center gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 14, ...textStartStyle(isRTL)}}
          >
            {s.achievementUnlocked}
          </Text>
          {more ? (
            <View className="rounded-full bg-primary-accent/10 px-2 py-0.5 dark:bg-primary-bright/10">
              <Text className="text-primary-muted dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}>
                {more}
              </Text>
            </View>
          ) : null}
        </View>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={s.homeDismiss}
          className="-my-2 h-11 w-11 items-center justify-center rounded-full"
        >
          <View className="h-7 w-7 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low">
            <X size={13} color={isDark ? "#a3a3a3" : "#8B8178"} />
          </View>
        </Pressable>
      </View>
      {zayt ? <View className="mb-2 items-center">{zayt}</View> : null}
      {onOpen ? (
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityHint={s.achievementsViewAll}
          style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
        >
          <AchievementBadge item={item} />
        </Pressable>
      ) : (
        <AchievementBadge item={item} />
      )}
    </Card>
  );
}
