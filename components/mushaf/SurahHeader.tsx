import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import {
  loadQpcFont,
  qpcFontName,
  isQpcFontLoaded,
} from "@/lib/fonts/loader";
import { useStrings } from "@/lib/i18n/useStrings";

type Props = {
  surahNumber: number;
  nameArabic: string;
  nameEnglish: string;
  ayahCount: number;
  revelationType: string;
  hideBismillah?: boolean;
  compact?: boolean;
};

/** QCF2 Bismillah from page 1 font (PUA codepoints) */
const BISMILLAH_QCF2 = "\uFC41 \uFC42 \uFC43 \uFC44";

export function SurahHeader({
  surahNumber,
  nameArabic,
  nameEnglish,
  ayahCount,
  revelationType,
  hideBismillah,
  compact,
}: Props) {
  const s = useStrings();
  const showBismillah =
    !hideBismillah && surahNumber !== 9 && surahNumber !== 1;

  const [bismFontReady, setBismFontReady] = useState(() =>
    isQpcFontLoaded(1)
  );

  useEffect(() => {
    if (!showBismillah) return;
    if (isQpcFontLoaded(1)) {
      setBismFontReady(true);
      return;
    }
    let cancelled = false;
    loadQpcFont(1).then(() => {
      if (!cancelled) {
        requestAnimationFrame(() => setBismFontReady(true));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [showBismillah]);

  if (compact) {
    return (
      <View style={{ height: showBismillah ? 100 : 68 }} className="justify-center">
        <View className="flex-row items-center justify-center px-2">
          <OrnamentLine />
          <View className="mx-3 min-w-[190px] max-w-[300px] rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-2">
            <Text
              className="text-primary dark:text-primary-bright text-center"
              style={{ fontSize: 22, lineHeight: 28 }}
            >
              {nameArabic}
            </Text>
            <Text
              className="text-warm-500 dark:text-neutral-400 text-center"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, lineHeight: 14 }}
            >
              {surahNumber}. {nameEnglish} · {ayahCount} {s.ayahs}
            </Text>
          </View>
          <OrnamentLine />
        </View>

        {showBismillah && (
          <View className="items-center mt-2 mb-1">
            <Text
              className="text-charcoal dark:text-neutral-200 text-center"
              style={{
                fontSize: 18,
                lineHeight: 32,
                fontFamily: qpcFontName(1),
                opacity: bismFontReady ? 1 : 0,
              }}
            >
              {BISMILLAH_QCF2}
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View className="mx-5 mt-10 mb-5 w-full max-w-[840px] self-center">
      <View
        className="rounded-3xl bg-surface-low dark:bg-surface-dark-low px-7 py-6 items-center overflow-hidden"
      >
        <View className="mb-4 w-full flex-row items-center justify-center">
          <OrnamentLine />
          <View className="mx-4 h-2 w-2 rounded-sm bg-gold" style={{ transform: [{ rotate: "45deg" }] }} />
          <OrnamentLine />
        </View>

        <Text
          className="text-primary dark:text-primary-bright text-center mb-1.5"
          style={{
            fontSize: 34,
            lineHeight: 58,
          }}
        >
          {nameArabic}
        </Text>

        <Text
          className="text-warm-500 dark:text-neutral-400 text-center mb-4"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 15 }}
        >
          {surahNumber}. {nameEnglish}
        </Text>

        <View className="flex-row items-center gap-3">
          <View className="bg-primary-accent/10 dark:bg-primary-bright/10 rounded-full px-3.5 py-1.5">
            <Text
              className="text-primary-accent dark:text-primary-bright"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
            >
              {revelationType === "Makkiyah" ? s.meccan : s.medinan}
            </Text>
          </View>
          <View className="w-1 h-1 rounded-full bg-gold" />
          <Text
            className="text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
          >
            {ayahCount} {s.ayahs}
          </Text>
        </View>
      </View>

      {/* Bismillah (QCF2) */}
      {showBismillah && (
        <View className="items-center mt-6 mb-2">
          <Text
            className="text-charcoal dark:text-neutral-200 text-center"
            style={{
              fontSize: 24,
              lineHeight: 48,
              fontFamily: qpcFontName(1),
              opacity: bismFontReady ? 1 : 0,
            }}
          >
            {BISMILLAH_QCF2}
          </Text>
        </View>
      )}
    </View>
  );
}

function OrnamentLine() {
  return (
    <View className="flex-1 flex-row items-center justify-center">
      <View className="h-px flex-1 bg-warm-200 dark:bg-neutral-800" />
      <View className="mx-2 h-1.5 w-1.5 rounded-sm bg-gold" style={{ transform: [{ rotate: "45deg" }] }} />
      <View className="h-px flex-1 bg-warm-200 dark:bg-neutral-800" />
    </View>
  );
}
