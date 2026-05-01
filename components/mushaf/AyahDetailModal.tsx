import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import { BookOpenText, Bookmark, MessageCircle, Play, Share2, X } from "lucide-react-native";
import { ReflectionsSection } from "@/components/reflections/ReflectionsSection";
import { QiraatTab } from "@/components/mushaf/word-tabs/QiraatTab";
import { useDatabase } from "@/lib/database/provider";
import { isQpcFontLoaded, loadQpcFont, qpcFontName } from "@/lib/fonts/loader";
import { useStrings } from "@/lib/i18n/useStrings";
import { formatForCopy } from "@/lib/selection/format";
import {
  addBookmark as dbAddBookmark,
  fetchSurahName,
  removeBookmark as dbRemoveBookmark,
} from "@/lib/selection/queries";
import { useSelection } from "@/lib/selection/context";
import { useSettings } from "@/lib/settings/context";
import { DEFAULT_LANGUAGE, getLanguageByCode } from "@/lib/translations/languages";

type TargetAyah = {
  surah: number;
  ayah: number;
};

type AyahRow = {
  text_qcf2: string;
  text_uthmani: string;
  v2_page: number;
};

type TabKey = "translation" | "tafsir" | "qiraat" | "reflections";

type Props = {
  target: TargetAyah | null;
  onClose: () => void;
  initialTab?: TabKey;
};

export function AyahDetailModal({ target, onClose, initialTab = "tafsir" }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { width, height } = useWindowDimensions();
  const {
    fontSize,
    lineHeight,
    translationLanguage,
    tafseerSource,
    uiLanguage,
    isRTL,
    isDark,
  } = useSettings();
  const { isBookmarked, showToast, refreshBookmarks } = useSelection();
  const [ayahRow, setAyahRow] = useState<AyahRow | null>(null);
  const [translationText, setTranslationText] = useState<string | null>(null);
  const [tafseerText, setTafseerText] = useState<string | null>(null);
  const [fontVisible, setFontVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  const open = target !== null;
  const showTranslation = open && uiLanguage !== "ar";
  const langInfo = getLanguageByCode(translationLanguage);
  const translationIsRtl = langInfo?.direction === "rtl";
  const bookmarked = target ? isBookmarked(target.surah, target.ayah) : false;
  const modalWidth = Math.min(width - 32, 1080);
  const maxModalHeight = Math.min(height - 48, 720);
  const quranFontSize = Math.max(fontSize + 6, 32);
  const quranLineHeight = Math.max(lineHeight + 8, 54);
  const iconColor = isDark ? "#a3a3a3" : "#8B8178";

  useEffect(() => {
    setActiveTab(initialTab);
    setAyahRow(null);
    setTranslationText(null);
    setTafseerText(null);
    setFontVisible(false);
  }, [target?.surah, target?.ayah, initialTab]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    db.getFirstAsync<AyahRow>(
      "SELECT text_qcf2, text_uthmani, v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
      [target.surah, target.ayah]
    ).then((row) => {
      if (!cancelled) setAyahRow(row ?? null);
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [db, target]);

  useEffect(() => {
    const page = ayahRow?.v2_page;
    if (!page) return;
    if (isQpcFontLoaded(page)) {
      setFontVisible(true);
      return;
    }
    let cancelled = false;
    loadQpcFont(page).then(() => {
      if (!cancelled) requestAnimationFrame(() => setFontVisible(true));
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [ayahRow?.v2_page]);

  useEffect(() => {
    if (!target || !showTranslation) return;
    setTranslationText(null);
    const query =
      translationLanguage === DEFAULT_LANGUAGE
        ? db.getFirstAsync<{ text_en: string }>(
            "SELECT text_en FROM translations WHERE surah = ? AND ayah = ?",
            [target.surah, target.ayah]
          ).then((row) => row?.text_en ?? "")
        : db.getFirstAsync<{ text: string }>(
            "SELECT text FROM translation_active WHERE surah = ? AND ayah = ?",
            [target.surah, target.ayah]
          ).then((row) => row?.text ?? "");

    let cancelled = false;
    query.then((text) => {
      if (!cancelled) setTranslationText(text);
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [db, target, showTranslation, translationLanguage]);

  useEffect(() => {
    if (!target) return;
    setTafseerText(null);
    let cancelled = false;
    db.getFirstAsync<{ text: string }>(
      "SELECT text FROM tafseer WHERE surah = ? AND ayah = ? AND source = ?",
      [target.surah, target.ayah, tafseerSource]
    ).then((row) => {
      if (!cancelled) setTafseerText(row?.text ?? "");
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [db, target, tafseerSource]);

  const qcf2Words = useMemo(
    () => ayahRow?.text_qcf2.split(" ").filter(Boolean) ?? [],
    [ayahRow?.text_qcf2]
  );

  const handleBookmark = useCallback(async () => {
    if (!target) return;
    try {
      if (bookmarked) {
        await dbRemoveBookmark(db, target.surah, target.ayah);
        showToast(s.bookmarkRemoved);
      } else {
        await dbAddBookmark(db, target.surah, target.ayah);
        showToast(s.bookmarkAdded);
      }
      await refreshBookmarks();
    } catch (e) {
      console.warn("[AyahDetailModal] Failed to toggle bookmark:", e);
    }
  }, [bookmarked, db, target, showToast, s.bookmarkAdded, s.bookmarkRemoved, refreshBookmarks]);

  const handleShare = useCallback(async () => {
    if (!target || !ayahRow) return;
    try {
      const surahName = await fetchSurahName(db, target.surah);
      await Clipboard.setStringAsync(
        formatForCopy(ayahRow.text_uthmani, surahName, target.surah, target.ayah, target.ayah)
      );
      showToast(s.copied);
    } catch (e) {
      console.warn("[AyahDetailModal] Failed to copy share text:", e);
    }
  }, [ayahRow, db, target, showToast, s.copied]);

  if (!target) return null;

  const tabs: Array<{ key: TabKey; label: string; icon: ReactNode }> = [
    { key: "translation", label: langInfo?.nameEnglish ?? s.wordTranslation, icon: <BookOpenText size={15} color={activeTab === "translation" ? "#0d9488" : iconColor} /> },
    { key: "tafsir", label: s.tafseer, icon: <BookOpenText size={15} color={activeTab === "tafsir" ? "#0d9488" : iconColor} /> },
    { key: "qiraat", label: s.wordTabQiraat, icon: <BookOpenText size={15} color={activeTab === "qiraat" ? "#0d9488" : iconColor} /> },
    { key: "reflections", label: s.reflections, icon: <MessageCircle size={15} color={activeTab === "reflections" ? "#0d9488" : iconColor} /> },
  ];

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 items-center justify-center px-4" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
        <Pressable className="absolute inset-0" onPress={onClose} />
        <View
          className="overflow-hidden rounded-3xl bg-surface dark:bg-surface-dark"
          style={{ width: modalWidth, maxHeight: maxModalHeight }}
        >
          <View className={isRTL ? "flex-row-reverse items-center justify-between gap-3 border-b border-warm-200 dark:border-neutral-800 px-5 py-4" : "flex-row items-center justify-between gap-3 border-b border-warm-200 dark:border-neutral-800 px-5 py-4"}>
            <View className={isRTL ? "flex-row-reverse items-center gap-1.5" : "flex-row items-center gap-1.5"}>
              <Pressable
                disabled
                hitSlop={8}
                className="rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-3 py-2"
                style={{ opacity: 0.8, cursor: Platform.OS === "web" ? "auto" : undefined }}
              >
                <Text
                  className="text-primary-accent dark:text-primary-bright"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
                >
                  {target.surah}:{target.ayah}
                </Text>
                {bookmarked && (
                  <View className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-gold" />
                )}
              </Pressable>
              <ActionIcon icon={<Play size={15} color={iconColor} />} onPress={() => {}} disabled />
              <ActionIcon
                icon={<Bookmark size={15} color={bookmarked ? "#FDDC91" : iconColor} fill={bookmarked ? "#FDDC91" : "none"} />}
                onPress={handleBookmark}
              />
              <ActionIcon icon={<Share2 size={15} color={iconColor} />} onPress={handleShare} />
            </View>
            <ActionIcon icon={<X size={18} color={isDark ? "#f5f5f5" : "#1f1f1f"} />} onPress={onClose} />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>
            <View style={{ opacity: fontVisible ? 1 : 0, direction: "ltr", alignItems: "flex-end" }}>
              <View
                className="self-end"
                style={{
                  direction: "ltr",
                  flexDirection: "row-reverse",
                  flexWrap: "wrap",
                  justifyContent: "flex-start",
                  alignItems: "center",
                  gap: 4,
                  maxWidth: "100%",
                }}
              >
                {qcf2Words.map((word, index) => (
                  <Text
                    key={`${target.surah}-${target.ayah}-${index}`}
                    className="text-charcoal dark:text-neutral-100"
                    style={{
                      fontFamily: ayahRow ? qpcFontName(ayahRow.v2_page) : undefined,
                      fontSize: quranFontSize,
                      lineHeight: quranLineHeight,
                    }}
                  >
                    {word}
                  </Text>
                ))}
              </View>
            </View>

            <View className={isRTL ? "mt-5 flex-row-reverse flex-wrap gap-2" : "mt-5 flex-row flex-wrap gap-2"}>
              {tabs.map((tab) => (
                <TabButton
                  key={tab.key}
                  label={tab.label}
                  icon={tab.icon}
                  active={activeTab === tab.key}
                  onPress={() => setActiveTab(tab.key)}
                />
              ))}
            </View>

            <View className="mt-4 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-3">
              {activeTab === "translation" && (
                <Text
                  className="text-charcoal dark:text-neutral-200"
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: 16,
                    lineHeight: 26,
                    writingDirection: translationIsRtl ? "rtl" : "ltr",
                    textAlign: translationIsRtl ? "right" : "left",
                  }}
                >
                  {showTranslation ? (translationText ?? s.loading) : s.loading}
                </Text>
              )}
              {activeTab === "tafsir" && (
                <Text
                  className="text-warm-700 dark:text-neutral-300"
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: 15,
                    lineHeight: 26,
                    writingDirection: "rtl",
                    textAlign: "right",
                  }}
                >
                  {tafseerText ?? s.loading}
                </Text>
              )}
              {activeTab === "qiraat" && <QiraatTab surah={target.surah} ayah={target.ayah} />}
              {activeTab === "reflections" && (
                <ReflectionsSection surah={target.surah} ayah={target.ayah} initiallyExpanded showHeader={false} />
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ActionIcon({
  icon,
  onPress,
  disabled = false,
}: {
  icon: ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      className="h-8 w-8 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
      style={{
        opacity: disabled ? 0.45 : 1,
        cursor: Platform.OS === "web" ? (disabled ? "auto" : "pointer") : undefined,
      }}
    >
      {icon}
    </Pressable>
  );
}

function TabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-1.5 rounded-full px-3 py-2 ${
        active
          ? "bg-primary-accent/10 dark:bg-primary-bright/10"
          : "bg-surface dark:bg-surface-dark"
      }`}
      style={{ cursor: Platform.OS === "web" ? "pointer" : undefined }}
    >
      {icon}
      <Text
        className={active ? "text-primary-accent dark:text-primary-bright" : "text-warm-500 dark:text-neutral-400"}
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
