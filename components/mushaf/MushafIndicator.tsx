import { View, Text, Pressable } from "react-native";
import { toArabicNumber } from "@/lib/arabic";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { JuzNameText } from "./JuzNameText";
import { textStartStyle } from "@/lib/ui/direction";

type Props = {
  surahName: string | null;
  juz: number | null;
  /** Opens Go to on its Surah tab. */
  onOpenSurah?: () => void;
  /** Opens Go to on its Juz tab. */
  onOpenJuz?: () => void;
};

/**
 * Slim header strip that mirrors the printed Mushaf convention: surah name on one side and juz
 * number on the other. Each side opens Go to on the matching tab.
 */
export function MushafIndicator({ surahName, juz, onOpenSurah, onOpenJuz }: Props) {
  const { isRTL } = useSettings();
  const s = useStrings();
  if (!surahName && !juz) return null;
  const juzLabel = isRTL ? toArabicNumber(juz ?? 0) : String(juz ?? "");
  const juzText = juz ? `${s.tabJuz} ${juzLabel}` : "";
  return (
    <View
      className={`${isRTL ? "flex-row-reverse" : "flex-row"} items-center justify-between px-3 bg-surface/60 dark:bg-surface-dark/60`}
      style={{ direction: "ltr" }}
    >
      <Pressable
        onPress={onOpenSurah}
        disabled={!onOpenSurah || !surahName}
        accessibilityRole="button"
        accessibilityLabel={surahName ? interpolate(s.indicatorOpenSurah, { name: surahName }) : undefined}
        className="min-h-[44px] justify-center px-2"
        style={{ flexShrink: 1 }}
      >
        <Text
          className="text-warm-500 dark:text-neutral-400"
          style={{
            fontFamily: "Manrope_500Medium",
            fontSize: 12,
            ...textStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
          numberOfLines={1}
        >
          {surahName ? `${s.tabSurah} ${surahName}` : ""}
        </Text>
      </Pressable>
      <Pressable
        onPress={onOpenJuz}
        disabled={!onOpenJuz || !juz}
        accessibilityRole="button"
        accessibilityLabel={juz ? interpolate(s.indicatorOpenJuz, { juz: juzText }) : undefined}
        className="min-h-[44px] justify-center px-2"
      >
        <JuzNameText
          juz={juz}
          enabled={isRTL}
          fallback={juzText}
          className="text-warm-500 dark:text-neutral-400"
          style={{
            fontFamily: "Manrope_500Medium",
            fontSize: 12,
          }}
          glyphStyle={{
            fontSize: 17,
            lineHeight: 20,
          }}
          numberOfLines={1}
        />
      </Pressable>
    </View>
  );
}
