import { useState, useCallback } from "react";
import { View, Text, Pressable, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Trophy, Flame } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { LeaderboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { AuthGate } from "@/components/ui/AuthGate";
import {
  fetchDailyLeaderboard,
  fetchWeeklyLeaderboard,
  fetchAllTimeLeaderboard,
  fetchStreakLeaderboard,
  type LeaderboardEntry,
} from "@/lib/leaderboard/api";

type Tab = "daily" | "weekly" | "alltime" | "streak";

export default function LeaderboardScreen() {
  const { isDark } = useSettings();
  const s = useStrings();
  const user = useAuthStore((s) => s.user);
  const [activeTab, setActiveTab] = useState<Tab>("daily");

  const configured = isSupabaseConfigured();

  if (!user) {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <AuthGate
          title={s.authGateLeaderboardTitle}
          subtitle={s.authGateLeaderboardSubtitle}
        />
      </SafeAreaView>
    );
  }

  const queryFn = useCallback(() => {
    switch (activeTab) {
      case "daily": return fetchDailyLeaderboard();
      case "weekly": return fetchWeeklyLeaderboard();
      case "alltime": return fetchAllTimeLeaderboard();
      case "streak": return fetchStreakLeaderboard();
    }
  }, [activeTab]);

  const { data: entries = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["leaderboard", activeTab],
    queryFn,
    enabled: configured,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });

  const mutedColor = isDark ? "#737373" : "#A39B93";
  const tabs: { key: Tab; label: string }[] = [
    { key: "daily", label: s.leaderboardDaily },
    { key: "weekly", label: s.leaderboardWeekly },
    { key: "alltime", label: s.leaderboardAllTime },
    { key: "streak", label: s.leaderboardStreak },
  ];

  const scoreUnit = activeTab === "streak" ? s.leaderboardDays : s.leaderboardPoints;

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      {/* Header */}
      <View className="px-6 pt-4 pb-2">
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "NotoSerif_700Bold", fontSize: 24 }}
        >
          {s.leaderboardTitle}
        </Text>
      </View>

      {/* Tab bar */}
      <View className="flex-row px-4 pb-3 gap-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              className="flex-1 py-2.5 rounded-full items-center"
              style={{
                backgroundColor: isActive
                  ? (isDark ? "#1B4D4F" : "#003638")
                  : (isDark ? "#1a1a1a" : "#F0EAE2"),
              }}
            >
              <Text
                style={{
                  fontFamily: isActive ? "Manrope_600SemiBold" : "Manrope_500Medium",
                  fontSize: 12,
                  color: isActive ? "#FDDC91" : mutedColor,
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Content */}
      {!configured ? (
        <View className="flex-1 items-center justify-center">
          <EmptyState
            icon={Trophy}
            title={s.authGateLeaderboardTitle}
            subtitle={s.leaderboardNotConfigured}
            isDark={isDark}
          />
        </View>
      ) : isLoading ? (
        <LeaderboardSkeleton isDark={isDark} className="flex-1" />
      ) : entries.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <EmptyState
            icon={Trophy}
            title={s.leaderboardEmpty}
            subtitle={s.emptyLeaderboardSubtitle}
            isDark={isDark}
          />
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-4"
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
          }
        >
          {entries.map((entry) => (
            <LeaderboardRow
              key={entry.user_id}
              entry={entry}
              isCurrentUser={entry.user_id === user?.id}
              isDark={isDark}
              unit={scoreUnit}
              isStreak={activeTab === "streak"}
              s={s}
            />
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function LeaderboardRow({
  entry,
  isCurrentUser,
  isDark,
  unit,
  isStreak,
  s,
}: {
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
  isDark: boolean;
  unit: string;
  isStreak: boolean;
  s: any;
}) {
  const displayName = entry.display_name || entry.username;
  const mutedColor = isDark ? "#737373" : "#A39B93";

  // Medal for top 3
  const medal = entry.rank <= 3
    ? ["", "\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"][entry.rank]
    : null;

  return (
    <View
      className="flex-row items-center px-4 py-3 mb-2 rounded-2xl"
      style={{
        backgroundColor: isCurrentUser
          ? (isDark ? "rgba(27, 77, 79, 0.3)" : "rgba(0, 54, 56, 0.06)")
          : (isDark ? "#141414" : "#FFFFFF"),
      }}
    >
      {/* Rank */}
      <View className="w-10 items-center">
        {medal ? (
          <Text style={{ fontSize: 20 }}>{medal}</Text>
        ) : (
          <Text
            style={{ fontFamily: "Manrope_700Bold", fontSize: 16, color: mutedColor }}
          >
            {entry.rank}
          </Text>
        )}
      </View>

      {/* Avatar placeholder */}
      <View
        className="w-10 h-10 rounded-full items-center justify-center mx-3"
        style={{
          backgroundColor: isCurrentUser
            ? (isDark ? "#1B4D4F" : "#003638")
            : (isDark ? "#262626" : "#F0EAE2"),
        }}
      >
        <Text
          style={{
            fontFamily: "Manrope_600SemiBold",
            fontSize: 14,
            color: isCurrentUser ? "#FDDC91" : mutedColor,
          }}
        >
          {displayName.charAt(0).toUpperCase()}
        </Text>
      </View>

      {/* Name */}
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          {isCurrentUser && (
            <View className="px-2 py-0.5 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 9 }}
              >
                {s.leaderboardYou}
              </Text>
            </View>
          )}
        </View>
        <Text
          style={{ fontFamily: "Manrope_400Regular", fontSize: 11, color: mutedColor }}
        >
          @{entry.username}
        </Text>
      </View>

      {/* Score */}
      <View className="items-end">
        <View className="flex-row items-center gap-1">
          {isStreak && <Flame size={14} color={isDark ? "#f97316" : "#d97706"} />}
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 18 }}
          >
            {entry.score.toLocaleString()}
          </Text>
        </View>
        <Text style={{ fontFamily: "Manrope_400Regular", fontSize: 10, color: mutedColor }}>
          {unit}
        </Text>
      </View>
    </View>
  );
}
