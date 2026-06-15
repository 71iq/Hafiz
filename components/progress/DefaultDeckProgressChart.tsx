import { Text, View } from "react-native";
import { BarChart3 } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { useSettings } from "@/lib/settings/context";
import type { UIStrings } from "@/lib/i18n/strings";
import type { DefaultDeckProgressItem, DefaultDeckProgressKey } from "@/lib/profile/progress";

type DefaultDeckProgressStrings = Pick<
  UIStrings,
  | "smartDeckRetentionTitle"
  | "smartDeckMutashabihatTitle"
  | "smartDeckSimilarTailsTitle"
  | "smartDeckQiraatTitle"
  | "smartDeckReasonsTitle"
  | "achievementCategory.vocab"
  | "vocabDeckTitle"
  | "progressDefaultDecks"
  | "flashcardsTotalCards"
  | "progressDeckStarted"
  | "flashcardsNewCards"
  | "progressDefaultDecksEmpty"
  | "deckCardsFilterDue"
>;

type Props = {
  items: DefaultDeckProgressItem[];
  isDark: boolean;
  isRTL: boolean;
  s: DefaultDeckProgressStrings;
  className?: string;
};

export function DefaultDeckProgressChart({
  items,
  isDark,
  isRTL,
  s,
  className = "p-5 mb-6",
}: Props) {
  const titles: Record<DefaultDeckProgressKey, string> = {
    retention: s.smartDeckRetentionTitle,
    mutashabihat: s.smartDeckMutashabihatTitle,
    similarTails: s.smartDeckSimilarTailsTitle,
    qiraat: s.smartDeckQiraatTitle,
    reasonsOfRevelation: s.smartDeckReasonsTitle,
    vocabulary: s["achievementCategory.vocab"] ?? s.vocabDeckTitle,
  };
  const totalCards = items.reduce((sum, item) => sum + item.total, 0);
  const rowFlexStyle = {
    direction: "ltr" as const,
    flexDirection: isRTL ? "row-reverse" as const : "row" as const,
  };

  return (
    <Card elevation="low" className={className}>
      <View className={`flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`} style={rowFlexStyle}>
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: isDark ? "rgba(45,212,191,0.12)" : "rgba(13,148,136,0.10)" }}
        >
          <BarChart3 size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
        </View>
        <View className={`min-w-0 flex-1 ${isRTL ? "items-end" : "items-start"}`}>
          <Text
            className="text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 16, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {s.progressDefaultDecks}
          </Text>
          <Text
            className="mt-1 text-warm-400 dark:text-neutral-500"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {`${s.flashcardsTotalCards}: ${totalCards.toLocaleString()}`}
          </Text>
        </View>
      </View>
      <View
        className={`mt-4 flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`}
        style={{ ...rowFlexStyle, flexWrap: "wrap" }}
      >
        <DeckLegendDot label={s.progressDeckStarted} color={isDark ? "#2dd4bf" : "#0d9488"} isRTL={isRTL} />
        <DeckLegendDot label={s.flashcardsNewCards} color={isDark ? "#525252" : "#E5DDD4"} isRTL={isRTL} />
      </View>

      {totalCards > 0 ? (
        <View className="mt-5 gap-4">
          {items.map((item) => (
            <DefaultDeckProgressRow
              key={item.key}
              title={titles[item.key]}
              item={item}
              isRTL={isRTL}
              s={s}
            />
          ))}
        </View>
      ) : (
        <Text
          className="mt-5 text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 13, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
        >
          {s.progressDefaultDecksEmpty}
        </Text>
      )}
    </Card>
  );
}

function DefaultDeckProgressRow({
  title,
  item,
  isRTL,
  s,
}: {
  title: string;
  item: DefaultDeckProgressItem;
  isRTL: boolean;
  s: DefaultDeckProgressStrings;
}) {
  const { themeColors } = useSettings();
  const startedPct = item.total > 0 ? Math.round((item.startedCount / item.total) * 100) : 0;
  const barWidth = `${startedPct}%` as `${number}%`;
  const rowFlexStyle = {
    direction: "ltr" as const,
    flexDirection: isRTL ? "row-reverse" as const : "row" as const,
  };
  return (
    <View>
      <View className={`mb-2 flex-row items-center justify-between gap-3 ${isRTL ? "flex-row-reverse" : ""}`} style={rowFlexStyle}>
        <Text
          className="min-w-0 flex-1 text-charcoal dark:text-neutral-200"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 13, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text
          className="text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 12, fontVariant: ["tabular-nums"] }}
        >
          {`${item.startedCount.toLocaleString()} / ${item.total.toLocaleString()}`}
        </Text>
      </View>
      <View
        className="h-3 overflow-hidden rounded-full"
        style={{
          backgroundColor: themeColors.surfaceHigh,
        }}
      >
        <View
          className="h-full rounded-full"
          style={{
            width: barWidth,
            alignSelf: isRTL ? "flex-end" : "flex-start",
            backgroundColor: item.color,
          }}
        />
      </View>
      <View className={`mt-2 flex-row flex-wrap gap-2 ${isRTL ? "flex-row-reverse" : ""}`} style={rowFlexStyle}>
        <DeckMetric label={s.progressDeckStarted} value={item.startedCount} isRTL={isRTL} />
        <DeckMetric label={s.flashcardsNewCards} value={item.newCount} isRTL={isRTL} />
        <DeckMetric label={s.deckCardsFilterDue} value={item.dueCount} isRTL={isRTL} />
      </View>
    </View>
  );
}

function DeckMetric({
  label,
  value,
  isRTL,
}: {
  label: string;
  value: number;
  isRTL: boolean;
}) {
  const { themeColors } = useSettings();
  const rowFlexStyle = {
    direction: "ltr" as const,
    flexDirection: isRTL ? "row-reverse" as const : "row" as const,
  };
  return (
    <View
      className={`flex-row items-center gap-1.5 rounded-full px-2.5 py-1 ${isRTL ? "flex-row-reverse" : ""}`}
      style={{ ...rowFlexStyle, backgroundColor: themeColors.surfaceLow }}
    >
      <Text
        className="text-charcoal dark:text-neutral-200"
        style={{ fontFamily: "Manrope_700Bold", fontSize: 11, fontVariant: ["tabular-nums"] }}
      >
        {value.toLocaleString()}
      </Text>
      <Text
        className="text-warm-500 dark:text-neutral-500"
        style={{ fontFamily: "Manrope_500Medium", fontSize: 10, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {label}
      </Text>
    </View>
  );
}

function DeckLegendDot({
  label,
  color,
  isRTL,
}: {
  label: string;
  color: string;
  isRTL: boolean;
}) {
  const rowFlexStyle = {
    direction: "ltr" as const,
    flexDirection: isRTL ? "row-reverse" as const : "row" as const,
  };
  return (
    <View className={`flex-row items-center gap-1.5 ${isRTL ? "flex-row-reverse" : ""}`} style={rowFlexStyle}>
      <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      <Text
        className="text-warm-500 dark:text-neutral-500"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {label}
      </Text>
    </View>
  );
}
