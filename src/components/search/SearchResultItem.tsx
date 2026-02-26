import { memo, useCallback } from "react";
import { Text, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useSettings } from "../../context/SettingsContext";
import { setPendingScroll } from "../../lib/deeplink";

interface SearchResultItemProps {
  surah: number;
  ayah: number;
  textUthmani: string;
  surahName?: string;
  highlight?: string;
}

export default memo(function SearchResultItem({
  surah,
  ayah,
  textUthmani,
  surahName,
  highlight,
}: SearchResultItemProps) {
  const { fontSize, colorScheme } = useSettings();
  const isDark = colorScheme === "dark";
  const router = useRouter();

  const handlePress = useCallback(() => {
    setPendingScroll(surah, ayah);
    router.navigate("/(tabs)/");
  }, [surah, ayah, router]);

  return (
    <Pressable
      onPress={handlePress}
      className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 active:bg-gray-100 dark:active:bg-gray-800"
    >
      <View className="flex-row-reverse justify-between items-center mb-1">
        <Text className="text-xs text-blue-600 dark:text-blue-400 font-medium">
          {surahName ? `${surahName} ` : ""}
          {surah}:{ayah}
        </Text>
      </View>
      <Text
        style={{
          fontSize: fontSize * 0.85,
          lineHeight: fontSize * 1.7,
          writingDirection: "rtl",
          textAlign: "right",
        }}
        className="text-gray-900 dark:text-gray-100"
      >
        {textUthmani}
      </Text>
      {highlight ? (
        <Text
          style={{ writingDirection: "rtl", textAlign: "right" }}
          className="text-sm text-gray-500 dark:text-gray-400 mt-1"
        >
          {highlight}
        </Text>
      ) : null}
    </Pressable>
  );
});
