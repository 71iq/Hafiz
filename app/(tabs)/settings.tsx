import { useState, useEffect, useCallback, type ReactNode } from "react";
import { View, Text, Pressable, ActivityIndicator, Linking, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Toast } from "@/components/ui/Toast";
import { ScreenScrollView, useScreenContentLayout } from "@/components/ui/ScreenContent";
import { SafeAreaView } from "react-native-safe-area-context";
import { Sun, Moon, Smartphone, Clock3, Circle, Minus, Plus, X, ChevronRight, ChevronLeft, User, LogOut, BookOpen, RefreshCw, Unlink, Info, FileText, HeartHandshake, ExternalLink, SlidersHorizontal, type LucideIcon } from "lucide-react-native";
import {
  useSettings,
  FONT_SIZE_STEPS,
  type ThemePalette,
  type ThemeScheduleRule,
  type ThemeMode,
  type UILanguage,
  type PageScroll,
  type QuranFontStyle,
  type QuranMarkerStyle,
  type ViewMode,
} from "@/lib/settings/context";
import { useDatabase } from "@/lib/database/provider";
import { getLanguageByCode } from "@/lib/translations/languages";
import { AVAILABLE_TAFSIR_SOURCES, type TafsirSourceId } from "@/lib/tafsir/sources";
import { ensureTafsirSourceImported } from "@/lib/database/init";
import { TafsirSourcePicker } from "@/components/settings/TafsirSourcePicker";
import { TranslationLanguagePicker } from "@/components/settings/TranslationLanguagePicker";
import { ReciterPicker } from "@/components/settings/ReciterPicker";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useStrings } from "@/lib/i18n/useStrings";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isQfSyncEnabled } from "@/lib/quran-foundation/config";
import { formatReciterLabel, getReciterById } from "@/lib/quran-foundation/recitations";
import { beginQfOAuthConnection, disconnectQfUser, getQfConnectionStatus, getQfLinkedIdentityState } from "@/lib/quran-foundation/user";
import { fullQfUserSync, runInitialQfUserSync } from "@/lib/quran-foundation/user-sync";
import type { QfConnectionStatus } from "@/lib/quran-foundation/user-types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { toArabicNumber } from "@/lib/arabic";
import { localizedAyahMarker } from "@/lib/quran/ayah-marker";
import {
  DESKTOP_CONTENT_GUTTER,
  PERSISTENT_SIDEBAR_WIDTH,
  SETTINGS_CONTENT_MAX_WIDTH,
} from "@/lib/ui/viewport";
import { ProfileIdentity } from "@/components/profile/ProfileIdentity";
import {
  isQuranPageFontLoaded,
  loadQuranPageFont,
  quranPageFontName,
  quranPageFontPaletteStyle,
  quranPageMarkerFontPaletteStyle,
} from "@/lib/fonts/loader";

type SettingsCategoryId = "general" | "content" | "account" | "about";

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

function shiftThemeTime(time: string, deltaMinutes: number) {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  const total = (hours * 60 + minutes + deltaMinutes + 24 * 60) % (24 * 60);
  const nextHours = Math.floor(total / 60);
  const nextMinutes = total % 60;
  return `${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}`;
}

function getThemeTimeParts(time: string) {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  return { hours, minutes };
}

function formatThemeTimePart(value: number, isRTL: boolean) {
  const text = String(value).padStart(2, "0");
  return isRTL ? text.replace(/\d/g, (digit) => toArabicNumber(Number(digit))) : text;
}

export default function SettingsScreen() {
  const {
    theme, setTheme, fontSizeIndex, setFontSizeIndex, fontSize,
    scheduledRules, setScheduledRules,
    translationLanguage, isTranslationLoading, isDark, isRTL, effectiveTheme,
    tafseerSource, setTafseerSource,
    recitationId, setRecitationId,
    uiLanguage, setUiLanguage,
    pageScroll, setPageScroll,
    viewMode, setViewMode,
    quranFontStyle, setQuranFontStyle,
    quranMarkerStyle, setQuranMarkerStyle,
  } = useSettings();
  const db = useDatabase();
  const s = useStrings();
  const router = useRouter();
  const params = useLocalSearchParams<{ qf?: string; qf_error?: string; category?: string }>();
  const configured = isSupabaseConfigured();
  const qfSyncEnabled = isQfSyncEnabled();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [tafseerPickerVisible, setTafseerPickerVisible] = useState(false);
  const [reciterPickerVisible, setReciterPickerVisible] = useState(false);
  const [logoutDialogVisible, setLogoutDialogVisible] = useState(false);
  const [qfStatus, setQfStatus] = useState<QfConnectionStatus>("disconnected");
  const [qfBusy, setQfBusy] = useState(false);
  const [qfMessage, setQfMessage] = useState<string | null>(null);
  const [importingTafseerSource, setImportingTafseerSource] = useState<TafsirSourceId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const currentLang = getLanguageByCode(translationLanguage);
  const currentTafseerSource = AVAILABLE_TAFSIR_SOURCES.find((source) => source.id === tafseerSource) ?? AVAILABLE_TAFSIR_SOURCES[0];
  const currentTafseerTitle = s[currentTafseerSource.labelKey] ?? currentTafseerSource.id;
  const currentReciter = getReciterById(recitationId);
  const { user, profile, isLoading: authLoading, signOut } = useAuthStore();
  const accountName = profile?.display_name || profile?.username || user?.email?.split("@")[0] || s.authProfile;
  const fontSizeUsesFittedPageSize = viewMode === "page" && pageScroll === "horizontal";
  const [quranPreview, setQuranPreview] = useState<QuranPreviewAyah | null>(null);
  const [quranPreviewFontReady, setQuranPreviewFontReady] = useState(false);
  const fontSizeLevelLabel = isRTL ? toArabicNumber(fontSizeIndex + 1) : String(fontSizeIndex + 1);
  const fontSizeTotalLabel = isRTL ? toArabicNumber(FONT_SIZE_STEPS.length) : String(FONT_SIZE_STEPS.length);
  const TranslationChevron = isRTL ? ChevronLeft : ChevronRight;
  const { isLaptop } = useScreenContentLayout({ maxWidth: SETTINGS_CONTENT_MAX_WIDTH });
  const settingsRailWidth = Math.min(
    SETTINGS_CONTENT_MAX_WIDTH,
    Math.max(0, width - (isLaptop ? PERSISTENT_SIDEBAR_WIDTH + DESKTOP_CONTENT_GUTTER * 2 : 48))
  );
  const appearanceCardInnerWidth = Math.max(0, settingsRailWidth - 40);
  const themeCardWidth = Math.floor(
    (appearanceCardInnerWidth - (isLaptop ? 24 : 12)) / (isLaptop ? 3 : 2)
  );
  const scheduledRuleThemeColumnCount = isLaptop && appearanceCardInnerWidth >= 560 ? 4 : 2;
  const scheduledRuleThemeCardWidth = Math.max(
    0,
    Math.floor((Math.max(0, appearanceCardInnerWidth - 56) - 10 * (scheduledRuleThemeColumnCount - 1)) / scheduledRuleThemeColumnCount)
  );
  const categoryParam = Array.isArray(params.category) ? params.category[0] : params.category;
  const activeCategory = parseSettingsCategory(categoryParam) ?? "general";
  const previewPage = quranPreview?.v2Page ?? 1;
  const previewFontFamily = quranPreview ? quranPageFontName(quranFontStyle, previewPage) : undefined;
  const previewFontPaletteStyle = quranPageFontPaletteStyle(quranFontStyle, previewPage, effectiveTheme);
  const previewMarkerFontPaletteStyle = quranPageMarkerFontPaletteStyle(
    quranFontStyle,
    previewPage,
    effectiveTheme,
    quranMarkerStyle
  );
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
    setQuranPreviewFontReady(false);
    if (!quranPreview) return;
    if (isQuranPageFontLoaded(quranFontStyle, quranPreview.v2Page)) {
      requestAnimationFrame(() => setQuranPreviewFontReady(true));
      return;
    }
    let cancelled = false;
    loadQuranPageFont(quranFontStyle, quranPreview.v2Page)
      .then(() => {
        if (!cancelled) requestAnimationFrame(() => setQuranPreviewFontReady(true));
      })
      .catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [quranFontStyle, quranPreview]);

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

  const THEME_OPTIONS: { value: ThemeMode; label: string; icon: LucideIcon }[] = [
    { value: "dark", label: s.themeDark, icon: Moon },
    { value: "beige", label: s.themeBeige, icon: Sun },
    { value: "white", label: s.themeWhite, icon: Circle },
    { value: "amoled", label: s.themeAmoled, icon: Moon },
    { value: "system", label: s.themeSystem, icon: Smartphone },
    { value: "scheduled", label: s.themeScheduled, icon: Clock3 },
  ];
  const SCHEDULED_THEME_OPTIONS: { value: ThemePalette; label: string; icon: LucideIcon }[] = [
    { value: "dark", label: s.themeDark, icon: Moon },
    { value: "beige", label: s.themeBeige, icon: Sun },
    { value: "white", label: s.themeWhite, icon: Circle },
    { value: "amoled", label: s.themeAmoled, icon: Moon },
  ];

  const updateScheduledRule = useCallback(
    (ruleId: string, patch: Partial<Pick<ThemeScheduleRule, "theme" | "time">>) => {
      setScheduledRules(scheduledRules.map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule));
    },
    [scheduledRules, setScheduledRules]
  );

  const addScheduledRule = useCallback(() => {
    const lastRule = scheduledRules[scheduledRules.length - 1] ?? { id: "default", theme: "dark" as ThemePalette, time: "21:00" };
    setScheduledRules([
      ...scheduledRules,
      {
        id: `rule-${Date.now()}`,
        theme: lastRule.theme === "dark" || lastRule.theme === "amoled" ? "white" : "dark",
        time: shiftThemeTime(lastRule.time, 60),
      },
    ]);
  }, [scheduledRules, setScheduledRules]);

  const removeScheduledRule = useCallback(
    (ruleId: string) => {
      if (scheduledRules.length <= 1) return;
      setScheduledRules(scheduledRules.filter((rule) => rule.id !== ruleId));
    },
    [scheduledRules, setScheduledRules]
  );

  const settingsCategories: SettingsCategory[] = [
    { id: "general", title: s.settingsCategoryGeneral, icon: SlidersHorizontal },
    { id: "content", title: s.settingsCategoryContent, icon: FileText },
    { id: "account", title: s.settingsCategoryAccount, icon: User },
    { id: "about", title: s.settingsCategoryAbout, icon: Info },
  ];

  const handleCategorySelect = useCallback((category: SettingsCategoryId) => {
    router.setParams({ category });
  }, [router]);

  const handleTafseerSourceSelect = useCallback(
    async (sourceId: TafsirSourceId) => {
      if (importingTafseerSource) return false;
      setImportingTafseerSource(sourceId);
      try {
        await ensureTafsirSourceImported(db, sourceId);
        setTafseerSource(sourceId);
        return true;
      } catch (err) {
        console.warn("[Settings] Failed to import tafsir source:", err);
        setToast(s.tafseerSourceImportFailed);
        return false;
      } finally {
        setImportingTafseerSource(null);
      }
    },
    [db, importingTafseerSource, s.tafseerSourceImportFailed, setTafseerSource]
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
                flexDirection: isRTL ? "row-reverse" : "row",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              {THEME_OPTIONS.map((option) => {
                const isActive = theme === option.value;
                const IconComponent = option.icon;
                return (
                  <View key={option.value} style={{ width: themeCardWidth, minHeight: 96 }}>
                    <Pressable
                      onPress={() => setTheme(option.value)}
                      className={`flex-1 items-center justify-center rounded-2xl px-3 py-4 ${
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
                        numberOfLines={2}
                        style={{
                          fontFamily: isActive ? "Manrope_600SemiBold" : "Manrope_500Medium",
                          minHeight: 36,
                          textAlign: "center",
                          writingDirection: isRTL ? "rtl" : "ltr",
                        }}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            {theme === "scheduled" && (
              <View className="mt-5 gap-3 rounded-3xl bg-surface-high/60 p-4 dark:bg-surface-dark-high/60">
                <Text
                  className="text-charcoal dark:text-neutral-200"
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    fontSize: 14,
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {s.themeScheduleRules}
                </Text>
                {scheduledRules.map((rule) => {
                  const timeParts = getThemeTimeParts(rule.time);
                  return (
                    <View key={rule.id} className="rounded-2xl bg-surface p-3 dark:bg-surface-dark">
                      <View
                        className="mb-3 items-center justify-between gap-3"
                        style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
                      >
                        <Text
                          className="text-charcoal dark:text-neutral-200"
                          style={{
                            fontFamily: "Manrope_600SemiBold",
                            fontSize: 13,
                            textAlign: isRTL ? "right" : "left",
                            writingDirection: isRTL ? "rtl" : "ltr",
                          }}
                        >
                          {s.themeScheduleTarget}
                        </Text>
                        {scheduledRules.length > 1 && (
                          <Pressable
                            accessibilityLabel={s.themeScheduleRemoveRule}
                            onPress={() => removeScheduledRule(rule.id)}
                            className="h-8 w-8 items-center justify-center rounded-full bg-surface-high dark:bg-surface-dark-high"
                            style={({ pressed }) => ({
                              opacity: pressed ? 0.68 : 1,
                              transform: [{ scale: pressed ? 0.96 : 1 }],
                            })}
                          >
                            <X size={15} color={isDark ? "#d4d4d4" : "#6e5a47"} />
                          </Pressable>
                        )}
                      </View>
                      <View
                        style={{
                          flexDirection: isRTL ? "row-reverse" : "row",
                          flexWrap: "wrap",
                          gap: 10,
                        }}
                      >
                        {SCHEDULED_THEME_OPTIONS.map((option) => {
                          const isActive = rule.theme === option.value;
                          const IconComponent = option.icon;
                          return (
                            <View key={option.value} style={{ width: scheduledRuleThemeCardWidth, minHeight: 76 }}>
                              <Pressable
                                onPress={() => updateScheduledRule(rule.id, { theme: option.value })}
                                className={`flex-1 items-center justify-center rounded-2xl px-3 py-3 ${
                                  isActive
                                    ? "bg-primary-accent/10 dark:bg-primary-bright/15"
                                    : "bg-surface-high dark:bg-surface-dark-high"
                                }`}
                                style={({ pressed }) => ({
                                  transform: [{ scale: pressed ? 0.98 : 1 }],
                                })}
                              >
                                <IconComponent
                                  size={18}
                                  color={isActive ? (isDark ? "#2dd4bf" : "#0d9488") : (isDark ? "#737373" : "#b9a085")}
                                />
                                <Text
                                  className={`mt-1.5 text-xs ${
                                    isActive
                                      ? "text-primary-accent dark:text-primary-bright"
                                      : "text-warm-400 dark:text-neutral-500"
                                  }`}
                                  numberOfLines={2}
                                  style={{
                                    fontFamily: isActive ? "Manrope_600SemiBold" : "Manrope_500Medium",
                                    minHeight: 32,
                                    textAlign: "center",
                                    writingDirection: isRTL ? "rtl" : "ltr",
                                  }}
                                >
                                  {option.label}
                                </Text>
                              </Pressable>
                            </View>
                          );
                        })}
                      </View>

                      <View
                        className="mt-4 items-center justify-between gap-4"
                        style={{ flexDirection: isLaptop ? (isRTL ? "row-reverse" : "row") : "column" }}
                      >
                        <Text
                          className="text-charcoal dark:text-neutral-200"
                          style={{
                            alignSelf: isLaptop ? "auto" : isRTL ? "flex-end" : "flex-start",
                            fontFamily: "Manrope_600SemiBold",
                            fontSize: 13,
                            textAlign: isRTL ? "right" : "left",
                            writingDirection: isRTL ? "rtl" : "ltr",
                          }}
                        >
                          {s.themeScheduleAt}
                        </Text>
                        <View
                          className="items-center gap-2"
                          style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
                        >
                          <SettingsStepper
                            value={formatThemeTimePart(timeParts.hours, isRTL)}
                            onDecrement={() => updateScheduledRule(rule.id, { time: shiftThemeTime(rule.time, -60) })}
                            onIncrement={() => updateScheduledRule(rule.id, { time: shiftThemeTime(rule.time, 60) })}
                            decrementDisabled={false}
                            incrementDisabled={false}
                            isDark={isDark}
                            isRTL={isRTL}
                          />
                          <Text
                            className="text-charcoal dark:text-neutral-100"
                            style={{ fontFamily: "Manrope_700Bold", fontSize: 18 }}
                          >
                            :
                          </Text>
                          <SettingsStepper
                            value={formatThemeTimePart(timeParts.minutes, isRTL)}
                            onDecrement={() => updateScheduledRule(rule.id, { time: shiftThemeTime(rule.time, -1) })}
                            onIncrement={() => updateScheduledRule(rule.id, { time: shiftThemeTime(rule.time, 1) })}
                            decrementDisabled={false}
                            incrementDisabled={false}
                            isDark={isDark}
                            isRTL={isRTL}
                          />
                        </View>
                      </View>
                    </View>
                  );
                })}
                <Pressable
                  onPress={addScheduledRule}
                  className="mt-1 items-center justify-center gap-2 rounded-2xl border border-primary-accent/25 bg-primary-accent/5 px-4 py-3 dark:border-primary-bright/25 dark:bg-primary-bright/10"
                  style={({ pressed }) => ({
                    flexDirection: isRTL ? "row-reverse" : "row",
                    opacity: pressed ? 0.72 : 1,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  })}
                >
                  <Plus size={17} color={isDark ? "#2dd4bf" : "#0d9488"} />
                  <Text
                    className="text-primary-accent dark:text-primary-bright"
                    style={{
                      fontFamily: "Manrope_700Bold",
                      fontSize: 13,
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {s.themeScheduleAddRule}
                  </Text>
                </Pressable>
              </View>
            )}
          </Card>

          <SectionLabel>{s.sectionReading}</SectionLabel>
          <Card elevation="low" className="p-4 mb-8">
            <View className="gap-4">
              <SettingsControlRow label={s.mushafViewModeLabel} isRTL={isRTL}>
                <ToggleGroup<ViewMode>
                  value={viewMode}
                  onValueChange={setViewMode}
                  items={[
                    { value: "verse", label: s.mushafViewVerse },
                    { value: "page", label: s.mushafViewPage },
                  ]}
                />
              </SettingsControlRow>

              <SettingsControlRow label={s.quranFontLabel} isRTL={isRTL}>
                <ToggleGroup<QuranFontStyle>
                  value={quranFontStyle}
                  onValueChange={setQuranFontStyle}
                  items={[
                    { value: "qcf2", label: s.quranFontQcf2 },
                    { value: "v4", label: s.quranFontV4 },
                    { value: "v4-tajweed", label: s.quranFontV4Tajweed },
                  ]}
                />
              </SettingsControlRow>

              {quranFontStyle !== "qcf2" && (
                <SettingsControlRow label={s.quranMarkerStyleLabel} isRTL={isRTL}>
                  <ToggleGroup<QuranMarkerStyle>
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
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {s.fontSizeLabel}
                  </Text>
                  {fontSizeUsesFittedPageSize && (
                    <Text
                      className="text-warm-400 dark:text-neutral-500"
                      style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
                    >
                      {s.fontSizeFixedPageView}
                    </Text>
                  )}
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

              <View className="bg-surface dark:bg-surface-dark rounded-2xl px-4 py-4">
                {quranPreview ? (
                  <View
                    style={{
                      direction: "ltr",
                      flexDirection: "row-reverse",
                      flexWrap: "wrap",
                      justifyContent: "center",
                      alignItems: "center",
                      gap: Math.max(4, fontSize * 0.18),
                      rowGap: Math.max(4, fontSize * 0.2),
                      opacity: quranPreviewFontReady ? 1 : 0,
                    }}
                  >
                    {quranPreview.tokens.map((token, index) => {
                      const isMarker = index === quranPreview.tokens.length - 1;
                      const usesLocalizedMarker = isMarker && !isRTL;
                      const displayToken = usesLocalizedMarker ? localizedAyahMarker(SETTINGS_QURAN_PREVIEW_AYAH, false) : token;
                      return (
                        <Text
                          key={`${token}-${index}`}
                          className="text-charcoal dark:text-neutral-100 text-center"
                          style={{
                            fontFamily: usesLocalizedMarker ? "Manrope_600SemiBold" : previewFontFamily,
                            ...(usesLocalizedMarker ? {} : isMarker ? previewMarkerFontPaletteStyle : previewFontPaletteStyle),
                            fontSize: usesLocalizedMarker ? Math.max(14, fontSize * 0.62) : fontSize,
                            lineHeight: fontSize * 1.8,
                            writingDirection: usesLocalizedMarker ? "ltr" : undefined,
                          }}
                        >
                          {displayToken}
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
                  value={pageScroll}
                  onValueChange={setPageScroll}
                  items={[
                    { value: "vertical", label: s.pageScrollVertical },
                    { value: "horizontal", label: s.pageScrollHorizontal },
                  ]}
                />
              </SettingsControlRow>
            </View>
          </Card>

        </>
      )}

      {activeCategory === "content" && (
        <ContentSettingsPanel isRTL={isRTL}>
          <ContentSettingsTitle isRTL={isRTL}>{s.sectionInlineContent}</ContentSettingsTitle>
          <View style={{ gap: 34 }}>
            <ContentSettingsGroup title={s.readingContentSettingsLabel} isRTL={isRTL}>
              <ContentSettingsRow
                label={s.translationLanguageLabel}
                value={currentLang?.nameEnglish ?? "English"}
                isRTL={isRTL}
                isDark={isDark}
                loading={isTranslationLoading}
                showDivider
                onPress={() => setPickerVisible(true)}
              />
              <ContentSettingsRow
                label={s.tafseerSourceLabel}
                value={currentTafseerTitle}
                isRTL={isRTL}
                isDark={isDark}
                loading={Boolean(importingTafseerSource)}
                onPress={() => setTafseerPickerVisible(true)}
              />
            </ContentSettingsGroup>

            <ContentSettingsGroup title={s.recitationSettingsLabel} isRTL={isRTL}>
              <ContentSettingsRow
                label={s.recitationFavoriteReciter}
                value={formatReciterLabel(currentReciter, uiLanguage)}
                isRTL={isRTL}
                isDark={isDark}
                onPress={() => setReciterPickerVisible(true)}
              />
            </ContentSettingsGroup>
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
                  className={`mb-4 items-center gap-3 rounded-3xl bg-surface dark:bg-surface-dark p-4 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
                  style={({ pressed }) => ({ opacity: pressed ? 0.74 : 1 })}
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
                  />
                  <TranslationChevron size={18} color={isDark ? "#525252" : "#DFD9D1"} />
                </Pressable>
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
                icon={FileText}
                title={s.creditsSection}
                description={s.settingsCreditsDesc}
                onPress={() => router.push("/credits" as any)}
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
    </>
  );

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScreenScrollView maxWidth={SETTINGS_CONTENT_MAX_WIDTH} contentContainerStyle={{ paddingBottom: 48 }}>
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
              textAlign: isRTL ? "right" : "left",
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {s.settingsTitle}
          </Text>
          <SettingsCategoryTabs
            categories={settingsCategories}
            activeCategory={activeCategory}
            isDark={isDark}
            isRTL={isRTL}
            onSelect={handleCategorySelect}
            compact={!isLaptop}
          />
        </View>

        <View className="pb-8">
          {categoryPanels}
        </View>
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
      <TafsirSourcePicker
        visible={tafseerPickerVisible}
        selectedSource={tafseerSource}
        importingSource={importingTafseerSource}
        onSelect={handleTafseerSourceSelect}
        onClose={() => setTafseerPickerVisible(false)}
      />
      <ReciterPicker
        visible={reciterPickerVisible}
        selectedId={recitationId}
        onSelect={setRecitationId}
        onClose={() => setReciterPickerVisible(false)}
      />
    </SafeAreaView>
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
  activeCategory,
  isDark,
  isRTL,
  onSelect,
  compact,
}: {
  categories: SettingsCategory[];
  activeCategory: SettingsCategoryId;
  isDark: boolean;
  isRTL: boolean;
  onSelect: (category: SettingsCategoryId) => void;
  compact: boolean;
}) {
  const items = categories.map((category) => {
    const isActive = activeCategory === category.id;
    const Icon = category.icon;
    const iconColor = isActive
      ? isDark ? "#2dd4bf" : "#0d9488"
      : isDark ? "#a3a3a3" : "#8a7661";
    return {
      value: category.id,
      label: category.title,
      icon: <Icon size={15} color={iconColor} />,
    };
  });

  const tabs = (
    <ToggleGroup<SettingsCategoryId>
      value={activeCategory}
      onValueChange={onSelect}
      items={items}
      dir={isRTL ? "rtl" : "ltr"}
      className="bg-surface-low/80 dark:bg-surface-dark-low/80"
      style={{
        flex: compact ? undefined : 1,
        maxWidth: compact ? undefined : 620,
        minWidth: compact ? undefined : 520,
        width: compact ? 520 : undefined,
      }}
    />
  );

  if (compact) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ alignSelf: "stretch" }}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {tabs}
      </ScrollView>
    );
  }

  return tabs;
}

function SettingsControlRow({
  label,
  isRTL,
  children,
}: {
  label: string;
  isRTL: boolean;
  children: ReactNode;
}) {
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
          textAlign: isRTL ? "right" : "left",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {label}
      </Text>
      <View style={{ flexBasis: 320, flexGrow: 1, maxWidth: "100%", minWidth: 240 }}>
        {children}
      </View>
    </View>
  );
}

function ContentSettingsPanel({ children, isRTL }: { children: ReactNode; isRTL: boolean }) {
  return (
    <View
      style={{
        alignSelf: isRTL ? "flex-end" : "flex-start",
        maxWidth: CONTENT_SETTINGS_MAX_WIDTH,
        width: "100%",
      }}
    >
      {children}
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
        textAlign: isRTL ? "right" : "left",
        writingDirection: isRTL ? "rtl" : "ltr",
      }}
    >
      {children}
    </Text>
  );
}

function ContentSettingsGroup({ title, isRTL, children }: { title: string; isRTL: boolean; children: ReactNode }) {
  const { isDark, themeColors } = useSettings();
  return (
    <View>
      <Text
        className="mb-4 text-charcoal dark:text-neutral-100"
        style={{
          fontFamily: "Manrope_700Bold",
          fontSize: 20,
          lineHeight: 26,
          textAlign: isRTL ? "right" : "left",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {title}
      </Text>
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
  showDivider,
  onPress,
}: {
  label: string;
  value: string;
  isRTL: boolean;
  isDark: boolean;
  loading?: boolean;
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
        paddingVertical: 0,
      }}
    >
      <Text
        className="text-charcoal dark:text-neutral-100"
        numberOfLines={1}
        style={{
          flexShrink: 0,
          fontFamily: "Manrope_600SemiBold",
          fontSize: 16,
          maxWidth: "48%",
          textAlign: isRTL ? "right" : "left",
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
          justifyContent: isRTL ? "flex-start" : "flex-end",
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            color: valueColor,
            flexShrink: 1,
            fontFamily: "Manrope_500Medium",
            fontSize: 15,
            textAlign: isRTL ? "left" : "right",
            writingDirection: valueDirection,
          }}
        >
          {value}
        </Text>
        {loading ? (
          <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
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
  const { themeColors } = useSettings();
  const iconColor = isDark ? "#2dd4bf" : "#0d9488";
  const chevronColor = isDark ? "#525252" : "#DFD9D1";

  return (
    <Pressable
      onPress={onPress}
      className={`${isRTL ? "flex-row-reverse" : "flex-row"} items-center gap-3 rounded-2xl px-3 py-3`}
      style={({ pressed }) => ({
        backgroundColor: pressed ? themeColors.surfaceMid : "transparent",
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
