import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { fetchWordTranslation, fetchWordIrab, fetchWordRoot } from "@/lib/word/queries";
import { useStrings } from "@/lib/i18n/useStrings";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

type WordMeaning = {
  wordArabic: string | null;
  translationEn: string | null;
  transliteration: string | null;
  root: string | null;
  lemma: string | null;
};

export function MeaningTab({ surah, ayah, wordPos }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const [data, setData] = useState<WordMeaning | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchWordTranslation(db, surah, ayah, wordPos),
      fetchWordRoot(db, surah, ayah, wordPos),
    ])
      .then(([wt, wr]) => {
        setData({
          wordArabic: wt?.word_arabic ?? null,
          translationEn: wt?.translation_en ?? null,
          transliteration: wt?.transliteration ?? null,
          root: wr?.root ?? null,
          lemma: wr?.lemma ?? null,
        });
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

  if (!data || (!data.wordArabic && !data.translationEn)) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">
          {s.noMeaningData ?? "No meaning data available"}
        </Text>
      </View>
    );
  }

  return (
    <View className="py-4 px-1">
      {/* Arabic word */}
      {data.wordArabic && (
        <View className="mb-4 items-center">
          <Text
            className="text-3xl text-warm-900 dark:text-neutral-100 font-semibold"
            style={{ writingDirection: "rtl" }}
          >
            {data.wordArabic}
          </Text>
          {data.transliteration && (
            <Text className="text-sm text-warm-400 dark:text-neutral-500 mt-1 italic">
              {data.transliteration}
            </Text>
          )}
        </View>
      )}

      {/* English meaning */}
      {data.translationEn && (
        <Row label={s.wordMeaningTranslation ?? "Translation"} value={data.translationEn} />
      )}

      {/* Root */}
      {data.root && (
        <Row label={s.wordMeaningRoot ?? "Root"} value={data.root} rtl />
      )}

      {/* Lemma */}
      {data.lemma && (
        <Row label={s.wordMeaningLemma ?? "Lemma"} value={data.lemma} rtl />
      )}
    </View>
  );
}

function Row({ label, value, rtl }: { label: string; value: string; rtl?: boolean }) {
  return (
    <View className="flex-row items-center justify-between py-2.5 border-b border-warm-100 dark:border-neutral-800/50">
      <Text className="text-xs font-medium text-warm-400 dark:text-neutral-500 uppercase tracking-wider">
        {label}
      </Text>
      <Text
        className="text-base text-warm-800 dark:text-neutral-100 font-medium"
        style={rtl ? { writingDirection: "rtl" } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}
