import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Switch } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import type { AppDatabase } from "@/lib/database/types";
import { emitHabitChanged, subscribeHabitChanged } from "@/lib/habit/use-habit-overview";
import type { UIStrings } from "@/lib/i18n/strings";
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
 * Settings > General > Daily study (SPEC 3.6, 3.7): whether word meanings join daily study, and
 * Qira'at and Reasons of revelation as Automatic, On or Off. Automatic is on once the whole Quran is
 * memorized. The settings sync with the account.
 */
export function StudyDecksSettings({ db, language, s }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const [settings, setSettings] = useState<StudyDeckSettings | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await readStudyDeckSettings(db));
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

  if (!settings) return null;

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
