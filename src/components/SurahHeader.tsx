import { memo } from "react";
import { View, Text } from "react-native";
import type { Surah } from "../db/database";

const BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ";

interface SurahHeaderProps {
  surah: Surah;
}

export default memo(function SurahHeader({ surah }: SurahHeaderProps) {
  const showBismillah = surah.number !== 1 && surah.number !== 9;

  return (
    <View className="py-6 px-5">
      <View className="items-center border-y border-amber-300 dark:border-amber-700 py-4 bg-amber-50 dark:bg-amber-950/50 rounded-lg">
        <Text className="text-2xl text-gray-900 dark:text-gray-100">
          {surah.name_arabic}
        </Text>
        <Text className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {surah.name_english} — {surah.ayah_count} Ayahs
        </Text>
        {showBismillah && (
          <Text
            className="text-xl text-gray-700 dark:text-gray-300 mt-3"
            style={{ writingDirection: "rtl" }}
          >
            {BISMILLAH}
          </Text>
        )}
      </View>
    </View>
  );
});
