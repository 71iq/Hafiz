import { Text, View } from "react-native";
import { BarChart3 } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import type { DefaultDeckProgressItem, DefaultDeckProgressKey } from "@/lib/profile/progress";

type Props = {
  items: DefaultDeckProgressItem[];
  isDark: boolean;
  isRTL: boolean;
  s: any;
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
    mutashabihat: s.smartDeckMutashabihatTitle,
    similarTails: s.smartDeckSimilarTailsTitle,
    qiraat: s.smartDeckQiraatTitle,
    reasonsOfRevelation: s.smartDeckReasonsTitle,
    vocabulary: s["achievementCategory.vocab"] ?? s.vocabDeckTitle,
  };
  const totalCards = items.reduce((sum, item) => sum + item.total, 0);

  return (
    <Card elevation="low" className={className}>
      <View className={`flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
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
      <View className={`mt-4 flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`} style={{ flexWrap: "wrap" }}>
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
              isDark={isDark}
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
  isDark,
  isRTL,
  s,
}: {
  title: string;
  item: DefaultDeckProgressItem;
  isDark: boolean;
  isRTL: boolean;
  s: any;
}) {
  const startedPct = item.total > 0 ? Math.round((item.startedCount / item.total) * 100) : 0;
  const barWidth = `${startedPct}%` as `${number}%`;
  return (
    <View>
      <View className={`mb-2 flex-row items-center justify-between gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
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
          backgroundColor: isDark ? "#262626" : "#E9E1D8",
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
      <View className={`mt-2 flex-row flex-wrap gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
        <DeckMetric label={s.progressDeckStarted} value={item.startedCount} isDark={isDark} isRTL={isRTL} />
        <DeckMetric label={s.flashcardsNewCards} value={item.newCount} isDark={isDark} isRTL={isRTL} />
        <DeckMetric label={s.deckCardsFilterDue} value={item.dueCount} isDark={isDark} isRTL={isRTL} />
      </View>
    </View>
  );
}

function DeckMetric({
  label,
  value,
  isDark,
  isRTL,
}: {
  label: string;
  value: number;
  isDark: boolean;
  isRTL: boolean;
}) {
  return (
    <View
      className={`flex-row items-center gap-1.5 rounded-full px-2.5 py-1 ${isRTL ? "flex-row-reverse" : ""}`}
      style={{ backgroundColor: isDark ? "#171717" : "#F5EEE7" }}
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
  return (
    <View className={`flex-row items-center gap-1.5 ${isRTL ? "flex-row-reverse" : ""}`}>
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
