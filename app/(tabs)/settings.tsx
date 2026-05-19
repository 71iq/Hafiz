import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, Linking, useWindowDimensions } from "react-native";
import { Switch } from "@/components/ui/Switch";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ScreenScrollView, useScreenContentLayout } from "@/components/ui/ScreenContent";
import { SafeAreaView } from "react-native-safe-area-context";
import { Sun, Moon, Smartphone, Minus, Plus, ChevronRight, ChevronLeft, User, LogOut, BookOpen, RefreshCw, Unlink, Info, FileText, HeartHandshake, ExternalLink, Sparkles, SlidersHorizontal, type LucideIcon } from "lucide-react-native";
import {
  useSettings,
  FONT_SIZE_STEPS,
  MIN_DAILY_REVIEW_LIMIT,
  MAX_DAILY_REVIEW_LIMIT,
  DAILY_REVIEW_LIMIT_STEP,
  type ThemeMode,
  type UILanguage,
  type TafseerSource,
  type PageScroll,
  type ViewMode,
} from "@/lib/settings/context";
import { useDatabase } from "@/lib/database/provider";
import { getLanguageByCode } from "@/lib/translations/languages";
import { TranslationLanguagePicker } from "@/components/settings/TranslationLanguagePicker";
import { useStrings } from "@/lib/i18n/useStrings";
import { ALL_TEST_MODES, DEFAULT_ENABLED_MODES, type TestMode } from "@/lib/fsrs/types";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isQfSyncEnabled } from "@/lib/quran-foundation/config";
import { beginQfOAuthConnection, disconnectQfUser, getQfConnectionStatus, getQfLinkedIdentityState } from "@/lib/quran-foundation/user";
import { fullQfUserSync, runInitialQfUserSync } from "@/lib/quran-foundation/user-sync";
import type { QfConnectionStatus } from "@/lib/quran-foundation/user-types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { toArabicNumber } from "@/lib/arabic";
import { DESKTOP_CONTENT_MAX_WIDTH, SETTINGS_CONTENT_MAX_WIDTH, SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { ZaytPreviewModal } from "@/components/zayt/ZaytPreviewModal";

type SettingsCategoryId = "general" | "reading" | "content" | "review" | "account" | "about" | "advanced";

type SettingsCategory = {
  id: SettingsCategoryId;
  title: string;
  icon: LucideIcon;
};

export default function SettingsScreen() {
  const {
    theme, setTheme, fontSizeIndex, setFontSizeIndex, fontSize,
    translationLanguage, isTranslationLoading, isDark, isRTL,
    tafseerSource, setTafseerSource,
    uiLanguage, setUiLanguage,
    dailyReviewLimit, setDailyReviewLimit,
    pageScroll, setPageScroll,
    viewMode, setViewMode,
  } = useSettings();
  const db = useDatabase();
  const s = useStrings();
  const router = useRouter();
  const params = useLocalSearchParams<{ qf?: string; qf_error?: string }>();
  const configured = isSupabaseConfigured();
  const qfSyncEnabled = isQfSyncEnabled();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [zaytPreviewVisible, setZaytPreviewVisible] = useState(false);
  const [logoutDialogVisible, setLogoutDialogVisible] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategoryId>("general");
  const [mobileCategory, setMobileCategory] = useState<SettingsCategoryId | null>(null);
  const [qfStatus, setQfStatus] = useState<QfConnectionStatus>("disconnected");
  const [qfBusy, setQfBusy] = useState(false);
  const [qfMessage, setQfMessage] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const currentLang = getLanguageByCode(translationLanguage);
  const [enabledModes, setEnabledModes] = useState<TestMode[]>(DEFAULT_ENABLED_MODES);
  const [wordModes, setWordModes] = useState<Array<"wordMeaningArabic" | "wordMeaningTranslation">>([
    "wordMeaningArabic",
    "wordMeaningTranslation",
  ]);
  const { user, profile, isLoading: authLoading, signOut } = useAuthStore();
  const accountName = profile?.display_name || profile?.username || user?.email || s.authProfile;
  const accountHandle = profile?.username ? `@${profile.username}` : user?.email || "";
  const fontSizeUsesFittedPageSize = viewMode === "page" && pageScroll === "horizontal";
  const fontSizeLevelLabel = isRTL ? toArabicNumber(fontSizeIndex + 1) : String(fontSizeIndex + 1);
  const fontSizeTotalLabel = isRTL ? toArabicNumber(FONT_SIZE_STEPS.length) : String(FONT_SIZE_STEPS.length);
  const TranslationChevron = isRTL ? ChevronLeft : ChevronRight;
  const { isLaptop } = useScreenContentLayout({ maxWidth: SETTINGS_CONTENT_MAX_WIDTH });
  const usesCategorySidebar = width >= SIDEBAR_BREAKPOINT;
  const activeCategory = usesCategorySidebar ? selectedCategory : mobileCategory;
  const settingsMaxWidth = usesCategorySidebar ? DESKTOP_CONTENT_MAX_WIDTH : SETTINGS_CONTENT_MAX_WIDTH;
  const modeLabels: Record<TestMode, string> = {
    nextAyah: s.flashcardsModeNextAyah,
    previousAyah: s.flashcardsModePreviousAyah,
    translation: s.flashcardsModeTranslation,
    tafseer: s.flashcardsModeTafseer,
    surahName: s.flashcardsModeSurahName,
  };

  useEffect(() => {
    db.getFirstAsync<{ value: string }>(
      "SELECT value FROM user_settings WHERE key = 'flashcard_test_modes'"
    ).then((row) => {
      if (row?.value) {
        try { setEnabledModes(JSON.parse(row.value)); } catch {}
      }
    });
  }, [db]);

  const refreshQfStatus = useCallback(async () => {
    if (!configured || !user || !qfSyncEnabled) {
      setQfStatus("disconnected");
      return "disconnected" as QfConnectionStatus;
    }
    const status = await getQfConnectionStatus();
    if (status.ok) {
      if (status.status === "disconnected") {
        const linked = await getQfLinkedIdentityState();
        const next = linked.linked ? "linked_no_sync" : "disconnected";
        setQfStatus(next);
        return next;
      }
      setQfStatus(status.status);
      return status.status;
    } else {
      const next = status.code === "needs_reauth" ? "needs_reauth" : "disconnected";
      setQfStatus(next);
      return next;
    }
  }, [configured, qfSyncEnabled, user]);

  useEffect(() => {
    refreshQfStatus().catch(console.warn);
  }, [refreshQfStatus]);

  useEffect(() => {
    const qf = Array.isArray(params.qf) ? params.qf[0] : params.qf;
    const qfError = Array.isArray(params.qf_error) ? params.qf_error[0] : params.qf_error;
    if (!qf && !qfError) return;

    let cancelled = false;
    const finishCallback = async () => {
      if (qfError) {
        setQfMessage(safeDecode(qfError));
        await refreshQfStatus();
        clearQfSettingsQuery();
        return;
      }
      if (qf === "connected") {
        setQfBusy(true);
        setQfMessage(null);
        try {
          const status = await refreshQfStatus();
          if (status === "connected") {
            const result = await runInitialQfUserSync(db);
            setQfMessage(result.status === "synced" ? s.qfSyncComplete : s.qfFinishConnection);
          } else {
            setQfMessage(s.qfFinishConnection);
          }
        } catch (err: any) {
          if (!cancelled) setQfMessage(err.message || s.qfSyncFailed);
        } finally {
          if (!cancelled) setQfBusy(false);
          clearQfSettingsQuery();
        }
      }
    };
    finishCallback().catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [db, params.qf, params.qf_error, refreshQfStatus, s.qfFinishConnection, s.qfSyncComplete, s.qfSyncFailed]);

  useEffect(() => {
    db.getFirstAsync<{ value: string }>(
      "SELECT value FROM user_settings WHERE key = 'word_flashcard_test_modes'"
    ).then((row) => {
      if (!row?.value) return;
      try {
        const parsed = JSON.parse(row.value) as Array<"wordMeaningArabic" | "wordMeaningTranslation">;
        const valid = parsed.filter((m) => m === "wordMeaningArabic" || m === "wordMeaningTranslation");
        if (valid.length > 0) setWordModes(valid);
      } catch {}
    });
  }, [db]);

  const toggleTestMode = useCallback((mode: TestMode) => {
    setEnabledModes((prev) => {
      const next = prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode];
      if (next.length === 0) return prev; // Must have at least one mode
      db.runAsync(
        "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
        ["flashcard_test_modes", JSON.stringify(next)]
      );
      return next;
    });
  }, [db]);

  const toggleWordMode = useCallback((mode: "wordMeaningArabic" | "wordMeaningTranslation") => {
    setWordModes((prev) => {
      const next = prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode];
      if (next.length === 0) return prev;
      db.runAsync(
        "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
        ["word_flashcard_test_modes", JSON.stringify(next)]
      );
      return next;
    });
  }, [db]);

  const handleLogout = useCallback(async () => {
    setLogoutDialogVisible(false);
    await signOut();
  }, [signOut]);

  const handleQfConnect = useCallback(async () => {
    setQfBusy(true);
    setQfMessage(null);
    try {
      const response = await beginQfOAuthConnection("https://hafizquran.app/auth/qf-callback", "/settings");
      if (!response.ok) throw new Error(response.message);
      setQfMessage(s.qfConnectionStarted);
      await openQfAuthorizationUrl(response.authorizationUrl);
    } catch (err: any) {
      setQfMessage(err.message || s.qfConnectionFailed);
    } finally {
      setQfBusy(false);
    }
  }, [s.qfConnectionFailed, s.qfConnectionStarted]);

  const handleQfDisconnect = useCallback(async () => {
    setQfBusy(true);
    setQfMessage(null);
    try {
      await disconnectQfUser();
      await refreshQfStatus();
      setQfStatus("disconnected");
      setQfMessage(s.qfDisconnected);
    } catch (err: any) {
      setQfMessage(err.message || s.qfSyncFailed);
    } finally {
      setQfBusy(false);
    }
  }, [refreshQfStatus, s.qfDisconnected, s.qfSyncFailed]);

  const handleQfManualSync = useCallback(async () => {
    setQfBusy(true);
    setQfMessage(null);
    try {
      const result = await fullQfUserSync(db);
      await refreshQfStatus();
      setQfMessage(
        result.status === "synced"
          ? s.qfSyncComplete
          : result.status === "needs_reauth"
            ? s.qfNeedsReauth
            : s.qfFinishConnection
      );
    } catch (err: any) {
      setQfMessage(err.message || s.qfSyncFailed);
    } finally {
      setQfBusy(false);
    }
  }, [db, refreshQfStatus, s.qfFinishConnection, s.qfNeedsReauth, s.qfSyncComplete, s.qfSyncFailed]);

  const openIssueReporter = useCallback(() => {
    Linking.openURL("https://github.com/71iq/Hafiz/issues").catch(console.warn);
  }, []);

  const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: s.themeLight, icon: Sun },
    { value: "dark", label: s.themeDark, icon: Moon },
    { value: "system", label: s.themeAuto, icon: Smartphone },
  ];

  const settingsCategories: SettingsCategory[] = [
    { id: "general", title: s.settingsCategoryGeneral, icon: SlidersHorizontal },
    { id: "reading", title: s.settingsCategoryReading, icon: BookOpen },
    { id: "content", title: s.settingsCategoryContent, icon: FileText },
    { id: "review", title: s.settingsCategoryReview, icon: RefreshCw },
    { id: "account", title: s.settingsCategoryAccount, icon: User },
    { id: "about", title: s.settingsCategoryAbout, icon: Info },
    { id: "advanced", title: s.settingsCategoryAdvanced, icon: Sparkles },
  ];

  const handleCategorySelect = useCallback((category: SettingsCategoryId) => {
    if (usesCategorySidebar) {
      setSelectedCategory(category);
      return;
    }
    setMobileCategory(category);
  }, [usesCategorySidebar]);

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
            <View className="flex-row gap-3">
              {THEME_OPTIONS.map((option) => {
                const isActive = theme === option.value;
                const IconComponent = option.icon;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setTheme(option.value)}
                    className={`flex-1 items-center py-4 rounded-2xl ${
                      isActive
                        ? "bg-primary-accent/10 dark:bg-primary-bright/15"
                        : "bg-surface-high dark:bg-surface-dark-high"
                    }`}
                    style={({ pressed }) => ({
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    })}
                  >
                    <IconComponent
                      size={20}
                      color={isActive ? (isDark ? "#2dd4bf" : "#0d9488") : (isDark ? "#737373" : "#b9a085")}
                    />
                    <Text
                      className={`text-sm mt-2 ${
                        isActive
                          ? "text-primary-accent dark:text-primary-bright"
                          : "text-warm-400 dark:text-neutral-500"
                      }`}
                      style={{ fontFamily: isActive ? "Manrope_600SemiBold" : "Manrope_500Medium" }}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          <Card elevation="low" className="p-5 mb-8">
            <View
              className={isLaptop ? "items-center justify-between gap-4" : "gap-4"}
              style={{ flexDirection: isLaptop ? (isRTL ? "row-reverse" : "row") : "column" }}
            >
              <View className="flex-1">
                <Text
                  className="text-charcoal dark:text-neutral-200 mb-1"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, textAlign: isRTL ? "right" : "left" }}
                >
                  {s.flashcardsDailyLimit}
                </Text>
                <Text
                  className="text-warm-400 dark:text-neutral-500"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
                >
                  {s.flashcardsDailyLimitDesc}
                </Text>
              </View>
              <SettingsStepper
                value={isRTL ? toArabicNumber(dailyReviewLimit) : String(dailyReviewLimit)}
                onDecrement={() => setDailyReviewLimit(dailyReviewLimit - DAILY_REVIEW_LIMIT_STEP)}
                onIncrement={() => setDailyReviewLimit(dailyReviewLimit + DAILY_REVIEW_LIMIT_STEP)}
                decrementDisabled={dailyReviewLimit <= MIN_DAILY_REVIEW_LIMIT}
                incrementDisabled={dailyReviewLimit >= MAX_DAILY_REVIEW_LIMIT}
                isDark={isDark}
                isRTL={isRTL}
              />
            </View>
          </Card>
        </>
      )}

      {activeCategory === "reading" && (
        <>
          <SectionLabel>{s.sectionReading}</SectionLabel>
          <Card elevation="low" className="p-5 mb-8">
            <Text
              className="text-charcoal dark:text-neutral-200 mb-3"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
            >
              {s.mushafViewModeLabel}
            </Text>
            <ToggleGroup<ViewMode>
              value={viewMode}
              onValueChange={setViewMode}
              items={[
                { value: "verse", label: s.mushafViewVerse },
                { value: "page", label: s.mushafViewPage },
              ]}
            />

            <View className="h-5" />

            <Text
              className={`text-charcoal dark:text-neutral-200 ${fontSizeUsesFittedPageSize ? "mb-1" : "mb-4"}`}
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
            >
              {s.fontSizeLabel}
            </Text>
            {fontSizeUsesFittedPageSize && (
              <Text
                className="text-warm-400 dark:text-neutral-500 mb-4"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
              >
                {s.fontSizeFixedPageView}
              </Text>
            )}

            <View
              className={isLaptop ? "mb-5 items-start justify-between gap-4" : "mb-5 gap-4"}
              style={{ flexDirection: isLaptop ? (isRTL ? "row-reverse" : "row") : "column" }}
            >
              <View className="flex-1">
                <Text
                  className="text-warm-400 dark:text-neutral-500"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
                >
                  {`${fontSizeLevelLabel}/${fontSizeTotalLabel}`}
                </Text>
              </View>
              <SettingsStepper
                value={`${fontSizeLevelLabel}/${fontSizeTotalLabel}`}
                onDecrement={() => setFontSizeIndex(fontSizeIndex - 1)}
                onIncrement={() => setFontSizeIndex(fontSizeIndex + 1)}
                decrementDisabled={fontSizeIndex === 0}
                incrementDisabled={fontSizeIndex === FONT_SIZE_STEPS.length - 1}
                isDark={isDark}
                isRTL={isRTL}
              />
            </View>

            <View className="bg-surface dark:bg-surface-dark rounded-2xl p-5">
              <Text
                className="text-charcoal dark:text-neutral-100 text-center"
                style={{
                  fontSize,
                  lineHeight: fontSize * 2.1,
                  writingDirection: "rtl",
                }}
              >
                بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ
              </Text>
            </View>

            <View className="h-5" />

            <Text
              className="text-charcoal dark:text-neutral-200 mb-3"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
            >
              {s.pageScrollLabel}
            </Text>
            <ToggleGroup<PageScroll>
              value={pageScroll}
              onValueChange={setPageScroll}
              items={[
                { value: "vertical", label: s.pageScrollVertical },
                { value: "horizontal", label: s.pageScrollHorizontal },
              ]}
            />
          </Card>
        </>
      )}

      {activeCategory === "content" && (
        <>
          <SectionLabel>{s.sectionInlineContent}</SectionLabel>
          <Card elevation="low" className="p-5 mb-8">
            <Pressable
              onPress={() => setPickerVisible(true)}
              className="items-center justify-between gap-3"
              style={{
                direction: isRTL ? "rtl" : "ltr",
                flexDirection: "row",
              }}
            >
              <View className="flex-1">
                <Text
                  className="text-charcoal dark:text-neutral-300"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 14, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
                >
                  {s.translationLanguageLabel}
                </Text>
                <Text
                  className="text-warm-400 dark:text-neutral-500 mt-0.5"
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: 12,
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {currentLang?.nameEnglish ?? "English"}
                </Text>
              </View>
              {isTranslationLoading ? (
                <ActivityIndicator size="small" color="#0d9488" />
              ) : (
                <TranslationChevron size={18} color={isDark ? "#525252" : "#DFD9D1"} />
              )}
            </Pressable>

            <View className="h-4" />

            <Text
              className="text-charcoal dark:text-neutral-300 mb-3"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 14 }}
            >
              {s.tafseerSourceLabel}
            </Text>
            <View className="gap-2">
              <TafseerSourceOption
                value="muyassar"
                title={s.tafseerMuyassar}
                description={s.tafseerMuyassarDesc}
                isActive={tafseerSource === "muyassar"}
                onPress={() => setTafseerSource("muyassar")}
                isDark={isDark}
                isRTL={isRTL}
              />
              <TafseerSourceOption
                value="zilal"
                title={s.tafseerZilal}
                description={s.tafseerZilalDesc}
                isActive={tafseerSource === "zilal"}
                onPress={() => setTafseerSource("zilal")}
                isDark={isDark}
                isRTL={isRTL}
              />
            </View>
          </Card>
        </>
      )}

      {activeCategory === "review" && (
        <>
          <SectionLabel>{s.flashcardsTestModes}</SectionLabel>
          <Card elevation="low" className="p-5 mb-8">
            <View
              className="gap-3"
              style={{
                flexDirection: isLaptop ? (isRTL ? "row-reverse" : "row") : "column",
                flexWrap: isLaptop ? "wrap" : "nowrap",
              }}
            >
              {ALL_TEST_MODES.map((mode) => (
                <SettingsSwitchRow
                  key={mode}
                  label={modeLabels[mode]}
                  value={enabledModes.includes(mode)}
                  onValueChange={() => toggleTestMode(mode)}
                  isDark={isDark}
                  isRTL={isRTL}
                  compact={isLaptop}
                />
              ))}
            </View>
            <Text
              className="text-warm-400 dark:text-neutral-500 mb-3 mt-5"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
            >
              {s.wordFlashcardsTestModes}
            </Text>
            <View
              className="gap-3"
              style={{
                flexDirection: isLaptop ? (isRTL ? "row-reverse" : "row") : "column",
                flexWrap: isLaptop ? "wrap" : "nowrap",
              }}
            >
              {[
                { key: "wordMeaningArabic" as const, label: s.flashcardsModeWordMeaningArabic },
                { key: "wordMeaningTranslation" as const, label: s.flashcardsModeWordMeaningTranslation },
              ].map((mode) => (
                <SettingsSwitchRow
                  key={mode.key}
                  label={mode.label}
                  value={wordModes.includes(mode.key)}
                  onValueChange={() => toggleWordMode(mode.key)}
                  isDark={isDark}
                  isRTL={isRTL}
                  compact={isLaptop}
                />
              ))}
            </View>
          </Card>
        </>
      )}

      {activeCategory === "account" && (
        <>
          <SectionLabel>{s.authAccount}</SectionLabel>
          <Card elevation="low" className="p-5 mb-8">
            {user ? (
              <View>
                <View className="flex-row items-center gap-3 mb-4">
                  <View className="w-12 h-12 rounded-full bg-primary-accent/10 dark:bg-primary-bright/15 items-center justify-center">
                    <User size={22} color={isDark ? "#2dd4bf" : "#0d9488"} />
                  </View>
                  <View className="flex-1">
                    <Text
                      className="text-charcoal dark:text-neutral-100"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
                    >
                      {accountName}
                    </Text>
                    {!!accountHandle && (
                      <Text
                        className="text-warm-400 dark:text-neutral-500"
                        style={{ fontFamily: "Manrope_400Regular", fontSize: 13 }}
                      >
                        {accountHandle}
                      </Text>
                    )}
                  </View>
                </View>
                <View className="mb-4">
                  <SettingsLinkRow
                    icon={User}
                    title={s.settingsProfile}
                    description={s.settingsProfileDesc}
                    onPress={() => router.push("/profile" as any)}
                    isDark={isDark}
                    isRTL={isRTL}
                  />
                </View>
                {configured && qfSyncEnabled && (
                  <View className="mb-4 rounded-3xl bg-surface dark:bg-surface-dark p-4">
                    <View className="flex-row items-center gap-3">
                      <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
                        <BookOpen size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-charcoal dark:text-neutral-100"
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, textAlign: isRTL ? "right" : "left" }}
                        >
                          {s.qfConnectionTitle}
                        </Text>
                        <Text
                          className="text-warm-400 dark:text-neutral-500 mt-0.5"
                          style={{ fontFamily: "Manrope_400Regular", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
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
                        style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
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
                            {qfBusy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <RefreshCw size={15} color="#FFFFFF" />}
                            <Text style={{ color: "#FFFFFF", fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                              {s.qfManualSync}
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={handleQfDisconnect}
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
                          {qfBusy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <BookOpen size={15} color="#FFFFFF" />}
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
                  className="flex-row items-center justify-center gap-2 py-3 rounded-full bg-surface dark:bg-surface-dark"
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
                <SettingsLinkRow
                  icon={User}
                  title={s.settingsProfile}
                  description={s.settingsProfileDesc}
                  onPress={() => router.push("/profile" as any)}
                  isDark={isDark}
                  isRTL={isRTL}
                />
                <Button
                  onPress={() => router.push("/auth/login")}
                  disabled={authLoading}
                >
                  <Text
                    className="text-white"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
                  >
                    {s.authLogin}
                  </Text>
                </Button>
                <Button
                  variant="outline"
                  onPress={() => router.push("/auth/signup")}
                  disabled={authLoading}
                >
                  <Text
                    className="text-charcoal dark:text-neutral-200"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
                  >
                    {s.authSignup}
                  </Text>
                </Button>
              </View>
            )}
          </Card>
        </>
      )}

      {activeCategory === "about" && (
        <>
          <SectionLabel>{s.settingsAboutSection}</SectionLabel>
          <Card elevation="low" className="p-2 mb-8">
            <View className="gap-1">
              <SettingsLinkRow
                icon={Info}
                title={s.settingsAboutHafiz}
                description={s.settingsAboutHafizDesc}
                onPress={() => router.push("/about" as any)}
                isDark={isDark}
                isRTL={isRTL}
              />
              <SettingsLinkRow
                icon={FileText}
                title={s.settingsPrivacyPolicy}
                description={s.settingsPrivacyPolicyDesc}
                onPress={() => router.push("/privacy" as any)}
                isDark={isDark}
                isRTL={isRTL}
              />
              <SettingsLinkRow
                icon={FileText}
                title={s.settingsTermsService}
                description={s.settingsTermsServiceDesc}
                onPress={() => router.push("/terms" as any)}
                isDark={isDark}
                isRTL={isRTL}
              />
              <SettingsLinkRow
                icon={ExternalLink}
                title={s.settingsReportIssue}
                description={s.settingsReportIssueDesc}
                onPress={openIssueReporter}
                isDark={isDark}
                isRTL={isRTL}
                external
              />
              <SettingsLinkRow
                icon={HeartHandshake}
                title={s.settingsBecomeDonor}
                description={s.settingsBecomeDonorDesc}
                onPress={() => router.push("/about" as any)}
                isDark={isDark}
                isRTL={isRTL}
              />
            </View>
          </Card>
        </>
      )}

      {activeCategory === "advanced" && (
        <>
          <SectionLabel>{s.sectionDeveloperTools}</SectionLabel>
          <Card elevation="low" className="p-2 mb-8">
            <SettingsLinkRow
              icon={Sparkles}
              title={s.settingsZaytPreview}
              description={s.settingsZaytPreviewDesc}
              onPress={() => setZaytPreviewVisible(true)}
              isDark={isDark}
              isRTL={isRTL}
            />
          </Card>

          <SectionLabel>{s.creditsSection}</SectionLabel>
          <Card elevation="low" className="p-5 mb-8">
            <View className="gap-2.5">
              {[
                s.creditWordMeanings,
                s.creditIrab,
                s.creditQiraat,
                s.creditNourQuran,
                s.creditTajweedRules,
                s.creditTajweedDesc,
              ].map((line, i) => (
                <View
                  key={i}
                  className="gap-2"
                  style={{
                    alignItems: "flex-start",
                    direction: isRTL ? "rtl" : "ltr",
                    flexDirection: "row",
                  }}
                >
                  <Text
                    className="text-warm-500 dark:text-neutral-400"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 12,
                      lineHeight: 18,
                      textAlign: "center",
                      width: 10,
                    }}
                  >
                    •
                  </Text>
                  <Text
                    className="flex-1 text-warm-500 dark:text-neutral-400"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 12,
                      lineHeight: 18,
                      writingDirection: isRTL ? "rtl" : "ltr",
                      textAlign: isRTL ? "right" : "left",
                    }}
                  >
                    {line}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        </>
      )}
    </>
  );

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScreenScrollView maxWidth={settingsMaxWidth} contentContainerStyle={{ paddingBottom: 48 }}>
        {/* Header */}
        <View className="pt-8 pb-4">
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: isLaptop ? 32 : 28 }}
          >
            {s.settingsTitle}
          </Text>
        </View>

        {usesCategorySidebar ? (
          <View
            className="gap-6 pb-8"
            style={{
              alignItems: "flex-start",
              flexDirection: isRTL ? "row-reverse" : "row",
            }}
          >
            <SettingsCategoryNav
              categories={settingsCategories}
              activeCategory={activeCategory}
              isDark={isDark}
              isRTL={isRTL}
              sidebar
              onSelect={handleCategorySelect}
            />
            <View className="flex-1">
              {categoryPanels}
            </View>
          </View>
        ) : (
          <View className="pb-8">
            <SettingsCategoryNav
              categories={settingsCategories}
              activeCategory={activeCategory}
              isDark={isDark}
              isRTL={isRTL}
              onSelect={handleCategorySelect}
            />
            {!!activeCategory && (
              <View className="mt-6">
                {categoryPanels}
              </View>
            )}
          </View>
        )}
      </ScreenScrollView>
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
      <TranslationLanguagePicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
      />
      <ZaytPreviewModal
        visible={zaytPreviewVisible}
        onClose={() => setZaytPreviewVisible(false)}
      />
    </SafeAreaView>
  );
}

function SettingsCategoryNav({
  categories,
  activeCategory,
  isDark,
  isRTL,
  sidebar = false,
  onSelect,
}: {
  categories: SettingsCategory[];
  activeCategory: SettingsCategoryId | null;
  isDark: boolean;
  isRTL: boolean;
  sidebar?: boolean;
  onSelect: (category: SettingsCategoryId) => void;
}) {
  const RowChevron = isRTL ? ChevronLeft : ChevronRight;
  const sidebarWidth = 220;

  return (
    <Card
      elevation="low"
      className="p-2"
      style={sidebar ? { width: sidebarWidth, flexShrink: 0 } : undefined}
    >
      <View className="gap-1">
        {categories.map((category) => {
          const isActive = activeCategory === category.id;
          const Icon = category.icon;
          const iconColor = isActive
            ? isDark ? "#2dd4bf" : "#0d9488"
            : isDark ? "#a3a3a3" : "#8a7661";
          const chevronColor = isActive
            ? isDark ? "#2dd4bf" : "#0d9488"
            : isDark ? "#525252" : "#cbbda9";

          return (
            <Pressable
              key={category.id}
              onPress={() => onSelect(category.id)}
              className={`w-full items-center gap-3 rounded-2xl px-3 ${sidebar ? "py-3" : "py-4"} ${
                isActive
                  ? "bg-primary-accent/10 dark:bg-primary-bright/15"
                  : "bg-transparent"
              }`}
              style={({ pressed }) => ({
                flexDirection: isRTL ? "row-reverse" : "row",
                opacity: pressed ? 0.78 : 1,
              })}
            >
              <View className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface dark:bg-surface-dark">
                <Icon size={17} color={iconColor} />
              </View>
              <Text
                className={isActive
                  ? "flex-1 text-primary-accent dark:text-primary-bright"
                  : "flex-1 text-charcoal dark:text-neutral-200"
                }
                style={{
                  fontFamily: isActive ? "Manrope_700Bold" : "Manrope_600SemiBold",
                  fontSize: 14,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {category.title}
              </Text>
              <RowChevron size={17} color={chevronColor} />
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

function SettingsStepper({
  value,
  onDecrement,
  onIncrement,
  decrementDisabled,
  incrementDisabled,
  isDark,
  isRTL,
}: {
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementDisabled: boolean;
  incrementDisabled: boolean;
  isDark: boolean;
  isRTL: boolean;
}) {
  const iconColor = isDark ? "#d4d4d4" : "#6e5a47";
  return (
    <View
      className="self-start rounded-full bg-surface-high dark:bg-surface-dark-high p-1"
      style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      <Pressable
        onPress={onDecrement}
        disabled={decrementDisabled}
        className="h-9 w-9 items-center justify-center rounded-full"
        style={({ pressed }) => ({
          opacity: decrementDisabled ? 0.35 : pressed ? 0.68 : 1,
          transform: [{ scale: pressed && !decrementDisabled ? 0.96 : 1 }],
        })}
      >
        <Minus size={17} color={iconColor} />
      </Pressable>
      <View className="min-w-16 items-center justify-center px-3">
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 14 }}
        >
          {value}
        </Text>
      </View>
      <Pressable
        onPress={onIncrement}
        disabled={incrementDisabled}
        className="h-9 w-9 items-center justify-center rounded-full"
        style={({ pressed }) => ({
          opacity: incrementDisabled ? 0.35 : pressed ? 0.68 : 1,
          transform: [{ scale: pressed && !incrementDisabled ? 0.96 : 1 }],
        })}
      >
        <Plus size={17} color={iconColor} />
      </Pressable>
    </View>
  );
}

function SettingsSwitchRow({
  label,
  value,
  onValueChange,
  isDark,
  isRTL,
  compact,
}: {
  label: string;
  value: boolean;
  onValueChange: () => void;
  isDark: boolean;
  isRTL: boolean;
  compact: boolean;
}) {
  return (
    <View
      className="items-center justify-between rounded-2xl bg-surface dark:bg-surface-dark px-3 py-2.5"
      style={{
        flexDirection: isRTL ? "row-reverse" : "row",
        width: compact ? "48%" : "100%",
      }}
    >
      <Text
        className="text-charcoal dark:text-neutral-300"
        style={{
          color: isDark ? "#d4d4d4" : "#2D2D2D",
          flex: 1,
          flexShrink: 1,
          fontFamily: "Manrope_500Medium",
          fontSize: 14,
          textAlign: isRTL ? "right" : "left",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {label}
      </Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  const { isRTL } = useSettings();
  return (
    <Text
      className="text-warm-400 dark:text-neutral-500 mb-3"
      style={{
        fontFamily: "Manrope_600SemiBold",
        fontSize: 11,
        letterSpacing: 1.2,
        textTransform: "uppercase",
        textAlign: isRTL ? "right" : "left",
        writingDirection: isRTL ? "rtl" : "ltr",
      }}
    >
      {children}
    </Text>
  );
}

function clearQfSettingsQuery() {
  const history = (globalThis as any).history;
  if (!history?.replaceState) return;
  history.replaceState(history.state, "", "/settings");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

async function openQfAuthorizationUrl(url: string): Promise<void> {
  const location = (globalThis as any).location;
  if (location?.assign) {
    location.assign(url);
    return;
  }
  await Linking.openURL(url);
}

function SettingsLinkRow({
  icon: Icon,
  title,
  description,
  onPress,
  isDark,
  isRTL,
  external,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onPress: () => void;
  isDark: boolean;
  isRTL: boolean;
  external?: boolean;
}) {
  const RowChevron = isRTL ? ChevronLeft : ChevronRight;
  const iconColor = isDark ? "#2dd4bf" : "#0d9488";
  const chevronColor = isDark ? "#525252" : "#DFD9D1";

  return (
    <Pressable
      onPress={onPress}
      className={`${isRTL ? "flex-row-reverse" : "flex-row"} items-center gap-3 rounded-2xl px-3 py-3`}
      style={({ pressed }) => ({
        backgroundColor: pressed
          ? isDark ? "#1A1A1A" : "#F0EBE3"
          : "transparent",
        opacity: pressed ? 0.86 : 1,
      })}
    >
      <View className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
        <Icon size={17} color={iconColor} />
      </View>
      <View className="flex-1">
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{
            fontFamily: "Manrope_600SemiBold",
            fontSize: 14,
            lineHeight: 19,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {title}
        </Text>
        <Text
          className="mt-0.5 text-warm-400 dark:text-neutral-500"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 12,
            lineHeight: 16,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {description}
        </Text>
      </View>
      {external ? (
        <ExternalLink size={16} color={chevronColor} />
      ) : (
        <RowChevron size={18} color={chevronColor} />
      )}
    </Pressable>
  );
}

function TafseerSourceOption({
  value,
  title,
  description,
  isActive,
  onPress,
  isDark,
  isRTL,
}: {
  value: string;
  title: string;
  description: string;
  isActive: boolean;
  onPress: () => void;
  isDark: boolean;
  isRTL: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`p-4 rounded-2xl ${
        isActive
          ? "bg-primary-accent/10 dark:bg-primary-bright/15"
          : "bg-surface-high dark:bg-surface-dark-high"
      }`}
      style={({ pressed }) => ({
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <Text
        className={isActive
          ? "text-primary-accent dark:text-primary-bright"
          : "text-charcoal dark:text-neutral-300"
        }
        style={{
          fontFamily: isActive ? "Manrope_600SemiBold" : "Manrope_500Medium",
          fontSize: 14,
          writingDirection: isRTL ? "rtl" : "ltr",
          textAlign: isRTL ? "right" : "left",
        }}
      >
        {title}
      </Text>
      <Text
        className="text-warm-400 dark:text-neutral-500 mt-0.5"
        style={{
          fontFamily: "Manrope_400Regular",
          fontSize: 12,
          writingDirection: isRTL ? "rtl" : "ltr",
          textAlign: isRTL ? "right" : "left",
        }}
      >
        {description}
      </Text>
    </Pressable>
  );
}
