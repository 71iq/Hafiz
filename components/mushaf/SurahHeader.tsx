import { useEffect, useState } from "react";
import { Platform, Pressable, View, Text } from "react-native";
import { Info } from "lucide-react-native";
import {
  loadSurahNameFont,
  isSurahNameFontLoaded,
  surahNameBismillahGlyphs,
  surahNameFontName,
  surahNameGlyph,
} from "@/lib/fonts/loader";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { toArabicNumber } from "@/lib/arabic";
import { SurahInfoModal, type SurahInfoTarget } from "./SurahInfoModal";

type Props = {
  surahNumber: number;
  nameArabic: string;
  nameEnglish: string;
  ayahCount: number;
  revelationType: string;
  hideBismillah?: boolean;
  compact?: boolean;
};

const BISMILLAH_UTHMANI = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";
const COMPACT_DECORATIVE_SURAH_NAME_SIZE = 32;
const COMPACT_DECORATIVE_SURAH_NAME_LINE_HEIGHT = 42;

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
  const { uiLanguage, isDark } = useSettings();
  const showBismillah =
    !hideBismillah && surahNumber !== 9 && surahNumber !== 1;
  const isArabicMode = uiLanguage === "ar";
  const localizedSurahNumber = isArabicMode ? toArabicNumber(surahNumber) : String(surahNumber);
  const localizedAyahCount = isArabicMode ? toArabicNumber(ayahCount) : String(ayahCount);
  const displayName = isArabicMode ? nameArabic : nameEnglish;
  const nameDirection = isArabicMode ? "rtl" : "ltr";
  const decorativeNameGlyph = isArabicMode ? surahNameGlyph(surahNumber) : undefined;
  const [infoOpen, setInfoOpen] = useState(false);
  const infoTarget: SurahInfoTarget = {
    surahNumber,
    nameArabic,
    nameEnglish,
  };

  const [surahNameFontReady, setSurahNameFontReady] = useState(() =>
    isSurahNameFontLoaded()
  );
  const needsSurahNameFont = Boolean(decorativeNameGlyph || showBismillah);
  const useDecorativeSurahName = Boolean(decorativeNameGlyph && surahNameFontReady);
  const renderedSurahName = useDecorativeSurahName ? decorativeNameGlyph! : displayName;
  const renderedSurahNameDirection = useDecorativeSurahName ? "ltr" : nameDirection;
  const bismillahSelectionProps =
    Platform.OS === "web" && showBismillah
      ? ({
          selectable: true,
          dataSet: {
            hafizQuranToken: "word",
            hafizSurah: String(surahNumber),
            hafizAyah: "1",
            hafizWordPos: "-1",
            hafizLiteralText: BISMILLAH_UTHMANI,
            hafizQuranHidden: "false",
          },
        } as any)
      : {};

  useEffect(() => {
    if (!needsSurahNameFont) return;
    if (isSurahNameFontLoaded()) {
      setSurahNameFontReady(true);
      return;
    }
    setSurahNameFontReady(false);
    let cancelled = false;
    loadSurahNameFont()
      .then(() => {
        if (!cancelled) requestAnimationFrame(() => setSurahNameFontReady(true));
      })
      .catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [needsSurahNameFont]);

  if (compact) {
    return (
      <>
        <View style={{ height: showBismillah ? 100 : 68 }} className="justify-center">
          <View className="flex-row items-center justify-center px-2">
            <OrnamentLine />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.surahInfoOpen}
              onPress={() => setInfoOpen(true)}
              className="mx-3 min-w-[190px] max-w-[340px] rounded-2xl bg-surface-low dark:bg-surface-dark-low px-5 py-1"
              style={({ pressed }) => ({
                cursor: Platform.OS === "web" ? "pointer" : undefined,
                flexShrink: 1,
                opacity: pressed ? 0.82 : 1,
              })}
            >
              <View
                className="items-center justify-center gap-2"
                style={{ flexDirection: isArabicMode ? "row-reverse" : "row" }}
              >
                <Text
                  className="text-primary dark:text-primary-bright text-center"
                  style={{
                    flexShrink: 1,
                    fontFamily: useDecorativeSurahName ? surahNameFontName() : undefined,
                    fontSize: useDecorativeSurahName ? COMPACT_DECORATIVE_SURAH_NAME_SIZE : 22,
                    lineHeight: useDecorativeSurahName ? COMPACT_DECORATIVE_SURAH_NAME_LINE_HEIGHT : 36,
                    writingDirection: renderedSurahNameDirection,
                  }}
                  numberOfLines={1}
                >
                  {renderedSurahName}
                </Text>
                <View className="h-6 w-6 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
                  <Info size={12} color={isDark ? "#2dd4bf" : "#0d9488"} />
                </View>
              </View>
              <Text
                className="text-warm-500 dark:text-neutral-400 text-center"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, lineHeight: 14 }}
              >
                {localizedSurahNumber} · {localizedAyahCount} {s.ayahs}
              </Text>
            </Pressable>
            <OrnamentLine />
          </View>

          {showBismillah && (
            <View className="items-center mt-2 mb-1">
              <Text
                {...bismillahSelectionProps}
                className="text-charcoal dark:text-neutral-200 text-center"
                style={{
                  fontSize: 18,
                  lineHeight: 32,
                  fontFamily: surahNameFontName(),
                  opacity: surahNameFontReady ? 1 : 0,
                  writingDirection: "rtl",
                  ...(Platform.OS === "web" ? ({ userSelect: "text" } as any) : null),
                }}
              >
                {surahNameBismillahGlyphs()}
              </Text>
            </View>
          )}
        </View>
        <SurahInfoModal target={infoOpen ? infoTarget : null} onClose={() => setInfoOpen(false)} />
      </>
    );
  }

  return (
    <>
    <View className="mt-10 mb-5 self-center" style={{ width: "100%", maxWidth: 840, paddingHorizontal: 20 }}>
      <View
        className="rounded-3xl bg-surface-low dark:bg-surface-dark-low px-7 py-6 items-center"
        style={{ position: "relative" }}
      >
        <SurahInfoButton
          isDark={isDark}
          isRTL={isArabicMode}
          label={s.surahInfoOpen}
          onPress={() => setInfoOpen(true)}
        />
        <View className="mb-4 w-full flex-row items-center justify-center">
          <OrnamentLine />
          <View className="mx-4 h-2 w-2 rounded-sm bg-gold" style={{ transform: [{ rotate: "45deg" }] }} />
          <OrnamentLine />
        </View>

        <Text
          className="text-primary dark:text-primary-bright text-center mb-1.5"
          style={{
            fontFamily: useDecorativeSurahName ? surahNameFontName() : undefined,
            fontSize: useDecorativeSurahName ? 64 : 34,
            lineHeight: useDecorativeSurahName ? 78 : 64,
            writingDirection: renderedSurahNameDirection,
            paddingHorizontal: 14,
          }}
        >
          {renderedSurahName}
        </Text>

        <Text
          className="text-warm-500 dark:text-neutral-400 text-center mb-4"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 15 }}
        >
          {localizedSurahNumber}. {displayName}
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
            {localizedAyahCount} {s.ayahs}
          </Text>
        </View>
      </View>

      {showBismillah && (
        <View className="items-center mt-6 mb-2">
          <Text
            {...bismillahSelectionProps}
            className="text-charcoal dark:text-neutral-200 text-center"
            style={{
              fontSize: 24,
              lineHeight: 48,
              fontFamily: surahNameFontName(),
              opacity: surahNameFontReady ? 1 : 0,
              writingDirection: "rtl",
              ...(Platform.OS === "web" ? ({ userSelect: "text" } as any) : null),
            }}
          >
            {surahNameBismillahGlyphs()}
          </Text>
        </View>
      )}
    </View>
    <SurahInfoModal target={infoOpen ? infoTarget : null} onClose={() => setInfoOpen(false)} />
    </>
  );
}

function SurahInfoButton({
  compact,
  isDark,
  isRTL,
  label,
  onPress,
}: {
  compact?: boolean;
  isDark: boolean;
  isRTL: boolean;
  label: string;
  onPress: () => void;
}) {
  const sizeClass = compact ? "h-7 w-7" : "h-9 w-9";
  const iconSize = compact ? 13 : 16;
  const offset = compact ? 7 : 16;
  const compactSideOffset = 10;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      className={`${sizeClass} items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10`}
      style={({ pressed }) => [
        {
          position: "absolute",
          top: compact ? "50%" : offset,
          marginTop: compact ? -14 : undefined,
          opacity: pressed ? 0.72 : 1,
          zIndex: 2,
          cursor: Platform.OS === "web" ? "pointer" : undefined,
        },
        compact
          ? isRTL ? { right: compactSideOffset } : { left: compactSideOffset }
          : isRTL ? { left: offset } : { right: offset },
      ]}
    >
      <Info size={iconSize} color={isDark ? "#2dd4bf" : "#0d9488"} />
    </Pressable>
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
