import { useMemo } from "react";
import { I18nManager, Platform, ScrollView, View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, UserRound } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PublicBadgesGrid } from "@/components/achievements/PublicBadgesGrid";
import { useDatabaseStatus } from "@/lib/database/provider";
import { SettingsProvider, useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { strings } from "@/lib/i18n/strings";
import { fetchPublicAchievementUnlocks, fetchPublicProfile } from "@/lib/leaderboard/api";

const UI_LANGUAGE_CACHE_KEY = "hafiz_ui_language";

export default function PublicProfileScreen() {
  const { isReady, progress, error } = useDatabaseStatus();

  if (error) {
    return <RouteDatabaseError message={error} />;
  }

  if (!isReady) {
    return <LoadingScreen progress={progress} />;
  }

  return (
    <SettingsProvider>
      <PublicProfileContent />
    </SettingsProvider>
  );
}

function PublicProfileContent() {
  const { isDark, isRTL } = useSettings();
  const s = useStrings();
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  const profileId = useMemo(() => (typeof userId === "string" ? userId : ""), [userId]);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["publicProfile", profileId],
    queryFn: () => fetchPublicProfile(profileId),
    enabled: profileId.length > 0,
    staleTime: 1000 * 60 * 2,
  });
  const { data: badges = [] } = useQuery({
    queryKey: ["publicAchievementUnlocks", profileId],
    queryFn: () => fetchPublicAchievementUnlocks(profileId),
    enabled: profileId.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  const displayName = profile?.display_name || profile?.username || s.authProfile;
  const ArrowIcon = isRTL ? ChevronRight : ChevronLeft;

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <View className="px-6 pt-2 pb-4">
        <View className={`flex-row items-center justify-between ${isRTL ? "flex-row-reverse" : ""}`}>
          <Pressable
            onPress={() => router.back()}
            className="h-10 w-10 items-center justify-center rounded-full bg-surface-high dark:bg-surface-dark-high"
          >
            <ArrowIcon size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
          </Pressable>
        </View>

        <View className={`mt-4 flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
          <View className="h-12 w-12 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
            <UserRound size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
          </View>
          <View className="flex-1">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            {!!profile?.username && (
              <Text
                className="text-warm-400 dark:text-neutral-500"
                style={{ fontFamily: "Manrope_400Regular", fontSize: 13 }}
              >
                @{profile.username}
              </Text>
            )}
          </View>
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Text
            className="text-warm-400 dark:text-neutral-500"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 14 }}
          >
            {s.loading}
          </Text>
        </View>
      ) : !profile ? (
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            icon={UserRound}
            title={s.authProfile}
            subtitle={s.errorSubtitle}
            isDark={isDark}
          />
        </View>
      ) : (
        <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 80 }}>
          <View className="flex-row gap-3 mb-3">
            <Card elevation="low" className="flex-1 p-5">
              <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "NotoSerif_700Bold", fontSize: 26 }}>
                {profile.current_streak.toLocaleString()}
              </Text>
              <Text className="text-warm-400 dark:text-neutral-500 mt-1" style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                {s.wirdCurrent}
              </Text>
            </Card>
            <Card elevation="low" className="flex-1 p-5">
              <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "NotoSerif_700Bold", fontSize: 26 }}>
                {profile.longest_streak.toLocaleString()}
              </Text>
              <Text className="text-warm-400 dark:text-neutral-500 mt-1" style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                {s.wirdLongest}
              </Text>
            </Card>
          </View>

          <View className="flex-row gap-3 mb-3">
            <Card elevation="low" className="flex-1 p-5">
              <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "NotoSerif_700Bold", fontSize: 26 }}>
                {profile.cards_reviewed.toLocaleString()}
              </Text>
              <Text className="text-warm-400 dark:text-neutral-500 mt-1" style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                {s.flashcardsSummaryReviewed}
              </Text>
            </Card>
            <Card elevation="low" className="flex-1 p-5">
              <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "NotoSerif_700Bold", fontSize: 26 }}>
                {profile.total_score.toLocaleString()}
              </Text>
              <Text className="text-warm-400 dark:text-neutral-500 mt-1" style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                {s.leaderboardPoints}
              </Text>
            </Card>
          </View>

          <Card elevation="low" className="mt-3 p-5">
            <Text
              className="mb-3 text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 16, textAlign: isRTL ? "right" : "left" }}
            >
              {s.publicBadges}
            </Text>
            <PublicBadgesGrid unlocks={badges} />
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function RouteDatabaseError({ message }: { message: string }) {
  const uiLanguage = getStartupLanguage();
  const s = strings[uiLanguage];

  return (
    <View className="flex-1 items-center justify-center bg-surface px-6 dark:bg-surface-dark">
      <Text className="mb-2 text-red-600" style={{ fontFamily: "Manrope_700Bold", fontSize: 18 }}>
        {s.databaseError}
      </Text>
      <Text className="text-center text-red-500" style={{ fontFamily: "Manrope_400Regular", fontSize: 14 }}>
        {message}
      </Text>
    </View>
  );
}

function getStartupLanguage(): "en" | "ar" {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const cached = window.localStorage.getItem(UI_LANGUAGE_CACHE_KEY);
    if (cached === "en" || cached === "ar") return cached;
  }
  return I18nManager.isRTL ? "ar" : "en";
}
