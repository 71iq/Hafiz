import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import {
  fetchWordTranslation,
  fetchWordRoot,
  fetchWordText,
  fetchWordMeaningsArForAyah,
  findBestWordMatch,
  type WordMeaningArRow,
} from "@/lib/word/queries";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

type EnglishMeaning = {
  wordArabic: string | null;
  translationEn: string | null;
  transliteration: string | null;
  root: string | null;
  lemma: string | null;
};

export function MeaningTab({ surah, ayah, wordPos }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { uiLanguage } = useSettings();
  const isArabicMode = uiLanguage === "ar";

  const [enData, setEnData] = useState<EnglishMeaning | null>(null);
  const [arRows, setArRows] = useState<WordMeaningArRow[]>([]);
  const [arMatchIdx, setArMatchIdx] = useState<number>(-1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (isArabicMode) {
      Promise.all([
        fetchWordMeaningsArForAyah(db, surah, ayah),
        fetchWordText(db, surah, ayah, wordPos),
      ])
        .then(([rows, tappedText]) => {
          setArRows(rows);
          setArMatchIdx(findBestWordMatch(rows, wordPos, tappedText ?? ""));
        })
        .finally(() => setLoading(false));
    } else {
      Promise.all([
        fetchWordTranslation(db, surah, ayah, wordPos),
        fetchWordRoot(db, surah, ayah, wordPos),
      ])
        .then(([wt, wr]) => {
          setEnData({
            wordArabic: wt?.word_arabic ?? null,
            translationEn: wt?.translation_en ?? null,
            transliteration: wt?.transliteration ?? null,
            root: wr?.root ?? null,
            lemma: wr?.lemma ?? null,
          });
        })
        .finally(() => setLoading(false));
    }
  }, [db, surah, ayah, wordPos, isArabicMode]);

  if (loading) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">{s.loading}</Text>
      </View>
    );
  }

  if (isArabicMode) {
    if (arRows.length === 0) {
      return (
        <View className="py-6 items-center">
          <Text
            className="text-warm-400 dark:text-neutral-500 text-sm"
            style={{ writingDirection: "rtl" }}
          >
            {s.noArabicMeaning}
          </Text>
        </View>
      );
    }
    return (
      <View className="py-4 px-1">
        {arRows.map((row, i) => {
          const isMatch = i === arMatchIdx;
          return (
            <View
              key={`${row.surah}-${row.ayah}-${row.word_pos}`}
              className={`mb-3 p-3 rounded-2xl ${
                isMatch
                  ? "bg-primary-accent/10 dark:bg-primary-bright/10"
                  : "bg-surface-high dark:bg-surface-dark-high"
              }`}
            >
              {row.word && (
                <Text
                  className={`text-xl mb-1.5 font-semibold ${
                    isMatch
                      ? "text-primary-accent dark:text-primary-bright"
                      : "text-charcoal dark:text-neutral-100"
                  }`}
                  style={{ writingDirection: "rtl", textAlign: "right" }}
                >
                  {row.word}
                </Text>
              )}
              {row.meaning && (
                <Text
                  className="text-base text-charcoal dark:text-neutral-200 leading-7"
                  style={{
                    writingDirection: "rtl",
                    textAlign: "right",
                    fontFamily: "IBMPlexSansArabic, NotoSansArabic, system-ui",
                  }}
                >
                  {row.meaning}
                </Text>
              )}
            </View>
          );
        })}
        <Text
          className="text-xs text-warm-400 dark:text-neutral-500 mt-2"
          style={{ writingDirection: "rtl", textAlign: "right" }}
        >
          {s.meaningSourceAttribution}
        </Text>
      </View>
    );
  }

  // English mode — unchanged legacy rendering
  if (!enData || (!enData.wordArabic && !enData.translationEn)) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">
          {s.noMeaningData}
        </Text>
      </View>
    );
  }

  return (
    <View className="py-4 px-1">
      {enData.wordArabic && (
        <View className="mb-4 items-center">
          <Text
            className="text-3xl text-charcoal dark:text-neutral-100 font-semibold"
            style={{ writingDirection: "rtl" }}
          >
            {enData.wordArabic}
          </Text>
          {enData.transliteration && (
            <Text className="text-sm text-warm-400 dark:text-neutral-500 mt-1 italic">
              {enData.transliteration}
            </Text>
          )}
        </View>
      )}

      {enData.translationEn && (
        <Row label={s.wordMeaningTranslation ?? "Translation"} value={enData.translationEn} />
      )}

      {enData.root && (
        <Row label={s.wordMeaningRoot ?? "Root"} value={enData.root} rtl />
      )}

      {enData.lemma && (
        <Row label={s.wordMeaningLemma ?? "Lemma"} value={enData.lemma} rtl />
      )}
    </View>
  );
}

function Row({ label, value, rtl }: { label: string; value: string; rtl?: boolean }) {
  return (
    <View className="flex-row items-center justify-between py-2.5 mb-2">
      <Text className="text-xs font-medium text-warm-400 dark:text-neutral-500 uppercase tracking-wider">
        {label}
      </Text>
      <Text
        className="text-base text-charcoal dark:text-neutral-100 font-medium"
        style={rtl ? { writingDirection: "rtl" } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}
