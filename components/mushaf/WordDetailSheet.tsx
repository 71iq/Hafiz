import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Modal, Pressable, ScrollView, useWindowDimensions } from "react-native";
import { BookOpen, X } from "lucide-react-native";
import { useWordInteraction } from "@/lib/word/context";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { useDatabase } from "@/lib/database/provider";
import { MeaningTab } from "./word-tabs/MeaningTab";
import { IrabTab } from "./word-tabs/IrabTab";
import { TasreefTab } from "./word-tabs/TasreefTab";
import { TajweedTab } from "./word-tabs/TajweedTab";
import { QiraatTab } from "./word-tabs/QiraatTab";
import { OccurrencesTab } from "./word-tabs/OccurrencesTab";
import { AyahBlock } from "./AyahBlock";
import { fetchWordRoot, fetchWordText, fetchWordTranslation } from "@/lib/word/queries";

type TabKey = "meaning" | "irab" | "tajweed" | "tasreef" | "qiraat" | "occurrences";
type SheetView = "tabs" | "ayah";

type AyahCtx = {
  text: string;
  v2Page: number;
};

type WordHeaderMeta = {
  wordText: string | null;
  root: string | null;
  lemma: string | null;
  rootCount: number | null;
  translationEn: string | null;
};

export function WordDetailSheet() {
  const { detailWord, closeDetail } = useWordInteraction();
  const { isDark, isRTL, uiLanguage, fontSize, lineHeight } = useSettings();
  const { width, height } = useWindowDimensions();
  const s = useStrings();
  const db = useDatabase();

  const [activeTab, setActiveTab] = useState<TabKey>("meaning");
  const [view, setView] = useState<SheetView>("tabs");
  const [ayahCtx, setAyahCtx] = useState<AyahCtx | null>(null);
  const [headerMeta, setHeaderMeta] = useState<WordHeaderMeta>({
    wordText: null,
    root: null,
    lemma: null,
    rootCount: null,
    translationEn: null,
  });
  const tabScrollRef = useRef<ScrollView>(null);

  const isPhone = width < 768;
  const modalWidth = isPhone ? Math.max(280, Math.min(width - 16, 430)) : Math.max(280, Math.min(width - 32, 760));
  const maxModalHeight = Math.max(320, Math.min(height - (isPhone ? 20 : 48), 760));

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
    setView("tabs");
  }, [closeDetail]);

  useEffect(() => {
    if (!detailWord) return;
    let cancelled = false;
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
    if (view !== "ayah" || !detailWord) return;
    let cancelled = false;
    db.getFirstAsync<{ text_qcf2: string; v2_page: number }>(
      "SELECT text_qcf2, v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
      [detailWord.surah, detailWord.ayah]
    )
      .then((row) => {
        if (cancelled || !row) return;
        setAyahCtx({ text: row.text_qcf2, v2Page: row.v2_page });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [view, detailWord?.surah, detailWord?.ayah, db]);

  useEffect(() => {
    if (view !== "tabs" || !isRTL) return;
    const frame = requestAnimationFrame(() => {
      tabScrollRef.current?.scrollToEnd({ animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [view, isRTL, activeTab]);

  if (!detailWord) return null;

  const { surah, ayah, wordPos } = detailWord;
  const isArabicMode = uiLanguage === "ar";
  const ayahLabel = isArabicMode ? "الآية" : "Ayah";
  const wordLabel = isArabicMode ? "الكلمة" : "Word";
  return (
    <Modal
      visible={!!detailWord}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View className="flex-1 items-center justify-end px-2 py-2" style={{ backgroundColor: "rgba(0,0,0,0.58)" }}>
        <Pressable className="absolute inset-0" onPress={handleClose} />
        <View
          className="overflow-hidden rounded-t-3xl bg-surface dark:bg-surface-dark-low"
          style={{ width: modalWidth, height: maxModalHeight }}
          onStartShouldSetResponder={() => true}
        >
          <View className="items-center pt-2 pb-1">
            <View className="h-1 w-10 rounded-full bg-surface-high dark:bg-surface-dark-high" />
          </View>

          <View className={`px-4 pb-3 flex-shrink-0 ${isRTL ? "items-end" : "items-start"}`}>
            <View className={`w-full flex-row items-center justify-between ${isRTL ? "flex-row-reverse" : ""}`}>
              <View className="flex-row items-center gap-2">
                <View className="rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-3 py-1.5">
                  <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}>
                    {surah}:{ayah}:{wordPos}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setView(view === "tabs" ? "ayah" : "tabs")}
                  className="flex-row items-center gap-1.5 rounded-full bg-surface-low dark:bg-surface-dark px-3 py-1.5"
                  style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                >
                  <BookOpen size={13} color={isDark ? "#a3a3a3" : "#003638"} />
                  <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                    {view === "ayah" ? (s.backToWord ?? "Back") : s.viewFullAyah}
                  </Text>
                </Pressable>
              </View>
              <Pressable
                onPress={handleClose}
                className="h-9 w-9 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark"
                style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
              >
                <X size={16} color={isDark ? "#a3a3a3" : "#6e5a47"} />
              </Pressable>
            </View>

            {view === "tabs" && (
              <>
                <Text
                  className="mt-3 text-charcoal dark:text-neutral-100"
                  style={{ fontFamily: "NotoSerif_700Bold", fontSize: 27, writingDirection: "rtl" }}
                >
                  {headerMeta.wordText ?? "…"}
                </Text>
                {!isArabicMode && !!headerMeta.translationEn && (
                  <Text
                    className={`mt-1 text-warm-500 dark:text-neutral-400 ${isRTL ? "text-right" : "text-left"}`}
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
                  >
                    {s.wordMeaningTranslation ?? "Translation"}: {headerMeta.translationEn}
                  </Text>
                )}

                <View className={`mt-2 flex-row flex-wrap gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
                  <MetaPill label={s.rootLabel ?? "Root"} value={headerMeta.root ?? "—"} />
                  <MetaPill label={s.lemmaLabel ?? "Lemma"} value={headerMeta.lemma ?? "—"} />
                  <MetaPill label={s.wordTabOccurrences} value={headerMeta.rootCount == null ? "—" : String(headerMeta.rootCount)} />
                </View>

                <View className={`mt-2 flex-row gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
                  <QuickStat label={s.surah} value={String(surah)} />
                  <QuickStat label={ayahLabel} value={String(ayah)} />
                  <QuickStat label={wordLabel} value={String(wordPos)} />
                </View>
              </>
            )}
          </View>

          {view === "tabs" ? (
            <View className="flex-1 min-h-0">
              <View className="h-14 justify-center bg-surface-low dark:bg-surface-dark">
                <ScrollView
                  ref={tabScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: 16,
                    gap: 6,
                    paddingVertical: 6,
                    alignItems: "center",
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

              <ScrollView className="flex-1 min-h-0 px-5">
                {activeTab === "meaning" && <MeaningTab surah={surah} ayah={ayah} wordPos={wordPos} />}
                {activeTab === "irab" && <IrabTab surah={surah} ayah={ayah} wordPos={wordPos} />}
                {activeTab === "tajweed" && <TajweedTab surah={surah} ayah={ayah} wordPos={wordPos} />}
                {activeTab === "tasreef" && <TasreefTab surah={surah} ayah={ayah} wordPos={wordPos} />}
                {activeTab === "qiraat" && <QiraatTab surah={surah} ayah={ayah} />}
                {activeTab === "occurrences" && <OccurrencesTab surah={surah} ayah={ayah} wordPos={wordPos} />}
              </ScrollView>

            </View>
          ) : (
            <ScrollView className="flex-1 min-h-0">
              {ayahCtx ? (
                <AyahBlock
                  surah={surah}
                  ayah={ayah}
                  text={ayahCtx.text}
                  v2Page={ayahCtx.v2Page}
                  fontSize={fontSize}
                  lineHeight={lineHeight}
                />
              ) : (
                <View className="py-10 items-center">
                  <Text className="text-warm-400 dark:text-neutral-500 text-sm">{s.loading}</Text>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
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
