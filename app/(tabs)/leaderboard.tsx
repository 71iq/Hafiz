import { useState, useCallback, useEffect } from "react";
import { View, Text, Pressable, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Trophy, CalendarCheck2, Medal } from "lucide-react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useSettings } from "@/lib/settings/context";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { syncDailyScore, updateProfileStats } from "@/lib/fsrs/leaderboard-sync";
import { LeaderboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { AuthGate } from "@/components/ui/AuthGate";
import { useScreenContentLayout } from "@/components/ui/ScreenContent";
import {
  fetchDailyLeaderboard,
  fetchWeeklyLeaderboard,
  fetchAllTimeLeaderboard,
  fetchStreakLeaderboard,
  type LeaderboardEntry,
} from "@/lib/leaderboard/api";
import { LEADERBOARD_CONTENT_MAX_WIDTH } from "@/lib/ui/viewport";

type Tab = "daily" | "weekly" | "alltime" | "streak";

export default function LeaderboardScreen() {
  const { isDark } = useSettings();
  const db = useDatabase();
  const s = useStrings();
  const router = useRouter();
  const { contentContainerStyle, railStyle, isLaptop } = useScreenContentLayout({ maxWidth: LEADERBOARD_CONTENT_MAX_WIDTH });
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("daily");

  const configured = isSupabaseConfigured();

  const syncLeaderboard = useCallback(async () => {
    if (!configured || !user) return;
    await syncDailyScore(db);
    await updateProfileStats(db);
  }, [configured, db, user]);

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

  useEffect(() => {
    if (!configured || !user) return;
    const loaders: Record<Tab, () => Promise<LeaderboardEntry[]>> = {
      daily: fetchDailyLeaderboard,
      weekly: fetchWeeklyLeaderboard,
      alltime: fetchAllTimeLeaderboard,
      streak: fetchStreakLeaderboard,
    };
    (Object.keys(loaders) as Tab[]).forEach((tab) => {
      queryClient.prefetchQuery({
        queryKey: ["leaderboard", tab],
        queryFn: async () => {
          await syncLeaderboard();
          return loaders[tab]();
        },
        staleTime: 1000 * 60 * 2,
      }).catch(console.warn);
    });
  }, [configured, queryClient, syncLeaderboard, user]);

  const { data: entries = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["leaderboard", activeTab],
    queryFn: async () => {
      await syncLeaderboard();
      return queryFn();
    },
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
  const activeTabLabel = tabs.find((tab) => tab.key === activeTab)?.label ?? "";
  const featuredEntries = isLaptop ? entries.slice(0, 3) : [];
  const rowEntries = isLaptop ? entries.slice(3) : entries;

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <View style={[contentContainerStyle, { paddingTop: 16 }]}>
        <View style={railStyle}>
          <Text
            className="text-primary dark:text-gold-light"
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: isLaptop ? 34 : 32, lineHeight: 38 }}
          >
            {s.leaderboardTitle}
          </Text>
        </View>
      </View>

      <View
        className="mt-5 mb-5"
        style={contentContainerStyle}
      >
        <View
          className="flex-row rounded-full p-1.5"
          style={[railStyle, { backgroundColor: isDark ? "#161616" : "#EFE8DE" }]}
        >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              className="flex-1 h-10 rounded-full items-center justify-center"
              style={{
                backgroundColor: isActive
                  ? (isDark ? "#1B4D4F" : "#003638")
                  : "transparent",
              }}
            >
              <Text
                style={{
                  fontFamily: isActive ? "Manrope_600SemiBold" : "Manrope_500Medium",
                  fontSize: 13,
                  color: isActive ? "#FDDC91" : mutedColor,
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
        </View>
      </View>

      {/* Content */}
      {!configured ? (
        <View className="flex-1 justify-center" style={contentContainerStyle}>
          <View style={railStyle}>
            <EmptyState
              icon={Trophy}
              title={s.authGateLeaderboardTitle}
              subtitle={s.leaderboardNotConfigured}
              isDark={isDark}
            />
          </View>
        </View>
      ) : isLoading ? (
        <View className="flex-1" style={contentContainerStyle}>
          <View style={railStyle}>
            <LeaderboardSkeleton isDark={isDark} className="flex-1" />
          </View>
        </View>
      ) : entries.length === 0 ? (
        <View className="flex-1 justify-center" style={contentContainerStyle}>
          <View style={railStyle}>
            <EmptyState
              icon={Trophy}
              title={s.leaderboardEmpty}
              subtitle={s.emptyLeaderboardSubtitle}
              isDark={isDark}
            />
          </View>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={[contentContainerStyle, { paddingBottom: 40 }]}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
          }
        >
          <View style={railStyle}>
          {featuredEntries.length > 0 && (
            <View className="mb-6 flex-row justify-center gap-4">
              {featuredEntries.map((entry) => (
                <LeaderboardPodiumCard
                  key={entry.user_id}
                  entry={entry}
                  isCurrentUser={entry.user_id === user?.id}
                  isDark={isDark}
                  unit={scoreUnit}
                  s={s}
                  onPress={() => router.push(`/profile/${entry.user_id}` as any)}
                />
              ))}
            </View>
          )}
          <View className="mb-3 flex-row items-end justify-between">
            <Text
              style={{
                fontFamily: "Manrope_600SemiBold",
                fontSize: 10,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: mutedColor,
              }}
            >
              {`${activeTabLabel}`}
            </Text>
            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: mutedColor }}>
              {`${entries.length} ${s.leaderboardPlayers}`}
            </Text>
          </View>
          {rowEntries.map((entry) => (
            <LeaderboardRow
              key={entry.user_id}
              entry={entry}
              isCurrentUser={entry.user_id === user?.id}
              isDark={isDark}
              unit={scoreUnit}
              isStreak={activeTab === "streak"}
              s={s}
              onPress={() => router.push(`/profile/${entry.user_id}` as any)}
            />
          ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function LeaderboardPodiumCard({
  entry,
  isCurrentUser,
  isDark,
  unit,
  s,
  onPress,
}: {
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
  isDark: boolean;
  unit: string;
  s: any;
  onPress: () => void;
}) {
  const displayName = entry.display_name || entry.username;
  const rankColor = entry.rank === 1 ? "#F5C24B" : entry.rank === 2 ? "#B7BECF" : "#C49A62";
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-center rounded-4xl bg-surface-low dark:bg-surface-dark-low px-4 py-5"
      style={({ pressed }) => ({
        opacity: pressed ? 0.82 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View className="mb-3 h-8 min-w-8 items-center justify-center rounded-full px-2" style={{ backgroundColor: rankColor }}>
        <Text style={{ color: "#4A4034", fontFamily: "Manrope_700Bold", fontSize: 12 }}>
          {entry.rank}
        </Text>
      </View>
      <View
        className="h-14 w-14 items-center justify-center rounded-full"
        style={{ backgroundColor: isDark ? "#003638" : "#00595B" }}
      >
        <Text style={{ color: "#FDDC91", fontFamily: "Manrope_700Bold", fontSize: 18 }}>
          {displayName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <Text
        className="mt-3 text-charcoal dark:text-neutral-100"
        style={{ fontFamily: "Manrope_700Bold", fontSize: 15, textAlign: "center" }}
        numberOfLines={1}
      >
        {displayName}
      </Text>
      {isCurrentUser && (
        <Text
          className="mt-1 text-primary-accent dark:text-primary-bright"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 10 }}
        >
          {s.leaderboardYou}
        </Text>
      )}
      <Text className="mt-1 text-charcoal dark:text-neutral-100" style={{ fontFamily: "NotoSerif_700Bold", fontSize: 24 }}>
        {entry.score.toLocaleString()}
      </Text>
      <Text style={{ color: isDark ? "#737373" : "#A39B93", fontFamily: "Manrope_500Medium", fontSize: 10 }}>
        {unit}
      </Text>
    </Pressable>
  );
}

function LeaderboardRow({
  entry,
  isCurrentUser,
  isDark,
  unit,
  isStreak,
  s,
  onPress,
}: {
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
  isDark: boolean;
  unit: string;
  isStreak: boolean;
  s: any;
  onPress: () => void;
}) {
  const displayName = entry.display_name || entry.username;
  const mutedColor = isDark ? "#737373" : "#A39B93";

  const medalColor = entry.rank === 1 ? "#F5C24B" : entry.rank === 2 ? "#B7BECF" : "#C49A62";
  const hasMedal = entry.rank <= 3;
  const rankColor = hasMedal ? (isDark ? "#F5EBD7" : "#4A4034") : mutedColor;
  const scoreColor = isDark ? "#F3F2EF" : "#1D1D1B";

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 py-3.5 mb-2.5 rounded-2xl"
      style={{
        backgroundColor: isCurrentUser
          ? (isDark ? "rgba(45, 212, 191, 0.12)" : "rgba(13, 148, 136, 0.08)")
          : (isDark ? "#141414" : "#FAF8F5"),
      }}
    >
      <View className="w-8 items-center">
        <Text style={{ fontFamily: "NotoSerif_700Bold", fontSize: 16, color: rankColor }}>
          {entry.rank}
        </Text>
      </View>

      <View
        className="w-10 h-10 rounded-full items-center justify-center mx-3"
        style={{
          backgroundColor: isDark ? "#003638" : "#00595B",
        }}
      >
        <Text
          style={{
            fontFamily: "Manrope_600SemiBold",
            fontSize: 15,
            color: "#FDDC91",
          }}
        >
          {displayName.charAt(0).toUpperCase()}
        </Text>
      </View>

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

      <View className="items-end ml-2">
        <View className="flex-row items-center gap-1.5">
          {hasMedal && <Medal size={15} color={medalColor} />}
          {isStreak && <CalendarCheck2 size={14} color={isDark ? "#2dd4bf" : "#0d9488"} />}
          <Text
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: 20, color: scoreColor }}
          >
            {entry.score.toLocaleString()}
          </Text>
        </View>
        <Text style={{ fontFamily: "Manrope_400Regular", fontSize: 10, color: mutedColor }}>
          {unit}
        </Text>
      </View>
    </Pressable>
  );
}
