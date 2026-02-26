import { useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  Keyboard,
} from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useSettings } from "../../context/SettingsContext";
import {
  searchAyahsByText,
  searchByRoot,
  getAllSurahs,
  type Ayah,
  type RootSearchResult,
} from "../../db/database";
import SearchResultItem from "./SearchResultItem";
import RootResultGroup from "./RootResultGroup";

type SearchMode = "text" | "root";

export default function SearchScreen() {
  const db = useSQLiteContext();
  const { colorScheme } = useSettings();
  const isDark = colorScheme === "dark";

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("text");
  const [textResults, setTextResults] = useState<Ayah[]>([]);
  const [rootResults, setRootResults] = useState<RootSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Build surah name map for display
  const surahNames = useMemo(() => {
    const surahs = getAllSurahs(db);
    const map = new Map<number, string>();
    for (const s of surahs) map.set(s.number, s.name_arabic);
    return map;
  }, [db]);

  const doSearch = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    Keyboard.dismiss();
    setHasSearched(true);

    if (mode === "text") {
      const results = searchAyahsByText(db, trimmed);
      setTextResults(results);
    } else {
      const results = searchByRoot(db, trimmed);
      setRootResults(results);
    }
  }, [db, query, mode]);

  const handleModeChange = useCallback(
    (newMode: SearchMode) => {
      setMode(newMode);
      setHasSearched(false);
      setTextResults([]);
      setRootResults([]);
    },
    []
  );

  // Group root results by lemma
  const rootGroups = useMemo(() => {
    const groups = new Map<string, RootSearchResult[]>();
    for (const r of rootResults) {
      const existing = groups.get(r.lemma);
      if (existing) existing.push(r);
      else groups.set(r.lemma, [r]);
    }
    return Array.from(groups.entries());
  }, [rootResults]);

  const renderTextItem = useCallback(
    ({ item }: { item: Ayah }) => (
      <SearchResultItem
        surah={item.surah}
        ayah={item.ayah}
        textUthmani={item.text_uthmani}
        surahName={surahNames.get(item.surah)}
      />
    ),
    [surahNames]
  );

  const renderRootGroup = useCallback(
    ({ item }: { item: [string, RootSearchResult[]] }) => (
      <RootResultGroup
        lemma={item[0]}
        results={item[1]}
        surahNames={surahNames}
      />
    ),
    [surahNames]
  );

  const textKeyExtractor = useCallback(
    (item: Ayah) => `${item.surah}:${item.ayah}`,
    []
  );

  const rootKeyExtractor = useCallback(
    (item: [string, RootSearchResult[]]) => item[0],
    []
  );

  const currentResults = mode === "text" ? textResults : rootResults;
  const resultCount =
    mode === "text"
      ? textResults.length
      : rootGroups.reduce((sum, [, items]) => {
          const unique = new Set(items.map((i) => `${i.surah}:${i.ayah}`));
          return sum + unique.size;
        }, 0);

  return (
    <View className="flex-1">
      {/* Search input */}
      <View className="px-4 pt-2 pb-2">
        <View
          className="flex-row items-center rounded-lg px-3 py-2 border"
          style={{
            backgroundColor: isDark ? "#1f2937" : "#f3f4f6",
            borderColor: isDark ? "#374151" : "#d1d5db",
          }}
        >
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={doSearch}
            placeholder={
              mode === "text" ? "Search ayah text..." : "Enter root (e.g. كتب)..."
            }
            placeholderTextColor={isDark ? "#6b7280" : "#9ca3af"}
            returnKeyType="search"
            autoCorrect={false}
            style={{
              flex: 1,
              fontSize: 18,
              writingDirection: "rtl",
              textAlign: "right",
              color: isDark ? "#f3f4f6" : "#111827",
              paddingVertical: 4,
            }}
          />
          <Pressable
            onPress={doSearch}
            className="ml-2 px-3 py-1 rounded-md bg-blue-600 active:bg-blue-700"
          >
            <Text className="text-white font-medium">Search</Text>
          </Pressable>
        </View>
      </View>

      {/* Mode toggle */}
      <View className="flex-row px-4 mb-2">
        <Pressable
          onPress={() => handleModeChange("text")}
          className={`flex-1 py-2 rounded-l-lg items-center border ${
            mode === "text"
              ? "bg-blue-600 border-blue-600"
              : isDark
                ? "bg-gray-800 border-gray-700"
                : "bg-gray-100 border-gray-300"
          }`}
        >
          <Text
            className={
              mode === "text"
                ? "text-white font-bold"
                : isDark
                  ? "text-gray-300"
                  : "text-gray-600"
            }
          >
            Text
          </Text>
        </Pressable>
        <Pressable
          onPress={() => handleModeChange("root")}
          className={`flex-1 py-2 rounded-r-lg items-center border ${
            mode === "root"
              ? "bg-blue-600 border-blue-600"
              : isDark
                ? "bg-gray-800 border-gray-700"
                : "bg-gray-100 border-gray-300"
          }`}
        >
          <Text
            className={
              mode === "root"
                ? "text-white font-bold"
                : isDark
                  ? "text-gray-300"
                  : "text-gray-600"
            }
          >
            Root (جذر)
          </Text>
        </Pressable>
      </View>

      {/* Result count */}
      {hasSearched && (
        <View className="px-4 pb-2">
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            {resultCount === 0
              ? "No results found"
              : `${resultCount} result${resultCount !== 1 ? "s" : ""}`}
            {mode === "root" && rootGroups.length > 0
              ? ` in ${rootGroups.length} form${rootGroups.length !== 1 ? "s" : ""}`
              : ""}
          </Text>
        </View>
      )}

      {/* Results list */}
      {mode === "text" ? (
        <FlatList
          data={textResults}
          renderItem={renderTextItem}
          keyExtractor={textKeyExtractor}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <FlatList
          data={rootGroups}
          renderItem={renderRootGroup}
          keyExtractor={rootKeyExtractor}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}
