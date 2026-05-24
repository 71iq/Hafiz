import { useState, useCallback, useEffect } from "react";
import { View, Text, Pressable, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Trophy, CalendarCheck2, Medal } from "lucide-react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ProfileIdentity } from "@/components/profile/ProfileIdentity";
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

  const { data: entries = [], isLoading, error: leaderboardError, refetch, isRefetching } = useQuery({
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
  const featuredEntries = isLaptop
    ? [entries[1], entries[0], entries[2]].filter((entry): entry is LeaderboardEntry => Boolean(entry))
    : [];
  const rowEntries = isLaptop ? entries.slice(3) : entries;
  const openProfile = useCallback(
    (userId: string) => {
      router.push(userId === user?.id ? "/profile" as any : `/profile/${userId}` as any);
    },
    [user?.id]
  );

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <View
        className="mb-5"
        style={[contentContainerStyle, { paddingTop: 16 }]}
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
      ) : leaderboardError ? (
        <View className="flex-1 justify-center" style={contentContainerStyle}>
          <View style={railStyle}>
            <EmptyState
              icon={Trophy}
              title={s.leaderboardLoadFailed}
              actionLabel={s.errorTryAgain}
              onAction={() => refetch()}
              isDark={isDark}
            />
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
            <View className="mb-7 justify-center gap-5" style={{ flexDirection: "row", direction: "ltr" }}>
              {featuredEntries.map((entry) => (
                <LeaderboardPodiumCard
                  key={entry.user_id}
                  entry={entry}
                  isCurrentUser={entry.user_id === user?.id}
                  isDark={isDark}
                  unit={scoreUnit}
                  s={s}
                  onPress={() => openProfile(entry.user_id)}
                />
              ))}
            </View>
          )}
          <View className="mb-3 flex-row items-end justify-between" style={{ direction: "ltr" }}>
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
              onPress={() => openProfile(entry.user_id)}
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
  const isFirst = entry.rank === 1;
  const rankColor = entry.rank === 1 ? "#F5C24B" : entry.rank === 2 ? "#B7BECF" : "#C49A62";
  const cardBg = isDark
    ? isFirst ? "#172B28" : "#141414"
    : isFirst ? "#FFF3D8" : "#FAF8F5";
  const scoreBg = isDark
    ? entry.rank === 1
      ? "rgba(245, 194, 75, 0.13)"
      : entry.rank === 2
        ? "rgba(183, 190, 207, 0.14)"
        : "rgba(196, 154, 98, 0.15)"
    : entry.rank === 1
      ? "rgba(245, 194, 75, 0.20)"
      : entry.rank === 2
        ? "rgba(183, 190, 207, 0.24)"
        : "rgba(196, 154, 98, 0.24)";
  const scoreColor = isDark
    ? isFirst ? "#FDDC91" : "#F5F5F4"
    : isFirst ? "#2D2419" : "#1D1D1B";
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-center overflow-hidden rounded-4xl px-4 py-5"
      style={({ pressed }) => ({
        backgroundColor: cardBg,
        borderColor: isFirst ? rankColor : "transparent",
        borderWidth: isFirst ? 1 : 0,
        marginTop: entry.rank === 1 ? 0 : 18,
        opacity: pressed ? 0.82 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: 5, backgroundColor: rankColor }} />
      <View
        className={`mb-3 h-9 min-w-9 items-center justify-center rounded-full px-2 ${isFirst ? "flex-row gap-1" : ""}`}
        style={{ backgroundColor: rankColor }}
      >
        {isFirst && <Trophy size={13} color="#4A4034" />}
        <Text style={{ color: "#4A4034", fontFamily: "Manrope_700Bold", fontSize: 12 }}>
          {entry.rank}
        </Text>
      </View>
      <ProfileIdentity
        displayName={displayName}
        username={entry.username}
        avatarUrl={entry.avatar_url}
        isDark={isDark}
        avatarSize={56}
        nameSize={15}
        handleSize={10}
        centered
      />
      {isCurrentUser && (
        <Text
          className="mt-1 text-primary-accent dark:text-primary-bright"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 10 }}
        >
          {s.leaderboardYou}
        </Text>
      )}
      <View className="mt-3 min-w-[118px] items-center rounded-3xl px-4 py-2.5" style={{ backgroundColor: scoreBg }}>
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{
            color: scoreColor,
            fontFamily: "NotoSerif_700Bold",
            fontSize: isFirst ? 34 : 30,
            lineHeight: isFirst ? 40 : 36,
          }}
        >
          {entry.score.toLocaleString()}
        </Text>
        <Text
          style={{
            color: isDark ? "#BFB6A8" : "#8B8178",
            fontFamily: "Manrope_700Bold",
            fontSize: 9,
            letterSpacing: 1.1,
            textTransform: "uppercase",
          }}
        >
          {unit}
        </Text>
      </View>
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
  const rowBg = isCurrentUser
    ? (isDark ? "rgba(45, 212, 191, 0.12)" : "rgba(13, 148, 136, 0.08)")
    : (isDark ? "#141414" : "#FAF8F5");
  const scoreBg = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,54,56,0.045)";
  const rankBg = hasMedal
    ? entry.rank === 1
      ? "rgba(245, 194, 75, 0.16)"
      : entry.rank === 2
        ? "rgba(183, 190, 207, 0.18)"
        : "rgba(196, 154, 98, 0.18)"
    : isDark ? "rgba(255,255,255,0.05)" : "rgba(45,45,45,0.04)";

  return (
    <Pressable
      onPress={onPress}
      className="mb-2.5 flex-row items-center rounded-3xl px-4 py-3.5"
      style={{
        direction: "ltr",
        backgroundColor: rowBg,
        borderColor: isCurrentUser ? (isDark ? "rgba(45, 212, 191, 0.22)" : "rgba(13, 148, 136, 0.18)") : "transparent",
        borderWidth: isCurrentUser ? 1 : 0,
      }}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: rankBg }}>
        <Text style={{ fontFamily: "NotoSerif_700Bold", fontSize: 16, color: rankColor }}>
          {entry.rank}
        </Text>
      </View>

      <View className="mx-3 min-w-0 flex-1">
        <View className="flex-row items-center gap-2" style={{ direction: "ltr" }}>
          <View className="min-w-0 flex-1">
            <ProfileIdentity
              displayName={displayName}
              username={entry.username}
              avatarUrl={entry.avatar_url}
              isDark={isDark}
              avatarSize={40}
              nameSize={14}
              handleSize={11}
            />
          </View>
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
      </View>

      <View className="ml-2 min-w-[112px] items-end rounded-2xl px-3 py-2" style={{ backgroundColor: scoreBg }}>
        <View className="flex-row items-center gap-1.5">
          {hasMedal && <Medal size={15} color={medalColor} />}
          {isStreak && <CalendarCheck2 size={14} color={isDark ? "#2dd4bf" : "#0d9488"} />}
          <Text
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: 24, lineHeight: 30, color: scoreColor }}
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
