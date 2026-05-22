import { ActivityIndicator, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { PublicBadgesGrid } from "@/components/achievements/PublicBadgesGrid";
import { EmptyState } from "@/components/ui/EmptyState";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { fetchPublicAchievementUnlocks, fetchPublicProfile } from "@/lib/leaderboard/api";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { UserRound } from "lucide-react-native";
import { ProfileAvatar } from "./ProfileAvatar";

type PublicProfileOverlayProps = {
  userId: string | null;
  onClose: () => void;
};

export function PublicProfileOverlay({ userId, onClose }: PublicProfileOverlayProps) {
  const s = useStrings();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const profileQuery = useQuery({
    queryKey: ["publicProfile", userId],
    queryFn: () => fetchPublicProfile(userId ?? ""),
    enabled: !!userId,
    staleTime: 1000 * 60 * 2,
  });
  const badgesQuery = useQuery({
    queryKey: ["publicAchievementUnlocks", userId],
    queryFn: () => fetchPublicAchievementUnlocks(userId ?? ""),
    enabled: !!userId,
    staleTime: 1000 * 60 * 2,
  });
  const profile = profileQuery.data ?? null;
  const displayName = profile?.display_name || profile?.username || s.authProfile;
  const handle = profile?.username ? `@${profile.username}` : "";
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
    <ResponsiveSheet open={!!userId} onClose={onClose} maxWidth={620} dir={isRTL ? "rtl" : "ltr"}>
      <OverlayHeader
        title={displayName}
        subtitle={handle}
        leading={<ProfileAvatar avatarUrl={profile?.avatar_url} name={displayName} size={48} isDark={isDark} />}
        onClose={onClose}
        showHandle
        isRTL={isRTL}
      />
      <OverlayBody contentContainerClassName="px-5 py-5">
        {profileQuery.isLoading ? (
          <View className="items-center justify-center py-10">
            <ActivityIndicator color={isDark ? "#5eead4" : "#003638"} />
          </View>
        ) : !profile ? (
          <EmptyState icon={UserRound} title={s.authProfile} subtitle={s.errorSubtitle} isDark={isDark} />
        ) : (
          <View>
            <View className="flex-row flex-wrap gap-3">
              {stats.map((stat) => (
                <View
                  key={stat.label}
                  className="min-w-[128px] flex-1 rounded-2xl px-4 py-3.5"
                  style={{ backgroundColor: isDark ? "#141414" : "#F7F3EC" }}
                >
                  <Text
                    className="text-charcoal dark:text-neutral-100"
                    style={{ fontFamily: "NotoSerif_700Bold", fontSize: 23, textAlign, writingDirection }}
                  >
                    {stat.value.toLocaleString(numberLocale)}
                  </Text>
                  <Text
                    className="mt-1 text-warm-400 dark:text-neutral-500"
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 11, textAlign, writingDirection }}
                  >
                    {stat.label}
                  </Text>
                </View>
              ))}
            </View>
            <Text
              className="mb-3 mt-5 text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 15, textAlign, writingDirection }}
            >
              {s.publicBadges}
            </Text>
            <PublicBadgesGrid unlocks={badgesQuery.data ?? []} />
          </View>
        )}
      </OverlayBody>
    </ResponsiveSheet>
  );
}
