import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, I18nManager, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { Camera, ChevronLeft, ChevronRight, LogOut, Save, Trash2, UserRound } from "lucide-react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicBadgesGrid } from "@/components/achievements/PublicBadgesGrid";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { ProfileNotesManager } from "@/components/profile/ProfileNotesManager";
import { getRecentUnlocks } from "@/lib/achievements/queries";
import { useDatabase, useDatabaseStatus } from "@/lib/database/provider";
import { SettingsProvider, useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { strings } from "@/lib/i18n/strings";
import { useAuthStore } from "@/lib/auth/store";
import { getWirdStatus } from "@/lib/fsrs/queries";
import { getTotalScore } from "@/lib/fsrs/scoring";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { updateProfileStats } from "@/lib/fsrs/leaderboard-sync";
import { uploadProfileAvatar } from "@/lib/profile/avatar";

const UI_LANGUAGE_CACHE_KEY = "hafiz_ui_language";

type ProfileStatsSnapshot = {
  currentStreak: number;
  longestStreak: number;
  cardsReviewed: number;
  totalScore: number;
};

export default function ProfileScreen() {
  const { isReady, progress, error } = useDatabaseStatus();

  if (error) {
    return <RouteDatabaseError message={error} />;
  }

  if (!isReady) {
    return <LoadingScreen progress={progress} />;
  }

  return (
    <SettingsProvider>
      <ProfileScreenContent />
    </SettingsProvider>
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

function ProfileScreenContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const s = useStrings();
  const db = useDatabase();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const { width } = useWindowDimensions();
  const { user, profile, isLoading: authLoading, signOut, updateProfile } = useAuthStore();
  const [logoutDialogVisible, setLogoutDialogVisible] = useState(false);
  const [localStats, setLocalStats] = useState<ProfileStatsSnapshot | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [profileStatus, setProfileStatus] = useState<"saved" | "saveFailed" | "photoFailed" | "permissionDenied" | null>(null);
  const maxWidth = Math.min(width, 880);
  const ArrowIcon = isRTL ? ChevronRight : ChevronLeft;
  const accountName = profile?.display_name || profile?.username || user?.email || s.authProfile;
  const accountHandle = profile?.username ? `@${profile.username}` : user?.email || s.profileLocalOnly;
  const numberLocale = uiLanguage === "ar" ? "ar" : "en";
  const { data: publicBadges = [] } = useQuery({
    queryKey: ["currentUserPublicAchievementUnlocks", user?.id],
    queryFn: () => getRecentUnlocks(db, 100),
    enabled: !!user,
    staleTime: 1000 * 60,
  });
  const avatarUrl = profile?.avatar_url ?? null;
  const currentDisplayName = profile?.display_name ?? "";
  const displayNameValue = displayNameDraft.trim();
  const displayNameDirty = displayNameValue !== currentDisplayName;
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
  }, [profile?.display_name, user?.id]);

  const loadLocalStats = useCallback(async () => {
    const [wirdStatus, totalScore, cardsReviewedRow] = await Promise.all([
      getWirdStatus(db),
      getTotalScore(db),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM study_log"),
    ]);
    setLocalStats({
      currentStreak: wirdStatus.currentDays,
      longestStreak: wirdStatus.longestDays,
      cardsReviewed: cardsReviewedRow?.count ?? 0,
      totalScore,
    });
  }, [db]);

  const invalidateProfileSurfaces = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["publicProfile"] });
    queryClient.invalidateQueries({ queryKey: ["reflectionFeed"] });
    queryClient.invalidateQueries({ queryKey: ["reflections"] });
    queryClient.invalidateQueries({ queryKey: ["reflectionComments"] });
    queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
  }, [queryClient]);

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setLocalStats(null);
        return;
      }
      loadLocalStats().catch(console.warn);
      updateProfileStats(db).catch(console.warn);
    }, [db, loadLocalStats, user])
  );

  useEffect(() => {
    if (!user) return;
    return subscribeReviewActivity(() => {
      loadLocalStats().catch(console.warn);
      updateProfileStats(db).catch(console.warn);
    });
  }, [db, loadLocalStats, user]);

  const stats = [
    { label: s.wirdCurrent, value: localStats?.currentStreak ?? profile?.current_streak ?? 0 },
    { label: s.wirdLongest, value: localStats?.longestStreak ?? profile?.longest_streak ?? 0 },
    { label: s.flashcardsSummaryReviewed, value: localStats?.cardsReviewed ?? profile?.cards_reviewed ?? 0 },
    { label: s.leaderboardPoints, value: localStats?.totalScore ?? profile?.total_score ?? 0 },
  ];
  const handleLogout = useCallback(async () => {
    setLogoutDialogVisible(false);
    await signOut();
  }, [signOut]);
  const handleSaveProfile = useCallback(async () => {
    if (!user || !displayNameDirty) return;
    setProfileSaving(true);
    setProfileStatus(null);
    try {
      await updateProfile({ displayName: displayNameValue.length > 0 ? displayNameValue : null });
      invalidateProfileSurfaces();
      setProfileStatus("saved");
    } catch (e) {
      console.warn("[Profile] Failed to update profile:", e);
      setProfileStatus("saveFailed");
    } finally {
      setProfileSaving(false);
    }
  }, [displayNameDirty, displayNameValue, invalidateProfileSurfaces, updateProfile, user]);
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

    setAvatarUploading(true);
    try {
      const nextAvatarUrl = await uploadProfileAvatar(user.id, asset);
      await updateProfile({ avatarUrl: nextAvatarUrl });
      invalidateProfileSurfaces();
      setProfileStatus("saved");
    } catch (e) {
      console.warn("[Profile] Failed to update avatar:", e);
      setProfileStatus("photoFailed");
    } finally {
      setAvatarUploading(false);
    }
  }, [invalidateProfileSurfaces, updateProfile, user]);
  const handleRemoveAvatar = useCallback(async () => {
    if (!user || !avatarUrl) return;
    setAvatarUploading(true);
    setProfileStatus(null);
    try {
      await updateProfile({ avatarUrl: null });
      invalidateProfileSurfaces();
      setProfileStatus("saved");
    } catch (e) {
      console.warn("[Profile] Failed to remove avatar:", e);
      setProfileStatus("photoFailed");
    } finally {
      setAvatarUploading(false);
    }
  }, [avatarUrl, invalidateProfileSurfaces, updateProfile, user]);

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          alignItems: "center",
          paddingHorizontal: 24,
          paddingTop: 10,
          paddingBottom: 56,
        }}
      >
        <View style={{ width: "100%", maxWidth }}>
          <View className={`items-center justify-between ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
            <Pressable
              onPress={() => router.back()}
              className="h-10 w-10 items-center justify-center rounded-full bg-surface-high dark:bg-surface-dark-high"
            >
              <ArrowIcon size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
            </Pressable>
          </View>

          <View className={`mt-5 items-center gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
            {user ? (
              <ProfileAvatar avatarUrl={avatarUrl} name={accountName} size={56} isDark={isDark} />
            ) : (
              <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
                <UserRound size={24} color={isDark ? "#2dd4bf" : "#0d9488"} />
              </View>
            )}
            <View className="min-w-0 flex-1">
              <Text
                className="text-charcoal dark:text-neutral-100"
                numberOfLines={1}
                style={{
                  fontFamily: "NotoSerif_700Bold",
                  fontSize: 30,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {accountName}
              </Text>
              <Text
                className="mt-0.5 text-warm-400 dark:text-neutral-500"
                numberOfLines={1}
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 13,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {accountHandle}
              </Text>
            </View>
          </View>

          {!user && (
            <Card elevation="low" className="mt-5 p-5">
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{
                  fontFamily: "Manrope_700Bold",
                  fontSize: 16,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.profileSignedOutTitle}
              </Text>
              <Text
                className="mt-1 text-warm-400 dark:text-neutral-500"
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 13,
                  lineHeight: 19,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.profileSignedOutSubtitle}
              </Text>
              <View className="mt-4 gap-2">
                <Button onPress={() => router.push("/auth/login" as any)} disabled={authLoading}>
                  <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}>
                    {s.authLogin}
                  </Text>
                </Button>
                <Button variant="outline" onPress={() => router.push("/auth/signup" as any)} disabled={authLoading}>
                  <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}>
                    {s.authSignup}
                  </Text>
                </Button>
              </View>
            </Card>
          )}

          {user && (
            <>
              <Card elevation="low" className="mt-5 p-5">
                <View className={`items-center gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
                  <ProfileAvatar avatarUrl={avatarUrl} name={accountName} size={58} isDark={isDark} />
                  <View className="min-w-0 flex-1">
                    <Text
                      className="text-charcoal dark:text-neutral-100"
                      style={{
                        fontFamily: "Manrope_700Bold",
                        fontSize: 16,
                        textAlign: isRTL ? "right" : "left",
                        writingDirection: isRTL ? "rtl" : "ltr",
                      }}
                    >
                      {s.profileEditTitle}
                    </Text>
                    <Text
                      className="mt-1 text-warm-400 dark:text-neutral-500"
                      style={{
                        fontFamily: "Manrope_400Regular",
                        fontSize: 12,
                        lineHeight: 18,
                        textAlign: isRTL ? "right" : "left",
                        writingDirection: isRTL ? "rtl" : "ltr",
                      }}
                    >
                      {s.profileEditSubtitle}
                    </Text>
                  </View>
                </View>
                <View className="mt-4 gap-3">
                  <View>
                    <Text
                      className="mb-1.5 text-warm-500 dark:text-neutral-400"
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        fontSize: 12,
                        textAlign: isRTL ? "right" : "left",
                        writingDirection: isRTL ? "rtl" : "ltr",
                      }}
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
                    />
                  </View>
                  <View className={`gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
                    <Button
                      variant="outline"
                      className="flex-1 gap-2 bg-surface-high dark:bg-surface-dark-high"
                      onPress={handlePickAvatar}
                      disabled={avatarUploading || authLoading}
                    >
                      {avatarUploading ? (
                        <ActivityIndicator size="small" color={isDark ? "#5eead4" : "#003638"} />
                      ) : (
                        <Camera size={16} color={isDark ? "#5eead4" : "#003638"} />
                      )}
                      <Text
                        className="text-charcoal dark:text-neutral-200"
                        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
                      >
                        {s.profileChangePhoto}
                      </Text>
                    </Button>
                    {avatarUrl ? (
                      <Button
                        variant="outline"
                        size="icon"
                        className="bg-surface-high dark:bg-surface-dark-high"
                        onPress={handleRemoveAvatar}
                        disabled={avatarUploading || authLoading}
                      >
                        <Trash2 size={16} color={isDark ? "#fca5a5" : "#dc2626"} />
                      </Button>
                    ) : null}
                  </View>
                  <Button
                    className="gap-2"
                    onPress={handleSaveProfile}
                    disabled={!displayNameDirty || profileSaving || authLoading}
                  >
                    {profileSaving ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Save size={16} color="#FFFFFF" />
                    )}
                    <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
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
                </View>
              </Card>

              <View className="mt-5 flex-row flex-wrap gap-3">
                {stats.map((stat) => (
                  <Card key={stat.label} elevation="low" className="min-w-[150px] flex-1 p-5">
                    <Text
                      className="text-charcoal dark:text-neutral-100"
                      style={{ fontFamily: "NotoSerif_700Bold", fontSize: 26, textAlign: isRTL ? "right" : "left" }}
                    >
                      {stat.value.toLocaleString(numberLocale)}
                    </Text>
                    <Text
                      className="mt-1 text-warm-400 dark:text-neutral-500"
                      style={{
                        fontFamily: "Manrope_500Medium",
                        fontSize: 11,
                        textAlign: isRTL ? "right" : "left",
                        writingDirection: isRTL ? "rtl" : "ltr",
                      }}
                    >
                      {stat.label}
                    </Text>
                  </Card>
                ))}
              </View>

              <Card elevation="low" className="mt-5 p-5">
                <Text
                  className="mb-3 text-charcoal dark:text-neutral-100"
                  style={{
                    fontFamily: "Manrope_700Bold",
                    fontSize: 16,
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {s.publicBadges}
                </Text>
                <PublicBadgesGrid unlocks={publicBadges} />
              </Card>

              <Pressable
                onPress={() => setLogoutDialogVisible(true)}
                disabled={authLoading}
                className="mt-5 flex-row items-center justify-center gap-2 rounded-full bg-surface-high py-3 dark:bg-surface-dark-high"
                style={({ pressed }) => ({ opacity: authLoading ? 0.5 : pressed ? 0.7 : 1 })}
              >
                <LogOut size={16} color={isDark ? "#ef4444" : "#dc2626"} />
                <Text
                  className="text-red-600 dark:text-red-400"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
                >
                  {s.authLogout}
                </Text>
              </Pressable>
            </>
          )}

          <Card elevation="surface" className="mt-5 p-5">
            <ProfileNotesManager />
          </Card>
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={logoutDialogVisible}
        title={s.authLogout}
        message={s.authLogoutConfirm}
        cancelLabel={s.flashcardsCancel}
        confirmLabel={s.authLogout}
        destructive
        isDark={isDark}
        isRTL={isRTL}
        onCancel={() => setLogoutDialogVisible(false)}
        onConfirm={handleLogout}
      />
    </SafeAreaView>
  );
}
