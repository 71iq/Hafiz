import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { Camera, MapPin, Pencil, Save, Trash2, UserRound, type LucideIcon } from "lucide-react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicBadgesGrid } from "@/components/achievements/PublicBadgesGrid";
import { ActivityHeatmap } from "@/components/progress/ActivityHeatmap";
import { SurahProgressList } from "@/components/progress/SurahProgressList";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { OverlayBody, OverlayHeader, ResponsiveModal, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { getRecentUnlocks } from "@/lib/achievements/queries";
import { useAuthStore } from "@/lib/auth/store";
import { useDatabase } from "@/lib/database/provider";
import { getWirdStatus, getReviewStats } from "@/lib/fsrs/queries";
import { updateProfileStats } from "@/lib/fsrs/leaderboard-sync";
import { getTotalScore } from "@/lib/fsrs/scoring";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { useStrings } from "@/lib/i18n/useStrings";
import {
  fetchPublicAchievementUnlocks,
  fetchPublicProfile,
  fetchPublicReviewActivity,
  fetchPublicSurahProgress,
  type PublicProfile,
} from "@/lib/leaderboard/api";
import { uploadProfileAvatar } from "@/lib/profile/avatar";
import { attachSurahNames, getLocalSurahProgress, type ProfileSurahProgress } from "@/lib/profile/progress";
import { useSettings } from "@/lib/settings/context";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { ProfileAvatar } from "./ProfileAvatar";
import { ProfileNotesManager } from "./ProfileNotesManager";
import { ProfileStatCard } from "./ProfileStatCard";

type ProfileModalContentProps = {
  userId?: string;
};

type ProfileStatsSnapshot = {
  currentStreak: number;
  longestStreak: number;
  cardsReviewed: number;
  totalScore: number;
};

type ReviewSnapshot = {
  activity: { date: string; count: number }[];
  activeDays: number;
  totalReviews: number;
};

type ProfileTab = "overview" | "notes";

const PROFILE_BIO_MAX_LENGTH = 280;
const PROFILE_COUNTRY_MAX_LENGTH = 80;

export function ProfileModalContent({ userId }: ProfileModalContentProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const { width, height } = useWindowDimensions();
  const { user, profile, isLoading: authLoading, updateProfile } = useAuthStore();
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [localStats, setLocalStats] = useState<ProfileStatsSnapshot | null>(null);
  const [localReview, setLocalReview] = useState<ReviewSnapshot>({ activity: [], activeDays: 0, totalReviews: 0 });
  const [localSurahProgress, setLocalSurahProgress] = useState<ProfileSurahProgress[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [countryDraft, setCountryDraft] = useState("");
  const [avatarDraft, setAvatarDraft] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [avatarRemovalDraft, setAvatarRemovalDraft] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState<"saved" | "saveFailed" | "photoFailed" | "permissionDenied" | null>(null);

  const requestedUserId = userId || user?.id || "";
  const isOwnProfile = !!user && (!userId || userId === user.id);
  const isSignedOutOwnProfile = !user && !userId;
  const numberLocale = uiLanguage === "ar" ? "ar" : "en";
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 760);

  const publicProfileQuery = useQuery({
    queryKey: ["publicProfile", requestedUserId],
    queryFn: () => fetchPublicProfile(requestedUserId),
    enabled: !!requestedUserId && !isOwnProfile && !isSignedOutOwnProfile,
    staleTime: 1000 * 60 * 2,
  });

  const publicBadgesQuery = useQuery({
    queryKey: ["publicAchievementUnlocks", requestedUserId],
    queryFn: () => fetchPublicAchievementUnlocks(requestedUserId),
    enabled: !!requestedUserId && !isOwnProfile,
    staleTime: 1000 * 60 * 2,
  });

  const ownBadgesQuery = useQuery({
    queryKey: ["currentUserPublicAchievementUnlocks", user?.id],
    queryFn: () => getRecentUnlocks(db, 100),
    enabled: isOwnProfile,
    staleTime: 1000 * 60,
  });

  const publicActivityQuery = useQuery({
    queryKey: ["publicReviewActivity", requestedUserId],
    queryFn: () => fetchPublicReviewActivity(requestedUserId),
    enabled: !!requestedUserId && !isOwnProfile,
    staleTime: 1000 * 60 * 2,
  });

  const publicSurahProgressQuery = useQuery({
    queryKey: ["publicSurahProgress", requestedUserId],
    queryFn: async () => attachSurahNames(db, await fetchPublicSurahProgress(requestedUserId)),
    enabled: !!requestedUserId && !isOwnProfile,
    staleTime: 1000 * 60 * 2,
  });

  const close = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/home" as any);
  }, [router]);

  const publicProfile = publicProfileQuery.data ?? null;
  const visibleProfile: PublicProfile | null = isOwnProfile
    ? profile
      ? {
          id: profile.id,
          username: profile.username,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          bio: profile.bio,
          country: profile.country,
          total_score: profile.total_score,
          current_streak: profile.current_streak,
          longest_streak: profile.longest_streak,
          cards_reviewed: profile.cards_reviewed,
          last_review_date: profile.last_review_date,
        }
      : null
    : publicProfile;
  const displayName =
    visibleProfile?.display_name ||
    visibleProfile?.username ||
    (isSignedOutOwnProfile ? s.authProfile : s.genericAnonymous);
  const username = visibleProfile?.username ?? null;
  const avatarUrl = visibleProfile?.avatar_url ?? null;
  const bio = visibleProfile?.bio?.trim() ?? "";
  const country = visibleProfile?.country?.trim() ?? "";
  const currentDisplayName = profile?.display_name?.trim() ?? "";
  const displayNameValue = displayNameDraft.trim();
  const displayNameDirty = displayNameValue !== currentDisplayName;
  const currentBio = profile?.bio?.trim() ?? "";
  const bioValue = bioDraft.trim();
  const bioDirty = bioValue !== currentBio;
  const currentCountry = profile?.country?.trim() ?? "";
  const countryValue = countryDraft.trim();
  const countryDirty = countryValue !== currentCountry;
  const bioCount = `${bioDraft.length.toLocaleString(numberLocale)} / ${PROFILE_BIO_MAX_LENGTH.toLocaleString(numberLocale)}`;
  const avatarPreviewUrl = avatarRemovalDraft ? null : avatarDraft?.uri ?? profile?.avatar_url ?? null;
  const avatarDirty = !!avatarDraft || avatarRemovalDraft;
  const profileDirty = displayNameDirty || bioDirty || countryDirty || avatarDirty;
  const saveProfileDisabled = !profileDirty || profileSaving || authLoading;
  const saveProfileIconColor = saveProfileDisabled && !profileSaving ? (isDark ? "#737373" : "#8A7764") : "#FFFFFF";
  const saveProfileTextColor = saveProfileDisabled && !profileSaving ? (isDark ? "#737373" : "#8A7764") : "#FFFFFF";
  const saveProfileBackgroundColor = saveProfileDisabled && !profileSaving
    ? isDark ? "#262626" : "#E6DED5"
    : isDark ? "#0f766e" : "#0d9488";
  const stats = [
    { label: s.wirdCurrent, value: isOwnProfile ? localStats?.currentStreak ?? profile?.current_streak ?? 0 : visibleProfile?.current_streak ?? 0 },
    { label: s.wirdLongest, value: isOwnProfile ? localStats?.longestStreak ?? profile?.longest_streak ?? 0 : visibleProfile?.longest_streak ?? 0 },
    { label: s.flashcardsSummaryReviewed, value: isOwnProfile ? localStats?.cardsReviewed ?? profile?.cards_reviewed ?? 0 : visibleProfile?.cards_reviewed ?? 0 },
    { label: s.leaderboardPoints, value: isOwnProfile ? localStats?.totalScore ?? profile?.total_score ?? 0 : visibleProfile?.total_score ?? 0 },
  ];
  const review = isOwnProfile
    ? localReview
    : publicActivityQuery.data ?? { activity: [], activeDays: 0, totalReviews: 0 };
  const surahProgress = isOwnProfile ? localSurahProgress : publicSurahProgressQuery.data ?? [];
  const publicBadges = isOwnProfile ? ownBadgesQuery.data ?? [] : publicBadgesQuery.data ?? [];
  const loadingPublic = !isOwnProfile && !isSignedOutOwnProfile && publicProfileQuery.isLoading;
  const statusMessage =
    profileStatus === "saved"
      ? s.profileSaved
      : profileStatus === "permissionDenied"
        ? s.profilePhotoPermissionDenied
        : profileStatus === "photoFailed"
          ? s.profilePhotoFailed
          : profileStatus === "saveFailed"
            ? s.profileSaveFailed
            : "";

  useEffect(() => {
    setDisplayNameDraft(profile?.display_name ?? "");
    setBioDraft(profile?.bio ?? "");
    setCountryDraft(profile?.country ?? "");
  }, [profile?.bio, profile?.country, profile?.display_name, user?.id]);

  useEffect(() => {
    setAvatarDraft(null);
    setAvatarRemovalDraft(false);
  }, [user?.id]);

  const loadLocalOverview = useCallback(async () => {
    if (!user) return;
    const [wirdStatus, totalScore, cardsReviewedRow, reviewStats, surahs] = await Promise.all([
      getWirdStatus(db),
      getTotalScore(db),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM study_log"),
      getReviewStats(db),
      getLocalSurahProgress(db),
    ]);
    setLocalStats({
      currentStreak: wirdStatus.currentDays,
      longestStreak: wirdStatus.longestDays,
      cardsReviewed: cardsReviewedRow?.count ?? 0,
      totalScore,
    });
    setLocalReview({
      activity: reviewStats.activity,
      activeDays: reviewStats.activeDays,
      totalReviews: reviewStats.totalReviews,
    });
    setLocalSurahProgress(surahs);
  }, [db, user]);

  const invalidateProfileSurfaces = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["publicProfile"] });
    queryClient.invalidateQueries({ queryKey: ["reflectionFeed"] });
    queryClient.invalidateQueries({ queryKey: ["reflections"] });
    queryClient.invalidateQueries({ queryKey: ["reflectionComments"] });
    queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
  }, [queryClient]);

  useFocusEffect(
    useCallback(() => {
      if (!isOwnProfile) return;
      loadLocalOverview().catch(console.warn);
      updateProfileStats(db).catch(console.warn);
    }, [db, isOwnProfile, loadLocalOverview])
  );

  useEffect(() => {
    if (!isOwnProfile) return;
    return subscribeReviewActivity(() => {
      loadLocalOverview().catch(console.warn);
      updateProfileStats(db).catch(console.warn);
      queryClient.invalidateQueries({ queryKey: ["publicReviewActivity", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["publicSurahProgress", user?.id] });
    });
  }, [db, isOwnProfile, loadLocalOverview, queryClient, user?.id]);

  const handleSaveProfile = useCallback(async () => {
    if (!user || !profileDirty) return;
    setProfileSaving(true);
    setProfileStatus(null);
    try {
      const nextAvatarUrl = avatarDraft ? await uploadProfileAvatar(user.id, avatarDraft) : avatarRemovalDraft ? null : undefined;
      const updated = await updateProfile({
        displayName: displayNameDirty ? (displayNameValue.length > 0 ? displayNameValue : null) : undefined,
        bio: bioDirty ? (bioValue.length > 0 ? bioValue : null) : undefined,
        country: countryDirty ? (countryValue.length > 0 ? countryValue : null) : undefined,
        avatarUrl: avatarDirty ? nextAvatarUrl : undefined,
      });
      setAvatarDraft(null);
      setAvatarRemovalDraft(false);
      queryClient.setQueryData(["publicProfile", user.id], updated);
      invalidateProfileSurfaces();
      setProfileStatus("saved");
    } catch (e) {
      console.warn("[Profile] Failed to update profile:", e);
      setProfileStatus(avatarDirty ? "photoFailed" : "saveFailed");
    } finally {
      setProfileSaving(false);
    }
  }, [avatarDirty, avatarDraft, avatarRemovalDraft, bioDirty, bioValue, countryDirty, countryValue, displayNameDirty, displayNameValue, invalidateProfileSurfaces, profileDirty, queryClient, updateProfile, user]);

  const handlePickAvatar = useCallback(async () => {
    if (!user) return;
    setProfileStatus(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setProfileStatus("permissionDenied");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.82,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;

    setAvatarDraft(asset);
    setAvatarRemovalDraft(false);
  }, [user]);

  const handleRemoveAvatar = useCallback(async () => {
    if (!user || (!profile?.avatar_url && !avatarDraft)) return;
    setProfileStatus(null);
    setAvatarDraft(null);
    setAvatarRemovalDraft(!!profile?.avatar_url);
  }, [avatarDraft, profile?.avatar_url, user]);

  const tabs = useMemo(
    () => isOwnProfile ? [
      { key: "overview" as const, label: s.profileOverviewTab },
      { key: "notes" as const, label: s.profileNotesTab },
    ] : [],
    [isOwnProfile, s.profileNotesTab, s.profileOverviewTab]
  );

  const headerActions = isOwnProfile && user ? (
    <View className={`items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
      <HeaderAction icon={Pencil} label={s.profileEditAction} color={isDark ? "#2dd4bf" : "#0d9488"} onPress={() => setEditOpen(true)} />
    </View>
  ) : null;

  return (
    <>
      <ResponsiveSheet
        open
        onClose={close}
        maxWidth={880}
        maxHeight={maxOverlayHeight}
        surfaceColor={isDark ? "#0A0A0A" : "#FFF8F1"}
        dir={isRTL ? "rtl" : "ltr"}
      >
        <OverlayHeader
          title={displayName}
          subtitle={username ? `@${username}` : undefined}
          leading={
            visibleProfile ? (
              <ProfileAvatar avatarUrl={avatarUrl} name={displayName} size={56} isDark={isDark} />
            ) : (
              <View className="h-12 w-12 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
                <UserRound size={22} color={isDark ? "#2dd4bf" : "#0d9488"} />
              </View>
            )
          }
          actions={headerActions}
          onClose={close}
          showHandle={isPhone}
          isRTL={isRTL}
        />

        <OverlayBody contentContainerClassName="px-5 py-5">
          {isSignedOutOwnProfile ? (
            <SignedOutProfile isDark={isDark} isRTL={isRTL} onClose={close} />
          ) : loadingPublic ? (
            <View className="items-center justify-center py-12">
              <ActivityIndicator color={isDark ? "#5eead4" : "#003638"} />
            </View>
          ) : !visibleProfile ? (
            <EmptyState icon={UserRound} title={s.authProfile} subtitle={s.errorSubtitle} isDark={isDark} />
          ) : (
            <View className="gap-5">
              {tabs.length > 0 ? (
                <View className={`rounded-full bg-surface-high p-1 dark:bg-surface-dark-high ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
                  {tabs.map((tab) => {
                    const active = activeTab === tab.key;
                    return (
                      <Pressable
                        key={tab.key}
                        onPress={() => setActiveTab(tab.key)}
                        className="h-10 flex-1 items-center justify-center rounded-full"
                        style={{
                          backgroundColor: active ? (isDark ? "#1B4D4F" : "#003638") : "transparent",
                        }}
                      >
                        <Text
                          style={{
                            color: active ? "#FDDC91" : isDark ? "#a3a3a3" : "#6e5a47",
                            fontFamily: active ? "Manrope_700Bold" : "Manrope_500Medium",
                            fontSize: 13,
                          }}
                        >
                          {tab.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {activeTab === "notes" && isOwnProfile ? (
                <ProfileNotesManager />
              ) : (
                <ProfileOverview
                  bio={bio}
                  country={country}
                  stats={stats}
                  review={review}
                  surahProgress={surahProgress}
                  publicBadges={publicBadges}
                  numberLocale={numberLocale}
                  isOwnProfile={isOwnProfile}
                  isDark={isDark}
                  isRTL={isRTL}
                />
              )}
            </View>
          )}
        </OverlayBody>
      </ResponsiveSheet>

      <ResponsiveModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        maxWidth={520}
        surfaceColor={isDark ? "#0A0A0A" : "#FFF8F1"}
        dir={isRTL ? "rtl" : "ltr"}
        avoidKeyboard
      >
        <OverlayHeader title={s.profileEditTitle} subtitle={s.profileEditSubtitle} onClose={() => setEditOpen(false)} isRTL={isRTL} />
        <OverlayBody contentContainerClassName="gap-4 px-5 py-5">
          <View className={`items-center gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
            <ProfileAvatar avatarUrl={avatarPreviewUrl} name={displayName} size={58} isDark={isDark} />
            <View className="min-w-0 flex-1">
              <Text
                className="text-warm-500 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
              >
                {s.authDisplayName}
              </Text>
              <Input
                value={displayNameDraft}
                onChangeText={(value) => {
                  setDisplayNameDraft(value);
                  setProfileStatus(null);
                }}
                placeholder={s.profileDisplayNamePlaceholder}
                maxLength={60}
                dir={isRTL ? "rtl" : "ltr"}
                className="mt-1 min-h-8 bg-transparent px-2 py-0"
                style={{ height: 32, lineHeight: 20 }}
              />
            </View>
          </View>
          <View className={`gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
            <Button
              variant="outline"
              className="flex-1 gap-2 bg-surface-high dark:bg-surface-dark-high"
              onPress={handlePickAvatar}
              disabled={profileSaving || authLoading}
            >
              <Camera size={16} color={isDark ? "#5eead4" : "#003638"} />
              <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                {s.profileChangePhoto}
              </Text>
            </Button>
            {avatarPreviewUrl ? (
              <Button
                variant="outline"
                size="icon"
                className="bg-surface-high dark:bg-surface-dark-high"
                onPress={handleRemoveAvatar}
                disabled={profileSaving || authLoading}
              >
                <Trash2 size={16} color={isDark ? "#fca5a5" : "#dc2626"} />
              </Button>
            ) : null}
          </View>
          <View>
            <View className={`mb-1 items-center justify-between gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
              <Text
                className="text-warm-500 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
              >
                {s.profileBioTitle}
              </Text>
              <Text
                className="text-warm-500 dark:text-neutral-500"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 11, textAlign: isRTL ? "left" : "right" }}
              >
                {bioCount}
              </Text>
            </View>
            <Input
              value={bioDraft}
              onChangeText={(value) => {
                setBioDraft(value);
                setProfileStatus(null);
              }}
              placeholder={s.profileBioPlaceholder}
              maxLength={PROFILE_BIO_MAX_LENGTH}
              multiline
              dir={isRTL ? "rtl" : "ltr"}
              className="min-h-[104px] rounded-2xl bg-surface-high dark:bg-surface-dark-high"
              style={{ lineHeight: 21 }}
            />
          </View>
          <View>
            <Text
              className="mb-1 text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
            >
              {s.profileCountryTitle}
            </Text>
            <Input
              value={countryDraft}
              onChangeText={(value) => {
                setCountryDraft(value);
                setProfileStatus(null);
              }}
              placeholder={s.profileCountryPlaceholder}
              maxLength={PROFILE_COUNTRY_MAX_LENGTH}
              dir={isRTL ? "rtl" : "ltr"}
              className="bg-surface-high dark:bg-surface-dark-high"
            />
          </View>
          <Button
            className="gap-2"
            onPress={handleSaveProfile}
            disabled={saveProfileDisabled}
            style={{ backgroundColor: saveProfileBackgroundColor, opacity: saveProfileDisabled && !profileSaving ? 1 : undefined }}
          >
            {profileSaving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Save size={16} color={saveProfileIconColor} />}
            <Text style={{ color: saveProfileTextColor, fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
              {s.profileSave}
            </Text>
          </Button>
          {statusMessage ? (
            <Text
              className={profileStatus === "saved" ? "text-primary-accent dark:text-primary-bright" : "text-red-600 dark:text-red-400"}
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 12,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {statusMessage}
            </Text>
          ) : null}
        </OverlayBody>
      </ResponsiveModal>

    </>
  );
}

function ProfileOverview({
  bio,
  country,
  stats,
  review,
  surahProgress,
  publicBadges,
  numberLocale,
  isOwnProfile,
  isDark,
  isRTL,
}: {
  bio: string;
  country: string;
  stats: { label: string; value: number }[];
  review: ReviewSnapshot;
  surahProgress: ProfileSurahProgress[];
  publicBadges: any[];
  numberLocale: string;
  isOwnProfile: boolean;
  isDark: boolean;
  isRTL: boolean;
}) {
  const s = useStrings();
  const { width } = useWindowDimensions();
  const isWideActivity = width >= SIDEBAR_BREAKPOINT;
  const activityStats = [
    ...stats,
    { label: s.heatmapActiveDays, value: review.activeDays },
    { label: s.heatmapTotalReviews, value: review.totalReviews },
  ];

  return (
    <View className="gap-5">
      {country ? (
        <Card elevation="low" className="p-5">
          <View className={`items-center gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
            <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
              <MapPin size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
            </View>
            <View className="min-w-0 flex-1">
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_700Bold", fontSize: 15, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {s.profileCountryTitle}
              </Text>
              <Text
                selectable
                className="mt-0.5 text-warm-700 dark:text-neutral-300"
                style={{ fontFamily: "Manrope_400Regular", fontSize: 14, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {country}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {bio ? (
        <Card elevation="low" className="p-5">
          <Text
            className="mb-2 text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 16, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {s.profileBioTitle}
          </Text>
          <Text
            selectable
            className="text-warm-700 dark:text-neutral-300"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 22, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {bio}
          </Text>
        </Card>
      ) : null}

      <Card elevation="low" className="p-5">
        <Text
          className="mb-4 text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 16, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
        >
          {s.progressActivity}
        </Text>
        <View
          className="gap-5"
          style={{
            flexDirection: isWideActivity ? (isRTL ? "row-reverse" : "row") : "column",
            alignItems: "stretch",
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <ActivityHeatmap
              data={review.activity}
              isDark={isDark}
              s={s}
              isRTL={isRTL}
              activeDays={review.activeDays}
              totalReviews={review.totalReviews}
              showSummaryStats={false}
            />
          </View>
          <ProfileActivityStats
            items={activityStats}
            numberLocale={numberLocale}
            isDark={isDark}
            isWide={isWideActivity}
            isRTL={isRTL}
          />
        </View>
      </Card>

      <View>
        <Text
          className="mb-3 text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 16, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
        >
          {s.progressSurahProgress}
        </Text>
        <SurahProgressList data={surahProgress} isDark={isDark} isRTL={isRTL} previewLimit={8} readOnly={!isOwnProfile} s={s} />
      </View>

      <Card elevation="low" className="p-5">
        <Text
          className="mb-3 text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 16, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
        >
          {s.publicBadges}
        </Text>
        <PublicBadgesGrid unlocks={publicBadges} />
      </Card>
    </View>
  );
}

function ProfileActivityStats({
  items,
  numberLocale,
  isDark,
  isWide,
  isRTL,
}: {
  items: { label: string; value: number }[];
  numberLocale: string;
  isDark: boolean;
  isWide: boolean;
  isRTL: boolean;
}) {
  return (
    <View
      className="gap-3"
      style={{
        width: isWide ? 360 : "100%",
        flexDirection: isRTL ? "row-reverse" : "row",
        flexWrap: "wrap",
        alignContent: "flex-start",
        justifyContent: "space-between",
      }}
    >
      {items.map((item) => (
        <ProfileStatCard
          key={item.label}
          value={item.value.toLocaleString(numberLocale)}
          label={item.label}
          isDark={isDark}
          isRTL={isRTL}
          valueSize={18}
          style={{ width: isWide ? 174 : "48%" }}
        />
      ))}
    </View>
  );
}

function SignedOutProfile({ isDark, isRTL, onClose }: { isDark: boolean; isRTL: boolean; onClose: () => void }) {
  const router = useRouter();
  const s = useStrings();
  return (
    <View className="gap-4">
      <EmptyState icon={UserRound} title={s.profileSignedOutTitle} subtitle={s.profileSignedOutSubtitle} isDark={isDark} />
      <View className="gap-2">
        <Button
          onPress={() => {
            onClose();
            router.push("/auth/login" as any);
          }}
        >
          <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}>
            {s.authLogin}
          </Text>
        </Button>
        <Button
          variant="outline"
          onPress={() => {
            onClose();
            router.push("/auth/signup" as any);
          }}
        >
          <Text
            className="text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, textAlign: isRTL ? "right" : "left" }}
          >
            {s.authSignup}
          </Text>
        </Button>
      </View>
    </View>
  );
}

function HeaderAction({
  icon: Icon,
  label,
  color,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="h-9 w-9 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
      style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
    >
      <Icon size={17} color={color} />
    </Pressable>
  );
}
