import { memo, useState, useCallback } from "react";
import { Pressable, View } from "react-native";
import { useSettings } from "../../context/SettingsContext";
import type { RootSearchResult } from "../../db/database";
import { Text } from "../ui/text";
import SearchResultItem from "./SearchResultItem";

interface RootResultGroupProps {
  lemma: string;
  results: RootSearchResult[];
  surahNames: Map<number, string>;
}

export default memo(function RootResultGroup({
  lemma,
  results,
  surahNames,
}: RootResultGroupProps) {
  const { fontSize } = useSettings();
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  // Deduplicate by surah:ayah (a root can appear multiple times in same ayah)
  const uniqueAyahs = new Map<string, RootSearchResult>();
  for (const r of results) {
    const key = `${r.surah}:${r.ayah}`;
    if (!uniqueAyahs.has(key)) uniqueAyahs.set(key, r);
  }
  const ayahList = Array.from(uniqueAyahs.values());

  return (
    <View className="mb-2">
      <Pressable
        onPress={toggle}
        className="flex-row-reverse items-center justify-between px-4 py-3 bg-muted"
      >
        <Text
          style={{ fontSize: fontSize * 0.8, writingDirection: "rtl" }}
          className="text-foreground font-bold"
        >
          {lemma}
        </Text>
        <Text variant="muted" className="text-sm">
          {expanded ? "▲" : "▼"} {ayahList.length} ayah{ayahList.length !== 1 ? "s" : ""}
        </Text>
      </Pressable>
      {expanded &&
        ayahList.map((r) => (
          <SearchResultItem
            key={`${r.surah}:${r.ayah}`}
            surah={r.surah}
            ayah={r.ayah}
            textUthmani={r.text_uthmani}
            surahName={surahNames.get(r.surah)}
            highlight={r.word_text}
          />
        ))}
    </View>
  );
});
