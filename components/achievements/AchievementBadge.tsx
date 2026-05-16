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
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import type { AchievementDashboardItem } from "@/lib/achievements/queries";
import type { AchievementDefinition } from "@/lib/achievements/catalog";
import { AchievementProgressBar } from "./AchievementProgressBar";

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

const RARITY_COLOR: Record<AchievementDefinition["rarity"], string> = {
  common: "#0d9488",
  uncommon: "#2563eb",
  rare: "#7c3aed",
  epic: "#c2410c",
  legendary: "#b45309",
};

type Props = {
  item: AchievementDashboardItem;
  compact?: boolean;
};

export function AchievementBadge({ item, compact = false }: Props) {
  const { isDark, isRTL } = useSettings();
  const s = useStrings();
  const Icon = ICONS[item.icon];
  const unlocked = !!item.unlockedAt;
  const color = RARITY_COLOR[item.rarity];
  const juzNumber = getJuzNumber(item.id);
  const title = interpolate(s[item.titleKey] ?? item.id, { n: String(juzNumber ?? item.target) });
  const description = interpolate(s[item.descriptionKey] ?? "", { n: String(juzNumber ?? item.target) });
  const progress = item.progress;
  const showProgress = !unlocked && !!progress && progress.targetValue > 1;
  const currentValue = progress?.currentValue ?? 0;
  const targetValue = progress?.targetValue ?? item.target;
  const iconColor = unlocked ? color : isDark ? "#737373" : "#A39B93";

  return (
    <View
      className={`rounded-2xl border px-3.5 py-3 ${compact ? "w-[150px]" : "w-full"}`}
      style={{
        borderColor: unlocked ? color : isDark ? "#262626" : "#E8DED4",
        backgroundColor: unlocked
          ? (isDark ? "rgba(13,148,136,0.12)" : "rgba(13,148,136,0.08)")
          : (isDark ? "#171717" : "#FFF8F1"),
        opacity: unlocked ? 1 : 0.78,
      }}
    >
      <View className={`flex-row items-start gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
        <View
          className="h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: unlocked ? `${color}22` : isDark ? "#262626" : "#F0EAE2" }}
        >
          <Icon size={17} color={iconColor} />
        </View>
        <View className="min-w-0 flex-1">
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_700Bold", fontSize: compact ? 12 : 13, textAlign: isRTL ? "right" : "left" }}
            numberOfLines={compact ? 2 : 1}
          >
            {title}
          </Text>
          {!compact && (
            <Text
              className="mt-1 text-warm-400 dark:text-neutral-500"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 11, lineHeight: 16, textAlign: isRTL ? "right" : "left" }}
              numberOfLines={2}
            >
              {description}
            </Text>
          )}
        </View>
      </View>
      {showProgress && (
        <>
          <AchievementProgressBar current={currentValue} target={targetValue} isDark={isDark} />
          <Text
            className="mt-1.5 text-warm-400 dark:text-neutral-500"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 10, textAlign: isRTL ? "right" : "left" }}
          >
            {interpolate(s.achievementProgressCount, {
              current: String(Math.min(currentValue, targetValue)),
              target: String(targetValue),
            })}
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
