import { useState, useCallback } from "react";
import { View, Text, Modal, Pressable, ScrollView } from "react-native";
import { X } from "lucide-react-native";
import { useWordInteraction } from "@/lib/word/context";
import { qpcFontName } from "@/lib/fonts/loader";
import { useStrings } from "@/lib/i18n/useStrings";
import { EnglishTab } from "./word-tabs/EnglishTab";
import { MeaningTab } from "./word-tabs/MeaningTab";
import { IrabTab } from "./word-tabs/IrabTab";
import { TasreefTab } from "./word-tabs/TasreefTab";
import { TajweedTab } from "./word-tabs/TajweedTab";
import { QiraatTab } from "./word-tabs/QiraatTab";
import { OccurrencesTab } from "./word-tabs/OccurrencesTab";

const TAB_KEYS = ["english", "meaning", "irab", "tasreef", "tajweed", "qiraat", "occurrences"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export function WordDetailSheet() {
  const { detailWord, closeDetail } = useWordInteraction();
  const s = useStrings();
  const [activeTab, setActiveTab] = useState<TabKey>("english");

  const TABS = [
    { key: "english" as TabKey, label: s.wordTabEnglish },
    { key: "meaning" as TabKey, label: "المعنى" },
    { key: "irab" as TabKey, label: "الإعراب" },
    { key: "tasreef" as TabKey, label: "التصريف" },
    { key: "tajweed" as TabKey, label: "التجويد" },
    { key: "qiraat" as TabKey, label: "القراءات" },
    { key: "occurrences" as TabKey, label: "المواضع" },
  ];

  const handleClose = useCallback(() => {
    closeDetail();
    setActiveTab("english");
  }, [closeDetail]);

  if (!detailWord) return null;

  const { surah, ayah, wordPos, v2Page } = detailWord;

  return (
    <Modal visible={!!detailWord} transparent animationType="slide">
      <Pressable className="flex-1 bg-black/50" onPress={handleClose}>
        <View className="flex-1" />
        <Pressable
          className="bg-warm-50 dark:bg-neutral-900 rounded-t-3xl"
          style={{ maxHeight: "75%" }}
          onPress={() => {}}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
            <View className="flex-row items-center gap-3">
              <View className="bg-teal-50 dark:bg-teal-900/40 rounded-full px-3 py-1 border border-teal-200 dark:border-teal-700">
                <Text className="text-teal-700 dark:text-teal-300 text-xs font-semibold">
                  {surah}:{ayah}:{wordPos}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={handleClose}
              className="w-8 h-8 rounded-full bg-warm-100 dark:bg-neutral-800 items-center justify-center"
            >
              <X size={16} className="text-warm-600 dark:text-neutral-400" />
            </Pressable>
          </View>

          {/* Tab bar */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="border-b border-warm-100 dark:border-neutral-800"
            contentContainerStyle={{ paddingHorizontal: 16 }}
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  className="mr-1"
                  style={{ paddingHorizontal: 12, paddingVertical: 10 }}
                >
                  <Text
                    className={
                      isActive
                        ? "text-sm font-semibold text-teal-600 dark:text-teal-400"
                        : "text-sm text-warm-400 dark:text-neutral-500"
                    }
                  >
                    {tab.label}
                  </Text>
                  {isActive && (
                    <View
                      className="bg-teal-500"
                      style={{
                        height: 2,
                        borderRadius: 1,
                        marginTop: 6,
                      }}
                    />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Tab content */}
          <ScrollView className="px-5" style={{ maxHeight: 400 }}>
            {activeTab === "english" && (
              <EnglishTab surah={surah} ayah={ayah} wordPos={wordPos} />
            )}
            {activeTab === "meaning" && (
              <MeaningTab surah={surah} ayah={ayah} wordPos={wordPos} />
            )}
            {activeTab === "irab" && (
              <IrabTab surah={surah} ayah={ayah} wordPos={wordPos} />
            )}
            {activeTab === "tasreef" && (
              <TasreefTab surah={surah} ayah={ayah} wordPos={wordPos} />
            )}
            {activeTab === "tajweed" && (
              <TajweedTab surah={surah} ayah={ayah} wordPos={wordPos} />
            )}
            {activeTab === "qiraat" && <QiraatTab />}
            {activeTab === "occurrences" && (
              <OccurrencesTab surah={surah} ayah={ayah} wordPos={wordPos} />
            )}
          </ScrollView>

          {/* Bottom safe area padding */}
          <View style={{ height: 20 }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
