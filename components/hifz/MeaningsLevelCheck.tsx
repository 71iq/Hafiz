import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, View, type Text as RNText } from "react-native";
import { Qcf2AyahText } from "@/components/flashcards/Qcf2AyahText";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import type { DatabaseExecutor } from "@/lib/database/types";
import { formatNumber } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { CHECK_BANK, type CheckItem } from "@/lib/meanings/check-bank";
import type { MeaningLanguage, WordPosition } from "@/lib/meanings/lemma-index";
import { mushafWordTexts } from "@/lib/mushaf/glyph-words";
import {
  answer,
  checkResult,
  KNOWN_WORDS_AT_LEVEL,
  MAX_QUESTIONS,
  nextItem,
  shuffledOptions,
  startCheck,
  type CheckState,
} from "@/lib/meanings/level-check";
import { fetchWordMeaningAr, fetchWordTranslation } from "@/lib/word/queries";

const OUTLINE_BORDER = "border border-warm-300 dark:border-neutral-700";
// The outline keeps the ayah and the options visible on surface-low cards (Settings), where the fill alone matches the card.
const SURFACE = `rounded-3xl bg-surface-low dark:bg-surface-dark-low ${OUTLINE_BORDER}`;

type LoadedItem = Readonly<{
  item: CheckItem;
  ayah: { textQcf2: string; textUthmani: string; v2Page: number };
  /** The asked word's text, which the highlight shows but screen readers cannot see. */
  word: string;
  /** The four meanings in the order shown, and which one is right. */
  options: readonly string[];
  correct: number;
}>;

/** A word's meaning as the app shows it in the meaning language: the Arabic entry's first line, or the English gloss. */
async function meaningOf(db: DatabaseExecutor, language: MeaningLanguage, word: WordPosition): Promise<string | null> {
  if (language === "ar") {
    const row = await fetchWordMeaningAr(db, word.surah, word.ayah, word.pos);
    return row?.meaning?.trim().split(/\r?\n/)[0]?.trim() || null;
  }
  const row = await fetchWordTranslation(db, word.surah, word.ayah, word.pos);
  return row?.translation_en?.trim() || null;
}

/** A level in plain words (SPEC 3.6): "You know the commonest 400 words", or the start for level 0. */
export function meaningsLevelText(level: number, s: UIStrings, language: "en" | "ar"): string {
  const words = KNOWN_WORDS_AT_LEVEL[level] ?? 0;
  return words === 0
    ? s.meaningsLevelStart
    : interpolate(s.meaningsLevelKnown, { words: formatNumber(words, language) });
}

async function loadItem(
  db: DatabaseExecutor,
  language: MeaningLanguage,
  item: CheckItem,
  order: number,
): Promise<LoadedItem> {
  const [ayah, ...meanings] = await Promise.all([
    db.getFirstAsync<{ textQcf2: string; textUthmani: string; v2Page: number }>(
      "SELECT text_qcf2 AS textQcf2, text_uthmani AS textUthmani, v2_page AS v2Page FROM quran_text WHERE surah = ? AND ayah = ?",
      [item.word.surah, item.word.ayah],
    ),
    meaningOf(db, language, item.word),
    ...item.distractors.map((word) => meaningOf(db, language, word)),
  ]);
  if (!ayah || meanings.some((meaning) => !meaning)) throw new Error("check item missing data");
  const indexes = shuffledOptions([0, 1, 2, 3], order);
  const word =
    mushafWordTexts(item.word.surah, item.word.ayah, ayah.textUthmani, ayah.textQcf2)[item.word.pos - 1] ?? "";
  return { item, ayah, word, options: indexes.map((index) => meanings[index]!), correct: indexes.indexOf(0) };
}

/**
 * "Check my level" (SPEC 3.6): a word in its ayah with four meanings and "I don't know", up to 12
 * questions, then the level. Answers are not marked right or wrong; the check is not a test.
 */
export function MeaningsLevelCheck({
  db,
  language,
  centre,
  seed,
  uiLanguage,
  fontSize,
  lineHeight,
  s,
  onDone,
  focusOnStart = false,
  bank = CHECK_BANK,
}: {
  db: DatabaseExecutor;
  language: MeaningLanguage;
  /** The level the check starts around: the self-rating's at setup, the stored one in Settings. */
  centre: number;
  /** Fixes which items are drawn; a retake passes another. */
  seed: number;
  uiLanguage: "en" | "ar";
  fontSize: number;
  lineHeight: number;
  s: UIStrings;
  onDone: (level: number) => void;
  /** Move focus to the first question once it loads, when the control that started the check is gone. */
  focusOnStart?: boolean;
  /** The item bank; tests pass a small one. */
  bank?: readonly CheckItem[];
}) {
  const dir = uiLanguage === "ar" ? "rtl" : "ltr";
  const initial = useMemo(() => startCheck(bank, { language, centre, seed }), [bank, language, centre, seed]);
  const [state, setState] = useState<CheckState>(initial);
  const item = useMemo(() => nextItem(state), [state]);
  const [loaded, setLoaded] = useState<LoadedItem | null>(null);
  const [failed, setFailed] = useState(false);
  // An answer removes the button that had focus. On web, focus goes to the next question's prompt
  // once it loads or fails to, so a keyboard or screen-reader user stays in the check and hears the
  // new word.
  const promptRef = useRef<RNText>(null);
  const answered = useRef(focusOnStart);

  // The check restarts when its inputs change (a new rating, language or retake).
  useEffect(() => setState(initial), [initial]);

  useEffect(() => {
    if (item) return;
    onDone(checkResult(state));
    // onDone is the parent's setter; the result is reported once, when the check finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setLoaded(null);
    setFailed(false);
    loadItem(db, language, item, state.asked.length + seed)
      .then((next) => {
        if (!cancelled) setLoaded(next);
      })
      .catch((error: unknown) => {
        console.warn("[MeaningsLevelCheck] Could not load an item:", error);
        // An item that cannot load counts as unanswered: it is skipped as "I don't know" would not be fair.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [db, item, language, seed, state.asked.length]);

  useEffect(() => {
    if (Platform.OS !== "web" || !answered.current || (!loaded && !failed)) return;
    answered.current = false;
    (promptRef.current as unknown as HTMLElement | null)?.focus?.();
  }, [loaded, failed]);

  if (!item) return null;
  const respond = (correct: boolean) => {
    answered.current = true;
    setState((current) => answer(current, item, correct));
  };
  const shown = loaded && loaded.item === item ? loaded : null;
  const optionDir = language === "ar" ? "rtl" : "ltr";

  return (
    <View style={{ gap: 12 }}>
      <Text dir={dir} variant="caption" accessibilityLiveRegion="polite">
        {interpolate(s.meaningsCheckProgress, {
          n: formatNumber(state.asked.length + 1, uiLanguage),
          max: formatNumber(MAX_QUESTIONS, uiLanguage),
        })}
      </Text>
      <Text
        ref={promptRef}
        dir={dir}
        variant="title-sm"
        accessibilityRole="header"
        accessibilityLabel={shown?.word ? interpolate(s.meaningsCheckPromptWord, { word: shown.word }) : undefined}
        // Focusable from script only, for the move after an answer.
        {...(Platform.OS === "web" ? { tabIndex: -1 as const } : {})}
      >
        {s.meaningsCheckPrompt}
      </Text>
      {failed ? (
        <View style={{ gap: 10 }}>
          <Text dir={dir} variant="body-sm" accessibilityRole="alert">
            {s.meaningsCheckLoadFailed}
          </Text>
          {/* Moving past an item that could not load: it is set aside without an answer. */}
          <Button
            variant="outline"
            className={OUTLINE_BORDER}
            label={s.meaningsCheckDontKnow}
            onPress={() => {
              answered.current = true;
              setState((current) => ({ ...current, asked: [...current.asked, item] }));
            }}
          />
        </View>
      ) : shown ? (
        <>
          <View className={`${SURFACE} px-4 py-4`}>
            <Qcf2AyahText
              textQcf2={shown.ayah.textQcf2}
              textUthmani={shown.ayah.textUthmani}
              v2Page={shown.ayah.v2Page}
              fontSize={fontSize}
              lineHeight={lineHeight}
              highlightWordPos={item.word.pos}
              surah={item.word.surah}
              ayah={item.word.ayah}
            />
          </View>
          <View style={{ gap: 8 }}>
            {shown.options.map((option, index) => (
              <Pressable
                key={`${index}:${option}`}
                accessibilityRole="button"
                onPress={() => respond(index === shown.correct)}
                className={`min-h-[48px] justify-center px-4 py-3 ${SURFACE}`}
                style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
              >
                <Text
                  dir={optionDir}
                  style={{ fontSize: 15, lineHeight: 22 }}
                  className="text-charcoal dark:text-neutral-100"
                >
                  {option}
                </Text>
              </Pressable>
            ))}
            <Button
              variant="outline"
              className={OUTLINE_BORDER}
              label={s.meaningsCheckDontKnow}
              onPress={() => respond(false)}
            />
          </View>
        </>
      ) : (
        <View className={SURFACE} style={{ height: 160 }} />
      )}
    </View>
  );
}
