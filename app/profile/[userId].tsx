import { useMemo } from "react";
import { I18nManager, Platform, ScrollView, View, Text, Pressable, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, UserRound } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PublicBadgesGrid } from "@/components/achievements/PublicBadgesGrid";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { ProfileStatCard } from "@/components/profile/ProfileStatCard";
import { useDatabaseStatus } from "@/lib/database/provider";
import { SettingsProvider, useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { strings } from "@/lib/i18n/strings";
import { fetchPublicAchievementUnlocks, fetchPublicProfile } from "@/lib/leaderboard/api";
import { VIEWPORT_BREAKPOINTS } from "@/lib/ui/viewport";

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
  const { isDark, isRTL, uiLanguage } = useSettings();
  const s = useStrings();
  const router = useRouter();
  const { width } = useWindowDimensions();
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
  const isDesktop = width >= VIEWPORT_BREAKPOINTS.sidebarValidation;
  const contentRailStyle = { width: isDesktop ? "60%" : "100%" } as const;
  const pagePaddingHorizontal = isDesktop ? 32 : 24;
  const textAlign = isRTL ? "right" : "left";
  const writingDirection = isRTL ? "rtl" : "ltr";
  const numberLocale = uiLanguage === "ar" ? "ar" : "en";
  const stats = profile
    ? [
        { label: s.wirdCurrent, value: profile.current_streak },
        { label: s.wirdLongest, value: profile.longest_streak },
        { label: s.flashcardsSummaryReviewed, value: profile.cards_reviewed },
        { label: s.leaderboardPoints, value: profile.total_score },
      ]
    : [];

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <View style={{ alignItems: "center", paddingHorizontal: pagePaddingHorizontal, paddingTop: 8, paddingBottom: 16 }}>
        <View style={contentRailStyle}>
        <View className={`flex-row items-center justify-between ${isRTL ? "flex-row-reverse" : ""}`}>
          <Pressable
            onPress={() => router.back()}
            className="h-10 w-10 items-center justify-center rounded-full bg-surface-high dark:bg-surface-dark-high"
          >
            <ArrowIcon size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
          </Pressable>
        </View>

        <View className={`mt-4 flex-row items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
          <ProfileAvatar avatarUrl={profile?.avatar_url} name={displayName} size={48} isDark={isDark} />
          <View className="flex-1">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28, textAlign, writingDirection }}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            {!!profile?.username && (
              <Text
                className="text-warm-400 dark:text-neutral-500"
                style={{ fontFamily: "Manrope_400Regular", fontSize: 13, textAlign, writingDirection }}
              >
                @{profile.username}
              </Text>
            )}
          </View>
        </View>
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center" style={{ paddingHorizontal: pagePaddingHorizontal }}>
          <Text
            className="text-warm-400 dark:text-neutral-500"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 14 }}
          >
            {s.loading}
          </Text>
        </View>
      ) : !profile ? (
        <View className="flex-1 items-center justify-center" style={{ paddingHorizontal: pagePaddingHorizontal }}>
          <View style={contentRailStyle}>
            <EmptyState
              icon={UserRound}
              title={s.authProfile}
              subtitle={s.errorSubtitle}
              isDark={isDark}
            />
          </View>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ alignItems: "center", paddingHorizontal: pagePaddingHorizontal, paddingBottom: 80 }}
        >
          <View style={contentRailStyle}>
          <View className={`mb-3 flex-row flex-wrap gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
            {stats.map((stat) => (
              <ProfileStatCard
                key={stat.label}
                value={stat.value.toLocaleString(numberLocale)}
                label={stat.label}
                isDark={isDark}
                isRTL={isRTL}
                valueSize={24}
                style={{ width: "48%" }}
              />
            ))}
          </View>

          <Card elevation="low" className="mt-3 p-5">
            <Text
              className="mb-3 text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 16, textAlign, writingDirection }}
            >
              {s.publicBadges}
            </Text>
            <PublicBadgesGrid unlocks={badges} />
          </Card>
          </View>
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
