import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { View, Text, Pressable, ScrollView, useWindowDimensions } from "react-native";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useWordInteraction, type WordRef } from "@/lib/word/context";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { useDatabase } from "@/lib/database/provider";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { MeaningTab } from "./word-tabs/MeaningTab";
import { IrabTab } from "./word-tabs/IrabTab";
import { TasreefTab } from "./word-tabs/TasreefTab";
import { TajweedTab } from "./word-tabs/TajweedTab";
import { QiraatTab } from "./word-tabs/QiraatTab";
import { OccurrencesTab } from "./word-tabs/OccurrencesTab";
import { AyahDetailModal } from "./AyahDetailModal";
import { fetchWordRoot, fetchWordText, fetchWordTranslation } from "@/lib/word/queries";

type TabKey = "meaning" | "irab" | "tajweed" | "tasreef" | "qiraat" | "occurrences";

type WordHeaderMeta = {
  wordText: string | null;
  root: string | null;
  lemma: string | null;
  rootCount: number | null;
  translationEn: string | null;
};

export function WordDetailSheet() {
  const { detailWord, openDetail, closeDetail } = useWordInteraction();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const { width, height } = useWindowDimensions();
  const s = useStrings();
  const db = useDatabase();

  const [activeTab, setActiveTab] = useState<TabKey>("meaning");
  const [ayahModalOpen, setAyahModalOpen] = useState(false);
  const [adjacentWords, setAdjacentWords] = useState<{ previous: WordRef | null; next: WordRef | null }>({
    previous: null,
    next: null,
  });
  const [headerMeta, setHeaderMeta] = useState<WordHeaderMeta>({
    wordText: null,
    root: null,
    lemma: null,
    rootCount: null,
    translationEn: null,
  });
  const tabScrollRef = useRef<ScrollView>(null);
  const contentScrollRef = useRef<ScrollView>(null);

  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxModalHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 720);

  const tabs = useMemo(
    () => [
      { key: "meaning" as TabKey, label: s.wordTabMeaning },
      { key: "irab" as TabKey, label: s.wordTabIrab },
      { key: "tajweed" as TabKey, label: s.wordTabTajweed },
      { key: "tasreef" as TabKey, label: s.wordTabTasreef },
      { key: "qiraat" as TabKey, label: s.wordTabQiraat },
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
    const targetWord = adjacentWords[direction];
    if (!targetWord) return;
    setAyahModalOpen(false);
    openDetail(targetWord);
  }, [adjacentWords, openDetail]);

  useEffect(() => {
    if (!detailWord) return;
    let cancelled = false;
    setHeaderMeta({ wordText: null, root: null, lemma: null, rootCount: null, translationEn: null });
    Promise.all([
      fetchWordText(db, detailWord.surah, detailWord.ayah, detailWord.wordPos),
      fetchWordRoot(db, detailWord.surah, detailWord.ayah, detailWord.wordPos),
      fetchWordTranslation(db, detailWord.surah, detailWord.ayah, detailWord.wordPos),
    ])
      .then(async ([wordText, rootMeta, wordTranslation]) => {
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
          root: rootMeta?.root ?? null,
          lemma: rootMeta?.lemma ?? null,
          rootCount,
          translationEn: wordTranslation?.translation_en ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setHeaderMeta({ wordText: null, root: null, lemma: null, rootCount: null, translationEn: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [db, detailWord?.surah, detailWord?.ayah, detailWord?.wordPos]);

  useEffect(() => {
    if (!detailWord) {
      setAdjacentWords({ previous: null, next: null });
      return;
    }
    let cancelled = false;
    Promise.all([
      db.getFirstAsync<WordRef>(
        `SELECT wr.surah, wr.ayah, wr.word_pos AS wordPos, q.v2_page AS v2Page
         FROM word_roots wr
         JOIN quran_text q ON q.surah = wr.surah AND q.ayah = wr.ayah
         WHERE wr.surah < ?
            OR (wr.surah = ? AND wr.ayah < ?)
            OR (wr.surah = ? AND wr.ayah = ? AND wr.word_pos < ?)
         ORDER BY wr.surah DESC, wr.ayah DESC, wr.word_pos DESC
         LIMIT 1`,
        [detailWord.surah, detailWord.surah, detailWord.ayah, detailWord.surah, detailWord.ayah, detailWord.wordPos]
      ),
      db.getFirstAsync<WordRef>(
        `SELECT wr.surah, wr.ayah, wr.word_pos AS wordPos, q.v2_page AS v2Page
         FROM word_roots wr
         JOIN quran_text q ON q.surah = wr.surah AND q.ayah = wr.ayah
         WHERE wr.surah > ?
            OR (wr.surah = ? AND wr.ayah > ?)
            OR (wr.surah = ? AND wr.ayah = ? AND wr.word_pos > ?)
         ORDER BY wr.surah, wr.ayah, wr.word_pos
         LIMIT 1`,
        [detailWord.surah, detailWord.surah, detailWord.ayah, detailWord.surah, detailWord.ayah, detailWord.wordPos]
      ),
    ]).then(([previous, next]) => {
      if (!cancelled) setAdjacentWords({ previous: previous ?? null, next: next ?? null });
    }).catch(() => {
      if (!cancelled) setAdjacentWords({ previous: null, next: null });
    });
    return () => {
      cancelled = true;
    };
  }, [db, detailWord?.surah, detailWord?.ayah, detailWord?.wordPos]);

  useEffect(() => {
    if (activeTab === "irab") return;
    const frame = requestAnimationFrame(() => {
      contentScrollRef.current?.scrollTo({ y: 0, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, detailWord?.surah, detailWord?.ayah, detailWord?.wordPos]);

  useEffect(() => {
    if (!isRTL) return;
    const frame = requestAnimationFrame(() => {
      tabScrollRef.current?.scrollToEnd({ animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [isRTL, activeTab]);

  if (!detailWord) return null;

  const { surah, ayah, wordPos } = detailWord;
  const isArabicMode = uiLanguage === "ar";
  const surahLabel = isArabicMode ? "السورة" : "Surah";
  const ayahLabel = isArabicMode ? "الآية" : "Ayah";
  const wordLabel = isArabicMode ? "الكلمة" : "Word";
  const showRootLemma = isArabicMode;

  return (
    <>
      <ResponsiveSheet
        open={!!detailWord}
        onClose={handleClose}
        maxWidth={760}
        maxHeight={maxModalHeight}
        dir="ltr"
      >
        <OverlayHeader
          isRTL={isRTL}
          onClose={handleClose}
          showHandle={isPhone}
          actions={
            <View className={isRTL ? "flex-row-reverse items-center gap-1.5" : "flex-row items-center gap-1.5"}>
              <PanelNavIcon
                icon={isRTL ? <ChevronRight size={16} color={isDark ? "#a3a3a3" : "#8B8178"} /> : <ChevronLeft size={16} color={isDark ? "#a3a3a3" : "#8B8178"} />}
                onPress={() => handleNavigateWord("previous")}
                disabled={!adjacentWords.previous}
                accessibilityLabel={s.previousWord}
              />
              <PanelNavIcon
                icon={isRTL ? <ChevronLeft size={16} color={isDark ? "#a3a3a3" : "#8B8178"} /> : <ChevronRight size={16} color={isDark ? "#a3a3a3" : "#8B8178"} />}
                onPress={() => handleNavigateWord("next")}
                disabled={!adjacentWords.next}
                accessibilityLabel={s.nextWord}
              />
            </View>
          }
          leading={
            <View className={`flex-row items-center gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
              <View className="rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-3 py-1.5">
                <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}>
                  {surah}:{ayah}:{wordPos}
                </Text>
              </View>
              <Pressable
                onPress={() => setAyahModalOpen(true)}
                className="flex-row items-center gap-1.5 rounded-full bg-surface-low dark:bg-surface-dark-low px-3 py-1.5"
                style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
              >
                <BookOpen size={13} color={isDark ? "#a3a3a3" : "#003638"} />
                <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                  {s.viewFullAyah}
                </Text>
              </Pressable>
            </View>
          }
        />

        <View className="flex-1 min-h-0">
          <View className={`px-4 py-3 flex-shrink-0 ${isRTL ? "items-end" : "items-start"}`}>
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 27, writingDirection: "rtl" }}
            >
              {headerMeta.wordText?.trim() ? headerMeta.wordText : "—"}
            </Text>
            {!isArabicMode && !!headerMeta.translationEn && (
              <Text
                className={`mt-1 text-warm-500 dark:text-neutral-400 ${isRTL ? "text-right" : "text-left"}`}
                style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
              >
                {headerMeta.translationEn}
              </Text>
            )}

            <View className={`mt-2 flex-row flex-wrap gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
              {showRootLemma && (
                <>
                  <MetaPill label={s.rootLabel ?? "Root"} value={headerMeta.root ?? "—"} />
                  <MetaPill label={s.lemmaLabel ?? "Lemma"} value={headerMeta.lemma ?? "—"} />
                </>
              )}
              <MetaPill label={s.wordTabOccurrences} value={headerMeta.rootCount == null ? "—" : String(headerMeta.rootCount)} />
            </View>

            <View className={`mt-2 flex-row gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
              <QuickStat label={surahLabel} value={String(surah)} />
              <QuickStat label={ayahLabel} value={String(ayah)} />
              <QuickStat label={wordLabel} value={String(wordPos)} />
            </View>
          </View>

          <View className="h-14 justify-center bg-surface-low dark:bg-surface-dark-low">
            <ScrollView
              ref={tabScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                minWidth: "100%",
                paddingHorizontal: 16,
                gap: 6,
                paddingVertical: 6,
                alignItems: "center",
                justifyContent: "flex-start",
                flexDirection: isRTL ? "row-reverse" : "row",
              }}
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => setActiveTab(tab.key)}
                    className={`rounded-full px-4 py-2.5 ${isActive ? "bg-primary-soft" : "bg-transparent"}`}
                    style={({ pressed }) => ({
                      alignSelf: "center",
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    })}
                  >
                    <Text
                      className={isActive ? "text-gold" : "text-warm-400 dark:text-neutral-500"}
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                    >
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <OverlayBody scrollRef={contentScrollRef} contentContainerClassName="px-5">
            {activeTab === "meaning" && <MeaningTab surah={surah} ayah={ayah} wordPos={wordPos} />}
            {activeTab === "irab" && (
              <IrabTab
                surah={surah}
                ayah={ayah}
                wordPos={wordPos}
                onScrollToMatch={(y) => contentScrollRef.current?.scrollTo({ y, animated: true })}
              />
            )}
            {activeTab === "tajweed" && <TajweedTab surah={surah} ayah={ayah} wordPos={wordPos} />}
            {activeTab === "tasreef" && <TasreefTab surah={surah} ayah={ayah} wordPos={wordPos} />}
            {activeTab === "qiraat" && <QiraatTab surah={surah} ayah={ayah} />}
            {activeTab === "occurrences" && <OccurrencesTab surah={surah} ayah={ayah} wordPos={wordPos} />}
          </OverlayBody>
        </View>
      </ResponsiveSheet>
      <AyahDetailModal
        target={ayahModalOpen ? { surah, ayah } : null}
        onClose={() => setAyahModalOpen(false)}
        initialTab={activeTab === "qiraat" ? "qiraat" : activeTab === "meaning" ? "translation" : "tafsir"}
      />
    </>
  );
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center gap-1 rounded-full bg-surface-low dark:bg-surface-dark px-3 py-1.5">
      <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}>
        {label}
      </Text>
      <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}>
        {value}
      </Text>
    </View>
  );
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-w-[68px] flex-1 rounded-2xl bg-surface-low dark:bg-surface-dark px-3 py-2">
      <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 10 }}>
        {label}
      </Text>
      <Text className="mt-0.5 text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}>
        {value}
      </Text>
    </View>
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
      hitSlop={8}
      className="h-8 w-8 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      {icon}
    </Pressable>
  );
}
