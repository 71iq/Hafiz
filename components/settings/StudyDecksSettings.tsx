import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, View, type Text as RNText } from "react-native";
import { MeaningsLevelCheck, meaningsLevelText } from "@/components/hifz/MeaningsLevelCheck";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Switch } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import type { AppDatabase } from "@/lib/database/types";
import { emitHabitChanged, subscribeHabitChanged } from "@/lib/habit/use-habit-overview";
import type { UIStrings } from "@/lib/i18n/strings";
import { CHECK_BANK } from "@/lib/meanings/check-bank";
import { MAX_LEVEL, type MeaningLanguage } from "@/lib/meanings/lemma-index";
import { hasCheckItems } from "@/lib/meanings/level-check";
import {
  defaultLevelFor,
  readMeaningsSettings,
  writeMeaningLanguage,
  writeMeaningsLevel,
  type MeaningsSettings,
} from "@/lib/meanings/settings";
import { useSettings } from "@/lib/settings/context";
import {
  readStudyDeckSettings,
  writeDeckSwitch,
  writeMeaningsInDailyStudy,
  type DeckSwitch,
  type StudyDeckSettings,
  type SwitchableDeck,
} from "@/lib/study/daily-decks";

type Props = {
  db: AppDatabase;
  language: "en" | "ar";
  s: UIStrings;
};

/**
 * Settings > General > Daily study (SPEC 3.6, 3.7): whether word meanings join daily study, their
 * language and word level, with the level check to retake, and Qira'at and Reasons of revelation as
 * Automatic, On or Off. Automatic is on once the whole Quran is memorized. The settings sync with the
 * account.
 */
export function StudyDecksSettings({ db, language, s }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const { fontSize, lineHeight } = useSettings();
  const [settings, setSettings] = useState<StudyDeckSettings | null>(null);
  const [meanings, setMeanings] = useState<MeaningsSettings | null>(null);
  const [checking, setChecking] = useState(false);
  // Finishing or leaving the check removes the control that had focus; on web the level text takes it.
  const levelTextRef = useRef<RNText>(null);
  const focusLevel = useRef(false);
  useEffect(() => {
    if (checking || !focusLevel.current || Platform.OS !== "web") return;
    focusLevel.current = false;
    (levelTextRef.current as unknown as HTMLElement | null)?.focus?.();
  }, [checking]);
  const endCheck = () => {
    focusLevel.current = true;
    setChecking(false);
  };
  // Each retake draws other items.
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [decks, meaningSettings] = await Promise.all([readStudyDeckSettings(db), readMeaningsSettings(db)]);
      setSettings(decks);
      setMeanings(meaningSettings);
    } catch (error) {
      console.warn("[StudyDecks] Settings failed to load:", error);
    }
  }, [db]);

  useEffect(() => {
    load();
    return subscribeHabitChanged(load);
  }, [load]);

  const save = useCallback(
    async (work: () => Promise<void>) => {
      setFailed(false);
      try {
        await work();
        emitHabitChanged();
      } catch (error) {
        console.warn("[StudyDecks] Setting failed to save:", error);
        setFailed(true);
      }
      await load();
    },
    [load],
  );

  if (!settings || !meanings) return null;

  // Values the user never chose follow the interface language shown now. The loaded snapshot would
  // keep the old one after a language switch in this same panel, and the level buttons would write
  // from it.
  const meaningLanguage = meanings.stored.language ? meanings.language : language;
  const meaningLevel = meanings.stored.level ? meanings.level : defaultLevelFor(meaningLanguage);

  const languageItems: { value: MeaningLanguage; label: string }[] = [
    { value: "ar", label: s.meaningsLanguageArabic },
    { value: "en", label: s.meaningsLanguageEnglish },
  ];
  const canCheck = hasCheckItems(CHECK_BANK, meaningLanguage);
  const setLevel = (level: number) => save(() => writeMeaningsLevel(db, level));

  const switchItems: { value: DeckSwitch; label: string }[] = [
    { value: "auto", label: s.studyDecksAuto },
    { value: "on", label: s.studyDecksOn },
    { value: "off", label: s.studyDecksOff },
  ];
  const deckRow = (deck: SwitchableDeck, title: string) => (
    <View style={{ gap: 8 }}>
      <Text
        dir={dir}
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
        className="text-charcoal dark:text-neutral-200"
      >
        {title}
      </Text>
      <ToggleGroup<DeckSwitch>
        dir={dir}
        value={settings[deck]}
        onValueChange={(value) => save(() => writeDeckSwitch(db, deck, value))}
        items={switchItems}
        accessibilityLabel={title}
      />
    </View>
  );

  return (
    <Card elevation="low" className="p-5 mb-8">
      <View style={{ gap: 20 }}>
        <MirroredRow dir={dir} className="items-center justify-between gap-3">
          <View className="flex-1" style={{ gap: 4 }}>
            <Text
              dir={dir}
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
              className="text-charcoal dark:text-neutral-200"
            >
              {s.studyDecksMeanings}
            </Text>
            <Text dir={dir} variant="caption" style={{ lineHeight: 18 }}>
              {s.studyDecksMeaningsHint}
            </Text>
          </View>
          <Switch
            accessibilityLabel={s.studyDecksMeanings}
            value={settings.meanings}
            onValueChange={(value) => save(() => writeMeaningsInDailyStudy(db, value))}
          />
        </MirroredRow>

        <View style={{ gap: 8 }}>
          <Text
            dir={dir}
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
            className="text-charcoal dark:text-neutral-200"
          >
            {s.meaningsLanguageTitle}
          </Text>
          <ToggleGroup<MeaningLanguage>
            dir={dir}
            value={meaningLanguage}
            onValueChange={(value) => {
              setChecking(false);
              save(() => writeMeaningLanguage(db, value));
            }}
            items={languageItems}
            accessibilityLabel={s.meaningsLanguageTitle}
          />
        </View>

        <View style={{ gap: 8 }}>
          <Text
            dir={dir}
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
            className="text-charcoal dark:text-neutral-200"
          >
            {s.meaningsLevelSetting}
          </Text>
          <Text
            ref={levelTextRef}
            dir={dir}
            variant="caption"
            style={{ lineHeight: 18 }}
            accessibilityLiveRegion="polite"
            {...(Platform.OS === "web" ? { tabIndex: -1 as const } : {})}
          >
            {meaningsLevelText(meaningLevel, s, language)}
          </Text>
          {checking ? (
            <View style={{ gap: 10 }}>
              <MeaningsLevelCheck
                db={db}
                language={meaningLanguage}
                centre={meaningLevel}
                seed={101 + checkAttempt * 7919}
                uiLanguage={language}
                fontSize={fontSize}
                lineHeight={lineHeight}
                s={s}
                focusOnStart
                onDone={(level) => {
                  endCheck();
                  setLevel(level);
                }}
              />
              <Button variant="ghost" className="h-11" label={s.hifzNotNow} onPress={endCheck} />
            </View>
          ) : (
            <MirroredRow dir={dir} className="flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                dir={dir}
                className="h-11 border border-warm-300 dark:border-neutral-700"
                label={s.meaningsLevelLower}
                disabled={meaningLevel <= 0}
                onPress={() => setLevel(meaningLevel - 1)}
              />
              <Button
                variant="outline"
                size="sm"
                dir={dir}
                className="h-11 border border-warm-300 dark:border-neutral-700"
                label={s.meaningsLevelHigher}
                disabled={meaningLevel >= MAX_LEVEL}
                onPress={() => setLevel(meaningLevel + 1)}
              />
              {canCheck ? (
                <Button
                  variant="outline"
                  size="sm"
                  dir={dir}
                  className="h-11 border border-warm-300 dark:border-neutral-700"
                  label={s.meaningsCheckMyLevel}
                  onPress={() => {
                    setCheckAttempt((attempt) => attempt + 1);
                    setChecking(true);
                  }}
                />
              ) : null}
            </MirroredRow>
          )}
        </View>

        {deckRow("qiraat", s.smartDeckQiraatTitle)}
        {deckRow("reasons", s.smartDeckReasonsTitle)}
        <Text dir={dir} variant="caption" style={{ lineHeight: 18 }}>
          {s.studyDecksSwitchHint}
        </Text>

        {failed ? (
          <Text dir={dir} variant="caption" accessibilityLiveRegion="polite" className="text-red-600 dark:text-red-400">
            {s.habitBreakFailed}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
