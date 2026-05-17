import React from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { BookOpen } from "lucide-react-native";
import { setPendingDeepLink } from "@/lib/deep-link";

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
  s: Record<string, string>;
};

export function SurahProgressList({ data, isDark, isRTL, isCompact, s }: Props) {
  const router = useRouter();

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
  };

  return (
    <View
      style={{
        flexDirection: isCompact ? (isRTL ? "row-reverse" : "row") : "column",
        flexWrap: isCompact ? "wrap" : "nowrap",
        gap: 8,
      }}
    >
      {data.map((item) => {
        const pct = item.totalCards > 0 ? (item.memorized / item.totalCards) * 100 : 0;
        return (
          <Pressable
            key={item.surah}
            onPress={() => handlePress(item.surah)}
            style={({ pressed }) => ({
              transform: [{ scale: pressed ? 0.98 : 1 }],
              width: isCompact ? "48%" : "100%",
            })}
          >
            <Card elevation="low" className="p-4">
              <View
                style={{
                  flexDirection: isRTL ? "row-reverse" : "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                  gap: 10,
                }}
              >
                <View style={{ flexDirection: isRTL ? "row-reverse" : "row", alignItems: "center", gap: 8, flex: 1 }}>
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
                        writingDirection: "rtl",
                        textAlign: "right",
                      }}
                      numberOfLines={1}
                    >
                      {item.nameArabic}
                    </Text>
                    <Text
                      style={{
                        fontFamily: "Manrope_400Regular",
                        fontSize: 11,
                        color: isDark ? "#737373" : "#8B8178",
                        textAlign: isRTL ? "right" : "left",
                      }}
                      numberOfLines={1}
                    >
                      {item.nameEnglish}
                    </Text>
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

              {/* Progress bar */}
              <View
                style={{
                  height: 2,
                  borderRadius: 999,
                  backgroundColor: isDark ? "#262626" : "#E8E1DA",
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
                    }}
                  />
                )}
              </View>
            </Card>
          </Pressable>
        );
      })}
    </View>
  );
}
