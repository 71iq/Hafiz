import { memo } from "react";
import { View } from "react-native";
import type { Surah } from "../db/database";
import { Text } from "./ui/text";

const BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ";

interface SurahHeaderProps {
  surah: Surah;
}

export default memo(function SurahHeader({ surah }: SurahHeaderProps) {
  const showBismillah = surah.number !== 1 && surah.number !== 9;

  return (
    <View className="py-6 px-5">
      <View className="items-center border-y border-amber-300 dark:border-amber-700 py-4 bg-amber-50 dark:bg-amber-950/50 rounded-lg">
        <Text className="text-2xl text-foreground">{surah.name_arabic}</Text>
        <Text variant="muted" className="text-sm mt-1">
          {surah.name_english} — {surah.ayah_count} Ayahs
        </Text>
        {showBismillah && (
          <Text
            className="text-xl text-foreground mt-3"
            style={{ writingDirection: "rtl" }}
          >
            {BISMILLAH}
          </Text>
        )}
      </View>
    </View>
  );
});
