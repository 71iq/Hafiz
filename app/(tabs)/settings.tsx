import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView, Alert } from "react-native";
import { Switch } from "@/components/ui/Switch";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { SafeAreaView } from "react-native-safe-area-context";
import { Sun, Moon, Smartphone, Minus, Plus, ChevronRight, ChevronLeft, User, LogOut } from "lucide-react-native";
import {
  useSettings,
  FONT_SIZE_STEPS,
  MIN_DAILY_REVIEW_LIMIT,
  MAX_DAILY_REVIEW_LIMIT,
  DAILY_REVIEW_LIMIT_STEP,
  type ThemeMode,
  type UILanguage,
  type TafseerSource,
} from "@/lib/settings/context";
import { useDatabase } from "@/lib/database/provider";
import { getLanguageByCode } from "@/lib/translations/languages";
import { TranslationLanguagePicker } from "@/components/settings/TranslationLanguagePicker";
import { useStrings } from "@/lib/i18n/useStrings";
import { ALL_TEST_MODES, DEFAULT_ENABLED_MODES, type TestMode } from "@/lib/fsrs/types";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useRouter } from "expo-router";

export default function SettingsScreen() {
  const {
    theme, setTheme, fontSizeIndex, setFontSizeIndex, fontSize,
    showTranslation, setShowTranslation, showTafseer, setShowTafseer,
    translationLanguage, isTranslationLoading, isDark, isRTL,
    tafseerSource, setTafseerSource,
    uiLanguage, setUiLanguage,
    dailyReviewLimit, setDailyReviewLimit,
  } = useSettings();
  const db = useDatabase();
  const s = useStrings();
  const router = useRouter();
  const [pickerVisible, setPickerVisible] = useState(false);
  const currentLang = getLanguageByCode(translationLanguage);
  const [enabledModes, setEnabledModes] = useState<TestMode[]>(DEFAULT_ENABLED_MODES);
  const { user, profile, isLoading: authLoading, signOut } = useAuthStore();
  const configured = isSupabaseConfigured();

  useEffect(() => {
    db.getFirstAsync<{ value: string }>(
      "SELECT value FROM user_settings WHERE key = 'flashcard_test_modes'"
    ).then((row) => {
      if (row?.value) {
        try { setEnabledModes(JSON.parse(row.value)); } catch {}
      }
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

  const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: s.themeLight, icon: Sun },
    { value: "dark", label: s.themeDark, icon: Moon },
    { value: "system", label: s.themeAuto, icon: Smartphone },
  ];

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      {/* Header — Gallery feel with generous top spacing */}
      <View className="px-6 pt-8 pb-4">
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}
        >
          {s.settingsTitle}
        </Text>
      </View>

      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 48 }}>

        {/* Account Section */}
        <SectionLabel>{s.authAccount}</SectionLabel>
        <Card elevation="low" className="p-5 mb-8">
          {user && profile ? (
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
                    {profile.display_name || profile.username}
                  </Text>
                  <Text
                    className="text-warm-400 dark:text-neutral-500"
                    style={{ fontFamily: "Manrope_400Regular", fontSize: 13 }}
                  >
                    @{profile.username}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => {
                  Alert.alert(s.authLogout, s.authLogoutConfirm, [
                    { text: s.flashcardsCancel, style: "cancel" },
                    { text: s.authLogout, style: "destructive", onPress: signOut },
                  ]);
                }}
                className="flex-row items-center justify-center gap-2 py-3 rounded-full bg-surface dark:bg-surface-dark"
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
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
          ) : configured ? (
            <View className="gap-2">
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
          ) : (
            <Text
              className="text-warm-400 dark:text-neutral-500 text-center py-2"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 13 }}
            >
              {s.authNotConfigured}
            </Text>
          )}
        </Card>

        {/* Language Section */}
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

        {/* Appearance Section */}
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

        {/* Reading Section */}
        <SectionLabel>{s.sectionReading}</SectionLabel>
        <Card elevation="low" className="p-5 mb-8">
          <Text
            className="text-charcoal dark:text-neutral-200 mb-4"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
          >
            {s.fontSizeLabel}
          </Text>

          {/* Size control */}
          <View className="flex-row items-center justify-between mb-5">
            <Pressable
              onPress={() => setFontSizeIndex(fontSizeIndex - 1)}
              disabled={fontSizeIndex === 0}
              className="w-10 h-10 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
              style={{ opacity: fontSizeIndex === 0 ? 0.3 : 1 }}
            >
              <Minus size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
            </Pressable>

            {/* Step indicators */}
            <View className="flex-row items-center gap-2.5">
              {FONT_SIZE_STEPS.map((_, i) => (
                <View
                  key={i}
                  className={`rounded-full ${
                    i === fontSizeIndex
                      ? "w-3 h-3 bg-primary-accent"
                      : i < fontSizeIndex
                        ? "w-2.5 h-2.5 bg-primary-accent/40"
                        : "w-2.5 h-2.5 bg-surface-high dark:bg-surface-dark-high"
                  }`}
                />
              ))}
            </View>

            <Pressable
              onPress={() => setFontSizeIndex(fontSizeIndex + 1)}
              disabled={fontSizeIndex === FONT_SIZE_STEPS.length - 1}
              className="w-10 h-10 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
              style={{ opacity: fontSizeIndex === FONT_SIZE_STEPS.length - 1 ? 0.3 : 1 }}
            >
              <Plus size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
            </Pressable>
          </View>

          {/* Preview */}
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
        </Card>

        {/* Inline Content Section */}
        <Card elevation="low" className="p-5 mb-8">
          <Text
            className="text-charcoal dark:text-neutral-200 mb-5"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
          >
            {s.sectionInlineContent}
          </Text>

          {/* Translation toggle */}
          <SettingRow
            label={s.showTranslationLabel}
            description="Sahih International English"
            isRTL={isRTL}
          >
            <Switch value={showTranslation} onValueChange={setShowTranslation} />
          </SettingRow>

          <View className="h-4" />

          {/* Translation Language */}
          <Pressable
            onPress={() => setPickerVisible(true)}
            className="flex-row items-center justify-between gap-3"
          >
            <View className="flex-1">
              <Text
                className="text-charcoal dark:text-neutral-300"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 14 }}
              >
                {s.translationLanguageLabel}
              </Text>
              <Text
                className="text-warm-400 dark:text-neutral-500 mt-0.5"
                style={{
                  fontFamily: "Manrope_400Regular",
                  fontSize: 12,
                  ...(isRTL ? { textAlign: "right" } : {}),
                }}
              >
                {currentLang?.nameEnglish ?? "English"}
              </Text>
            </View>
            {isTranslationLoading ? (
              <ActivityIndicator size="small" color="#0d9488" />
            ) : isRTL ? (
              <ChevronLeft size={18} color={isDark ? "#525252" : "#DFD9D1"} />
            ) : (
              <ChevronRight size={18} color={isDark ? "#525252" : "#DFD9D1"} />
            )}
          </Pressable>

          <View className="h-4" />

          {/* Tafseer toggle */}
          <SettingRow
            label={s.showTafseerLabel}
            description={tafseerSource === "muyassar" ? s.tafseerMuyassar : s.tafseerZilal}
            isRTL={isRTL}
            descriptionRTL
          >
            <Switch value={showTafseer} onValueChange={setShowTafseer} />
          </SettingRow>

          <View className="h-4" />

          {/* Tafsir source selector */}
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
            />
            <TafseerSourceOption
              value="zilal"
              title={s.tafseerZilal}
              description={s.tafseerZilalDesc}
              isActive={tafseerSource === "zilal"}
              onPress={() => setTafseerSource("zilal")}
              isDark={isDark}
            />
          </View>
        </Card>

        {/* Flashcard Test Modes */}
        <SectionLabel>{s.flashcardsTestModes}</SectionLabel>
        <Card elevation="low" className="p-5 mb-8">
          <View className="gap-3">
            {ALL_TEST_MODES.map((mode) => {
              const modeLabels: Record<TestMode, string> = {
                nextAyah: s.flashcardsModeNextAyah,
                previousAyah: s.flashcardsModePreviousAyah,
                translation: s.flashcardsModeTranslation,
                tafseer: s.flashcardsModeTafseer,
                surahName: s.flashcardsModeSurahName,
              };
              return (
                <View key={mode} className="flex-row items-center justify-between">
                  <Text
                    className="text-charcoal dark:text-neutral-300 flex-1"
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 14 }}
                  >
                    {modeLabels[mode]}
                  </Text>
                  <Switch
                    value={enabledModes.includes(mode)}
                    onValueChange={() => toggleTestMode(mode)}
                  />
                </View>
              );
            })}
          </View>
        </Card>

        {/* Daily Review Limit */}
        <Card elevation="low" className="p-5 mb-8">
          <Text
            className="text-charcoal dark:text-neutral-200 mb-1"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}
          >
            {s.flashcardsDailyLimit}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500 mb-4"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 12 }}
          >
            {s.flashcardsDailyLimitDesc}
          </Text>
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={() => setDailyReviewLimit(dailyReviewLimit - DAILY_REVIEW_LIMIT_STEP)}
              disabled={dailyReviewLimit <= MIN_DAILY_REVIEW_LIMIT}
              className="w-10 h-10 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
              style={{ opacity: dailyReviewLimit <= MIN_DAILY_REVIEW_LIMIT ? 0.3 : 1 }}
            >
              <Minus size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
            </Pressable>
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 22 }}
            >
              {dailyReviewLimit}
            </Text>
            <Pressable
              onPress={() => setDailyReviewLimit(dailyReviewLimit + DAILY_REVIEW_LIMIT_STEP)}
              disabled={dailyReviewLimit >= MAX_DAILY_REVIEW_LIMIT}
              className="w-10 h-10 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
              style={{ opacity: dailyReviewLimit >= MAX_DAILY_REVIEW_LIMIT ? 0.3 : 1 }}
            >
              <Plus size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
            </Pressable>
          </View>
        </Card>

        <TranslationLanguagePicker
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      className="text-warm-400 dark:text-neutral-500 mb-3"
      style={{
        fontFamily: "Manrope_600SemiBold",
        fontSize: 11,
        letterSpacing: 1.2,
        textTransform: "uppercase",
      }}
    >
      {children}
    </Text>
  );
}

function TafseerSourceOption({
  value,
  title,
  description,
  isActive,
  onPress,
  isDark,
}: {
  value: string;
  title: string;
  description: string;
  isActive: boolean;
  onPress: () => void;
  isDark: boolean;
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
          writingDirection: "rtl",
        }}
      >
        {title}
      </Text>
      <Text
        className="text-warm-400 dark:text-neutral-500 mt-0.5"
        style={{
          fontFamily: "Manrope_400Regular",
          fontSize: 12,
          writingDirection: "rtl",
        }}
      >
        {description}
      </Text>
    </Pressable>
  );
}

function SettingRow({
  label,
  description,
  isRTL,
  descriptionRTL,
  children,
}: {
  label: string;
  description: string;
  isRTL?: boolean;
  descriptionRTL?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1">
        <Text
          className="text-charcoal dark:text-neutral-300"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 14 }}
        >
          {label}
        </Text>
        <Text
          className="text-warm-400 dark:text-neutral-500 mt-0.5"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 12,
            ...(descriptionRTL ? { writingDirection: "rtl" } : {}),
            ...(isRTL ? { textAlign: "right" } : {}),
          }}
        >
          {description}
        </Text>
      </View>
      {children}
    </View>
  );
}
