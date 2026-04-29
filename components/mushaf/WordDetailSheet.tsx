import { useState, useCallback, useEffect, useMemo } from "react";
import { View, Text, Modal, Pressable, ScrollView, useWindowDimensions } from "react-native";
import { ArrowLeft, ArrowRight, BookOpen, X } from "lucide-react-native";
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

type TabKey = "meaning" | "irab" | "tajweed" | "tasreef" | "qiraat" | "occurrences";
type SheetView = "tabs" | "ayah";

type AyahCtx = {
  text: string;
  v2Page: number;
};

export function WordDetailSheet() {
  const { detailWord, closeDetail } = useWordInteraction();
  const { isDark, isRTL, fontSize, lineHeight } = useSettings();
  const { width, height } = useWindowDimensions();
  const s = useStrings();
  const db = useDatabase();
  const [activeTab, setActiveTab] = useState<TabKey>("meaning");
  const [view, setView] = useState<SheetView>("tabs");
  const [ayahCtx, setAyahCtx] = useState<AyahCtx | null>(null);
  const modalWidth = Math.max(280, Math.min(width - 32, 760));
  const maxModalHeight = Math.max(320, Math.min(height - 48, 680));
  const contentMaxHeight = Math.max(220, maxModalHeight - 150);

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

  // Load the ayah context lazily when the user switches to the full-ayah view
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

  if (!detailWord) return null;

  const { surah, ayah, wordPos } = detailWord;
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;

  return (
    <Modal
      visible={!!detailWord}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View
        className="flex-1 items-center justify-center px-4 py-6"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      >
        <Pressable className="absolute inset-0" onPress={handleClose} />
        <View
          className="overflow-hidden rounded-3xl bg-surface dark:bg-surface-dark-low"
          style={{ width: modalWidth, maxHeight: maxModalHeight }}
          onStartShouldSetResponder={() => true}
        >
          {/* Header — context-sensitive */}
          <View className="flex-row items-center justify-between border-b border-warm-200 dark:border-neutral-800 px-5 py-4">
            <View className="flex-row items-center gap-2">
              {view === "ayah" ? (
                <Pressable
                  onPress={() => setView("tabs")}
                  className="flex-row items-center gap-1.5 rounded-full bg-surface-high dark:bg-surface-dark-high px-3 py-1.5"
                  style={({ pressed }) => ({
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  })}
                >
                  <BackIcon size={14} color={isDark ? "#a3a3a3" : "#003638"} />
                  <Text
                    className="text-charcoal dark:text-neutral-200"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                  >
                    {s.backToWord}
                  </Text>
                </Pressable>
              ) : (
                <View className="bg-primary-accent/10 dark:bg-primary-bright/10 rounded-full px-3.5 py-1.5">
                  <Text
                    className="text-primary-accent dark:text-primary-bright"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                  >
                    {surah}:{ayah}:{wordPos}
                  </Text>
                </View>
              )}

              {view === "tabs" && (
                <Pressable
                  onPress={() => setView("ayah")}
                  className="flex-row items-center gap-1.5 rounded-full bg-surface-high dark:bg-surface-dark-high px-3 py-1.5"
                  style={({ pressed }) => ({
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  })}
                >
                  <BookOpen size={13} color={isDark ? "#a3a3a3" : "#003638"} />
                  <Text
                    className="text-charcoal dark:text-neutral-200"
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                  >
                    {s.viewFullAyah}
                  </Text>
                </Pressable>
              )}
            </View>
            <Pressable
              onPress={handleClose}
              className="w-9 h-9 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 0.95 : 1 }],
              })}
            >
              <X size={16} color={isDark ? "#a3a3a3" : "#6e5a47"} />
            </Pressable>
          </View>

          {view === "tabs" ? (
            <>
              {/* Tab bar — horizontally scrollable pill tabs */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="bg-surface-low dark:bg-surface-dark"
                contentContainerStyle={{ paddingHorizontal: 20, gap: 4, paddingVertical: 4 }}
              >
                {tabs.map((tab) => {
                  const isActive = activeTab === tab.key;
                  return (
                    <Pressable
                      key={tab.key}
                      onPress={() => setActiveTab(tab.key)}
                      className={`rounded-full px-4 py-2.5 ${
                        isActive
                          ? "bg-primary-accent/10 dark:bg-primary-bright/10"
                          : ""
                      }`}
                      style={({ pressed }) => ({
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                      })}
                    >
                      <Text
                        className={
                          isActive
                            ? "text-primary-accent dark:text-primary-bright"
                            : "text-warm-400 dark:text-neutral-500"
                        }
                        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                      >
                        {tab.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* Tab content */}
              <ScrollView className="px-6" style={{ maxHeight: contentMaxHeight }}>
                {activeTab === "meaning" && (
                  <MeaningTab surah={surah} ayah={ayah} wordPos={wordPos} />
                )}
                {activeTab === "irab" && (
                  <IrabTab surah={surah} ayah={ayah} wordPos={wordPos} />
                )}
                {activeTab === "tajweed" && (
                  <TajweedTab surah={surah} ayah={ayah} wordPos={wordPos} />
                )}
                {activeTab === "tasreef" && (
                  <TasreefTab surah={surah} ayah={ayah} wordPos={wordPos} />
                )}
                {activeTab === "qiraat" && <QiraatTab surah={surah} ayah={ayah} />}
                {activeTab === "occurrences" && (
                  <OccurrencesTab surah={surah} ayah={ayah} wordPos={wordPos} />
                )}
              </ScrollView>
            </>
          ) : (
            <ScrollView style={{ maxHeight: contentMaxHeight }}>
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
                  <Text className="text-warm-400 dark:text-neutral-500 text-sm">
                    {s.loading}
                  </Text>
                </View>
              )}
            </ScrollView>
          )}

          <View style={{ height: 24 }} />
        </View>
      </View>
    </Modal>
  );
}
