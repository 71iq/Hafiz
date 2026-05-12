import { View, Text } from "react-native";
import { toArabicNumber } from "@/lib/arabic";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";

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
  const { isRTL } = useSettings();
  const s = useStrings();
  if (!surahName && !juz) return null;
  const juzLabel = isRTL ? toArabicNumber(juz ?? 0) : String(juz ?? "");
  return (
    <View
      pointerEvents="none"
      className="flex-row items-center justify-between px-5 py-1.5 bg-surface/60 dark:bg-surface-dark/60"
      style={{ direction: isRTL ? "rtl" : "ltr" }}
    >
      <Text
        className="text-warm-500 dark:text-neutral-400"
        style={{
          fontFamily: "Manrope_500Medium",
          fontSize: 12,
        }}
        numberOfLines={1}
      >
        {surahName ? `${s.tabSurah} ${surahName}` : ""}
      </Text>
      <Text
        className="text-warm-500 dark:text-neutral-400"
        style={{
          fontFamily: "Manrope_500Medium",
          fontSize: 12,
        }}
        numberOfLines={1}
      >
        {juz ? `${s.tabJuz} ${juzLabel}` : ""}
      </Text>
    </View>
  );
}
