import React, { useMemo, useState } from "react";
import { ScrollView, View, Text, Pressable } from "react-native";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { BookOpen, ChevronLeft, ChevronRight, Search } from "lucide-react-native";
import { useOpenMushaf } from "@/lib/navigation/open-mushaf";
import { useSettings } from "@/lib/settings/context";
import { mutedIconColor } from "@/lib/ui/theme-icons";
import type { UIStrings } from "@/lib/i18n/strings";
import { textStartStyle } from "@/lib/ui/direction";
import { normalizeArabicWord, toArabicNumber } from "@/lib/arabic";

type SurahProgress = {
  surah: number;
  nameArabic: string;
  nameEnglish: string;
  totalCards: number;
  memorized: number;
};

type Props = {
  data: SurahProgress[];
  isDark: boolean;
  isRTL?: boolean;
  isCompact?: boolean;
  previewLimit?: number;
  onItemPress?: () => void;
  onViewAll?: () => void;
  /** Offered on one's own Progress screen when there is no memorization plan. */
  onSetUpPlan?: () => void;
  readOnly?: boolean;
  s: UIStrings;
};

export function SurahProgressList({
  data,
  isDark,
  isRTL,
  isCompact,
  previewLimit,
  onItemPress,
  onViewAll,
  onSetUpPlan,
  readOnly = false,
  s,
}: Props) {
  const openMushaf = useOpenMushaf();
  const { themeColors, effectiveTheme } = useSettings();
  // The theme's secondary text colour; the surah's second name is 11 px, so it needs 4.5:1.
  const mutedText = mutedIconColor(effectiveTheme);
  const previewData = previewLimit ? data.slice(0, previewLimit) : data;
  const isHorizontalPreview = !!previewLimit;

  if (data.length === 0) {
    return (
      <Card elevation="low" className="py-6">
        <EmptyState
          icon={BookOpen}
          title={s.surahProgressEmpty}
          subtitle={s.surahProgressEmptyDesc}
          actionLabel={onSetUpPlan ? s.surahSetUpPlan : undefined}
          onAction={onSetUpPlan}
          isDark={isDark}
        />
      </Card>
    );
  }

  const handlePress = (surah: number) => {
    onItemPress?.();
    openMushaf({ surah, ayah: 1 });
  };
  const localNumber = (value: number) => (isRTL ? toArabicNumber(value) : String(value));
  const rowFlexStyle = {
    direction: "ltr" as const,
    flexDirection: isRTL ? "row-reverse" as const : "row" as const,
  };

  const renderItem = (item: SurahProgress, cardWidth?: number) => {
    const pct = item.totalCards > 0 ? (item.memorized / item.totalCards) * 100 : 0;
    const primaryName = isRTL ? item.nameArabic || item.nameEnglish : item.nameEnglish || item.nameArabic;
    // English readers get the Arabic name as a subtitle; the Arabic UI shows the Arabic name alone.
    const secondaryName = isRTL ? "" : item.nameArabic && item.nameArabic !== primaryName ? item.nameArabic : "";
    const primaryDirection = isRTL ? "rtl" : "ltr";
    const secondaryDirection = isRTL ? "ltr" : "rtl";
    const content = (
        <Card elevation="low" className="p-4">
          <View
            style={{
              ...rowFlexStyle,
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
              gap: 10,
            }}
          >
            <View style={{ ...rowFlexStyle, alignItems: "center", gap: 8, flex: 1 }}>
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  backgroundColor: isDark ? "rgba(45,212,191,0.12)" : "rgba(13,148,136,0.10)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: isDark ? "#2dd4bf" : "#0d9488" }}>
                  {localNumber(item.surah)}
                </Text>
              </View>
              <View style={{ flex: 1, alignItems: isRTL ? "flex-end" : "flex-start" }}>
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    fontSize: 14,
                    color: isDark ? "#e5e5e5" : "#2D2D2D",
                    writingDirection: primaryDirection,
                    ...textStartStyle(isRTL),
                  }}
                  numberOfLines={1}
                >
                  {primaryName}
                </Text>
                {secondaryName ? (
                  <Text
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 11,
                      color: mutedText,
                      ...textStartStyle(isRTL),
                      writingDirection: secondaryDirection,
                    }}
                    numberOfLines={1}
                  >
                    {secondaryName}
                  </Text>
                ) : null}
              </View>
            </View>
            <Text
              style={{
                fontFamily: "Manrope_600SemiBold",
                fontSize: 13,
                color: mutedText,
                writingDirection: "ltr",
              }}
            >
              {localNumber(item.memorized)}/{localNumber(item.totalCards)}
            </Text>
          </View>

          <View
            style={{
              height: 2,
              borderRadius: 999,
              backgroundColor: themeColors.surfaceHigh,
              overflow: "hidden",
              // Pinned so flex-end is the right side whatever direction the list inherits.
              direction: "ltr",
            }}
          >
            {pct > 0 && (
              <View
                style={{
                  height: "100%",
                  borderRadius: 999,
                  backgroundColor: isDark ? "#14b8a6" : "#0d9488",
                  width: `${Math.min(pct, 100)}%`,
                  alignSelf: isRTL ? "flex-end" : "flex-start",
                }}
              />
            )}
          </View>
        </Card>
    );

    if (readOnly) {
      return (
        <View key={item.surah} style={{ width: cardWidth ?? (isCompact ? "48%" : "100%") }}>
          {content}
        </View>
      );
    }

    return (
      <Pressable
        key={item.surah}
        accessibilityRole="button"
        accessibilityHint={s.cardOpenInMushaf}
        onPress={() => handlePress(item.surah)}
        style={({ pressed }) => ({
          transform: [{ scale: pressed ? 0.98 : 1 }],
          width: cardWidth ?? (isCompact ? "48%" : "100%"),
        })}
      >
        {content}
      </Pressable>
    );
  };

  if (isHorizontalPreview) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Direction alone mirrors the row and starts its scroll at the right in Arabic; row-reverse
        // under "ltr" opened a long list at its end.
        contentContainerStyle={{ gap: 8, direction: isRTL ? "rtl" : "ltr", flexDirection: "row", paddingHorizontal: 1 }}
      >
        {previewData.map((item) => renderItem(item, 184))}
        {onViewAll && data.length > previewData.length ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.surahProgressViewAll}
            onPress={onViewAll}
            style={({ pressed }) => ({
              opacity: pressed ? 0.72 : 1,
              width: 132,
            })}
          >
            {/* h-full stretched this card far below the row inside the horizontal scroll and pushed its
                label out of view; flex-1 matches the surah cards' height. */}
            <Card elevation="low" className="flex-1 min-h-[86px] items-center justify-center p-4">
              <View className={`items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`} style={rowFlexStyle}>
                <Text
                  className="text-primary dark:text-primary-bright"
                  style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}
                >
                  {s.surahProgressViewAll}
                </Text>
                {/* Points toward the reading end: right in English, left in Arabic. */}
                {isRTL ? (
                  <ChevronLeft size={15} color={isDark ? "#2dd4bf" : "#0d9488"} />
                ) : (
                  <ChevronRight size={15} color={isDark ? "#2dd4bf" : "#0d9488"} />
                )}
              </View>
            </Card>
          </Pressable>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <View
      style={{
        flexDirection: isCompact ? (isRTL ? "row-reverse" : "row") : "column",
        direction: "ltr",
        flexWrap: isCompact ? "wrap" : "nowrap",
        gap: 8,
      }}
    >
      {data.map((item) => renderItem(item))}
    </View>
  );
}

type SurahSort = "order" | "most" | "least";

function memorizedShare(item: SurahProgress): number {
  return item.totalCards > 0 ? item.memorized / item.totalCards : 0;
}

/**
 * The full surah list behind View all: a search field (name in either language or surah number) and
 * a sort toggle. Searching and sorting never change progress data.
 */
export function SurahProgressBrowser({
  data,
  isDark,
  isRTL,
  isCompact,
  onItemPress,
  s,
}: Pick<Props, "data" | "isDark" | "isRTL" | "isCompact" | "onItemPress" | "s">) {
  const { effectiveTheme } = useSettings();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SurahSort>("order");
  const visible = useMemo(() => {
    const raw = query.trim();
    const digits = raw.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
    const latin = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    const arabic = normalizeArabicWord(raw);
    const matches = (item: SurahProgress) => {
      if (!raw) return true;
      if (/^\d+$/.test(digits)) return String(item.surah) === digits;
      if (latin && item.nameEnglish.toLowerCase().replace(/[^a-z0-9]/g, "").includes(latin)) return true;
      return !!arabic && normalizeArabicWord(item.nameArabic).includes(arabic);
    };
    const filtered = data.filter(matches);
    if (sort === "order") return [...filtered].sort((a, b) => a.surah - b.surah);
    const direction = sort === "most" ? -1 : 1;
    return [...filtered].sort(
      (a, b) => direction * (memorizedShare(a) - memorizedShare(b)) || direction * (a.memorized - b.memorized) || a.surah - b.surah
    );
  }, [data, query, sort]);

  return (
    <View className="gap-3">
      <Input
        value={query}
        onChangeText={setQuery}
        placeholder={s.surahSearchPlaceholder}
        accessibilityLabel={s.surahSearchPlaceholder}
        placeholderTextColor={mutedIconColor(effectiveTheme)}
        startIcon={<Search size={16} color={mutedIconColor(effectiveTheme)} />}
        returnKeyType="search"
        autoCorrect={false}
      />
      <ToggleGroup
        accessibilityLabel={s.surahSortLabel}
        value={sort}
        onValueChange={setSort}
        itemClassName="min-h-11"
        items={[
          { value: "order", label: s.surahSortOrder },
          { value: "most", label: s.surahSortMost },
          { value: "least", label: s.surahSortLeast },
        ]}
      />
      {visible.length === 0 ? (
        <Text
          className="py-6 text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 13, textAlign: "center" }}
        >
          {s.surahNoMatches}
        </Text>
      ) : (
        <SurahProgressList data={visible} isDark={isDark} isRTL={isRTL} isCompact={isCompact} onItemPress={onItemPress} s={s} />
      )}
    </View>
  );
}
