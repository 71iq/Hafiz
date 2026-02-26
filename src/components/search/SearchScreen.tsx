import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { View, TextInput, FlatList, Keyboard } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import {
  searchAyahsByText,
  searchByRoot,
  getAllSurahs,
  type Ayah,
  type RootSearchResult,
} from "../../db/database";
import { Button } from "../ui/button";
import { Text } from "../ui/text";
import { TabsList, TabsTrigger } from "../ui/tabs";
import SearchResultItem from "./SearchResultItem";
import RootResultGroup from "./RootResultGroup";

type SearchMode = "text" | "root";

export default function SearchScreen() {
  const db = useSQLiteContext();

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("text");
  const [textResults, setTextResults] = useState<Ayah[]>([]);
  const [rootResults, setRootResults] = useState<RootSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const [surahNames, setSurahNames] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    (async () => {
      const surahs = await getAllSurahs(db);
      const map = new Map<number, string>();
      for (const s of surahs) map.set(s.number, s.name_arabic);
      setSurahNames(map);
    })();
  }, [db]);

  const doSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    Keyboard.dismiss();
    setHasSearched(true);

    if (mode === "text") {
      const results = await searchAyahsByText(db, trimmed);
      setTextResults(results);
    } else {
      const results = await searchByRoot(db, trimmed);
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
        <View className="flex-row items-center rounded-lg px-3 py-2 border border-input bg-muted">
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={doSearch}
            placeholder={
              mode === "text" ? "Search ayah text..." : "Enter root (e.g. كتب)..."
            }
            placeholderTextColor="hsl(var(--muted-foreground))"
            returnKeyType="search"
            autoCorrect={false}
            style={{
              flex: 1,
              fontSize: 18,
              writingDirection: "rtl",
              textAlign: "right",
              paddingVertical: 4,
            }}
            className="text-foreground"
          />
          <Button size="sm" onPress={doSearch} className="ml-2">
            Search
          </Button>
        </View>
      </View>

      {/* Mode toggle */}
      <View className="px-4 mb-2">
        <TabsList>
          <TabsTrigger
            active={mode === "text"}
            onPress={() => handleModeChange("text")}
          >
            Text
          </TabsTrigger>
          <TabsTrigger
            active={mode === "root"}
            onPress={() => handleModeChange("root")}
          >
            {"Root (جذر)"}
          </TabsTrigger>
        </TabsList>
      </View>

      {/* Result count */}
      {hasSearched && (
        <View className="px-4 pb-2">
          <Text variant="muted" className="text-sm">
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
