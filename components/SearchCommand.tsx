import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Search, X, Clock, Trash2, ChevronDown, ChevronRight } from "lucide-react-native";
import { SearchResultsSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { setPendingDeepLink } from "@/lib/deep-link";
import { useWordInteraction } from "@/lib/word/context";

// ─── Arabic diacritics stripping ───
const ARABIC_DIACRITICS_RE =
  /[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0640]/g;

function stripDiacritics(text: string): string {
  return text.replace(ARABIC_DIACRITICS_RE, "");
}

// ─── Types ───
type TextResult = {
  surah: number;
  ayah: number;
  text_uthmani: string;
  name_arabic: string;
  name_english: string;
};

type RootOccurrence = {
  surah: number;
  ayah: number;
  word_pos: number;
  word_text: string;
  root: string;
  lemma: string;
  text_uthmani: string;
  name_arabic: string;
  name_english: string;
};

type LemmaGroup = {
  lemma: string;
  occurrences: RootOccurrence[];
};

type HistoryEntry = {
  id: number;
  query: string;
  mode: string;
  created_at: string;
};

// ─── Highlight helper ───
function buildHighlightSegments(
  original: string,
  searchTerm: string,
): { text: string; highlight: boolean }[] {
  const stripped = stripDiacritics(original);
  const termStripped = stripDiacritics(searchTerm);
  if (!termStripped) return [{ text: original, highlight: false }];

  const matchIdx = stripped.indexOf(termStripped);
  if (matchIdx === -1) return [{ text: original, highlight: false }];

  let strippedPos = 0;
  let origStart = -1;
  let origEnd = -1;

  for (let i = 0; i < original.length; i++) {
    const isDiacritic = ARABIC_DIACRITICS_RE.test(original[i]);
    ARABIC_DIACRITICS_RE.lastIndex = 0;
    if (isDiacritic) continue;

    if (strippedPos === matchIdx) origStart = i;
    if (strippedPos === matchIdx + termStripped.length - 1) {
      origEnd = i + 1;
      break;
    }
    strippedPos++;
  }

  if (origStart === -1 || origEnd === -1) {
    return [{ text: original, highlight: false }];
  }

  while (origEnd < original.length) {
    ARABIC_DIACRITICS_RE.lastIndex = 0;
    if (!ARABIC_DIACRITICS_RE.test(original[origEnd])) break;
    origEnd++;
  }

  return [
    origStart > 0 ? { text: original.slice(0, origStart), highlight: false } : null,
    { text: original.slice(origStart, origEnd), highlight: true },
    origEnd < original.length
      ? { text: original.slice(origEnd), highlight: false }
      : null,
  ].filter(Boolean) as { text: string; highlight: boolean }[];
}

function highlightWord(
  original: string,
  wordText: string,
): { text: string; highlight: boolean }[] {
  const idx = original.indexOf(wordText);
  if (idx !== -1) {
    return [
      idx > 0 ? { text: original.slice(0, idx), highlight: false } : null,
      { text: original.slice(idx, idx + wordText.length), highlight: true },
      idx + wordText.length < original.length
        ? { text: original.slice(idx + wordText.length), highlight: false }
        : null,
    ].filter(Boolean) as { text: string; highlight: boolean }[];
  }
  return buildHighlightSegments(original, wordText);
}

// ─── Main Component ───
interface SearchCommandProps {
  visible: boolean;
  onClose: () => void;
}

export function SearchCommand({ visible, onClose }: SearchCommandProps) {
  const db = useDatabase();
  const { isDark, isRTL } = useSettings();
  const s = useStrings();
  const { clearTooltip, closeDetail } = useWordInteraction();

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"text" | "root">("text");
  const [textResults, setTextResults] = useState<TextResult[]>([]);
  const [rootResults, setRootResults] = useState<LemmaGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [expandedLemmas, setExpandedLemmas] = useState<Set<string>>(new Set());

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  // Cache of diacritic-stripped lemma/word_text → root, for resolving a typed
  // word like "جاء" to canonical root "جيأ" in root-mode search.
  const rootIndexRef = useRef<{
    lemmaMap: Map<string, Set<string>>;
    wordMap: Map<string, Set<string>>;
  } | null>(null);

  const loadRootIndex = useCallback(async () => {
    if (rootIndexRef.current) return rootIndexRef.current;
    const rows = await db.getAllAsync<{ root: string; lemma: string | null; word_text: string | null }>(
      `SELECT root, lemma, word_text FROM word_roots WHERE root IS NOT NULL GROUP BY root, lemma, word_text`
    );
    const lemmaMap = new Map<string, Set<string>>();
    const wordMap = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.root) continue;
      if (r.lemma) {
        const key = stripDiacritics(r.lemma);
        if (!lemmaMap.has(key)) lemmaMap.set(key, new Set());
        lemmaMap.get(key)!.add(r.root);
      }
      if (r.word_text) {
        const key = stripDiacritics(r.word_text);
        if (!wordMap.has(key)) wordMap.set(key, new Set());
        wordMap.get(key)!.add(r.root);
      }
    }
    const cache = { lemmaMap, wordMap };
    rootIndexRef.current = cache;
    return cache;
  }, [db]);

  // Auto-focus input when opened
  useEffect(() => {
    if (visible) {
      // Dismiss any lingering Mushaf word tooltip/detail sheet — otherwise
      // they float above the search modal.
      clearTooltip();
      closeDetail();
      setTimeout(() => inputRef.current?.focus(), 100);
      loadHistory();
    } else {
      // Reset state when closed
      setQuery("");
      setTextResults([]);
      setRootResults([]);
      setHasSearched(false);
      setExpandedLemmas(new Set());
    }
  }, [visible, clearTooltip, closeDetail]);

  const loadHistory = useCallback(async () => {
    try {
      const rows = await db.getAllAsync<HistoryEntry>(
        "SELECT id, query, mode, created_at FROM search_history ORDER BY created_at DESC LIMIT 10"
      );
      setHistory(rows);
    } catch {}
  }, [db]);

  const saveToHistory = useCallback(
    async (q: string, m: string) => {
      try {
        await db.runAsync(
          "DELETE FROM search_history WHERE query = ? AND mode = ?",
          [q, m]
        );
        await db.runAsync(
          "INSERT INTO search_history (query, mode, created_at) VALUES (?, ?, ?)",
          [q, m, new Date().toISOString()]
        );
        await db.runAsync(
          "DELETE FROM search_history WHERE id NOT IN (SELECT id FROM search_history ORDER BY created_at DESC LIMIT 10)"
        );
        loadHistory();
      } catch {}
    },
    [db, loadHistory]
  );

  const clearHistory = useCallback(async () => {
    try {
      await db.runAsync("DELETE FROM search_history");
      setHistory([]);
    } catch {}
  }, [db]);

  const performSearch = useCallback(
    async (term: string, searchMode: "text" | "root") => {
      const stripped = stripDiacritics(term.trim());
      if (stripped.length < 2) {
        setTextResults([]);
        setRootResults([]);
        setHasSearched(false);
        return;
      }

      setSearching(true);
      setHasSearched(true);

      try {
        if (searchMode === "text") {
          const rows = await db.getAllAsync<TextResult>(
            `SELECT q.surah, q.ayah, q.text_uthmani, s.name_arabic, s.name_english
             FROM quran_text q
             JOIN surahs s ON q.surah = s.number
             WHERE q.text_search LIKE '%' || ? || '%'
             ORDER BY q.surah, q.ayah
             LIMIT 200`,
            [stripped]
          );
          setTextResults(rows);
          setRootResults([]);
        } else {
          // Users typically type a word (e.g. "جاء"), not a canonical root
          // (e.g. "جيأ"). Resolve the input to matching root(s) by checking
          // direct root match + diacritic-stripped lemma/word_text lookups.
          const trimmed = term.trim();
          const strippedTerm = stripDiacritics(trimmed);
          const rootCandidates = new Set<string>();
          rootCandidates.add(trimmed);
          rootCandidates.add(strippedTerm);

          const index = await loadRootIndex();
          if (index.lemmaMap.has(strippedTerm)) {
            for (const r of index.lemmaMap.get(strippedTerm)!) rootCandidates.add(r);
          }
          if (index.wordMap.has(strippedTerm)) {
            for (const r of index.wordMap.get(strippedTerm)!) rootCandidates.add(r);
          }
          // Prefix fallback for partial words
          if (strippedTerm.length >= 3) {
            for (const [key, roots] of index.lemmaMap) {
              if (key.startsWith(strippedTerm)) {
                for (const r of roots) rootCandidates.add(r);
              }
            }
            for (const [key, roots] of index.wordMap) {
              if (key.startsWith(strippedTerm)) {
                for (const r of roots) rootCandidates.add(r);
              }
            }
          }

          const candidateList = Array.from(rootCandidates).filter(Boolean);
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

          const lemmaMap = new Map<string, RootOccurrence[]>();
          for (const row of rows) {
            const key = row.lemma || row.word_text;
            if (!lemmaMap.has(key)) lemmaMap.set(key, []);
            lemmaMap.get(key)!.push(row);
          }

          const groups: LemmaGroup[] = [];
          for (const [lemma, occurrences] of lemmaMap) {
            groups.push({ lemma, occurrences });
          }
          groups.sort((a, b) => b.occurrences.length - a.occurrences.length);

          setRootResults(groups);
          setTextResults([]);
          if (groups.length > 0) {
            setExpandedLemmas(new Set([groups[0].lemma]));
          }
        }

        saveToHistory(term.trim(), searchMode);
      } catch (err) {
        console.error("[Search] Error:", err);
      } finally {
        setSearching(false);
      }
    },
    [db, saveToHistory, loadRootIndex]
  );

  const handleQueryChange = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        performSearch(text, mode);
      }, 350);
    },
    [mode, performSearch]
  );

  const handleModeChange = useCallback(
    (newMode: "text" | "root") => {
      setMode(newMode);
      setExpandedLemmas(new Set());
      if (query.trim().length >= 2) {
        performSearch(query, newMode);
      }
    },
    [query, performSearch]
  );

  const handleClear = useCallback(() => {
    setQuery("");
    setTextResults([]);
    setRootResults([]);
    setHasSearched(false);
    inputRef.current?.focus();
  }, []);

  const handleResultTap = useCallback((surah: number, ayah: number) => {
    Keyboard.dismiss();
    setPendingDeepLink({ surah, ayah });
    onClose();
    // Small delay to let modal close before navigating
    setTimeout(() => {
      router.navigate("/(tabs)/mushaf");
    }, 150);
  }, [onClose]);

  const handleHistoryTap = useCallback(
    (entry: HistoryEntry) => {
      setQuery(entry.query);
      setMode(entry.mode as "text" | "root");
      performSearch(entry.query, entry.mode as "text" | "root");
    },
    [performSearch]
  );

  const toggleLemma = useCallback((lemma: string) => {
    setExpandedLemmas((prev) => {
      const next = new Set(prev);
      if (next.has(lemma)) next.delete(lemma);
      else next.add(lemma);
      return next;
    });
  }, []);

  const groupedTextResults = useMemo(() => {
    const groups: { surah: number; nameArabic: string; nameEnglish: string; results: TextResult[] }[] = [];
    let currentSurah = -1;

    for (const r of textResults) {
      if (r.surah !== currentSurah) {
        currentSurah = r.surah;
        groups.push({
          surah: r.surah,
          nameArabic: r.name_arabic,
          nameEnglish: r.name_english,
          results: [],
        });
      }
      groups[groups.length - 1].results.push(r);
    }

    return groups;
  }, [textResults]);

  const totalTextCount = textResults.length;
  const totalRootCount = useMemo(
    () => rootResults.reduce((sum, g) => sum + g.occurrences.length, 0),
    [rootResults]
  );

  const tealColor = "#0d9488";
  const mutedColor = isDark ? "#737373" : "#8B8178";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark" edges={["top"]}>
        {/* Search bar */}
        <View className="px-5 pt-4 pb-3">
          <View className="flex-row items-center bg-surface-high dark:bg-surface-dark-high rounded-full px-4 py-2.5">
            <Search size={18} color={mutedColor} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={handleQueryChange}
              placeholder={s.searchPlaceholder}
              placeholderTextColor={mutedColor}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={() => performSearch(query, mode)}
              style={{
                flex: 1,
                fontFamily: "Manrope_500Medium",
                fontSize: 15,
                color: isDark ? "#e5e5e5" : "#2D2D2D",
                marginLeft: 10,
                marginRight: 8,
                writingDirection: "rtl",
                textAlign: "right",
                paddingVertical: 4,
              }}
            />
            {query.length > 0 ? (
              <Pressable onPress={handleClear} hitSlop={8}>
                <X size={18} color={mutedColor} />
              </Pressable>
            ) : (
              <Pressable onPress={onClose} hitSlop={8}>
                <X size={18} color={mutedColor} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Mode toggle */}
        <View className="px-5 pb-3">
          <View className="flex-row bg-surface-high dark:bg-surface-dark-high rounded-full p-1">
            <Pressable
              onPress={() => handleModeChange("text")}
              className={`flex-1 py-2 rounded-full items-center ${
                mode === "text" ? "bg-surface-bright dark:bg-surface-dark-bright" : ""
              }`}
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
            >
              <Text
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  fontSize: 13,
                  color: mode === "text" ? tealColor : mutedColor,
                }}
              >
                {s.searchTextMode}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleModeChange("root")}
              className={`flex-1 py-2 rounded-full items-center ${
                mode === "root" ? "bg-surface-bright dark:bg-surface-dark-bright" : ""
              }`}
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
            >
              <Text
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  fontSize: 13,
                  color: mode === "root" ? tealColor : mutedColor,
                }}
              >
                {s.searchRootMode}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Content area */}
        {searching ? (
          <SearchResultsSkeleton isDark={isDark} className="flex-1" />
        ) : !hasSearched && query.length === 0 ? (
          <View className="flex-1 px-5">
            {history.length > 0 && (
              <>
                <View className="flex-row items-center justify-between py-3">
                  <Text
                    className="text-warm-400 dark:text-neutral-500"
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      fontSize: 11,
                      letterSpacing: 1,
                      textTransform: "uppercase",
                    }}
                  >
                    {s.searchHistory}
                  </Text>
                  <Pressable onPress={clearHistory} hitSlop={8}>
                    <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: tealColor }}>
                      {s.searchClearHistory}
                    </Text>
                  </Pressable>
                </View>
                <FlatList
                  data={history}
                  keyExtractor={(item) => String(item.id)}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => handleHistoryTap(item)}
                      className="flex-row items-center py-3"
                      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                    >
                      <Clock size={14} color={mutedColor} />
                      <Text
                        className="text-charcoal dark:text-neutral-200 flex-1"
                        style={{
                          fontFamily: "Manrope_500Medium",
                          fontSize: 15,
                          marginLeft: 12,
                          writingDirection: "rtl",
                        }}
                      >
                        {item.query}
                      </Text>
                      <View className="px-2 py-0.5 rounded-full bg-surface-high dark:bg-surface-dark-high">
                        <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 10, color: mutedColor }}>
                          {item.mode === "text" ? s.searchTextMode : s.searchRootMode}
                        </Text>
                      </View>
                    </Pressable>
                  )}
                />
              </>
            )}
            {history.length === 0 && (
              <View className="flex-1 items-center justify-center">
                <Search size={40} color={isDark ? "#404040" : "#DFD9D1"} />
                <Text
                  className="text-warm-300 dark:text-neutral-600 mt-4"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 15 }}
                >
                  {s.searchPlaceholder}
                </Text>
              </View>
            )}
          </View>
        ) : hasSearched && ((mode === "text" && textResults.length === 0) || (mode === "root" && rootResults.length === 0)) ? (
          <View className="flex-1 items-center justify-center">
            <EmptyState
              icon={Search}
              title={s.searchNoResults}
              subtitle={mode === "text" ? s.emptySearchTextSubtitle : s.emptySearchRootSubtitle}
              isDark={isDark}
            />
          </View>
        ) : mode === "text" ? (
          <View className="flex-1">
            <View className="px-5 pb-2">
              <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}>
                {interpolate(s.searchResultCount, { n: totalTextCount })}
              </Text>
            </View>

            <FlatList
              data={groupedTextResults}
              keyExtractor={(item) => `surah-${item.surah}`}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 40 }}
              renderItem={({ item: group }) => (
                <View className="mb-2">
                  <View className="px-5 py-2 bg-surface-low dark:bg-surface-dark-low">
                    <Text
                      className="text-primary-accent dark:text-primary-bright"
                      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                    >
                      {group.nameArabic} — {group.nameEnglish}
                      <Text className="text-warm-400 dark:text-neutral-500" style={{ fontSize: 11 }}>
                        {"  "}({group.results.length})
                      </Text>
                    </Text>
                  </View>

                  {group.results.map((r) => {
                    const segments = buildHighlightSegments(r.text_uthmani, query);
                    return (
                      <Pressable
                        key={`${r.surah}:${r.ayah}`}
                        onPress={() => handleResultTap(r.surah, r.ayah)}
                        className="px-5 py-3"
                        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                      >
                        <View className="flex-row items-center mb-1.5">
                          <View className="px-2 py-0.5 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
                            <Text
                              className="text-primary-accent dark:text-primary-bright"
                              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10 }}
                            >
                              {r.surah}:{r.ayah}
                            </Text>
                          </View>
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
                          numberOfLines={3}
                        >
                          {segments.map((seg, i) =>
                            seg.highlight ? (
                              <Text
                                key={i}
                                style={{
                                  backgroundColor: isDark ? "rgba(13,148,136,0.25)" : "rgba(13,148,136,0.15)",
                                  color: tealColor,
                                  fontFamily: "Manrope_600SemiBold",
                                }}
                              >
                                {seg.text}
                              </Text>
                            ) : (
                              <Text key={i}>{seg.text}</Text>
                            )
                          )}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            />
          </View>
        ) : (
          <View className="flex-1">
            <View className="px-5 pb-2">
              <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}>
                {rootResults.length} {s.searchLemma}
                {"  ·  "}
                {interpolate(s.searchOccurrencesCount, { n: totalRootCount })}
              </Text>
            </View>

            <FlatList
              data={rootResults}
              keyExtractor={(item) => item.lemma}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 40 }}
              renderItem={({ item: group }) => {
                const isExpanded = expandedLemmas.has(group.lemma);
                return (
                  <View className="mb-1">
                    <Pressable
                      onPress={() => toggleLemma(group.lemma)}
                      className="flex-row items-center justify-between px-5 py-3 bg-surface-low dark:bg-surface-dark-low"
                      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
                    >
                      <View className="flex-row items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown size={14} color={tealColor} />
                        ) : (
                          <ChevronRight size={14} color={tealColor} />
                        )}
                        <Text
                          className="text-charcoal dark:text-neutral-100"
                          style={{ fontFamily: "Manrope_700Bold", fontSize: 17, writingDirection: "rtl" }}
                        >
                          {group.lemma}
                        </Text>
                      </View>
                      <View className="px-2.5 py-1 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
                        <Text
                          className="text-primary-accent dark:text-primary-bright"
                          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
                        >
                          {group.occurrences.length}
                        </Text>
                      </View>
                    </Pressable>

                    {isExpanded &&
                      group.occurrences.map((occ) => {
                        const segments = highlightWord(occ.text_uthmani, occ.word_text);
                        return (
                          <Pressable
                            key={`${occ.surah}:${occ.ayah}:${occ.word_pos}`}
                            onPress={() => handleResultTap(occ.surah, occ.ayah)}
                            className="px-5 py-3 ml-5"
                            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                          >
                            <View className="flex-row items-center mb-1.5 gap-2">
                              <View className="px-2 py-0.5 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
                                <Text
                                  className="text-primary-accent dark:text-primary-bright"
                                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10 }}
                                >
                                  {occ.surah}:{occ.ayah}
                                </Text>
                              </View>
                              <Text
                                className="text-warm-400 dark:text-neutral-500"
                                style={{ fontFamily: "Manrope_400Regular", fontSize: 11 }}
                              >
                                {occ.name_english}
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
                              {segments.map((seg, j) =>
                                seg.highlight ? (
                                  <Text
                                    key={j}
                                    style={{
                                      backgroundColor: isDark ? "rgba(13,148,136,0.25)" : "rgba(13,148,136,0.15)",
                                      color: tealColor,
                                      fontFamily: "Manrope_600SemiBold",
                                    }}
                                  >
                                    {seg.text}
                                  </Text>
                                ) : (
                                  <Text key={j}>{seg.text}</Text>
                                )
                              )}
                            </Text>
                          </Pressable>
                        );
                      })}
                  </View>
                );
              }}
            />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}
