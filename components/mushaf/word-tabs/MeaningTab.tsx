import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, View, Text, Pressable, TextInput } from "react-native";
import { BookmarkPlus, Check, Pencil, Save, Trash2 } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import {
  deleteUserWordMeaning,
  fetchWordTranslation,
  fetchWordMeaningAr,
  upsertUserWordMeaning,
  type WordMeaningArRow,
} from "@/lib/word/queries";
import { useSettings } from "@/lib/settings/context";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DiscardChangesDialog, isEditableTextDirty, useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { addMeaningCard, fetchMeaningCardDue, getTotalCardCount, isMeaningCardSaved, MEANINGS_DECK_ID } from "@/lib/fsrs/queries";
import { formatDays } from "@/lib/i18n/count";
import { useDelayedLoading } from "./use-delayed-loading";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  const { uiLanguage, isRTL, isDark, themeColors } = useSettings();
  const isArabicMode = uiLanguage === "ar";

  const [enData, setEnData] = useState<EnglishMeaning | null>(null);
  const [arMeaning, setArMeaning] = useState<WordMeaningArRow | null>(null);
  const [wordArabic, setWordArabic] = useState<string | null>(null);
  const [customMeaningDraft, setCustomMeaningDraft] = useState("");
  const [customMeaningSaving, setCustomMeaningSaving] = useState(false);
  const [customMeaningError, setCustomMeaningError] = useState(false);
  const [editingCustom, setEditingCustom] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  // Each loaded word is one generation; a save or delete that settles after a switch is ignored.
  const generation = useRef(0);
  const [loading, setLoading] = useState(true);
  const [savedToVocab, setSavedToVocab] = useState(false);
  const [savingToVocab, setSavingToVocab] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // Read only: shows when the saved word comes up next, without creating or rescheduling a card.
  const [reviewDue, setReviewDue] = useState<string | null>(null);
  // The first saved word also makes the Vocabulary Review deck appear on Home; say where it went.
  const [firstVocabWord, setFirstVocabWord] = useState(false);
  const showLoading = useDelayedLoading(loading);

  useEffect(() => {
    let cancelled = false;
    setSaveError(false);
    setSavingToVocab(false);
    setReviewDue(null);
    setFirstVocabWord(false);
    isMeaningCardSaved(db, surah, ayah, wordPos)
      .then(async (saved) => {
        if (cancelled) return;
        setSavedToVocab(saved);
        if (!saved) return;
        const due = await fetchMeaningCardDue(db, surah, ayah, wordPos);
        if (!cancelled) setReviewDue(due);
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
      let deckWasEmpty = false;
      try {
        deckWasEmpty = (await getTotalCardCount(db, MEANINGS_DECK_ID)) === 0;
      } catch {
        // Only the notice depends on this count; the save goes ahead without it.
      }
      const { created } = await addMeaningCard(db, surah, ayah, wordPos);
      setSavedToVocab(true);
      setFirstVocabWord(created && deckWasEmpty);
      fetchMeaningCardDue(db, surah, ayah, wordPos)
        .then(setReviewDue)
        .catch(() => undefined);
    } catch (e) {
      console.warn("[MeaningTab] saveToVocab failed:", e);
      setSaveError(true);
    } finally {
      setSavingToVocab(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    generation.current += 1;
    setLoading(true);
    setCustomMeaningDraft("");
    setCustomMeaningSaving(false);
    setCustomMeaningError(false);
    setEditingCustom(false);
    setDeleteOpen(false);
    setDeleting(false);
    setDeleteError(false);
    setArMeaning(null);
    setEnData(null);
    setWordArabic(null);
    if (isArabicMode) {
      Promise.all([
        fetchWordMeaningAr(db, surah, ayah, wordPos),
        fetchWordTranslation(db, surah, ayah, wordPos),
      ])
        .then(([meaning, translation]) => {
          if (cancelled) return;
          setArMeaning(meaning);
          setWordArabic(meaning?.word ?? translation?.word_arabic ?? null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      fetchWordTranslation(db, surah, ayah, wordPos)
        .then((wt) => {
          if (cancelled) return;
          setEnData({
            wordArabic: wt?.word_arabic ?? null,
            translationEn: wt?.translation_en ?? null,
            transliteration: wt?.transliteration ?? null,
          });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [db, surah, ayah, wordPos, isArabicMode]);

  const saveCustomMeaning = async () => {
    const meaning = customMeaningDraft.trim();
    if (!meaning || customMeaningSaving) return;
    const own = generation.current;
    setCustomMeaningSaving(true);
    setCustomMeaningError(false);
    try {
      await upsertUserWordMeaning(db, {
        surah,
        ayah,
        wordPos,
        word: wordArabic,
        meaning,
      });
      // Reload so the shown row carries its real provenance and original created_at.
      const saved = await fetchWordMeaningAr(db, surah, ayah, wordPos).catch(() => null);
      if (generation.current !== own) return;
      setArMeaning(
        saved?.meaning
          ? saved
          : { surah, ayah, word_pos: wordPos, word: wordArabic, meaning, source: "custom", custom_created_at: null },
      );
      setCustomMeaningDraft("");
      setEditingCustom(false);
    } catch (e) {
      if (generation.current !== own) return;
      console.warn("[MeaningTab] saveCustomMeaning failed:", e);
      setCustomMeaningError(true);
    } finally {
      if (generation.current === own) setCustomMeaningSaving(false);
    }
  };

  const customShown = arMeaning?.source === "custom" ? arMeaning : null;
  const editDirty = editingCustom && isEditableTextDirty(customMeaningDraft, customShown?.meaning);
  const discardGuard = useDiscardGuard(editDirty);

  const startEditingCustom = () => {
    if (!customShown?.meaning) return;
    setCustomMeaningDraft(customShown.meaning);
    setCustomMeaningError(false);
    setEditingCustom(true);
  };

  const cancelEditingCustom = () =>
    discardGuard.guard(() => {
      setEditingCustom(false);
      setCustomMeaningDraft("");
      setCustomMeaningError(false);
    });

  const confirmDeleteCustom = async () => {
    const shown = customShown;
    if (!shown?.meaning || !shown.custom_created_at || deleting) return;
    const own = generation.current;
    setDeleting(true);
    setDeleteError(false);
    try {
      const outcome = await deleteUserWordMeaning(db, {
        surah,
        ayah,
        wordPos,
        meaning: shown.meaning,
        createdAt: shown.custom_created_at,
      });
      if (generation.current !== own) return;
      if (outcome === "deleted") {
        setDeleteOpen(false);
        setArMeaning({ ...shown, meaning: null, source: null, custom_created_at: null });
        return;
      }
      // The row changed since it was shown: keep the dialog's error and show the current meaning.
      setDeleteError(true);
      const current = await fetchWordMeaningAr(db, surah, ayah, wordPos).catch(() => null);
      if (generation.current === own && current) setArMeaning(current);
    } catch (e) {
      if (generation.current !== own) return;
      console.warn("[MeaningTab] deleteCustomMeaning failed:", e);
      setDeleteError(true);
    } finally {
      if (generation.current === own) setDeleting(false);
    }
  };

  if (loading) {
    return (
      <View className="py-6 items-center">
        {showLoading ? <Text className="text-warm-500 dark:text-neutral-400 text-sm">{s.loading}</Text> : null}
      </View>
    );
  }

  const reviewNote = (() => {
    if (!savedToVocab || !reviewDue) return null;
    const dueAt = Date.parse(reviewDue);
    if (!Number.isFinite(dueAt)) return null;
    const days = Math.ceil((dueAt - Date.now()) / DAY_MS);
    return days <= 0
      ? s.wordMeaningDueNow
      : interpolate(s.wordMeaningNextReview, { duration: formatDays(days, isArabicMode ? "ar" : "en") });
  })();

  if (isArabicMode) {
    if (!arMeaning?.meaning) {
      return (
        <View className="py-4 px-1">
          {wordArabic && (
            <Text
              className="text-2xl text-charcoal dark:text-neutral-100 mb-3"
              style={{ writingDirection: "rtl", textAlign: "right", fontWeight: "600" }}
            >
              {wordArabic}
            </Text>
          )}
          <Text
            className="text-warm-500 dark:text-neutral-400 text-sm"
            style={{ writingDirection: "rtl", textAlign: "right", fontFamily: "Manrope_500Medium", lineHeight: 22 }}
          >
            {s.noWordMeaningFallback}
          </Text>
          <TextInput
            value={customMeaningDraft}
            onChangeText={setCustomMeaningDraft}
            placeholder={s.customWordMeaningPlaceholder}
            placeholderTextColor={isDark ? "#737373" : themeColors.surfaceDim}
            multiline
            className="mt-4 min-h-[92px] rounded-2xl bg-surface dark:bg-surface-dark px-4 py-3 text-charcoal dark:text-neutral-100"
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 15,
              lineHeight: 24,
              textAlign: "right",
              textAlignVertical: "top",
              writingDirection: "rtl",
            }}
          />
          <MutedLine isRTL label={s.wordMeaningPrivate} />
          <CustomMeaningButton
            saving={customMeaningSaving}
            disabled={!customMeaningDraft.trim()}
            onPress={saveCustomMeaning}
            label={
              customMeaningSaving
                ? s.customWordMeaningSaving
                : customMeaningError
                  ? s.wordMeaningRetry
                  : s.saveCustomWordMeaning
            }
            isRTL={isRTL}
          />
          {customMeaningError && <SaveErrorText isRTL={isRTL} label={s.customWordMeaningFailed} />}
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
        {customShown ? (
          <Text
            className="mb-1 text-xs text-warm-500 dark:text-neutral-400"
            style={{ writingDirection: "rtl", textAlign: "right", fontFamily: "Manrope_600SemiBold" }}
          >
            {s.customWordMeaningYours}
          </Text>
        ) : null}
        {customShown && editingCustom ? (
          <>
            <TextInput
              value={customMeaningDraft}
              onChangeText={setCustomMeaningDraft}
              placeholder={s.customWordMeaningPlaceholder}
              placeholderTextColor={isDark ? "#737373" : themeColors.surfaceDim}
              accessibilityLabel={s.customWordMeaningEditLabel}
              multiline
              autoFocus
              className="min-h-[92px] rounded-2xl bg-surface dark:bg-surface-dark px-4 py-3 text-charcoal dark:text-neutral-100"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 15,
                lineHeight: 24,
                textAlign: "right",
                textAlignVertical: "top",
                writingDirection: "rtl",
              }}
            />
            <View className={`mt-1 flex-wrap items-center gap-2 ${isRTL ? "self-end flex-row-reverse" : "self-start flex-row"}`}>
              <CustomMeaningButton
                saving={customMeaningSaving}
                disabled={!customMeaningDraft.trim() || !editDirty}
                onPress={saveCustomMeaning}
                label={customMeaningSaving ? s.customWordMeaningSaving : s.saveCustomWordMeaning}
                isRTL={isRTL}
              />
              <CustomMeaningAction
                label={s.customWordMeaningCancelEdit}
                onPress={cancelEditingCustom}
                disabled={customMeaningSaving}
                isRTL={isRTL}
              />
            </View>
            {customMeaningError && <SaveErrorText isRTL={isRTL} label={s.customWordMeaningFailed} />}
            <DiscardChangesDialog {...discardGuard.dialogProps} />
          </>
        ) : (
          <Text
            className="text-base text-charcoal dark:text-neutral-200 leading-8"
            style={{ writingDirection: "rtl", textAlign: "right" }}
          >
            {arMeaning.meaning}
          </Text>
        )}
        {customShown && !editingCustom ? (
          <View className={`mt-2 flex-wrap items-center gap-2 ${isRTL ? "self-end flex-row-reverse" : "self-start flex-row"}`}>
            <CustomMeaningAction
              label={s.customWordMeaningEdit}
              accessibilityLabel={s.customWordMeaningEditLabel}
              icon={<Pencil size={14} color={isDark ? "#d4d4d4" : "#5c4a3a"} />}
              onPress={startEditingCustom}
              isRTL={isRTL}
            />
            {customShown.custom_created_at ? (
              <CustomMeaningAction
                label={s.customWordMeaningDelete}
                accessibilityLabel={s.customWordMeaningDeleteLabel}
                icon={<Trash2 size={14} color={isDark ? "#f87171" : "#dc2626"} />}
                onPress={() => {
                  setDeleteError(false);
                  setDeleteOpen(true);
                }}
                isRTL={isRTL}
                destructive
              />
            ) : null}
          </View>
        ) : null}
        <ConfirmDialog
          visible={deleteOpen && !!customShown}
          title={s.customWordMeaningDeleteTitle}
          message={
            arMeaning.word
              ? interpolate(s.customWordMeaningDeleteMessage, { word: arMeaning.word })
              : s.customWordMeaningDeleteMessageNoWord
          }
          cancelLabel={s.customWordMeaningCancelEdit}
          confirmLabel={deleting ? s.customWordMeaningDeleting : s.customWordMeaningDelete}
          destructive
          confirmLoading={deleting}
          error={deleteError ? s.customWordMeaningDeleteFailed : null}
          isDark={isDark}
          isRTL={isRTL}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={confirmDeleteCustom}
        />
        {arMeaning.source === "bundled" ? <MutedLine isRTL label={s.wordMeaningSource} /> : null}
        <SaveToVocabButton
          saved={savedToVocab}
          saving={savingToVocab}
          onPress={saveToVocab}
          label={savedToVocab ? s.addedToVocab : savingToVocab ? s.addingToVocab : s.addToVocab}
          isRTL={isRTL}
        />
        {saveError && <SaveErrorText isRTL={isRTL} label={s.addToVocabFailed} />}
        {firstVocabWord ? <MutedLine isRTL={isRTL} label={s.homeVocabAdded} /> : null}
        {reviewNote ? <MutedLine isRTL={isRTL} label={reviewNote} /> : null}
      </View>
    );
  }

  if (!enData || (!enData.wordArabic && !enData.translationEn)) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-500 dark:text-neutral-400 text-sm">
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
      {firstVocabWord ? <MutedLine isRTL={isRTL} label={s.homeVocabAdded} /> : null}
      {reviewNote ? <MutedLine isRTL={isRTL} label={reviewNote} /> : null}
    </View>
  );
}

function CustomMeaningButton({
  saving,
  disabled,
  onPress,
  label,
  isRTL,
}: {
  saving: boolean;
  disabled: boolean;
  onPress: () => void;
  label: string;
  isRTL: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || saving}
      className={`mt-3 items-center gap-2 rounded-full px-4 py-2 ${isRTL ? "self-end flex-row-reverse" : "self-start flex-row"} bg-primary-accent dark:bg-primary-bright`}
      style={({ pressed }) => ({
        transform: [{ scale: pressed ? 0.98 : 1 }],
        opacity: disabled ? 0.45 : saving ? 0.7 : 1,
      })}
    >
      {saving ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Save size={14} color="#FFFFFF" />
      )}
      <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function CustomMeaningAction({
  label,
  accessibilityLabel,
  icon,
  onPress,
  disabled = false,
  destructive = false,
  isRTL,
}: {
  label: string;
  accessibilityLabel?: string;
  icon?: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  isRTL: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      className={`mt-3 min-h-11 items-center gap-2 rounded-full bg-surface-high px-4 dark:bg-surface-dark-high ${
        isRTL ? "flex-row-reverse" : "flex-row"
      }`}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }], opacity: disabled ? 0.45 : 1 })}
    >
      {icon}
      <Text
        className={destructive ? "text-red-600 dark:text-red-400" : "text-charcoal dark:text-neutral-200"}
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
      >
        {label}
      </Text>
    </Pressable>
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

function MutedLine({ isRTL, label }: { isRTL: boolean; label: string }) {
  return (
    <Text
      className={`mt-2 text-warm-500 dark:text-neutral-400 ${isRTL ? "self-end text-right" : "self-start text-left"}`}
      style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18, writingDirection: isRTL ? "rtl" : "ltr" }}
    >
      {label}
    </Text>
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
