import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { BookmarkPlus, Check } from "lucide-react-native";
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
import { addVocabCard, isVocabCardSaved } from "@/lib/vocab/queries";

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
  const [savedToVocab, setSavedToVocab] = useState(false);

  useEffect(() => {
    isVocabCardSaved(db, surah, ayah, wordPos).then(setSavedToVocab).catch(() => {});
  }, [db, surah, ayah, wordPos]);

  const saveToVocab = async () => {
    if (savedToVocab) return;
    const meaningAr = arMatchIdx >= 0 ? arRows[arMatchIdx]?.meaning ?? null : null;
    const word =
      (arMatchIdx >= 0 ? arRows[arMatchIdx]?.word : null) ??
      enData?.wordArabic ??
      null;
    try {
      await addVocabCard(db, {
        surah,
        ayah,
        wordPos,
        word,
        meaningAr,
        meaningEn: enData?.translationEn ?? null,
      });
      setSavedToVocab(true);
    } catch (e) {
      console.warn("[MeaningTab] saveToVocab failed:", e);
    }
  };

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
    // If we matched a specific word, show only its meaning. Otherwise show
    // every meaning available for the ayah so the user can read context.
    const matched = arMatchIdx >= 0 ? arRows[arMatchIdx] : null;
    if (matched && matched.meaning) {
      return (
        <View className="py-4 px-1">
          {matched.word && (
            <Text
              className="text-2xl text-charcoal dark:text-neutral-100 mb-3"
              style={{ writingDirection: "rtl", textAlign: "right", fontWeight: "600" }}
            >
              {matched.word}
            </Text>
          )}
          <Text
            className="text-base text-charcoal dark:text-neutral-200 leading-8"
            style={{ writingDirection: "rtl", textAlign: "right" }}
          >
            {matched.meaning}
          </Text>
          <SaveToVocabButton saved={savedToVocab} onPress={saveToVocab} label={savedToVocab ? s.addedToVocab : s.addToVocab} />
        </View>
      );
    }

    // No exact match — fall back to listing every meaning for the ayah.
    return (
      <View className="py-4 px-1">
        {arRows.map((row) => (
          <View key={`${row.surah}-${row.ayah}-${row.word_pos}`} className="mb-4">
            {row.word && (
              <Text
                className="text-lg text-charcoal dark:text-neutral-100 mb-1"
                style={{ writingDirection: "rtl", textAlign: "right", fontWeight: "600" }}
              >
                {row.word}
              </Text>
            )}
            {row.meaning && (
              <Text
                className="text-base text-charcoal dark:text-neutral-200 leading-7"
                style={{ writingDirection: "rtl", textAlign: "right" }}
              >
                {row.meaning}
              </Text>
            )}
          </View>
        ))}
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
      <SaveToVocabButton saved={savedToVocab} onPress={saveToVocab} label={savedToVocab ? s.addedToVocab : s.addToVocab} />
    </View>
  );
}

function SaveToVocabButton({
  saved,
  onPress,
  label,
}: {
  saved: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={saved}
      className={`mt-4 self-start flex-row items-center gap-2 rounded-full px-4 py-2 ${
        saved ? "bg-primary-accent/10 dark:bg-primary-bright/10" : "bg-surface-high dark:bg-surface-dark-high"
      }`}
      style={({ pressed }) => ({
        transform: [{ scale: pressed ? 0.98 : 1 }],
        opacity: saved ? 0.8 : 1,
      })}
    >
      {saved ? <Check size={14} color="#0d9488" /> : <BookmarkPlus size={14} color="#0d9488" />}
      <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
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
