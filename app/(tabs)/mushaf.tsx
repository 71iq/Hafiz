import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useIsFocused } from "@react-navigation/native";
import { useFocusEffect, router } from "expo-router";
import { AuthReopenSurfaces } from "@/components/auth/AuthReopenSurfaces";
import { View, Text, Pressable, Platform, useWindowDimensions, BackHandler, AppState } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { FlashList, FlashListRef } from "@shopify/flash-list";
import { useChrome } from "@/lib/ui/chrome";
import { Undo2 } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { useWeakSpotMarker, useWeakSpotsLoader } from "@/lib/hifz/use-weak-spots";
import { writeUserSetting } from "@/lib/database/user-settings";
import { useSettings, withThemeOpacity } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { WordInteractionProvider, useWordInteraction } from "@/lib/word/context";
import { SelectionProvider, useSelection } from "@/lib/selection/context";
import { SurahHeader } from "@/components/mushaf/SurahHeader";
import { AyahBlock } from "@/components/mushaf/AyahBlock";
import { PageMushaf } from "@/components/mushaf/PageMushaf";
import { GoToNavigator, type GoToTab, type GoToTarget } from "@/components/mushaf/GoToNavigator";
import { MushafIndicator } from "@/components/mushaf/MushafIndicator";
import { MushafSlider } from "@/components/mushaf/MushafSlider";
import { FocusModeControls } from "@/components/mushaf/FocusModeControls";
import { HifzControls } from "@/components/mushaf/HifzControls";
import { WordDetailSheet } from "@/components/mushaf/WordDetailSheet";
import { RecitationRangeSheet } from "@/components/mushaf/RecitationRangeSheet";
import { RecitationPlayerBar } from "@/components/mushaf/RecitationPlayerBar";
import { keepPageReveals, NO_VERSE_REVEALS, setVerseReveal, type VerseReveals } from "@/components/mushaf/verse-reveals";
import { ReadingSettingsSheet } from "@/components/mushaf/ReadingSettingsSheet";
import { ReaderToolbar } from "@/components/mushaf/ReaderToolbar";
import { ReaderHelpSheet } from "@/components/mushaf/ReaderHelpSheet";
import { QuranLoadError } from "@/components/mushaf/QuranLoadError";
import { Skeleton } from "@/components/ui/Skeleton";
import { WEAK_SPOT_DARK, WEAK_SPOT_LIGHT } from "@/components/mushaf/WordToken";
import { textStartStyle } from "@/lib/ui/direction";
import type { HifzVisibility } from "@/components/mushaf/MushafPage";
import {
  loadMushafIndex,
  findJuzForAyah,
  findHizbForAyah,
  topmostAyahForPage,
  pageForAyah,
  positionForMode,
  type MushafIndex,
} from "@/lib/mushaf/position";
import { useAyahAudio, type AyahAudioTarget } from "@/lib/audio/ayah-audio";
import { useFollowRecitation } from "@/lib/audio/use-follow-recitation";
import { FloatingWordTooltip } from "@/components/mushaf/WordTooltip";
import { SelectionActionBar } from "@/components/mushaf/SelectionActionBar";
import { WebSelectionMenu } from "@/components/mushaf/WebSelectionMenu";
import { BookmarksSheet } from "@/components/mushaf/BookmarksSheet";
import { Toast } from "@/components/ui/Toast";
import { hasOpenOverlay } from "@/components/ui/ResponsiveOverlay";
import { SearchCommand } from "@/components/SearchCommand";
import { consumePendingDeepLink, peekPendingDeepLink, subscribePendingDeepLink } from "@/lib/deep-link";
import {
  ARRIVAL_MS,
  INITIAL_POSITION_SESSION,
  RETURN_PILL_MS,
  captureReturnToken,
  expireReturnToken,
  mayApplySavedPosition,
  mayPersistPosition,
  parseSavedPosition,
  reducePositionSession,
  serializePosition,
  takeReturnToken,
  type ReaderPosition,
  type ReaderPositionEvent,
  type ReturnToken,
} from "@/lib/navigation/reader-session";
import { isReaderTapClaimed, releaseReaderTap } from "@/lib/mushaf/reader-tap-guard";
import { useAuthStore } from "@/lib/auth/store";
import { isRecitationEnabled } from "@/lib/quran-foundation/config";
import { loadQuranPageFont } from "@/lib/fonts/loader";
import { scrollToVisibleIndex, type VerseScrollResult } from "@/lib/mushaf/scroll-to-visible-index";
import { formatAyahRef, toArabicNumber } from "@/lib/arabic";
import {
  SIDEBAR_BREAKPOINT,
  VIEWPORT_BREAKPOINTS,
} from "@/lib/ui/viewport";

type MushafTarget = { surah: number; ayah: number; wordPos?: number };
type HifzPageAyah = { key: string; wordCount: number };
const EMPTY_HIFZ_PAGE_AYAHS: HifzPageAyah[] = [];
/** Device-only (off the sync allowlist): the reader has dismissed the weak-spot explanation. */
const WEAK_SPOT_NOTE_KEY = "device_weak_spot_note_seen";

const PAGE_RAIL_MAX_WIDTH = 760;
// How long after a touch drag, wheel or scroll key a scroll still counts as the reader's own,
// long enough to cover a fling's momentum.
const USER_SCROLL_INPUT_WINDOW_MS = 2500;
// Matches the ayah marker delayLongPress in MushafPage, so a press that selects an ayah never also toggles chrome.
const LONG_PRESS_MS = 300;
// Downward scrolling hides the controls only after this much travel, so small adjustments do not flicker them.
const CHROME_HIDE_SCROLL_PX = 24;
// A press that moves less than this is a tap (it clears an arrival wash); more is a scroll.
const TAP_SLOP_PX = 8;
const HEADER_CONTENT_STYLE = { position: "absolute", top: 0, left: 0, right: 0 } as const;
const SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]);
const READER_INTERACTION_SELECTOR = '[data-hafiz-quran-token], [data-hafiz-word-tooltip="true"], [data-hafiz-reader-interaction="true"]';

function isFromFocusModeControls(event: any) {
  const target = event?.nativeEvent?.target;
  return !!(
    target &&
    typeof target.closest === "function" &&
    target.closest('[data-focus-mode-controls="true"]')
  );
}

function isFromReaderInteraction(event: any) {
  const target = event?.nativeEvent?.target;
  return !!(
    target &&
    typeof target.closest === "function" &&
    target.closest(READER_INTERACTION_SELECTOR)
  );
}

/** C07: shortcuts never act while the reader types, composes text or works a focused control. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

const ACTIVATABLE_ROLES = ["button", "link", "menuitem", "tab", "checkbox", "radio", "switch"];
const ACTIVATABLE_SELECTOR = ["button", "a[href]", "summary", ...ACTIVATABLE_ROLES.map((name) => `[role="${name}"]`)].join(", ");

function isActivatableControl(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return Boolean(target.closest(ACTIVATABLE_SELECTOR));
}

function anyModalOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector('[aria-modal="true"]') !== null;
}

/** Registers an ayah navigation callback inside WordInteractionProvider */
function AyahNavigationRegistrar({
  onNavigateToTarget,
}: {
  onNavigateToTarget: (target: MushafTarget) => void;
}) {
  const { setNavigateToAyah, closeDetail } = useWordInteraction();

  useEffect(() => {
    setNavigateToAyah((surah: number, ayah: number, wordPos?: number) => {
      closeDetail();
      onNavigateToTarget({ surah, ayah, wordPos });
    });
  }, [setNavigateToAyah, closeDetail, onNavigateToTarget]);

  return null;
}

type SurahRow = {
  number: number;
  name_arabic: string;
  name_english: string;
  ayah_count: number;
  revelation_type: string;
};

type AyahRow = {
  surah: number;
  ayah: number;
  text_qcf2: string;
  text_uthmani: string;
  v2_page: number;
};

type MushafItem =
  | {
      type: "surah-header";
      surahNumber: number;
      nameArabic: string;
      nameEnglish: string;
      ayahCount: number;
      revelationType: string;
    }
  | {
      type: "ayah";
      surah: number;
      ayah: number;
      text: string;
      textUthmani: string;
      v2Page: number;
    };

export default function MushafScreen() {
  return (
    <WordInteractionProvider>
      <SelectionProvider>
        <MushafInner />
      </SelectionProvider>
    </WordInteractionProvider>
  );
}

function MushafInner() {
  const db = useDatabase();
  const isFocused = useIsFocused();
  // ERR-06: weak-spot markers for the pages and verses below.
  useWeakSpotsLoader(db);
  const {
    fontSize,
    lineHeight,
    viewMode,
    setViewMode,
    pageScroll,
    hifzAutoDelayMs,
    hifzAutoAdvancePage,
    focusScrollSpeed,
    setFocusScrollSpeed,
    audioFollow,
    isDark,
    isRTL,
    themeSurface,
    uiLanguage,
    quranRenderFontStyle: quranFontStyle,
    isLoaded: settingsLoaded,
  } = useSettings();
  const s = useStrings();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isPhone = windowWidth < SIDEBAR_BREAKPOINT;
  const isTablet = windowWidth >= SIDEBAR_BREAKPOINT && windowWidth < VIEWPORT_BREAKPOINTS.desktop;
  const { selection } = useSelection();
  const { detailWord } = useWordInteraction();
  const { visible: chromeVisible, setVisible: setChromeVisible, setImmersive } = useChrome();
  const lastScrollYRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number; at?: number } | null>(null);
  const touchMovedRef = useRef(false);
  const tapRevealGuardUntilRef = useRef(0);
  const lastUserScrollInputRef = useRef(0);
  const downwardTravelRef = useRef(0);
  // C06 saved-position bookkeeping: an explicit target outranks hydration, and an arrival is not saved
  // until the reader deliberately scrolls, pages or switches view.
  const positionSessionRef = useRef(INITIAL_POSITION_SESSION);
  const dispatchPosition = useCallback((event: ReaderPositionEvent) => {
    positionSessionRef.current = reducePositionSession(positionSessionRef.current, event);
  }, []);
  const markDeliberateMovement = useCallback(() => dispatchPosition("deliberate-move"), [dispatchPosition]);
  useEffect(() => {
    if (!isFocused || Platform.OS !== "web" || typeof window === "undefined") return;
    const markInput = () => {
      lastUserScrollInputRef.current = Date.now();
    };
    const markKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) markInput();
    };
    window.addEventListener("wheel", markInput, { passive: true });
    window.addEventListener("touchmove", markInput, { passive: true });
    window.addEventListener("keydown", markKey);
    return () => {
      window.removeEventListener("wheel", markInput);
      window.removeEventListener("touchmove", markInput);
      window.removeEventListener("keydown", markKey);
    };
  }, [isFocused]);
  const [focusModeActive, setFocusModeActive] = useState(false);
  const [focusModePlaying, setFocusModePlaying] = useState(false);
  const [focusControlsVisible, setFocusControlsVisible] = useState(false);
  const [focusToastMessage, setFocusToastMessage] = useState<string | null>(null);
  const focusControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearFocusControlsTimer = useCallback(() => {
    if (focusControlsTimerRef.current) {
      clearTimeout(focusControlsTimerRef.current);
      focusControlsTimerRef.current = null;
    }
  }, []);

  const revealFocusControls = useCallback(() => {
    if (!focusModeActive) return;
    clearFocusControlsTimer();
    setFocusControlsVisible(true);
    if (focusModePlaying) {
      focusControlsTimerRef.current = setTimeout(() => {
        setFocusControlsVisible(false);
        focusControlsTimerRef.current = null;
      }, 2500);
    }
  }, [clearFocusControlsTimer, focusModeActive, focusModePlaying]);

  const pauseFocusAutoScroll = useCallback(() => {
    if (!focusModeActive) return;
    clearFocusControlsTimer();
    setFocusModePlaying(false);
    setFocusControlsVisible(true);
  }, [clearFocusControlsTimer, focusModeActive]);

  // Set once the follow-recitation owner exists below: the reader's own scrolling or paging suspends it.
  const suspendFollowRef = useRef<() => void>(() => {});
  const handleScrollChrome = useCallback((e: any) => {
    const y = e?.nativeEvent?.contentOffset?.y;
    if (typeof y !== "number") return;
    if (focusModeActive) {
      lastScrollYRef.current = y;
      return;
    }
    const dy = y - lastScrollYRef.current;
    const now = Date.now();
    if (Math.abs(dy) > 8 && now - lastUserScrollInputRef.current < USER_SCROLL_INPUT_WINDOW_MS) {
      suspendFollowRef.current();
    }
    // A step larger than the screen is a programmatic jump (restoring the saved position, opening
    // a search result), not the reader scrolling, so it must not hide the controls.
    if (now <= tapRevealGuardUntilRef.current || Math.abs(dy) > windowHeight) {
      lastScrollYRef.current = y;
      downwardTravelRef.current = 0;
      return;
    }
    const ownScroll = now - lastUserScrollInputRef.current < USER_SCROLL_INPUT_WINDOW_MS;
    if (ownScroll && dy !== 0) markDeliberateMovement();
    if (dy < -8) {
      downwardTravelRef.current = 0;
      setChromeVisible(true);
    } else if (dy > 0 && ownScroll) {
      // Only the reader's own scrolling hides the controls, and only after 24 px of travel. Lists
      // also move while items measure, retry a scroll to a target or restore a position, and those
      // must leave the controls shown.
      downwardTravelRef.current += dy;
      if (downwardTravelRef.current >= CHROME_HIDE_SCROLL_PX) {
        downwardTravelRef.current = 0;
        setChromeVisible(false);
      }
    } else if (dy < 0) {
      downwardTravelRef.current = 0;
    }
    lastScrollYRef.current = y;
  }, [focusModeActive, markDeliberateMovement, setChromeVisible, windowHeight]);

  // A short tap on empty reading space shows or hides the controls at every width. A tap an ayah
  // marker already handled is not counted twice.
  const toggleChromeFromReaderTap = useCallback(() => {
    if (isReaderTapClaimed()) {
      releaseReaderTap();
      return;
    }
    if (focusModeActive) {
      // A tap on the reader brings back the full controls collapsed to the Pause pill.
      if (focusModePlaying && !focusControlsVisible) revealFocusControls();
      else pauseFocusAutoScroll();
      return;
    }
    tapRevealGuardUntilRef.current = Date.now() + 700;
    setChromeVisible((visible) => !visible);
  }, [focusControlsVisible, focusModeActive, focusModePlaying, pauseFocusAutoScroll, revealFocusControls, setChromeVisible]);

  const keepChromeVisibleDuringFontChange = useCallback(() => {
    if (focusModeActive) return;
    tapRevealGuardUntilRef.current = Date.now() + 1200;
    setChromeVisible(true);
  }, [focusModeActive, setChromeVisible]);

  const readerTapProps = Platform.OS === "web"
    ? ({
        onPointerDown: (e: any) => {
          if (isFromFocusModeControls(e) || isFromReaderInteraction(e)) {
            touchStartRef.current = null;
            return;
          }
          touchStartRef.current = {
            x: e?.nativeEvent?.pageX ?? e?.nativeEvent?.clientX ?? 0,
            y: e?.nativeEvent?.pageY ?? e?.nativeEvent?.clientY ?? 0,
          };
          touchMovedRef.current = false;
        },
        onPointerMove: (e: any) => {
          if (isFromFocusModeControls(e) || isFromReaderInteraction(e)) return;
          const start = touchStartRef.current;
          if (!start) return;
          const x = e?.nativeEvent?.pageX ?? e?.nativeEvent?.clientX;
          const y = e?.nativeEvent?.pageY ?? e?.nativeEvent?.clientY;
          if (
            typeof x === "number" &&
            typeof y === "number" &&
            (Math.abs(x - start.x) > 8 || Math.abs(y - start.y) > 8)
          ) {
            touchMovedRef.current = true;
          }
        },
        onPointerUp: (e: any) => {
          if (isFromFocusModeControls(e) || isFromReaderInteraction(e)) {
            touchStartRef.current = null;
            return;
          }
          if (touchStartRef.current && !touchMovedRef.current) toggleChromeFromReaderTap();
          touchStartRef.current = null;
        },
      } as Record<string, unknown>)
    : ({
        onTouchStart: (e: any) => {
          const touch = e?.nativeEvent?.touches?.[0];
          touchStartRef.current = touch
            ? { x: touch.pageX ?? 0, y: touch.pageY ?? 0, at: Date.now() }
            : null;
          touchMovedRef.current = false;
        },
        onTouchMove: (e: any) => {
          const start = touchStartRef.current;
          const touch = e?.nativeEvent?.touches?.[0];
          if (!start || !touch) return;
          const x = touch.pageX;
          const y = touch.pageY;
          if (
            typeof x === "number" &&
            typeof y === "number" &&
            (Math.abs(x - start.x) > 8 || Math.abs(y - start.y) > 8)
          ) {
            touchMovedRef.current = true;
            lastUserScrollInputRef.current = Date.now();
            markDeliberateMovement();
          }
        },
        onTouchEnd: () => {
          // A long press selects an ayah; only a short tap shows or hides the reader chrome.
          const startedAt = touchStartRef.current?.at;
          const isShortTap = typeof startedAt === "number" && Date.now() - startedAt < LONG_PRESS_MS;
          if (!touchMovedRef.current && isShortTap) toggleChromeFromReaderTap();
          touchStartRef.current = null;
        },
      } as Record<string, unknown>);

  // Header slides/fades out AND collapses its height so the list fills the
  // freed vertical space. We measure the natural header height on first
  // layout and animate height from that to 0.
  const headerHidden = useSharedValue(0);
  useEffect(() => {
    headerHidden.value = withTiming(chromeVisible ? 0 : 1, { duration: 200 });
  }, [chromeVisible, headerHidden]);
  const [measuredHeaderH, setMeasuredHeaderH] = useState<number | null>(null);
  const headerAnimStyle = useAnimatedStyle(() => {
    if (measuredHeaderH == null) {
      return { opacity: 1, overflow: "hidden" };
    }
    return {
      height: measuredHeaderH * (1 - headerHidden.value),
      opacity: 1 - headerHidden.value,
      overflow: "hidden",
    };
  });
  const sliderAnimStyle = useAnimatedStyle(() => ({
    opacity: 1 - headerHidden.value,
  }));
  // Follows the header's natural height. Keeping only the first measurement froze a height taken
  // while the toolbar row was still wrapping, which left a tall empty band above page view. The
  // measured content is positioned out of flow (HEADER_CONTENT_STYLE), so the collapsing container
  // clips it instead of squashing it; a squashed measurement would become the height the next
  // reveal animates to, leaving the toolbar a sliver.
  const onHeaderLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h > 0) setMeasuredHeaderH((current) => (current === h ? current : h));
  }, []);

  const [items, setItems] = useState<MushafItem[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed Quran-data query shows Retry instead of an empty reader.
  const [quranLoadFailed, setQuranLoadFailed] = useState(false);
  const [quranLoadAttempt, setQuranLoadAttempt] = useState(0);
  const [showNavigator, setShowNavigator] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showRecitation, setShowRecitation] = useState(false);
  const [showReadingSettings, setShowReadingSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [navigatorTab, setNavigatorTab] = useState<GoToTab>("surah");
  const [currentPage, setCurrentPage] = useState(1);
  const [verseHideMode, setVerseHideMode] = useState(false);
  // Hide mode: revealed ayahs (key to page) live here so virtualization never re-hides them.
  const [verseReveals, setVerseReveals] = useState<VerseReveals>(NO_VERSE_REVEALS);
  const [hifzEnabled, setHifzEnabled] = useState(false);
  const [hifzRevealedAyahCount, setHifzRevealedAyahCount] = useState(0);
  const [hifzActiveAyahKey, setHifzActiveAyahKey] = useState<string | null>(null);
  const [hifzActiveVisibleWordCount, setHifzActiveVisibleWordCount] = useState(0);
  const [hifzAutoRunning, setHifzAutoRunning] = useState(false);
  const [mushafIndex, setMushafIndex] = useState<MushafIndex | null>(null);
  const [topAyah, setTopAyah] = useState<{ surah: number; ayah: number } | null>(null);
  const [pageModeHifzData, setPageModeHifzData] = useState<{ page: number; ayahs: HifzPageAyah[] } | null>(null);
  const isPageMode = viewMode === "page";
  const currentPageRef = useRef(1);
  const topAyahRef = useRef<{ surah: number; ayah: number } | null>(null);
  topAyahRef.current = topAyah;
  const hifzCurrentPageAyahsRef = useRef({ page: currentPage, ayahs: EMPTY_HIFZ_PAGE_AYAHS });
  const hifzEnabledRef = useRef(false);
  const hifzAutoAdvancePageRef = useRef(false);
  const hifzAutoPageChangeRef = useRef(false);
  const hifzAutoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hifzProgressRef = useRef({
    revealedAyahCount: 0,
    activeAyahKey: null as string | null,
    activeVisibleWordCount: 0,
  });
  const goToPageRef = useRef<((page: number) => void) | null>(null);
  const flashListRef = useRef<FlashListRef<MushafItem>>(null);
  const pendingVersePageRef = useRef<number | null>(null);
  // The view-switch anchor from page view: the ayah at the top of the viewport.
  const pendingVerseAnchorRef = useRef<{ surah: number; ayah: number } | null>(null);
  const pageTopAyahRef = useRef<(() => { surah: number; ayah: number } | null) | null>(null);
  const verseScrollRequestRef = useRef(0);


  // C07 arrival: one wash per arrival with its own generation, cleared after three seconds or by the
  // next deliberate tap. An older timer can never clear a newer arrival.
  const [arrival, setArrival] = useState<{ id: number; surah: number; ayah: number; wordPos: number | null } | null>(null);
  const arrivalSeqRef = useRef(0);
  const arrivalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startArrival = useCallback((target: MushafTarget) => {
    const id = ++arrivalSeqRef.current;
    if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
    setArrival({
      id,
      surah: target.surah,
      ayah: target.ayah,
      wordPos: typeof target.wordPos === "number" ? target.wordPos : null,
    });
    arrivalTimerRef.current = setTimeout(() => {
      arrivalTimerRef.current = null;
      setArrival((current) => (current?.id === id ? null : current));
    }, ARRIVAL_MS);
  }, []);
  const clearArrival = useCallback(() => {
    if (arrivalTimerRef.current) {
      clearTimeout(arrivalTimerRef.current);
      arrivalTimerRef.current = null;
    }
    setArrival((current) => (current ? null : current));
  }, []);
  useEffect(
    () => () => {
      if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
    },
    [],
  );
  const highlightedKey = arrival ? `${arrival.surah}:${arrival.ayah}` : null;
  const highlightedWord = useMemo(
    () => (arrival && arrival.wordPos !== null ? { surah: arrival.surah, ayah: arrival.ayah, wordPos: arrival.wordPos } : null),
    [arrival],
  );
  // A running recitation highlights the ayah being recited, ahead of an arrival highlight.
  const { rangeState: recitation, session: audioSession } = useAyahAudio();
  const recitingKey =
    recitation.active && recitation.currentAyah ? `${recitation.currentAyah.surah}:${recitation.currentAyah.ayah}` : null;
  const displayedHighlightKey = recitingKey ?? highlightedKey;

  const clearVerseScrollRetry = useCallback(() => {
    verseScrollRequestRef.current += 1;
  }, []);

  const scheduleVerseScrollToIndex = useCallback(
    (index: number, animated = false) => {
      // Programmatic scrolls (restore, search results, links) must not read as the reader scrolling.
      tapRevealGuardUntilRef.current = Date.now() + 1500;
      clearVerseScrollRetry();
      const request = verseScrollRequestRef.current;
      return scrollToVisibleIndex(
        () => flashListRef.current,
        index,
        animated,
        () => verseScrollRequestRef.current === request,
      );
    },
    [clearVerseScrollRetry]
  );

  // A deliberate tap anywhere clears the arrival wash; a scroll, even a small one, does not.
  const screenTapStartRef = useRef<{ x: number; y: number } | null>(null);
  const screenDismissHighlightProps = Platform.OS === "web"
    ? ({
        onPointerDown: (e: any) => {
          screenTapStartRef.current = { x: e?.nativeEvent?.clientX ?? 0, y: e?.nativeEvent?.clientY ?? 0 };
        },
        onPointerUp: (e: any) => {
          const start = screenTapStartRef.current;
          screenTapStartRef.current = null;
          if (!start) return;
          const dx = Math.abs((e?.nativeEvent?.clientX ?? start.x) - start.x);
          const dy = Math.abs((e?.nativeEvent?.clientY ?? start.y) - start.y);
          if (dx < TAP_SLOP_PX && dy < TAP_SLOP_PX) clearArrival();
        },
      } as Record<string, unknown>)
    : ({
        onTouchStart: (e: any) => {
          const touch = e?.nativeEvent?.touches?.[0];
          screenTapStartRef.current = touch ? { x: touch.pageX ?? 0, y: touch.pageY ?? 0 } : null;
        },
        onTouchEnd: (e: any) => {
          const start = screenTapStartRef.current;
          screenTapStartRef.current = null;
          const touch = e?.nativeEvent?.changedTouches?.[0];
          if (!start || !touch) return;
          if (Math.abs((touch.pageX ?? start.x) - start.x) < TAP_SLOP_PX && Math.abs((touch.pageY ?? start.y) - start.y) < TAP_SLOP_PX) {
            clearArrival();
          }
        },
      } as Record<string, unknown>);

  // Load shared juz/surah/page index once for the indicator
  useEffect(() => {
    loadMushafIndex(db).then(setMushafIndex).catch((e) => {
      console.warn("[Mushaf] failed to load index:", e);
    });
  }, [db]);

  useEffect(() => {
    if (viewMode === "page") {
      setLoading(false);
      return;
    }
    if (items.length > 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function loadQuran() {
      try {
        setLoading(true);
        setQuranLoadFailed(false);
        const surahs = await db.getAllAsync<SurahRow>(
          "SELECT number, name_arabic, name_english, ayah_count, revelation_type FROM surahs ORDER BY number"
        );
        const surahMap = new Map<number, SurahRow>();
        for (const s of surahs) {
          surahMap.set(s.number, s);
        }

        const ayahs = await db.getAllAsync<AyahRow>(
          "SELECT surah, ayah, text_qcf2, text_uthmani, v2_page FROM quran_text ORDER BY surah, ayah"
        );

        const flatItems: MushafItem[] = [];
        let currentSurah = 0;

        for (const row of ayahs) {
          if (row.surah !== currentSurah) {
            currentSurah = row.surah;
            const surah = surahMap.get(currentSurah);
            if (surah) {
              flatItems.push({
                type: "surah-header",
                surahNumber: surah.number,
                nameArabic: surah.name_arabic,
                nameEnglish: surah.name_english,
                ayahCount: surah.ayah_count,
                revelationType: surah.revelation_type,
              });
            }
          }

          flatItems.push({
            type: "ayah",
            surah: row.surah,
            ayah: row.ayah,
            text: row.text_qcf2,
            textUthmani: row.text_uthmani,
            v2Page: row.v2_page,
          });
        }

        if (!cancelled) {
          setItems(flatItems);
        }
      } catch (err) {
        console.error("[Mushaf] Failed to load Quran data:", err);
        if (!cancelled) setQuranLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadQuran();
    return () => {
      cancelled = true;
    };
  }, [db, items.length, viewMode, quranLoadAttempt]);

  const verseModeHifzAyahs = useMemo<HifzPageAyah[]>(
    () =>
      items
        .filter((item): item is Extract<MushafItem, { type: "ayah" }> =>
          item.type === "ayah" && item.v2Page === currentPage
        )
        .map((item) => ({
          key: `${item.surah}:${item.ayah}`,
          wordCount: Math.max(0, item.text.split(" ").filter(Boolean).length - 1),
        })),
    [currentPage, items]
  );
  const pageModeHifzAyahs = pageModeHifzData?.page === currentPage ? pageModeHifzData.ayahs : EMPTY_HIFZ_PAGE_AYAHS;
  const currentPageHifzAyahs = isPageMode ? pageModeHifzAyahs : verseModeHifzAyahs;

  // ERR-06: the first time weak-spot markers appear on the open page, one dismissible note says what
  // they mean. The dismissal is read only once markers show, and stays on this device.
  const isWeakSpot = useWeakSpotMarker();
  const weakSpotsOnPage = useMemo(
    () =>
      currentPageHifzAyahs.some(({ key, wordCount }) => {
        const [surah, ayah] = key.split(":").map(Number);
        for (let word = 1; word <= Math.max(1, wordCount); word += 1) {
          if (isWeakSpot(surah, ayah, word)) return true;
        }
        return false;
      }),
    [currentPageHifzAyahs, isWeakSpot]
  );
  const [weakSpotNoteSeen, setWeakSpotNoteSeen] = useState<boolean | null>(null);
  useEffect(() => {
    if (!weakSpotsOnPage || weakSpotNoteSeen !== null) return;
    let active = true;
    db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ? AND deleted_at IS NULL", [WEAK_SPOT_NOTE_KEY])
      .then((row) => {
        if (active) setWeakSpotNoteSeen(row?.value === "1");
      })
      .catch(() => {
        if (active) setWeakSpotNoteSeen(true);
      });
    return () => {
      active = false;
    };
  }, [db, weakSpotNoteSeen, weakSpotsOnPage]);
  const dismissWeakSpotNote = useCallback(() => {
    setWeakSpotNoteSeen(true);
    writeUserSetting(db, WEAK_SPOT_NOTE_KEY, "1").catch((e) => console.warn("[Mushaf] failed to save the weak-spot note:", e));
  }, [db]);

  useEffect(() => {
    if (!isPageMode) {
      setPageModeHifzData(null);
      return;
    }
    let cancelled = false;
    db.getAllAsync<{ surah: number; ayah: number; text_qcf2: string }>(
      "SELECT surah, ayah, text_qcf2 FROM quran_text WHERE v2_page = ? ORDER BY surah, ayah",
      [currentPage]
    )
      .then((rows) => {
        if (cancelled) return;
        setPageModeHifzData({
          page: currentPage,
          ayahs: rows.map((row) => ({
            key: `${row.surah}:${row.ayah}`,
            wordCount: Math.max(0, row.text_qcf2.split(" ").filter(Boolean).length - 1),
          })),
        });
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn("[Mushaf] failed to load page hifz ayahs:", e);
          setPageModeHifzData(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentPage, db, isPageMode]);

  const applyHifzProgress = useCallback(
    (next: {
      revealedAyahCount: number;
      activeAyahKey: string | null;
      activeVisibleWordCount: number;
    }) => {
      hifzProgressRef.current = next;
      setHifzRevealedAyahCount(next.revealedAyahCount);
      setHifzActiveAyahKey(next.activeAyahKey);
      setHifzActiveVisibleWordCount(next.activeVisibleWordCount);
    },
    []
  );

  const resetHifzProgress = useCallback(() => {
    applyHifzProgress({
      revealedAyahCount: 0,
      activeAyahKey: null,
      activeVisibleWordCount: 0,
    });
  }, [applyHifzProgress]);

  const commitCurrentPage = useCallback((page: number) => {
    const next = Math.max(1, Math.min(604, Number.isFinite(page) ? Math.round(page) : 1));
    // A new page and its empty reveal state render together.
    if (next !== currentPageRef.current) resetHifzProgress();
    currentPageRef.current = next;
    setCurrentPage(next);
  }, [resetHifzProgress]);

  const clearHifzTimer = useCallback(() => {
    if (hifzAutoTimerRef.current) {
      clearInterval(hifzAutoTimerRef.current);
      hifzAutoTimerRef.current = null;
    }
  }, []);

  const stopHifzAuto = useCallback(() => {
    clearHifzTimer();
    setHifzAutoRunning(false);
  }, [clearHifzTimer]);

  // A jump stops auto reveal. commitCurrentPage clears reveals when the page changes.
  const resetHifzForNavigation = useCallback(() => {
    if (!hifzEnabledRef.current) return;
    stopHifzAuto();
  }, [stopHifzAuto]);

  const handleHifzPageComplete = useCallback(() => {
    const page = currentPageRef.current;
    if (hifzAutoAdvancePageRef.current && page < 604 && goToPageRef.current) {
      hifzAutoPageChangeRef.current = true;
      resetHifzProgress();
      goToPageRef.current(page + 1);
      return;
    }
    stopHifzAuto();
  }, [resetHifzProgress, stopHifzAuto]);

  // One reveal step: the next word, finishing the ayah at its last word. A manual step never
  // completes or advances the page.
  const stepHifzAuto = useCallback((manual = false) => {
    if (!hifzEnabledRef.current) {
      stopHifzAuto();
      return;
    }
    const { page, ayahs: pageAyahs } = hifzCurrentPageAyahsRef.current;
    if (page !== currentPageRef.current || pageAyahs.length === 0) return;

    const progress = hifzProgressRef.current;
    let activeAyahKey = progress.activeAyahKey;
    let activeVisibleWordCount = progress.activeVisibleWordCount;
    let activeIndex = activeAyahKey
      ? pageAyahs.findIndex((ayah) => ayah.key === activeAyahKey)
      : -1;

    if (activeIndex < 0) {
      if (progress.revealedAyahCount >= pageAyahs.length) {
        if (!manual) handleHifzPageComplete();
        return;
      }
      activeIndex = progress.revealedAyahCount;
      activeAyahKey = pageAyahs[activeIndex]?.key ?? null;
      activeVisibleWordCount = 0;
    }

    const activeAyah = pageAyahs[activeIndex];
    if (!activeAyah || !activeAyahKey) {
      if (!manual) handleHifzPageComplete();
      return;
    }

    if (activeAyah.wordCount <= 0 || activeVisibleWordCount + 1 >= activeAyah.wordCount) {
      const revealedAyahCount = Math.max(progress.revealedAyahCount, activeIndex + 1);
      applyHifzProgress({
        revealedAyahCount,
        activeAyahKey: null,
        activeVisibleWordCount: 0,
      });
      if (revealedAyahCount >= pageAyahs.length && !manual) {
        if (!hifzAutoAdvancePageRef.current || currentPageRef.current >= 604) {
          handleHifzPageComplete();
        }
      }
      return;
    }

    applyHifzProgress({
      revealedAyahCount: progress.revealedAyahCount,
      activeAyahKey,
      activeVisibleWordCount: activeVisibleWordCount + 1,
    });
  }, [applyHifzProgress, handleHifzPageComplete, stopHifzAuto]);

  useEffect(() => {
    hifzCurrentPageAyahsRef.current = { page: currentPage, ayahs: currentPageHifzAyahs };
  }, [currentPage, currentPageHifzAyahs]);

  useEffect(() => {
    hifzEnabledRef.current = hifzEnabled;
  }, [hifzEnabled]);

  useEffect(() => {
    hifzAutoAdvancePageRef.current = hifzAutoAdvancePage;
  }, [hifzAutoAdvancePage]);

  useEffect(() => {
    clearHifzTimer();
    if (!hifzAutoRunning) return;
    hifzAutoTimerRef.current = setInterval(() => stepHifzAuto(), hifzAutoDelayMs);
    return clearHifzTimer;
  }, [clearHifzTimer, hifzAutoDelayMs, hifzAutoRunning, stepHifzAuto]);

  useEffect(() => () => {
    clearHifzTimer();
  }, [clearHifzTimer]);

  useEffect(() => () => {
    clearVerseScrollRetry();
  }, [clearVerseScrollRetry]);

  const scrollToTarget = useCallback(
    async (target: MushafTarget, animated = true): Promise<VerseScrollResult | null> => {
      if (viewMode === "verse") {
        const idx = items.findIndex(
          (item) => item.type === "ayah" && item.surah === target.surah && item.ayah === target.ayah
        );
        if (idx >= 0) {
          const item = items[idx];
          if (item?.type === "ayah") {
            await loadQuranPageFont(quranFontStyle, item.v2Page);
          }
          // A surah's first ayah opens on its header, so the reader sees which surah begins.
          const previous = items[idx - 1];
          const scrollIndex =
            target.ayah === 1 && previous?.type === "surah-header" && previous.surahNumber === target.surah
              ? idx - 1
              : idx;
          const result = await scheduleVerseScrollToIndex(scrollIndex, animated);
          setTopAyah({ surah: target.surah, ayah: target.ayah });
          if (item?.type === "ayah") {
            commitCurrentPage(item.v2Page);
          }
          return result;
        }
        return null;
      }

      const ayahItem = items.find(
        (item) => item.type === "ayah" && item.surah === target.surah && item.ayah === target.ayah
      );
      let page = ayahItem?.type === "ayah" ? ayahItem.v2Page : null;
      if (!page) {
        const row = await db.getFirstAsync<{ v2_page: number }>(
          "SELECT v2_page FROM quran_text WHERE surah = ? AND ayah = ?",
          [target.surah, target.ayah]
        );
        page = row?.v2_page ?? null;
      }
      // Committed through the page prop, which PageMushaf applies once its pages have loaded; a direct
      // jump on a cold reader was dropped (as for the saved-position restore). The direct jump still
      // runs so a loaded reader returns to the top of the page it is already on.
      if (page) {
        commitCurrentPage(page);
        goToPageRef.current?.(page);
      }
      return null;
    },
    [commitCurrentPage, db, items, quranFontStyle, scheduleVerseScrollToIndex, viewMode]
  );

  const [retryTarget, setRetryTarget] = useState<MushafTarget | null>(null);
  const navigateToTarget = useCallback(
    (target: MushafTarget, animated = true) => {
      tapRevealGuardUntilRef.current = Date.now() + 1500;
      pauseFocusAutoScroll();
      // Auto reveal stops; its progress resets only if the page actually changes (see the
      // currentPage effect), so a same-page jump keeps what was revealed.
      resetHifzForNavigation();
      suspendFollowRef.current();
      setRetryTarget(null);
      void scrollToTarget(target, animated)
        .then((result) => {
          // Measurement never confirmed the target: offer an explicit retry instead of guessing.
          if (result === "failed") setRetryTarget(target);
        })
        .catch((e) => {
          console.warn("[Mushaf] target navigation failed:", e);
        })
        .finally(() => {
          startArrival(target);
        });
    },
    [pauseFocusAutoScroll, resetHifzForNavigation, scrollToTarget, startArrival]
  );

  // ---- C06 target contract and the shared "Back to where I was" pill ----
  const ownerId = useAuthStore((state) => state.user?.id ?? null);
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;
  // The saved position, read once so a jump can offer it back and hydration can apply it.
  const savedPositionRef = useRef<ReaderPosition | null>(null);
  const [savedPositionLoaded, setSavedPositionLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = 'last_mushaf_position'")
      .then((row) => {
        if (active) savedPositionRef.current = parseSavedPosition(row?.value);
      })
      .catch((e) => console.warn("[Mushaf] reading the saved position failed:", e))
      .finally(() => {
        if (active) setSavedPositionLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [db]);

  const [returnToken, setReturnToken] = useState<ReturnToken | null>(null);
  const returnSeqRef = useRef(0);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissReturn = useCallback(() => {
    if (returnTimerRef.current) {
      clearTimeout(returnTimerRef.current);
      returnTimerRef.current = null;
    }
    setReturnToken((current) => (current ? null : current));
  }, []);
  useEffect(() => dismissReturn, [dismissReturn]);
  // Another account never restores this account's position.
  useEffect(() => {
    dismissReturn();
  }, [dismissReturn, ownerId]);

  const currentReaderPosition = useCallback((): ReaderPosition | null => {
    if (!positionSessionRef.current.restoreSettled) return savedPositionRef.current;
    if (isPageMode) return { mode: "page", page: currentPageRef.current };
    const top = topAyahRef.current;
    return top ? { mode: "verse", surah: top.surah, ayah: top.ayah } : savedPositionRef.current;
  }, [isPageMode]);

  /** An explicit jump: capture the return position once, hold saving, then move and wash. */
  const performJump = useCallback(
    (target: MushafTarget) => {
      const id = ++returnSeqRef.current;
      const token = captureReturnToken(currentReaderPosition(), ownerRef.current, id);
      if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
      returnTimerRef.current = token
        ? setTimeout(() => {
            returnTimerRef.current = null;
            setReturnToken((current) => expireReturnToken(current, id));
          }, RETURN_PILL_MS)
        : null;
      setReturnToken(token);
      dispatchPosition("explicit-jump");
      navigateToTarget(target, false);
    },
    [currentReaderPosition, dispatchPosition, navigateToTarget]
  );

  // A target waits until no reader overlay is open (the commit that closed the opening sheet) and
  // the reader's data is ready, then moves the reader exactly once.
  const queuedTargetRef = useRef<MushafTarget | null>(null);
  const [targetQueueVersion, setTargetQueueVersion] = useState(0);
  const requestTarget = useCallback(
    (target: MushafTarget) => {
      queuedTargetRef.current = target;
      // Recorded now, so a saved-position read finishing later cannot move the reader away.
      dispatchPosition("explicit-jump");
      setTargetQueueVersion((version) => version + 1);
    },
    [dispatchPosition]
  );
  const readerOverlayOpen =
    showNavigator || showBookmarks || showSearch || showRecitation || showReadingSettings || showHelp || detailWord !== null;
  const readerDataReady = settingsLoaded && !loading && (isPageMode || items.length > 0);
  useEffect(() => {
    const target = queuedTargetRef.current;
    if (!target || readerOverlayOpen || !readerDataReady) return;
    queuedTargetRef.current = null;
    performJump(target);
  }, [performJump, readerDataReady, readerOverlayOpen, targetQueueVersion]);

  // Links, Search, bookmarks and other screens submit through the target store; it is consumed once.
  const consumeLinkTarget = useCallback(() => {
    const target = consumePendingDeepLink();
    if (target) requestTarget(target);
  }, [requestTarget]);
  useFocusEffect(
    useCallback(() => {
      consumeLinkTarget();
      const unsubscribe = subscribePendingDeepLink(consumeLinkTarget);
      return () => {
        unsubscribe();
        // Leaving the reader dismisses the return pill.
        dismissReturn();
      };
    }, [consumeLinkTarget, dismissReturn])
  );

  // Restores a captured or saved position in its own mode, switching view first when needed.
  const pendingPositionRef = useRef<ReaderPosition | null>(null);
  const [pendingPositionVersion, setPendingPositionVersion] = useState(0);
  const applyPosition = useCallback(
    (position: ReaderPosition) => {
      tapRevealGuardUntilRef.current = Date.now() + 1500;
      if (position.mode === "page") {
        if (goToPageRef.current) goToPageRef.current(position.page);
        else commitCurrentPage(position.page);
        return;
      }
      const idx = items.findIndex((it) => it.type === "ayah" && it.surah === position.surah && it.ayah === position.ayah);
      if (idx < 0) return;
      setTopAyah({ surah: position.surah, ayah: position.ayah });
      void scheduleVerseScrollToIndex(idx, false);
    },
    [commitCurrentPage, items, scheduleVerseScrollToIndex]
  );
  useEffect(() => {
    const position = pendingPositionRef.current;
    if (!position || position.mode !== viewMode || !readerDataReady) return;
    pendingPositionRef.current = null;
    applyPosition(position);
  }, [applyPosition, pendingPositionVersion, readerDataReady, viewMode]);

  const restoreReturn = useCallback(() => {
    const current = returnToken;
    if (!current) return;
    const { position } = takeReturnToken(current, current.id, ownerRef.current);
    dismissReturn();
    if (!position) return;
    markDeliberateMovement();
    // Returning is explicit navigation: a following recitation waits for Back to ayah.
    suspendFollowRef.current();
    pendingPositionRef.current = position;
    if (position.mode !== viewMode) setViewMode(position.mode);
    setPendingPositionVersion((version) => version + 1);
  }, [dismissReturn, markDeliberateMovement, returnToken, setViewMode, viewMode]);

  const handleVerseRevealChange = useCallback((surah: number, ayah: number, revealed: boolean, page: number) => {
    setVerseReveals((prev) => setVerseReveal(prev, surah, ayah, page, revealed));
  }, []);
  // Turning hide mode on or off starts from no reveals.
  const toggleVerseHideMode = useCallback(() => {
    setVerseHideMode((prev) => !prev);
    setVerseReveals(NO_VERSE_REVEALS);
  }, []);
  // A deliberate scroll or jump to another page keeps only that page's reveals.
  useEffect(() => {
    setVerseReveals((prev) => keepPageReveals(prev, currentPage));
  }, [currentPage]);

  const renderItem = useCallback(
    ({ item }: { item: MushafItem }) => {
      if (item.type === "surah-header") {
        return (
          <SurahHeader
            surahNumber={item.surahNumber}
            nameArabic={item.nameArabic}
            nameEnglish={item.nameEnglish}
            ayahCount={item.ayahCount}
            revelationType={item.revelationType}
          />
        );
      }
      return (
        <AyahBlock
          surah={item.surah}
          ayah={item.ayah}
          text={item.text}
          textUthmani={item.textUthmani}
          v2Page={item.v2Page}
          fontSize={fontSize}
          lineHeight={lineHeight}
          hideMode={verseHideMode}
          revealed={verseReveals.has(`${item.surah}:${item.ayah}`)}
          onRevealChange={handleVerseRevealChange}
          highlighted={displayedHighlightKey === `${item.surah}:${item.ayah}`}
          highlightedWordPos={
            highlightedWord?.surah === item.surah && highlightedWord?.ayah === item.ayah
              ? highlightedWord.wordPos
              : null
          }
        />
      );
    },
    [fontSize, lineHeight, verseHideMode, verseReveals, handleVerseRevealChange, displayedHighlightKey, highlightedWord]
  );

  const getItemType = useCallback((item: MushafItem) => item.type, []);

  const keyExtractor = useCallback(
    (item: MushafItem, _index: number) =>
      item.type === "surah-header"
        ? `header-${item.surahNumber}`
        : `ayah-${item.surah}-${item.ayah}`,
    []
  );

  // Go to closes first; the target then waits for that close like any other explicit jump.
  const handleGoToTarget = useCallback(
    (target: GoToTarget) => {
      setShowNavigator(false);
      if (target.kind === "ayah") {
        requestTarget({ surah: target.surah, ayah: target.ayah });
        return;
      }
      const first = mushafIndex ? topmostAyahForPage(mushafIndex, target.page) : null;
      if (first) requestTarget(first);
      else if (goToPageRef.current) {
        resetHifzForNavigation();
        suspendFollowRef.current();
        goToPageRef.current(target.page);
      }
    },
    [mushafIndex, requestTarget, resetHifzForNavigation]
  );

  const handleBookmarkNavigate = useCallback(
    (surah: number, ayah: number, wordPos?: number) => {
      requestTarget({ surah, ayah, wordPos });
    },
    [requestTarget]
  );

  const handleOpenBookmarks = useCallback(() => {
    pauseFocusAutoScroll();
    setShowBookmarks(true);
  }, [pauseFocusAutoScroll]);

  const handleOpenSearch = useCallback(() => {
    pauseFocusAutoScroll();
    setShowSearch(true);
  }, [pauseFocusAutoScroll]);

  const handleOpenRecitation = useCallback(() => {
    pauseFocusAutoScroll();
    setShowRecitation(true);
  }, [pauseFocusAutoScroll]);

  const handleOpenNavigator = useCallback((tab: GoToTab = "surah") => {
    pauseFocusAutoScroll();
    setNavigatorTab(tab);
    setShowNavigator(true);
  }, [pauseFocusAutoScroll]);

  const handleOpenHelp = useCallback(() => {
    pauseFocusAutoScroll();
    setShowHelp(true);
  }, [pauseFocusAutoScroll]);

  const handleOpenReadingSettings = useCallback(() => {
    pauseFocusAutoScroll();
    setShowReadingSettings(true);
  }, [pauseFocusAutoScroll]);

  const handleGoHome = useCallback(() => {
    pauseFocusAutoScroll();
    router.navigate("/(tabs)/home");
  }, [pauseFocusAutoScroll]);

  // A view switch keeps the top visible ayah (including a tall one) and washes it so it is easy to
  // find in the other view. It counts as deliberate movement, so the new position is saved.
  const toggleViewMode = useCallback(() => {
    markDeliberateMovement();
    if (isPageMode) {
      pendingVersePageRef.current = currentPageRef.current;
      pendingVerseAnchorRef.current =
        pageTopAyahRef.current?.() ?? (mushafIndex ? topmostAyahForPage(mushafIndex, currentPageRef.current) : null);
      setViewMode("verse");
      return;
    }
    if (topAyah) {
      const ayahItem = items.find(
        (item) => item.type === "ayah" && item.surah === topAyah.surah && item.ayah === topAyah.ayah
      );
      if (ayahItem?.type === "ayah") {
        commitCurrentPage(ayahItem.v2Page);
      }
      startArrival(topAyah);
    }
    setViewMode("page");
  }, [commitCurrentPage, isPageMode, items, markDeliberateMovement, mushafIndex, setViewMode, startArrival, topAyah]);
  const canUseFocusMode = isPageMode && pageScroll === "vertical" && !hifzEnabled;
  const showHifzControls = isPageMode && hifzEnabled && !focusModeActive;
  const showBottomSlider = isPageMode && !focusModeActive && !hifzEnabled;
  const hifzVisibility = useMemo<HifzVisibility | null>(
    () =>
      showHifzControls
        ? {
            enabled: true,
            page: currentPage,
            revealedAyahCount: hifzRevealedAyahCount,
            activeAyahKey: hifzActiveAyahKey,
            activeVisibleWordCount: hifzActiveVisibleWordCount,
          }
        : null,
    [
      currentPage,
      hifzActiveAyahKey,
      hifzActiveVisibleWordCount,
      hifzRevealedAyahCount,
      showHifzControls,
    ]
  );
  const canRevealNextHifzAyah =
    showHifzControls &&
    currentPageHifzAyahs.length > 0 &&
    (hifzRevealedAyahCount < currentPageHifzAyahs.length || hifzActiveAyahKey !== null);
  const canHidePreviousHifzAyah =
    showHifzControls && (hifzRevealedAyahCount > 0 || hifzActiveAyahKey !== null);
  // While auto reveal still runs (about to advance a page) Pause stays reachable instead.
  const hifzPageComplete =
    showHifzControls &&
    !hifzAutoRunning &&
    currentPageHifzAyahs.length > 0 &&
    hifzActiveAyahKey === null &&
    hifzRevealedAyahCount >= currentPageHifzAyahs.length;
  const toggleHifzMode = useCallback(() => {
    if (hifzEnabled) {
      stopHifzAuto();
      resetHifzProgress();
      setHifzEnabled(false);
      return;
    }
    resetHifzProgress();
    setHifzEnabled(true);
    setChromeVisible(true);
  }, [hifzEnabled, resetHifzProgress, setChromeVisible, stopHifzAuto]);
  const revealNextHifzAyah = useCallback(() => {
    stopHifzAuto();
    const activeIndex = hifzActiveAyahKey
      ? currentPageHifzAyahs.findIndex((ayah) => ayah.key === hifzActiveAyahKey)
      : -1;
    applyHifzProgress({
      revealedAyahCount: Math.min(
        currentPageHifzAyahs.length,
        activeIndex >= 0 ? activeIndex + 1 : hifzRevealedAyahCount + 1
      ),
      activeAyahKey: null,
      activeVisibleWordCount: 0,
    });
  }, [
    applyHifzProgress,
    currentPageHifzAyahs,
    hifzActiveAyahKey,
    hifzRevealedAyahCount,
    stopHifzAuto,
  ]);
  const hidePreviousHifzAyah = useCallback(() => {
    stopHifzAuto();
    if (hifzActiveAyahKey) {
      applyHifzProgress({
        revealedAyahCount: hifzRevealedAyahCount,
        activeAyahKey: null,
        activeVisibleWordCount: 0,
      });
      return;
    }
    applyHifzProgress({
      revealedAyahCount: Math.max(0, hifzRevealedAyahCount - 1),
      activeAyahKey: null,
      activeVisibleWordCount: 0,
    });
  }, [applyHifzProgress, hifzActiveAyahKey, hifzRevealedAyahCount, stopHifzAuto]);
  // Play reveals the first word at once, then waits the interval, so it answers even at slow speeds.
  const startHifzAuto = useCallback(() => {
    if (!hifzEnabled) setHifzEnabled(true);
    setHifzAutoRunning(true);
    stepHifzAuto();
  }, [hifzEnabled, stepHifzAuto]);
  const revealNextHifzWord = useCallback(() => {
    stopHifzAuto();
    stepHifzAuto(true);
  }, [stepHifzAuto, stopHifzAuto]);
  const repeatHifzPage = useCallback(() => {
    stopHifzAuto();
    resetHifzProgress();
  }, [resetHifzProgress, stopHifzAuto]);
  const goToNextHifzPage = useCallback(() => {
    if (currentPageRef.current < 604) goToPageRef.current?.(currentPageRef.current + 1);
  }, []);
  const pageFontSizeLocked = isPageMode && pageScroll === "horizontal";
  const mobileBottomNavHeight = 54;
  const mobileBottomNavGap = 6;
  const mobileBottomNavOffset = isPhone
    ? Math.max(insets.bottom, 10) + mobileBottomNavHeight + mobileBottomNavGap
    : 0;
  const railBottomOffset = isPhone
    ? mobileBottomNavOffset
    : isTablet
      ? Math.max(insets.bottom, 16)
      : 0;
  const [railHeight, setRailHeight] = useState(60);
  // The player bar sits above the page rail while it shows; the return pill sits above both.
  const playerBarBottom =
    railBottomOffset + (showHifzControls || (showBottomSlider && chromeVisible) ? railHeight + 8 : 8);
  // Mirrors RecitationPlayerBar's own rule: every session except a reciter preview shows the bar.
  const playerBarVisible = !!audioSession && audioSession.kind !== "preview";
  const pageScrollBottomInset = focusModeActive ? Math.max(insets.bottom, 12) + 96 : isPageMode ? 8 : undefined;
  const floatingRailSurface = {
    backgroundColor: withThemeOpacity(themeSurface, 0.95),
    borderWidth: 1,
    borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.72)",
    shadowColor: "#000",
    shadowOpacity: isDark ? 0.24 : 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  } as const;
  // Vertical page view keeps the toolbar in the layout, as verse view does, so it never covers the
  // top of a page. Only horizontal paging floats it: those pages are fitted to the screen height and
  // must not re-fit when the toolbar hides.
  const pageHeaderOverlayStyle = isPageMode && pageScroll === "horizontal"
    ? ({
        position: Platform.OS === "web" && (isPhone || isTablet) ? ("fixed" as any) : "absolute",
        // An absolute child ignores the SafeAreaView's top padding, so native must add the inset
        // itself or the toolbar draws under the status bar.
        top: Platform.OS === "web" ? 0 : insets.top,
        left: 0,
        right: 0,
        zIndex: 80,
      } as const)
    : null;

  const enterFocusMode = useCallback(() => {
    if (!canUseFocusMode) return;
    resetHifzProgress();
    stopHifzAuto();
    setHifzEnabled(false);
    clearFocusControlsTimer();
    setFocusToastMessage(null);
    setFocusModeActive(true);
    // Focus mode opens paused with its bar shown; scrolling starts on Play.
    setFocusModePlaying(false);
    setFocusControlsVisible(true);
    setImmersive(true);
    setChromeVisible(false);
  }, [canUseFocusMode, clearFocusControlsTimer, resetHifzProgress, setChromeVisible, setImmersive, stopHifzAuto]);

  const exitFocusMode = useCallback(() => {
    clearFocusControlsTimer();
    setFocusModeActive(false);
    setFocusModePlaying(false);
    setFocusControlsVisible(false);
    setFocusToastMessage(null);
    setImmersive(false);
    setChromeVisible(true);
  }, [clearFocusControlsTimer, setChromeVisible, setImmersive]);

  // Tab screens stay mounted, so the hidden bar and focus mode must end when the reader loses
  // focus; otherwise every other tab is left without its tab bar.
  const exitFocusModeRef = useRef(exitFocusMode);
  exitFocusModeRef.current = exitFocusMode;
  useFocusEffect(
    useCallback(() => {
      return () => exitFocusModeRef.current();
    }, [])
  );

  // Android Back leaves focus mode before it leaves the reader.
  useEffect(() => {
    if (Platform.OS !== "android" || !focusModeActive) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      exitFocusModeRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [focusModeActive]);

  const handleFocusSpeedChange = useCallback(
    (speed: number) => {
      setFocusScrollSpeed(speed);
      revealFocusControls();
    },
    [revealFocusControls, setFocusScrollSpeed]
  );

  const handleFocusPlayPause = useCallback(() => {
    setFocusModePlaying((playing) => !playing);
    setFocusControlsVisible(true);
  }, []);

  const handleFocusAutoScrollEnd = useCallback(() => {
    clearFocusControlsTimer();
    setFocusModePlaying(false);
    setFocusControlsVisible(true);
    setFocusToastMessage(s.focusEndReached);
  }, [clearFocusControlsTimer, s.focusEndReached]);

  useEffect(() => {
    clearFocusControlsTimer();
    if (!focusModeActive) {
      setFocusControlsVisible(false);
      return;
    }
    setFocusControlsVisible(true);
    if (focusModePlaying) {
      focusControlsTimerRef.current = setTimeout(() => {
        setFocusControlsVisible(false);
        focusControlsTimerRef.current = null;
      }, 2500);
    }
    return clearFocusControlsTimer;
  }, [clearFocusControlsTimer, focusModeActive, focusModePlaying]);

  useEffect(() => {
    setImmersive(focusModeActive);
    if (focusModeActive) {
      setChromeVisible(false);
    }
  }, [focusModeActive, setChromeVisible, setImmersive]);

  useEffect(() => {
    if (focusModeActive && !canUseFocusMode) {
      exitFocusMode();
    }
  }, [canUseFocusMode, exitFocusMode, focusModeActive]);

  useEffect(() => {
    if (!focusModeActive) return;
    if (showNavigator || showBookmarks || showSearch || showRecitation || showReadingSettings || showHelp || selection || detailWord) {
      pauseFocusAutoScroll();
    }
  }, [
    detailWord,
    focusModeActive,
    pauseFocusAutoScroll,
    selection,
    showBookmarks,
    showHelp,
    showNavigator,
    showReadingSettings,
    showRecitation,
    showSearch,
  ]);

  useEffect(() => {
    return () => {
      clearFocusControlsTimer();
      setImmersive(false);
      setChromeVisible(true);
    };
  }, [clearFocusControlsTimer, setChromeVisible, setImmersive]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    if (!hifzEnabled) return;
    if (hifzAutoPageChangeRef.current) {
      hifzAutoPageChangeRef.current = false;
      return;
    }
    stopHifzAuto();
  }, [currentPage, hifzEnabled, stopHifzAuto]);

  // Verse view has no reveal rail: auto reveal stops, the page's reveals wait for the return.
  useEffect(() => {
    if (isPageMode || !hifzEnabled) return;
    stopHifzAuto();
  }, [hifzEnabled, isPageMode, stopHifzAuto]);

  // For page view, derive the topmost ayah from the visible page
  useEffect(() => {
    if (!isPageMode || !mushafIndex) return;
    const top = topmostAyahForPage(mushafIndex, currentPage);
    if (top) setTopAyah(top);
  }, [currentPage, mushafIndex, isPageMode]);

  // Persist the last deliberately read position (debounced). A pending save is flushed at once when
  // the app goes to the background, the web page hides or the reader unmounts, so leaving within
  // 600 ms of the last scroll keeps it. An arrival the reader never engaged with is not saved.
  const lastSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<ReaderPosition | null>(null);
  const flushPendingPosition = useCallback(() => {
    if (lastSaveTimerRef.current) {
      clearTimeout(lastSaveTimerRef.current);
      lastSaveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (!pending || !mayPersistPosition(positionSessionRef.current)) return;
    writeUserSetting(db, "last_mushaf_position", serializePosition(pending)).catch(() => {});
  }, [db]);
  useEffect(() => {
    if (loading) return;
    const value: ReaderPosition | null = isPageMode
      ? { mode: "page", page: currentPage }
      : topAyah
        ? { mode: "verse", surah: topAyah.surah, ayah: topAyah.ayah }
        : null;
    if (!value) return;
    pendingSaveRef.current = value;
    if (lastSaveTimerRef.current) clearTimeout(lastSaveTimerRef.current);
    lastSaveTimerRef.current = setTimeout(() => {
      lastSaveTimerRef.current = null;
      flushPendingPosition();
    }, 600);
    // The top ayah's surah and ayah, not its object identity, decide a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushPendingPosition, loading, isPageMode, currentPage, topAyah?.surah, topAyah?.ayah]);
  const flushPendingPositionRef = useRef(flushPendingPosition);
  flushPendingPositionRef.current = flushPendingPosition;
  useEffect(() => {
    const leave = () => {
      flushPendingPositionRef.current();
      dismissReturn();
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") leave();
    });
    const onPageHide = () => flushPendingPositionRef.current();
    if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);
    return () => {
      subscription.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
      flushPendingPositionRef.current();
    };
  }, [dismissReturn]);

  // Restore the saved position once the reader's data is ready, converting it to the current view
  // (a saved page opens verse view at its first ayah, a saved ayah opens page view at its page). An
  // explicit target that already arrived wins, and hydration finishing later cannot move the reader.
  const restoredOnceRef = useRef(false);
  useEffect(() => {
    if (restoredOnceRef.current) return;
    if (!savedPositionLoaded || loading || !mushafIndex || (!isPageMode && items.length === 0)) return;
    restoredOnceRef.current = true;
    const settle = () => dispatchPosition("restore-settled");
    const saved = savedPositionRef.current;
    const explicitWins = () =>
      !mayApplySavedPosition(positionSessionRef.current) || peekPendingDeepLink() !== null || queuedTargetRef.current !== null;
    const position = saved ? positionForMode(mushafIndex, saved, viewMode) : null;
    if (!position || explicitWins()) {
      settle();
      return;
    }
    if (position.mode === "page") {
      // Committed through the page prop: PageMushaf applies it once its page data has loaded,
      // whereas a direct jump before then was silently dropped.
      if (position.page > 1 && currentPageRef.current === 1) {
        tapRevealGuardUntilRef.current = Date.now() + 1500;
        commitCurrentPage(position.page);
      }
      settle();
      return;
    }
    const idx = items.findIndex((it) => it.type === "ayah" && it.surah === position.surah && it.ayah === position.ayah);
    if (idx < 0) {
      settle();
      return;
    }
    setTimeout(() => {
      if (explicitWins()) {
        settle();
        return;
      }
      setTopAyah({ surah: position.surah, ayah: position.ayah });
      // Saving starts once the restored ayah is in view, so the first rows never overwrite it.
      void scheduleVerseScrollToIndex(idx, false).finally(settle);
    }, 150);
  }, [savedPositionLoaded, loading, items, mushafIndex, isPageMode, viewMode, scheduleVerseScrollToIndex, commitCurrentPage, dispatchPosition]);

  // The reader follows a range recitation onto the page, or verse, being recited, until the reader
  // scrolls, pages or jumps away; Back to ayah brings it back.
  const followRecitedAyah = useCallback(
    ({ surah, ayah }: AyahAudioTarget) => {
      tapRevealGuardUntilRef.current = Date.now() + 1500;
      if (isPageMode) {
        if (!mushafIndex) return;
        const page = pageForAyah(mushafIndex, surah, ayah);
        if (page && page !== currentPageRef.current) goToPageRef.current?.(page);
        return;
      }
      const idx = items.findIndex((it) => it.type === "ayah" && it.surah === surah && it.ayah === ayah);
      if (idx >= 0) flashListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.2 });
    },
    [isPageMode, items, mushafIndex]
  );
  const { suspended: followSuspended, suspend: suspendFollow, backToAyah } = useFollowRecitation({
    followEnabled: audioFollow,
    rangeActive: recitation.active,
    recitingAyah: recitation.active ? recitation.currentAyah : null,
    follow: followRecitedAyah,
  });
  suspendFollowRef.current = suspendFollow;

  // C07 keyboard priority (web). Editable fields, composition, focused controls, menus and overlays
  // come first; focus scrolling owns Space and Escape while it runs. Otherwise PageDown/Space page
  // forward, PageUp/Shift+Space back, arrows keep their page direction, Ctrl/Cmd+K and "/" open
  // Search, and "?" opens the shortcuts help. Only a handled key prevents the browser default.
  const keyboardStateRef = useRef({ readerOverlayOpen, focusModeActive, isPageMode, windowHeight });
  keyboardStateRef.current = { readerOverlayOpen, focusModeActive, isPageMode, windowHeight };
  useEffect(() => {
    if (!isFocused || Platform.OS !== "web" || typeof window === "undefined") return;
    const pageBy = (direction: 1 | -1) => {
      const { isPageMode: pageMode, windowHeight: viewportHeight } = keyboardStateRef.current;
      markDeliberateMovement();
      suspendFollowRef.current();
      if (pageMode) {
        const next = Math.max(1, Math.min(604, currentPageRef.current + direction));
        goToPageRef.current?.(next);
        return;
      }
      const offset = Math.max(0, lastScrollYRef.current + direction * viewportHeight * 0.85);
      flashListRef.current?.scrollToOffset({ offset, animated: true });
    };
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (isEditableTarget(e.target)) return;
      const state = keyboardStateRef.current;
      // Overlays and menus own their keys (C07): ResponsiveOverlay and DropdownMenu register in the
      // shared layer stack; a reader sheet flag or any other modal also yields.
      if (state.readerOverlayOpen || hasOpenOverlay() || anyModalOpen()) return;
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key ?? "").toLowerCase() === "k") {
        e.preventDefault();
        handleOpenSearch();
        return;
      }
      if (plain && e.key === "/") {
        e.preventDefault();
        handleOpenSearch();
        return;
      }
      if (plain && e.key === "?") {
        e.preventDefault();
        handleOpenHelp();
        return;
      }
      if (!plain) return;
      if (state.focusModeActive && (e.key === " " || e.key === "Escape")) return;
      if (e.key === " " && isActivatableControl(e.target)) return;
      if (e.key === "PageDown" || (e.key === " " && !e.shiftKey)) {
        e.preventDefault();
        pageBy(1);
        return;
      }
      if (e.key === "PageUp" || (e.key === " " && e.shiftKey)) {
        e.preventDefault();
        pageBy(-1);
        return;
      }
      if (state.isPageMode && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey) {
        // The Mushaf pages right to left in both UI languages: ArrowLeft advances, ArrowRight goes back.
        e.preventDefault();
        pageBy(e.key === "ArrowLeft" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleOpenHelp, handleOpenSearch, isFocused, markDeliberateMovement]);

  // Verse view: the current ayah is the first one at least half visible. An ayah taller than twice
  // the viewport can never reach that, so the ayah covering the top edge counts when none does.
  const primaryTopAyahRef = useRef<Extract<MushafItem, { type: "ayah" }> | null>(null);
  const edgeTopAyahRef = useRef<Extract<MushafItem, { type: "ayah" }> | null>(null);
  const viewabilityConfigCallbackPairs = useRef(
    (() => {
      const firstAyah = (viewableItems: Array<{ item: MushafItem }>) =>
        (viewableItems.map((v) => v.item).find((it) => it.type === "ayah") as Extract<MushafItem, { type: "ayah" }> | undefined) ??
        null;
      const apply = () => {
        const ayah = primaryTopAyahRef.current ?? edgeTopAyahRef.current;
        if (!ayah) return;
        setTopAyah((current) => (current?.surah === ayah.surah && current.ayah === ayah.ayah ? current : { surah: ayah.surah, ayah: ayah.ayah }));
        commitCurrentPage(ayah.v2Page);
      };
      return [
        {
          viewabilityConfig: { itemVisiblePercentThreshold: 50 },
          onViewableItemsChanged: ({ viewableItems }: { viewableItems: Array<{ item: MushafItem }> }) => {
            primaryTopAyahRef.current = firstAyah(viewableItems);
            apply();
          },
        },
        {
          viewabilityConfig: { itemVisiblePercentThreshold: 0 },
          onViewableItemsChanged: ({ viewableItems }: { viewableItems: Array<{ item: MushafItem }> }) => {
            edgeTopAyahRef.current = firstAyah(viewableItems);
            apply();
          },
        },
      ];
    })()
  ).current;

  const initialVerseIndex = useMemo(() => {
    if (items.length === 0) return undefined;
    const page = pendingVersePageRef.current ?? currentPageRef.current;
    const index = items.findIndex((item) => item.type === "ayah" && item.v2Page === page);
    return index >= 0 ? index : undefined;
  }, [currentPage, items, viewMode]);

  useEffect(() => {
    if (viewMode !== "verse" || pendingVersePageRef.current == null || items.length === 0) return;
    const page = pendingVersePageRef.current;
    const anchor = pendingVerseAnchorRef.current;
    const anchorIndex = anchor
      ? items.findIndex((item) => item.type === "ayah" && item.surah === anchor.surah && item.ayah === anchor.ayah)
      : -1;
    const index = anchorIndex >= 0 ? anchorIndex : items.findIndex((item) => item.type === "ayah" && item.v2Page === page);
    if (index < 0) return;
    pendingVersePageRef.current = null;
    pendingVerseAnchorRef.current = null;
    void scheduleVerseScrollToIndex(index, false);
    if (anchor && anchorIndex >= 0) {
      setTopAyah(anchor);
      startArrival(anchor);
    }
  }, [items, scheduleVerseScrollToIndex, startArrival, viewMode]);

  // Resolve indicator labels from current top ayah
  const indicator = (() => {
    if (!mushafIndex || !topAyah) {
      return {
        name: null as string | null,
        juz: null as number | null,
        hizb: null as number | null,
      };
    }
    const sm = mushafIndex.surahByNumber.get(topAyah.surah);
    const juz = findJuzForAyah(mushafIndex, topAyah.surah, topAyah.ayah);
    const hizb = findHizbForAyah(mushafIndex, topAyah.surah, topAyah.ayah);
    const name = uiLanguage === "ar" ? sm?.name_arabic : sm?.name_english;
    return { name: name ?? null, juz, hizb };
  })();
  const dismissFocusToast = useCallback(() => setFocusToastMessage(null), []);

  if (loading && !isPageMode) {
    // Rows shaped like a surah header and two ayahs; the caption stays for screen readers.
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark" edges={["top"]}>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={s.loadingQuran}
          className="w-full self-center gap-5 px-4 pt-10"
          style={{ maxWidth: 840 }}
        >
          <Skeleton height={148} borderRadius={24} />
          <Skeleton height={112} borderRadius={16} />
          <Skeleton height={112} borderRadius={16} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <AyahNavigationRegistrar
        onNavigateToTarget={requestTarget}
      />
      <SafeAreaView
        className="flex-1 bg-surface dark:bg-surface-dark"
        edges={["top"]}
        {...screenDismissHighlightProps}
      >
        {/* Reader toolbar: six 44px targets below 768px (or whenever the full toolbar does not fit). */}
        <Animated.View
          pointerEvents={chromeVisible ? "auto" : "none"}
          style={[pageHeaderOverlayStyle, headerAnimStyle]}
        >
          <View
            onLayout={onHeaderLayout}
            style={[
              HEADER_CONTENT_STYLE,
              {
                paddingTop: 4,
                paddingBottom: 2,
                backgroundColor: withThemeOpacity(themeSurface, isPageMode && pageScroll === "horizontal" ? 0.92 : 1),
                ...(Platform.OS === "web" && isPageMode && pageScroll === "horizontal"
                  ? ({ backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" } as any)
                  : null),
              },
            ]}
          >
            <ReaderToolbar
              viewportWidth={windowWidth}
              isPageMode={isPageMode}
              onToggleMode={toggleViewMode}
              onSearch={handleOpenSearch}
              hideActive={isPageMode ? hifzEnabled : verseHideMode}
              onToggleHide={isPageMode ? toggleHifzMode : toggleVerseHideMode}
              recitationAvailable={isRecitationEnabled()}
              recitationActive={showRecitation}
              onRecitation={handleOpenRecitation}
              settingsActive={showReadingSettings}
              onReadingSettings={handleOpenReadingSettings}
              onBookmarks={handleOpenBookmarks}
              onGoTo={() => handleOpenNavigator("surah")}
              onHome={handleGoHome}
              focusAvailable={canUseFocusMode}
              onFocus={enterFocusMode}
              onHelp={handleOpenHelp}
            />
          </View>
        </Animated.View>

        {!isPhone && !isPageMode && (
          <Animated.View pointerEvents={chromeVisible ? "box-none" : "none"} style={headerAnimStyle}>
            <MushafIndicator
              surahName={indicator.name}
              juz={indicator.juz}
              onOpenSurah={() => handleOpenNavigator("surah")}
              onOpenJuz={() => handleOpenNavigator("juz")}
            />
          </Animated.View>
        )}

        {/* Content */}
        {isPageMode ? (
          <View
            className="flex-1"
            {...readerTapProps}
            style={{
              paddingTop: 0,
              paddingBottom: isPhone ? 8 : 0,
            }}
          >
            <View
              className="flex-1"
              style={{ overflow: "hidden" }}
            >
              <PageMushaf
                currentPage={currentPage}
                onPageChange={commitCurrentPage}
                goToPageRef={goToPageRef}
                onScroll={handleScrollChrome}
                onHorizontalGesture={() => {
                  touchMovedRef.current = true;
                  markDeliberateMovement();
                  suspendFollowRef.current();
                }}
                pagePaddingTop={isPhone ? 14 : 8}
                pagePaddingBottom={isPhone ? 12 : isTablet ? 0 : 32}
                scrollBottomInset={pageScrollBottomInset}
                pageSidePadding={isPhone ? 6 : 16}
                horizontalTopInset={0}
                horizontalBottomInset={0}
                highlightedAyahKey={displayedHighlightKey}
                highlightedWord={highlightedWord}
                autoScrollActive={focusModeActive}
                autoScrollPlaying={focusModePlaying}
                autoScrollSpeed={focusScrollSpeed}
                onAutoScrollUserPause={pauseFocusAutoScroll}
                onAutoScrollEnd={handleFocusAutoScrollEnd}
                hifzVisibility={hifzVisibility}
                arrivalId={arrival?.id ?? 0}
                topAyahRef={pageTopAyahRef}
                keyboardPagingEnabled={isFocused && !readerOverlayOpen}
                onUserNavigate={() => {
                  markDeliberateMovement();
                  suspendFollowRef.current();
                }}
              />
            </View>
            <FocusModeControls
              playing={focusModePlaying}
              speed={focusScrollSpeed}
              onPlayPause={handleFocusPlayPause}
              onSpeedChange={handleFocusSpeedChange}
              onExit={exitFocusMode}
              visible={focusModeActive}
              collapsed={!focusControlsVisible}
            />
            {!chromeVisible && !focusModeActive && pageScroll === "horizontal" && (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  bottom: 12,
                  left: currentPage % 2 === 0 ? 12 : undefined,
                  right: currentPage % 2 === 0 ? undefined : 12,
                }}
              >
                <Text
                  className="text-warm-500 dark:text-neutral-400"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
                >
                  {isRTL ? toArabicNumber(currentPage) : String(currentPage)}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View className="flex-1" {...readerTapProps}>
            {quranLoadFailed && items.length === 0 ? (
              <QuranLoadError onRetry={() => setQuranLoadAttempt((attempt) => attempt + 1)} />
            ) : (
            <FlashList
              ref={flashListRef}
              data={items}
              renderItem={renderItem}
              getItemType={getItemType}
              keyExtractor={keyExtractor}
              extraData={{ fontSize, verseHideMode, verseReveals, highlightedKey: displayedHighlightKey, highlightedWord }}
              contentContainerStyle={{ paddingBottom: isPhone ? 24 : 56 }}
              onScroll={handleScrollChrome}
              scrollEventThrottle={16}
              viewabilityConfigCallbackPairs={viewabilityConfigCallbackPairs}
              initialScrollIndex={initialVerseIndex}
            />
            )}
          </View>
        )}

        {/* With the controls hidden, a thin band keeps the surah and juz in view, in both views. It has
            its own band so it never draws over the first Quran line. */}
        {!chromeVisible && !focusModeActive && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: Platform.OS === "web" ? 0 : insets.top,
              left: 0,
              right: 0,
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: withThemeOpacity(themeSurface, 0.95),
              direction: "ltr",
              flexDirection: isRTL ? "row-reverse" : "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12, writingDirection: isRTL ? "rtl" : "ltr" }}
              numberOfLines={1}
            >
              {indicator.name ? `${s.tabSurah} ${indicator.name}` : ""}
            </Text>
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 12, writingDirection: isRTL ? "rtl" : "ltr" }}
              numberOfLines={1}
            >
              {indicator.juz
                ? isPageMode && indicator.hizb
                  ? `${s.tabJuz} ${isRTL ? toArabicNumber(indicator.juz) : indicator.juz} • ${s.readerHizb} ${isRTL ? toArabicNumber(indicator.hizb) : indicator.hizb}`
                  : `${s.tabJuz} ${isRTL ? toArabicNumber(indicator.juz) : indicator.juz}`
                : ""}
            </Text>
          </View>
        )}

        {/* Go-to navigator modal */}
        <GoToNavigator
          visible={showNavigator}
          onClose={() => setShowNavigator(false)}
          onSelectTarget={handleGoToTarget}
          initialTab={navigatorTab}
        />

        {/* Bookmarks sheet */}
        <BookmarksSheet
          visible={showBookmarks}
          onClose={() => setShowBookmarks(false)}
          onNavigate={handleBookmarkNavigate}
        />

        {/* Recitation range sheet */}
        <RecitationRangeSheet
          visible={showRecitation}
          onClose={() => setShowRecitation(false)}
          currentAyah={topAyah}
        />

        <ReadingSettingsSheet
          visible={showReadingSettings}
          fontSizeLocked={pageFontSizeLocked}
          onClose={() => setShowReadingSettings(false)}
          onFontSizeChangeStart={keepChromeVisibleDuringFontChange}
        />

        <ReaderHelpSheet visible={showHelp} onClose={() => setShowHelp(false)} />

        {/* Floating word tooltip (portal-based, web only) */}
        <FloatingWordTooltip />

        {/* Search command modal */}
        <SearchCommand
          visible={showSearch}
          onClose={() => setShowSearch(false)}
          onNavigateToAyah={handleBookmarkNavigate}
        />

        {/* Word detail modal */}
        <WordDetailSheet />

        {/* Selection action bar */}
        <SelectionActionBar />

        {/* Web text-selection copy menu */}
        <WebSelectionMenu />

        {/* Bottom page rail / Hifz controls — fades with chrome */}
        {(showBottomSlider || showHifzControls) && (
          <Animated.View
            // The reveal rail stays on screen with the chrome hidden, like the player bar.
            pointerEvents={chromeVisible || showHifzControls ? "box-none" : "none"}
            style={[
              {
                position: Platform.OS === "web" && (isPhone || isTablet) ? "fixed" as any : "absolute",
                left: 0,
                right: 0,
                bottom: railBottomOffset,
                zIndex: 70,
                alignItems: "center",
                paddingHorizontal: isPhone ? 12 : 16,
              },
              showHifzControls ? null : sliderAnimStyle,
            ]}
          >
            <View
              onLayout={(event) => setRailHeight(Math.round(event.nativeEvent.layout.height))}
              style={[
                {
                  width: "100%",
                  maxWidth: isPhone ? undefined : PAGE_RAIL_MAX_WIDTH,
                  borderRadius: 22,
                  overflow: "hidden",
                  ...(Platform.OS === "web"
                    ? ({ backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" } as any)
                    : null),
                },
                floatingRailSurface,
              ]}
            >
              {showHifzControls ? (
                <HifzControls
                  canRevealNext={canRevealNextHifzAyah}
                  canHidePrevious={canHidePreviousHifzAyah}
                  autoRunning={hifzAutoRunning}
                  pageComplete={hifzPageComplete}
                  onRevealNext={revealNextHifzAyah}
                  onRevealNextWord={revealNextHifzWord}
                  onHidePrevious={hidePreviousHifzAyah}
                  onStartAuto={startHifzAuto}
                  onStopAuto={stopHifzAuto}
                  onRepeatPage={repeatHifzPage}
                  onNextPage={currentPage < 604 ? goToNextHifzPage : undefined}
                />
              ) : (
                <MushafSlider
                  currentPage={currentPage}
                  interactive={chromeVisible}
                  onUserActivity={() => setChromeVisible(true)}
                  onCommit={(p) => {
                    markDeliberateMovement();
                    suspendFollowRef.current();
                    if (isPageMode) goToPageRef.current?.(p);
                    else {
                      // Verse view: jump to the first ayah on that page
                      const ayah = mushafIndex
                        ? topmostAyahForPage(mushafIndex, p)
                        : null;
                      if (ayah) {
                        const idx = items.findIndex(
                          (it) => it.type === "ayah" && it.surah === ayah.surah && it.ayah === ayah.ayah
                        );
                        if (idx >= 0) flashListRef.current?.scrollToIndex({ index: idx, animated: true });
                      }
                    }
                  }}
                  onExpand={() => handleOpenNavigator("surah")}
                  index={mushafIndex}
                />
              )}
            </View>
          </Animated.View>
        )}

        {/* Recitation player: single ayah or range, shown even with the chrome hidden. */}
        <RecitationPlayerBar
          bottom={playerBarBottom}
          fixed={isPhone || isTablet}
          horizontalPadding={isPhone ? 12 : 16}
          surface={floatingRailSurface}
          onOpenSheet={handleOpenRecitation}
          showBackToAyah={followSuspended}
          onBackToAyah={backToAyah}
        />

        {/* One-time weak-spot explanation, above the page rail. */}
        {weakSpotsOnPage && weakSpotNoteSeen === false && chromeVisible && !focusModeActive && !recitation.active && (
          <View
            pointerEvents="box-none"
            style={{
              position: Platform.OS === "web" && (isPhone || isTablet) ? ("fixed" as any) : "absolute",
              left: 0,
              right: 0,
              bottom: railBottomOffset + (showBottomSlider || showHifzControls ? 68 : 8),
              zIndex: 72,
              alignItems: "center",
              paddingHorizontal: isPhone ? 12 : 16,
            }}
          >
            <View
              accessibilityLiveRegion="polite"
              style={[
                {
                  width: "100%",
                  maxWidth: 520,
                  direction: "ltr",
                  flexDirection: isRTL ? "row-reverse" : "row",
                  alignItems: "center",
                  gap: 10,
                  borderRadius: 18,
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                },
                floatingRailSurface,
              ]}
            >
              <View style={{ width: 16, height: 2, borderRadius: 1, backgroundColor: isDark ? WEAK_SPOT_DARK : WEAK_SPOT_LIGHT }} />
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{
                  flex: 1,
                  fontFamily: "Manrope_500Medium",
                  fontSize: 13,
                  lineHeight: 18,
                  ...textStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.habitWeakSpotNote}
              </Text>
              <Pressable
                onPress={dismissWeakSpotNote}
                accessibilityRole="button"
                className="min-h-[44px] justify-center px-2"
              >
                <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                  {s.habitWeakSpotNoteDismiss}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* C06 "Back to where I was": one captured position, for five seconds after an explicit jump. */}
        <AuthReopenSurfaces surface="mushaf" />
        {returnToken && !focusModeActive && (
          <View
            pointerEvents="box-none"
            style={{
              position: Platform.OS === "web" && (isPhone || isTablet) ? ("fixed" as any) : "absolute",
              left: 0,
              right: 0,
              // Above the player bar (and its Back to ayah control) when a recitation shows one.
              bottom: playerBarBottom + (playerBarVisible ? 60 + (followSuspended ? 52 : 0) : 0),
              zIndex: 73,
              alignItems: "center",
              paddingHorizontal: 16,
            }}
          >
            <Pressable
              onPress={restoreReturn}
              accessibilityRole="button"
              accessibilityLiveRegion="polite"
              accessibilityLabel={s.readerBackToWhereIWas}
              className="min-h-[44px] items-center gap-2 rounded-full px-4"
              style={({ pressed }) => [
                floatingRailSurface,
                {
                  direction: "ltr",
                  flexDirection: isRTL ? "row-reverse" : "row",
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Undo2 size={16} color={isDark ? "#2dd4bf" : "#0d9488"} />
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {s.readerBackToWhereIWas}
              </Text>
            </Pressable>
          </View>
        )}

        {retryTarget && !isPageMode && (
          <View
            pointerEvents="box-none"
            style={{
              position: Platform.OS === "web" && (isPhone || isTablet) ? ("fixed" as any) : "absolute",
              left: 0,
              right: 0,
              top: (measuredHeaderH ?? 56) + 8,
              zIndex: 73,
              alignItems: "center",
              paddingHorizontal: 16,
            }}
          >
            <Pressable
              onPress={() => navigateToTarget(retryTarget, false)}
              accessibilityRole="button"
              accessibilityLiveRegion="polite"
              className="min-h-[44px] justify-center rounded-full px-4"
              style={floatingRailSurface}
            >
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, writingDirection: isRTL ? "rtl" : "ltr" }}
              >
                {interpolate(s.readerRetryJump, { ref: formatAyahRef(isRTL, retryTarget.surah, retryTarget.ayah) })}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Toast notifications */}
        <Toast message={focusToastMessage} onDismiss={dismissFocusToast} duration={3000} />
      </SafeAreaView>
    </>
  );
}
