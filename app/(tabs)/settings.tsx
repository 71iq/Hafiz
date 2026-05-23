import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, Linking, useWindowDimensions } from "react-native";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Toast } from "@/components/ui/Toast";
import { ScreenScrollView, useScreenContentLayout } from "@/components/ui/ScreenContent";
import { SafeAreaView } from "react-native-safe-area-context";
import { Sun, Moon, Smartphone, Minus, Plus, Check, ChevronRight, ChevronLeft, User, LogOut, BookOpen, RefreshCw, Unlink, Info, FileText, HeartHandshake, ExternalLink, Sparkles, SlidersHorizontal, type LucideIcon } from "lucide-react-native";
import {
  useSettings,
  FONT_SIZE_STEPS,
  type ThemeMode,
  type UILanguage,
  type PageScroll,
  type ViewMode,
} from "@/lib/settings/context";
import { useDatabase } from "@/lib/database/provider";
import { getLanguageByCode } from "@/lib/translations/languages";
import { AVAILABLE_TAFSIR_SOURCES } from "@/lib/tafsir/sources";
import { TranslationLanguagePicker } from "@/components/settings/TranslationLanguagePicker";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useStrings } from "@/lib/i18n/useStrings";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isQfSyncEnabled } from "@/lib/quran-foundation/config";
import { fetchQfReciters, type QfContentReciter } from "@/lib/quran-foundation/content";
import { RECITERS, formatReciterLabel, getReciterById, type QfReciter } from "@/lib/quran-foundation/recitations";
import { beginQfOAuthConnection, disconnectQfUser, getQfConnectionStatus, getQfLinkedIdentityState } from "@/lib/quran-foundation/user";
import { fullQfUserSync, runInitialQfUserSync } from "@/lib/quran-foundation/user-sync";
import type { QfConnectionStatus } from "@/lib/quran-foundation/user-types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { toArabicNumber } from "@/lib/arabic";
import { SETTINGS_CONTENT_MAX_WIDTH, SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { ZaytPreviewModal } from "@/components/zayt/ZaytPreviewModal";

type SettingsCategoryId = "general" | "reading" | "content" | "account" | "about" | "advanced";

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
    recitationId, setRecitationId,
    uiLanguage, setUiLanguage,
    pageScroll, setPageScroll,
    viewMode, setViewMode,
  } = useSettings();
  const db = useDatabase();
  const s = useStrings();
  const router = useRouter();
  const params = useLocalSearchParams<{ qf?: string; qf_error?: string; category?: string }>();
  const configured = isSupabaseConfigured();
  const qfSyncEnabled = isQfSyncEnabled();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [reciterPickerVisible, setReciterPickerVisible] = useState(false);
  const [zaytPreviewVisible, setZaytPreviewVisible] = useState(false);
  const [logoutDialogVisible, setLogoutDialogVisible] = useState(false);
  const [mobileCategory, setMobileCategory] = useState<SettingsCategoryId | null>(null);
  const [qfStatus, setQfStatus] = useState<QfConnectionStatus>("disconnected");
  const [qfBusy, setQfBusy] = useState(false);
  const [qfMessage, setQfMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const currentLang = getLanguageByCode(translationLanguage);
  const currentReciter = getReciterById(recitationId);
  const { user, profile, isLoading: authLoading, signOut } = useAuthStore();
  const accountName = profile?.display_name || profile?.username || user?.email || s.authProfile;
  const accountHandle = profile?.username ? `@${profile.username}` : user?.email || "";
  const fontSizeUsesFittedPageSize = viewMode === "page" && pageScroll === "horizontal";
  const fontSizeLevelLabel = isRTL ? toArabicNumber(fontSizeIndex + 1) : String(fontSizeIndex + 1);
  const fontSizeTotalLabel = isRTL ? toArabicNumber(FONT_SIZE_STEPS.length) : String(FONT_SIZE_STEPS.length);
  const TranslationChevron = isRTL ? ChevronLeft : ChevronRight;
  const { isLaptop } = useScreenContentLayout({ maxWidth: SETTINGS_CONTENT_MAX_WIDTH });
  const usesCategorySidebar = width >= SIDEBAR_BREAKPOINT;
  const categoryParam = Array.isArray(params.category) ? params.category[0] : params.category;
  const desktopCategory = parseSettingsCategory(categoryParam) ?? "general";
  const activeCategory = usesCategorySidebar ? desktopCategory : mobileCategory;
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

  const handleLogout = useCallback(async () => {
    await signOut();
    setLogoutDialogVisible(false);
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
    Linking.openURL("https://github.com/71iq/Hafiz/issues").catch((e) => {
      console.warn("[Settings] Failed to open issue reporter:", e);
      setToast(s.externalLinkFailed);
    });
  }, [s.externalLinkFailed]);

  const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: s.themeLight, icon: Sun },
    { value: "dark", label: s.themeDark, icon: Moon },
    { value: "system", label: s.themeAuto, icon: Smartphone },
  ];

  const settingsCategories: SettingsCategory[] = [
    { id: "general", title: s.settingsCategoryGeneral, icon: SlidersHorizontal },
    { id: "reading", title: s.settingsCategoryReading, icon: BookOpen },
    { id: "content", title: s.settingsCategoryContent, icon: FileText },
    { id: "account", title: s.settingsCategoryAccount, icon: User },
    { id: "about", title: s.settingsCategoryAbout, icon: Info },
    { id: "advanced", title: s.settingsCategoryAdvanced, icon: Sparkles },
  ];

  const handleCategorySelect = useCallback((category: SettingsCategoryId) => {
    setMobileCategory(category);
  }, []);

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
              style={{ flexDirection: isLaptop ? (isRTL ? "row" : "row-reverse") : "column" }}
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
              {AVAILABLE_TAFSIR_SOURCES.map((source) => (
                <TafseerSourceOption
                  key={source.id}
                  value={source.id}
                  title={s[source.labelKey] ?? source.id}
                  description={s[source.descriptionKey] ?? ""}
                  isActive={tafseerSource === source.id}
                  onPress={() => setTafseerSource(source.id)}
                  isDark={isDark}
                  isRTL={isRTL}
                />
              ))}
            </View>

            <View className="h-5" />

            <Text
              className="text-charcoal dark:text-neutral-300 mb-3"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 14, textAlign: isRTL ? "right" : "left" }}
            >
              {s.recitationSettingsLabel}
            </Text>
            <Pressable
              onPress={() => setReciterPickerVisible(true)}
              className="items-center justify-between gap-3 rounded-3xl bg-surface dark:bg-surface-dark px-4 py-4"
              style={{
                direction: isRTL ? "rtl" : "ltr",
                flexDirection: "row",
              }}
            >
              <View className="min-w-0 flex-1">
                <Text
                  className="text-charcoal dark:text-neutral-200"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }}
                >
                  {s.recitationFavoriteReciter}
                </Text>
                <Text
                  className="mt-0.5 text-warm-400 dark:text-neutral-500"
                  numberOfLines={2}
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: 12,
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {formatReciterLabel(currentReciter, uiLanguage)}
                </Text>
              </View>
              <TranslationChevron size={18} color={isDark ? "#525252" : "#DFD9D1"} />
            </Pressable>
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
                s.creditTahrirTanwir,
                s.creditQurtubi,
                s.creditKashshaf,
                s.creditAlusi,
                s.creditNazamDurar,
                s.creditRazi,
                s.creditAlBahrAlMadid,
                s.creditJalalayn,
                s.creditJalalaynEn,
                s.creditBridgesTranslation,
                s.creditNourQuran,
                s.creditSurahInfo,
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
      <ScreenScrollView maxWidth={SETTINGS_CONTENT_MAX_WIDTH} contentContainerStyle={{ paddingBottom: 48 }}>
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
          <View className="pb-8">
            {categoryPanels}
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
        confirmLoading={authLoading}
        isDark={isDark}
        isRTL={isRTL}
        onCancel={() => {
          if (!authLoading) setLogoutDialogVisible(false);
        }}
        onConfirm={handleLogout}
      />
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
      <TranslationLanguagePicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
      />
      <ReciterPicker
        visible={reciterPickerVisible}
        selectedId={recitationId}
        onSelect={setRecitationId}
        onClose={() => setReciterPickerVisible(false)}
      />
      <ZaytPreviewModal
        visible={zaytPreviewVisible}
        onClose={() => setZaytPreviewVisible(false)}
      />
    </SafeAreaView>
  );
}

function parseSettingsCategory(value: string | undefined): SettingsCategoryId | null {
  switch (value) {
    case "general":
    case "reading":
    case "content":
    case "account":
    case "about":
    case "advanced":
      return value;
    default:
      return null;
  }
}

function ReciterPicker({
  visible,
  selectedId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selectedId: number;
  onSelect: (id: number) => void;
  onClose: () => void;
}) {
  const { isDark, isRTL, uiLanguage } = useSettings();
  const s = useStrings();
  const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;
  const [reciters, setReciters] = useState<QfReciter[]>(RECITERS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    fetchQfReciters(uiLanguage)
      .then((response) => {
        if (cancelled) return;
        if (response.ok && response.reciters.length > 0) {
          setReciters(mergeReciters(response.reciters.map((reciter) => toSettingsReciter(reciter, uiLanguage)), RECITERS));
        } else {
          setReciters(RECITERS);
        }
      })
      .catch(() => {
        if (!cancelled) setReciters(RECITERS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uiLanguage, visible]);

  const pickerReciters = reciters.some((reciter) => reciter.id === selectedId)
    ? reciters
    : [getReciterById(selectedId), ...reciters].filter(
        (reciter, index, list) => list.findIndex((item) => item.id === reciter.id) === index
      );

  const handleSelect = (id: number) => {
    onSelect(id);
    onClose();
  };

  return (
    <ResponsiveSheet
      open={visible}
      onClose={onClose}
      dismissOnBackdrop
      maxWidth={560}
      maxHeight="82%"
      surfaceColor={isDark ? "#1C1917" : "#FFF8F1"}
    >
      <OverlayHeader
        title={s.recitationReciterPickerTitle}
        subtitle={s.recitationReciterPickerSubtitle}
        onClose={onClose}
        showHandle
        isRTL={isRTL}
      />
      <OverlayBody contentContainerClassName="px-5 pt-2 pb-6">
        {loading && (
          <View className={`mb-3 flex-row items-center gap-2 px-3 ${isRTL ? "flex-row-reverse" : ""}`}>
            <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
            >
              {s.recitationRecitersLoading}
            </Text>
          </View>
        )}
        <View className="gap-1">
          {pickerReciters.map((reciter) => {
            const selected = reciter.id === selectedId;
            return (
              <Pressable
                key={reciter.id}
                onPress={() => handleSelect(reciter.id)}
                className="items-center justify-between gap-3 rounded-2xl px-3 py-3.5"
                style={({ pressed }) => ({
                  direction: isRTL ? "rtl" : "ltr",
                  flexDirection: "row",
                  backgroundColor: selected
                    ? isDark
                      ? "rgba(45,212,191,0.08)"
                      : "rgba(13,148,136,0.06)"
                    : pressed
                      ? isDark
                        ? "rgba(45,212,191,0.04)"
                        : "rgba(13,148,136,0.03)"
                      : "transparent",
                })}
              >
                <View className="min-w-0 flex-1">
                  <Text
                    className={selected ? "text-primary-accent dark:text-primary-bright" : "text-charcoal dark:text-neutral-300"}
                    style={{
                      fontFamily: selected ? "Manrope_700Bold" : "Manrope_600SemiBold",
                      fontSize: 15,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {uiLanguage === "ar" ? reciter.nameAr : reciter.nameEn}
                  </Text>
                  <Text
                    className="mt-0.5 text-warm-400 dark:text-neutral-500"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 13,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {uiLanguage === "ar" ? reciter.styleAr : reciter.styleEn}
                  </Text>
                </View>

                {selected ? (
                  <Check size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
                ) : (
                  <DisclosureChevron size={18} color={isDark ? "#737373" : "#8B8178"} />
                )}
              </Pressable>
            );
          })}
        </View>
      </OverlayBody>
    </ResponsiveSheet>
  );
}

function toSettingsReciter(reciter: QfContentReciter, language: "en" | "ar"): QfReciter {
  const fallback = getReciterById(reciter.id);
  const translatedName = reciter.translatedName?.trim();
  const sourceName = reciter.reciterName.trim();
  const style = reciter.style.trim();
  return {
    id: reciter.id,
    nameEn: language === "en" ? translatedName || sourceName : fallback.nameEn,
    nameAr: language === "ar" ? translatedName || sourceName : fallback.nameAr,
    styleEn: language === "en" ? style || fallback.styleEn : fallback.styleEn,
    styleAr: language === "ar" ? localizeRecitationStyle(style) || fallback.styleAr : fallback.styleAr,
  };
}

function localizeRecitationStyle(style: string): string {
  const normalized = style.trim().toLowerCase();
  if (normalized === "murattal") return "مرتل";
  if (normalized === "mujawwad") return "مجود";
  if (normalized === "muallim") return "معلم";
  return style;
}

function mergeReciters(primary: QfReciter[], fallback: QfReciter[]): QfReciter[] {
  const byId = new Map<number, QfReciter>();
  fallback.forEach((reciter) => byId.set(reciter.id, reciter));
  primary.forEach((reciter) => byId.set(reciter.id, reciter));
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

function SettingsCategoryNav({
  categories,
  activeCategory,
  isDark,
  isRTL,
  onSelect,
}: {
  categories: SettingsCategory[];
  activeCategory: SettingsCategoryId | null;
  isDark: boolean;
  isRTL: boolean;
  onSelect: (category: SettingsCategoryId) => void;
}) {
  const RowChevron = isRTL ? ChevronLeft : ChevronRight;

  return (
    <Card
      elevation="low"
      className="p-2"
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
              className={`w-full items-center gap-3 rounded-2xl px-3 py-4 ${
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

function SectionLabel({ children }: { children: string }) {
  const { isRTL } = useSettings();
  return (
    <Text
      className="text-warm-400 dark:text-neutral-500 mb-3"
      style={{
        fontFamily: "Manrope_600SemiBold",
        fontSize: 14,
        letterSpacing: 0.6,
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
