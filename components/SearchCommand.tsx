import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Keyboard,
  Platform,
  useWindowDimensions,
  type PressableStateCallbackType,
} from "react-native";
import { formatAyahRef } from "@/lib/arabic";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Search, X, Clock, ChevronDown, ChevronLeft, ChevronRight, CornerDownLeft } from "lucide-react-native";
import { SearchResultsSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { formatAyahs, formatForms, formatNumber, formatPlaces, formatResults } from "@/lib/i18n/count";
import { useOpenMushaf } from "@/lib/navigation/open-mushaf";
import { loadMushafIndex, topmostAyahForPage } from "@/lib/mushaf/position";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { useWordInteraction } from "@/lib/word/context";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";

import { groupRootResults, groupTextResults, type TextResult, type RootOccurrence, type LemmaGroup } from "@/lib/search/results";
import { resolveRootCandidates } from "@/lib/search/root-candidates";
import {
  arabicMatchRanges,
  plainMatchRanges,
  snippetSegments,
  highlightSegments,
  stripSearchDiacritics,
  wordMatchRange,
  type HighlightSegment,
} from "@/lib/search/highlight";
import {
  clearSearchHistory,
  loadSearchHistory,
  removeSearchHistoryEntry,
  saveSearchHistory,
  type SearchHistoryEntry,
  type SearchMode,
} from "@/lib/search/history";
import { distinctRoots, isSingleArabicWord, planSearchQuery, spacedRoot } from "@/lib/search/query-plan";
import { normalizeReferenceInput, SURAH_AYAH_COUNTS } from "@/lib/search/reference";
import { surahTransliteration, type SurahSearchFields } from "@/lib/search/surah-match";
import { textStartStyle, inputTextStartStyle } from "@/lib/ui/direction";

// An expanded lemma renders inside one list item, so a common lemma shows its occurrences in pages.
const LEMMA_OCCURRENCES_PAGE = 30;
// Root results this small open every group; larger ones open the most common form first.
const OPEN_ALL_ROOT_GROUPS_AT = 30;
// The text query's existing cap. A full page means there may be more.
const TEXT_RESULT_LIMIT = 200;
// Fast local searches finish before this, so the skeleton never flashes.
const BUSY_DELAY_MS = 200;

type ResultTarget = { surah: number; ayah: number; wordPos?: number };
type GoToRow = { key: string; label: string } & ({ kind: "ayah"; surah: number; ayah: number } | { kind: "page"; page: number });

function defaultExpansion(groups: readonly LemmaGroup[], total: number): ReadonlyMap<string, number> {
  if (groups.length === 0) return new Map();
  if (total <= OPEN_ALL_ROOT_GROUPS_AT) return new Map(groups.map((group) => [group.lemma, LEMMA_OCCURRENCES_PAGE]));
  return new Map([[groups[0].lemma, LEMMA_OCCURRENCES_PAGE]]);
}

/** A visible keyboard focus ring on web rows (React Native Web reports `focused`). */
function focusRing(state: PressableStateCallbackType, color: string) {
  const focused = (state as PressableStateCallbackType & { focused?: boolean }).focused;
  return Platform.OS === "web" && focused
    ? ({ outlineStyle: "solid", outlineWidth: 2, outlineColor: color, outlineOffset: -2 } as never)
    : null;
}

// ─── Main Component ───
interface SearchCommandProps {
  visible: boolean;
  onClose: () => void;
  onNavigateToAyah?: (surah: number, ayah: number, wordPos?: number) => void;
  /** Fills the field and searches when Search opens, e.g. from the legacy /search?q= link. */
  initialQuery?: string;
}

export function SearchCommand({ visible, onClose, onNavigateToAyah, initialQuery }: SearchCommandProps) {
  const db = useDatabase();
  const { isDark, isRTL } = useSettings();
  const language = isRTL ? "ar" : "en";
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const s = useStrings();
  const { clearTooltip, closeDetail } = useWordInteraction();
  const openMushaf = useOpenMushaf();

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("text");
  const [textResults, setTextResults] = useState<TextResult[]>([]);
  const [rootRows, setRootRows] = useState<RootOccurrence[]>([]);
  /** The query the shown results answer; highlights and history use it, not the live field. */
  const [resultQuery, setResultQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [busyVisible, setBusyVisible] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [surahs, setSurahs] = useState<SurahSearchFields[]>([]);
  /** One root picked from several; null shows all of them. */
  const [rootFilter, setRootFilter] = useState<string | null>(null);
  // Expanded lemma -> how many of its occurrences are shown; null keeps the default for these results.
  const [expansion, setExpansion] = useState<ReadonlyMap<string, number> | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const searchGenerationRef = useRef(0);
  /** Changes on every open and close, so work from an earlier opening cannot fill this one. */
  const sessionRef = useRef(0);
  const surahsRef = useRef<SurahSearchFields[]>([]);
  surahsRef.current = surahs;
  const cancelPendingSearch = useCallback(() => {
    searchGenerationRef.current += 1;
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);
  // Cache of diacritic-stripped lemma/word_text → root, for resolving a typed
  // word like "جاء" to canonical root "جيأ" in root-mode search.
  const rootIndexRef = useRef<{
    lemmaMap: Map<string, Set<string>>;
    wordMap: Map<string, Set<string>>;
  } | null>(null);

  const loadRootIndex = useCallback(async () => {
    if (rootIndexRef.current) return rootIndexRef.current;
    // Building the dictionary reads every word with a root. A table scan avoids scattered reads
    // for the lemma and spelling, which the root index does not contain.
    const rows = await db.getAllAsync<{ root: string; lemma: string | null; word_text: string | null }>(
      `SELECT root, lemma, word_text FROM word_roots NOT INDEXED WHERE root IS NOT NULL GROUP BY root, lemma, word_text`
    );
    const lemmaMap = new Map<string, Set<string>>();
    const wordMap = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.root) continue;
      if (r.lemma) {
        const key = stripSearchDiacritics(r.lemma);
        if (!lemmaMap.has(key)) lemmaMap.set(key, new Set());
        lemmaMap.get(key)!.add(r.root);
      }
      if (r.word_text) {
        const key = stripSearchDiacritics(r.word_text);
        if (!wordMap.has(key)) wordMap.set(key, new Set());
        wordMap.get(key)!.add(r.root);
      }
    }
    const cache = { lemmaMap, wordMap };
    rootIndexRef.current = cache;
    return cache;
  }, [db]);

  const loadHistory = useCallback(async () => {
    const session = sessionRef.current;
    try {
      const rows = await loadSearchHistory(db);
      if (session === sessionRef.current) setHistory(rows);
    } catch {}
  }, [db]);

  // Auto-focus input when opened
  useEffect(() => {
    sessionRef.current += 1;
    const session = sessionRef.current;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    if (visible) {
      // Dismiss any lingering Mushaf word tooltip/detail modal — otherwise
      // they float above the search modal.
      clearTooltip();
      closeDetail();
      focusTimer = setTimeout(() => inputRef.current?.focus(), 120);
      loadHistory();
      // Surah names let "Al-Kahf" or "الكهف" offer Go to; numeric references work without them.
      if (surahsRef.current.length === 0) {
        db.getAllAsync<SurahSearchFields>("SELECT number, name_arabic, name_english FROM surahs ORDER BY number")
          .then((rows) => {
            if (session === sessionRef.current) setSurahs(rows);
          })
          .catch(() => {});
      }
    } else {
      // Reset state when closed
      setSearching(false);
      setQuery("");
      setTextResults([]);
      setRootRows([]);
      setResultQuery("");
      setHasSearched(false);
      setSearchError(null);
      setRootFilter(null);
      setExpansion(null);
    }
    return () => {
      if (focusTimer) clearTimeout(focusTimer);
      cancelPendingSearch();
    };
  }, [visible, clearTooltip, closeDetail, cancelPendingSearch, loadHistory, db]);

  // The skeleton appears only when a search is still running after BUSY_DELAY_MS.
  useEffect(() => {
    if (!searching) {
      setBusyVisible(false);
      return;
    }
    const timer = setTimeout(() => setBusyVisible(true), BUSY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searching]);

  /** History records deliberate searches only: the search key, or a chosen result. */
  const recordHistory = useCallback(
    (term: string, searchMode: SearchMode) => {
      const trimmed = term.trim();
      if (!trimmed) return;
      saveSearchHistory(db, trimmed, searchMode)
        .then(loadHistory)
        .catch(() => {});
    },
    [db, loadHistory],
  );

  const removeHistoryEntry = useCallback(
    (entry: SearchHistoryEntry) => {
      setHistory((rows) => rows.filter((row) => row.id !== entry.id));
      removeSearchHistoryEntry(db, entry.id).catch(() => loadHistory());
    },
    [db, loadHistory],
  );

  const clearHistory = useCallback(async () => {
    try {
      await clearSearchHistory(db);
      setHistory([]);
    } catch {}
  }, [db]);

  const resetResults = useCallback(() => {
    setSearching(false);
    setTextResults([]);
    setRootRows([]);
    setResultQuery("");
    setHasSearched(false);
    setSearchError(null);
    setRootFilter(null);
    setExpansion(null);
  }, []);

  const performSearch = useCallback(
    async (term: string, searchMode: SearchMode) => {
      cancelPendingSearch();
      const generation = searchGenerationRef.current;
      const isCurrentSearch = () => generation === searchGenerationRef.current;
      if (!planSearchQuery(term, surahsRef.current).runSearch) {
        resetResults();
        return;
      }

      const trimmed = term.trim();
      const stripped = stripSearchDiacritics(trimmed);
      setSearching(true);
      setHasSearched(true);
      setSearchError(null);

      try {
        if (searchMode === "text") {
          const rows = await db.getAllAsync<TextResult>(
            `SELECT q.surah, q.ayah, q.text_uthmani, q.v2_page, t.text_en, s.name_arabic, s.name_english
             FROM quran_text q
             LEFT JOIN translations t ON q.surah = t.surah AND q.ayah = t.ayah
             JOIN surahs s ON q.surah = s.number
             WHERE INSTR(q.text_search, ?) > 0
                OR INSTR(LOWER(t.text_en), LOWER(?)) > 0
             ORDER BY q.surah, q.ayah
             LIMIT ${TEXT_RESULT_LIMIT}`,
            [stripped, trimmed]
          );
          if (!isCurrentSearch()) return;
          setTextResults(rows);
          setRootRows([]);
        } else {
          // Users typically type a word (e.g. "جاء"), not a canonical root
          // (e.g. "جيأ"). Resolve the input to matching root(s) by checking
          // direct root match + diacritic-stripped lemma/word_text lookups.
          const index = await loadRootIndex();
          if (!isCurrentSearch()) return;
          const candidateList = resolveRootCandidates({ trimmedTerm: trimmed, strippedTerm: stripped, index });
          const placeholders = candidateList.map(() => "?").join(",");
          const rows = candidateList.length
            ? await db.getAllAsync<RootOccurrence>(
                `SELECT wr.surah, wr.ayah, wr.word_pos, wr.word_text, wr.root, wr.lemma,
                        q.text_uthmani, s.name_arabic, s.name_english
                 FROM word_roots wr
                 JOIN quran_text q ON wr.surah = q.surah AND wr.ayah = q.ayah
                 JOIN surahs s ON wr.surah = s.number
                 WHERE wr.root IN (${placeholders})
                 ORDER BY wr.surah, wr.ayah, wr.word_pos`,
                candidateList
              )
            : [];

          if (!isCurrentSearch()) return;
          setRootRows(rows);
          setTextResults([]);
        }
        setRootFilter(null);
        setExpansion(null);
        setResultQuery(trimmed);
      } catch (err) {
        console.error("[Search] Error:", err);
        if (!isCurrentSearch()) return;
        setTextResults([]);
        setRootRows([]);
        setSearchError(s.searchFailed);
      } finally {
        if (isCurrentSearch()) setSearching(false);
      }
    },
    [db, loadRootIndex, s.searchFailed, cancelPendingSearch, resetResults]
  );

  const handleQueryChange = useCallback(
    (text: string) => {
      setQuery(text);
      cancelPendingSearch();
      debounceRef.current = setTimeout(() => {
        performSearch(text, mode);
      }, 350);
    },
    [mode, performSearch, cancelPendingSearch]
  );

  // A query handed over on open runs once for that opening.
  const appliedInitialQueryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      appliedInitialQueryRef.current = null;
      return;
    }
    if (!initialQuery || appliedInitialQueryRef.current === initialQuery) return;
    appliedInitialQueryRef.current = initialQuery;
    handleQueryChange(initialQuery);
  }, [visible, initialQuery, handleQueryChange]);

  /** Text and root modes share one query; switching keeps it and searches again. */
  const handleModeChange = useCallback(
    (newMode: SearchMode) => {
      setMode(newMode);
      setExpansion(null);
      performSearch(query, newMode);
    },
    [query, performSearch]
  );

  const handleClear = useCallback(() => {
    cancelPendingSearch();
    setQuery("");
    resetResults();
    inputRef.current?.focus();
  }, [cancelPendingSearch, resetResults]);

  // C06: a result closes Search first; the target is submitted once the sheet has closed (or this
  // component unmounted), never after a guessed delay.
  const pendingResultRef = useRef<ResultTarget | null>(null);
  const submitPendingResult = useCallback(() => {
    const target = pendingResultRef.current;
    if (!target) return;
    pendingResultRef.current = null;
    if (onNavigateToAyah) onNavigateToAyah(target.surah, target.ayah, target.wordPos);
    else openMushaf(target);
  }, [onNavigateToAyah, openMushaf]);
  const submitPendingResultRef = useRef(submitPendingResult);
  submitPendingResultRef.current = submitPendingResult;
  useEffect(() => {
    if (!visible) submitPendingResult();
  }, [submitPendingResult, visible]);
  useEffect(() => () => submitPendingResultRef.current(), []);

  const closeWithTarget = useCallback(
    (target: ResultTarget) => {
      Keyboard.dismiss();
      pendingResultRef.current = target;
      onClose();
    },
    [onClose],
  );

  const handleResultTap = useCallback(
    (surah: number, ayah: number, wordPos?: number) => {
      recordHistory(resultQuery || query, mode);
      closeWithTarget({ surah, ayah, wordPos });
    },
    [closeWithTarget, mode, query, recordHistory, resultQuery],
  );

  const plan = useMemo(() => planSearchQuery(query, surahs), [query, surahs]);

  const surahLabel = useCallback(
    (number: number) => {
      const surah = surahs.find((row) => row.number === number);
      if (isRTL) return surah?.name_arabic ?? formatNumber(number, "ar");
      return surahTransliteration(number) ?? surah?.name_english ?? String(number);
    },
    [isRTL, surahs],
  );

  const goToRows = useMemo<GoToRow[]>(() => {
    const reference = plan.reference;
    if (!reference) return [];
    switch (reference.kind) {
      case "ayah":
        return [
          {
            key: `ayah-${reference.surah}-${reference.ayah}`,
            kind: "ayah",
            surah: reference.surah,
            ayah: reference.ayah,
            label: `${surahLabel(reference.surah)} ${formatAyahRef(isRTL, reference.surah, reference.ayah)}`,
          },
        ];
      case "surah":
      case "surah-choices": {
        const numbers = reference.kind === "surah" ? [reference.surah] : reference.surahs;
        return numbers.map((surah) => ({
          key: `surah-${surah}`,
          kind: "ayah" as const,
          surah,
          ayah: 1,
          label: `${interpolate(s.surahNamed, { name: surahLabel(surah) })} (${formatNumber(surah, language)})`,
        }));
      }
      case "page":
        return [
          {
            key: `page-${reference.page}`,
            kind: "page",
            page: reference.page,
            label: interpolate(s.pageN, { n: formatNumber(reference.page, language) }),
          },
        ];
      default:
        return [];
    }
  }, [isRTL, language, plan.reference, s.pageN, s.surahNamed, surahLabel]);

  const invalidReferenceMessage = useMemo(() => {
    const reference = plan.reference;
    if (reference?.kind !== "invalid") return null;
    if (reference.reason === "surah-range") return s.homeSearchInvalidSurah;
    if (reference.reason === "page-range") return s.homeSearchInvalidPage;
    if (reference.reason === "ayah-range") {
      const surah = Number(normalizeReferenceInput(query).split(":")[0]);
      const count = SURAH_AYAH_COUNTS[surah - 1];
      if (count) {
        return interpolate(s.homeSearchInvalidAyah, {
          surah: interpolate(s.surahNamed, { name: surahLabel(surah) }),
          count: formatAyahs(count, language),
        });
      }
    }
    return s.homeSearchInvalidFormat;
  }, [language, plan.reference, query, s, surahLabel]);

  const openGoTo = useCallback(
    async (row: GoToRow) => {
      recordHistory(query, mode);
      if (row.kind === "ayah") {
        closeWithTarget({ surah: row.surah, ayah: row.ayah });
        return;
      }
      // A page opens at its first ayah, through the existing page mapping.
      const session = sessionRef.current;
      try {
        const first = topmostAyahForPage(await loadMushafIndex(db), row.page);
        if (first && session === sessionRef.current) closeWithTarget(first);
      } catch (error) {
        console.warn("[Search] Page lookup failed:", error);
      }
    },
    [closeWithTarget, db, mode, query, recordHistory],
  );

  /** The search key: open a single numeric reference, otherwise search now and remember the query. */
  const handleSubmit = useCallback(() => {
    if (!plan.runSearch && goToRows.length === 1) {
      void openGoTo(goToRows[0]);
      return;
    }
    performSearch(query, mode);
    if (plan.runSearch) recordHistory(query, mode);
  }, [goToRows, mode, openGoTo, performSearch, plan.runSearch, query, recordHistory]);

  const handleHistoryTap = useCallback(
    (entry: SearchHistoryEntry) => {
      const entryMode: SearchMode = entry.mode === "root" ? "root" : "text";
      Keyboard.dismiss();
      setQuery(entry.query);
      setMode(entryMode);
      performSearch(entry.query, entryMode);
    },
    [performSearch]
  );

  const roots = useMemo(() => distinctRoots(rootRows), [rootRows]);
  const rootResults = useMemo(
    () =>
      groupRootResults(
        rootFilter ? rootRows.filter((row) => stripSearchDiacritics(row.root) === rootFilter) : rootRows,
      ),
    [rootFilter, rootRows],
  );
  const totalRootCount = useMemo(
    () => rootResults.reduce((sum, g) => sum + g.occurrences.length, 0),
    [rootResults]
  );
  const expandedLemmas = expansion ?? defaultExpansion(rootResults, totalRootCount);

  const toggleLemma = useCallback(
    (lemma: string) => {
      const next = new Map(expandedLemmas);
      if (next.has(lemma)) next.delete(lemma);
      else next.set(lemma, LEMMA_OCCURRENCES_PAGE);
      setExpansion(next);
    },
    [expandedLemmas],
  );

  const showMoreLemma = useCallback(
    (lemma: string) => {
      setExpansion(new Map(expandedLemmas).set(lemma, (expandedLemmas.get(lemma) ?? 0) + LEMMA_OCCURRENCES_PAGE));
    },
    [expandedLemmas],
  );

  const chooseRoot = useCallback((root: string | null) => {
    setRootFilter(root);
    setExpansion(null);
  }, []);

  const groupedTextResults = useMemo(() => groupTextResults(textResults), [textResults]);
  const totalTextCount = textResults.length;

  const tealColor = "#0d9488";
  const mutedColor = isDark ? "#737373" : "#8B8178";
  const focusColor = isDark ? "#2dd4bf" : "#0f766e";
  const highlightStyle = {
    backgroundColor: isDark ? "rgba(13,148,136,0.25)" : "rgba(13,148,136,0.15)",
    color: isDark ? "#2dd4bf" : "#0f766e",
    fontFamily: "Manrope_600SemiBold",
    // An underline keeps a match visible where the tint alone is low contrast.
    textDecorationLine: "underline" as const,
  };
  const renderSegments = (segments: HighlightSegment[]) =>
    segments.map((seg, i) =>
      seg.highlight ? (
        <Text key={i} style={highlightStyle}>
          {seg.text}
        </Text>
      ) : (
        <Text key={i}>{seg.text}</Text>
      ),
    );
  const LemmaDisclosureChevron = isRTL ? ChevronLeft : ChevronRight;
  const isPhone = width < SIDEBAR_BREAKPOINT;
  // The overlay pads its window below the status bar, so a phone sheet must leave insets.top free
  // or its fixed height pushes the header under the status bar.
  const modalHeight = isPhone ? Math.min(height - insets.top - 8, 900) : Math.min(height - 48, 760);
  const rowDirection = { direction: "ltr" as const, flexDirection: isRTL ? ("row-reverse" as const) : ("row" as const) };
  const resultsEmpty = mode === "text" ? textResults.length === 0 : rootRows.length === 0;
  const trimmedQuery = query.trim();
  const captionStyle = { fontFamily: "Manrope_500Medium", fontSize: 12, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" } as const;

  const switchModeAction =
    mode === "text"
      ? isSingleArabicWord(resultQuery || query)
        ? { label: s.homeSearchTryRoot, mode: "root" as const }
        : null
      : { label: s.homeSearchAsText, mode: "text" as const };

  const goToSection =
    goToRows.length > 0 || invalidReferenceMessage ? (
      <View className="px-5 pb-2" style={{ gap: 4 }}>
        {goToRows.map((row) => (
          <Pressable
            key={row.key}
            onPress={() => void openGoTo(row)}
            accessibilityRole="button"
            accessibilityLabel={`${s.homeSearchGoTo} ${row.label}`}
            className="min-h-[48px] items-center gap-3 rounded-2xl bg-primary-accent/10 px-4 dark:bg-primary-bright/10"
            style={(state) => [rowDirection, { opacity: state.pressed ? 0.75 : 1 }, focusRing(state, focusColor)]}
          >
            <CornerDownLeft size={16} color={focusColor} />
            <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
              {s.homeSearchGoTo}
            </Text>
            <Text
              className="flex-1 text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 15, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
            >
              {row.label}
            </Text>
          </Pressable>
        ))}
        {invalidReferenceMessage ? (
          <Text className="text-warm-600 dark:text-neutral-400" style={captionStyle} accessibilityLiveRegion="polite">
            {invalidReferenceMessage}
          </Text>
        ) : null}
      </View>
    ) : null;

  const renderResults = () => {
    if (plan.tooShort) {
      return (
        <View className="flex-1 items-center justify-center px-5">
          <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 14, textAlign: "center" }}>
            {s.searchMinChars}
          </Text>
        </View>
      );
    }
    if (resultsEmpty) {
      if (searching || !hasSearched) return null;
      return (
        <View className="flex-1 items-center justify-center">
          <EmptyState
            icon={Search}
            title={interpolate(s.searchNoResults, { query: resultQuery || trimmedQuery })}
            subtitle={mode === "text" ? s.emptySearchTextSubtitle : s.emptySearchRootSubtitle}
            actionLabel={switchModeAction?.label}
            onAction={switchModeAction ? () => handleModeChange(switchModeAction.mode) : undefined}
            isDark={isDark}
          />
        </View>
      );
    }
    if (mode === "text") {
      return (
        <View className="flex-1">
          <View className="px-5 pb-2">
            <Text className="text-warm-500 dark:text-neutral-400" style={captionStyle}>
              {totalTextCount >= TEXT_RESULT_LIMIT
                ? interpolate(s.homeSearchShowingFirst, { n: formatNumber(TEXT_RESULT_LIMIT, language) })
                : formatResults(totalTextCount, language)}
            </Text>
          </View>

          <FlatList
            data={groupedTextResults}
            keyExtractor={(item) => `surah-${item.surah}`}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item: group }) => (
              <View className="mb-2">
                <View
                  className="items-center justify-between gap-2 bg-surface-low px-5 py-2 dark:bg-surface-dark-low"
                  style={rowDirection}
                >
                  {isRTL ? (
                    <Text
                      className="text-primary-accent dark:text-primary-bright"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, lineHeight: 22, writingDirection: "rtl", paddingHorizontal: 6 }}
                    >
                      {group.nameArabic}
                    </Text>
                  ) : (
                    <Text
                      className="flex-1 text-primary-accent dark:text-primary-bright"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, lineHeight: 22 }}
                    >
                      {`${surahTransliteration(group.surah) ?? group.nameEnglish} (${group.surah})`}
                      <Text className="text-warm-500 dark:text-neutral-400" style={{ fontSize: 12 }}>
                        {"  "}
                        <Text style={{ writingDirection: "rtl" }}>{group.nameArabic}</Text>
                      </Text>
                    </Text>
                  )}
                  <View className="rounded-full bg-primary-accent/10 px-2 py-0.5 dark:bg-primary-bright/10">
                    <Text
                      className="text-primary-accent dark:text-primary-bright"
                      accessibilityLabel={formatResults(group.results.length, language)}
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
                    >
                      {formatNumber(group.results.length, language)}
                    </Text>
                  </View>
                </View>

                {group.results.map((r) => {
                  const arabic = snippetSegments(r.text_uthmani, arabicMatchRanges(r.text_uthmani, resultQuery));
                  // A translation is wordier than the Arabic it renders, so its window is longer.
                  const english = r.text_en ? snippetSegments(r.text_en, plainMatchRanges(r.text_en, resultQuery), 25) : [];
                  const reference = formatAyahRef(isRTL, r.surah, r.ayah);
                  const page = r.v2_page ? interpolate(s.pageN, { n: formatNumber(r.v2_page, language) }) : null;
                  return (
                    <Pressable
                      key={`${r.surah}:${r.ayah}`}
                      onPress={() => handleResultTap(r.surah, r.ayah)}
                      accessibilityRole="button"
                      accessibilityLabel={[surahLabel(r.surah), reference, page].filter(Boolean).join(", ")}
                      className="px-5 py-3"
                      style={(state) => [{ opacity: state.pressed ? 0.7 : 1 }, focusRing(state, focusColor)]}
                    >
                      <View className="mb-1.5 items-center gap-2" style={rowDirection}>
                        <View className="px-2 py-0.5 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
                          <Text
                            className="text-primary-accent dark:text-primary-bright"
                            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
                          >
                            {reference}
                          </Text>
                        </View>
                        {page ? (
                          <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                            {page}
                          </Text>
                        ) : null}
                      </View>
                      <Text
                        style={{
                          fontFamily: "Manrope_400Regular",
                          fontSize: 16,
                          lineHeight: 30,
                          writingDirection: "rtl",
                          textAlign: "right",
                          color: isDark ? "#d4d4d4" : "#2D2D2D",
                        }}
                      >
                        {renderSegments(arabic)}
                      </Text>
                      {r.text_en ? (
                        <Text
                          className="mt-2 text-warm-600 dark:text-neutral-400"
                          style={{
                            fontFamily: "Manrope_400Regular",
                            fontSize: 14,
                            lineHeight: 22,
                            writingDirection: "ltr",
                            textAlign: "left",
                          }}
                        >
                          {renderSegments(english)}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
          />
        </View>
      );
    }
    return (
      <View className="flex-1">
        <View className="px-5 pb-2" style={{ gap: 8 }}>
          {roots.length === 1 ? (
            <Text className="text-charcoal dark:text-neutral-200" style={{ ...captionStyle, fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
              {interpolate(s.homeSearchRootResolved, { root: spacedRoot(roots[0]) })}
            </Text>
          ) : roots.length > 1 ? (
            <View className="flex-wrap items-center gap-2" style={rowDirection} accessibilityRole="radiogroup" accessibilityLabel={s.homeSearchRootsLabel}>
              <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                {s.homeSearchRootsLabel}
              </Text>
              {[null, ...roots].map((root) => {
                const selected = rootFilter === root;
                return (
                  <Pressable
                    key={root ?? "all"}
                    onPress={() => chooseRoot(root)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    className={`min-h-[44px] justify-center rounded-full px-4 ${selected ? "bg-primary-accent dark:bg-primary-bright" : "bg-surface-low dark:bg-surface-dark-low"}`}
                    style={(state) => focusRing(state, focusColor)}
                  >
                    <Text
                      className={selected ? "text-white dark:text-neutral-950" : "text-charcoal dark:text-neutral-200"}
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, writingDirection: root ? "rtl" : isRTL ? "rtl" : "ltr" }}
                    >
                      {root ? spacedRoot(root) : s.homeSearchAllRoots}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <Text className="text-warm-500 dark:text-neutral-400" style={captionStyle}>
            {`${formatForms(rootResults.length, language)} · ${formatPlaces(totalRootCount, language)}`}
          </Text>
        </View>

        <FlatList
          data={rootResults}
          keyExtractor={(item) => item.lemma}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item: group }) => {
            const shownCount = expandedLemmas.get(group.lemma);
            const isExpanded = shownCount !== undefined;
            const hiddenCount = isExpanded ? Math.max(0, group.occurrences.length - shownCount) : 0;
            return (
              <View className="mb-1">
                <Pressable
                  onPress={() => toggleLemma(group.lemma)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                  accessibilityLabel={`${group.lemma}, ${formatPlaces(group.occurrences.length, language)}`}
                  className="min-h-[48px] items-center justify-between bg-surface-low px-5 py-3 dark:bg-surface-dark-low"
                  style={(state) => [
                    {
                      direction: "ltr",
                      flexDirection: isRTL ? "row-reverse" : "row",
                      opacity: state.pressed ? 0.8 : 1,
                    },
                    focusRing(state, focusColor),
                  ]}
                >
                  <View
                    className="items-center gap-2"
                    style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} color={tealColor} />
                    ) : (
                      <LemmaDisclosureChevron size={14} color={tealColor} />
                    )}
                    <Text
                      className="text-charcoal dark:text-neutral-100"
                      style={{ fontFamily: "Manrope_700Bold", fontSize: 17, writingDirection: "rtl", paddingHorizontal: 4 }}
                    >
                      {group.lemma}
                    </Text>
                  </View>
                  <View className="px-2.5 py-1 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
                    <Text
                      className="text-primary-accent dark:text-primary-bright"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
                    >
                      {formatNumber(group.occurrences.length, language)}
                    </Text>
                  </View>
                </Pressable>

                {isExpanded &&
                  group.occurrences.slice(0, shownCount).map((occ) => {
                    const segments = highlightSegments(occ.text_uthmani, wordMatchRange(occ.text_uthmani, occ.word_text));
                    const reference = formatAyahRef(isRTL, occ.surah, occ.ayah);
                    return (
                      <Pressable
                        key={`${occ.surah}:${occ.ayah}:${occ.word_pos}`}
                        onPress={() => handleResultTap(occ.surah, occ.ayah, occ.word_pos)}
                        accessibilityRole="button"
                        accessibilityLabel={`${isRTL ? occ.name_arabic : occ.name_english}, ${reference}`}
                        className="px-5 py-3"
                        style={(state) => [
                          { opacity: state.pressed ? 0.7 : 1, paddingStart: 40 },
                          focusRing(state, focusColor),
                        ]}
                      >
                        <View className="mb-1.5 items-center gap-2" style={rowDirection}>
                          <View className="px-2 py-0.5 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
                            <Text
                              className="text-primary-accent dark:text-primary-bright"
                              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
                            >
                              {reference}
                            </Text>
                          </View>
                          <Text
                            className="text-warm-500 dark:text-neutral-400"
                            style={{ fontFamily: "Manrope_400Regular", fontSize: 11 }}
                          >
                            {isRTL ? occ.name_arabic : occ.name_english}
                          </Text>
                        </View>
                        <Text
                          style={{
                            fontFamily: "Manrope_400Regular",
                            fontSize: 15,
                            lineHeight: 28,
                            writingDirection: "rtl",
                            textAlign: "right",
                            color: isDark ? "#d4d4d4" : "#2D2D2D",
                          }}
                          numberOfLines={2}
                        >
                          {renderSegments(segments)}
                        </Text>
                      </Pressable>
                    );
                  })}
                {hiddenCount > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    label={interpolate(s.listShowMore, { count: hiddenCount })}
                    onPress={() => showMoreLemma(group.lemma)}
                    className="mb-2 self-center"
                  />
                ) : null}
              </View>
            );
          }}
        />
      </View>
    );
  };

  const renderInitial = () => (
    <View className="flex-1 px-5">
      {history.length > 0 ? (
        <>
          <View className="items-center justify-between py-1" style={rowDirection}>
            <Text
              className="text-warm-600 dark:text-neutral-400"
              accessibilityRole="header"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
            >
              {s.searchHistory}
            </Text>
            <Pressable
              onPress={clearHistory}
              accessibilityRole="button"
              className="min-h-[44px] justify-center px-2"
              style={(state) => focusRing(state, focusColor)}
            >
              <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: focusColor }}>
                {s.searchClearHistory}
              </Text>
            </Pressable>
          </View>
          <FlatList
            data={history}
            keyExtractor={(item) => String(item.id)}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 24 }}
            renderItem={({ item }) => (
              <View className="items-center gap-1" style={rowDirection}>
                <Pressable
                  onPress={() => handleHistoryTap(item)}
                  accessibilityRole="button"
                  className="min-h-[44px] flex-1 items-center gap-3"
                  style={(state) => [rowDirection, { opacity: state.pressed ? 0.7 : 1 }, focusRing(state, focusColor)]}
                >
                  <Clock size={14} color={mutedColor} />
                  <Text
                    className="text-charcoal dark:text-neutral-200 flex-1"
                    style={{
                      fontFamily: "Manrope_500Medium",
                      fontSize: 15,
                      writingDirection: isRTL ? "rtl" : "ltr",
                      ...textStartStyle(isRTL),
                    }}
                  >
                    {item.query}
                  </Text>
                  <View className="px-2 py-0.5 rounded-full bg-surface-high dark:bg-surface-dark-high">
                    <Text className="text-warm-600 dark:text-neutral-400" style={{ fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                      {item.mode === "root" ? s.searchRootMode : s.searchTextMode}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => removeHistoryEntry(item)}
                  accessibilityRole="button"
                  accessibilityLabel={interpolate(s.homeSearchRemoveNamed, { query: item.query })}
                  accessibilityHint={s.homeSearchRemove}
                  testID={`remove-history-${item.id}`}
                  className="h-11 w-11 items-center justify-center rounded-full"
                  style={(state) => focusRing(state, focusColor)}
                >
                  <X size={14} color={mutedColor} />
                </Pressable>
              </View>
            )}
          />
        </>
      ) : (
        <View className="flex-1 items-center justify-center px-2" style={{ paddingBottom: 18, gap: 10 }}>
          <Search size={40} color={isDark ? "#404040" : "#DFD9D1"} />
          <Text
            className="text-warm-600 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 14, lineHeight: 21, textAlign: "center", writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {s.homeSearchHint}
          </Text>
          <Text
            className="text-warm-500 dark:text-neutral-500"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 13, textAlign: "center", writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {mode === "text" ? s.homeSearchExamplesText : s.homeSearchExamplesRoot}
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <ResponsiveSheet
      open={visible}
      onClose={onClose}
      dismissOnBackdrop
      maxWidth={900}
      maxHeight={modalHeight}
      phoneSheetHeight="max"
    >
      <View style={isPhone ? { flex: 1, minHeight: 0 } : { height: modalHeight }}>
        {/* The Cancel button below is the one close control, so the header carries only the title. */}
        <OverlayHeader title={s.searchTitle} isRTL={isRTL} />

        {/* Search bar */}
        <View className="px-5 pt-4 pb-3 items-center gap-2" style={rowDirection}>
          {/* Mirrored by hand, so pinned LTR: an inherited RTL direction would flip it back. */}
          <View
            className={`${isRTL ? "flex-row-reverse" : "flex-row"} min-w-0 flex-1 items-center gap-2.5 bg-surface-low dark:bg-surface-dark-low rounded-full ${isRTL ? "pl-1 pr-4" : "pl-4 pr-1"} min-h-[44px]`}
            style={{ direction: "ltr" }}
          >
            <Search size={18} color={mutedColor} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={handleQueryChange}
              placeholder={mode === "text" ? s.homeSearchPlaceholderText : s.homeSearchPlaceholderRoot}
              placeholderTextColor={mutedColor}
              accessibilityLabel={s.searchTitle}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={handleSubmit}
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: "Manrope_500Medium",
                fontSize: 15,
                color: isDark ? "#e5e5e5" : "#2D2D2D",
                writingDirection: isRTL ? "rtl" : "ltr",
                ...inputTextStartStyle(isRTL),
                paddingVertical: 8,
                ...(Platform.OS === "web"
                  ? ({
                      outlineStyle: "none",
                      outlineWidth: 0,
                    } as never)
                  : {}),
              }}
            />
            {query.length > 0 ? (
              <Pressable
                onPress={handleClear}
                accessibilityRole="button"
                accessibilityLabel={s.homeSearchClear}
                className="h-11 w-11 shrink-0 items-center justify-center rounded-full"
                style={(state) => focusRing(state, focusColor)}
              >
                <X size={18} color={mutedColor} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={s.homeSearchClose}
            className="min-h-[44px] min-w-11 shrink-0 justify-center px-2"
            style={(state) => focusRing(state, focusColor)}
          >
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: focusColor }}>{s.homeSearchCancel}</Text>
          </Pressable>
        </View>

        {/* Mode toggle */}
        <View className="px-5 pb-3">
          <ToggleGroup<SearchMode>
            value={mode}
            onValueChange={(value) => {
              if (value !== mode) handleModeChange(value);
            }}
            items={[
              { value: "text", label: s.searchTextMode },
              { value: "root", label: s.searchRootMode },
            ]}
          />
        </View>

        {/* Content area */}
        <OverlayBody scrollEnabled={false} className="px-0">
          {searchError ? (
            <View className="flex-1 items-center justify-center">
              <EmptyState
                icon={Search}
                title={searchError}
                actionLabel={s.homeSearchRetry}
                onAction={() => performSearch(query, mode)}
                isDark={isDark}
              />
            </View>
          ) : busyVisible ? (
            <View className="flex-1">
              {goToSection}
              <SearchResultsSkeleton isDark={isDark} className="flex-1" />
            </View>
          ) : !hasSearched && trimmedQuery.length === 0 ? (
            renderInitial()
          ) : (
            <View className="flex-1">
              {goToSection}
              {renderResults()}
            </View>
          )}
        </OverlayBody>
      </View>
    </ResponsiveSheet>
  );
}
