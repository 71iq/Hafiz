import { useState, useCallback, useMemo } from "react";
import { View, Text, Modal, Pressable, ScrollView } from "react-native";
import { X } from "lucide-react-native";
import { useWordInteraction } from "@/lib/word/context";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { MeaningTab } from "./word-tabs/MeaningTab";
import { IrabTab } from "./word-tabs/IrabTab";
import { TasreefTab } from "./word-tabs/TasreefTab";
import { TajweedTab } from "./word-tabs/TajweedTab";
import { QiraatTab } from "./word-tabs/QiraatTab";
import { OccurrencesTab } from "./word-tabs/OccurrencesTab";

type TabKey = "meaning" | "irab" | "tajweed" | "tasreef" | "qiraat" | "occurrences";

export function WordDetailSheet() {
  const { detailWord, closeDetail } = useWordInteraction();
  const { isDark, uiLanguage } = useSettings();
  const s = useStrings();
  const [activeTab, setActiveTab] = useState<TabKey>("meaning");

  const isArabicMode = uiLanguage === "ar";

  const tabs = useMemo(
    () => [
      { key: "meaning" as TabKey, label: isArabicMode ? s.wordTabMeaning : s.wordTabMeaning },
      { key: "irab" as TabKey, label: s.wordTabIrab },
      { key: "tajweed" as TabKey, label: s.wordTabTajweed },
      { key: "tasreef" as TabKey, label: s.wordTabTasreef },
      { key: "qiraat" as TabKey, label: s.wordTabQiraat },
      { key: "occurrences" as TabKey, label: s.wordTabOccurrences },
    ],
    [s, isArabicMode]
  );

  const handleClose = useCallback(() => {
    closeDetail();
    setActiveTab("meaning");
  }, [closeDetail]);

  if (!detailWord) return null;

  const { surah, ayah, wordPos } = detailWord;

  return (
    <Modal visible={!!detailWord} transparent animationType="slide">
      <Pressable
        className="flex-1"
        style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
        onPress={handleClose}
      >
        <View className="flex-1" />
        <Pressable
          className="bg-surface dark:bg-surface-dark-low rounded-t-4xl"
          style={{ maxHeight: "75%" }}
          onPress={() => {}}
        >
          {/* Drag handle */}
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1 rounded-full bg-surface-high dark:bg-surface-dark-high" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-6 pt-3 pb-4">
            <View className="flex-row items-center gap-3">
              <View className="bg-primary-accent/10 dark:bg-primary-bright/10 rounded-full px-3.5 py-1.5">
                <Text
                  className="text-primary-accent dark:text-primary-bright"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
                >
                  {surah}:{ayah}:{wordPos}
                </Text>
              </View>
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
          <ScrollView className="px-6" style={{ maxHeight: 400 }}>
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

          <View style={{ height: 24 }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
