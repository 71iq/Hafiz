import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { View, Text, Pressable, ActivityIndicator, Linking, Platform, StyleSheet, useWindowDimensions, type ScrollView } from "react-native";
import { AccountSyncCard, lastSyncedLabel } from "@/components/settings/AccountSyncCard";
import { LogoutConfirmDialog } from "@/components/settings/LogoutConfirmDialog";
import { ProfilePrivacySheet } from "@/components/settings/ProfilePrivacySheet";
import { useIssueReporter } from "@/components/app-update/IssueReporter";
import { WhatsNewSheet } from "@/components/app-update/WhatsNewSheet";
import { installedAppVersion } from "@/lib/app-update/build-info";
import { installedAndroidVersionCode } from "@/lib/app-update/use-android-update";
import { SyncIndicator, useSyncStatusDetails } from "@/components/ui/SyncIndicator";
import { subscribeSettingSaveFailed } from "@/lib/settings/save-feedback";
import { PUBLIC_PAGE_FROM_SETTINGS } from "@/lib/public-pages/content";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { SwitchRow, SwitchTrack } from "@/components/ui/Switch";
import { ReadingStepper } from "@/components/settings/ReadingStepper";
import { SettingsLinkRow } from "@/components/settings/SettingsLinkRow";
import { Toast } from "@/components/ui/Toast";
import { ThemeColorSwatch } from "@/components/ui/ThemeColorSwatch";
import {
  COMPACT_SCREEN_BOTTOM_INSET,
  Screen,
  ScreenScrollView,
  useScreenContentLayout,
} from "@/components/ui/ScreenContent";
import {
  ChevronRight,
  ChevronLeft,
  User,
  LogOut,
  BookOpen,
  RefreshCw,
  Unlink,
  Info,
  FileText,
  ExternalLink,
  Sparkles,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react-native";
import {
  useSettings,
  FONT_SIZE_STEPS,
  type ThemeMode,
  type UILanguage,
  type PageScroll,
  type QuranMarkerStyle,
  type ViewMode,
} from "@/lib/settings/context";
import { classicFontCopy, isTajweedStyle, quranBaseFont, styleForBaseFont, styleForTajweed, type QuranBaseFont } from "@/lib/settings/quran-font-choice";
import { useDatabase } from "@/lib/database/provider";
import { WirdSettingsSection } from "@/components/habit/WirdSettingsSection";
import { StudyDecksSettings } from "@/components/settings/StudyDecksSettings";
import { ReminderSettingsSection } from "@/components/notifications/ReminderSettingsSection";
import { HomeWidgetSettings } from "@/components/settings/HomeWidgetSettings";
import { widgetPlatform } from "@/lib/widget/platform";
import { getLanguageByCode, translationDisplayName } from "@/lib/translations/languages";
import { AVAILABLE_TAFSIR_SOURCES } from "@/lib/tafsir/sources";
import { TafsirSourcePicker } from "@/components/settings/TafsirSourcePicker";
import { TranslationLanguagePicker } from "@/components/settings/TranslationLanguagePicker";
import { ReciterPicker } from "@/components/settings/ReciterPicker";
import { interpolate, stringByKey, useStrings } from "@/lib/i18n/useStrings";
import { isEmailAuthFlowsEnabled } from "@/lib/auth/config";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isRecitationEnabled, isQfSyncEnabled } from "@/lib/quran-foundation/config";
import { getQfOAuthRedirectUri, readQfCallbackParams } from "@/lib/quran-foundation/oauth-redirect";
import { formatReciterLabel, getReciterById } from "@/lib/quran-foundation/recitations";
import {
  beginQfOAuthConnection,
  disconnectQfUser,
  getQfConnectionStatus,
  getQfLinkedIdentityState,
} from "@/lib/quran-foundation/user";
import { fullQfUserSync, runInitialQfUserSync } from "@/lib/quran-foundation/user-sync";
import type { QfConnectionStatus } from "@/lib/quran-foundation/user-types";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { captureAuthReturn } from "@/lib/auth/return-origin";
import { toArabicNumber } from "@/lib/arabic";
import { SETTINGS_CONTENT_MAX_WIDTH, SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { textStartStyle, textEndStyle } from "@/lib/ui/direction";
import { ProfileIdentity } from "@/components/profile/ProfileIdentity";
import {
  quranPageFontName,
  quranPageFontPaletteStyle,
  quranPageMarkerFontPaletteStyle,
} from "@/lib/fonts/loader";
import { useQuranPageFontReady } from "@/lib/fonts/use-quran-page-font";
import { errorMessage } from "@/lib/error-message";
import { useAppReleaseRows } from "@/components/app-update/use-app-release-row";

type SettingsCategoryId = "general" | "content" | "account" | "about";

// Login and Sign up opened from Account return there; the auth screens own the allowlisted return.

type SettingsCategory = {
  id: SettingsCategoryId;
  title: string;
  icon: LucideIcon;
};

const SETTINGS_QURAN_PREVIEW_SURAH = 2;
const SETTINGS_QURAN_PREVIEW_AYAH = 282;
const CONTENT_SETTINGS_MAX_WIDTH = 720;
const CONTENT_SETTINGS_ROW_HEIGHT = 60;
type QuranPreviewAyah = {
  v2Page: number;
  tokens: string[];
};

export default function SettingsScreen() {
  const {
    theme,
    setTheme,
    fontSizeIndex,
    setFontSizeIndex,
    fontSize,
    translationLanguage,
    isTranslationLoading,
    isDark,
    isRTL,
    effectiveTheme,
    systemTheme,
    tafseerSource,
    setTafseerSource,
    recitationId,
    setRecitationId,
    uiLanguage,
    setUiLanguage,
    pageScroll,
    setPageScroll,
    viewMode,
    setViewMode,
    quranFontStyle,
    quranRenderFontStyle,
    classicDownloadState,
    setQuranFontStyle,
    quranMarkerStyle,
    setQuranMarkerStyle,
    markSimilarVerses,
    setMarkSimilarVerses,
    hapticsEnabled,
    setHapticsEnabled,
    autoDownloadUpdates,
    setAutoDownloadUpdates,
  } = useSettings();
  const db = useDatabase();
  const s = useStrings();
  const classic = classicFontCopy(s, classicDownloadState, quranRenderFontStyle === "qcf2" && quranFontStyle !== "qcf2");
  const appReleaseRows = useAppReleaseRows();
  const appVersion = installedAppVersion();
  // The installed Android app downloads its own updates; the QA build, web and iOS do not.
  const showsAutoDownloadSetting = installedAndroidVersionCode() !== null;
  const syncDetails = useSyncStatusDetails();
  const router = useRouter();
  // Sign-in from Settings returns to the Account category through the allowlisted return origin (W13).
  const openAccountAuth = (pathname: "/auth/login" | "/auth/signup") => {
    captureAuthReturn({ route: "settings-account" });
    router.push(pathname);
  };
  const params = useLocalSearchParams<{ qf?: string; qf_error?: string; category?: string; section?: string }>();
  const configured = isSupabaseConfigured();
  const qfSyncEnabled = isQfSyncEnabled();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [tafseerPickerVisible, setTafseerPickerVisible] = useState(false);
  const [reciterPickerVisible, setReciterPickerVisible] = useState(false);
  const [logoutDialogVisible, setLogoutDialogVisible] = useState(false);
  const [whatsNewVisible, setWhatsNewVisible] = useState(false);
  // The account the privacy sheet was opened for; it closes when that account is no longer signed in.
  const [privacyFor, setPrivacyFor] = useState<string | null>(null);
  const [qfStatus, setQfStatus] = useState<QfConnectionStatus>("disconnected");
  const [qfBusy, setQfBusy] = useState(false);
  const [qfMessage, setQfMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const currentLang = getLanguageByCode(translationLanguage);
  const currentTafseerSource =
    AVAILABLE_TAFSIR_SOURCES.find((source) => source.id === tafseerSource) ?? AVAILABLE_TAFSIR_SOURCES[0];
  const currentTafseerTitle = stringByKey(s, currentTafseerSource.labelKey, currentTafseerSource.id);
  const currentReciter = getReciterById(recitationId);
  const { user, profile, isLoading: authLoading, signOut } = useAuthStore();
  // Never derive a name from the email; a fallback profile reads "Hafiz user" until the real one loads.
  const accountName = profile?.display_name || profile?.username || (user ? s.navigationHafizUser : s.authProfile);
  // The sign-out confirmation names the account as the person signed in with it.
  const accountIdentity = user?.email || profile?.username || s.authProfile;
  const fontSizeUsesFittedPageSize = viewMode === "page" && pageScroll === "horizontal";
  const resolvedThemeLabel = effectiveTheme === "white" ? s.themeWhite : effectiveTheme === "beige" ? s.themeBeige : effectiveTheme === "dark" ? s.themeDark : s.themeAmoled;
  const [quranPreview, setQuranPreview] = useState<QuranPreviewAyah | null>(null);
  const quranPreviewFontReady = useQuranPageFontReady(quranRenderFontStyle, quranPreview?.v2Page);
  const fontSizeLevelLabel = isRTL ? toArabicNumber(fontSizeIndex + 1) : String(fontSizeIndex + 1);
  const fontSizeTotalLabel = isRTL ? toArabicNumber(FONT_SIZE_STEPS.length) : String(FONT_SIZE_STEPS.length);
  const TranslationChevron = isRTL ? ChevronLeft : ChevronRight;
  const { isLaptop } = useScreenContentLayout({ maxWidth: SETTINGS_CONTENT_MAX_WIDTH });
  const categoryParam = Array.isArray(params.category) ? params.category[0] : params.category;
  const activeCategory = parseSettingsCategory(categoryParam) ?? "general";
  // Home's Off marker on a deck opens Settings at the Daily study section (?section=daily-study). The
  // sections above it (the wird settings, the Quran preview) load after the first layout and push it
  // down, so the request stays open and is measured again on each layout change until layout has
  // settled for a moment or the user scrolls. measureLayout is used rather than a stored onLayout y,
  // which web does not report again when only the position moves.
  const sectionParam = Array.isArray(params.section) ? params.section[0] : params.section;
  const scrollRef = useRef<ScrollView>(null);
  const panelsRef = useRef<View>(null);
  const panelsY = useRef(0);
  const dailyStudyRef = useRef<View>(null);
  const pendingDailyStudy = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollToDailyStudy = useCallback(() => {
    const target = dailyStudyRef.current;
    const panels = panelsRef.current;
    if (!pendingDailyStudy.current || !target || !panels) return;
    target.measureLayout(
      panels as never,
      (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, panelsY.current + y - 16), animated: false }),
      () => {},
    );
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      pendingDailyStudy.current = false;
    }, 1500);
  }, []);
  useEffect(() => {
    if (sectionParam !== "daily-study") return;
    pendingDailyStudy.current = true;
    router.setParams({ section: undefined });
    scrollToDailyStudy();
  }, [sectionParam, router, scrollToDailyStudy]);
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );
  const previewPage = quranPreview?.v2Page ?? 1;
  const previewFontFamily = quranPreview ? quranPageFontName(quranRenderFontStyle, previewPage) : undefined;
  const previewFontPaletteStyle = quranPageFontPaletteStyle(quranRenderFontStyle, previewPage, effectiveTheme);
  const previewMarkerFontPaletteStyle = quranPageMarkerFontPaletteStyle(
    quranRenderFontStyle,
    previewPage,
    effectiveTheme,
    quranMarkerStyle,
  );
  // Only the latest status request may publish, so a previous account's slow response cannot show
  // its connection to the next account. Handlers capture the account and check it, by generation and
  // by the live store user, before showing results. A switch clears the previous account's message.
  const latestQfStatusRequest = useRef(0);
  const handledQfCallback = useRef<string | null>(null);
  const latestQfCallback = useRef(0);
  useEffect(() => () => {
    latestQfCallback.current += 1;
    handledQfCallback.current = null;
  }, []);
  const accountGeneration = useRef(0);
  const accountId = user?.id ?? null;
  useEffect(() => {
    accountGeneration.current += 1;
    setQfMessage(null);
    setQfBusy(false);
  }, [accountId]);
  const captureAccount = useCallback(() => {
    const generation = accountGeneration.current;
    const capturedId = useAuthStore.getState().user?.id ?? null;
    return () => generation === accountGeneration.current && (useAuthStore.getState().user?.id ?? null) === capturedId;
  }, []);

  const refreshQfStatus = useCallback(async () => {
    const request = ++latestQfStatusRequest.current;
    const publish = (next: QfConnectionStatus) => {
      if (request === latestQfStatusRequest.current) setQfStatus(next);
      return next;
    };
    if (!configured || !accountId || !qfSyncEnabled) return publish("disconnected");
    const status = await getQfConnectionStatus();
    if (status.ok) {
      if (status.status === "disconnected") {
        const linked = await getQfLinkedIdentityState();
        return publish(linked.linked ? "linked_no_sync" : "disconnected");
      }
      return publish(status.status);
    }
    return publish(status.code === "needs_reauth" ? "needs_reauth" : "disconnected");
  }, [accountId, configured, qfSyncEnabled]);

  useEffect(() => {
    refreshQfStatus().catch(console.warn);
  }, [refreshQfStatus]);

  // A failed settings write has already reverted to the last saved choice; say so once.
  useEffect(() => subscribeSettingSaveFailed(() => setToast(s.settingSaveFailed)), [s.settingSaveFailed]);

  useEffect(() => {
    let cancelled = false;
    db.getFirstAsync<{ text_qcf2: string; v2_page: number }>(
      "SELECT text_qcf2, v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
      [SETTINGS_QURAN_PREVIEW_SURAH, SETTINGS_QURAN_PREVIEW_AYAH],
    )
      .then((row) => {
        if (cancelled) return;
        const tokens = row?.text_qcf2.split(/\s+/).filter(Boolean) ?? [];
        const marker = tokens[tokens.length - 1];
        const words = tokens.slice(0, -1).slice(-8);
        setQuranPreview(row && marker && words.length > 0 ? { v2Page: row.v2_page, tokens: [...words, marker] } : null);
      })
      .catch((err) => {
        console.warn("[Settings] Failed to load Quran preview:", err);
        if (!cancelled) setQuranPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [db]);

  useEffect(() => {
    const qf = Array.isArray(params.qf) ? params.qf[0] : params.qf;
    const qfError = Array.isArray(params.qf_error) ? params.qf_error[0] : params.qf_error;
    if (!qf && !qfError) {
      handledQfCallback.current = null;
      return;
    }
    const callbackKey = `${qf ?? ""}|${qfError ?? ""}`;
    if (handledQfCallback.current === callbackKey) return;
    handledQfCallback.current = callbackKey;
    // Consume the result in the router before starting the sync. Its lifetime belongs to this
    // account and callback, so removing the params does not cancel its eventual feedback.
    router.setParams({ category: "account", qf: undefined, qf_error: undefined });
    const callback = ++latestQfCallback.current;
    const isCurrentAccount = captureAccount();
    const isCurrent = () => callback === latestQfCallback.current && isCurrentAccount();
    const finishCallback = async () => {
      if (qfError) {
        setQfBusy(false);
        setQfMessage(qfError);
        await refreshQfStatus();
        return;
      }
      if (qf === "connected") {
        setQfBusy(true);
        setQfMessage(null);
        try {
          const status = await refreshQfStatus();
          if (!isCurrent()) return;
          if (status === "connected") {
            const result = await runInitialQfUserSync(db);
            if (!isCurrent()) return;
            setQfMessage(
              result.status === "synced"
                ? s.qfSyncComplete
                : result.status === "failed"
                  ? s.qfSyncFailed
                  : result.status === "needs_reauth"
                    ? s.qfNeedsReauth
                    : s.qfFinishConnection,
            );
          } else {
            setQfMessage(s.qfFinishConnection);
          }
        } catch (err) {
          if (isCurrent()) setQfMessage(errorMessage(err) || s.qfSyncFailed);
        } finally {
          if (isCurrent()) setQfBusy(false);
        }
      }
    };
    finishCallback().catch(console.warn);
  }, [
    captureAccount,
    db,
    params.qf,
    params.qf_error,
    refreshQfStatus,
    router,
    s.qfFinishConnection,
    s.qfSyncComplete,
    s.qfSyncFailed,
    s.qfNeedsReauth,
  ]);

  // The account leaves the screen at once; the server request that ends the session runs behind it.
  const handleLogout = useCallback(() => {
    setLogoutDialogVisible(false);
    void signOut();
  }, [signOut]);

  const handleQfConnect = useCallback(async () => {
    const isCurrentAccount = captureAccount();
    setQfBusy(true);
    setQfMessage(null);
    try {
      const redirectUri = getQfOAuthRedirectUri();
      const response = await beginQfOAuthConnection(redirectUri, "/settings");
      if (!isCurrentAccount()) return;
      if (!response.ok) throw new Error(response.message);
      setQfMessage(s.qfConnectionStarted);
      if (Platform.OS === "web") {
        await openQfAuthorizationUrl(response.authorizationUrl);
        return;
      }
      // The App Link closes this session. Its warm delivery is dropped in +native-intent,
      // so this is the only place that routes the code to the callback.
      const result = await WebBrowser.openAuthSessionAsync(response.authorizationUrl, redirectUri);
      if (!isCurrentAccount()) return;
      if (result.type === "success" && result.url) {
        router.push({ pathname: "/auth/qf-callback", params: readQfCallbackParams(result.url) });
      } else {
        setQfMessage(null);
      }
    } catch (err) {
      if (isCurrentAccount()) setQfMessage(errorMessage(err) || s.qfConnectionFailed);
    } finally {
      setQfBusy(false);
    }
  }, [captureAccount, router, s.qfConnectionFailed, s.qfConnectionStarted]);

  // Disconnect shows at once; a refusal puts back the status shown before and says so. It does not
  // read the status again, since a read that fails offline would also say "disconnected".
  const handleQfDisconnect = useCallback(() => {
    const isCurrentAccount = captureAccount();
    const previous = qfStatus;
    // A status read that started earlier cannot put "Connected" back.
    latestQfStatusRequest.current += 1;
    setQfStatus("disconnected");
    setQfMessage(s.qfDisconnected);
    void (async () => {
      try {
        const result = await disconnectQfUser();
        if (!result.ok) throw new Error(result.message);
        if (isCurrentAccount()) await refreshQfStatus();
      } catch (err) {
        if (!isCurrentAccount()) return;
        console.warn("[Settings] Quran Foundation disconnect failed:", err);
        latestQfStatusRequest.current += 1;
        setQfStatus(previous);
        setQfMessage(s.qfDisconnectFailed);
      }
    })();
  }, [captureAccount, qfStatus, refreshQfStatus, s.qfDisconnected, s.qfDisconnectFailed]);

  const handleQfManualSync = useCallback(async () => {
    const isCurrentAccount = captureAccount();
    setQfBusy(true);
    setQfMessage(null);
    try {
      const result = await fullQfUserSync(db);
      await refreshQfStatus();
      if (!isCurrentAccount()) return;
      setQfMessage(
        result.status === "synced"
          ? s.qfSyncComplete
          : result.status === "needs_reauth"
            ? s.qfNeedsReauth
            : result.status === "failed"
              ? s.qfSyncFailed
              : s.qfFinishConnection,
      );
    } catch (err) {
      if (isCurrentAccount()) setQfMessage(errorMessage(err) || s.qfSyncFailed);
    } finally {
      setQfBusy(false);
    }
  }, [captureAccount, db, refreshQfStatus, s.qfFinishConnection, s.qfNeedsReauth, s.qfSyncComplete, s.qfSyncFailed]);

  const issueReporter = useIssueReporter(setToast);
  const openPublicPage = useCallback(
    (page: "about" | "privacy" | "terms" | "credits") => {
      // The page returns to Settings > About through this captured origin.
      router.push(`/${page}?from=${PUBLIC_PAGE_FROM_SETTINGS}` as Href);
    },
    [router],
  );

  const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
    { value: "white", label: s.themeWhite },
    { value: "beige", label: s.themeBeige },
    { value: "system", label: s.themeSystem },
    { value: "dark", label: s.themeDark },
    { value: "amoled", label: s.themeAmoled },
  ];

  const settingsCategories: SettingsCategory[] = [
    { id: "general", title: s.settingsCategoryGeneral, icon: SlidersHorizontal },
    { id: "content", title: s.settingsCategoryContent, icon: FileText },
    { id: "account", title: s.settingsCategoryAccount, icon: User },
    { id: "about", title: s.settingsCategoryAbout, icon: Info },
  ];

  const handleCategorySelect = useCallback(
    (category: SettingsCategoryId) => {
      router.setParams({ category });
    },
    [router],
  );

  const categoryPanels = (
    <>
      {activeCategory === "general" && (
        <>
          <SectionLabel>{s.sectionLanguage}</SectionLabel>
          <Card elevation="low" className="p-5 mb-8">
            <Text
              className="text-charcoal dark:text-neutral-200 mb-4"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
            >
              {s.appLanguageLabel}
            </Text>
            <ToggleGroup<UILanguage>
              aria-label={Platform.OS === "web" ? s.appLanguageLabel : undefined}
              value={uiLanguage}
              onValueChange={setUiLanguage}
              items={[
                { value: "en", label: "English" },
                { value: "ar", label: "العربية" },
              ]}
            />
          </Card>

          <SectionLabel>{s.sectionAppearance}</SectionLabel>
          <Card elevation="low" className="p-5 mb-8">
            <Text
              className="text-charcoal dark:text-neutral-200 mb-4"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
            >
              {s.themeLabel}
            </Text>
            <View
              style={{
                flexDirection: "row",
                gap: 8,
              }}
            >
              {THEME_OPTIONS.map((option) => {
                const isActive = theme === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setTheme(option.value)}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityState={{ checked: isActive }}
                    aria-checked={isActive}
                    style={({ pressed }) => ({
                      flex: 1,
                      opacity: pressed ? 0.72 : 1,
                    })}
                  >
                    <ThemeColorSwatch theme={option.value} systemTheme={systemTheme} selected={isActive} size={42} label={option.label} />
                  </Pressable>
                );
              })}
            </View>
            {theme === "system" ? (
              <Text
                accessibilityLiveRegion="polite"
                className="mt-3 text-warm-500 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {interpolate(s.settingsThemeResolved, { theme: resolvedThemeLabel })}
              </Text>
            ) : null}
          </Card>

          <SectionLabel>{s.sectionReading}</SectionLabel>
          <Card elevation="low" className="p-4 mb-8">
            <View className="gap-4">
              <SettingsControlRow label={s.mushafViewModeLabel} isRTL={isRTL}>
                <ToggleGroup<ViewMode>
                  aria-label={Platform.OS === "web" ? s.mushafViewModeLabel : undefined}
                  value={viewMode}
                  onValueChange={setViewMode}
                  items={[
                    { value: "verse", label: s.mushafViewVerse },
                    { value: "page", label: s.mushafViewPage },
                  ]}
                />
              </SettingsControlRow>
              <Text
                className="-mt-2 text-warm-500 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {s.settingsViewModeHint}
              </Text>

              <SettingsControlRow label={s.quranFontLabel} isRTL={isRTL}>
                <ToggleGroup<QuranBaseFont>
                  value={quranBaseFont(quranFontStyle)}
                  onValueChange={(font) => setQuranFontStyle(styleForBaseFont(font, quranFontStyle))}
                  accessibilityLabel={s.quranFontLabel}
                  items={[
                    { value: "qcf2", label: classic.label },
                    { value: "v4", label: s.quranFontV4 },
                  ]}
                />
              </SettingsControlRow>

              <Text
                className="text-warm-400 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {classic.hint}
              </Text>

              <SwitchRow
                label={s.quranFontV4Tajweed}
                hint={s.quranTajweedHint}
                value={isTajweedStyle(quranFontStyle)}
                onValueChange={(enabled) => setQuranFontStyle(styleForTajweed(enabled, quranFontStyle))}
                className="items-center justify-between gap-3"
                style={{ direction: isRTL ? "rtl" : "ltr", flexDirection: "row", minHeight: 44 }}
              >
                <View className="min-w-0 flex-1">
                  <Text
                    className="mb-1 text-charcoal dark:text-neutral-200"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                  >
                    {s.quranFontV4Tajweed}
                  </Text>
                  <Text
                    className="text-warm-400 dark:text-neutral-400"
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                  >
                    {s.quranTajweedHint}
                  </Text>
                </View>
                <SwitchTrack value={isTajweedStyle(quranFontStyle)} />
              </SwitchRow>

              {Platform.OS === "web" && quranRenderFontStyle !== "qcf2" && (
                <SettingsControlRow label={s.quranMarkerStyleLabel} isRTL={isRTL}>
                  <ToggleGroup<QuranMarkerStyle>
                    aria-label={s.quranMarkerStyleLabel}
                    value={quranMarkerStyle}
                    onValueChange={setQuranMarkerStyle}
                    items={[
                      { value: "auto", label: s.quranMarkerAuto },
                      { value: "light", label: s.quranMarkerLight },
                      { value: "dark", label: s.quranMarkerDark },
                      { value: "sepia", label: s.quranMarkerSepia },
                    ]}
                  />
                </SettingsControlRow>
              )}

              <View
                className="items-center justify-between gap-3"
                style={{
                  direction: isRTL ? "rtl" : "ltr",
                  flexDirection: "row",
                  flexWrap: "wrap",
                }}
              >
                <View className="min-w-0 flex-1">
                  <Text
                    className={`text-charcoal dark:text-neutral-200 ${fontSizeUsesFittedPageSize ? "mb-1" : ""}`}
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      fontSize: 14,
                      ...textStartStyle(isRTL),
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {s.fontSizeLabel}
                  </Text>
                  {fontSizeUsesFittedPageSize && (
                    <Text
                      className="text-warm-500 dark:text-neutral-400"
                      style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                    >
                      {s.fontSizeFixedPageView}
                    </Text>
                  )}
                </View>
                <ReadingStepper
                  variant="pill"
                  decrementLabel={s.decreaseArabicFontSize}
                  incrementLabel={s.increaseArabicFontSize}
                  value={`${fontSizeLevelLabel}/${fontSizeTotalLabel}`}
                  onDecrement={() => setFontSizeIndex(fontSizeIndex - 1)}
                  onIncrement={() => setFontSizeIndex(fontSizeIndex + 1)}
                  // Swipe pages are fitted to the screen, so the stepper has no effect there.
                  decrementDisabled={fontSizeUsesFittedPageSize || fontSizeIndex === 0}
                  incrementDisabled={fontSizeUsesFittedPageSize || fontSizeIndex === FONT_SIZE_STEPS.length - 1}
                  isDark={isDark}
                  isRTL={isRTL}
                />
              </View>

              <View className="bg-surface dark:bg-surface-dark rounded-2xl px-4 py-4">
                {/* Glyphs mounted before their page font exists render and measure in the system font. */}
                {quranPreview && quranPreviewFontReady ? (
                  <View
                    aria-hidden
                    style={{
                      direction: "ltr",
                      flexDirection: "row-reverse",
                      flexWrap: "wrap",
                      justifyContent: "center",
                      alignItems: "center",
                      gap: Math.max(4, fontSize * 0.18),
                      rowGap: Math.max(4, fontSize * 0.2),
                    }}
                  >
                    {quranPreview.tokens.map((token, index) => {
                      const isMarker = index === quranPreview.tokens.length - 1;
                      return (
                        <Text
                          key={`${token}-${index}`}
                          className="text-charcoal dark:text-neutral-100 text-center"
                          style={{
                            fontFamily: previewFontFamily,
                            ...(isMarker ? previewMarkerFontPaletteStyle : previewFontPaletteStyle),
                            fontSize,
                            lineHeight: fontSize * 1.8,
                          }}
                        >
                          {token}
                        </Text>
                      );
                    })}
                  </View>
                ) : (
                  <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
                )}
              </View>

              <SettingsControlRow label={s.pageScrollLabel} isRTL={isRTL}>
                <ToggleGroup<PageScroll>
                  aria-label={Platform.OS === "web" ? s.pageScrollLabel : undefined}
                  value={pageScroll}
                  onValueChange={setPageScroll}
                  items={[
                    { value: "vertical", label: s.pageScrollVertical },
                    { value: "horizontal", label: s.pageScrollHorizontal },
                  ]}
                />
              </SettingsControlRow>

              {/* The whole row is the switch, so its target is the row, not the 24 px track. */}
              <SwitchRow
                label={s.hifzSimilarMarkSetting}
                hint={s.hifzSimilarMarkSettingHint}
                value={markSimilarVerses}
                onValueChange={setMarkSimilarVerses}
                className="items-center justify-between gap-3"
                style={{ direction: isRTL ? "rtl" : "ltr", flexDirection: "row", minHeight: 44 }}
              >
                <View className="min-w-0 flex-1">
                  <Text
                    className="mb-1 text-charcoal dark:text-neutral-200"
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      fontSize: 14,
                      ...textStartStyle(isRTL),
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {s.hifzSimilarMarkSetting}
                  </Text>
                  <Text
                    className="text-warm-400 dark:text-neutral-400"
                    style={{
                      fontFamily: "Manrope_500Medium",
                      fontSize: 12,
                      ...textStartStyle(isRTL),
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {s.hifzSimilarMarkSettingHint}
                  </Text>
                </View>
                <SwitchTrack value={markSimilarVerses} />
              </SwitchRow>

              {Platform.OS !== "web" && (
                <SwitchRow
                  label={s.vibrationLabel}
                  hint={s.vibrationHint}
                  value={hapticsEnabled}
                  onValueChange={setHapticsEnabled}
                  className="items-center justify-between gap-3"
                  style={{ direction: isRTL ? "rtl" : "ltr", flexDirection: "row", minHeight: 44 }}
                >
                  <View className="min-w-0 flex-1">
                    <Text
                      className="mb-1 text-charcoal dark:text-neutral-200"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                    >
                      {s.vibrationLabel}
                    </Text>
                    <Text
                      className="text-warm-400 dark:text-neutral-400"
                      style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                    >
                      {s.vibrationHint}
                    </Text>
                  </View>
                  <SwitchTrack value={hapticsEnabled} />
                </SwitchRow>
              )}
            </View>
          </Card>

          <SectionLabel>{s.habitSettingsTitle}</SectionLabel>
          <WirdSettingsSection
            db={db}
            language={uiLanguage}
            isDark={isDark}
            s={s}
            onOpenPlan={() => router.push("/hifz/setup" as Href)}
          />

          <View ref={dailyStudyRef} onLayout={scrollToDailyStudy}>
            <SectionLabel>{s.studyDecksTitle}</SectionLabel>
            <StudyDecksSettings db={db} language={uiLanguage} s={s} />
          </View>

          <SectionLabel>{s.notifSettingsTitle}</SectionLabel>
          <ReminderSettingsSection />

          {widgetPlatform.supported ? (
            // The reminder section ends without a margin, as General's last section did before this one.
            <View className="mt-8">
              <SectionLabel>{s.widgetSettingsTitle}</SectionLabel>
              <HomeWidgetSettings />
            </View>
          ) : null}
        </>
      )}

      {activeCategory === "content" && (
        <ContentSettingsPanel isRTL={isRTL}>
          <ContentSettingsTitle isRTL={isRTL}>{s.readingContentSettingsLabel}</ContentSettingsTitle>
          <View style={{ gap: 34 }}>
            <ContentSettingsGroup isRTL={isRTL}>
              <ContentSettingsRow
                label={s.translationLanguageLabel}
                value={currentLang ? translationDisplayName(currentLang, uiLanguage) : translationLanguage}
                isRTL={isRTL}
                isDark={isDark}
                loading={isTranslationLoading}
                // There is no byte total for a translation, so the row names the phase without a percentage.
                loadingLabel={Platform.OS === "web" ? s.contentDownloading : s.contentImporting}
                showDivider
                onPress={() => setPickerVisible(true)}
              />
              <ContentSettingsRow
                label={s.tafseerSourceLabel}
                value={currentTafseerTitle}
                isRTL={isRTL}
                isDark={isDark}
                onPress={() => setTafseerPickerVisible(true)}
              />
            </ContentSettingsGroup>

            {isRecitationEnabled() && (
              <ContentSettingsGroup title={s.recitationSettingsLabel} isRTL={isRTL}>
                <ContentSettingsRow
                  label={s.recitationFavoriteReciter}
                  value={formatReciterLabel(currentReciter, uiLanguage)}
                  isRTL={isRTL}
                  isDark={isDark}
                  onPress={() => setReciterPickerVisible(true)}
                />
              </ContentSettingsGroup>
            )}
          </View>
        </ContentSettingsPanel>
      )}

      {activeCategory === "account" && (
        <>
          <SectionLabel>{s.authAccount}</SectionLabel>
          <Card elevation="low" className="p-5 mb-8">
            {user ? (
              <View>
                <Pressable
                  onPress={() => router.push("/profile" as any)}
                  accessibilityRole="button"
                  accessibilityLabel={s.settingsProfile}
                  className={`mb-4 items-center gap-3 rounded-3xl bg-surface p-4 dark:bg-surface-dark ${isRTL ? "flex-row-reverse" : "flex-row"}`}
                  style={({ pressed }) => ({
                    direction: "ltr",
                    flexDirection: isRTL ? "row-reverse" : "row",
                    opacity: pressed ? 0.74 : 1,
                  })}
                >
                  <ProfileIdentity
                    displayName={accountName}
                    username={profile?.username}
                    avatarUrl={profile?.avatar_url}
                    isDark={isDark}
                    isRTL={isRTL}
                    avatarSize={52}
                    nameSize={16}
                    handleSize={12}
                    detail={lastSyncedLabel(syncDetails.lastSyncedAt, s, uiLanguage)}
                  />
                  <SyncIndicator status={syncDetails.status} isDark={isDark} hideSuccess />
                  <View className="h-6 w-6 shrink-0 items-center justify-center">
                    <TranslationChevron size={18} color={isDark ? "#525252" : "#DFD9D1"} />
                  </View>
                </Pressable>
                <AccountSyncCard />
                {/* Public profile choices (SOC-01). */}
                {configured ? (
                  <View className="mb-4">
                    <SettingsLinkRow
                      icon={ShieldCheck}
                      title={s.privacySettingsTitle}
                      description={s.privacySettingsDesc}
                      onPress={() => setPrivacyFor(user.id)}
                      isDark={isDark}
                      isRTL={isRTL}
                    />
                  </View>
                ) : null}
                {configured && qfSyncEnabled && (
                  <View className="mb-4 rounded-3xl bg-surface dark:bg-surface-dark p-4">
                    <View className="flex-row items-center gap-3">
                      <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
                        <BookOpen size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-charcoal dark:text-neutral-100"
                          style={{
                            fontFamily: "Manrope_600SemiBold",
                            fontSize: 14,
                            ...textStartStyle(isRTL),
                          }}
                        >
                          {s.qfConnectionTitle}
                        </Text>
                        <Text
                          className="text-warm-400 dark:text-neutral-500 mt-0.5"
                          style={{
                            fontFamily: "Manrope_400Regular",
                            fontSize: 12,
                            ...textStartStyle(isRTL),
                          }}
                        >
                          {qfStatus === "connected"
                            ? s.qfConnected
                            : qfStatus === "needs_reauth"
                              ? s.qfNeedsReauth
                              : qfStatus === "linked_no_sync"
                                ? s.qfLinkedNoSync
                                : s.qfDisconnected}
                        </Text>
                      </View>
                    </View>
                    {!!qfMessage && (
                      <Text
                        className="mt-3 text-warm-500 dark:text-neutral-400"
                        style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL)}}
                      >
                        {qfMessage}
                      </Text>
                    )}
                    <View className="mt-4 flex-row gap-2">
                      {qfStatus === "connected" ? (
                        <>
                          <Pressable
                            onPress={handleQfManualSync}
                            disabled={qfBusy}
                            className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-primary-accent px-3 py-2.5"
                            style={({ pressed }) => ({ opacity: qfBusy ? 0.5 : pressed ? 0.8 : 1 })}
                          >
                            {qfBusy ? (
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                              <RefreshCw size={15} color="#FFFFFF" />
                            )}
                            <Text style={{ color: "#FFFFFF", fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                              {s.qfManualSync}
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={handleQfDisconnect}
                            accessibilityRole="button"
                            accessibilityLabel={s.qfDisconnect}
                            disabled={qfBusy}
                            className="h-10 w-10 items-center justify-center rounded-full bg-surface-high dark:bg-surface-dark-high"
                            style={({ pressed }) => ({ opacity: qfBusy ? 0.5 : pressed ? 0.8 : 1 })}
                          >
                            <Unlink size={16} color={isDark ? "#ef4444" : "#dc2626"} />
                          </Pressable>
                        </>
                      ) : (
                        <Pressable
                          onPress={handleQfConnect}
                          disabled={qfBusy}
                          className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-primary-accent px-3 py-2.5"
                          style={({ pressed }) => ({ opacity: qfBusy ? 0.5 : pressed ? 0.8 : 1 })}
                        >
                          {qfBusy ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <BookOpen size={15} color="#FFFFFF" />
                          )}
                          <Text style={{ color: "#FFFFFF", fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                            {qfStatus === "needs_reauth" || qfStatus === "linked_no_sync" ? s.qfReconnect : s.qfConnect}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
                <Pressable
                  onPress={() => setLogoutDialogVisible(true)}
                  disabled={authLoading}
                  accessibilityRole="button"
                  className="min-h-11 flex-row items-center justify-center gap-2 py-3 rounded-full bg-surface dark:bg-surface-dark"
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
              </View>
            ) : (
              <View className="gap-2">
                <Text
                  className="mb-2 px-1 text-warm-600 dark:text-neutral-300"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 21, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                >
                  {s.accountGuestIntro}
                </Text>
                <SettingsLinkRow
                  icon={User}
                  title={s.settingsProfile}
                  description={s.settingsProfileDesc}
                  onPress={() => router.push("/profile" as any)}
                  isDark={isDark}
                  isRTL={isRTL}
                />
                {/* Without an account service there is nothing to sign in to, so the buttons stay hidden. */}
                {configured ? (
                  <>
                    <Button
                      onPress={() => openAccountAuth("/auth/login")}
                      disabled={authLoading}
                      accessibilityState={{ disabled: authLoading, busy: authLoading }}
                    >
                      {authLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                      <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}>
                        {s.authLogin}
                      </Text>
                    </Button>
                    {isEmailAuthFlowsEnabled() && (
                      <Button
                        variant="outline"
                        onPress={() => openAccountAuth("/auth/signup")}
                        disabled={authLoading}
                        accessibilityState={{ disabled: authLoading, busy: authLoading }}
                      >
                        {authLoading ? <ActivityIndicator size="small" color={isDark ? "#d4d4d4" : "#2D2D2D"} /> : null}
                        <Text
                          className="text-charcoal dark:text-neutral-200"
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
                        >
                          {s.authSignup}
                        </Text>
                      </Button>
                    )}
                  </>
                ) : null}
              </View>
            )}
          </Card>
        </>
      )}

      {activeCategory === "about" && (
        <>
          <SectionLabel>{s.settingsAboutGroupApp}</SectionLabel>
          <Card elevation="low" className="p-2 mb-8">
            <View className="gap-1">
              {appReleaseRows.map((row) => (
                <SettingsLinkRow
                  key={row.key}
                  icon={row.icon}
                  title={row.title}
                  description={row.description}
                  onPress={row.onPress}
                  isDark={isDark}
                  isRTL={isRTL}
                />
              ))}
              {showsAutoDownloadSetting ? (
                <SwitchRow
                  label={s.autoDownloadUpdatesLabel}
                  hint={s.autoDownloadUpdatesHint}
                  value={autoDownloadUpdates}
                  onValueChange={setAutoDownloadUpdates}
                  className="items-center justify-between gap-3 px-3 py-3"
                  style={{ direction: isRTL ? "rtl" : "ltr", flexDirection: "row", minHeight: 44 }}
                >
                  <View className="min-w-0 flex-1">
                    <Text
                      className="mb-1 text-charcoal dark:text-neutral-100"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                    >
                      {s.autoDownloadUpdatesLabel}
                    </Text>
                    <Text
                      className="text-warm-400 dark:text-neutral-500"
                      style={{ fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 16, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                    >
                      {s.autoDownloadUpdatesHint}
                    </Text>
                  </View>
                  <SwitchTrack value={autoDownloadUpdates} />
                </SwitchRow>
              ) : null}
              <SettingsLinkRow
                icon={Sparkles}
                title={s.aboutWhatsNew}
                description={appVersion ? interpolate(s.aboutWhatsNewDesc, { version: appVersion }) : s.aboutNoReleaseNotes}
                onPress={() => setWhatsNewVisible(true)}
                isDark={isDark}
                isRTL={isRTL}
              />
            </View>
          </Card>

          <SectionLabel>{s.settingsAboutGroupHafiz}</SectionLabel>
          <Card elevation="low" className="p-2 mb-8">
            <View className="gap-1">
              <SettingsLinkRow
                icon={Info}
                title={s.settingsAboutHafiz}
                description={s.settingsAboutHafizDesc}
                onPress={() => openPublicPage("about")}
                isDark={isDark}
                isRTL={isRTL}
              />
              <SettingsLinkRow
                icon={FileText}
                title={s.creditsSection}
                description={s.settingsCreditsDesc}
                onPress={() => openPublicPage("credits")}
                isDark={isDark}
                isRTL={isRTL}
              />
              <SettingsLinkRow
                icon={ExternalLink}
                title={s.settingsReportIssue}
                description={s.settingsReportIssueDesc}
                onPress={() => issueReporter.report()}
                isDark={isDark}
                isRTL={isRTL}
                external
              />
            </View>
          </Card>

          <SectionLabel>{s.settingsAboutGroupLegal}</SectionLabel>
          <Card elevation="low" className="p-2 mb-8">
            <View className="gap-1">
              <SettingsLinkRow
                icon={FileText}
                title={s.settingsPrivacyPolicy}
                description={s.settingsPrivacyPolicyDesc}
                onPress={() => openPublicPage("privacy")}
                isDark={isDark}
                isRTL={isRTL}
              />
              <SettingsLinkRow
                icon={FileText}
                title={s.settingsTermsService}
                description={s.settingsTermsServiceDesc}
                onPress={() => openPublicPage("terms")}
                isDark={isDark}
                isRTL={isRTL}
              />
            </View>
          </Card>
        </>
      )}
    </>
  );

  return (
    <Screen>
      <ScreenScrollView
        ref={scrollRef}
        maxWidth={SETTINGS_CONTENT_MAX_WIDTH}
        bottomInset={COMPACT_SCREEN_BOTTOM_INSET}
        // The user's own scroll ends a pending jump to Daily study.
        onScrollBeginDrag={() => {
          pendingDailyStudy.current = false;
        }}
      >
        <View
          className="pt-8 pb-5"
          style={{
            alignItems: isLaptop ? "center" : "stretch",
            direction: isRTL ? "rtl" : "ltr",
            flexDirection: isLaptop ? "row" : "column",
            gap: 18,
            justifyContent: "space-between",
          }}
        >
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{
              fontFamily: "NotoSerif_700Bold",
              fontSize: isLaptop ? 32 : 28,
              ...textStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {s.settingsTitle}
          </Text>
          <SettingsCategoryTabs
            categories={settingsCategories}
            label={s.settingsTitle}
            activeCategory={activeCategory}
            isDark={isDark}
            isRTL={isRTL}
            onSelect={handleCategorySelect}
            compact={!isLaptop}
          />
        </View>

        <View
          ref={panelsRef}
          className="pb-8"
          onLayout={(event) => {
            panelsY.current = event.nativeEvent.layout.y;
            // The panels grow as the sections above Daily study load; measure again then.
            scrollToDailyStudy();
          }}
        >
          {categoryPanels}
        </View>
      </ScreenScrollView>
      <LogoutConfirmDialog
        visible={logoutDialogVisible}
        db={db}
        accountName={accountIdentity}
        loading={authLoading}
        onCancel={() => setLogoutDialogVisible(false)}
        onConfirm={handleLogout}
      />
      <WhatsNewSheet open={whatsNewVisible} version={appVersion} onClose={() => setWhatsNewVisible(false)} />
      {privacyFor && user?.id === privacyFor ? (
        <ProfilePrivacySheet key={privacyFor} userId={privacyFor} onClose={() => setPrivacyFor(null)} onNotice={setToast} />
      ) : null}
      {issueReporter.fallback}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
      <TranslationLanguagePicker visible={pickerVisible} onClose={() => setPickerVisible(false)} />
      <TafsirSourcePicker
        visible={tafseerPickerVisible}
        selectedSource={tafseerSource}
        onSelected={setTafseerSource}
        logLabel="[Settings]"
        onClose={() => setTafseerPickerVisible(false)}
      />
      <ReciterPicker
        visible={reciterPickerVisible}
        selectedId={recitationId}
        onSelect={setRecitationId}
        onClose={() => setReciterPickerVisible(false)}
      />
    </Screen>
  );
}

function parseSettingsCategory(value: string | undefined): SettingsCategoryId | null {
  switch (value) {
    case "general":
    case "content":
    case "account":
    case "about":
      return value;
    case "advanced":
      return "about";
    case "reading":
      return "general";
    default:
      return null;
  }
}

function SettingsCategoryTabs({
  categories,
  label,
  activeCategory,
  isDark,
  isRTL,
  onSelect,
  compact,
}: {
  categories: SettingsCategory[];
  label: string;
  activeCategory: SettingsCategoryId;
  isDark: boolean;
  isRTL: boolean;
  onSelect: (category: SettingsCategoryId) => void;
  compact: boolean;
}) {
  // A phone cannot fit four labels plus icons at the regular text size (a fixed-width scrolling
  // row cut "Account" mid-word and hid "About" at 384dp). Phones drop the icons and size each
  // segment from its label so all four fit; wider compact layouts keep icons and fill the row.
  const { width } = useWindowDimensions();
  const isPhone = compact && width < SIDEBAR_BREAKPOINT;
  const items = categories.map((category) => {
    const isActive = activeCategory === category.id;
    const Icon = category.icon;
    const iconColor = isActive ? (isDark ? "#2dd4bf" : "#0d9488") : isDark ? "#a3a3a3" : "#8a7661";
    return {
      value: category.id,
      label: category.title,
      icon: isPhone ? undefined : <Icon size={15} color={iconColor} />,
    };
  });

  return (
    <ToggleGroup<SettingsCategoryId>
      aria-label={Platform.OS === "web" ? label : undefined}
      value={activeCategory}
      onValueChange={onSelect}
      items={items}
      dir={isRTL ? "rtl" : "ltr"}
      className="bg-surface-low/80 dark:bg-surface-dark-low/80"
      itemClassName={isPhone ? "flex-auto px-2" : undefined}
      style={
        compact
          ? { alignSelf: "stretch" }
          : {
              flex: 1,
              maxWidth: 620,
              minWidth: 520,
            }
      }
    />
  );
}

function SettingsControlRow({ label, isRTL, children }: { label: string; isRTL: boolean; children: ReactNode }) {
  return (
    <View
      className="items-center justify-between gap-3"
      style={{
        direction: isRTL ? "rtl" : "ltr",
        flexDirection: "row",
        flexWrap: "wrap",
      }}
    >
      <Text
        className="text-charcoal dark:text-neutral-200"
        style={{
          flexGrow: 1,
          flexShrink: 1,
          fontFamily: "Manrope_600SemiBold",
          fontSize: 14,
          minWidth: 140,
          ...textStartStyle(isRTL),
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {label}
      </Text>
      <View style={{ flexBasis: 320, flexGrow: 1, maxWidth: "100%", minWidth: 240 }}>{children}</View>
    </View>
  );
}

function ContentSettingsPanel({ children, isRTL }: { children: ReactNode; isRTL: boolean }) {
  // The hand-mirrored alignment needs an LTR parent; under the RTL tab root it flipped twice and the
  // capped panel hugged the left in Arabic. The panel restores the reading direction for its rows.
  return (
    <View style={{ direction: "ltr", alignItems: isRTL ? "flex-end" : "flex-start" }}>
      <View
        style={{
          direction: isRTL ? "rtl" : "ltr",
          maxWidth: CONTENT_SETTINGS_MAX_WIDTH,
          width: "100%",
        }}
      >
        {children}
      </View>
    </View>
  );
}

function ContentSettingsTitle({ children, isRTL }: { children: string; isRTL: boolean }) {
  return (
    <Text
      className="mb-7 text-charcoal dark:text-neutral-100"
      style={{
        fontFamily: "Manrope_700Bold",
        fontSize: 24,
        lineHeight: 31,
        ...textStartStyle(isRTL),
        writingDirection: isRTL ? "rtl" : "ltr",
      }}
    >
      {children}
    </Text>
  );
}

function ContentSettingsGroup({ title, isRTL, children }: { title?: string; isRTL: boolean; children: ReactNode }) {
  const { isDark, themeColors } = useSettings();
  return (
    <View>
      {title ? (
        <Text
          className="mb-4 text-charcoal dark:text-neutral-100"
          style={{
            fontFamily: "Manrope_700Bold",
            fontSize: 20,
            lineHeight: 26,
            ...textStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {title}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: isDark ? themeColors.surfaceLow : themeColors.surfaceBright,
          borderColor: isDark ? themeColors.surfaceHigh : "rgba(45,45,45,0.10)",
          borderRadius: 16,
          borderWidth: 1,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
}

function ContentSettingsRow({
  label,
  value,
  isRTL,
  isDark,
  loading,
  loadingLabel,
  showDivider,
  onPress,
}: {
  label: string;
  value: string;
  isRTL: boolean;
  isDark: boolean;
  loading?: boolean;
  loadingLabel?: string;
  showDivider?: boolean;
  onPress: () => void;
}) {
  const { themeColors } = useSettings();
  const RowChevron = isRTL ? ChevronLeft : ChevronRight;
  const valueDirection = getInlineValueDirection(value);
  const chevronColor = isDark ? "#8A8A8A" : "#8B8178";
  const valueColor = isDark ? "#A3A3A3" : "#6F7280";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{
        alignItems: "center",
        backgroundColor: "transparent",
        borderBottomColor: isDark ? themeColors.surfaceHigh : "rgba(45,45,45,0.08)",
        borderBottomWidth: showDivider ? StyleSheet.hairlineWidth : 0,
        direction: "ltr",
        flexDirection: isRTL ? "row-reverse" : "row",
        gap: 18,
        justifyContent: "space-between",
        minHeight: CONTENT_SETTINGS_ROW_HEIGHT,
        paddingHorizontal: 18,
        paddingVertical: 10,
      }}
    >
      {/* Label and value wrap onto a second line rather than truncating, e.g. "Translation Language". */}
      <Text
        className="text-charcoal dark:text-neutral-100"
        numberOfLines={2}
        style={{
          flexShrink: 1,
          fontFamily: "Manrope_600SemiBold",
          fontSize: 16,
          maxWidth: "50%",
          ...textStartStyle(isRTL),
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {label}
      </Text>
      <View
        className="min-w-0 flex-1 items-center"
        style={{
          direction: "ltr",
          flexDirection: isRTL ? "row-reverse" : "row",
          gap: 10,
          // With row-reverse in Arabic, flex-end is the left edge, mirroring the English row where the
          // value and chevron sit at the end; flex-start left them beside the label at varying offsets.
          justifyContent: "flex-end",
        }}
      >
        <Text
          numberOfLines={2}
          style={{
            color: valueColor,
            flexShrink: 1,
            fontFamily: "Manrope_500Medium",
            fontSize: 15,
            ...textEndStyle(isRTL),
            writingDirection: valueDirection,
          }}
        >
          {value}
        </Text>
        {loading ? (
          <View className="items-center gap-2" style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}>
            {loadingLabel ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: valueColor, fontFamily: "Manrope_500Medium", fontSize: 13, writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {loadingLabel}
              </Text>
            ) : null}
            <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
          </View>
        ) : (
          <RowChevron size={21} strokeWidth={2.25} color={chevronColor} />
        )}
      </View>
    </Pressable>
  );
}

function getInlineValueDirection(value: string): "rtl" | "ltr" {
  return /[\u0600-\u06FF]/.test(value) ? "rtl" : "ltr";
}

function SectionLabel({ children }: { children: string }) {
  const { isRTL } = useSettings();
  return (
    <Text
      accessibilityRole="header"
      className="text-warm-500 dark:text-neutral-400 mb-3"
      style={{
        fontFamily: "Manrope_600SemiBold",
        fontSize: 13,
        ...textStartStyle(isRTL),
        writingDirection: isRTL ? "rtl" : "ltr",
      }}
    >
      {children}
    </Text>
  );
}

async function openQfAuthorizationUrl(url: string): Promise<void> {
  const location = (globalThis as any).location;
  if (location?.assign) {
    location.assign(url);
    return;
  }
  await Linking.openURL(url);
}
