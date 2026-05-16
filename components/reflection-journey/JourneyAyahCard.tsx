import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AudioLines, BookOpenText } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { AyahDetailModal } from "@/components/mushaf/AyahDetailModal";
import { useDatabase } from "@/lib/database/provider";
import { isQpcFontLoaded, loadQpcFont, qpcFontName } from "@/lib/fonts/loader";
import { useStrings } from "@/lib/i18n/useStrings";
import { DEFAULT_LANGUAGE, getLanguageByCode } from "@/lib/translations/languages";
import { localizeReflectionJourneyText } from "@/lib/reflection-journey/schema";
import type {
  ReflectionJourneyAyahRangeBlock,
  ReflectionJourneyRecitationPlaceholderBlock,
  ReflectionJourneyTafseerBlock,
  ReflectionJourneyTranslationBlock,
} from "@/lib/reflection-journey/types";
import { useSettings } from "@/lib/settings/context";

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
  const { isDark, isRTL, uiLanguage, translationLanguage, tafseerSource } = useSettings();
  const [quranRows, setQuranRows] = useState<QuranRow[]>([]);
  const [textRows, setTextRows] = useState<TextRow[]>([]);
  const [fontsReady, setFontsReady] = useState(block.type !== "ayah_range");
  const [loading, setLoading] = useState(block.type !== "recitation_placeholder");
  const [detailTarget, setDetailTarget] = useState<{ surah: number; ayah: number } | null>(null);

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
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [block, db, tafseerSource, translationLanguage]);

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
        if (!isQpcFontLoaded(page)) {
          await loadQpcFont(page);
        }
      })
    )
      .then(() => {
        if (!cancelled) {
          requestAnimationFrame(() => setFontsReady(true));
        }
      })
      .catch((error) => {
        console.warn("[JourneyAyahCard] Failed to load QCF2 fonts:", error);
        if (!cancelled) setFontsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [block.type, quranRows]);

  const placeholderBody = useMemo(() => {
    if (block.type !== "recitation_placeholder") return "";
    return (
      localizeReflectionJourneyText(block.body, uiLanguage) ||
      s.reflectionJourneyRecitationPlaceholder
    );
  }, [block, s.reflectionJourneyRecitationPlaceholder, uiLanguage]);

  return (
    <>
      <Card elevation="low" className="p-5 rounded-3xl">
        <View className={`mb-3 ${isRTL ? "items-end" : "items-start"}`}>
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, textAlign: isRTL ? "right" : "left" }}
          >
            {resolvedTitle}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500 mt-1"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
          >
            {referenceLabel}
          </Text>
        </View>

        {loading ? (
          <View className="py-6 items-center">
            <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
          </View>
        ) : null}

        {!loading && block.type === "ayah_range" && (
          <View className="gap-3">
            {quranRows.map((row) => (
              <Pressable
                key={`${row.surah}:${row.ayah}`}
                onPress={() => setDetailTarget({ surah: row.surah, ayah: row.ayah })}
                className="rounded-3xl bg-surface dark:bg-surface-dark px-4 py-4"
                style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.99 : 1 }] })}
              >
                <Text
                  className="text-warm-400 dark:text-neutral-500 mb-2"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
                >
                  {`${row.surah}:${row.ayah}`}
                </Text>
                {!fontsReady ? (
                  <Text
                    className="text-warm-500 dark:text-neutral-400"
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
                  >
                    {s.loading}
                  </Text>
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
                      {row.text_qcf2.split(" ").filter(Boolean).map((glyph, index) => (
                        <Text
                          key={`${row.surah}:${row.ayah}:${index}`}
                          className="text-charcoal dark:text-neutral-100"
                          style={{
                            fontFamily: qpcFontName(row.v2_page),
                            fontSize: 28,
                            lineHeight: 54,
                            paddingHorizontal: 2,
                          }}
                        >
                          {glyph}
                        </Text>
                      ))}
                    </View>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {!loading && (block.type === "translation" || block.type === "tafseer") && (
          <View className="gap-3">
            {textRows.map((row) => (
              <Pressable
                key={`${row.surah}:${row.ayah}:${block.type}`}
                onPress={() => setDetailTarget({ surah: row.surah, ayah: row.ayah })}
                className="rounded-3xl bg-surface dark:bg-surface-dark px-4 py-4"
                style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.99 : 1 }] })}
              >
                <Text
                  className="text-warm-400 dark:text-neutral-500 mb-2"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
                >
                  {`${row.surah}:${row.ayah}`}
                </Text>
                <Text
                  className="text-charcoal dark:text-neutral-100"
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: 15,
                    lineHeight: 26,
                    textAlign:
                      block.type === "tafseer"
                        ? "right"
                        : translationDirection === "rtl"
                          ? "right"
                          : "left",
                    writingDirection:
                      block.type === "tafseer" ? "rtl" : translationDirection,
                  }}
                >
                  {row.text}
                </Text>
              </Pressable>
            ))}
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
                  className="text-charcoal dark:text-neutral-100"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, textAlign: isRTL ? "right" : "left" }}
                >
                  {s.comingSoon}
                </Text>
                <Text
                  className="text-warm-400 dark:text-neutral-500"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
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
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {placeholderBody}
            </Text>
          </View>
        )}

        {!loading && block.type !== "recitation_placeholder" && (
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
