import { useState } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { Switch } from "@/components/ui/Switch";
import { SafeAreaView } from "react-native-safe-area-context";
import { Sun, Moon, Smartphone, Minus, Plus, ChevronRight, ChevronLeft } from "lucide-react-native";
import { useSettings, FONT_SIZE_STEPS, type ThemeMode, type UILanguage } from "@/lib/settings/context";
import { getLanguageByCode } from "@/lib/translations/languages";
import { TranslationLanguagePicker } from "@/components/settings/TranslationLanguagePicker";
import { useStrings } from "@/lib/i18n/useStrings";

export default function SettingsScreen() {
  const {
    theme, setTheme, fontSizeIndex, setFontSizeIndex, fontSize,
    showTranslation, setShowTranslation, showTafseer, setShowTafseer,
    translationLanguage, isTranslationLoading, isDark, isRTL,
    uiLanguage, setUiLanguage,
  } = useSettings();
  const s = useStrings();
  const [pickerVisible, setPickerVisible] = useState(false);
  const currentLang = getLanguageByCode(translationLanguage);

  const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: s.themeLight, icon: Sun },
    { value: "dark", label: s.themeDark, icon: Moon },
    { value: "system", label: s.themeAuto, icon: Smartphone },
  ];

  const UI_LANGUAGE_OPTIONS: { value: UILanguage; label: string }[] = [
    { value: "en", label: "English" },
    { value: "ar", label: "العربية" },
  ];

  return (
    <SafeAreaView className="flex-1 bg-warm-50 dark:bg-neutral-950">
      <View className="px-5 pt-4 pb-2">
        <Text className="text-2xl font-bold text-warm-800 dark:text-neutral-100">
          {s.settingsTitle}
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Language Section */}
        <Text className="text-sm font-semibold text-warm-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
          {s.sectionLanguage}
        </Text>
        <View className="bg-white dark:bg-neutral-900 rounded-2xl p-4 mb-6">
          <Text className="text-base font-medium text-warm-800 dark:text-neutral-200 mb-3">
            {s.appLanguageLabel}
          </Text>
          <View className="flex-row gap-3">
            {UI_LANGUAGE_OPTIONS.map((option) => {
              const isActive = uiLanguage === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setUiLanguage(option.value)}
                  className={`flex-1 items-center py-3 rounded-xl border-2 ${
                    isActive
                      ? "border-teal-500 bg-teal-50 dark:bg-teal-900/30"
                      : "border-warm-200 dark:border-neutral-700 bg-warm-50 dark:bg-neutral-800"
                  }`}
                >
                  <Text
                    className={`text-sm font-medium ${
                      isActive
                        ? "text-teal-700 dark:text-teal-300"
                        : "text-warm-500 dark:text-neutral-400"
                    }`}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Theme Section */}
        <Text className="text-sm font-semibold text-warm-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
          {s.sectionAppearance}
        </Text>
        <View className="bg-white dark:bg-neutral-900 rounded-2xl p-4 mb-6">
          <Text className="text-base font-medium text-warm-800 dark:text-neutral-200 mb-3">
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
                  className={`flex-1 items-center py-3 rounded-xl border-2 ${
                    isActive
                      ? "border-teal-500 bg-teal-50 dark:bg-teal-900/30"
                      : "border-warm-200 dark:border-neutral-700 bg-warm-50 dark:bg-neutral-800"
                  }`}
                >
                  <IconComponent
                    size={20}
                    className={isActive ? "text-teal-600 dark:text-teal-400" : "text-warm-400 dark:text-neutral-500"}
                  />
                  <Text
                    className={`text-sm mt-1 font-medium ${
                      isActive
                        ? "text-teal-700 dark:text-teal-300"
                        : "text-warm-500 dark:text-neutral-400"
                    }`}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Font Size Section */}
        <Text className="text-sm font-semibold text-warm-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
          {s.sectionReading}
        </Text>
        <View className="bg-white dark:bg-neutral-900 rounded-2xl p-4 mb-6">
          <Text className="text-base font-medium text-warm-800 dark:text-neutral-200 mb-3">
            {s.fontSizeLabel}
          </Text>

          {/* Size control */}
          <View className="flex-row items-center justify-between mb-4">
            <Pressable
              onPress={() => setFontSizeIndex(fontSizeIndex - 1)}
              disabled={fontSizeIndex === 0}
              className="w-10 h-10 rounded-full bg-warm-100 dark:bg-neutral-800 items-center justify-center"
              style={{ opacity: fontSizeIndex === 0 ? 0.3 : 1 }}
            >
              <Minus size={18} className="text-warm-700 dark:text-neutral-300" />
            </Pressable>

            {/* Step indicators */}
            <View className="flex-row items-center gap-2">
              {FONT_SIZE_STEPS.map((_, i) => (
                <View
                  key={i}
                  className={`rounded-full ${
                    i === fontSizeIndex
                      ? "w-3 h-3 bg-teal-500"
                      : i < fontSizeIndex
                        ? "w-2.5 h-2.5 bg-teal-300 dark:bg-teal-700"
                        : "w-2.5 h-2.5 bg-warm-200 dark:bg-neutral-700"
                  }`}
                />
              ))}
            </View>

            <Pressable
              onPress={() => setFontSizeIndex(fontSizeIndex + 1)}
              disabled={fontSizeIndex === FONT_SIZE_STEPS.length - 1}
              className="w-10 h-10 rounded-full bg-warm-100 dark:bg-neutral-800 items-center justify-center"
              style={{ opacity: fontSizeIndex === FONT_SIZE_STEPS.length - 1 ? 0.3 : 1 }}
            >
              <Plus size={18} className="text-warm-700 dark:text-neutral-300" />
            </Pressable>
          </View>

          {/* Preview */}
          <View className="bg-warm-50 dark:bg-neutral-800 rounded-xl p-4">
            <Text
              className="text-warm-900 dark:text-neutral-100 text-center"
              style={{
                fontSize,
                lineHeight: fontSize * 2.1,
                writingDirection: "rtl",
              }}
            >
              بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ
            </Text>
          </View>
        </View>

        {/* Inline Content Section */}
        <View className="bg-white dark:bg-neutral-900 rounded-2xl p-4 mb-6">
          <Text className="text-base font-medium text-warm-800 dark:text-neutral-200 mb-3">
            {s.sectionInlineContent}
          </Text>

          <View className="flex-row items-center justify-between gap-3 py-2">
            <View className="flex-1">
              <Text className="text-sm font-medium text-warm-700 dark:text-neutral-300">
                {s.showTranslationLabel}
              </Text>
              <Text
                className="text-xs text-warm-400 dark:text-neutral-500 mt-0.5"
                style={isRTL ? { textAlign: "right" } : undefined}
              >
                Sahih International English
              </Text>
            </View>
            <Switch value={showTranslation} onValueChange={setShowTranslation} />
          </View>

          <View className="border-t border-warm-100 dark:border-neutral-800 my-1" />

          {/* Translation Language */}
          <Pressable
            onPress={() => setPickerVisible(true)}
            className="flex-row items-center justify-between gap-3 py-2"
          >
            <View className="flex-1">
              <Text className="text-sm font-medium text-warm-700 dark:text-neutral-300">
                {s.translationLanguageLabel}
              </Text>
              <Text
                className="text-xs text-warm-400 dark:text-neutral-500 mt-0.5"
                style={isRTL ? { textAlign: "right" } : undefined}
              >
                {currentLang?.nameEnglish ?? "English"}
              </Text>
            </View>
            {isTranslationLoading ? (
              <ActivityIndicator size="small" color="#0d9488" />
            ) : isRTL ? (
              <ChevronLeft size={18} color={isDark ? "#737373" : "#a8a29e"} />
            ) : (
              <ChevronRight size={18} color={isDark ? "#737373" : "#a8a29e"} />
            )}
          </Pressable>

          <View className="border-t border-warm-100 dark:border-neutral-800 my-1" />

          <View className="flex-row items-center justify-between gap-3 py-2">
            <View className="flex-1">
              <Text className="text-sm font-medium text-warm-700 dark:text-neutral-300">
                {s.showTafseerLabel}
              </Text>
              <Text
                className="text-xs text-warm-400 dark:text-neutral-500 mt-0.5"
                style={isRTL ? undefined : { textAlign: "left" }}
              >
                التفسير الميسر
              </Text>
            </View>
            <Switch value={showTafseer} onValueChange={setShowTafseer} />
          </View>
        </View>

        <TranslationLanguagePicker
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
