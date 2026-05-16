import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import { BookOpenText, Bookmark, MessageCircle, Pause, Play, Share2 } from "lucide-react-native";
import { ReflectionsSection } from "@/components/reflections/ReflectionsSection";
import { QiraatTab } from "@/components/mushaf/word-tabs/QiraatTab";
import { HadithTab } from "@/components/mushaf/ayah-tabs/HadithTab";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { isQpcFontLoaded, loadQpcFont, qpcFontName } from "@/lib/fonts/loader";
import { useAyahAudio } from "@/lib/audio/ayah-audio";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { formatForCopy } from "@/lib/selection/format";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
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
  text_uthmani: string;
  text_qcf2: string;
  v2_page: number;
  surah_name_arabic: string;
  surah_name_english: string;
};

type TabKey = "translation" | "tafsir" | "hadith" | "qiraat" | "reflections";

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
    translationLanguage,
    tafseerSource,
    uiLanguage,
    isRTL,
    isDark,
  } = useSettings();
  const { isBookmarked, showToast, refreshBookmarks } = useSelection();
  const { getAyahState, toggleAyah } = useAyahAudio();
  const [ayahRow, setAyahRow] = useState<AyahRow | null>(null);
  const [fontVisible, setFontVisible] = useState(false);
  const [translationText, setTranslationText] = useState<string | null>(null);
  const [tafseerText, setTafseerText] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  const open = target !== null;
  const showTranslation = open && uiLanguage !== "ar";
  const langInfo = getLanguageByCode(translationLanguage);
  const translationIsRtl = langInfo?.direction === "rtl";
  const bookmarked = target ? isBookmarked(target.surah, target.ayah) : false;
  const iconColor = isDark ? "#a3a3a3" : "#8B8178";
  const audioState = target
    ? getAyahState(target.surah, target.ayah)
    : { active: false, playing: false, loading: false };
  const audioIconColor = audioState.active ? "#0d9488" : iconColor;
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 720);
  const surfaceColor = isDark ? "#0A0A0A" : "#FFF8F1";
  const qcf2Tokens = ayahRow?.text_qcf2.split(" ").filter(Boolean) ?? [];
  const qcf2FontFamily = ayahRow ? qpcFontName(ayahRow.v2_page) : undefined;
  const title = ayahRow
    ? (uiLanguage === "ar" ? ayahRow.surah_name_arabic : ayahRow.surah_name_english)
    : `${target?.surah ?? ""}:${target?.ayah ?? ""}`;
  const subtitle = target ? `${target.surah}:${target.ayah}` : undefined;

  useEffect(() => {
    setActiveTab(initialTab);
    setAyahRow(null);
    setFontVisible(false);
    setTranslationText(null);
    setTafseerText(null);
  }, [target?.surah, target?.ayah, initialTab]);

  useEffect(() => {
    if (!showTranslation && activeTab === "translation") {
      setActiveTab("tafsir");
    }
  }, [activeTab, showTranslation]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    db.getFirstAsync<AyahRow>(
      `SELECT q.text_uthmani, q.text_qcf2, q.v2_page, s.name_arabic AS surah_name_arabic, s.name_english AS surah_name_english
       FROM quran_text q
       JOIN surahs s ON s.number = q.surah
       WHERE q.surah = ? AND q.ayah = ?`,
      [target.surah, target.ayah]
    ).then((row) => {
      if (!cancelled) setAyahRow(row ?? null);
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [db, target]);

  useEffect(() => {
    if (!ayahRow) return;
    if (isQpcFontLoaded(ayahRow.v2_page)) {
      setFontVisible(true);
      return;
    }
    let cancelled = false;
    loadQpcFont(ayahRow.v2_page).then(() => {
      if (!cancelled) requestAnimationFrame(() => setFontVisible(true));
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [ayahRow]);

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

  const handleAudioPress = useCallback(async () => {
    if (!target) return;
    const result = await toggleAyah(target.surah, target.ayah);
    if (!result.ok) {
      showToast(s.audioUnavailable);
    }
  }, [target?.surah, target?.ayah, toggleAyah, showToast, s.audioUnavailable]);

  if (!target) return null;

  const tabs: Array<{ key: TabKey; label: string; icon: ReactNode }> = [
    ...(showTranslation
      ? [{
          key: "translation" as TabKey,
          label: langInfo?.nameEnglish ?? s.wordTranslation,
          icon: <BookOpenText size={15} color={activeTab === "translation" ? "#0d9488" : iconColor} />,
        }]
      : []),
    { key: "tafsir", label: s.tafseer, icon: <BookOpenText size={15} color={activeTab === "tafsir" ? "#0d9488" : iconColor} /> },
    { key: "hadith", label: s.ayahTabHadith, icon: <BookOpenText size={15} color={activeTab === "hadith" ? "#0d9488" : iconColor} /> },
    { key: "qiraat", label: s.wordTabQiraat, icon: <BookOpenText size={15} color={activeTab === "qiraat" ? "#0d9488" : iconColor} /> },
    { key: "reflections", label: s.reflections, icon: <MessageCircle size={15} color={activeTab === "reflections" ? "#0d9488" : iconColor} /> },
  ];

  return (
    <ResponsiveSheet
      open={open}
      onClose={onClose}
      maxWidth={1080}
      maxHeight={maxOverlayHeight}
      surfaceColor={surfaceColor}
    >
      <OverlayHeader
        title={title}
        subtitle={subtitle}
        isRTL={isRTL}
        onClose={onClose}
        showHandle={isPhone}
        actions={
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
              {bookmarked && <View className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-gold" />}
            </Pressable>
            <ActionIcon
              icon={
                audioState.loading ? (
                  <ActivityIndicator size="small" color={audioIconColor} />
                ) : audioState.playing ? (
                  <Pause size={15} color={audioIconColor} />
                ) : (
                  <Play size={15} color={audioIconColor} />
                )
              }
              onPress={handleAudioPress}
              disabled={audioState.loading}
              accessibilityLabel={audioState.loading ? s.audioLoading : audioState.playing ? s.audioPause : s.audioPlay}
            />
            <ActionIcon
              icon={<Bookmark size={15} color={bookmarked ? "#FDDC91" : iconColor} fill={bookmarked ? "#FDDC91" : "none"} />}
              onPress={handleBookmark}
            />
            <ActionIcon icon={<Share2 size={15} color={iconColor} />} onPress={handleShare} />
          </View>
        }
      />

      <OverlayBody contentContainerStyle={{ padding: 20 }}>
        <View className="min-h-[104px] justify-center rounded-3xl bg-surface-low dark:bg-surface-dark-low px-4 py-4">
          {!fontVisible ? (
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{
                fontFamily: "Manrope_500Medium",
                fontSize: 13,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.loading}
            </Text>
          ) : null}
          <View
            className="items-end"
            style={{
              opacity: fontVisible ? 1 : 0,
              direction: "ltr",
            }}
          >
            <View
              className="self-end"
              style={{
                direction: "ltr",
                flexDirection: "row-reverse",
                flexWrap: "wrap",
                justifyContent: "flex-start",
                alignItems: "center",
                gap: 2,
                maxWidth: "100%",
              }}
            >
              {qcf2Tokens.map((glyph, index) => (
                <Text
                  key={`${target.surah}-${target.ayah}-${index}`}
                  className="text-charcoal dark:text-neutral-100"
                  style={{
                    fontFamily: qcf2FontFamily,
                    fontSize: isPhone ? 30 : 36,
                    lineHeight: isPhone ? 58 : 66,
                    paddingHorizontal: 2,
                  }}
                >
                  {glyph}
                </Text>
              ))}
            </View>
          </View>
        </View>

        <View className={isRTL ? "mt-4 flex-row-reverse flex-wrap gap-2" : "mt-4 flex-row flex-wrap gap-2"}>
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
          {activeTab === "hadith" && <HadithTab surah={target.surah} ayah={target.ayah} />}
          {activeTab === "qiraat" && <QiraatTab surah={target.surah} ayah={target.ayah} />}
          {activeTab === "reflections" && (
            <ReflectionsSection surah={target.surah} ayah={target.ayah} initiallyExpanded showHeader={false} />
          )}
        </View>
      </OverlayBody>
    </ResponsiveSheet>
  );
}

function ActionIcon({
  icon,
  onPress,
  disabled = false,
  accessibilityLabel,
}: {
  icon: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
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
