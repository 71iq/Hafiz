import { useRef } from "react";
import { Platform, View, type Text as RNText } from "react-native";
import { MeaningsLevelCheck, meaningsLevelText } from "@/components/hifz/MeaningsLevelCheck";
import { SetupOptionCard } from "@/components/hifz/SetupOptionCard";
import { ChoiceChip } from "@/components/notifications/SittingChips";
import { Button } from "@/components/ui/Button";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { SwitchRow, SwitchTrack } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";
import type { DatabaseExecutor } from "@/lib/database/types";
import type { UIStrings } from "@/lib/i18n/strings";
import { CHECK_BANK, type CheckItem } from "@/lib/meanings/check-bank";
import type { MeaningLanguage } from "@/lib/meanings/lemma-index";
import { hasCheckItems, languageForRating, levelForRating, type SelfRating } from "@/lib/meanings/level-check";
import { readMeaningsSettings, type MeaningsSetup } from "@/lib/meanings/settings";
import { readStudyDeckSettings } from "@/lib/study/daily-decks";

type Answer = SelfRating["arabic"];
const ANSWERS: readonly Answer[] = [0, 1, 2, 3];

export type LevelMode = "keep" | "check" | "choose";

/** What the "Word meanings" step holds while setup is open (SPEC 3.6). */
export type MeaningsDraft = Readonly<{
  on: boolean;
  arabic: Answer | null;
  recited: Answer | null;
  /** The language the user picked, or null to follow the stored one or the Arabic answer. */
  language: MeaningLanguage | null;
  /** How the level is settled; null until chosen. A stored level, which is always a choice, starts on keep. */
  levelMode: LevelMode | null;
  /** The finished check's level. */
  checked: number | null;
  /** Counts retakes, so "Check again" draws other items. */
  attempt: number;
}>;

/** The stored settings the step opens with; a null value was never stored. */
export type StoredMeanings = Readonly<{ on: boolean; language: MeaningLanguage | null; level: number | null }>;

export async function loadStoredMeanings(db: DatabaseExecutor): Promise<StoredMeanings> {
  const [decks, meanings] = await Promise.all([readStudyDeckSettings(db), readMeaningsSettings(db)]);
  return {
    on: decks.meanings,
    language: meanings.stored.language ? meanings.language : null,
    level: meanings.stored.level ? meanings.level : null,
  };
}

export function initialMeaningsDraft(stored: StoredMeanings | null): MeaningsDraft {
  return {
    on: stored?.on ?? true,
    arabic: null,
    recited: null,
    language: null,
    levelMode: stored?.level !== null && stored?.level !== undefined ? "keep" : null,
    checked: null,
    attempt: 0,
  };
}

export function draftRating(draft: MeaningsDraft): SelfRating | null {
  return draft.arabic === null || draft.recited === null ? null : { arabic: draft.arabic, recited: draft.recited };
}

/** The meaning language: the user's pick, else the stored one, else the Arabic answer's, else the interface's. */
export function draftLanguage(
  draft: MeaningsDraft,
  stored: StoredMeanings | null,
  uiLanguage: "en" | "ar",
): MeaningLanguage {
  return (
    draft.language ??
    stored?.language ??
    (draft.arabic !== null ? languageForRating({ arabic: draft.arabic }) : null) ??
    uiLanguage
  );
}

/** Where the check starts: the self-rating's level, or the stored level. */
function checkCentre(draft: MeaningsDraft, stored: StoredMeanings | null): number | null {
  const rating = draftRating(draft);
  return rating ? levelForRating(rating) : (stored?.level ?? null);
}

/**
 * The level the step saves, or null to leave the stored level (or the language's default) alone.
 * Keep saves nothing. An unfinished check, and answers given without a choice, fall back to the
 * self-rating, as "Choose for me" would.
 */
export function draftLevel(draft: MeaningsDraft): number | null {
  if (draft.levelMode === "keep") return null;
  if (draft.levelMode === "check" && draft.checked !== null) return draft.checked;
  const rating = draftRating(draft);
  return rating ? levelForRating(rating) : null;
}

export function meaningsSetupOf(
  draft: MeaningsDraft,
  stored: StoredMeanings | null,
  uiLanguage: "en" | "ar",
): MeaningsSetup {
  return {
    inDailyStudy: draft.on,
    language: draftLanguage(draft, stored, uiLanguage),
    languagePicked: draft.language !== null,
    level: draftLevel(draft),
  };
}

function Question({
  title,
  labels,
  value,
  onChange,
  dir,
}: {
  title: string;
  labels: readonly [string, string, string, string];
  value: Answer | null;
  onChange: (value: Answer) => void;
  dir: "ltr" | "rtl";
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text dir={dir} variant="title-sm">
        {title}
      </Text>
      <MirroredRow dir={dir} accessibilityRole="radiogroup" accessibilityLabel={title} className="flex-wrap gap-2">
        {ANSWERS.map((answer) => (
          <ChoiceChip
            key={answer}
            label={labels[answer]}
            selected={value === answer}
            onPress={() => onChange(answer)}
          />
        ))}
      </MirroredRow>
    </View>
  );
}

/**
 * Setup's "Word meanings" step (SPEC 3.6): whether meanings join daily study, two self-rating
 * questions, the meaning language, and the starting level, by "Check my level" or "Choose for me".
 * Neither is preselected. A stored level, which only a choice in setup, Settings or a level offer
 * writes (defaults are derived, never stored), also offers Keep, chosen at first.
 */
export function MeaningsSetupStep({
  db,
  draft,
  stored,
  onChange,
  language,
  fontSize,
  lineHeight,
  s,
  onReveal,
  bank = CHECK_BANK,
}: {
  db: DatabaseExecutor;
  draft: MeaningsDraft;
  stored: StoredMeanings | null;
  onChange: (update: (draft: MeaningsDraft) => MeaningsDraft) => void;
  language: "en" | "ar";
  fontSize: number;
  lineHeight: number;
  s: UIStrings;
  /**
   * Called with what the level choice just showed (the check, its result, or the note to answer
   * first), each time it lays out, so a scrolling parent can bring it into view: it opens below the
   * fold on a phone.
   */
  onReveal?: (target: View | null) => void;
  bank?: readonly CheckItem[];
}) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const revealRef = useRef<View>(null);
  const reveal = () => onReveal?.(revealRef.current);
  // A finished check removes the answer that had focus; on web the result takes it.
  const focusResult = useRef(false);
  const focusIfFinished = (node: RNText | null) => {
    if (!node || !focusResult.current || Platform.OS !== "web") return;
    focusResult.current = false;
    (node as unknown as HTMLElement).focus?.();
  };
  const meaningLanguage = draftLanguage(draft, stored, language);
  const canCheck = hasCheckItems(bank, meaningLanguage);
  const rating = draftRating(draft);
  const centre = checkCentre(draft, stored);
  const set = (patch: Partial<MeaningsDraft>) => onChange((value) => ({ ...value, ...patch }));
  const levelResult = (level: number) => (
    <View style={{ gap: 4 }} accessibilityLiveRegion="polite">
      <Text
        ref={focusIfFinished}
        dir={dir}
        variant="body-sm"
        style={{ fontFamily: "Manrope_700Bold" }}
        className="text-charcoal dark:text-neutral-100"
        {...(Platform.OS === "web" ? { tabIndex: -1 as const } : {})}
      >
        {meaningsLevelText(level, s, language)}
      </Text>
      <Text dir={dir} variant="caption" style={{ lineHeight: 18 }}>
        {level === 0 ? s.meaningsLevelAdjustsStart : s.meaningsLevelAdjusts}
      </Text>
    </View>
  );

  return (
    <View style={{ gap: 20 }}>
      <SwitchRow
        label={s.studyDecksMeaningsHint}
        value={draft.on}
        onValueChange={(on) => set({ on })}
        className="rounded-3xl bg-surface-low dark:bg-surface-dark-low px-4 py-3"
      >
        <MirroredRow dir={dir} className="items-center justify-between gap-3">
          <Text
            dir={dir}
            style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }}
            className="flex-1 text-charcoal dark:text-neutral-100"
          >
            {s.studyDecksMeaningsHint}
          </Text>
          <SwitchTrack value={draft.on} />
        </MirroredRow>
      </SwitchRow>

      {draft.on ? (
        <>
          <Question
            title={s.meaningsRateArabic}
            labels={[s.meaningsRateArabic0, s.meaningsRateArabic1, s.meaningsRateArabic2, s.meaningsRateArabic3]}
            value={draft.arabic}
            onChange={(arabic) => set({ arabic })}
            dir={dir}
          />
          <Question
            title={s.meaningsRateRecited}
            labels={[s.meaningsRateRecited0, s.meaningsRateRecited1, s.meaningsRateRecited2, s.meaningsRateRecited3]}
            value={draft.recited}
            onChange={(recited) => set({ recited })}
            dir={dir}
          />

          <View style={{ gap: 8 }}>
            <Text dir={dir} variant="title-sm">
              {s.meaningsLanguageTitle}
            </Text>
            <MirroredRow
              dir={dir}
              accessibilityRole="radiogroup"
              accessibilityLabel={s.meaningsLanguageTitle}
              className="flex-wrap gap-2"
            >
              <ChoiceChip
                label={s.meaningsLanguageArabic}
                selected={meaningLanguage === "ar"}
                onPress={() => set({ language: "ar" })}
              />
              <ChoiceChip
                label={s.meaningsLanguageEnglish}
                selected={meaningLanguage === "en"}
                onPress={() => set({ language: "en" })}
              />
            </MirroredRow>
          </View>

          <View style={{ gap: 10 }}>
            <Text dir={dir} variant="title-sm">
              {s.meaningsLevelTitle}
            </Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={s.meaningsLevelTitle} style={{ gap: 10 }}>
              {stored?.level !== null && stored?.level !== undefined ? (
                <SetupOptionCard
                  title={s.meaningsKeepLevel}
                  hint={meaningsLevelText(stored.level, s, language)}
                  selected={draft.levelMode === "keep"}
                  onPress={() => set({ levelMode: "keep" })}
                />
              ) : null}
              {canCheck ? (
                <SetupOptionCard
                  title={s.meaningsCheckMyLevel}
                  hint={s.meaningsCheckMyLevelHint}
                  selected={draft.levelMode === "check"}
                  onPress={() => set({ levelMode: "check" })}
                />
              ) : null}
              <SetupOptionCard
                title={s.meaningsChooseForMe}
                hint={s.meaningsChooseForMeHint}
                selected={draft.levelMode === "choose"}
                onPress={() => set({ levelMode: "choose" })}
              />
            </View>

            {draft.levelMode === "choose" ? (
              <View ref={revealRef} onLayout={reveal}>
                {rating ? (
                  levelResult(levelForRating(rating))
                ) : (
                  <Text dir={dir} variant="caption" accessibilityLiveRegion="polite">
                    {s.meaningsRateFirst}
                  </Text>
                )}
              </View>
            ) : null}

            {draft.levelMode === "check" && canCheck ? (
              <View ref={revealRef} onLayout={reveal}>
                {draft.checked !== null ? (
                  <View style={{ gap: 10 }}>
                    {levelResult(draft.checked)}
                    <Button
                      variant="outline"
                      className="border border-warm-300 dark:border-neutral-700"
                      label={s.meaningsCheckAgain}
                      onPress={() => set({ checked: null, attempt: draft.attempt + 1 })}
                    />
                  </View>
                ) : centre === null ? (
                  <Text dir={dir} variant="caption" accessibilityLiveRegion="polite">
                    {s.meaningsRateFirst}
                  </Text>
                ) : (
                  <MeaningsLevelCheck
                    db={db}
                    language={meaningLanguage}
                    centre={centre}
                    seed={1 + draft.attempt * 7919}
                    uiLanguage={language}
                    fontSize={fontSize}
                    lineHeight={lineHeight}
                    s={s}
                    bank={bank}
                    focusOnStart={draft.attempt > 0}
                    onDone={(checked) => {
                      focusResult.current = true;
                      set({ checked });
                    }}
                  />
                )}
              </View>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}
