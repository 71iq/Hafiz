import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { fetchWordTranslation, type WordTranslationRow } from "@/lib/word/queries";
import { useStrings } from "@/lib/i18n/useStrings";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

export function EnglishTab({ surah, ayah, wordPos }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const [data, setData] = useState<WordTranslationRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchWordTranslation(db, surah, ayah, wordPos)
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
          {s.noTranslationData}
        </Text>
      </View>
    );
  }

  return (
    <View className="py-4 px-1">
      {/* Translation */}
      <View className="mb-4">
        <Text className="text-xs font-medium text-warm-400 dark:text-neutral-500 uppercase tracking-wider mb-1.5">
          {s.wordTranslation}
        </Text>
        <Text className="text-base text-charcoal dark:text-neutral-100 leading-6">
          {data.translation_en}
        </Text>
      </View>

      {/* Transliteration */}
      {data.transliteration && (
        <View className="mb-4">
          <Text className="text-xs font-medium text-warm-400 dark:text-neutral-500 uppercase tracking-wider mb-1.5">
            {s.wordTransliteration}
          </Text>
          <Text className="text-base text-warm-600 dark:text-neutral-300 leading-6 italic">
            {data.transliteration}
          </Text>
        </View>
      )}

      {/* Arabic word */}
      {data.word_arabic && (
        <View>
          <Text className="text-xs font-medium text-warm-400 dark:text-neutral-500 uppercase tracking-wider mb-1.5">
            {s.wordArabic}
          </Text>
          <Text
            className="text-2xl text-charcoal dark:text-neutral-100"
            style={{ writingDirection: "rtl", textAlign: "right" }}
          >
            {data.word_arabic}
          </Text>
        </View>
      )}
    </View>
  );
}
