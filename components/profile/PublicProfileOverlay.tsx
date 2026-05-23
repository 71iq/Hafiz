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
import { ProfileStatCard } from "./ProfileStatCard";

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
            <View className={`flex-row flex-wrap gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
              {stats.map((stat) => (
                <ProfileStatCard
                  key={stat.label}
                  value={stat.value.toLocaleString(numberLocale)}
                  label={stat.label}
                  isDark={isDark}
                  isRTL={isRTL}
                  valueSize={23}
                  style={{ width: "48%" }}
                />
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
