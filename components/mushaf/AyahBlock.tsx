import { useEffect, useState, useCallback, useRef, useMemo, memo } from "react";
import {
  ActivityIndicator,
  View,
  Text,
  Pressable,
  Animated as RNAnimated,
  Platform,
  ScrollView,
  Share,
  useWindowDimensions,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { systemConfirmsCopy } from "@/lib/clipboard-feedback";
import { quranPageFontName, quranPageMarkerFontPaletteStyle, quranPageFontPaletteStyle } from "@/lib/fonts/loader";
import { useRecyclingState } from "@shopify/flash-list";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useHasQiraat } from "@/lib/qiraat/availability";
import { inverseSurfaceColors } from "@/lib/ui/inverse-surface";
import { TooltipBubble } from "@/components/mushaf/ReaderToolbar";
import { formatAyahRef } from "@/lib/arabic";
import { useQuranPageFontReady } from "@/lib/fonts/use-quran-page-font";
import { useSelection } from "@/lib/selection/context";
import { WordToken } from "./WordToken";
import { AyahWordText } from "./WordSpan";
import { useWeakSpotMarker } from "@/lib/hifz/use-weak-spots";
import { useSimilarMarks } from "@/lib/hifz/use-similar-markers";
import { SimilarVerseButton } from "./SimilarVerseMarker";
import { BookOpenText, Bookmark, EyeOff, NotebookPen, Pause, Play, Share2 } from "lucide-react-native";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import {
  addBookmark as dbAddBookmark,
  buildAyahCopyText,
  removeBookmark as dbRemoveBookmark,
} from "@/lib/selection/queries";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { useAyahAudio } from "@/lib/audio/ayah-audio";
import { audioFailureMessage } from "@/lib/audio/labels";
import { isRecitationEnabled } from "@/lib/quran-foundation/config";
import { AyahDetailModal, type AyahDetailTabKey } from "./AyahDetailModal";
import { textStartStyle } from "@/lib/ui/direction";

function stopReaderChromeToggle(event: any) {
  event?.stopPropagation?.();
}

const readerControlProps =
  Platform.OS === "web"
    ? ({
        dataSet: { hafizReaderInteraction: "true" },
        onPointerDown: stopReaderChromeToggle,
        onPointerMove: stopReaderChromeToggle,
        onPointerUp: stopReaderChromeToggle,
        onTouchStart: stopReaderChromeToggle,
        onTouchMove: stopReaderChromeToggle,
        onTouchEnd: stopReaderChromeToggle,
      } as any)
    : ({
        onTouchStart: stopReaderChromeToggle,
        onTouchMove: stopReaderChromeToggle,
        onTouchEnd: stopReaderChromeToggle,
      } as any);

type Props = {
  surah: number;
  ayah: number;
  text: string;
  v2Page: number;
  fontSize: number;
  lineHeight: number;
  hideMode?: boolean;
  /** Hide mode only: the reader keeps revealed ayahs, so recycling a block never re-hides one. */
  revealed?: boolean;
  onRevealChange?: (surah: number, ayah: number, revealed: boolean, v2Page: number) => void;
  highlighted?: boolean;
  highlightedWordPos?: number | null;
};

function AyahBlockInner({
  surah,
  ayah,
  text,
  v2Page,
  fontSize,
  lineHeight,
  hideMode = false,
  revealed = false,
  onRevealChange,
  highlighted = false,
  highlightedWordPos = null,
}: Props) {
  const { width } = useWindowDimensions();
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const db = useDatabase();
  const hasQiraat = useHasQiraat(db, surah, ayah);
  const {
    recitationId,
    isRTL,
    isDark,
    uiLanguage,
    quranRenderFontStyle: quranFontStyle,
    quranMarkerStyle,
    showAyahMarkers,
    effectiveTheme,
    markSimilarVerses,
    isLoaded: settingsLoaded,
  } = useSettings();
  const s = useStrings();
  const { isBookmarked, getHighlightColor, getWordHighlightColor, showToast, refreshBookmarks, selectAyah } =
    useSelection();
  const isWeakSpot = useWeakSpotMarker();
  // MUT-02: the page's marks are read once for every block on that page, once the setting is known.
  const similarMarked = useSimilarMarks(db, v2Page, settingsLoaded && markSimilarVerses).has(`${surah}:${ayah}`);
  const { getAyahState, toggleAyah } = useAyahAudio();

  const fontVisible = useQuranPageFontReady(quranFontStyle, v2Page);
  // FlashList reuses a block for another ayah; recycling state resets with the ayah, so an open
  // detail sheet does not carry over to the verse that reuses it.
  const [detailOpen, setDetailOpen] = useRecyclingState(false, [surah, ayah]);
  const [detailTab, setDetailTab] = useState<AyahDetailTabKey>("tafsir");
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  // C07 arrival wash: a semantic background behind the target that fades in briefly (instantly with
  // reduced motion). The reader clears it after three seconds or the next deliberate tap.
  const reduceMotion = useReducedMotionPreference();
  const washOpacity = useRef(new RNAnimated.Value(highlighted ? 1 : 0)).current;
  useEffect(() => {
    if (!highlighted) {
      washOpacity.setValue(0);
      return;
    }
    if (reduceMotion) {
      washOpacity.setValue(1);
      return;
    }
    washOpacity.setValue(0);
    RNAnimated.timing(washOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [highlighted, reduceMotion, washOpacity]);
  const arrivalWashColor = isDark ? "rgba(45, 212, 191, 0.15)" : "rgba(13, 148, 136, 0.15)";
  // A long press on the end marker selects the ayah; the release must not also open its details.
  const skipMarkerPressRef = useRef(false);

  const wordTokens = useMemo(() => {
    const tokens = text.split(" ").filter(Boolean);
    if (tokens.length <= 1) return { words: [], marker: tokens[0] ?? "" };
    return {
      words: tokens.slice(0, -1),
      marker: tokens[tokens.length - 1],
    };
  }, [text]);

  const openDetail = useCallback((tab: AyahDetailTabKey) => {
    setDetailTab(tab);
    setDetailOpen(true);
  }, []);

  const handleReveal = useCallback(() => {
    if (hideMode) onRevealChange?.(surah, ayah, true, v2Page);
  }, [ayah, hideMode, onRevealChange, surah, v2Page]);
  const handleHide = useCallback(() => {
    onRevealChange?.(surah, ayah, false, v2Page);
  }, [ayah, onRevealChange, surah, v2Page]);

  const isBlurred = hideMode && !revealed;
  const fontFamily = quranPageFontName(quranFontStyle, v2Page);
  const fontPaletteStyle = quranPageFontPaletteStyle(quranFontStyle, v2Page, effectiveTheme);
  const markerFontPaletteStyle = quranPageMarkerFontPaletteStyle(
    quranFontStyle,
    v2Page,
    effectiveTheme,
    quranMarkerStyle,
  );
  const bookmarked = isBookmarked(surah, ayah);
  const highlightColor = getHighlightColor(surah, ayah);
  const qcf2LineHeight = Math.ceil(lineHeight + Math.max(6, fontSize * 0.16));
  // The hidden placeholder takes about the height the ayah's words will need, so revealing it does
  // not shift the list. Words wrap like the rendered row: roughly 1.7em per page-font word.
  const hiddenAyahHeight = useMemo(() => {
    const textWidth = Math.max(120, Math.min(width - 24, 840) - 38);
    const rowGap = Math.max(4, fontSize * 0.12);
    const perLine = Math.max(1, Math.floor(textWidth / (fontSize * 1.7 + 2)));
    const lines = Math.max(1, Math.ceil((wordTokens.words.length + 1) / perLine));
    return lines * qcf2LineHeight + (lines - 1) * rowGap;
  }, [fontSize, qcf2LineHeight, width, wordTokens.words.length]);

  const handleBookmark = useCallback(async () => {
    if (bookmarkBusy) return;
    setBookmarkBusy(true);
    try {
      if (bookmarked) {
        await dbRemoveBookmark(db, surah, ayah);
        showToast(s.bookmarkRemoved);
      } else {
        await dbAddBookmark(db, surah, ayah);
        showToast(s.bookmarkAdded);
      }
      await refreshBookmarks();
    } catch (e) {
      console.warn("[AyahBlock] Failed to toggle bookmark:", e);
      showToast(s.bookmarkActionFailed);
    } finally {
      setBookmarkBusy(false);
    }
  }, [
    bookmarkBusy,
    bookmarked,
    db,
    surah,
    ayah,
    showToast,
    s.bookmarkAdded,
    s.bookmarkRemoved,
    s.bookmarkActionFailed,
    refreshBookmarks,
  ]);

  const handleSelectAyah = useCallback(() => {
    selectAyah(surah, ayah);
  }, [ayah, selectAyah, surah]);

  const handleMarkerPress = useCallback(() => {
    if (skipMarkerPressRef.current) {
      skipMarkerPressRef.current = false;
      return;
    }
    openDetail("tafsir");
  }, [openDetail]);

  const handleMarkerPressIn = useCallback(() => {
    skipMarkerPressRef.current = false;
  }, []);

  const handleMarkerLongPress = useCallback(() => {
    skipMarkerPressRef.current = true;
    selectAyah(surah, ayah);
  }, [ayah, selectAyah, surah]);

  const markerAccessibility = {
    accessibilityRole: "button" as const,
    accessibilityLabel: interpolate(s.ayahMarkerLabel, { ref: formatAyahRef(isRTL, surah, ayah) }),
    accessibilityActions: [
      { name: "activate", label: s.ayahMarkerOpenDetails },
      { name: "longpress", label: s.ayahMarkerSelect },
    ],
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === "longpress") selectAyah(surah, ayah);
      else openDetail("tafsir");
    },
  };

  // Native opens the system share sheet. Web uses Web Share where the browser offers it and
  // otherwise copies, and the control is labeled for what it does. A dismissed share sheet or a
  // failed copy is never announced as a success.
  const webCanShare =
    Platform.OS === "web" && typeof navigator !== "undefined" && typeof navigator.share === "function";
  const shareLabel = Platform.OS !== "web" || webCanShare ? s.readerShareAyah : s.readerCopyAyah;
  const handleShare = useCallback(async () => {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      const text = await buildAyahCopyText(db, surah, ayah, ayah, uiLanguage);
      if (!text) throw new Error("Ayah text is unavailable");
      if (Platform.OS !== "web") {
        await Share.share({ message: text });
      } else if (webCanShare) {
        try {
          await navigator.share({ text });
        } catch (error) {
          if ((error as { name?: string })?.name === "AbortError") return;
          throw error;
        }
      } else {
        await Clipboard.setStringAsync(text);
        if (!systemConfirmsCopy()) showToast(s.copied);
      }
    } catch (e) {
      console.warn("[AyahBlock] Failed to share ayah:", e);
      showToast(Platform.OS !== "web" || webCanShare ? s.readerShareFailed : s.copyFailed);
    } finally {
      setShareBusy(false);
    }
  }, [shareBusy, db, surah, ayah, uiLanguage, webCanShare, showToast, s.copied, s.copyFailed, s.readerShareFailed]);

  const handleAudioPress = useCallback(async () => {
    const result = await toggleAyah(surah, ayah, recitationId);
    if (!result.ok && result.failure && result.failure !== "busy") {
      showToast(audioFailureMessage(result.failure, s));
    }
  }, [ayah, recitationId, showToast, s, surah, toggleAyah]);

  const iconColor = isDark ? "#a3a3a3" : "#8B8178";
  const audioState = getAyahState(surah, ayah, recitationId);
  const audioIconColor = audioState.active ? "#0d9488" : iconColor;

  return (
    // Ayahs are separated by a hairline: the block shares the page color, so padding alone read as
    // stray empty space between verses.
    <View
      className="bg-surface dark:bg-surface-dark px-4 pt-2 pb-3 border-b border-warm-200 dark:border-neutral-800"
      style={{
        position: "relative",
        width: Math.max(0, Math.min(width - 24, 840)),
        alignSelf: "center",
        overflow: "visible",
      }}
    >
      {/* Arrival wash behind the target; glyph, Tajweed and highlight colors stay untouched. */}
      {highlighted && (
        <RNAnimated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: -8,
            right: -8,
            bottom: 0,
            borderRadius: 12,
            backgroundColor: arrivalWashColor,
            opacity: washOpacity,
          }}
        />
      )}
      <View
        className={
          isRTL ? "flex-row-reverse items-center justify-between gap-3" : "flex-row items-center justify-between gap-3"
        }
        // Hand-mirrored rows pin LTR coordinates; under the reader's RTL root row-reverse flipped twice
        // and put the ayah reference on the left in Arabic.
        style={{
          direction: "ltr",
          paddingTop: isPhone ? 2 : 6,
        }}
      >
        <View className={isRTL ? "flex-row-reverse items-center gap-1.5" : "flex-row items-center gap-1.5"}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${surah}:${ayah}`}
            onPress={handleSelectAyah}
            {...readerControlProps}
            className="rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-3 py-2"
            style={({ pressed }) => ({
              position: "relative",
              transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
          >
            <Text
              className="text-primary-accent dark:text-primary-bright"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
            >
              {formatAyahRef(isRTL, surah, ayah)}
            </Text>
            {bookmarked && <View className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-gold" />}
          </Pressable>
          {isRecitationEnabled() && (
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
          )}
          <ActionIcon
            icon={
              shareBusy ? <ActivityIndicator size="small" color={iconColor} /> : <Share2 size={15} color={iconColor} />
            }
            onPress={handleShare}
            disabled={shareBusy}
            accessibilityLabel={shareLabel}
          />
        </View>

        <View className={isRTL ? "flex-row-reverse items-center gap-1.5" : "flex-row items-center gap-1.5"}>
          {similarMarked ? (
            <SimilarVerseButton
              label={interpolate(s.hifzSimilarMarker, { ref: formatAyahRef(isRTL, surah, ayah) })}
              isDark={isDark}
              onPress={() => openDetail("similar")}
            />
          ) : null}
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
            accessibilityLabel={bookmarked ? s.removeBookmark : s.bookmark}
          />
        </View>
      </View>

      {/* Arabic text (QCF2) — interactive word tokens */}
      {isBlurred ? (
        <Pressable
          onPress={handleReveal}
          accessibilityRole="button"
          accessibilityLabel={`${s.tapToReveal}, ${formatAyahRef(isRTL, surah, ayah)}`}
          {...readerControlProps}
          className={isPhone ? "pt-3 pb-1" : "pt-5 pb-1"}
        >
          <View
            className="rounded-2xl bg-surface-mid dark:bg-surface-dark-mid items-center justify-center"
            style={{ height: hiddenAyahHeight }}
          >
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
            >
              {s.tapToReveal}
            </Text>
          </View>
        </Pressable>
      ) : !fontVisible ? (
        // Glyphs mounted before their page font exists render and measure in the system font.
        <View className={isPhone ? "pt-3 pb-1" : "pt-5 pb-1"} style={{ minHeight: qcf2LineHeight }} />
      ) : (
        <View
          className={isPhone ? "pt-3 pb-1" : "pt-5 pb-1"}
          style={{
            direction: "ltr",
            alignItems: "flex-end",
            paddingHorizontal: 3,
            alignSelf: "stretch",
            width: "100%",
          }}
        >
          {Platform.OS === "android" ? (
            // Android clips each separate Text to its own box, which cut page-font word glyphs that draw
            // outside their advance. One Text per ayah with nested word spans draws every word fully.
            <AyahWordText
              words={wordTokens.words}
              marker={
                showAyahMarkers && wordTokens.marker ? (
                  <Text
                    style={markerFontPaletteStyle}
                    onPress={handleMarkerPress}
                    onPressIn={handleMarkerPressIn}
                    {...markerAccessibility}
                  >
                    {wordTokens.marker}
                  </Text>
                ) : null
              }
              onMarkerLongPress={handleMarkerLongPress}
              surah={surah}
              ayah={ayah}
              v2Page={v2Page}
              fontSize={fontSize}
              lineHeight={qcf2LineHeight}
              className="text-charcoal dark:text-neutral-100"
              style={{
                fontFamily,
                fontSize,
                lineHeight: qcf2LineHeight,
                textAlign: "right",
                alignSelf: "stretch",
                ...(highlightColor && {
                  backgroundColor: highlightColor + "20",
                  borderRadius: 8,
                  paddingHorizontal: 4,
                  paddingVertical: 2,
                }),
              }}
              wordHighlightColor={(wordPos) => getWordHighlightColor(surah, ayah, wordPos)}
              wordArrivalWash={(wordPos) => (highlightedWordPos === wordPos ? arrivalWashColor : undefined)}
              wordWeakSpot={(wordPos) => isWeakSpot(surah, ayah, wordPos)}
            />
          ) : (
            <View
              className="self-end"
              style={{
                direction: "ltr",
                flexDirection: "row-reverse",
                flexWrap: "wrap",
                justifyContent: "flex-start",
                alignItems: "center",
                gap: 2,
                rowGap: Math.max(4, fontSize * 0.12),
                width: "100%",
                maxWidth: "100%",
                ...(highlightColor && {
                  backgroundColor: highlightColor + "20",
                  borderRadius: 8,
                  paddingHorizontal: 4,
                  paddingVertical: 2,
                }),
              }}
            >
              {wordTokens.words.map((glyph, i) => {
                const wordPos = i + 1;
                return (
                  <WordToken
                    key={`${surah}-${ayah}-w${i}`}
                    glyph={glyph}
                    fontFamily={fontFamily}
                    fontPalette={fontPaletteStyle?.fontPalette ?? null}
                    fontSize={fontSize}
                    lineHeight={qcf2LineHeight}
                    surah={surah}
                    ayah={ayah}
                    wordPos={wordPos}
                    v2Page={v2Page}
                    highlightColor={getWordHighlightColor(surah, ayah, wordPos)}
                    arrivalWash={highlightedWordPos === wordPos ? arrivalWashColor : undefined}
                    weakSpot={isWeakSpot(surah, ayah, wordPos)}
                  />
                );
              })}
              {/* Ayah end marker */}
              {showAyahMarkers && wordTokens.marker && (
                <Text
                  onPress={handleMarkerPress}
                  onPressIn={handleMarkerPressIn}
                  onLongPress={handleMarkerLongPress}
                  {...markerAccessibility}
                  {...(Platform.OS === "web"
                    ? ({
                        onContextMenu: (event: any) => {
                          event?.preventDefault?.();
                          handleMarkerLongPress();
                        },
                      } as any)
                    : null)}
                  {...(Platform.OS === "web"
                    ? ({
                        selectable: true,
                        dataSet: {
                          hafizQuranToken: "marker",
                          hafizSurah: String(surah),
                          hafizAyah: String(ayah),
                          hafizWordPos: "0",
                          hafizAyahMarker: "true",
                          hafizQuranHidden: "false",
                        },
                      } as any)
                    : {})}
                  className="text-charcoal dark:text-neutral-100"
                  style={{
                    fontFamily,
                    ...markerFontPaletteStyle,
                    fontSize,
                    lineHeight: qcf2LineHeight,
                    paddingHorizontal: 2,
                    writingDirection: "rtl",
                    ...(Platform.OS === "web" ? ({ userSelect: "text" } as any) : null),
                  }}
                >
                  {wordTokens.marker}
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      {hideMode && revealed && (
        <View className={isRTL ? "items-end pt-1" : "items-start pt-1"}>
          <Pressable
            onPress={handleHide}
            accessibilityRole="button"
            accessibilityLabel={`${s.revealHideThisAyah}, ${formatAyahRef(isRTL, surah, ayah)}`}
            {...readerControlProps}
            className="min-h-[44px] items-center justify-center gap-1.5 rounded-full px-3"
            style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
          >
            <EyeOff size={15} color={iconColor} />
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
            >
              {s.revealHideThisAyah}
            </Text>
          </Pressable>
        </View>
      )}

      <View className="pt-2">
        {/* The row runs to the block edges so pills that do not fit are cut at the edge, like any
            swipeable row, rather than mid-word inside the padding. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          bounces={false}
          style={{ marginHorizontal: -16 }}
          {...readerControlProps}
          // Direction alone mirrors the row (and starts the scroll at the right in Arabic); adding
          // row-reverse flipped it back.
          contentContainerStyle={{
            direction: isRTL ? "rtl" : "ltr",
            flexDirection: "row",
            gap: 8,
            paddingHorizontal: 16,
          }}
        >
          <ActionPill
            label={s.wordTranslation}
            icon={<BookOpenText size={14} color={iconColor} />}
            onPress={() => openDetail("translation")}
            isRTL={isRTL}
          />
          <ActionPill
            label={s.tafseer}
            icon={<BookOpenText size={14} color={iconColor} />}
            onPress={() => openDetail("tafsir")}
            isRTL={isRTL}
          />
          {/* Shown when the ayah has Qira'at data, or when that could not be read (the tab reports it). */}
          {hasQiraat !== false ? (
            <ActionPill
              label={s.wordTabQiraat}
              icon={<BookOpenText size={14} color={iconColor} />}
              onPress={() => openDetail("qiraat")}
              isRTL={isRTL}
            />
          ) : null}
          <ActionPill
            label={s.privateNotes}
            icon={<NotebookPen size={14} color={iconColor} />}
            onPress={() => openDetail("notes")}
            isRTL={isRTL}
          />
        </ScrollView>
      </View>
      <AyahDetailModal
        target={detailOpen ? { surah, ayah } : null}
        onClose={() => setDetailOpen(false)}
        initialTab={detailTab}
      />
    </View>
  );
}

export const AyahBlock = memo(AyahBlockInner);

function ActionIcon({
  icon,
  onPress,
  disabled = false,
  accessibilityLabel,
}: {
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const { isDark } = useSettings();
  const [tooltip, setTooltip] = useState(false);
  // Web shows the icon's name on hover or keyboard focus, as the reader toolbar does.
  const webTooltipProps =
    Platform.OS === "web" && accessibilityLabel
      ? ({
          onHoverIn: () => setTooltip(true),
          onHoverOut: () => setTooltip(false),
          onFocus: () => setTooltip(true),
          onBlur: () => setTooltip(false),
        } as Record<string, unknown>)
      : {};
  return (
    <View style={{ position: "relative" }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={8}
        {...readerControlProps}
        {...webTooltipProps}
        className="h-8 w-8 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
        style={{
          opacity: disabled ? 0.45 : 1,
          // @ts-ignore — cursor is valid on web
          cursor: disabled ? "auto" : "pointer",
        }}
      >
        {icon}
      </Pressable>
      {tooltip && accessibilityLabel ? (
        <TooltipBubble label={accessibilityLabel} colors={inverseSurfaceColors(isDark)} offset={36} />
      ) : null}
    </View>
  );
}

function ActionPill({
  label,
  icon,
  active,
  badge,
  onPress,
  disabled = false,
  isRTL = false,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  badge?: number;
  onPress: () => void;
  disabled?: boolean;
  isRTL?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      {...readerControlProps}
      className={`items-center gap-1.5 rounded-full px-3 py-2 ${
        active ? "bg-primary-accent/10 dark:bg-primary-bright/10" : "bg-surface dark:bg-surface-dark"
      }`}
      style={{
        direction: isRTL ? "rtl" : "ltr",
        flexDirection: "row",
        flexShrink: 0,
        opacity: disabled && !active ? 0.55 : 1,
      }}
    >
      {icon}
      <Text
        numberOfLines={1}
        className={active ? "text-primary-accent dark:text-primary-bright" : "text-warm-500 dark:text-neutral-400"}
        style={{
          fontFamily: "Manrope_600SemiBold",
          fontSize: 11,
          ...textStartStyle(isRTL),
          writingDirection: isRTL ? "rtl" : "ltr",
          ...(Platform.OS === "web" ? ({ whiteSpace: "nowrap" } as any) : null),
        }}
      >
        {label}
      </Text>
      {badge !== undefined && badge > 0 && (
        <View className="rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 px-1.5 py-0.5">
          <Text
            className="text-primary-accent dark:text-primary-bright"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10 }}
          >
            {badge}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
