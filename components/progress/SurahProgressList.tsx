import React from "react";
import { ScrollView, View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { BookOpen, ChevronDown } from "lucide-react-native";
import { setPendingDeepLink } from "@/lib/deep-link";
import { useSettings } from "@/lib/settings/context";

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
  readOnly?: boolean;
  s: Record<string, string>;
};

export function SurahProgressList({
  data,
  isDark,
  isRTL,
  isCompact,
  previewLimit,
  onItemPress,
  onViewAll,
  readOnly = false,
  s,
}: Props) {
  const router = useRouter();
  const { themeColors } = useSettings();
  const previewData = previewLimit ? data.slice(0, previewLimit) : data;
  const isHorizontalPreview = !!previewLimit;

  if (data.length === 0) {
    return (
      <Card elevation="low" className="py-6">
        <EmptyState
          icon={BookOpen}
          title={s.surahProgressEmpty}
          subtitle={s.surahProgressEmptyDesc}
          isDark={isDark}
        />
      </Card>
    );
  }

  const handlePress = (surah: number) => {
    setPendingDeepLink({ surah, ayah: 1 });
    router.push("/(tabs)/mushaf");
    onItemPress?.();
  };
  const rowFlexStyle = {
    direction: "ltr" as const,
    flexDirection: isRTL ? "row-reverse" as const : "row" as const,
  };

  const renderItem = (item: SurahProgress, cardWidth?: number) => {
    const pct = item.totalCards > 0 ? (item.memorized / item.totalCards) * 100 : 0;
    const primaryName = isRTL ? item.nameArabic || item.nameEnglish : item.nameEnglish || item.nameArabic;
    const secondaryName = isRTL
      ? item.nameEnglish && item.nameEnglish !== primaryName ? item.nameEnglish : ""
      : item.nameArabic && item.nameArabic !== primaryName ? item.nameArabic : "";
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
                  {item.surah}
                </Text>
              </View>
              <View style={{ flex: 1, alignItems: isRTL ? "flex-end" : "flex-start" }}>
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    fontSize: 14,
                    color: isDark ? "#e5e5e5" : "#2D2D2D",
                    writingDirection: primaryDirection,
                    textAlign: isRTL ? "right" : "left",
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
                      color: isDark ? "#737373" : "#8B8178",
                      textAlign: isRTL ? "right" : "left",
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
                color: isDark ? "#a3a3a3" : "#6e5a47",
                writingDirection: "ltr",
              }}
            >
              {item.memorized}/{item.totalCards}
            </Text>
          </View>

          <View
            style={{
              height: 2,
              borderRadius: 999,
              backgroundColor: themeColors.surfaceHigh,
              overflow: "hidden",
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
        contentContainerStyle={{ gap: 8, ...rowFlexStyle, paddingHorizontal: 1 }}
      >
        {previewData.map((item) => renderItem(item, 184))}
        {onViewAll ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.surahProgressViewAll}
            onPress={onViewAll}
            style={({ pressed }) => ({
              opacity: pressed ? 0.72 : 1,
              width: 132,
            })}
          >
            <Card elevation="low" className="h-full min-h-[86px] items-center justify-center p-4">
              <View className={`items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`} style={rowFlexStyle}>
                <Text
                  className="text-primary dark:text-primary-bright"
                  style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}
                >
                  {s.surahProgressViewAll}
                </Text>
                <ChevronDown size={15} color={isDark ? "#2dd4bf" : "#0d9488"} />
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
