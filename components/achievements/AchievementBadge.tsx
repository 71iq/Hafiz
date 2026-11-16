import { Text, View } from "react-native";
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Layers,
  MessageCircle,
  NotebookPen,
  Sparkles,
  Star,
  Trophy,
  type LucideIcon,
} from "lucide-react-native";
import { useSettings } from "@/lib/settings/context";
import { useStrings, interpolate, stringByKey } from "@/lib/i18n/useStrings";
import type { AchievementDashboardItem } from "@/lib/achievements/queries";
import type { AchievementDefinition } from "@/lib/achievements/catalog";
import { AchievementProgressBar } from "./AchievementProgressBar";
import { textStartStyle } from "@/lib/ui/direction";
import { accentIconColor } from "@/lib/ui/theme-icons";

const ICONS: Record<AchievementDefinition["icon"], LucideIcon> = {
  book: BookOpen,
  calendar: CalendarDays,
  check: CheckCircle2,
  flame: CalendarDays,
  layers: Layers,
  message: MessageCircle,
  note: NotebookPen,
  sparkle: Sparkles,
  star: Star,
  trophy: Trophy,
};

const RARITY_LABEL_KEY = {
  common: "achievementRarity.common",
  uncommon: "achievementRarity.uncommon",
  rare: "achievementRarity.rare",
  epic: "achievementRarity.epic",
  legendary: "achievementRarity.legendary",
} as const satisfies Record<AchievementDefinition["rarity"], string>;

type Props = {
  item: AchievementDashboardItem;
  compact?: boolean;
};

export function AchievementBadge({ item, compact = false }: Props) {
  const { isDark, isRTL, themeColors, effectiveTheme } = useSettings();
  const s = useStrings();
  const Icon = ICONS[item.icon];
  const unlocked = !!item.unlockedAt;
  const color = accentIconColor(effectiveTheme);
  const rarity = s[RARITY_LABEL_KEY[item.rarity]];
  const juzNumber = getJuzNumber(item.id);
  const title = interpolate(stringByKey(s, item.titleKey, item.id), { n: String(juzNumber ?? item.target) });
  const description = interpolate(stringByKey(s, item.descriptionKey), { n: String(juzNumber ?? item.target) });
  const progress = item.progress;
  const showProgress = !unlocked && !!progress && progress.targetValue > 1;
  const currentValue = progress?.currentValue ?? 0;
  const targetValue = progress?.targetValue ?? item.target;
  const iconColor = unlocked ? color : isDark ? "#737373" : "#A39B93";

  return (
    <View
      className={`rounded-2xl border px-3.5 py-3 ${compact ? "w-[150px]" : "w-full"}`}
      style={{
        borderColor: unlocked ? color : themeColors.surfaceHigh,
        backgroundColor: unlocked
          ? (isDark ? "rgba(13,148,136,0.12)" : "rgba(13,148,136,0.08)")
          : themeColors.surface,
        opacity: unlocked ? 1 : 0.78,
      }}
    >
      <View
        className={`flex-row items-start gap-3 ${isRTL ? "flex-row-reverse" : ""}`}
        style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
      >
        <View
          className="h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: unlocked ? `${color}22` : themeColors.surfaceMid }}
        >
          <Icon size={17} color={iconColor} />
        </View>
        <View className="min-w-0 flex-1">
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_700Bold", fontSize: compact ? 12 : 13, ...textStartStyle(isRTL)}}
            numberOfLines={compact ? 2 : 1}
          >
            {title}
          </Text>
          <View
            className="mt-1 rounded-full bg-surface-high px-2 py-0.5 dark:bg-surface-dark-high"
            style={{ alignSelf: isRTL ? "flex-end" : "flex-start" }}
          >
            <Text className="text-warm-700 dark:text-neutral-300" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10 }}>
              {rarity}
            </Text>
          </View>
          {!compact && (
            <Text
              className="mt-1 text-warm-700 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 11, lineHeight: 16, ...textStartStyle(isRTL)}}
            >
              {description}
            </Text>
          )}
        </View>
      </View>
      {showProgress && (
        <>
          <AchievementProgressBar current={currentValue} target={targetValue} />
          <Text
            className="mt-1.5 text-warm-700 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 10, ...textStartStyle(isRTL)}}
          >
            {`\u2066${interpolate(s.achievementProgressCount, {
              current: String(Math.min(currentValue, targetValue)),
              target: String(targetValue),
            })}\u2069`}
          </Text>
        </>
      )}
    </View>
  );
}

function getJuzNumber(id: string): number | null {
  const match = id.match(/^juz_(\d{2})_completed$/);
  return match ? Number(match[1]) : null;
}
