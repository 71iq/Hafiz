import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { fetchWordIrab, type WordIrabRow } from "@/lib/word/queries";
import { decodeLabelList } from "@/lib/word/morphology-labels";
import { useStrings } from "@/lib/i18n/useStrings";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

export function IrabTab({ surah, ayah, wordPos }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const [data, setData] = useState<WordIrabRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchWordIrab(db, surah, ayah, wordPos)
      .then((row) => setData(row))
      .finally(() => setLoading(false));
  }, [db, surah, ayah, wordPos]);

  if (loading) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">{s.loading}</Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">
          {s.noIrabData}
        </Text>
      </View>
    );
  }

  const decodedMorpho = decodeLabelList(data.morphological_tag);
  const decodedSyntax = decodeLabelList(data.syntactic_function);

  return (
    <View className="py-4 px-1">
      {/* Arabic word */}
      {data.arabic_word && (
        <View className="mb-4">
          <Text
            className="text-2xl text-charcoal dark:text-neutral-100 mb-2"
            style={{ writingDirection: "rtl", textAlign: "right" }}
          >
            {data.arabic_word}
          </Text>
        </View>
      )}

      {/* Syntactic Function */}
      {decodedSyntax && (
        <View className="mb-4">
          <Text className="text-xs font-medium text-warm-400 dark:text-neutral-500 uppercase tracking-wider mb-1.5">
            {s.syntacticFunction}
          </Text>
          <Text
            className="text-base text-charcoal dark:text-neutral-100 leading-6"
            style={{ writingDirection: "rtl", textAlign: "right" }}
          >
            {decodedSyntax}
          </Text>
        </View>
      )}

      {/* Morphological Tag */}
      {decodedMorpho && (
        <View className="mb-4">
          <Text className="text-xs font-medium text-warm-400 dark:text-neutral-500 uppercase tracking-wider mb-1.5">
            {s.morphologicalTag}
          </Text>
          <Text
            className="text-base text-charcoal dark:text-neutral-100 leading-6"
            style={{ writingDirection: "rtl", textAlign: "right" }}
          >
            {decodedMorpho}
          </Text>
        </View>
      )}
    </View>
  );
}
