import { useEffect, useState } from "react";
import { ActivityIndicator, View, Text, Pressable } from "react-native";
import { BookmarkPlus, Check } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import {
  fetchWordTranslation,
  fetchWordMeaningAr,
  type WordMeaningArRow,
} from "@/lib/word/queries";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { addMeaningCard, isMeaningCardSaved } from "@/lib/fsrs/queries";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

type EnglishMeaning = {
  wordArabic: string | null;
  translationEn: string | null;
  transliteration: string | null;
};

export function MeaningTab({ surah, ayah, wordPos }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { uiLanguage, isRTL } = useSettings();
  const isArabicMode = uiLanguage === "ar";

  const [enData, setEnData] = useState<EnglishMeaning | null>(null);
  const [arMeaning, setArMeaning] = useState<WordMeaningArRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedToVocab, setSavedToVocab] = useState(false);
  const [savingToVocab, setSavingToVocab] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSaveError(false);
    setSavingToVocab(false);
    isMeaningCardSaved(db, surah, ayah, wordPos)
      .then((saved) => {
        if (!cancelled) setSavedToVocab(saved);
      })
      .catch(() => {
        if (!cancelled) setSavedToVocab(false);
      });
    return () => {
      cancelled = true;
    };
  }, [db, surah, ayah, wordPos]);

  const saveToVocab = async () => {
    if (savedToVocab || savingToVocab) return;
    setSavingToVocab(true);
    setSaveError(false);
    try {
      await addMeaningCard(db, surah, ayah, wordPos);
      setSavedToVocab(true);
    } catch (e) {
      console.warn("[MeaningTab] saveToVocab failed:", e);
      setSaveError(true);
    } finally {
      setSavingToVocab(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    if (isArabicMode) {
      fetchWordMeaningAr(db, surah, ayah, wordPos)
        .then(setArMeaning)
        .finally(() => setLoading(false));
    } else {
      fetchWordTranslation(db, surah, ayah, wordPos)
        .then((wt) => {
          setEnData({
            wordArabic: wt?.word_arabic ?? null,
            translationEn: wt?.translation_en ?? null,
            transliteration: wt?.transliteration ?? null,
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
    if (!arMeaning?.meaning) {
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
        {arMeaning.word && (
          <Text
            className="text-2xl text-charcoal dark:text-neutral-100 mb-3"
            style={{ writingDirection: "rtl", textAlign: "right", fontWeight: "600" }}
          >
            {arMeaning.word}
          </Text>
        )}
        <Text
          className="text-base text-charcoal dark:text-neutral-200 leading-8"
          style={{ writingDirection: "rtl", textAlign: "right" }}
        >
          {arMeaning.meaning}
        </Text>
        <SaveToVocabButton
          saved={savedToVocab}
          saving={savingToVocab}
          onPress={saveToVocab}
          label={savedToVocab ? s.addedToVocab : savingToVocab ? s.addingToVocab : s.addToVocab}
          isRTL={isRTL}
        />
        {saveError && <SaveErrorText isRTL={isRTL} label={s.addToVocabFailed} />}
      </View>
    );
  }

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
        <Text
          className="text-lg text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_600SemiBold", lineHeight: 28 }}
        >
          {enData.translationEn}
        </Text>
      )}
      <SaveToVocabButton
        saved={savedToVocab}
        saving={savingToVocab}
        onPress={saveToVocab}
        label={savedToVocab ? s.addedToVocab : savingToVocab ? s.addingToVocab : s.addToVocab}
        isRTL={isRTL}
      />
      {saveError && <SaveErrorText isRTL={isRTL} label={s.addToVocabFailed} />}
    </View>
  );
}

function SaveToVocabButton({
  saved,
  saving,
  onPress,
  label,
  isRTL,
}: {
  saved: boolean;
  saving: boolean;
  onPress: () => void;
  label: string;
  isRTL: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={saved || saving}
      className={`mt-4 items-center gap-2 rounded-full px-4 py-2 ${isRTL ? "self-end flex-row-reverse" : "self-start flex-row"} ${
        saved ? "bg-primary-accent/10 dark:bg-primary-bright/10" : "bg-surface-high dark:bg-surface-dark-high"
      }`}
      style={({ pressed }) => ({
        transform: [{ scale: pressed ? 0.98 : 1 }],
        opacity: saved ? 0.8 : saving ? 0.7 : 1,
      })}
    >
      {saving ? (
        <ActivityIndicator size="small" color="#0d9488" />
      ) : saved ? (
        <Check size={14} color="#0d9488" />
      ) : (
        <BookmarkPlus size={14} color="#0d9488" />
      )}
      <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SaveErrorText({ isRTL, label }: { isRTL: boolean; label: string }) {
  return (
    <Text
      className={`mt-2 text-xs text-red-600 dark:text-red-400 ${isRTL ? "self-end text-right" : "self-start text-left"}`}
      style={{ fontFamily: "Manrope_500Medium" }}
    >
      {label}
    </Text>
  );
}
