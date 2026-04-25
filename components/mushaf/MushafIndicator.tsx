import { View, Text } from "react-native";
import { toArabicNumber } from "@/lib/arabic";

type Props = {
  surahName: string | null;
  juz: number | null;
};

/**
 * Slim, semi-transparent header indicator that mirrors the printed Mushaf
 * convention: surah name on one side and juz number on the other. Updates
 * dynamically as the user scrolls through ayahs/pages.
 */
export function MushafIndicator({ surahName, juz }: Props) {
  if (!surahName && !juz) return null;
  return (
    <View
      pointerEvents="none"
      className="flex-row items-center justify-between px-5 py-1.5 bg-surface/60 dark:bg-surface-dark/60"
      style={{ direction: "rtl" }}
    >
      <Text
        className="text-warm-500 dark:text-neutral-400"
        style={{
          fontFamily: "Manrope_500Medium",
          fontSize: 12,
        }}
        numberOfLines={1}
      >
        {surahName ? `سورة ${surahName}` : ""}
      </Text>
      <Text
        className="text-warm-500 dark:text-neutral-400"
        style={{
          fontFamily: "Manrope_500Medium",
          fontSize: 12,
        }}
        numberOfLines={1}
      >
        {juz ? `الجزء ${toArabicNumber(juz)}` : ""}
      </Text>
    </View>
  );
}
