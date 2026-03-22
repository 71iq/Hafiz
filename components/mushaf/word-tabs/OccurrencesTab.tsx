import { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { useWordInteraction } from "@/lib/word/context";
import { fetchWordRoot, fetchRootOccurrences, type RootOccurrence } from "@/lib/word/queries";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

export function OccurrencesTab({ surah, ayah, wordPos }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { navigateToAyah } = useWordInteraction();
  const [root, setRoot] = useState<string | null>(null);
  const [occurrences, setOccurrences] = useState<RootOccurrence[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchWordRoot(db, surah, ayah, wordPos)
      .then(async (rootRow) => {
        if (!rootRow?.root) {
          setRoot(null);
          setOccurrences([]);
          return;
        }
        setRoot(rootRow.root);
        const occ = await fetchRootOccurrences(db, rootRow.root);
        setOccurrences(occ);
      })
      .finally(() => setLoading(false));
  }, [db, surah, ayah, wordPos]);

  if (loading) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">{s.loading}</Text>
      </View>
    );
  }

  if (!root) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">
          {s.noRootData}
        </Text>
      </View>
    );
  }

  return (
    <View className="py-4 px-1">
      {/* Root + count */}
      <View className="flex-row items-center justify-between mb-3">
        <Text
          className="text-xl text-charcoal dark:text-neutral-100 font-semibold"
          style={{ writingDirection: "rtl" }}
        >
          {root}
        </Text>
        <View className="bg-teal-100 dark:bg-teal-900/40 rounded-full px-3 py-1">
          <Text className="text-teal-700 dark:text-teal-300 text-xs font-semibold">
            {interpolate(s.occurrences, { n: occurrences.length })}
          </Text>
        </View>
      </View>

      {/* Occurrence list */}
      <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
        {occurrences.map((occ, i) => {
          const isCurrent =
            occ.surah === surah &&
            occ.ayah === ayah &&
            occ.word_pos === wordPos;
          return (
            <Pressable
              key={`${occ.surah}-${occ.ayah}-${occ.word_pos}`}
              onPress={() => navigateToAyah(occ.surah, occ.ayah)}
              className={`flex-row items-center justify-between py-2 mb-2 ${
                isCurrent ? "bg-teal-50 dark:bg-teal-900/20 -mx-1 px-1 rounded" : ""
              }`}
            >
              <Text className="text-sm text-teal-600 dark:text-teal-400 font-medium w-16 underline">
                {occ.surah}:{occ.ayah}
              </Text>
              <Text
                className="text-base text-charcoal dark:text-neutral-100 flex-1 text-right"
                style={{ writingDirection: "rtl" }}
                numberOfLines={1}
              >
                {occ.word_text}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
