import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import {
  ArrowRight,
  ArrowLeft,
  BookOpenText,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Copy,
  Flag,
  Pause,
  Play,
  Share2,
} from "lucide-react-native";
import { useIssueReporter } from "@/components/app-update/IssueReporter";
import { formatAyahRef } from "@/lib/arabic";
import { systemConfirmsCopy } from "@/lib/clipboard-feedback";
import { ReflectionsSection } from "@/components/reflections/ReflectionsSection";
import { QiraatTab } from "@/components/mushaf/word-tabs/QiraatTab";
import { PrivateNotesSection } from "@/components/notes/PrivateNotesSection";
import { SimilarVerseComparison } from "@/components/hifz/SimilarVerseComparison";
import { TafsirSourcePicker } from "@/components/settings/TafsirSourcePicker";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { DetailTabRow } from "@/components/mushaf/DetailTabRow";
import { useDetailArrowKeys } from "@/components/mushaf/use-detail-arrow-keys";
import { useQuranPageFontReady } from "@/lib/fonts/use-quran-page-font";
import { quranPageFontName, quranPageMarkerFontPaletteStyle, quranPageFontPaletteStyle } from "@/lib/fonts/loader";
import { useAyahAudio } from "@/lib/audio/ayah-audio";
import { audioFailureMessage } from "@/lib/audio/labels";
import { isRecitationEnabled } from "@/lib/quran-foundation/config";
import { useDatabase } from "@/lib/database/provider";
import { setPendingDeepLink } from "@/lib/deep-link";
import { useSimilarAyah } from "@/lib/hifz/use-similar-markers";
import { interpolate, stringByKey, useStrings } from "@/lib/i18n/useStrings";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import {
  addBookmark as dbAddBookmark,
  buildAyahCopyText,
  removeBookmark as dbRemoveBookmark,
} from "@/lib/selection/queries";
import { useSelection } from "@/lib/selection/context";
import { useSettings } from "@/lib/settings/context";
import { isSupabaseConfigured } from "@/lib/supabase";
import { AVAILABLE_TAFSIR_SOURCES, type TafsirSourceId } from "@/lib/tafsir/sources";
import { DEFAULT_LANGUAGE, getLanguageByCode } from "@/lib/translations/languages";
import { textStartStyle } from "@/lib/ui/direction";
import { useWordInteraction } from "@/lib/word/context";
import { fetchQiraat } from "@/lib/word/queries";

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

/** A local read for one ayah. `key` ties the result to the ayah it was read for. */
type Loaded<T> = { key: string; value: T } | { key: string; failed: true };

type QiraatAvailability = "pending" | "present" | "absent" | "error";

export type AyahDetailTabKey = "similar" | "translation" | "tafsir" | "qiraat" | "notes" | "reflections";

type Props = {
  target: TargetAyah | null;
  onClose: () => void;
  /** Called after this sheet closes for a navigation, so a sheet that opened it can close too. */
  onNavigate?: () => void;
  initialTab?: AyahDetailTabKey;
};

/** Arabic tafsir and analysis text: the app's existing Arabic UI face, following system text size. */
const ARABIC_DETAIL_TEXT = {
  fontFamily: Platform.OS === "web" ? "IBMPlexSansArabic, NotoSansArabic, system-ui" : undefined,
  fontSize: 17,
  lineHeight: 30,
} as const;

function loadedValue<T>(loaded: Loaded<T> | null, key: string): T | undefined {
  return loaded && loaded.key === key && "value" in loaded ? loaded.value : undefined;
}

function loadFailed<T>(loaded: Loaded<T> | null, key: string): boolean {
  return !!loaded && loaded.key === key && "failed" in loaded;
}

function canShareText() {
  if (Platform.OS !== "web") return true;
  return typeof navigator !== "undefined" && typeof (navigator as { share?: unknown }).share === "function";
}

export function AyahDetailModal({ target, onClose, onNavigate, initialTab = "tafsir" }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { width, height } = useWindowDimensions();
  const {
    translationLanguage,
    recitationId,
    uiLanguage,
    isRTL,
    isDark,
    quranRenderFontStyle: quranFontStyle,
    showAyahMarkers,
    quranMarkerStyle,
    effectiveTheme,
    themeSurface,
    tafseerSource,
    setTafseerSource,
    markSimilarVerses,
    isLoaded: settingsLoaded,
  } = useSettings();
  const { isBookmarked, showToast, refreshBookmarks } = useSelection();
  // W14: a deliberate report carries only public context: the canonical reference and active tab/source.
  const issueReporter = useIssueReporter(showToast);
  const { getAyahState, toggleAyah } = useAyahAudio();
  const { navigateToAyah, hasReaderNavigation } = useWordInteraction();
  const [ayahRow, setAyahRow] = useState<Loaded<AyahRow | null> | null>(null);
  const [translation, setTranslation] = useState<Loaded<string> | null>(null);
  const [tafsir, setTafsir] = useState<Loaded<TafsirRow[]> | null>(null);
  const [qiraat, setQiraat] = useState<Loaded<boolean> | null>(null);
  // A source chip picked in this sheet; null follows the saved tafsir source.
  const [chipSource, setChipSource] = useState<TafsirSourceId | null>(null);
  const [tafsirPickerVisible, setTafsirPickerVisible] = useState(false);
  const [tafsirReloadKey, setTafsirReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<AyahDetailTabKey>(initialTab);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [currentTarget, setCurrentTarget] = useState<TargetAyah | null>(target);
  const [adjacentAyahs, setAdjacentAyahs] = useState<AdjacentAyahs>({ previous: null, next: null });
  const [similarWidth, setSimilarWidth] = useState<number | null>(null);
  const keyScopeRef = useRef<View>(null);

  const activeTarget = target ? (currentTarget ?? target) : null;
  const open = activeTarget !== null;
  const targetKey = activeTarget ? `${activeTarget.surah}:${activeTarget.ayah}` : "";
  const stepped =
    !!target && !!activeTarget && (target.surah !== activeTarget.surah || target.ayah !== activeTarget.ayah);
  const langInfo = getLanguageByCode(translationLanguage);
  // A chosen non-Arabic translation stays available in either interface language.
  const showTranslation = open && !!langInfo;
  const translationIsRtl = langInfo?.direction === "rtl";
  const bookmarked = activeTarget ? isBookmarked(activeTarget.surah, activeTarget.ayah) : false;
  const iconColor = isDark ? "#a3a3a3" : "#7A634D";
  const accentColor = isDark ? "#2dd4bf" : "#0f766e";
  const audioState = activeTarget
    ? getAyahState(activeTarget.surah, activeTarget.ayah, recitationId)
    : { active: false, playing: false, loading: false };
  const audioIconColor = audioState.active ? accentColor : iconColor;
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const glyphLineHeight = isPhone ? 58 : 66;
  const maxOverlayHeight = Math.min(height - (isPhone ? 12 : 48), isPhone ? height * 0.94 : 720);
  const row = loadedValue(ayahRow, targetKey) ?? null;
  const fontVisible = useQuranPageFontReady(quranFontStyle, row?.v2_page);
  const qcf2AllTokens = row?.text_qcf2.split(" ").filter(Boolean) ?? [];
  const qcf2Tokens = showAyahMarkers ? qcf2AllTokens : qcf2AllTokens.slice(0, -1);
  const qcf2FontFamily = row ? quranPageFontName(quranFontStyle, row.v2_page) : undefined;
  const qcf2FontPaletteStyle = row ? quranPageFontPaletteStyle(quranFontStyle, row.v2_page, effectiveTheme) : null;
  const qcf2MarkerFontPaletteStyle = row
    ? quranPageMarkerFontPaletteStyle(quranFontStyle, row.v2_page, effectiveTheme, quranMarkerStyle)
    : null;
  const title = row
    ? uiLanguage === "ar"
      ? row.surah_name_arabic
      : row.surah_name_english
    : `${activeTarget?.surah ?? ""}:${activeTarget?.ayah ?? ""}`;
  const subtitle = activeTarget ? formatAyahRef(isRTL, activeTarget.surah, activeTarget.ayah) : undefined;

  const tafsirKey = `${targetKey}#${tafsirReloadKey}`;
  const tafsirRows = loadedValue(tafsir, tafsirKey) ?? null;
  const tafsirFailed = loadFailed(tafsir, tafsirKey);
  const preferredSource = chipSource ?? tafseerSource;
  const shownTafsir =
    tafsirRows?.find((item) => item.source === preferredSource) ??
    tafsirRows?.find((item) => item.source === tafseerSource) ??
    tafsirRows?.[0] ??
    null;
  const shownTafsirIsRtl = shownTafsir?.source !== "jalalayn-en";
  const sourceLabel = (id: TafsirSourceId) => {
    const config = AVAILABLE_TAFSIR_SOURCES.find((source) => source.id === id);
    return config ? stringByKey(s, config.labelKey, id) : id;
  };
  const preferredMissing = !!tafsirRows && !!shownTafsir && shownTafsir.source !== preferredSource;

  // MUT-02, MUT-05: an ayah with a memorized similar verse gets a Similar verses tab, read from the
  // reader's per-page store. The tab stays while the reads are pending, so a mark that opened it on
  // this tab does not fall back to Tafsir before they finish.
  const similar = useSimilarAyah(db, activeTarget, row?.v2_page ?? null, settingsLoaded && markSimilarVerses && open);
  const showSimilar = similar.groups.length > 0 || (activeTab === "similar" && !similar.settled);
  // Qira'at appears for ayahs with known data. A failed read stays visible as an error, never as absence.
  const qiraatPresent = loadedValue(qiraat, targetKey);
  const qiraatAvailability: QiraatAvailability = loadFailed(qiraat, targetKey)
    ? "error"
    : qiraatPresent === undefined
      ? "pending"
      : qiraatPresent
        ? "present"
        : "absent";
  const showQiraat =
    qiraatAvailability === "present" ||
    qiraatAvailability === "error" ||
    (activeTab === "qiraat" && qiraatAvailability === "pending");
  const showReflections = isSupabaseConfigured();

  const tabs = useMemo(() => {
    const list: { key: AyahDetailTabKey; label: string }[] = [];
    if (showSimilar) list.push({ key: "similar", label: s.hifzSimilarTitle });
    if (showTranslation && langInfo) {
      list.push({
        key: "translation",
        label: interpolate(s.ayahDetailTranslationTab, { language: langInfo.nameEnglish }),
      });
    }
    list.push({ key: "tafsir", label: s.tafseer });
    list.push({ key: "notes", label: s.privateNotes });
    if (showQiraat) list.push({ key: "qiraat", label: s.wordTabQiraat });
    if (showReflections) list.push({ key: "reflections", label: s.reflections });
    return list;
  }, [langInfo, s, showQiraat, showReflections, showSimilar, showTranslation]);
  // A tab that is not offered for this ayah (no similar verse, no qira'at, service off) shows Tafsir.
  const shownTab: AyahDetailTabKey = tabs.some((tab) => tab.key === activeTab) ? activeTab : "tafsir";

  // Reopening, or opening on another ayah, starts from the opener's ayah and tab.
  useEffect(() => {
    setCurrentTarget(target);
    setActiveTab(initialTab);
  }, [target?.surah, target?.ayah, initialTab]);

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
        [activeTarget.surah, activeTarget.surah, activeTarget.ayah],
      ),
      db.getFirstAsync<TargetAyah>(
        `SELECT surah, ayah
         FROM quran_text
         WHERE surah > ? OR (surah = ? AND ayah > ?)
         ORDER BY surah, ayah
         LIMIT 1`,
        [activeTarget.surah, activeTarget.surah, activeTarget.ayah],
      ),
    ])
      .then(([previous, next]) => {
        if (!cancelled) setAdjacentAyahs({ previous: previous ?? null, next: next ?? null });
      })
      .catch(() => {
        if (!cancelled) setAdjacentAyahs({ previous: null, next: null });
      });
    return () => {
      cancelled = true;
    };
  }, [db, activeTarget?.surah, activeTarget?.ayah]);

  useEffect(() => {
    if (!activeTarget) return;
    const key = targetKey;
    let cancelled = false;
    db.getFirstAsync<AyahRow>(
      `SELECT q.text_uthmani, q.text_qcf2, q.v2_page, s.name_arabic AS surah_name_arabic, s.name_english AS surah_name_english
       FROM quran_text q
       JOIN surahs s ON s.number = q.surah
       WHERE q.surah = ? AND q.ayah = ?`,
      [activeTarget.surah, activeTarget.ayah],
    )
      .then((value) => {
        if (!cancelled) setAyahRow({ key, value: value ?? null });
      })
      .catch((error) => {
        console.warn("[AyahDetailModal] Failed to load ayah:", error);
        if (!cancelled) setAyahRow({ key, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [db, activeTarget?.surah, activeTarget?.ayah]);

  // Translation and tafsir are local, so both are read on open and switching tabs shows text at once.
  useEffect(() => {
    if (!activeTarget || !showTranslation) return;
    const key = targetKey;
    const query =
      translationLanguage === DEFAULT_LANGUAGE
        ? db
            .getFirstAsync<{
              text_en: string;
            }>("SELECT text_en FROM translations WHERE surah = ? AND ayah = ?", [activeTarget.surah, activeTarget.ayah])
            .then((value) => value?.text_en ?? "")
        : db
            .getFirstAsync<{
              text: string;
            }>("SELECT text FROM translation_active WHERE surah = ? AND ayah = ?", [activeTarget.surah, activeTarget.ayah])
            .then((value) => value?.text ?? "");

    let cancelled = false;
    query
      .then((text) => {
        if (!cancelled) setTranslation({ key, value: text.trim() });
      })
      .catch((error) => {
        console.warn("[AyahDetailModal] Failed to load translation:", error);
        if (!cancelled) setTranslation({ key, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [db, activeTarget?.surah, activeTarget?.ayah, showTranslation, translationLanguage]);

  useEffect(() => {
    if (!activeTarget) return;
    const key = tafsirKey;
    let cancelled = false;
    db.getAllAsync<{ source: string; text: string }>("SELECT source, text FROM tafseer WHERE surah = ? AND ayah = ?", [
      activeTarget.surah,
      activeTarget.ayah,
    ])
      .then((rows) => {
        if (cancelled) return;
        const rowsBySource = new Map(rows.map((item) => [item.source, item.text]));
        const orderedRows = AVAILABLE_TAFSIR_SOURCES.flatMap<TafsirRow>((source) => {
          const text = rowsBySource.get(source.id)?.trim();
          return text ? [{ source: source.id, text }] : [];
        });
        setTafsir({ key, value: orderedRows });
      })
      .catch((error) => {
        console.warn("[AyahDetailModal] Failed to load tafsir:", error);
        if (!cancelled) setTafsir({ key, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [db, activeTarget?.surah, activeTarget?.ayah, tafsirReloadKey]);

  useEffect(() => {
    if (!activeTarget) return;
    const key = targetKey;
    let cancelled = false;
    fetchQiraat(db, activeTarget.surah, activeTarget.ayah)
      .then((value) => {
        if (!cancelled) setQiraat({ key, value: !!value?.text?.trim() });
      })
      .catch((error) => {
        console.warn("[AyahDetailModal] Failed to check qira'at:", error);
        if (!cancelled) setQiraat({ key, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [db, activeTarget?.surah, activeTarget?.ayah]);

  const handleBookmark = useCallback(async () => {
    if (!activeTarget || bookmarkBusy) return;
    setBookmarkBusy(true);
    try {
      if (bookmarked) {
        await dbRemoveBookmark(db, activeTarget.surah, activeTarget.ayah);
        showToast(s.bookmarkRemoved);
      } else {
        await dbAddBookmark(db, activeTarget.surah, activeTarget.ayah);
        showToast(
          interpolate(s.ayahDetailBookmarked, { ref: formatAyahRef(isRTL, activeTarget.surah, activeTarget.ayah) }),
        );
      }
      await refreshBookmarks();
    } catch (e) {
      console.warn("[AyahDetailModal] Failed to toggle bookmark:", e);
      showToast(s.bookmarkActionFailed);
    } finally {
      setBookmarkBusy(false);
    }
  }, [bookmarkBusy, bookmarked, db, activeTarget, isRTL, showToast, s, refreshBookmarks]);

  // Copy and Share use the shared Quran copy format: Unicode text, reference and canonical link,
  // never page-font glyphs.
  const copyText = useCallback(async () => {
    if (!activeTarget || !row) return null;
    const text = await buildAyahCopyText(db, activeTarget.surah, activeTarget.ayah, activeTarget.ayah, uiLanguage);
    if (!text) throw new Error("Ayah text is unavailable");
    return text;
  }, [activeTarget, db, row, uiLanguage]);

  const handleCopy = useCallback(async () => {
    if (copyBusy) return;
    setCopyBusy(true);
    try {
      const text = await copyText();
      if (text == null) return;
      await Clipboard.setStringAsync(text);
      if (!systemConfirmsCopy()) showToast(s.copied);
    } catch (e) {
      console.warn("[AyahDetailModal] Failed to copy share text:", e);
      showToast(s.copyFailed);
    } finally {
      setCopyBusy(false);
    }
  }, [copyBusy, copyText, showToast, s.copied, s.copyFailed]);

  const handleShare = useCallback(async () => {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      const text = await copyText();
      if (text == null) return;
      await Share.share({ message: text });
    } catch (e) {
      // Closing the web share sheet rejects with AbortError; that is a choice, not a failure.
      if ((e as { name?: string } | null)?.name !== "AbortError") {
        console.warn("[AyahDetailModal] Failed to share ayah:", e);
        showToast(s.ayahDetailShareFailed);
      }
    } finally {
      setShareBusy(false);
    }
  }, [copyText, shareBusy, showToast, s.ayahDetailShareFailed]);

  const handleAudioPress = useCallback(async () => {
    if (!activeTarget) return;
    const result = await toggleAyah(activeTarget.surah, activeTarget.ayah, recitationId);
    if (!result.ok && result.failure && result.failure !== "busy") {
      showToast(audioFailureMessage(result.failure, s));
    }
  }, [activeTarget, recitationId, toggleAyah, showToast, s]);

  const handleNavigateAyah = useCallback(
    (direction: "previous" | "next") => {
      const nextTarget = adjacentAyahs[direction];
      if (!nextTarget) return;
      setCurrentTarget(nextTarget);
    },
    [adjacentAyahs],
  );

  // Stepping inside the sheet never moves the reader; this explicit action does.
  const handleGoToAyah = useCallback(() => {
    if (!activeTarget) return;
    const destination = { surah: activeTarget.surah, ayah: activeTarget.ayah };
    onClose();
    onNavigate?.();
    if (hasReaderNavigation) {
      navigateToAyah(destination.surah, destination.ayah);
    } else {
      setPendingDeepLink(destination);
      router.navigate("/(tabs)/mushaf");
    }
  }, [activeTarget, hasReaderNavigation, navigateToAyah, onClose, onNavigate]);

  // The picker's choice becomes the saved source and the tab shows it on return.
  const handlePickerSelected = useCallback(
    (sourceId: TafsirSourceId) => {
      setTafseerSource(sourceId);
      setChipSource(null);
      setActiveTab("tafsir");
      setTafsirReloadKey((value) => value + 1);
    },
    [setTafseerSource],
  );

  useDetailArrowKeys(keyScopeRef, {
    enabled: open && !tafsirPickerVisible,
    isRTL,
    onPrevious: () => handleNavigateAyah("previous"),
    onNext: () => handleNavigateAyah("next"),
  });

  if (!activeTarget) return null;

  const mutedTextStyle = {
    fontFamily: "Manrope_400Regular",
    fontSize: 15,
    lineHeight: 26,
    writingDirection: isRTL ? "rtl" : "ltr",
    ...textStartStyle(isRTL),
  } as const;

  return (
    <>
      <ResponsiveSheet open={open} onClose={onClose} maxWidth={1080} maxHeight={maxOverlayHeight}>
        <View ref={keyScopeRef} style={{ flexGrow: 1, flexShrink: 1, flexBasis: "auto", minHeight: 0 }}>
          {/* Phones at 360-393dp leave little room beside the close button, so the header keeps only
              ayah navigation and the per-ayah actions sit in the body under the ayah text. */}
          <OverlayHeader
            title={title}
            subtitle={subtitle}
            isRTL={isRTL}
            onClose={onClose}
            showHandle={isPhone}
            actions={
              <View className={isRTL ? "flex-row-reverse items-center gap-1" : "flex-row items-center gap-1"}>
                <ArrowButton
                  icon={
                    isRTL ? <ChevronRight size={18} color={iconColor} /> : <ChevronLeft size={18} color={iconColor} />
                  }
                  onPress={() => handleNavigateAyah("previous")}
                  disabled={!adjacentAyahs.previous}
                  accessibilityLabel={s.previousAyah}
                />
                <ArrowButton
                  icon={
                    isRTL ? <ChevronLeft size={18} color={iconColor} /> : <ChevronRight size={18} color={iconColor} />
                  }
                  onPress={() => handleNavigateAyah("next")}
                  disabled={!adjacentAyahs.next}
                  accessibilityLabel={s.nextAyah}
                />
              </View>
            }
          />

          <OverlayBody contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }} stickyHeaderIndices={[1]}>
            <View className="pt-5">
              <View className="justify-center rounded-3xl bg-surface-low dark:bg-surface-dark-low px-4 py-4">
                {/* Glyphs mounted before their page font exists render and measure in the system font. */}
                {fontVisible && row ? (
                  <View className="items-end" style={{ direction: "ltr" }}>
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
                      {qcf2Tokens.map((glyph, index) => {
                        const isMarker = index === qcf2Tokens.length - 1;
                        return (
                          <Text
                            key={`${activeTarget.surah}-${activeTarget.ayah}-${index}`}
                            className="text-charcoal dark:text-neutral-100"
                            style={{
                              fontFamily: qcf2FontFamily,
                              ...(isMarker ? qcf2MarkerFontPaletteStyle : qcf2FontPaletteStyle),
                              fontSize: isPhone ? 30 : 36,
                              lineHeight: glyphLineHeight,
                              paddingHorizontal: 2,
                            }}
                          >
                            {glyph}
                          </Text>
                        );
                      })}
                    </View>
                  </View>
                ) : (
                  // Two lines at the glyph line height, so the card keeps its size when the text appears.
                  <View accessible accessibilityLabel={s.ayahDetailTextLoading} accessibilityRole="progressbar">
                    {[0.92, 0.6].map((fraction) => (
                      <View
                        key={fraction}
                        style={{ height: glyphLineHeight, justifyContent: "center", alignItems: "flex-end" }}
                      >
                        <View
                          className="rounded-full bg-surface-high dark:bg-surface-dark-high"
                          style={{ height: 14, width: `${fraction * 100}%` }}
                        />
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <MirroredRow dir={isRTL ? "rtl" : "ltr"} className="mt-3 flex-wrap gap-2">
                {isRecitationEnabled() && (
                  <AyahActionButton
                    icon={
                      audioState.loading ? (
                        <ActivityIndicator size="small" color={audioIconColor} />
                      ) : audioState.playing ? (
                        <Pause size={15} color={audioIconColor} />
                      ) : (
                        <Play size={15} color={audioIconColor} />
                      )
                    }
                    label={audioState.playing ? s.ayahAudioPauseShort : s.ayahAudioListen}
                    accessibilityLabel={
                      audioState.loading ? s.audioLoading : audioState.playing ? s.audioPause : s.audioPlay
                    }
                    onPress={handleAudioPress}
                    disabled={audioState.loading}
                    isRTL={isRTL}
                  />
                )}
                <AyahActionButton
                  icon={
                    bookmarkBusy ? (
                      <ActivityIndicator size="small" color={iconColor} />
                    ) : (
                      <Bookmark
                        size={15}
                        color={bookmarked ? accentColor : iconColor}
                        fill={bookmarked ? accentColor : "none"}
                      />
                    )
                  }
                  label={bookmarked ? s.removeBookmark : s.bookmark}
                  onPress={handleBookmark}
                  disabled={bookmarkBusy}
                  isRTL={isRTL}
                />
                <AyahActionButton
                  icon={
                    copyBusy ? (
                      <ActivityIndicator size="small" color={iconColor} />
                    ) : (
                      <Copy size={15} color={iconColor} />
                    )
                  }
                  label={s.copy}
                  onPress={handleCopy}
                  disabled={copyBusy || !row}
                  isRTL={isRTL}
                />
                {canShareText() ? (
                  <AyahActionButton
                    icon={
                      shareBusy ? (
                        <ActivityIndicator size="small" color={iconColor} />
                      ) : (
                        <Share2 size={15} color={iconColor} />
                      )
                    }
                    label={s.ayahDetailShare}
                    onPress={handleShare}
                    disabled={shareBusy || !row}
                    isRTL={isRTL}
                  />
                ) : null}
              </MirroredRow>

              {stepped ? (
                <Pressable
                  onPress={handleGoToAyah}
                  accessibilityRole="button"
                  className="mt-3 items-center justify-between gap-2 rounded-2xl bg-primary-accent/10 px-4 dark:bg-primary-bright/10"
                  style={{
                    minHeight: 44,
                    direction: "ltr",
                    flexDirection: isRTL ? "row-reverse" : "row",
                    cursor: Platform.OS === "web" ? "pointer" : undefined,
                  }}
                >
                  <Text
                    className="flex-1 text-primary-muted dark:text-primary-bright"
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      fontSize: 14,
                      ...textStartStyle(isRTL),
                      writingDirection: isRTL ? "rtl" : "ltr",
                    }}
                  >
                    {s.ayahDetailGoToAyah}
                  </Text>
                  {isRTL ? <ArrowLeft size={16} color={accentColor} /> : <ArrowRight size={16} color={accentColor} />}
                </Pressable>
              ) : null}

              {activeTarget ? (
                <Pressable
                  onPress={() =>
                    issueReporter.report({
                      surah: activeTarget.surah,
                      ayah: activeTarget.ayah,
                      tab: shownTab,
                      source: shownTab === "tafsir" ? preferredSource : null,
                    })
                  }
                  accessibilityRole="link"
                  className="mt-2 min-h-11 items-center gap-2 self-start"
                  style={{
                    direction: "ltr",
                    flexDirection: isRTL ? "row-reverse" : "row",
                    alignSelf: isRTL ? "flex-end" : "flex-start",
                  }}
                >
                  <Flag size={14} color={iconColor} />
                  <Text
                    className="text-warm-500 dark:text-neutral-400"
                    style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
                  >
                    {s.ayahDetailReportIssue}
                  </Text>
                </Pressable>
              ) : null}
              {issueReporter.fallback}
            </View>

            {/* Pinned once the ayah scrolls away, so a long tafsir can switch tabs without scrolling back. */}
            <View style={{ backgroundColor: themeSurface }} className="pb-2 pt-4">
              <DetailTabRow
                tabs={tabs}
                activeKey={shownTab}
                onChange={setActiveTab}
                isRTL={isRTL}
                backgroundColor={themeSurface}
              />
            </View>

            <View className="mt-2 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-3">
              {shownTab === "similar" && (
                <View
                  onLayout={(event) => {
                    const next = Math.round(event.nativeEvent.layout.width);
                    if (next > 0) setSimilarWidth((current) => (current === next ? current : next));
                  }}
                >
                  {similar.groups.length > 0 ? (
                    <SimilarVerseComparison
                      db={db}
                      groups={similar.groups}
                      language={uiLanguage}
                      isRTL={isRTL}
                      accent={accentColor}
                      s={s}
                      // Until the box is measured, the sheet's width less its padding.
                      width={similarWidth ?? Math.max(0, Math.min(width, 1080) - 72)}
                    />
                  ) : (
                    <Text className="text-warm-700 dark:text-neutral-300" style={mutedTextStyle}>
                      {s.loading}
                    </Text>
                  )}
                </View>
              )}
              {shownTab === "translation" && (
                <TranslationPanel
                  loaded={translation}
                  targetKey={targetKey}
                  rtl={translationIsRtl}
                  attribution={langInfo?.attribution}
                  isRTL={isRTL}
                  mutedTextStyle={mutedTextStyle}
                />
              )}
              {shownTab === "tafsir" && (
                <View className="gap-3">
                  <View
                    className="items-center justify-between gap-3"
                    style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
                  >
                    <View className="min-w-0 flex-1">
                      <Text
                        className="text-charcoal dark:text-neutral-200"
                        style={{
                          fontFamily: "Manrope_600SemiBold",
                          fontSize: 14,
                          ...textStartStyle(isRTL),
                          writingDirection: isRTL ? "rtl" : "ltr",
                        }}
                      >
                        {sourceLabel(shownTafsir?.source ?? preferredSource)}
                      </Text>
                      <Text
                        className="mt-0.5 text-warm-500 dark:text-neutral-400"
                        style={{
                          fontFamily: "Manrope_400Regular",
                          fontSize: 12,
                          lineHeight: 18,
                          ...textStartStyle(isRTL),
                          writingDirection: isRTL ? "rtl" : "ltr",
                        }}
                      >
                        {s.tafseerPanelDownloadHint}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setTafsirPickerVisible(true)}
                      accessibilityRole="button"
                      accessibilityLabel={s.tafseerManageSources}
                      className="items-center gap-1.5 rounded-full bg-surface dark:bg-surface-dark px-3 py-2"
                      style={({ pressed }) => ({
                        direction: "ltr",
                        flexDirection: isRTL ? "row-reverse" : "row",
                        minHeight: 44,
                        opacity: pressed ? 0.78 : 1,
                        cursor: Platform.OS === "web" ? "pointer" : undefined,
                      })}
                    >
                      <BookOpenText size={14} color={accentColor} />
                      <Text
                        className="text-primary-accent dark:text-primary-bright"
                        numberOfLines={1}
                        style={{
                          fontFamily: "Manrope_600SemiBold",
                          fontSize: 12,
                          writingDirection: isRTL ? "rtl" : "ltr",
                        }}
                      >
                        {s.tafseerManageSources}
                      </Text>
                    </Pressable>
                  </View>

                  {tafsirFailed ? (
                    <InlineError
                      message={s.tafsirLoadFailed}
                      retryLabel={s.detailRetry}
                      onRetry={() => setTafsirReloadKey((value) => value + 1)}
                      isRTL={isRTL}
                    />
                  ) : tafsirRows === null ? (
                    <Text className="text-warm-700 dark:text-neutral-300" style={mutedTextStyle}>
                      {s.loading}
                    </Text>
                  ) : tafsirRows.length === 0 ? (
                    <View className="gap-3">
                      <Text className="text-warm-700 dark:text-neutral-300" style={mutedTextStyle}>
                        {s.noTafseerData}
                      </Text>
                      <SecondaryButton
                        label={s.tafsirGetAnother}
                        onPress={() => setTafsirPickerVisible(true)}
                        isRTL={isRTL}
                      />
                    </View>
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
                        {tafsirRows.map((item) => (
                          <TafsirSourceButton
                            key={item.source}
                            label={sourceLabel(item.source)}
                            active={shownTafsir?.source === item.source}
                            onPress={() => setChipSource(item.source)}
                          />
                        ))}
                      </ScrollView>
                      {preferredMissing && shownTafsir ? (
                        <Text
                          className="mb-2 text-warm-500 dark:text-neutral-400"
                          style={{
                            fontFamily: "Manrope_500Medium",
                            fontSize: 13,
                            lineHeight: 20,
                            writingDirection: isRTL ? "rtl" : "ltr",
                            ...textStartStyle(isRTL),
                          }}
                        >
                          {`${interpolate(s.tafsirSourceMissing, { name: sourceLabel(preferredSource) })} ${interpolate(
                            s.tafsirShowingSource,
                            { name: sourceLabel(shownTafsir.source) },
                          )}`}
                        </Text>
                      ) : null}
                      <Text
                        className="text-charcoal dark:text-neutral-200"
                        style={
                          shownTafsirIsRtl
                            ? { ...ARABIC_DETAIL_TEXT, writingDirection: "rtl", textAlign: "right" }
                            : {
                                fontFamily: "Manrope_400Regular",
                                fontSize: 16,
                                lineHeight: 26,
                                writingDirection: "ltr",
                                textAlign: "left",
                              }
                        }
                      >
                        {shownTafsir?.text ?? s.noTafseerData}
                      </Text>
                    </View>
                  )}
                </View>
              )}
              {shownTab === "qiraat" && (
                <QiraatTab surah={activeTarget.surah} ayah={activeTarget.ayah} showHeader={false} />
              )}
              {shownTab === "notes" && <PrivateNotesSection surah={activeTarget.surah} ayah={activeTarget.ayah} />}
              {shownTab === "reflections" && (
                <ReflectionsSection
                  surah={activeTarget.surah}
                  ayah={activeTarget.ayah}
                  initiallyExpanded
                  showHeader={false}
                  onNavigate={() => {
                    onClose();
                    onNavigate?.();
                  }}
                />
              )}
            </View>
          </OverlayBody>
        </View>
      </ResponsiveSheet>
      <TafsirSourcePicker
        visible={tafsirPickerVisible}
        selectedSource={preferredSource}
        onSelected={handlePickerSelected}
        onClose={() => setTafsirPickerVisible(false)}
        logLabel="[AyahDetailModal]"
        helperText={s.tafseerDownloadHint}
      />
    </>
  );
}

function TranslationPanel({
  loaded,
  targetKey,
  rtl,
  attribution,
  isRTL,
  mutedTextStyle,
}: {
  loaded: Loaded<string> | null;
  targetKey: string;
  rtl: boolean;
  attribution?: string;
  isRTL: boolean;
  mutedTextStyle: object;
}) {
  const s = useStrings();
  const text = loadedValue(loaded, targetKey);
  if (loadFailed(loaded, targetKey)) {
    return (
      <Text className="text-red-600 dark:text-red-400" style={mutedTextStyle}>
        {s.ayahDetailTranslationFailed}
      </Text>
    );
  }
  if (text === undefined) {
    return (
      <Text className="text-warm-700 dark:text-neutral-300" style={mutedTextStyle}>
        {s.loading}
      </Text>
    );
  }
  if (!text) {
    return (
      <Text className="text-warm-700 dark:text-neutral-300" style={mutedTextStyle}>
        {s.ayahDetailNoTranslation}
      </Text>
    );
  }
  return (
    <View>
      {/* Translation text follows its own language: English stays LTR in the Arabic interface. */}
      <Text
        className="text-charcoal dark:text-neutral-200"
        style={{
          fontFamily: "Manrope_400Regular",
          fontSize: 16,
          lineHeight: 26,
          writingDirection: rtl ? "rtl" : "ltr",
          ...textStartStyle(rtl),
        }}
      >
        {text}
      </Text>
      {attribution ? (
        <Text
          className="mt-2 text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL), writingDirection: "ltr" }}
        >
          {attribution}
        </Text>
      ) : null}
    </View>
  );
}

function InlineError({
  message,
  retryLabel,
  onRetry,
  isRTL,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  isRTL: boolean;
}) {
  return (
    <View className="gap-2">
      <Text
        accessibilityLiveRegion="polite"
        className="text-red-600 dark:text-red-400"
        style={{
          fontFamily: "Manrope_500Medium",
          fontSize: 14,
          lineHeight: 22,
          ...textStartStyle(isRTL),
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {message}
      </Text>
      <SecondaryButton label={retryLabel} onPress={onRetry} isRTL={isRTL} />
    </View>
  );
}

function SecondaryButton({ label, onPress, isRTL }: { label: string; onPress: () => void; isRTL: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={`min-h-[44px] justify-center rounded-full bg-surface px-4 dark:bg-surface-dark ${isRTL ? "self-end" : "self-start"}`}
      style={{ cursor: Platform.OS === "web" ? "pointer" : undefined }}
    >
      <Text
        className="text-primary-accent dark:text-primary-bright"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ArrowButton({
  icon,
  onPress,
  disabled = false,
  accessibilityLabel,
}: {
  icon: ReactNode;
  onPress: () => void;
  disabled?: boolean;
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
      style={{
        opacity: disabled ? 0.45 : 1,
        cursor: Platform.OS === "web" ? (disabled ? "auto" : "pointer") : undefined,
      }}
    >
      {icon}
    </Pressable>
  );
}

function AyahActionButton({
  icon,
  label,
  accessibilityLabel,
  onPress,
  disabled = false,
  isRTL,
}: {
  icon: ReactNode;
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  isRTL: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      className="items-center gap-1.5 rounded-full bg-surface-low px-3 dark:bg-surface-dark-low"
      style={{
        minHeight: 44,
        direction: "ltr",
        flexDirection: isRTL ? "row-reverse" : "row",
        opacity: disabled ? 0.45 : 1,
        cursor: Platform.OS === "web" ? (disabled ? "auto" : "pointer") : undefined,
      }}
    >
      {icon}
      <Text
        className="text-warm-600 dark:text-neutral-300"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function TafsirSourceButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`min-h-[44px] justify-center rounded-full px-3 ${
        active ? "bg-primary-accent/10 dark:bg-primary-bright/10" : "bg-surface dark:bg-surface-dark"
      }`}
      style={{ cursor: Platform.OS === "web" ? "pointer" : undefined }}
    >
      <Text
        className={active ? "text-primary-muted dark:text-primary-bright" : "text-warm-600 dark:text-neutral-300"}
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
