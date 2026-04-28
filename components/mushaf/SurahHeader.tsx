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
        {/* Compact: tonal teal pill — no border */}
        <View className="rounded-full bg-primary dark:bg-teal-950 px-5 py-2.5 items-center flex-row justify-center gap-3">
          <Text
            className="text-white text-center"
            style={{ fontSize: 20, lineHeight: 32 }}
          >
            {nameArabic}
          </Text>
          <Text
            className="text-teal-200/80"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}
          >
            {surahNumber}. {nameEnglish} · {ayahCount} {s.ayahs}
          </Text>
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
      {/* Decorative surah card — tonal gradient, no borders */}
      <View
        className="rounded-4xl px-7 py-6 items-center overflow-hidden"
        style={{
          backgroundColor: "#003638",
          // Subtle gradient via layered views not supported in RN,
          // so use solid primary with soft inner glow
        }}
      >
        {/* Arabic surah name — Noto Serif for editorial feel */}
        <Text
          className="text-white text-center mb-1.5"
          style={{
            fontSize: 34,
            lineHeight: 58,
          }}
        >
          {nameArabic}
        </Text>

        {/* English name — Manrope */}
        <Text
          className="text-teal-200/90 text-center mb-4"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 15 }}
        >
          {surahNumber}. {nameEnglish}
        </Text>

        {/* Meta info — no border badges, just text with spacing */}
        <View className="flex-row items-center gap-3">
          <View className="bg-white/10 rounded-full px-3.5 py-1.5">
            <Text
              className="text-teal-100"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
            >
              {revelationType === "Makkiyah" ? s.meccan : s.medinan}
            </Text>
          </View>
          <View className="w-1 h-1 rounded-full bg-teal-300/30" />
          <Text
            className="text-teal-200/70"
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
