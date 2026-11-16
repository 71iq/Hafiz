import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AudioLines, BookOpen, BookOpenText, Play, Square } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AyahDetailModal } from "@/components/mushaf/AyahDetailModal";
import { useDatabase } from "@/lib/database/provider";
import { useOptionalAyahAudio } from "@/lib/audio/ayah-audio";
import { audioFailureMessage } from "@/lib/audio/labels";
import { useOpenMushaf } from "@/lib/navigation/open-mushaf";
import { TAFSIR_SOURCES } from "@/lib/tafsir/sources";
import { strings } from "@/lib/i18n/strings";
import {
  isQuranPageFontLoaded,
  loadQuranPageFont,
  quranPageFontName,
  quranPageMarkerFontPaletteStyle,
  quranPageFontPaletteStyle,
} from "@/lib/fonts/loader";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { DEFAULT_LANGUAGE, getLanguageByCode } from "@/lib/translations/languages";
import { localizeReflectionJourneyText } from "@/lib/reflection-journey/schema";
import type {
  ReflectionJourneyAyahRangeBlock,
  ReflectionJourneyRecitationPlaceholderBlock,
  ReflectionJourneyTafseerBlock,
  ReflectionJourneyTranslationBlock,
} from "@/lib/reflection-journey/types";
import { useSettings } from "@/lib/settings/context";
import { textStartStyle } from "@/lib/ui/direction";
import { accentIconColor, errorIconColor, mutedIconColor } from "@/lib/ui/theme-icons";

type Props = {
  block:
    | ReflectionJourneyAyahRangeBlock
    | ReflectionJourneyTranslationBlock
    | ReflectionJourneyTafseerBlock
    | ReflectionJourneyRecitationPlaceholderBlock;
};

type QuranRow = {
  surah: number;
  ayah: number;
  text_qcf2: string;
  v2_page: number;
};

type TextRow = {
  surah: number;
  ayah: number;
  text: string;
};

export function JourneyAyahCard({ block }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const {
    isDark,
    isRTL,
    uiLanguage,
    translationLanguage,
    tafseerSource,
    quranRenderFontStyle: quranFontStyle,
    quranMarkerStyle,
    effectiveTheme,
    recitationId,
    themeColors,
  } = useSettings();
  const openMushaf = useOpenMushaf();
  const audio = useOptionalAyahAudio();
  const [quranRows, setQuranRows] = useState<QuranRow[]>([]);
  const [textRows, setTextRows] = useState<TextRow[]>([]);
  const [fontsReady, setFontsReady] = useState(block.type !== "ayah_range");
  const [loading, setLoading] = useState(block.type !== "recitation_placeholder");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [detailTarget, setDetailTarget] = useState<{ surah: number; ayah: number } | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  const translationDirection =
    getLanguageByCode(translationLanguage)?.direction === "rtl" ? "rtl" : "ltr";
  const resolvedTitle =
    localizeReflectionJourneyText(block.title, uiLanguage) ||
    (block.type === "ayah_range"
      ? s.reflectionJourneyAyahBlock
      : block.type === "translation"
        ? s.reflectionJourneyTranslationBlock
        : block.type === "tafseer"
          ? s.reflectionJourneyTafseerBlock
          : s.reflectionJourneyRecitationBlock);

  const referenceLabel =
    block.ayahStart === block.ayahEnd
      ? `${block.surah}:${block.ayahStart}`
      : `${block.surah}:${block.ayahStart}-${block.ayahEnd}`;

  useEffect(() => {
    if (block.type === "recitation_placeholder") {
      setLoading(false);
      setQuranRows([]);
      setTextRows([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setQuranRows([]);
    setTextRows([]);

    async function loadBlock() {
      try {
        if (block.type === "ayah_range") {
          const rows = await db.getAllAsync<QuranRow>(
            `SELECT surah, ayah, text_qcf2, v2_page
             FROM quran_text
             WHERE surah = ? AND ayah BETWEEN ? AND ?
             ORDER BY ayah ASC`,
            [block.surah, block.ayahStart, block.ayahEnd]
          );
          if (!cancelled) {
            setQuranRows(rows);
            setTextRows([]);
          }
          return;
        }

        if (block.type === "translation") {
          const rows = translationLanguage === DEFAULT_LANGUAGE
            ? await db.getAllAsync<{ surah: number; ayah: number; text_en: string }>(
                `SELECT surah, ayah, text_en
                 FROM translations
                 WHERE surah = ? AND ayah BETWEEN ? AND ?
                 ORDER BY ayah ASC`,
                [block.surah, block.ayahStart, block.ayahEnd]
              )
            : await db.getAllAsync<{ surah: number; ayah: number; text: string }>(
                `SELECT surah, ayah, text
                 FROM translation_active
                 WHERE surah = ? AND ayah BETWEEN ? AND ?
                 ORDER BY ayah ASC`,
                [block.surah, block.ayahStart, block.ayahEnd]
              );

          if (!cancelled) {
            setTextRows(rows.map((row) => ({
              surah: row.surah,
              ayah: row.ayah,
              text: "text_en" in row ? row.text_en : row.text,
            })));
          }
          return;
        }

        const activeSource = block.type === "tafseer"
          ? (block.source === "settings" ? tafseerSource : block.source)
          : tafseerSource;
        const rows = await db.getAllAsync<TextRow>(
          `SELECT surah, ayah, text
           FROM tafseer
           WHERE surah = ? AND ayah BETWEEN ? AND ? AND source = ?
           ORDER BY ayah ASC`,
          [block.surah, block.ayahStart, block.ayahEnd, activeSource]
        );
        if (!cancelled) {
          setTextRows(rows);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadBlock().catch((error) => {
      console.warn("[JourneyAyahCard] Failed to load block:", error);
      if (!cancelled) {
        setLoading(false);
        setFailed(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [attempt, block, db, tafseerSource, translationLanguage]);

  useEffect(() => {
    if (block.type !== "ayah_range") {
      setFontsReady(true);
      return;
    }
    if (quranRows.length === 0) {
      setFontsReady(true);
      return;
    }

    let cancelled = false;
    setFontsReady(false);
    const uniquePages = Array.from(new Set(quranRows.map((row) => row.v2_page)));

    Promise.all(
      uniquePages.map(async (page) => {
        if (!isQuranPageFontLoaded(quranFontStyle, page)) {
          await loadQuranPageFont(quranFontStyle, page);
        }
      })
    )
      .then(() => {
        if (!cancelled) {
          requestAnimationFrame(() => setFontsReady(true));
        }
      })
      .catch((error) => {
        console.warn("[JourneyAyahCard] Failed to load Quran fonts:", error);
        if (!cancelled) setFontsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [block.type, quranFontStyle, quranRows]);

  const placeholderBody = useMemo(() => {
    if (block.type !== "recitation_placeholder") return "";
    return (
      localizeReflectionJourneyText(block.body, uiLanguage) ||
      s.reflectionJourneyRecitationPlaceholder
    );
  }, [block, s.reflectionJourneyRecitationPlaceholder, uiLanguage]);

  const accent = accentIconColor(effectiveTheme);
  const muted = mutedIconColor(effectiveTheme);
  const source = useMemo(() => {
    if (block.type === "translation") {
      const language = getLanguageByCode(translationLanguage);
      return language
        ? { name: language.attribution ?? language.nameNative, direction: language.direction }
        : null;
    }
    if (block.type === "tafseer") {
      const id = block.source === "settings" ? tafseerSource : block.source;
      const config = TAFSIR_SOURCES.find((item) => item.id === id);
      const name = config ? (strings.ar as Record<string, string>)[config.labelKey] : undefined;
      return name ? { name, direction: "rtl" as const } : null;
    }
    return null;
  }, [block, tafseerSource, translationLanguage]);

  const session = audio?.session ?? null;
  const playingHere =
    block.type === "recitation_placeholder" &&
    session?.kind === "range" &&
    session.target.surah === block.surah &&
    session.target.ayah >= block.ayahStart &&
    session.target.ayah <= block.ayahEnd;

  const handlePlay = async () => {
    if (!audio || block.type !== "recitation_placeholder") return;
    if (playingHere) {
      audio.stop();
      return;
    }
    setPlayError(null);
    const ayahs = [];
    for (let ayah = block.ayahStart; ayah <= block.ayahEnd; ayah += 1) ayahs.push({ surah: block.surah, ayah });
    try {
      const result = await audio.playRange({ ayahs, recitationId });
      if (!result.ok) {
        setPlayError(
          result.failure && result.failure !== "busy" ? audioFailureMessage(result.failure, s) : s.journeyPlayFailed
        );
      }
    } catch (error) {
      console.warn("[JourneyAyahCard] Failed to play range:", error);
      setPlayError(s.journeyPlayFailed);
    }
  };

  const renderRowHeader = (row: { surah: number; ayah: number }) => (
    <Text
      className="text-warm-400 dark:text-neutral-500 mb-2"
      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
    >
      {`${row.surah}:${row.ayah}`}
    </Text>
  );

  const renderRow = (
    row: { surah: number; ayah: number },
    key: string,
    content: ReactNode
  ) => (
    <View
      key={key}
      className="rounded-3xl bg-surface dark:bg-surface-dark"
      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row", alignItems: "flex-start" }}
    >
      <Pressable
        onPress={() => setDetailTarget({ surah: row.surah, ayah: row.ayah })}
        className="rounded-3xl px-4 py-4"
        style={({ pressed }) => ({ flex: 1, minWidth: 0, transform: [{ scale: pressed ? 0.99 : 1 }] })}
      >
        {renderRowHeader(row)}
        {content}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={interpolate(s.journeyOpenInMushaf, { ref: `${row.surah}:${row.ayah}` })}
        onPress={() => openMushaf({ surah: row.surah, ayah: row.ayah })}
        className="items-center justify-center rounded-full"
        style={({ pressed }) => ({ width: 44, height: 44, marginTop: 4, opacity: pressed ? 0.7 : 1 })}
      >
        <BookOpen size={16} color={accent} />
      </Pressable>
    </View>
  );

  return (
    <>
      <Card elevation="low" className="p-5 rounded-3xl">
        <View className={`mb-3 ${isRTL ? "items-end" : "items-start"}`}>
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, ...textStartStyle(isRTL)}}
          >
            {resolvedTitle}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500 mt-1"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL)}}
          >
            {referenceLabel}
          </Text>
        </View>

        {loading ? (
          <View className="py-6 items-center">
            <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
          </View>
        ) : null}

        {!loading && failed ? (
          <View
            className="rounded-3xl bg-surface dark:bg-surface-dark px-4 py-4 gap-3"
            accessibilityRole="alert"
          >
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 13,
                color: errorIconColor(effectiveTheme),
                ...textStartStyle(isRTL),
              }}
            >
              {s.journeySectionLoadFailed}
            </Text>
            <Button
              variant="outline"
              onPress={() => setAttempt((value) => value + 1)}
              className={`border border-warm-200 dark:border-neutral-700 ${isRTL ? "self-end" : "self-start"}`}
            >
              <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                {s.reflectionJourneyRetry}
              </Text>
            </Button>
          </View>
        ) : null}

        {!loading && !failed && block.type === "ayah_range" && (
          <View className="gap-3">
            {quranRows.map((row) =>
              renderRow(
                row,
                `${row.surah}:${row.ayah}`,
                !fontsReady ? (
                  <View
                    testID="journey-quran-line-placeholder"
                    accessibilityLabel={s.loading}
                    style={{ height: 54, borderRadius: 12, backgroundColor: themeColors.surfaceHigh }}
                  />
                ) : (
                  <View
                    className="items-end"
                    style={{
                      direction: "ltr",
                    }}
                  >
                    <View
                      className="self-end"
                      style={{
                        direction: "ltr",
                        flexDirection: "row-reverse",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 2,
                      }}
                    >
                      {row.text_qcf2.split(" ").filter(Boolean).map((glyph, index, tokens) => {
                        const isMarker = index === tokens.length - 1;
                        return (
                          <Text
                            key={`${row.surah}:${row.ayah}:${index}`}
                            className="text-charcoal dark:text-neutral-100"
                            style={{
                              fontFamily: quranPageFontName(quranFontStyle, row.v2_page),
                              ...(isMarker
                                ? quranPageMarkerFontPaletteStyle(quranFontStyle, row.v2_page, effectiveTheme, quranMarkerStyle)
                                : quranPageFontPaletteStyle(quranFontStyle, row.v2_page, effectiveTheme)),
                              fontSize: 28,
                              lineHeight: 54,
                              paddingHorizontal: 2,
                              writingDirection: isMarker ? "rtl" : undefined,
                            }}
                          >
                            {glyph}
                          </Text>
                        );
                      })}
                    </View>
                  </View>
                )
              )
            )}
          </View>
        )}

        {!loading && !failed && (block.type === "translation" || block.type === "tafseer") && (
          <View className="gap-3">
            {textRows.map((row) =>
              renderRow(
                row,
                `${row.surah}:${row.ayah}:${block.type}`,
                <>
                  <Text
                    className="text-charcoal dark:text-neutral-100"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 15,
                      lineHeight: 26,
                      ...textStartStyle(block.type === "tafseer" || translationDirection === "rtl"),
                      writingDirection:
                        block.type === "tafseer" ? "rtl" : translationDirection,
                    }}
                  >
                    {row.text}
                  </Text>
                  {source ? (
                    <Text
                      style={{
                        marginTop: 6,
                        fontFamily: "Manrope_500Medium",
                        fontSize: 12,
                        color: muted,
                        ...textStartStyle(source.direction === "rtl"),
                        writingDirection: source.direction,
                      }}
                    >
                      {source.name}
                    </Text>
                  ) : null}
                </>
              )
            )}
          </View>
        )}

        {!loading && block.type === "recitation_placeholder" && (
          <View className="rounded-3xl bg-surface dark:bg-surface-dark px-4 py-5">
            <View className={`mb-3 ${isRTL ? "flex-row-reverse" : "flex-row"} items-center gap-2`}>
              <View className="h-9 w-9 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 items-center justify-center">
                <AudioLines size={16} color={isDark ? "#2dd4bf" : "#0d9488"} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-warm-400 dark:text-neutral-500"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL)}}
                >
                  {referenceLabel}
                </Text>
              </View>
            </View>
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 14,
                lineHeight: 24,
                ...textStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {placeholderBody}
            </Text>
            {audio ? (
              <Button
                variant={playingHere ? "outline" : "default"}
                onPress={() => void handlePlay()}
                accessibilityLabel={`${playingHere ? s.journeyStop : s.journeyPlay} ${referenceLabel}`}
                className={`mt-4 ${playingHere ? "border border-warm-200 dark:border-neutral-700 " : ""}${isRTL ? "self-end" : "self-start"}`}
              >
                <View className={`items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
                  {playingHere ? (
                    <Square size={14} color={accent} />
                  ) : (
                    <Play size={14} color="#ffffff" />
                  )}
                  <Text
                    className={playingHere ? "text-charcoal dark:text-neutral-100" : "text-white"}
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
                  >
                    {playingHere ? s.journeyStop : s.journeyPlay}
                  </Text>
                </View>
              </Button>
            ) : null}
            {playError ? (
              <Text
                accessibilityRole="alert"
                style={{
                  marginTop: 8,
                  fontFamily: "Manrope_500Medium",
                  fontSize: 12,
                  color: errorIconColor(effectiveTheme),
                  ...textStartStyle(isRTL),
                }}
              >
                {playError}
              </Text>
            ) : null}
          </View>
        )}

        {!loading && !failed && block.type !== "recitation_placeholder" && (
          <View className={`mt-3 ${isRTL ? "flex-row-reverse" : "flex-row"} items-center gap-2`}>
            <BookOpenText size={14} color={isDark ? "#2dd4bf" : "#0d9488"} />
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
            >
              {s.reflectionJourneyBlockHint}
            </Text>
          </View>
        )}
      </Card>

      <AyahDetailModal
        target={detailTarget}
        onClose={() => setDetailTarget(null)}
        initialTab={block.type === "translation" ? "translation" : "tafsir"}
      />
    </>
  );
}
