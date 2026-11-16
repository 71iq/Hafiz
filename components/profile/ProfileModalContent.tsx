import { reflectionQueryKeys } from "@/lib/reflections/query-keys";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { authCommands } from "@/lib/auth/commands";
import { getAuthSessionIdentity, isAccountId } from "@/lib/auth/session-identity";
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Camera, Check, ChevronDown, MapPin, Pencil, Save, Search, Trash2, UserRound, X, type LucideIcon } from "lucide-react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicBadgesGrid } from "@/components/achievements/PublicBadgesGrid";
import { ActivityHeatmap } from "@/components/progress/ActivityHeatmap";
import { DefaultDeckProgressChart } from "@/components/progress/DefaultDeckProgressChart";
import { SurahProgressList } from "@/components/progress/SurahProgressList";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { OverlayBody, OverlayHeader, ResponsiveModal, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { getRecentUnlocks } from "@/lib/achievements/queries";
import { isEmailAuthFlowsEnabled } from "@/lib/auth/config";
import { useAuthStore } from "@/lib/auth/store";
import { useDatabase } from "@/lib/database/provider";
import { loadStudyMetrics } from "@/lib/progress/metrics";
import { loadHabitOverview } from "@/lib/habit/queries";
import { longestStreak, toDayMap } from "@/lib/habit/streak";
import { updateProfileStats } from "@/lib/fsrs/leaderboard-sync";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { useStrings } from "@/lib/i18n/useStrings";
import { fetchPublicAchievementUnlocks, fetchPublicProfile, type PublicProfile } from "@/lib/leaderboard/api";
import { uploadProfileAvatar, validateAvatarAsset, type AvatarProblem } from "@/lib/profile/avatar";
import { neutralProfileName } from "@/lib/profile/identity";
import { useSyncRestorePause } from "@/lib/sync/restore-consent";
import { DiscardChangesDialog, useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { useOptionalOperationNotice } from "@/components/ui/OperationNoticeProvider";
import { fetchProfilePrivacy, fetchProfileSummary, profilePrivacyKeys } from "@/lib/profile/privacy";
import { requireSocialOwner } from "@/lib/social/owner";
import { isSupabaseConfigured } from "@/lib/supabase";
import { captureAuthReturn } from "@/lib/auth/return-origin";
import { socialFailureOf } from "@/lib/social/remote";
import {
  getDefaultDeckProgress,
  getLocalSurahProgress,
  summarizeSurahProgress,
  type DefaultDeckProgressItem,
  type ProfileSurahProgress,
} from "@/lib/profile/progress";
import { useSettings } from "@/lib/settings/context";
import type { UILanguage } from "@/lib/settings/context";
import { subscribeSyncCompleted } from "@/lib/sync/events";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { cn } from "@/lib/utils";
import { ProfileAvatar } from "./ProfileAvatar";
import { ProfileNotesManager } from "./ProfileNotesManager";
import { ProfileStatCard } from "./ProfileStatCard";
import { textStartStyle, textEndStyle } from "@/lib/ui/direction";

type ProfileModalContentProps = {
  userId?: string;
};

type ProfileStatsSnapshot = {
  currentStreak: number;
  longestStreak: number;
  cardsReviewed: number;
};

type ReviewSnapshot = {
  activity: { date: string; count: number }[];
  activeDays: number;
  totalReviews: number;
  memorizedAyahCards: number;
};

type ProfileTab = "overview" | "notes";

const PROFILE_BIO_MAX_LENGTH = 280;
const PROFILE_COUNTRY_MAX_LENGTH = 80;
const EDIT_PROFILE_MODAL_MAX_WIDTH = 780;
const EDIT_PROFILE_AVATAR_SIZE = 118;
const EDIT_PROFILE_AVATAR_SIZE_PHONE = 88;
const PROFILE_BADGE_PREVIEW_LIMIT = 12;
const PROFILE_SURAH_PREVIEW_LIMIT = 8;

const COUNTRY_REGION_CODES = [
  "AF", "AX", "AL", "DZ", "AS", "AD", "AO", "AI", "AQ", "AG", "AR", "AM", "AW", "AU", "AT", "AZ", "BS", "BH",
  "BD", "BB", "BY", "BE", "BZ", "BJ", "BM", "BT", "BO", "BQ", "BA", "BW", "BV", "BR", "IO", "BN", "BG", "BF",
  "BI", "KH", "CM", "CA", "CV", "KY", "CF", "TD", "CL", "CN", "CX", "CC", "CO", "KM", "CG", "CD", "CK", "CR",
  "CI", "HR", "CU", "CW", "CY", "CZ", "DK", "DJ", "DM", "DO", "EC", "EG", "SV", "GQ", "ER", "EE", "SZ", "ET",
  "FK", "FO", "FJ", "FI", "FR", "GF", "PF", "TF", "GA", "GM", "GE", "DE", "GH", "GI", "GR", "GL", "GD", "GP",
  "GU", "GT", "GG", "GN", "GW", "GY", "HT", "HM", "VA", "HN", "HK", "HU", "IS", "IN", "ID", "IR", "IQ", "IE",
  "IM", "IL", "IT", "JM", "JP", "JE", "JO", "KZ", "KE", "KI", "KP", "KR", "KW", "KG", "LA", "LV", "LB", "LS",
  "LR", "LY", "LI", "LT", "LU", "MO", "MG", "MW", "MY", "MV", "ML", "MT", "MH", "MQ", "MR", "MU", "YT", "MX",
  "FM", "MD", "MC", "MN", "ME", "MS", "MA", "MZ", "MM", "NA", "NR", "NP", "NL", "NC", "NZ", "NI", "NE", "NG",
  "NU", "NF", "MK", "MP", "NO", "OM", "PK", "PW", "PS", "PA", "PG", "PY", "PE", "PH", "PN", "PL", "PT", "PR",
  "QA", "RE", "RO", "RU", "RW", "BL", "SH", "KN", "LC", "MF", "PM", "VC", "WS", "SM", "ST", "SA", "SN", "RS",
  "SC", "SL", "SG", "SX", "SK", "SI", "SB", "SO", "ZA", "GS", "SS", "ES", "LK", "SD", "SR", "SJ", "SE", "CH",
  "SY", "TW", "TJ", "TZ", "TH", "TL", "TG", "TK", "TO", "TT", "TN", "TR", "TM", "TC", "TV", "UG", "UA", "AE",
  "GB", "US", "UM", "UY", "UZ", "VU", "VE", "VN", "VG", "VI", "WF", "EH", "YE", "ZM", "ZW", "XK",
] as const;

type CountryOption = {
  code: string;
  label: string;
  storageName: string;
  searchText: string;
};

type RegionDisplayNames = {
  of: (code: string) => string | undefined;
};

type RegionDisplayNamesConstructor = new (
  locales: string[],
  options: { type: "region" }
) => RegionDisplayNames;

const regionDisplayNamesCache: Partial<Record<UILanguage, RegionDisplayNames | null>> = {};

function getRegionDisplayNames(language: UILanguage): RegionDisplayNames | null {
  if (language in regionDisplayNamesCache) return regionDisplayNamesCache[language] ?? null;
  try {
    const DisplayNames = (Intl as typeof Intl & { DisplayNames?: RegionDisplayNamesConstructor }).DisplayNames;
    regionDisplayNamesCache[language] = DisplayNames ? new DisplayNames([language], { type: "region" }) : null;
  } catch {
    regionDisplayNamesCache[language] = null;
  }
  return regionDisplayNamesCache[language] ?? null;
}

function getCountryRegionName(code: string, language: UILanguage): string {
  return getRegionDisplayNames(language)?.of(code) ?? code;
}

function normalizeCountrySearch(value: string): string {
  return value.trim().toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function buildCountryOptions(language: UILanguage): CountryOption[] {
  const locale = language === "ar" ? "ar" : "en";
  return COUNTRY_REGION_CODES.map((code) => {
    const storageName = getCountryRegionName(code, "en");
    const label = getCountryRegionName(code, language);
    const arabicName = getCountryRegionName(code, "ar");
    return {
      code,
      label,
      storageName,
      searchText: normalizeCountrySearch(`${code} ${storageName} ${label} ${arabicName}`),
    };
  }).sort((a, b) => a.label.localeCompare(b.label, locale));
}

function findCountryOptionByValue(value: string, options: CountryOption[]): CountryOption | null {
  const needle = normalizeCountrySearch(value);
  if (!needle) return null;
  return options.find((option) => {
    return (
      normalizeCountrySearch(option.code) === needle ||
      normalizeCountrySearch(option.storageName) === needle ||
      normalizeCountrySearch(option.label) === needle ||
      normalizeCountrySearch(getCountryRegionName(option.code, "ar")) === needle
    );
  }) ?? null;
}

function getLocalizedCountryValue(value: string, language: UILanguage): string {
  const options = buildCountryOptions(language);
  return findCountryOptionByValue(value, options)?.label ?? value;
}

export function ProfileModalContent({ userId }: ProfileModalContentProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL, themeColors, uiLanguage } = useSettings();
  const { width, height } = useWindowDimensions();
  const { user, session, profile, isLoading: authLoading, updateProfile } = useAuthStore();
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [localStats, setLocalStats] = useState<ProfileStatsSnapshot | null>(null);
  const [localReview, setLocalReview] = useState<ReviewSnapshot>({
    activity: [],
    activeDays: 0,
    totalReviews: 0,
    memorizedAyahCards: 0,
  });
  const [defaultDeckProgress, setDefaultDeckProgress] = useState<DefaultDeckProgressItem[]>([]);
  const [localSurahProgress, setLocalSurahProgress] = useState<ProfileSurahProgress[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editOrigin, setEditOrigin] = useState(() => authCommands.captureOwner());
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [countryDraft, setCountryDraft] = useState("");
  const [avatarDraft, setAvatarDraft] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [avatarRemovalDraft, setAvatarRemovalDraft] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState<
    "saveFailed" | "photoFailed" | "permissionDenied" | `photo-${AvatarProblem}` | null
  >(null);
  const showNotice = useOptionalOperationNotice();

  const requestedUserId = userId || user?.id || "";
  const isOwnProfile = !!user && (!userId || userId === user.id);
  const isSignedOutOwnProfile = !user && !userId;
  const showsLocalFigures = isOwnProfile || isSignedOutOwnProfile;
  const restorePause = useSyncRestorePause(isOwnProfile ? (user?.id ?? null) : null);
  const awaitingSync = isOwnProfile && restorePause.pause !== null;
  const hasValidRequestedUserId = isAccountId(requestedUserId);
  const identity = getAuthSessionIdentity(session);
  const editIdentity = identity.kind === "identified" && identity.userId === user?.id.toLowerCase()
    ? JSON.stringify(identity) : null;
  const editScope = useMemo(() => ({
    active: false,
    busy: false,
    picking: false,
    canEdit: editOpen && isOwnProfile && editIdentity !== null,
    userId: user?.id,
    origin: editOrigin.isCurrent() ? editOrigin : authCommands.captureOwner(),
    owner: authCommands.captureOwner(),
  }), [editOpen, isOwnProfile, editIdentity, user?.id, editOrigin]);
  const isCurrentEdit = useCallback(() => editScope.active && editScope.origin.isCurrent() && editScope.owner.isCurrent()
    && useAuthStore.getState().user?.id === editScope.userId, [editScope]);
  const closeEdit = useCallback(() => {
    if (!editScope.active) return;
    editScope.active = false;
    editScope.owner.cancel();
    setEditOpen(false);
  }, [editScope]);
  const openEdit = useCallback(() => {
    if (editScope.origin.isCurrent() && editScope.owner.isCurrent() && isOwnProfile && editIdentity !== null
      && useAuthStore.getState().profile?.id === editScope.userId) setEditOpen(true);
  }, [editScope, isOwnProfile, editIdentity]);
  useLayoutEffect(() => {
    editScope.owner = authCommands.captureOwner();
    editScope.active = editScope.canEdit && editScope.origin.isCurrent();
    editScope.busy = false;
    editScope.picking = false;
    const current = useAuthStore.getState();
    const initial = current.profile?.id === current.user?.id ? current.profile : null;
    setDisplayNameDraft(initial?.display_name ?? "");
    setBioDraft(initial?.bio ?? "");
    setCountryDraft(initial?.country ?? "");
    setAvatarDraft(null);
    setAvatarRemovalDraft(false);
    setProfileStatus(null);
    setProfileSaving(false);
    return () => {
      editScope.active = false;
      editScope.owner.cancel();
    };
  }, [editScope]);
  useEffect(() => useAuthStore.subscribe(() => {
    if (!editScope.owner.isCurrent()) {
      editScope.active = false;
      editScope.owner.cancel();
      setEditOpen(false);
      setEditOrigin(authCommands.captureOwner());
    }
  }), [editScope]);
  const numberLocale = uiLanguage === "ar" ? "ar" : "en";
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 760);

  const publicProfileQuery = useQuery({
    queryKey: ["publicProfile", requestedUserId],
    queryFn: () => fetchPublicProfile(requestedUserId),
    enabled: hasValidRequestedUserId && !isOwnProfile && !isSignedOutOwnProfile,
    staleTime: 1000 * 60 * 2,
  });

  const publicBadgesQuery = useQuery({
    queryKey: ["publicAchievementUnlocks", user?.id ?? "signed-out", requestedUserId],
    queryFn: () => fetchPublicAchievementUnlocks(requestedUserId),
    enabled: hasValidRequestedUserId && !isOwnProfile && !!user,
    staleTime: 1000 * 60 * 2,
  });

  const ownBadgesQuery = useQuery({
    queryKey: ["currentUserPublicAchievementUnlocks", user?.id ?? "signed-out"],
    queryFn: () => getRecentUnlocks(db, 100),
    enabled: showsLocalFigures,
    staleTime: 1000 * 60,
  });

  const profileSummaryQuery = useQuery({
    queryKey: profilePrivacyKeys.summary(user?.id ?? null, requestedUserId),
    queryFn: () => fetchProfileSummary(requestedUserId, user?.id ?? null),
    enabled: hasValidRequestedUserId && !isOwnProfile && !isSignedOutOwnProfile,
    staleTime: 1000 * 60 * 2,
    retry: (count, error) => socialFailureOf(error).kind === "account_changed" && count < 2,
  });

  const ownPrivacyQuery = useQuery({
    queryKey: profilePrivacyKeys.mine(user?.id ?? null),
    queryFn: () => fetchProfilePrivacy(requireSocialOwner(user?.id ?? "")),
    enabled: isOwnProfile && !!user && isSupabaseConfigured(),
    staleTime: 1000 * 60,
  });
  const photosOff = ownPrivacyQuery.data?.isMinor === true;

  const close = useCallback(() => {
    if (!editScope.origin.isCurrent() || !editScope.owner.isCurrent()) return;
    editScope.active = false;
    editScope.owner.cancel();
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/home" as any);
  }, [router, editScope]);

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
        }
      : null
    : publicProfile;
  const ownNeutral = isOwnProfile && neutralProfileName(visibleProfile, user?.email ?? null);
  const displayName =
    visibleProfile?.display_name ||
    (ownNeutral ? s.authProfile : visibleProfile?.username) ||
    (isSignedOutOwnProfile || isOwnProfile ? s.authProfile : s.genericAnonymous);
  const username = ownNeutral ? null : (visibleProfile?.username ?? null);
  const avatarUrl = visibleProfile?.avatar_url ?? null;
  const bio = visibleProfile?.bio?.trim() ?? "";
  const country = visibleProfile?.country?.trim() ?? "";
  const localizedCountry = useMemo(
    () => country ? getLocalizedCountryValue(country, uiLanguage) : "",
    [country, uiLanguage]
  );
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
    ? themeColors.surfaceHigh
    : isDark ? "#0f766e" : "#0d9488";
  const localStatsSnapshot = localStats ?? { currentStreak: 0, longestStreak: 0, cardsReviewed: 0 };
  const review = localReview;
  const surahProgress = showsLocalFigures ? localSurahProgress : [];
  const surahSummary = summarizeSurahProgress(surahProgress);
  const sharedSummary = profileSummaryQuery.data ?? null;
  const stats: { label: string; value: number | string }[] = showsLocalFigures
    ? [
        { label: s.progressTotalMemorized, value: review.memorizedAyahCards },
        { label: s.profileCurrentConsistency, value: localStatsSnapshot.currentStreak },
        { label: s.heatmapActiveDays, value: review.activeDays },
        { label: s.heatmapTotalReviews, value: review.totalReviews },
      ]
    : [
        ...(sharedSummary?.streak != null ? [{ label: s.wirdCurrent, value: sharedSummary.streak }] : []),
        ...(sharedSummary?.juzCompleted != null
          ? [{ label: s.socialProfileJuzCompleted, value: sharedSummary.juzCompleted.length }]
          : []),
      ];
  const publicBadges = isOwnProfile ? ownBadgesQuery.data ?? [] : publicBadgesQuery.data ?? [];
  const loadingPublic = !isOwnProfile && !isSignedOutOwnProfile && hasValidRequestedUserId && publicProfileQuery.isLoading;
  const publicProfileMissing =
    !isOwnProfile && (!hasValidRequestedUserId || (publicProfileQuery.isSuccess && publicProfileQuery.data === null));
  const statusMessage =
    profileStatus === "permissionDenied"
      ? s.profilePhotoPermissionDenied
      : profileStatus === "photoFailed"
        ? s.profilePhotoFailed
        : profileStatus === "saveFailed"
          ? s.profileSaveFailed
          : profileStatus === "photo-type"
            ? s.profilePhotoInvalidType
            : profileStatus === "photo-size"
              ? s.profilePhotoTooLarge
              : profileStatus === "photo-unreadable"
                ? s.profilePhotoUnreadable
                : "";

  const loadLocalOverview = useCallback(async () => {
    if (!showsLocalFigures) return;
    const [habit, cardsReviewedRow, metrics] = await Promise.all([
      loadHabitOverview(db),
      db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM study_log"),
      loadStudyMetrics(db),
    ]);
    setLocalStats({
      currentStreak: habit.streak.length,
      longestStreak: longestStreak(toDayMap(habit.days), habit.today),
      cardsReviewed: cardsReviewedRow?.count ?? 0,
    });
    setLocalReview({
      activity: metrics.activity,
      activeDays: metrics.activeDays,
      totalReviews: metrics.totalReviews,
      memorizedAyahCards: metrics.memorizedAyahCards,
    });

    const [defaultDecks, surahs] = await Promise.all([
      getDefaultDeckProgress(db).catch((error) => {
        console.warn("[Profile] Failed to load default deck progress:", error);
        return [];
      }),
      getLocalSurahProgress(db).catch((error) => {
        console.warn("[Profile] Failed to load surah progress:", error);
        return [];
      }),
    ]);
    setDefaultDeckProgress(defaultDecks);
    setLocalSurahProgress(surahs);
  }, [db, showsLocalFigures]);

  const invalidateProfileSurfaces = useCallback((isCurrent: () => boolean) => {
    const keys = [["publicProfile"], reflectionQueryKeys.feed.all, reflectionQueryKeys.reflections.all,
      reflectionQueryKeys.comments.all, ["halaqa"], ["board"]];
    for (const queryKey of keys) {
      if (!isCurrent()) return;
      queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient]);

  useEffect(() => {
    if (!showsLocalFigures) return;
    loadLocalOverview().catch(console.warn);
    if (isOwnProfile) updateProfileStats(db).catch(console.warn);
  }, [db, isOwnProfile, showsLocalFigures, loadLocalOverview]);

  useEffect(() => {
    if (!showsLocalFigures) return;
    return subscribeReviewActivity(() => {
      loadLocalOverview().catch(console.warn);
      if (isOwnProfile) updateProfileStats(db).catch(console.warn);
    });
  }, [db, isOwnProfile, showsLocalFigures, loadLocalOverview]);

  useEffect(() => {
    if (!isOwnProfile) return;
    return subscribeSyncCompleted(({ pulled }) => {
      if (pulled <= 0) return;
      loadLocalOverview().catch(console.warn);
      updateProfileStats(db).catch(console.warn);
      queryClient.invalidateQueries({ queryKey: ["currentUserPublicAchievementUnlocks", user?.id] });
    });
  }, [db, isOwnProfile, loadLocalOverview, queryClient, user?.id]);

  const handleSaveProfile = useCallback(async () => {
    if (!user || !profileDirty || !isCurrentEdit() || editScope.busy) return;
    const owner = editScope.owner;
    const isCurrentSave = () => editScope.owner === owner && isCurrentEdit();
    editScope.busy = true;
    setProfileSaving(true);
    setProfileStatus(null);
    try {
      const nextAvatarUrl = avatarDraft ? await uploadProfileAvatar(user.id, avatarDraft) : avatarRemovalDraft ? null : undefined;
      if (!isCurrentSave()) return;
      const result = await updateProfile({
        displayName: displayNameDirty ? (displayNameValue.length > 0 ? displayNameValue : null) : undefined,
        bio: bioDirty ? (bioValue.length > 0 ? bioValue : null) : undefined,
        country: countryDirty ? (countryValue.length > 0 ? countryValue : null) : undefined,
        avatarUrl: avatarDirty ? nextAvatarUrl : undefined,
      }, owner);
      if (!isCurrentSave() || result.status !== "completed") return;
      setAvatarDraft(null);
      setAvatarRemovalDraft(false);
      queryClient.setQueryData(["publicProfile", user.id], result.value);
      if (!isCurrentSave()) return;
      invalidateProfileSurfaces(isCurrentSave);
      if (!isCurrentSave()) return;
      editScope.busy = false;
      setProfileSaving(false);
      closeEdit();
      showNotice(s.profileSaved);
    } catch (e) {
      if (!isCurrentSave()) return;
      console.warn("[Profile] Failed to update profile:", e);
      setProfileStatus(avatarDirty ? "photoFailed" : "saveFailed");
    } finally {
      if (editScope.active && editScope.owner === owner) {
        if (!isCurrentSave()) {
          editScope.active = false;
          owner.cancel();
          setEditOpen(false);
        } else {
          editScope.busy = false;
          setProfileSaving(false);
        }
      }
    }
  }, [avatarDirty, avatarDraft, avatarRemovalDraft, bioDirty, bioValue, countryDirty, countryValue, displayNameDirty, displayNameValue, invalidateProfileSurfaces, profileDirty, queryClient, updateProfile, user, editScope, isCurrentEdit, closeEdit, showNotice, s.profileSaved]);

  const handlePickAvatar = useCallback(async () => {
    if (!isCurrentEdit() || editScope.busy || editScope.picking) return;
    const owner = editScope.owner;
    const isCurrentPicker = () => editScope.owner === owner && isCurrentEdit();
    editScope.picking = true;
    setProfileStatus(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!isCurrentPicker()) return;
      if (!permission.granted) {
        setProfileStatus("permissionDenied");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.82,
      });
      if (!isCurrentPicker()) return;
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      const problem = validateAvatarAsset(asset);
      if (problem) {
        setProfileStatus(`photo-${problem}`);
        return;
      }
      setAvatarDraft(asset);
      setAvatarRemovalDraft(false);
    } finally {
      if (editScope.owner === owner) {
        editScope.picking = false;
        if (editScope.active && !isCurrentPicker()) {
          editScope.active = false;
          owner.cancel();
          setEditOpen(false);
        }
      }
    }
  }, [editScope, isCurrentEdit]);

  const handleRemoveAvatar = useCallback(async () => {
    if (!isCurrentEdit() || editScope.busy || (!profile?.avatar_url && !avatarDraft)) return;
    setProfileStatus(null);
    setAvatarDraft(null);
    setAvatarRemovalDraft(!!profile?.avatar_url);
  }, [avatarDraft, profile?.avatar_url, editScope, isCurrentEdit]);

  const { guard: guardEditClose, dialogProps: discardDialogProps } = useDiscardGuard(profileDirty && !profileSaving);
  const requestCloseEdit = useCallback(() => guardEditClose(closeEdit), [guardEditClose, closeEdit]);
  const [badgesOpen, setBadgesOpen] = useState(false);
  const [surahsOpen, setSurahsOpen] = useState(false);

  const tabs = useMemo(
    () => isOwnProfile ? [
      { key: "overview" as const, label: s.profileOverviewTab },
      { key: "notes" as const, label: s.profileNotesTab },
    ] : [],
    [isOwnProfile, s.profileNotesTab, s.profileOverviewTab]
  );

  const mirroredRowStyle = {
    direction: "ltr" as const,
    flexDirection: isRTL ? "row-reverse" as const : "row" as const,
  };

  const headerActions = isOwnProfile && user && profile?.id === user.id ? (
    <View className={`items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`} style={mirroredRowStyle}>
      <HeaderAction icon={Pencil} label={s.profileEditAction} color={isDark ? "#2dd4bf" : "#0d9488"} onPress={openEdit} />
    </View>
  ) : null;

  return (
    <>
      <ResponsiveSheet
        open
        onClose={close}
        maxWidth={880}
        maxHeight={maxOverlayHeight}
        dir={isRTL ? "rtl" : "ltr"}
      >
        <OverlayHeader
          title={loadingPublic ? undefined : displayName}
          subtitle={!loadingPublic && username ? `@${username}` : undefined}
          leading={
            loadingPublic ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="h-12 w-12 rounded-full bg-surface-high dark:bg-surface-dark-high"
              />
            ) : visibleProfile ? (
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
            <View className="gap-6">
              <SignedOutProfile isDark={isDark} isRTL={isRTL} onClose={close} />
              <ProfileOverview
                bio=""
                country=""
                stats={stats}
                review={review}
                defaultDeckProgress={defaultDeckProgress}
                surahProgress={surahProgress}
                publicBadges={publicBadges}
                numberLocale={numberLocale}
                isOwnProfile
                localTitle={s.profileGuestActivityTitle}
                sharedSummaryLoading={false}
                onViewAllBadges={() => setBadgesOpen(true)}
                onViewAllSurahs={() => setSurahsOpen(true)}
                isDark={isDark}
                isRTL={isRTL}
              />
            </View>
          ) : loadingPublic ? (
            <View accessible accessibilityLabel={s.profileLoadingLabel} className="gap-3 py-6">
              <View className="h-5 w-48 rounded-full bg-surface-high dark:bg-surface-dark-high" />
              <View className="h-4 w-32 rounded-full bg-surface-high dark:bg-surface-dark-high" />
            </View>
          ) : !visibleProfile ? (
            <EmptyState
              icon={UserRound}
              title={publicProfileMissing ? s.profileNotFound : isOwnProfile ? s.authProfile : s.profileLoadFailed}
              subtitle={publicProfileMissing || isOwnProfile ? undefined : s.errorSubtitle}
              actionLabel={publicProfileMissing ? s.genericClose : isOwnProfile ? undefined : s.errorTryAgain}
              onAction={
                publicProfileMissing ? close : isOwnProfile ? undefined : () => void publicProfileQuery.refetch()
              }
              isDark={isDark}
            />
          ) : (
            <View className="gap-5">
              {tabs.length > 0 ? (
                <View
                  className={`rounded-full bg-surface-high p-1 dark:bg-surface-dark-high ${isRTL ? "flex-row-reverse" : "flex-row"}`}
                  style={mirroredRowStyle}
                >
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
                  country={localizedCountry}
                  stats={stats}
                  review={review}
                  defaultDeckProgress={defaultDeckProgress}
                  surahProgress={surahProgress}
                  publicBadges={publicBadges}
                  numberLocale={numberLocale}
                  isOwnProfile={isOwnProfile}
                  awaitingSync={awaitingSync}
                  sharedSummaryLoading={profileSummaryQuery.isLoading}
                  onViewAllBadges={() => setBadgesOpen(true)}
                  onViewAllSurahs={() => setSurahsOpen(true)}
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
        onClose={requestCloseEdit}
        maxWidth={EDIT_PROFILE_MODAL_MAX_WIDTH}
        maxHeight={maxOverlayHeight}
        surfaceColor={isDark ? themeColors.surfaceLow : themeColors.surfaceBright}
        dir={isRTL ? "rtl" : "ltr"}
        avoidKeyboard
      >
        <View
          className="border-b border-warm-200 dark:border-neutral-800"
          style={{
            direction: "ltr",
            flexDirection: isRTL ? "row-reverse" : "row",
            justifyContent: "space-between",
            gap: 20,
            paddingHorizontal: isPhone ? 24 : 32,
            paddingTop: isPhone ? 24 : 30,
            paddingBottom: isPhone ? 22 : 28,
          }}
        >
          <View className="min-w-0 flex-1" style={{ alignItems: isRTL ? "flex-end" : "flex-start" }}>
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{
                fontFamily: "Manrope_700Bold",
                fontSize: isPhone ? 28 : 32,
                lineHeight: isPhone ? 34 : 39,
                ...textStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.profileEditTitle}
            </Text>
            <Text
              className="mt-2 text-warm-500 dark:text-neutral-400"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: isPhone ? 17 : 19,
                lineHeight: isPhone ? 24 : 27,
                ...textStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.profileEditSubtitle}
            </Text>
          </View>
          <Pressable
            onPress={requestCloseEdit}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={s.genericClose}
            className="items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-high"
            style={{ height: isPhone ? 48 : 56, width: isPhone ? 48 : 56 }}
          >
            <X size={isPhone ? 24 : 27} color={isDark ? "#d4d4d4" : "#3f3f46"} />
          </Pressable>
        </View>

        <OverlayBody
          contentContainerStyle={{
            paddingHorizontal: isPhone ? 24 : 32,
            paddingVertical: isPhone ? 24 : 34,
          }}
        >
          <View style={{ gap: isPhone ? 24 : 32 }}>
            <View
              style={{
                alignItems: isPhone ? (isRTL ? "flex-end" : "flex-start") : "center",
                direction: "ltr",
                flexDirection: isPhone ? "column" : isRTL ? "row-reverse" : "row",
                gap: isPhone ? 18 : 32,
              }}
            >
              <ProfileAvatar
                avatarUrl={avatarPreviewUrl}
                name={displayName}
                size={isPhone ? EDIT_PROFILE_AVATAR_SIZE_PHONE : EDIT_PROFILE_AVATAR_SIZE}
                isDark={isDark}
              />
              <View
                className="min-w-0 flex-1"
                style={{ alignItems: isRTL ? "flex-end" : "flex-start", gap: 12, width: isPhone ? "100%" : undefined }}
              >
                <ProfileEditFieldLabel label={s.authDisplayName} isRTL={isRTL} />
                <Input
                  value={displayNameDraft}
                  onChangeText={(value) => {
                    if (!isCurrentEdit()) return;
                  setDisplayNameDraft(value);
                    setProfileStatus(null);
                  }}
                  placeholder={s.profileDisplayNamePlaceholder}
                  accessibilityLabel={s.authDisplayName}
                  maxLength={60}
                  dir={isRTL ? "rtl" : "ltr"}
                  className="min-h-12 rounded-2xl border border-warm-300 bg-surface-bright px-4 py-2 dark:border-neutral-700 dark:bg-surface-dark"
                  style={{
                    fontFamily: "Manrope_700Bold",
                    fontSize: isPhone ? 20 : 22,
                    lineHeight: 28,
                    minWidth: isPhone ? 260 : 320,
                  }}
                />
                <Text
                  className="text-warm-500 dark:text-neutral-400"
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: isPhone ? 16 : 18,
                    lineHeight: isPhone ? 22 : 25,
                    ...textStartStyle(isRTL),
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {s.profileEditIntroSubtitle}
                </Text>
                <View
                  style={{
                    direction: "ltr",
                    flexDirection: isRTL ? "row-reverse" : "row",
                    flexWrap: "wrap",
                    gap: 12,
                    justifyContent: isRTL ? "flex-end" : "flex-start",
                    marginTop: 4,
                  }}
                >
                  {photosOff ? (
                    <Text style={{ fontSize: 13, color: isDark ? "#a3a3a3" : "#6b6157", ...textStartStyle(isRTL) }}>
                      {s.profilePhotoMinorNote}
                    </Text>
                  ) : (
                    <ProfileEditActionButton
                      icon={Camera}
                      label={s.profileChangePhoto}
                      color={isDark ? "#5eead4" : "#003638"}
                      borderColor={isDark ? themeColors.surfaceHigh : "rgba(45,45,45,0.16)"}
                      disabled={profileSaving || authLoading}
                      isRTL={isRTL}
                      onPress={handlePickAvatar}
                    />
                  )}
                  {avatarPreviewUrl ? (
                    <ProfileEditActionButton
                      icon={Trash2}
                      label={s.profileRemovePhoto}
                      color={isDark ? "#f87171" : "#dc2626"}
                      borderColor={isDark ? themeColors.surfaceHigh : "rgba(45,45,45,0.16)"}
                      disabled={profileSaving || authLoading}
                      isRTL={isRTL}
                      onPress={handleRemoveAvatar}
                    />
                  ) : null}
                </View>
              </View>
            </View>

            <View style={{ gap: 12 }}>
              <ProfileEditFieldLabel label={s.profileBioTitle} isRTL={isRTL} />
              <View
                className="overflow-hidden rounded-2xl border border-warm-200 bg-surface-bright dark:border-neutral-800 dark:bg-surface-dark"
                style={{ minHeight: isPhone ? 150 : 170 }}
              >
                <Input
                  value={bioDraft}
                  onChangeText={(value) => {
                    if (!isCurrentEdit()) return;
                  setBioDraft(value);
                    setProfileStatus(null);
                  }}
                  placeholder={s.profileBioPlaceholder}
                  accessibilityLabel={s.profileBioTitle}
                  maxLength={PROFILE_BIO_MAX_LENGTH}
                  multiline
                  dir={isRTL ? "rtl" : "ltr"}
                  className="min-h-[148px] rounded-none bg-transparent px-5 py-4"
                  style={{
                    lineHeight: 23,
                    paddingBottom: 40,
                  }}
                />
                <Text
                  className="absolute bottom-4 text-warm-500 dark:text-neutral-500"
                  style={{
                    [isRTL ? "left" : "right"]: 18,
                    fontFamily: "Manrope_500Medium",
                    fontSize: 15,
                    ...textEndStyle(isRTL),
                  }}
                >
                  {bioCount}
                </Text>
              </View>
            </View>

            <View style={{ gap: 12 }}>
              <ProfileEditFieldLabel label={s.profileCountryTitle} isRTL={isRTL} />
              <CountryCommandSelect
                value={countryDraft}
                onChange={(value) => {
                  if (!isCurrentEdit()) return;
                  setCountryDraft(value);
                  setProfileStatus(null);
                }}
                placeholder={s.profileCountryPlaceholder}
                searchPlaceholder={s.profileCountrySearchPlaceholder}
                emptyLabel={s.profileCountryNoResults}
                clearLabel={s.profileCountryClear}
                sheetTitle={s.profileCountryListTitle}
                language={uiLanguage}
                isDark={isDark}
                isRTL={isRTL}
                disabled={profileSaving || authLoading}
              />
            </View>

            {statusMessage ? (
              <Text
                accessibilityRole="alert"
                className="text-red-600 dark:text-red-400"
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: 13,
                  ...textStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {statusMessage}
              </Text>
            ) : null}
          </View>
        </OverlayBody>

        <View
          className="border-t border-warm-200 dark:border-neutral-800"
          style={{
            paddingHorizontal: isPhone ? 24 : 32,
            paddingTop: isPhone ? 18 : 22,
            paddingBottom: isPhone ? 24 : 26,
          }}
        >
          <Button
            size="lg"
            className="w-full gap-3 rounded-2xl"
            onPress={handleSaveProfile}
            disabled={saveProfileDisabled}
            dir={isRTL ? "rtl" : "ltr"}
            style={{ backgroundColor: saveProfileBackgroundColor, minHeight: 58, opacity: saveProfileDisabled && !profileSaving ? 1 : undefined }}
          >
            {profileSaving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Save size={22} color={saveProfileIconColor} />}
            <Text style={{ color: saveProfileTextColor, fontFamily: "Manrope_600SemiBold", fontSize: 20 }}>
              {s.profileSave}
            </Text>
          </Button>
        </View>
      </ResponsiveModal>
      <DiscardChangesDialog {...discardDialogProps} />

      <ResponsiveModal open={badgesOpen} onClose={() => setBadgesOpen(false)} maxWidth={720} maxHeight={maxOverlayHeight} dir={isRTL ? "rtl" : "ltr"}>
        <OverlayHeader title={s.publicBadges} onClose={() => setBadgesOpen(false)} isRTL={isRTL} />
        <OverlayBody contentContainerClassName="px-5 py-5">
          <PublicBadgesGrid unlocks={publicBadges} />
        </OverlayBody>
      </ResponsiveModal>

      <ResponsiveModal open={surahsOpen} onClose={() => setSurahsOpen(false)} maxWidth={720} maxHeight={maxOverlayHeight} dir={isRTL ? "rtl" : "ltr"}>
        <OverlayHeader title={s.progressSurahProgress} onClose={() => setSurahsOpen(false)} isRTL={isRTL} />
        <OverlayBody contentContainerClassName="px-5 py-5">
          <SurahProgressList
            data={surahProgress}
            isDark={isDark}
            isRTL={isRTL}
            onItemPress={() => setSurahsOpen(false)}
            s={s}
          />
        </OverlayBody>
      </ResponsiveModal>
    </>
  );
}

function ProfileEditFieldLabel({ label, isRTL }: { label: string; isRTL: boolean }) {
  return (
    <Text
      className="text-charcoal dark:text-neutral-100"
      style={{
        fontFamily: "Manrope_600SemiBold",
        fontSize: 18,
        lineHeight: 24,
        ...textStartStyle(isRTL),
        writingDirection: isRTL ? "rtl" : "ltr",
      }}
    >
      {label}
    </Text>
  );
}

function ProfileEditActionButton({
  icon: Icon,
  label,
  color,
  borderColor,
  disabled,
  isRTL,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  borderColor: string;
  disabled: boolean;
  isRTL: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className="items-center rounded-2xl border bg-surface-bright px-5 dark:bg-surface-dark"
      style={{
        borderColor,
        direction: "ltr",
        flexDirection: isRTL ? "row-reverse" : "row",
        gap: 12,
        minHeight: 46,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Icon size={21} strokeWidth={2.2} color={color} />
      <Text
        style={{
          color,
          fontFamily: "Manrope_600SemiBold",
          fontSize: 16,
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function CountryCommandSelect({
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  clearLabel,
  sheetTitle,
  language,
  isDark,
  isRTL,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  clearLabel: string;
  sheetTitle: string;
  language: UILanguage;
  isDark: boolean;
  isRTL: boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { width } = useWindowDimensions();
  const inSheet = width < SIDEBAR_BREAKPOINT;
  const options = useMemo(() => buildCountryOptions(language), [language]);
  const selectedOption = useMemo(() => findCountryOptionByValue(value, options), [options, value]);
  const selectedLabel = selectedOption?.label ?? value.trim();
  const queryText = normalizeCountrySearch(query);
  const filteredOptions = useMemo(
    () => queryText ? options.filter((option) => option.searchText.includes(queryText)) : options,
    [options, queryText]
  );
  const iconColor = isDark ? "#a3a3a3" : "#8A7764";
  const activeColor = isDark ? "#5eead4" : "#0d9488";
  const rowFlexStyle = {
    direction: "ltr" as const,
    flexDirection: isRTL ? "row-reverse" as const : "row" as const,
  };

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <View className="relative">
      <Pressable
        onPress={() => {
          if (!disabled) setOpen((current) => !current);
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled }}
        className={cn(
          "min-h-14 rounded-2xl border border-warm-200 bg-surface-bright px-4 py-3 dark:border-neutral-800 dark:bg-surface-dark",
          disabled && "opacity-50"
        )}
      >
        <View className={`items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`} style={rowFlexStyle}>
          <Text
            className={selectedLabel ? "text-charcoal dark:text-neutral-100" : "text-warm-500 dark:text-neutral-500"}
            numberOfLines={1}
            style={{
              flex: 1,
              fontFamily: "Manrope_400Regular",
              fontSize: 15,
              ...textStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {selectedLabel || placeholder}
          </Text>
          {selectedLabel ? (
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                onChange("");
                setOpen(false);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={clearLabel}
              className="h-6 w-6 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
            >
              <X size={14} color={iconColor} />
            </Pressable>
          ) : null}
          <ChevronDown size={17} color={iconColor} />
        </View>
      </Pressable>

      {open && inSheet ? (
        <ResponsiveSheet
          open
          onClose={() => setOpen(false)}
          maxWidth={560}
          phoneSheetHeight="max"
          avoidKeyboard
          dir={isRTL ? "rtl" : "ltr"}
        >
          <OverlayHeader title={sheetTitle} onClose={() => setOpen(false)} isRTL={isRTL} />
          <View className="flex-1 min-h-0">
          <View className="border-b border-warm-200 px-3 py-2 dark:border-neutral-800">
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              maxLength={PROFILE_COUNTRY_MAX_LENGTH}
              dir={isRTL ? "rtl" : "ltr"}
              startIcon={<Search size={16} color={iconColor} />}
              className="min-h-9 bg-transparent px-0 py-0"
              containerClassName="bg-surface-low dark:bg-surface-dark-low"
              style={{ height: 36, lineHeight: 20 }}
            />
          </View>
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={inSheet ? { flex: 1 } : { maxHeight: 260 }}
            contentContainerClassName="py-1"
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const selected = selectedOption?.code === option.code;
                return (
                  <Pressable
                    key={option.code}
                    onPress={() => {
                      onChange(option.storageName);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    className={cn(
                      "mx-1 min-h-11 rounded-xl px-3 py-2",
                      selected ? "bg-primary-accent/10 dark:bg-primary-bright/15" : "bg-transparent"
                    )}
                  >
                    <View className={`items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`} style={rowFlexStyle}>
                      <Text
                        className="min-w-0 flex-1 text-charcoal dark:text-neutral-100"
                        numberOfLines={1}
                        style={{
                          fontFamily: selected ? "Manrope_700Bold" : "Manrope_500Medium",
                          fontSize: 14,
                          ...textStartStyle(isRTL),
                          writingDirection: isRTL ? "rtl" : "ltr",
                        }}
                      >
                        {option.label}
                      </Text>
                      {selected ? <Check size={16} color={activeColor} /> : null}
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <Text
                className="px-4 py-6 text-warm-500 dark:text-neutral-500"
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: 13,
                  textAlign: "center",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {emptyLabel}
              </Text>
            )}
          </ScrollView>
          </View>
        </ResponsiveSheet>
      ) : open ? (
        <View className="mt-2 overflow-hidden rounded-2xl border border-warm-200 bg-surface-high dark:border-neutral-800 dark:bg-surface-dark-high">
          <View className="border-b border-warm-200 px-3 py-2 dark:border-neutral-800">
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              maxLength={PROFILE_COUNTRY_MAX_LENGTH}
              dir={isRTL ? "rtl" : "ltr"}
              startIcon={<Search size={16} color={iconColor} />}
              className="min-h-9 bg-transparent px-0 py-0"
              containerClassName="bg-surface-low dark:bg-surface-dark-low"
              style={{ height: 36, lineHeight: 20 }}
            />
          </View>
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={inSheet ? { flex: 1 } : { maxHeight: 260 }}
            contentContainerClassName="py-1"
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const selected = selectedOption?.code === option.code;
                return (
                  <Pressable
                    key={option.code}
                    onPress={() => {
                      onChange(option.storageName);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    className={cn(
                      "mx-1 min-h-11 rounded-xl px-3 py-2",
                      selected ? "bg-primary-accent/10 dark:bg-primary-bright/15" : "bg-transparent"
                    )}
                  >
                    <View className={`items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`} style={rowFlexStyle}>
                      <Text
                        className="min-w-0 flex-1 text-charcoal dark:text-neutral-100"
                        numberOfLines={1}
                        style={{
                          fontFamily: selected ? "Manrope_700Bold" : "Manrope_500Medium",
                          fontSize: 14,
                          ...textStartStyle(isRTL),
                          writingDirection: isRTL ? "rtl" : "ltr",
                        }}
                      >
                        {option.label}
                      </Text>
                      {selected ? <Check size={16} color={activeColor} /> : null}
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <Text
                className="px-4 py-6 text-warm-500 dark:text-neutral-500"
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: 13,
                  textAlign: "center",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {emptyLabel}
              </Text>
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function ProfileOverview({
  bio,
  country,
  stats,
  review,
  defaultDeckProgress,
  surahProgress,
  publicBadges,
  numberLocale,
  isOwnProfile,
  awaitingSync = false,
  localTitle,
  sharedSummaryLoading,
  onViewAllBadges,
  onViewAllSurahs,
  isDark,
  isRTL,
}: {
  bio: string;
  country: string;
  stats: { label: string; value: number | string }[];
  review: ReviewSnapshot;
  defaultDeckProgress: DefaultDeckProgressItem[];
  surahProgress: ProfileSurahProgress[];
  publicBadges: any[];
  numberLocale: string;
  isOwnProfile: boolean;
  awaitingSync?: boolean;
  localTitle?: string;
  sharedSummaryLoading: boolean;
  onViewAllBadges: () => void;
  onViewAllSurahs: () => void;
  isDark: boolean;
  isRTL: boolean;
}) {
  const s = useStrings();
  const { width } = useWindowDimensions();
  const isWideActivity = width >= SIDEBAR_BREAKPOINT;
  const rowFlexStyle = {
    direction: "ltr" as const,
    flexDirection: isWideActivity ? (isRTL ? "row-reverse" as const : "row" as const) : "column" as const,
  };
  const inlineRowFlexStyle = {
    direction: "ltr" as const,
    flexDirection: isRTL ? "row-reverse" as const : "row" as const,
  };

  return (
    <View className="gap-5">
      {country || bio ? (
        <View className="gap-2">
          {country ? (
            <View className={`items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`} style={inlineRowFlexStyle}>
              <MapPin size={15} color={isDark ? "#2dd4bf" : "#0d9488"} accessibilityLabel={s.profileCountryTitle} />
              <Text
                selectable
                className="min-w-0 flex-1 text-warm-700 dark:text-neutral-300"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 14, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {country}
              </Text>
            </View>
          ) : null}
          {bio ? (
            <Text
              selectable
              className="text-charcoal dark:text-neutral-200"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 22, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
            >
              {bio}
            </Text>
          ) : null}
        </View>
      ) : null}

      {!isOwnProfile ? (
        <Card elevation="low" className="p-5">
          <Text
            className="mb-3 text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 16, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {s.progressActivity}
          </Text>
          {stats.length > 0 ? (
            <ProfileActivityStats items={stats} numberLocale={numberLocale} isDark={isDark} isWide={isWideActivity} isRTL={isRTL} />
          ) : sharedSummaryLoading ? (
            <ActivityIndicator color={isDark ? "#5eead4" : "#003638"} />
          ) : (
            <Text
              className="text-warm-700 dark:text-neutral-300"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 22, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
            >
              {s.socialProfilePrivateNote}
            </Text>
          )}
        </Card>
      ) : null}

      {awaitingSync ? (
        <View className="gap-1 rounded-2xl bg-surface-high px-4 py-3 dark:bg-surface-dark-high">
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 13, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {s.profileStatsAwaitingSync}
          </Text>
          <Text
            className="text-warm-700 dark:text-neutral-300"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 13, lineHeight: 19, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {s.profileStatsAwaitingSyncBody}
          </Text>
        </View>
      ) : null}
      {isOwnProfile ? (
      <Card elevation="low" className="p-5">
        <Text
          className="mb-4 text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 16, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
        >
          {localTitle ?? s.progressActivity}
        </Text>
        <View
          className="gap-5"
          style={{
            ...rowFlexStyle,
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
            items={stats}
            numberLocale={numberLocale}
            isDark={isDark}
            isWide={isWideActivity}
            isRTL={isRTL}
          />
        </View>
      </Card>
      ) : null}

      {isOwnProfile ? (
        <DefaultDeckProgressChart
          items={defaultDeckProgress}
          isDark={isDark}
          isRTL={isRTL}
          s={s}
          className="p-5"
        />
      ) : null}

      {isOwnProfile ? (
        <View>
          <Text
            className="mb-3 text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 16, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {s.progressSurahProgress}
          </Text>
          <SurahProgressList
            data={surahProgress}
            isDark={isDark}
            isRTL={isRTL}
            previewLimit={PROFILE_SURAH_PREVIEW_LIMIT}
            onViewAll={onViewAllSurahs}
            readOnly={false}
            s={s}
          />
        </View>
      ) : null}

      <Card elevation="low" className="p-5">
        <Text
          className="mb-3 text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 16, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
        >
          {s.publicBadges}
        </Text>
        <PublicBadgesGrid unlocks={publicBadges.slice(0, PROFILE_BADGE_PREVIEW_LIMIT)} />
        {publicBadges.length > PROFILE_BADGE_PREVIEW_LIMIT ? (
          <Pressable
            accessibilityRole="button"
            onPress={onViewAllBadges}
            className="mt-3 min-h-11 justify-center"
            style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1, alignSelf: isRTL ? "flex-end" : "flex-start" })}
          >
            <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
              {s.profileBadgesViewAll}
            </Text>
          </Pressable>
        ) : null}
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
  items: { label: string; value: number | string }[];
  numberLocale: string;
  isDark: boolean;
  isWide: boolean;
  isRTL: boolean;
}) {
  return (
    <View
      className="gap-3"
      style={{
        direction: "ltr",
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
          value={typeof item.value === "number" ? item.value.toLocaleString(numberLocale) : item.value}
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
      {isSupabaseConfigured() ? (
      <View className="gap-2">
        <Button
          onPress={() => {
            onClose();
            captureAuthReturn({ route: "profile" });
            router.push("/auth/login" as any);
          }}
        >
          <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}>
            {s.authLogin}
          </Text>
        </Button>
        {isEmailAuthFlowsEnabled() && (
          <Button
            variant="outline"
            onPress={() => {
              onClose();
              captureAuthReturn({ route: "profile" });
              router.push("/auth/signup" as any);
            }}
          >
            <Text
              className="text-charcoal dark:text-neutral-200"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, ...textStartStyle(isRTL)}}
            >
              {s.authSignup}
            </Text>
          </Button>
        )}
      </View>
      ) : null}
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
