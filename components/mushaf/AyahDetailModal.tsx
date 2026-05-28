import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import { BookOpenText, Bookmark, ChevronLeft, ChevronRight, MessageCircle, NotebookPen, Pause, Play, Share2 } from "lucide-react-native";
import { ReflectionsSection } from "@/components/reflections/ReflectionsSection";
import { QiraatTab } from "@/components/mushaf/word-tabs/QiraatTab";
import { HadithTab } from "@/components/mushaf/ayah-tabs/HadithTab";
import { PrivateNotesSection } from "@/components/notes/PrivateNotesSection";
import { TafsirSourcePicker } from "@/components/settings/TafsirSourcePicker";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import {
  isQuranPageFontLoaded,
  loadQuranPageFont,
  quranPageFontName,
  quranPageFontPaletteStyle,
} from "@/lib/fonts/loader";
import { useAyahAudio } from "@/lib/audio/ayah-audio";
import { ensureTafsirSourceImported } from "@/lib/database/init";
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
import { AVAILABLE_TAFSIR_SOURCES, type TafsirSourceId } from "@/lib/tafsir/sources";
import { DEFAULT_LANGUAGE, getLanguageByCode } from "@/lib/translations/languages";

type TargetAyah = {
  surah: number;
  ayah: number;
};

type AdjacentAyahs = {
  previous: TargetAyah | null;
  next: TargetAyah | null;
};

type AyahRow = {
  text_uthmani: string;
  text_qcf2: string;
  v2_page: number;
  surah_name_arabic: string;
  surah_name_english: string;
};

type TafsirRow = {
  source: TafsirSourceId;
  text: string;
};

export type AyahDetailTabKey = "translation" | "tafsir" | "hadith" | "qiraat" | "notes" | "reflections";

type Props = {
  target: TargetAyah | null;
  onClose: () => void;
  initialTab?: AyahDetailTabKey;
};

export function AyahDetailModal({ target, onClose, initialTab = "tafsir" }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { width, height } = useWindowDimensions();
  const {
    translationLanguage,
    recitationId,
    uiLanguage,
    isRTL,
    isDark,
    quranFontStyle,
    effectiveTheme,
    tafseerSource,
    setTafseerSource,
  } = useSettings();
  const { isBookmarked, showToast, refreshBookmarks } = useSelection();
  const { getAyahState, toggleAyah } = useAyahAudio();
  const [ayahRow, setAyahRow] = useState<AyahRow | null>(null);
  const [fontVisible, setFontVisible] = useState(false);
  const [translationText, setTranslationText] = useState<string | null>(null);
  const [tafsirRows, setTafsirRows] = useState<TafsirRow[] | null>(null);
  const [selectedTafsirSource, setSelectedTafsirSource] = useState<TafsirSourceId>(tafseerSource);
  const [tafsirPickerVisible, setTafsirPickerVisible] = useState(false);
  const [importingTafsirSource, setImportingTafsirSource] = useState<TafsirSourceId | null>(null);
  const [tafsirReloadKey, setTafsirReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<AyahDetailTabKey>(initialTab);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [currentTarget, setCurrentTarget] = useState<TargetAyah | null>(target);
  const [adjacentAyahs, setAdjacentAyahs] = useState<AdjacentAyahs>({ previous: null, next: null });

  const activeTarget = target ? currentTarget ?? target : null;
  const open = activeTarget !== null;
  const showTranslation = open && uiLanguage !== "ar";
  const langInfo = getLanguageByCode(translationLanguage);
  const translationIsRtl = langInfo?.direction === "rtl";
  const bookmarked = activeTarget ? isBookmarked(activeTarget.surah, activeTarget.ayah) : false;
  const iconColor = isDark ? "#a3a3a3" : "#8B8178";
  const audioState = activeTarget
    ? getAyahState(activeTarget.surah, activeTarget.ayah, recitationId)
    : { active: false, playing: false, loading: false };
  const audioIconColor = audioState.active ? "#0d9488" : iconColor;
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 720);
  const qcf2Tokens = ayahRow?.text_qcf2.split(" ").filter(Boolean) ?? [];
  const qcf2FontFamily = ayahRow ? quranPageFontName(quranFontStyle, ayahRow.v2_page) : undefined;
  const qcf2FontPaletteStyle = ayahRow
    ? quranPageFontPaletteStyle(quranFontStyle, ayahRow.v2_page, effectiveTheme)
    : null;
  const selectedTafsir = tafsirRows?.find((row) => row.source === selectedTafsirSource) ?? tafsirRows?.[0] ?? null;
  const selectedTafsirIsRtl = selectedTafsir?.source !== "jalalayn-en";
  const title = ayahRow
    ? (uiLanguage === "ar" ? ayahRow.surah_name_arabic : ayahRow.surah_name_english)
    : `${activeTarget?.surah ?? ""}:${activeTarget?.ayah ?? ""}`;
  const subtitle = activeTarget ? `${activeTarget.surah}:${activeTarget.ayah}` : undefined;
  const tafsirSourceConfigs = useMemo(() => {
    const rowsBySource = new Set((tafsirRows ?? []).map((row) => row.source));
    return AVAILABLE_TAFSIR_SOURCES.filter((source) => rowsBySource.has(source.id));
  }, [tafsirRows]);

  useEffect(() => {
    setCurrentTarget(target);
    setActiveTab(initialTab);
  }, [target?.surah, target?.ayah, initialTab]);

  useEffect(() => {
    setAyahRow(null);
    setFontVisible(false);
    setTranslationText(null);
    setTafsirRows(null);
  }, [activeTarget?.surah, activeTarget?.ayah]);

  useEffect(() => {
    if (!activeTarget) {
      setAdjacentAyahs({ previous: null, next: null });
      return;
    }
    let cancelled = false;
    Promise.all([
      db.getFirstAsync<TargetAyah>(
        `SELECT surah, ayah
         FROM quran_text
         WHERE surah < ? OR (surah = ? AND ayah < ?)
         ORDER BY surah DESC, ayah DESC
         LIMIT 1`,
        [activeTarget.surah, activeTarget.surah, activeTarget.ayah]
      ),
      db.getFirstAsync<TargetAyah>(
        `SELECT surah, ayah
         FROM quran_text
         WHERE surah > ? OR (surah = ? AND ayah > ?)
         ORDER BY surah, ayah
         LIMIT 1`,
        [activeTarget.surah, activeTarget.surah, activeTarget.ayah]
      ),
    ]).then(([previous, next]) => {
      if (!cancelled) setAdjacentAyahs({ previous: previous ?? null, next: next ?? null });
    }).catch(() => {
      if (!cancelled) setAdjacentAyahs({ previous: null, next: null });
    });
    return () => {
      cancelled = true;
    };
  }, [db, activeTarget?.surah, activeTarget?.ayah]);

  useEffect(() => {
    setSelectedTafsirSource(tafseerSource);
  }, [tafseerSource]);

  useEffect(() => {
    if (!showTranslation && activeTab === "translation") {
      setActiveTab("tafsir");
    }
  }, [activeTab, showTranslation]);

  useEffect(() => {
    if (!activeTarget) return;
    let cancelled = false;
    db.getFirstAsync<AyahRow>(
      `SELECT q.text_uthmani, q.text_qcf2, q.v2_page, s.name_arabic AS surah_name_arabic, s.name_english AS surah_name_english
       FROM quran_text q
       JOIN surahs s ON s.number = q.surah
       WHERE q.surah = ? AND q.ayah = ?`,
      [activeTarget.surah, activeTarget.ayah]
    ).then((row) => {
      if (!cancelled) setAyahRow(row ?? null);
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [db, activeTarget?.surah, activeTarget?.ayah]);

  useEffect(() => {
    if (!ayahRow) return;
    setFontVisible(false);
    if (isQuranPageFontLoaded(quranFontStyle, ayahRow.v2_page)) {
      requestAnimationFrame(() => setFontVisible(true));
      return;
    }
    let cancelled = false;
    loadQuranPageFont(quranFontStyle, ayahRow.v2_page).then(() => {
      if (!cancelled) requestAnimationFrame(() => setFontVisible(true));
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [ayahRow, quranFontStyle]);

  useEffect(() => {
    if (!activeTarget || !showTranslation) return;
    setTranslationText(null);
    const query =
      translationLanguage === DEFAULT_LANGUAGE
        ? db.getFirstAsync<{ text_en: string }>(
            "SELECT text_en FROM translations WHERE surah = ? AND ayah = ?",
            [activeTarget.surah, activeTarget.ayah]
          ).then((row) => row?.text_en ?? "")
        : db.getFirstAsync<{ text: string }>(
            "SELECT text FROM translation_active WHERE surah = ? AND ayah = ?",
            [activeTarget.surah, activeTarget.ayah]
          ).then((row) => row?.text ?? "");

    let cancelled = false;
    query.then((text) => {
      if (!cancelled) setTranslationText(text);
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [db, activeTarget?.surah, activeTarget?.ayah, showTranslation, translationLanguage]);

  useEffect(() => {
    if (!activeTarget) return;
    setTafsirRows(null);
    let cancelled = false;
    db.getAllAsync<{ source: string; text: string }>(
      "SELECT source, text FROM tafseer WHERE surah = ? AND ayah = ?",
      [activeTarget.surah, activeTarget.ayah]
    ).then((row) => {
      if (cancelled) return;
      const rowsBySource = new Map(row.map((item) => [item.source, item.text]));
      const orderedRows = AVAILABLE_TAFSIR_SOURCES.flatMap<TafsirRow>((source) => {
        const text = rowsBySource.get(source.id)?.trim();
        return text ? [{ source: source.id, text }] : [];
      });
      setTafsirRows(orderedRows);
      setSelectedTafsirSource((currentSource) => (
        orderedRows.some((item) => item.source === currentSource)
          ? currentSource
          : orderedRows.some((item) => item.source === tafseerSource)
            ? tafseerSource
            : orderedRows[0]?.source ?? tafseerSource
      ));
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [db, activeTarget?.surah, activeTarget?.ayah, tafseerSource, tafsirReloadKey]);

  const handleBookmark = useCallback(async () => {
    if (!activeTarget || bookmarkBusy) return;
    setBookmarkBusy(true);
    try {
      if (bookmarked) {
        await dbRemoveBookmark(db, activeTarget.surah, activeTarget.ayah);
        showToast(s.bookmarkRemoved);
      } else {
        await dbAddBookmark(db, activeTarget.surah, activeTarget.ayah);
        showToast(s.bookmarkAdded);
      }
      await refreshBookmarks();
    } catch (e) {
      console.warn("[AyahDetailModal] Failed to toggle bookmark:", e);
      showToast(s.bookmarkActionFailed);
    } finally {
      setBookmarkBusy(false);
    }
  }, [bookmarkBusy, bookmarked, db, activeTarget?.surah, activeTarget?.ayah, showToast, s.bookmarkAdded, s.bookmarkRemoved, s.bookmarkActionFailed, refreshBookmarks]);

  const handleShare = useCallback(async () => {
    if (!activeTarget || !ayahRow || shareBusy) return;
    setShareBusy(true);
    try {
      const surahName = await fetchSurahName(db, activeTarget.surah);
      await Clipboard.setStringAsync(
        formatForCopy(ayahRow.text_uthmani, surahName, activeTarget.surah, activeTarget.ayah, activeTarget.ayah)
      );
      showToast(s.copied);
    } catch (e) {
      console.warn("[AyahDetailModal] Failed to copy share text:", e);
      showToast(s.copyFailed);
    } finally {
      setShareBusy(false);
    }
  }, [ayahRow, shareBusy, db, activeTarget?.surah, activeTarget?.ayah, showToast, s.copied, s.copyFailed]);

  const handleAudioPress = useCallback(async () => {
    if (!activeTarget) return;
    const result = await toggleAyah(activeTarget.surah, activeTarget.ayah, recitationId);
    if (!result.ok) {
      showToast(result.code === "not_configured" ? s.qfContentMisconfigured : s.qfContentUnavailable);
    }
  }, [activeTarget?.surah, activeTarget?.ayah, recitationId, toggleAyah, showToast, s.qfContentMisconfigured, s.qfContentUnavailable]);

  const handleNavigateAyah = useCallback((direction: "previous" | "next") => {
    const nextTarget = adjacentAyahs[direction];
    if (!nextTarget) return;
    setCurrentTarget(nextTarget);
  }, [adjacentAyahs]);

  const handleTafsirSourceSelect = useCallback(
    async (sourceId: TafsirSourceId) => {
      if (importingTafsirSource) return false;
      if (sourceId === selectedTafsirSource && tafsirRows?.some((row) => row.source === sourceId)) return true;

      setImportingTafsirSource(sourceId);
      try {
        await ensureTafsirSourceImported(db, sourceId);
        setTafseerSource(sourceId);
        setSelectedTafsirSource(sourceId);
        setTafsirReloadKey((value) => value + 1);
        return true;
      } catch (err) {
        console.warn("[AyahDetailModal] Failed to import tafsir source:", err);
        showToast(s.tafseerSourceImportFailed);
        return false;
      } finally {
        setImportingTafsirSource(null);
      }
    },
    [
      db,
      importingTafsirSource,
      s.tafseerSourceImportFailed,
      selectedTafsirSource,
      setTafseerSource,
      showToast,
      tafsirRows,
    ]
  );

  if (!activeTarget) return null;

  const tabs: Array<{ key: AyahDetailTabKey; label: string; icon: ReactNode }> = [
    ...(showTranslation
      ? [{
          key: "translation" as AyahDetailTabKey,
          label: langInfo?.nameEnglish ?? s.wordTranslation,
          icon: <BookOpenText size={15} color={activeTab === "translation" ? "#0d9488" : iconColor} />,
        }]
      : []),
    { key: "tafsir", label: s.tafseer, icon: <BookOpenText size={15} color={activeTab === "tafsir" ? "#0d9488" : iconColor} /> },
    { key: "hadith", label: s.ayahTabHadith, icon: <BookOpenText size={15} color={activeTab === "hadith" ? "#0d9488" : iconColor} /> },
    { key: "qiraat", label: s.wordTabQiraat, icon: <BookOpenText size={15} color={activeTab === "qiraat" ? "#0d9488" : iconColor} /> },
    { key: "notes", label: s.privateNotes, icon: <NotebookPen size={15} color={activeTab === "notes" ? "#0d9488" : iconColor} /> },
    { key: "reflections", label: s.reflections, icon: <MessageCircle size={15} color={activeTab === "reflections" ? "#0d9488" : iconColor} /> },
  ];

  return (
    <>
      <ResponsiveSheet
        open={open}
        onClose={onClose}
        maxWidth={1080}
        maxHeight={maxOverlayHeight}
      >
      <OverlayHeader
        title={title}
        subtitle={subtitle}
        isRTL={isRTL}
        onClose={onClose}
        showHandle={isPhone}
        actions={
          <View className={isRTL ? "flex-row-reverse items-center gap-1.5" : "flex-row items-center gap-1.5"}>
            <ActionIcon
              icon={isRTL ? <ChevronRight size={15} color={iconColor} /> : <ChevronLeft size={15} color={iconColor} />}
              onPress={() => handleNavigateAyah("previous")}
              disabled={!adjacentAyahs.previous}
              accessibilityLabel={s.previousAyah}
            />
            <ActionIcon
              icon={isRTL ? <ChevronLeft size={15} color={iconColor} /> : <ChevronRight size={15} color={iconColor} />}
              onPress={() => handleNavigateAyah("next")}
              disabled={!adjacentAyahs.next}
              accessibilityLabel={s.nextAyah}
            />
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
                {activeTarget.surah}:{activeTarget.ayah}
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
              icon={
                bookmarkBusy ? (
                  <ActivityIndicator size="small" color={iconColor} />
                ) : (
                  <Bookmark size={15} color={bookmarked ? "#FDDC91" : iconColor} fill={bookmarked ? "#FDDC91" : "none"} />
                )
              }
              onPress={handleBookmark}
              disabled={bookmarkBusy}
            />
            <ActionIcon
              icon={shareBusy ? <ActivityIndicator size="small" color={iconColor} /> : <Share2 size={15} color={iconColor} />}
              onPress={handleShare}
              disabled={shareBusy}
            />
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
                  key={`${activeTarget.surah}-${activeTarget.ayah}-${index}`}
                  className="text-charcoal dark:text-neutral-100"
                  style={{
                    fontFamily: qcf2FontFamily,
                    ...qcf2FontPaletteStyle,
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

        <View
          className="mt-4 flex-row flex-wrap gap-2"
          style={{ direction: isRTL ? "rtl" : "ltr", justifyContent: "flex-start" }}
        >
          {tabs.map((tab) => (
            <TabButton
              key={tab.key}
              label={tab.label}
              icon={tab.icon}
              active={activeTab === tab.key}
              isRTL={isRTL}
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
            <View className="gap-3">
              <View
                className="items-center justify-between gap-3"
                style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
              >
                <View className="min-w-0 flex-1">
                  <Text
                    className="text-charcoal dark:text-neutral-200"
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      fontSize: 13,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {s.tafseerSourceLabel}
                  </Text>
                  <Text
                    className="mt-0.5 text-warm-400 dark:text-neutral-500"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 12,
                      lineHeight: 18,
                      textAlign: isRTL ? "right" : "left",
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {s.tafseerPanelDownloadHint}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setTafsirPickerVisible(true)}
                  disabled={!!importingTafsirSource}
                  accessibilityRole="button"
                  accessibilityLabel={s.tafseerManageSources}
                  className={isRTL ? "flex-row-reverse items-center gap-1.5 rounded-full bg-surface dark:bg-surface-dark px-3 py-2" : "flex-row items-center gap-1.5 rounded-full bg-surface dark:bg-surface-dark px-3 py-2"}
                  style={({ pressed }) => ({
                    opacity: importingTafsirSource ? 0.72 : pressed ? 0.78 : 1,
                    cursor: Platform.OS === "web" ? (importingTafsirSource ? "auto" : "pointer") : undefined,
                  })}
                >
                  {importingTafsirSource ? (
                    <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
                  ) : (
                    <BookOpenText size={14} color={isDark ? "#2dd4bf" : "#0d9488"} />
                  )}
                  <Text
                    className="text-primary-accent dark:text-primary-bright"
                    numberOfLines={1}
                    style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, writingDirection: isRTL ? "rtl" : "ltr" }}
                  >
                    {s.tafseerManageSources}
                  </Text>
                </Pressable>
              </View>

              {tafsirRows === null ? (
                <Text
                  className="text-warm-700 dark:text-neutral-300"
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: 15,
                    lineHeight: 26,
                    writingDirection: isRTL ? "rtl" : "ltr",
                    textAlign: isRTL ? "right" : "left",
                  }}
                >
                  {s.loading}
                </Text>
              ) : tafsirRows.length === 0 ? (
                <Text
                  className="text-warm-700 dark:text-neutral-300"
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: 15,
                    lineHeight: 26,
                    writingDirection: isRTL ? "rtl" : "ltr",
                    textAlign: isRTL ? "right" : "left",
                  }}
                >
                  {s.noTafseerData}
                </Text>
              ) : (
                <View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ direction: isRTL ? "rtl" : "ltr" }}
                    contentContainerStyle={{
                      gap: 8,
                      paddingBottom: 12,
                      flexDirection: "row",
                      direction: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {tafsirSourceConfigs.map((source) => (
                      <TafsirSourceButton
                        key={source.id}
                        label={s[source.labelKey] ?? source.id}
                        active={selectedTafsirSource === source.id}
                        onPress={() => setSelectedTafsirSource(source.id)}
                      />
                    ))}
                  </ScrollView>
                  <Text
                    className="text-warm-700 dark:text-neutral-300"
                    style={{
                      fontFamily: "Manrope_400Regular",
                      fontSize: 15,
                      lineHeight: 26,
                      writingDirection: selectedTafsirIsRtl ? "rtl" : "ltr",
                      textAlign: selectedTafsirIsRtl ? "right" : "left",
                    }}
                  >
                    {selectedTafsir?.text ?? s.noTafseerData}
                  </Text>
                </View>
              )}
            </View>
          )}
          {activeTab === "hadith" && <HadithTab surah={activeTarget.surah} ayah={activeTarget.ayah} />}
          {activeTab === "qiraat" && <QiraatTab surah={activeTarget.surah} ayah={activeTarget.ayah} />}
          {activeTab === "notes" && <PrivateNotesSection surah={activeTarget.surah} ayah={activeTarget.ayah} />}
          {activeTab === "reflections" && (
            <ReflectionsSection surah={activeTarget.surah} ayah={activeTarget.ayah} initiallyExpanded showHeader={false} />
          )}
        </View>
      </OverlayBody>
      </ResponsiveSheet>
      <TafsirSourcePicker
        visible={tafsirPickerVisible}
        selectedSource={selectedTafsirSource}
        importingSource={importingTafsirSource}
        onSelect={handleTafsirSourceSelect}
        onClose={() => setTafsirPickerVisible(false)}
        helperText={s.tafseerDownloadHint}
      />
    </>
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
  isRTL,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  isRTL: boolean;
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
      style={{
        direction: isRTL ? "rtl" : "ltr",
        cursor: Platform.OS === "web" ? "pointer" : undefined,
      }}
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

function TafsirSourceButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={`rounded-full px-3 py-2 ${
        active
          ? "bg-primary-accent/10 dark:bg-primary-bright/10"
          : "bg-surface dark:bg-surface-dark"
      }`}
      style={{ cursor: Platform.OS === "web" ? "pointer" : undefined }}
    >
      <Text
        className={active ? "text-primary-accent dark:text-primary-bright" : "text-warm-500 dark:text-neutral-400"}
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
