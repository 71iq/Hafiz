import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Sun, Moon, Smartphone, Minus, Plus } from "lucide-react-native";
import { useSettings, FONT_SIZE_STEPS, type ThemeMode, type QuranFont } from "@/lib/settings/context";

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto", icon: Smartphone },
];

const FONT_OPTIONS: { value: QuranFont; label: string; sublabel: string }[] = [
  { value: "uthmanic", label: "UthmanicHafs", sublabel: "Standard Uthmani" },
  { value: "qpc_v2", label: "Madani", sublabel: "King Fahd Complex" },
];

export default function SettingsScreen() {
  const { theme, setTheme, fontSizeIndex, setFontSizeIndex, fontSize, quranFont, setQuranFont } = useSettings();

  return (
    <SafeAreaView className="flex-1 bg-warm-50 dark:bg-neutral-950">
      <View className="px-5 pt-4 pb-2">
        <Text className="text-2xl font-bold text-warm-800 dark:text-neutral-100">
          Settings
        </Text>
      </View>

      <View className="flex-1 px-5 pt-4">
        {/* Theme Section */}
        <Text className="text-sm font-semibold text-warm-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
          Appearance
        </Text>
        <View className="bg-white dark:bg-neutral-900 rounded-2xl p-4 mb-6">
          <Text className="text-base font-medium text-warm-800 dark:text-neutral-200 mb-3">
            Theme
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
          Reading
        </Text>
        <View className="bg-white dark:bg-neutral-900 rounded-2xl p-4 mb-6">
          <Text className="text-base font-medium text-warm-800 dark:text-neutral-200 mb-3">
            Arabic Font Size
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
                fontFamily: "UthmanicHafs",
                fontSize,
                lineHeight: fontSize * 2.1,
                writingDirection: "rtl",
              }}
            >
              بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ
            </Text>
          </View>
        </View>

        {/* Quran Font Section */}
        <View className="bg-white dark:bg-neutral-900 rounded-2xl p-4 mb-6">
          <Text className="text-base font-medium text-warm-800 dark:text-neutral-200 mb-3">
            Quran Font
          </Text>
          <View className="gap-2">
            {FONT_OPTIONS.map((option) => {
              const isActive = quranFont === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setQuranFont(option.value)}
                  className={`flex-row items-center justify-between py-3 px-4 rounded-xl border-2 ${
                    isActive
                      ? "border-teal-500 bg-teal-50 dark:bg-teal-900/30"
                      : "border-warm-200 dark:border-neutral-700 bg-warm-50 dark:bg-neutral-800"
                  }`}
                >
                  <View>
                    <Text
                      className={`text-sm font-semibold ${
                        isActive
                          ? "text-teal-700 dark:text-teal-300"
                          : "text-warm-700 dark:text-neutral-300"
                      }`}
                    >
                      {option.label}
                    </Text>
                    <Text
                      className={`text-xs mt-0.5 ${
                        isActive
                          ? "text-teal-600 dark:text-teal-400"
                          : "text-warm-400 dark:text-neutral-500"
                      }`}
                    >
                      {option.sublabel}
                    </Text>
                  </View>
                  <View
                    className={`w-5 h-5 rounded-full border-2 items-center justify-center ${
                      isActive
                        ? "border-teal-500 bg-teal-500"
                        : "border-warm-300 dark:border-neutral-600"
                    }`}
                  >
                    {isActive && <View className="w-2 h-2 rounded-full bg-white" />}
                  </View>
                </Pressable>
              );
            })}
          </View>
          {quranFont === "qpc_v2" && (
            <Text className="text-xs text-warm-400 dark:text-neutral-500 mt-2">
              Page-specific font — available in page view only
            </Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
