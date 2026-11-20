import { resolvePageFontStyle } from "@/lib/fonts/page-style";
import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { View, Text, Pressable, ScrollView, Platform, useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import { formatAyahRef } from "@/lib/arabic";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useWordInteraction, type WordRef } from "@/lib/word/context";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { formatNumber } from "@/lib/i18n/count";
import { useDatabase } from "@/lib/database/provider";
import { systemConfirmsCopy } from "@/lib/clipboard-feedback";
import { useOperationNotice } from "@/components/ui/OperationNoticeProvider";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { quranPageFontName, quranPageFontPaletteStyle } from "@/lib/fonts/loader";
import { useQuranPageFontReady } from "@/lib/fonts/use-quran-page-font";
import { MeaningTab } from "./word-tabs/MeaningTab";
import { IrabTab } from "./word-tabs/IrabTab";
import { TasreefTab } from "./word-tabs/TasreefTab";
import { TajweedTab } from "./word-tabs/TajweedTab";
import { OccurrencesTab } from "./word-tabs/OccurrencesTab";
import { AyahDetailModal } from "./AyahDetailModal";
import { DetailTabRow } from "./DetailTabRow";
import { useDetailArrowKeys } from "./use-detail-arrow-keys";
import {
  fetchWordMeaningAr,
  fetchWordQcf2Glyph,
  fetchWordRoot,
  fetchWordText,
  fetchWordTranslation,
} from "@/lib/word/queries";
import { textStartStyle } from "@/lib/ui/direction";

type TabKey = "meaning" | "irab" | "tajweed" | "tasreef" | "occurrences";
const WORD_HEADER_FONT_STYLE = "v4-tajweed";

type WordHeaderMeta = {
  wordText: string | null;
  qcf2Glyph: string | null;
  root: string | null;
  lemma: string | null;
  rootCount: number | null;
  translationEn: string | null;
  meaningAr: string | null;
  surahNameArabic: string | null;
  surahNameEnglish: string | null;
};

const EMPTY_META: WordHeaderMeta = {
  wordText: null,
  qcf2Glyph: null,
  root: null,
  lemma: null,
  rootCount: null,
  translationEn: null,
  meaningAr: null,
  surahNameArabic: null,
  surahNameEnglish: null,
};

export function WordDetailSheet() {
  const { detailWord, openDetail, closeDetail } = useWordInteraction();
  const { effectiveTheme, isDark, isRTL, uiLanguage, themeSurface } = useSettings();
  const { width, height } = useWindowDimensions();
  const s = useStrings();
  const db = useDatabase();
  const showNotice = useOperationNotice();
  const reduceMotion = useReducedMotionPreference();

  const [activeTab, setActiveTab] = useState<TabKey>("meaning");
  const [ayahModalOpen, setAyahModalOpen] = useState(false);
  const [neighbors, setNeighbors] = useState<{
    word: WordRef;
    previous: WordRef | null;
    next: WordRef | null;
  } | null>(null);
  const adjacentWords = neighbors?.word === detailWord ? neighbors : null;
  const headerFontStyle = resolvePageFontStyle(WORD_HEADER_FONT_STYLE, isDark);
  const wordHeaderFontReady = useQuranPageFontReady(headerFontStyle, detailWord?.v2Page);
  const [headerMeta, setHeaderMeta] = useState<WordHeaderMeta>(EMPTY_META);
  const contentScrollRef = useRef<ScrollView>(null);
  const keyScopeRef = useRef<View>(null);

  // Every close path (close button, Back, Escape, backdrop, an occurrence or ayah jump that closes
  // the sheet from the reader) leaves no word open, so the next word always starts on Meaning.
  if (!detailWord && (activeTab !== "meaning" || ayahModalOpen)) {
    setActiveTab("meaning");
    setAyahModalOpen(false);
  }

  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxModalHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 720);
  const headerFontFamily = detailWord ? quranPageFontName(headerFontStyle, detailWord.v2Page) : undefined;
  const headerFontPaletteStyle = detailWord
    ? quranPageFontPaletteStyle(headerFontStyle, detailWord.v2Page, effectiveTheme)
    : null;

  const tabs = useMemo(
    () => [
      { key: "meaning" as TabKey, label: s.wordTabMeaning },
      { key: "irab" as TabKey, label: s.wordTabIrab },
      { key: "tajweed" as TabKey, label: s.wordTabTajweed },
      { key: "tasreef" as TabKey, label: s.wordTabTasreef },
      { key: "occurrences" as TabKey, label: s.wordTabOccurrences },
    ],
    [s]
  );

  const handleClose = useCallback(() => {
    closeDetail();
    setActiveTab("meaning");
    setAyahModalOpen(false);
  }, [closeDetail]);

  const handleNavigateWord = useCallback((direction: "previous" | "next") => {
    const targetWord = adjacentWords?.[direction];
    if (!targetWord) return;
    setAyahModalOpen(false);
    openDetail(targetWord);
  }, [adjacentWords, openDetail]);

  useDetailArrowKeys(keyScopeRef, {
    enabled: !!detailWord && !ayahModalOpen,
    isRTL,
    onPrevious: () => handleNavigateWord("previous"),
    onNext: () => handleNavigateWord("next"),
  });

  useEffect(() => {
    if (!detailWord) return;
    let cancelled = false;
    setHeaderMeta(EMPTY_META);
    Promise.all([
      fetchWordText(db, detailWord.surah, detailWord.ayah, detailWord.wordPos),
      fetchWordQcf2Glyph(db, detailWord.surah, detailWord.ayah, detailWord.wordPos),
      fetchWordRoot(db, detailWord.surah, detailWord.ayah, detailWord.wordPos),
      fetchWordTranslation(db, detailWord.surah, detailWord.ayah, detailWord.wordPos),
      fetchWordMeaningAr(db, detailWord.surah, detailWord.ayah, detailWord.wordPos),
      db.getFirstAsync<{ name_arabic: string; name_english: string }>(
        "SELECT name_arabic, name_english FROM surahs WHERE number = ?",
        [detailWord.surah]
      ),
    ])
      .then(async ([wordText, qcf2Glyph, rootMeta, wordTranslation, meaningAr, surahRow]) => {
        if (cancelled) return;
        let rootCount: number | null = null;
        if (rootMeta?.root) {
          const row = await db.getFirstAsync<{ count: number }>(
            "SELECT COUNT(*) as count FROM word_roots WHERE root = ?",
            [rootMeta.root]
          );
          rootCount = row?.count ?? 0;
        }
        if (cancelled) return;
        setHeaderMeta({
          wordText,
          qcf2Glyph,
          root: rootMeta?.root ?? null,
          lemma: rootMeta?.lemma ?? null,
          rootCount,
          translationEn: wordTranslation?.translation_en ?? null,
          meaningAr: meaningAr?.meaning?.trim().split(/\r?\n/)[0]?.trim() || null,
          surahNameArabic: surahRow?.name_arabic ?? null,
          surahNameEnglish: surahRow?.name_english ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setHeaderMeta(EMPTY_META);
      });
    return () => {
      cancelled = true;
    };
  }, [db, detailWord?.surah, detailWord?.ayah, detailWord?.wordPos]);


  useEffect(() => {
    if (!detailWord) {
      setNeighbors(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      db.getFirstAsync<WordRef>(
        `SELECT wr.surah, wr.ayah, wr.word_pos AS wordPos, q.v2_page AS v2Page
         FROM word_roots wr
         JOIN quran_text q ON q.surah = wr.surah AND q.ayah = wr.ayah
         WHERE (wr.surah, wr.ayah, wr.word_pos) < (?, ?, ?)
         ORDER BY wr.surah DESC, wr.ayah DESC, wr.word_pos DESC
         LIMIT 1`,
        [detailWord.surah, detailWord.ayah, detailWord.wordPos]
      ),
      db.getFirstAsync<WordRef>(
        `SELECT wr.surah, wr.ayah, wr.word_pos AS wordPos, q.v2_page AS v2Page
         FROM word_roots wr
         JOIN quran_text q ON q.surah = wr.surah AND q.ayah = wr.ayah
         WHERE (wr.surah, wr.ayah, wr.word_pos) > (?, ?, ?)
         ORDER BY wr.surah, wr.ayah, wr.word_pos
         LIMIT 1`,
        [detailWord.surah, detailWord.ayah, detailWord.wordPos]
      ),
    ]).then(([previous, next]) => {
      if (!cancelled) setNeighbors({ word: detailWord, previous, next });
    }).catch(() => {
      if (!cancelled) setNeighbors(null);
    });
    return () => {
      cancelled = true;
    };
  }, [db, detailWord]);

  useEffect(() => {
    if (activeTab === "irab") return;
    const frame = requestAnimationFrame(() => {
      contentScrollRef.current?.scrollTo({ y: 0, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, detailWord?.surah, detailWord?.ayah, detailWord?.wordPos]);

  // Copies the Unicode Uthmani word, never the page-font glyph code points shown above.
  const copyWord = useCallback(async () => {
    const text = headerMeta.wordText?.trim();
    if (!text) return;
    try {
      await Clipboard.setStringAsync(text);
      if (!systemConfirmsCopy()) showNotice(s.wordCopied);
    } catch (error) {
      console.warn("[WordDetailSheet] Failed to copy word:", error);
      showNotice(s.copyFailed);
    }
  }, [headerMeta.wordText, showNotice, s.wordCopied, s.copyFailed]);

  if (!detailWord) return null;

  const { surah, ayah, wordPos } = detailWord;
  const isArabicMode = uiLanguage === "ar";
  const panelIconColor = isDark ? "#a3a3a3" : effectiveTheme === "white" ? "#71717A" : "#7A634D";
  const accentColor = isDark ? "#2dd4bf" : "#0f766e";
  const surahName = isArabicMode ? headerMeta.surahNameArabic : headerMeta.surahNameEnglish;
  const reference = formatAyahRef(isRTL, surah, ayah, wordPos);
  const referenceLabel = surahName ? `${surahName} ${reference}` : reference;
  const gloss = isArabicMode ? headerMeta.meaningAr : headerMeta.translationEn;

  return (
    <>
      <ResponsiveSheet
        open={!!detailWord}
        onClose={handleClose}
        maxWidth={760}
        maxHeight={maxModalHeight}
        phoneSheetHeight="max"
        dir="ltr"
      >
        <View ref={keyScopeRef} className="flex-1 min-h-0">
          <OverlayHeader
            isRTL={isRTL}
            onClose={handleClose}
            showHandle={isPhone}
            actions={
              <View className={isRTL ? "flex-row-reverse items-center gap-1" : "flex-row items-center gap-1"}>
                <PanelNavIcon
                  icon={isRTL ? <ChevronRight size={18} color={panelIconColor} /> : <ChevronLeft size={18} color={panelIconColor} />}
                  onPress={() => handleNavigateWord("previous")}
                  disabled={!adjacentWords?.previous}
                  accessibilityLabel={s.previousWord}
                />
                <PanelNavIcon
                  icon={isRTL ? <ChevronLeft size={18} color={panelIconColor} /> : <ChevronRight size={18} color={panelIconColor} />}
                  onPress={() => handleNavigateWord("next")}
                  disabled={!adjacentWords?.next}
                  accessibilityLabel={s.nextWord}
                />
              </View>
            }
            leading={
              <View className={`flex-wrap items-center gap-2 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
                <View className="rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-3 py-1.5">
                  <Text
                    className="text-primary-muted dark:text-primary-bright"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, writingDirection: isRTL ? "rtl" : "ltr" }}
                  >
                    {referenceLabel}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setAyahModalOpen(true)}
                  accessibilityRole="button"
                  className={`items-center gap-1.5 rounded-full bg-surface-low dark:bg-surface-dark-low px-3 ${
                    isRTL ? "flex-row-reverse" : "flex-row"
                  }`}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                    cursor: Platform.OS === "web" ? "pointer" : undefined,
                  })}
                >
                  <BookOpen size={14} color={accentColor} />
                  <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                    {s.viewFullAyah}
                  </Text>
                </Pressable>
              </View>
            }
          />

          <View className="flex-1 min-h-0">
            <View className={`px-4 py-3 flex-shrink-0 ${isRTL ? "items-end" : "items-start"}`}>
              {/* Glyphs mounted before their page font exists render and measure in the system font. */}
              {wordHeaderFontReady ? (
                <Pressable
                  onLongPress={copyWord}
                  delayLongPress={450}
                  accessibilityRole="text"
                  accessibilityLabel={headerMeta.wordText ?? undefined}
                  accessibilityHint={s.copy}
                >
                  <Text
                    className="text-charcoal dark:text-neutral-100"
                    style={{
                      fontFamily: headerFontFamily,
                      ...headerFontPaletteStyle,
                      fontSize: 38,
                      lineHeight: 58,
                      writingDirection: "ltr",
                    }}
                  >
                    {headerMeta.qcf2Glyph?.trim() || headerMeta.wordText?.trim() || "—"}
                  </Text>
                </Pressable>
              ) : (
                <View style={{ height: 58 }} />
              )}
              {!!gloss && (
                <Text
                  className="mt-1 text-warm-600 dark:text-neutral-300"
                  style={{
                    fontFamily: "Manrope_500Medium",
                    fontSize: 14,
                    lineHeight: 22,
                    // The gloss follows its own language, English in English and Arabic in Arabic.
                    writingDirection: isArabicMode ? "rtl" : "ltr",
                    ...textStartStyle(isRTL),
                  }}
                >
                  {gloss}
                </Text>
              )}

              <View className={`mt-2 flex-row flex-wrap gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
                {headerMeta.root ? (
                  <MetaPill
                    label={s.rootLabel}
                    value={headerMeta.root}
                    onPress={() => setActiveTab("occurrences")}
                    accessibilityLabel={interpolate(s.wordRootOpenOccurrences, { root: headerMeta.root })}
                  />
                ) : null}
                {isArabicMode && headerMeta.lemma ? <MetaPill label={s.lemmaLabel} value={headerMeta.lemma} /> : null}
                {headerMeta.rootCount != null && headerMeta.rootCount > 0 ? (
                  <MetaPill
                    label={s.wordTabOccurrences}
                    value={formatNumber(headerMeta.rootCount, uiLanguage)}
                    onPress={() => setActiveTab("occurrences")}
                  />
                ) : null}
              </View>
            </View>

            <View className="px-4 pb-2">
              <DetailTabRow
                tabs={tabs}
                activeKey={activeTab}
                onChange={setActiveTab}
                isRTL={isRTL}
                backgroundColor={themeSurface}
              />
            </View>

            <OverlayBody scrollRef={contentScrollRef} contentContainerClassName="px-5">
              {activeTab === "meaning" && <MeaningTab surah={surah} ayah={ayah} wordPos={wordPos} />}
              {activeTab === "irab" && (
                <IrabTab
                  surah={surah}
                  ayah={ayah}
                  wordPos={wordPos}
                  onScrollToMatch={(y) => contentScrollRef.current?.scrollTo({ y, animated: !reduceMotion })}
                />
              )}
              {activeTab === "tajweed" && <TajweedTab surah={surah} ayah={ayah} wordPos={wordPos} />}
              {activeTab === "tasreef" && (
                <TasreefTab surah={surah} ayah={ayah} wordPos={wordPos} onRootPress={() => setActiveTab("occurrences")} />
              )}
              {activeTab === "occurrences" && <OccurrencesTab surah={surah} ayah={ayah} wordPos={wordPos} />}
            </OverlayBody>
          </View>
        </View>
      </ResponsiveSheet>
      <AyahDetailModal
        target={ayahModalOpen ? { surah, ayah } : null}
        onClose={() => setAyahModalOpen(false)}
        onNavigate={handleClose}
        initialTab={activeTab === "meaning" ? "translation" : "tafsir"}
      />
    </>
  );
}

function MetaPill({
  label,
  value,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const content = (
    <View className="flex-row items-center gap-1 rounded-full bg-surface-low dark:bg-surface-dark px-3 py-1.5">
      <Text className="text-warm-600 dark:text-neutral-400" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
        {label}
      </Text>
      <Text
        className={onPress ? "text-primary-muted dark:text-primary-bright" : "text-charcoal dark:text-neutral-200"}
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
      >
        {value}
      </Text>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label} ${value}`}
      className="justify-center"
      style={{ minHeight: 44, cursor: Platform.OS === "web" ? "pointer" : undefined }}
    >
      {content}
    </Pressable>
  );
}

function PanelNavIcon({
  icon,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  icon: ReactNode;
  onPress: () => void;
  disabled: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      className="h-11 w-11 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
      style={{ opacity: disabled ? 0.45 : 1, cursor: Platform.OS === "web" ? (disabled ? "auto" : "pointer") : undefined }}
    >
      {icon}
    </Pressable>
  );
}
