import { View, Text, Pressable } from "react-native";
import { useSettings } from "../context/SettingsContext";

interface ControlBarProps {
  currentSurahName: string;
  onSurahPickerOpen: () => void;
}

export default function ControlBar({
  currentSurahName,
  onSurahPickerOpen,
}: ControlBarProps) {
  const { increaseFontSize, decreaseFontSize, hideAyahs, toggleHideAyahs, toggleDarkMode, colorScheme } =
    useSettings();

  return (
    <View className="flex-row items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
      <Pressable
        onPress={onSurahPickerOpen}
        className="flex-1 mr-2 px-3 py-2 rounded-lg active:bg-gray-200 dark:active:bg-gray-800"
      >
        <Text
          className="text-sm font-medium text-gray-900 dark:text-gray-100"
          numberOfLines={1}
        >
          {currentSurahName || "Select Surah"}
        </Text>
      </Pressable>

      <View className="flex-row items-center gap-1">
        <Pressable
          onPress={decreaseFontSize}
          className="w-9 h-9 items-center justify-center rounded-lg active:bg-gray-200 dark:active:bg-gray-800"
        >
          <Text className="text-base font-bold text-gray-600 dark:text-gray-300">
            A-
          </Text>
        </Pressable>

        <Pressable
          onPress={increaseFontSize}
          className="w-9 h-9 items-center justify-center rounded-lg active:bg-gray-200 dark:active:bg-gray-800"
        >
          <Text className="text-lg font-bold text-gray-600 dark:text-gray-300">
            A+
          </Text>
        </Pressable>

        <Pressable
          onPress={toggleHideAyahs}
          className={`w-9 h-9 items-center justify-center rounded-lg active:bg-gray-200 dark:active:bg-gray-800 ${
            hideAyahs ? "bg-amber-200 dark:bg-amber-800" : ""
          }`}
        >
          <Text className="text-base">
            {hideAyahs ? "👁" : "👁‍🗨"}
          </Text>
        </Pressable>

        <Pressable
          onPress={toggleDarkMode}
          className="w-9 h-9 items-center justify-center rounded-lg active:bg-gray-200 dark:active:bg-gray-800"
        >
          <Text className="text-base">
            {colorScheme === "dark" ? "☀️" : "🌙"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
