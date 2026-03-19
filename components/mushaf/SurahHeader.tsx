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
        <View className="rounded-xl bg-teal-700 dark:bg-teal-900 px-4 py-2 items-center flex-row justify-center gap-3">
          <Text
            className="text-white text-center"
            style={{
              fontSize: 20,
              lineHeight: 32,
            }}
          >
            {nameArabic}
          </Text>
          <Text className="text-teal-200 text-xs">
            {surahNumber}. {nameEnglish} · {ayahCount} {s.ayahs}
          </Text>
        </View>

        {showBismillah && (
          <View className="items-center mt-2 mb-1">
            <Text
              className="text-warm-800 dark:text-neutral-200 text-center"
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
    <View className="mx-4 mt-8 mb-4">
      {/* Decorative surah card */}
      <View className="rounded-2xl bg-teal-700 dark:bg-teal-900 px-6 py-5 items-center overflow-hidden">
        {/* Decorative corner accents */}
        <View className="absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-teal-400/30 rounded-tl-2xl" />
        <View className="absolute top-0 right-0 w-16 h-16 border-t-2 border-r-2 border-teal-400/30 rounded-tr-2xl" />
        <View className="absolute bottom-0 left-0 w-16 h-16 border-b-2 border-l-2 border-teal-400/30 rounded-bl-2xl" />
        <View className="absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 border-teal-400/30 rounded-br-2xl" />

        {/* Arabic surah name */}
        <Text
          className="text-white text-center mb-1"
          style={{
            fontSize: 32,
            lineHeight: 56,
          }}
        >
          {nameArabic}
        </Text>

        {/* English name */}
        <Text className="text-teal-100 text-base font-medium text-center mb-3">
          {surahNumber}. {nameEnglish}
        </Text>

        {/* Meta info */}
        <View className="flex-row items-center gap-3">
          <View className="bg-teal-600/50 dark:bg-teal-800/50 rounded-full px-3 py-1">
            <Text className="text-teal-100 text-xs">
              {revelationType === "Makkiyah" ? s.meccan : s.medinan}
            </Text>
          </View>
          <View className="w-1 h-1 rounded-full bg-teal-300/50" />
          <Text className="text-teal-200 text-xs">
            {ayahCount} {s.ayahs}
          </Text>
        </View>
      </View>

      {/* Bismillah (QCF2) */}
      {showBismillah && (
        <View className="items-center mt-5 mb-2">
          <Text
            className="text-warm-800 dark:text-neutral-200 text-center"
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
