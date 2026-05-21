import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Switch } from "@/components/ui/Switch";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { toArabicNumber } from "@/lib/arabic";
import {
  readDeckReviewSettings,
  writeDeckReviewSettings,
} from "@/lib/fsrs/queries";
import {
  ALL_NEW_CARD_SORT_ORDERS,
  ALL_NEW_REVIEW_ORDERS,
  ALL_REVIEW_SORT_ORDERS,
  ALL_TEST_MODES,
  ALL_WORD_TEST_MODES,
  DECK_DAILY_REVIEW_LIMIT_STEP,
  DECK_MAXIMUM_INTERVAL_STEP,
  DECK_NEW_CARD_LIMIT_STEP,
  DECK_REQUEST_RETENTION_STEP,
  DEFAULT_DECK_ENABLE_FUZZ,
  DEFAULT_DECK_ENABLE_SHORT_TERM,
  DEFAULT_DECK_DAILY_REVIEW_LIMIT,
  DEFAULT_ENABLED_MODES,
  DEFAULT_DECK_LEARNING_STEPS,
  DEFAULT_DECK_MAXIMUM_INTERVAL,
  DEFAULT_DECK_NEW_CARD_LIMIT,
  DEFAULT_DECK_RELEARNING_STEPS,
  DEFAULT_DECK_REQUEST_RETENTION,
  DEFAULT_WORD_TEST_MODES,
  DEFAULT_NEW_CARD_SORT_ORDER,
  DEFAULT_NEW_REVIEW_ORDER,
  DEFAULT_REVIEW_SORT_ORDER,
  MAX_DECK_MAXIMUM_INTERVAL,
  MAX_DECK_DAILY_REVIEW_LIMIT,
  MAX_DECK_NEW_CARD_LIMIT,
  MAX_DECK_REQUEST_RETENTION,
  MIN_DECK_MAXIMUM_INTERVAL,
  MIN_DECK_DAILY_REVIEW_LIMIT,
  MIN_DECK_NEW_CARD_LIMIT,
  MIN_DECK_REQUEST_RETENTION,
  type NewCardSortOrder,
  type NewReviewOrder,
  type ReviewSortOrder,
  type SchedulerStep,
  type TestMode,
  type WordTestMode,
} from "@/lib/fsrs/types";
import { useSettings } from "@/lib/settings/context";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";

type ReviewSettingsMode = "ayah" | "word";

type Props = {
  visible: boolean;
  deckId: string | null;
  deckTitle: string;
  mode: ReviewSettingsMode;
  onClose: () => void;
  onSaved: () => void;
};

export function DeckReviewSettingsSheet({ visible, deckId, deckTitle, mode, onClose, onSaved }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const { width } = useWindowDimensions();
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const compact = width >= SIDEBAR_BREAKPOINT;
  const surfaceColor = isDark ? "#1C1917" : "#FFF8F1";
  const [dailyLimit, setDailyLimit] = useState(DEFAULT_DECK_DAILY_REVIEW_LIMIT);
  const [newCardsLimit, setNewCardsLimit] = useState(DEFAULT_DECK_NEW_CARD_LIMIT);
  const [requestRetention, setRequestRetention] = useState(DEFAULT_DECK_REQUEST_RETENTION);
  const [maximumInterval, setMaximumInterval] = useState(DEFAULT_DECK_MAXIMUM_INTERVAL);
  const [enableFuzz, setEnableFuzz] = useState(DEFAULT_DECK_ENABLE_FUZZ);
  const [enableShortTerm, setEnableShortTerm] = useState(DEFAULT_DECK_ENABLE_SHORT_TERM);
  const [learningStepsText, setLearningStepsText] = useState(formatStepText(DEFAULT_DECK_LEARNING_STEPS));
  const [relearningStepsText, setRelearningStepsText] = useState(formatStepText(DEFAULT_DECK_RELEARNING_STEPS));
  const [newReviewOrder, setNewReviewOrder] = useState<NewReviewOrder>(DEFAULT_NEW_REVIEW_ORDER);
  const [reviewSortOrder, setReviewSortOrder] = useState<ReviewSortOrder>(DEFAULT_REVIEW_SORT_ORDER);
  const [newCardSortOrder, setNewCardSortOrder] = useState<NewCardSortOrder>(DEFAULT_NEW_CARD_SORT_ORDER);
  const [testModes, setTestModes] = useState<TestMode[]>(DEFAULT_ENABLED_MODES);
  const [wordTestModes, setWordTestModes] = useState<WordTestMode[]>(DEFAULT_WORD_TEST_MODES);
  const [saving, setSaving] = useState(false);

  const testModeLabels: Record<TestMode, string> = {
    nextAyah: s.flashcardsModeNextAyah,
    previousAyah: s.flashcardsModePreviousAyah,
    translation: s.flashcardsModeTranslation,
    tafseer: s.flashcardsModeTafseer,
    surahName: s.flashcardsModeSurahName,
  };
  const wordModeLabels: Record<WordTestMode, string> = {
    wordMeaningArabic: s.flashcardsModeWordMeaningArabic,
    wordMeaningTranslation: s.flashcardsModeWordMeaningTranslation,
  };

  useEffect(() => {
    if (!visible || !deckId) return;
    let cancelled = false;
    readDeckReviewSettings(db, deckId).then((settings) => {
      if (cancelled) return;
      setDailyLimit(settings.dailyReviewLimit);
      setNewCardsLimit(settings.newCardsLimit);
      setRequestRetention(settings.requestRetention);
      setMaximumInterval(settings.maximumInterval);
      setEnableFuzz(settings.enableFuzz);
      setEnableShortTerm(settings.enableShortTerm);
      setLearningStepsText(formatStepText(settings.learningSteps));
      setRelearningStepsText(formatStepText(settings.relearningSteps));
      setNewReviewOrder(settings.newReviewOrder);
      setReviewSortOrder(settings.reviewSortOrder);
      setNewCardSortOrder(settings.newCardSortOrder);
      setTestModes(settings.testModes);
      setWordTestModes(settings.wordTestModes);
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [db, deckId, visible]);

  const setNextDailyLimit = useCallback((value: number) => {
    setDailyLimit(Math.max(MIN_DECK_DAILY_REVIEW_LIMIT, Math.min(MAX_DECK_DAILY_REVIEW_LIMIT, value)));
  }, []);

  const setNextNewCardsLimit = useCallback((value: number) => {
    setNewCardsLimit(Math.max(MIN_DECK_NEW_CARD_LIMIT, Math.min(MAX_DECK_NEW_CARD_LIMIT, value)));
  }, []);

  const setNextRetention = useCallback((value: number) => {
    const clamped = Math.max(MIN_DECK_REQUEST_RETENTION, Math.min(MAX_DECK_REQUEST_RETENTION, value));
    setRequestRetention(Number(clamped.toFixed(2)));
  }, []);

  const setNextMaximumInterval = useCallback((value: number) => {
    setMaximumInterval(Math.max(MIN_DECK_MAXIMUM_INTERVAL, Math.min(MAX_DECK_MAXIMUM_INTERVAL, value)));
  }, []);

  const toggleTestMode = useCallback((value: TestMode) => {
    setTestModes((prev) => {
      const next = prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value];
      return next.length > 0 ? next : prev;
    });
  }, []);

  const toggleWordMode = useCallback((value: WordTestMode) => {
    setWordTestModes((prev) => {
      const next = prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value];
      return next.length > 0 ? next : prev;
    });
  }, []);

  const handleSave = async () => {
    if (!deckId || saving) return;
    setSaving(true);
    try {
      await writeDeckReviewSettings(db, deckId, {
        dailyReviewLimit: dailyLimit,
        newCardsLimit,
        requestRetention,
        maximumInterval,
        enableFuzz,
        enableShortTerm,
        learningSteps: parseStepText(learningStepsText, DEFAULT_DECK_LEARNING_STEPS),
        relearningSteps: parseStepText(relearningStepsText, DEFAULT_DECK_RELEARNING_STEPS),
        newReviewOrder,
        reviewSortOrder,
        newCardSortOrder,
        testModes,
        wordTestModes,
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const reviewModeSection = (
    <SettingsSection
      title={mode === "word" ? s.wordFlashcardsTestModes : s.flashcardsTestModes}
      isRTL={isRTL}
      variant={mode === "word" ? "quiet" : "default"}
    >
      <View
        className="gap-3"
        style={{
          flexDirection: compact ? (isRTL ? "row-reverse" : "row") : "column",
          flexWrap: compact ? "wrap" : "nowrap",
        }}
      >
        {mode === "word" ? (
          ALL_WORD_TEST_MODES.map((item) => (
            <ReviewSwitchRow
              key={item}
              label={wordModeLabels[item]}
              value={wordTestModes.includes(item)}
              onValueChange={() => toggleWordMode(item)}
              compact={compact}
              isDark={isDark}
              isRTL={isRTL}
              quiet
            />
          ))
        ) : (
          ALL_TEST_MODES.map((item) => (
            <ReviewSwitchRow
              key={item}
              label={testModeLabels[item]}
              value={testModes.includes(item)}
              onValueChange={() => toggleTestMode(item)}
              compact={compact}
              isDark={isDark}
              isRTL={isRTL}
              quiet={false}
            />
          ))
        )}
      </View>
    </SettingsSection>
  );

  return (
    <ResponsiveSheet
      open={visible}
      onClose={onClose}
      maxWidth={680}
      maxHeight="92%"
      surfaceColor={surfaceColor}
    >
      <OverlayHeader
        title={s.deckReviewSettingsTitle}
        onClose={onClose}
        isRTL={isRTL}
        showHandle={isPhone}
      />

      <OverlayBody contentContainerClassName="px-5 pb-8">
        <Text
          className="mb-4 text-charcoal dark:text-neutral-100"
          style={{
            fontFamily: "Manrope_700Bold",
            fontSize: 17,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
          numberOfLines={2}
        >
          {deckTitle}
        </Text>

        <SchedulerOptionsPanel
          dailyLimit={dailyLimit}
          newCardsLimit={newCardsLimit}
          requestRetention={requestRetention}
          maximumInterval={maximumInterval}
          enableFuzz={enableFuzz}
          enableShortTerm={enableShortTerm}
          learningStepsText={learningStepsText}
          relearningStepsText={relearningStepsText}
          newReviewOrder={newReviewOrder}
          reviewSortOrder={reviewSortOrder}
          newCardSortOrder={newCardSortOrder}
          onDailyLimitChange={setNextDailyLimit}
          onNewCardsLimitChange={setNextNewCardsLimit}
          onRequestRetentionChange={setNextRetention}
          onMaximumIntervalChange={setNextMaximumInterval}
          onEnableFuzzChange={setEnableFuzz}
          onEnableShortTermChange={setEnableShortTerm}
          onLearningStepsTextChange={setLearningStepsText}
          onRelearningStepsTextChange={setRelearningStepsText}
          onNewReviewOrderChange={setNewReviewOrder}
          onReviewSortOrderChange={setReviewSortOrder}
          onNewCardSortOrderChange={setNewCardSortOrder}
          afterDailyLimits={mode === "word" ? reviewModeSection : null}
          compact={compact}
          isDark={isDark}
          isRTL={isRTL}
        />

        {mode !== "word" ? reviewModeSection : null}
      </OverlayBody>

      <OverlayFooter isRTL={isRTL}>
        <Button onPress={handleSave} disabled={saving || !deckId} className="w-full">
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>
              {s.deckReviewSettingsSave}
            </Text>
          )}
        </Button>
      </OverlayFooter>
    </ResponsiveSheet>
  );
}

const STEP_TEXT_RE = /^\d+(?:\.\d+)?[mhd]$/;

function isSchedulerStepText(value: string): value is SchedulerStep {
  return STEP_TEXT_RE.test(value);
}

export function formatStepText(steps: readonly SchedulerStep[]): string {
  return steps.join(", ");
}

export function parseStepText(value: string, fallback: readonly SchedulerStep[]): SchedulerStep[] {
  if (value.trim().length === 0) return [];
  const steps = value
    .split(/[,\s]+/)
    .map((step) => step.trim())
    .filter(isSchedulerStepText);
  return steps.length > 0 ? steps : [...fallback];
}

type SchedulerOptionsPanelProps = {
  dailyLimit: number;
  newCardsLimit: number;
  requestRetention: number;
  maximumInterval: number;
  enableFuzz: boolean;
  enableShortTerm: boolean;
  learningStepsText: string;
  relearningStepsText: string;
  newReviewOrder: NewReviewOrder;
  reviewSortOrder: ReviewSortOrder;
  newCardSortOrder: NewCardSortOrder;
  onDailyLimitChange: (value: number) => void;
  onNewCardsLimitChange: (value: number) => void;
  onRequestRetentionChange: (value: number) => void;
  onMaximumIntervalChange: (value: number) => void;
  onEnableFuzzChange: (value: boolean) => void;
  onEnableShortTermChange: (value: boolean) => void;
  onLearningStepsTextChange: (value: string) => void;
  onRelearningStepsTextChange: (value: string) => void;
  onNewReviewOrderChange: (value: NewReviewOrder) => void;
  onReviewSortOrderChange: (value: ReviewSortOrder) => void;
  onNewCardSortOrderChange: (value: NewCardSortOrder) => void;
  afterDailyLimits?: ReactNode;
  compact: boolean;
  isDark: boolean;
  isRTL: boolean;
};

export function SchedulerOptionsPanel({
  dailyLimit,
  newCardsLimit,
  requestRetention,
  maximumInterval,
  enableFuzz,
  enableShortTerm,
  learningStepsText,
  relearningStepsText,
  newReviewOrder,
  reviewSortOrder,
  newCardSortOrder,
  onDailyLimitChange,
  onNewCardsLimitChange,
  onRequestRetentionChange,
  onMaximumIntervalChange,
  onEnableFuzzChange,
  onEnableShortTermChange,
  onLearningStepsTextChange,
  onRelearningStepsTextChange,
  onNewReviewOrderChange,
  onReviewSortOrderChange,
  onNewCardSortOrderChange,
  afterDailyLimits,
  compact,
  isDark,
  isRTL,
}: SchedulerOptionsPanelProps) {
  const s = useStrings();
  const newReviewOrderLabels: Record<NewReviewOrder, string> = {
    reviewsFirst: s.flashcardsOrderReviewsFirst,
    newFirst: s.flashcardsOrderNewFirst,
    mixed: s.flashcardsOrderMixed,
  };
  const reviewSortOrderLabels: Record<ReviewSortOrder, string> = {
    due: s.flashcardsReviewSortDue,
    oldest: s.flashcardsReviewSortOldest,
    newest: s.flashcardsReviewSortNewest,
    random: s.flashcardsSortRandom,
  };
  const newCardSortOrderLabels: Record<NewCardSortOrder, string> = {
    created: s.flashcardsNewSortCreated,
    random: s.flashcardsSortRandom,
  };
  const limitValue = isRTL ? toArabicNumber(dailyLimit) : String(dailyLimit);
  const newLimitValue = isRTL ? toArabicNumber(newCardsLimit) : String(newCardsLimit);
  const retentionValue = `${isRTL ? toArabicNumber(Math.round(requestRetention * 100)) : String(Math.round(requestRetention * 100))}%`;
  const maxIntervalValue = `${isRTL ? toArabicNumber(maximumInterval) : String(maximumInterval)} ${s.leaderboardDays}`;

  return (
    <>
      <SettingsSection title={s.flashcardsDailyLimits} isRTL={isRTL}>
        <SettingsRow
          title={s.flashcardsDailyLimit}
          subtitle={s.flashcardsDailyLimitDesc}
          compact={compact}
          isRTL={isRTL}
        >
          <ReviewStepper
            value={limitValue}
            onDecrement={() => onDailyLimitChange(dailyLimit - DECK_DAILY_REVIEW_LIMIT_STEP)}
            onIncrement={() => onDailyLimitChange(dailyLimit + DECK_DAILY_REVIEW_LIMIT_STEP)}
            decrementDisabled={dailyLimit <= MIN_DECK_DAILY_REVIEW_LIMIT}
            incrementDisabled={dailyLimit >= MAX_DECK_DAILY_REVIEW_LIMIT}
            isDark={isDark}
            isRTL={isRTL}
          />
        </SettingsRow>
        <SettingsRow
          title={s.flashcardsNewLimit}
          subtitle={s.flashcardsNewLimitDesc}
          compact={compact}
          isRTL={isRTL}
        >
          <ReviewStepper
            value={newLimitValue}
            onDecrement={() => onNewCardsLimitChange(newCardsLimit - DECK_NEW_CARD_LIMIT_STEP)}
            onIncrement={() => onNewCardsLimitChange(newCardsLimit + DECK_NEW_CARD_LIMIT_STEP)}
            decrementDisabled={newCardsLimit <= MIN_DECK_NEW_CARD_LIMIT}
            incrementDisabled={newCardsLimit >= MAX_DECK_NEW_CARD_LIMIT}
            isDark={isDark}
            isRTL={isRTL}
          />
        </SettingsRow>
      </SettingsSection>

      {afterDailyLimits}

      <SettingsSection title={s.flashcardsFsrsSection} isRTL={isRTL}>
        <SettingsRow
          title={s.flashcardsDesiredRetention}
          subtitle={s.flashcardsDesiredRetentionDesc}
          compact={compact}
          isRTL={isRTL}
        >
          <ReviewStepper
            value={retentionValue}
            onDecrement={() => onRequestRetentionChange(requestRetention - DECK_REQUEST_RETENTION_STEP)}
            onIncrement={() => onRequestRetentionChange(requestRetention + DECK_REQUEST_RETENTION_STEP)}
            decrementDisabled={requestRetention <= MIN_DECK_REQUEST_RETENTION}
            incrementDisabled={requestRetention >= MAX_DECK_REQUEST_RETENTION}
            isDark={isDark}
            isRTL={isRTL}
          />
        </SettingsRow>
        <SettingsRow
          title={s.flashcardsMaximumInterval}
          subtitle={s.flashcardsMaximumIntervalDesc}
          compact={compact}
          isRTL={isRTL}
        >
          <ReviewStepper
            value={maxIntervalValue}
            onDecrement={() => onMaximumIntervalChange(maximumInterval - DECK_MAXIMUM_INTERVAL_STEP)}
            onIncrement={() => onMaximumIntervalChange(maximumInterval + DECK_MAXIMUM_INTERVAL_STEP)}
            decrementDisabled={maximumInterval <= MIN_DECK_MAXIMUM_INTERVAL}
            incrementDisabled={maximumInterval >= MAX_DECK_MAXIMUM_INTERVAL}
            isDark={isDark}
            isRTL={isRTL}
          />
        </SettingsRow>
        <SwitchSettingsRow
          title={s.flashcardsEnableFuzz}
          subtitle={s.flashcardsEnableFuzzDesc}
          value={enableFuzz}
          onValueChange={() => onEnableFuzzChange(!enableFuzz)}
          compact={compact}
          isRTL={isRTL}
        />
        <SwitchSettingsRow
          title={s.flashcardsEnableShortTerm}
          subtitle={s.flashcardsEnableShortTermDesc}
          value={enableShortTerm}
          onValueChange={() => onEnableShortTermChange(!enableShortTerm)}
          compact={compact}
          isRTL={isRTL}
        />
      </SettingsSection>

      <SettingsSection title={s.flashcardsLearningSection} isRTL={isRTL}>
        <StepInputRow
          title={s.flashcardsLearningSteps}
          subtitle={s.flashcardsLearningStepsDesc}
          value={learningStepsText}
          onChangeText={onLearningStepsTextChange}
          placeholder={formatStepText(DEFAULT_DECK_LEARNING_STEPS)}
          compact={compact}
          isDark={isDark}
          isRTL={isRTL}
        />
        <StepInputRow
          title={s.flashcardsRelearningSteps}
          subtitle={s.flashcardsRelearningStepsDesc}
          value={relearningStepsText}
          onChangeText={onRelearningStepsTextChange}
          placeholder={formatStepText(DEFAULT_DECK_RELEARNING_STEPS)}
          compact={compact}
          isDark={isDark}
          isRTL={isRTL}
        />
      </SettingsSection>

      <SettingsSection title={s.flashcardsDisplayOrderSection} isRTL={isRTL} variant="quiet">
        <ChoiceRow
          title={s.flashcardsNewReviewOrder}
          options={ALL_NEW_REVIEW_ORDERS.map((value) => ({ value, label: newReviewOrderLabels[value] }))}
          value={newReviewOrder}
          onChange={onNewReviewOrderChange}
          isDark={isDark}
          isRTL={isRTL}
        />
        <ChoiceRow
          title={s.flashcardsReviewSortOrder}
          options={ALL_REVIEW_SORT_ORDERS.map((value) => ({ value, label: reviewSortOrderLabels[value] }))}
          value={reviewSortOrder}
          onChange={onReviewSortOrderChange}
          isDark={isDark}
          isRTL={isRTL}
        />
        <ChoiceRow
          title={s.flashcardsNewCardSortOrder}
          options={ALL_NEW_CARD_SORT_ORDERS.map((value) => ({ value, label: newCardSortOrderLabels[value] }))}
          value={newCardSortOrder}
          onChange={onNewCardSortOrderChange}
          isDark={isDark}
          isRTL={isRTL}
        />
      </SettingsSection>
    </>
  );
}

function SettingsSection({
  title,
  children,
  isRTL,
  variant = "default",
}: {
  title: string;
  children: ReactNode;
  isRTL: boolean;
  variant?: "default" | "quiet";
}) {
  const quiet = variant === "quiet";
  return (
    <View className="mb-5">
      <Text
        className="mb-3 text-warm-400 dark:text-neutral-500"
        style={{
          fontFamily: "Manrope_600SemiBold",
          fontSize: 11,
          letterSpacing: 1.2,
          textAlign: isRTL ? "right" : "left",
          textTransform: "uppercase",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {title}
      </Text>
      <Card
        elevation={quiet ? "bright" : "low"}
        className={quiet ? "rounded-3xl border border-warm-200 p-4 dark:border-neutral-800" : "p-5"}
      >
        <View className={quiet ? "gap-2" : "gap-1"}>{children}</View>
      </Card>
    </View>
  );
}

function SettingsRow({
  title,
  subtitle,
  children,
  compact,
  isRTL,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  compact: boolean;
  isRTL: boolean;
}) {
  return (
    <View
      className="gap-3 py-2"
      style={{
        alignItems: compact ? "center" : "stretch",
        flexDirection: compact ? (isRTL ? "row-reverse" : "row") : "column",
        justifyContent: "space-between",
      }}
    >
      <View className="min-w-0 flex-1">
        <Text
          className="text-charcoal dark:text-neutral-200"
          style={{
            fontFamily: "Manrope_600SemiBold",
            fontSize: 15,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {title}
        </Text>
        <Text
          className="mt-0.5 text-warm-400 dark:text-neutral-500"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 12,
            lineHeight: 18,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {subtitle}
        </Text>
      </View>
      <View style={{ alignSelf: compact ? "center" : isRTL ? "flex-end" : "flex-start" }}>
        {children}
      </View>
    </View>
  );
}

function SwitchSettingsRow({
  title,
  subtitle,
  value,
  onValueChange,
  compact,
  isRTL,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: () => void;
  compact: boolean;
  isRTL: boolean;
}) {
  return (
    <SettingsRow title={title} subtitle={subtitle} compact={compact} isRTL={isRTL}>
      <Switch value={value} onValueChange={onValueChange} />
    </SettingsRow>
  );
}

function StepInputRow({
  title,
  subtitle,
  value,
  onChangeText,
  placeholder,
  compact,
  isDark,
  isRTL,
}: {
  title: string;
  subtitle: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  compact: boolean;
  isDark: boolean;
  isRTL: boolean;
}) {
  return (
    <SettingsRow title={title} subtitle={subtitle} compact={compact} isRTL={isRTL}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={isDark ? "#737373" : "#a79280"}
        autoCapitalize="none"
        autoCorrect={false}
        className="rounded-2xl border border-warm-200 bg-surface-high px-4 py-2.5 text-charcoal dark:border-neutral-800 dark:bg-surface-dark-high dark:text-neutral-100"
        style={{
          direction: "ltr",
          fontFamily: "Manrope_600SemiBold",
          fontSize: 14,
          minWidth: compact ? 220 : 240,
          textAlign: "left",
          writingDirection: "ltr",
        }}
      />
    </SettingsRow>
  );
}

function ChoiceRow<T extends string>({
  title,
  options,
  value,
  onChange,
  isDark,
  isRTL,
}: {
  title: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  isDark: boolean;
  isRTL: boolean;
}) {
  const selectedBg = isDark ? "rgba(45, 212, 191, 0.14)" : "#CCFBF1";
  const selectedText = isDark ? "#5eead4" : "#0F766E";
  const optionShellBg = isDark ? "#1C1917" : "#FFF8F1";
  const optionShellBorder = isDark ? "#262626" : "#E8E1DA";

  return (
    <View className="gap-2 py-2.5">
      <Text
        className="text-charcoal dark:text-neutral-200"
        style={{
          fontFamily: "Manrope_600SemiBold",
          fontSize: 14,
          textAlign: isRTL ? "right" : "left",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {title}
      </Text>
      <View
        className="gap-1 rounded-2xl p-1"
        style={{
          backgroundColor: optionShellBg,
          borderColor: optionShellBorder,
          borderWidth: 1,
          flexDirection: isRTL ? "row-reverse" : "row",
          flexWrap: "wrap",
          justifyContent: isRTL ? "flex-start" : "flex-start",
        }}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              className="rounded-xl px-3.5 py-2"
              style={({ pressed }) => ({
                backgroundColor: selected ? selectedBg : "transparent",
                borderColor: selected ? selectedText : "transparent",
                borderWidth: 1,
                minHeight: 36,
                justifyContent: "center",
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <Text
                style={{
                  color: selected ? selectedText : isDark ? "#d4d4d4" : "#5f4e40",
                  fontFamily: selected ? "Manrope_700Bold" : "Manrope_600SemiBold",
                  fontSize: 12,
                  textAlign: "center",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ReviewStepper({
  value,
  onDecrement,
  onIncrement,
  decrementDisabled,
  incrementDisabled,
  isDark,
  isRTL,
}: {
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementDisabled: boolean;
  incrementDisabled: boolean;
  isDark: boolean;
  isRTL: boolean;
}) {
  const iconColor = isDark ? "#d4d4d4" : "#6e5a47";
  return (
    <View
      className="self-start rounded-full bg-surface-high p-1 dark:bg-surface-dark-high"
      style={{ flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      <Pressable
        onPress={onDecrement}
        disabled={decrementDisabled}
        className="h-9 w-9 items-center justify-center rounded-full"
        style={({ pressed }) => ({
          opacity: decrementDisabled ? 0.35 : pressed ? 0.68 : 1,
          transform: [{ scale: pressed && !decrementDisabled ? 0.96 : 1 }],
        })}
      >
        <Minus size={17} color={iconColor} />
      </Pressable>
      <View className="min-w-16 items-center justify-center px-3">
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 14 }}
        >
          {value}
        </Text>
      </View>
      <Pressable
        onPress={onIncrement}
        disabled={incrementDisabled}
        className="h-9 w-9 items-center justify-center rounded-full"
        style={({ pressed }) => ({
          opacity: incrementDisabled ? 0.35 : pressed ? 0.68 : 1,
          transform: [{ scale: pressed && !incrementDisabled ? 0.96 : 1 }],
        })}
      >
        <Plus size={17} color={iconColor} />
      </Pressable>
    </View>
  );
}

function ReviewSwitchRow({
  label,
  value,
  onValueChange,
  compact,
  isDark,
  isRTL,
  quiet,
}: {
  label: string;
  value: boolean;
  onValueChange: () => void;
  compact: boolean;
  isDark: boolean;
  isRTL: boolean;
  quiet: boolean;
}) {
  const selectedBg = isDark ? "rgba(45, 212, 191, 0.14)" : "#CCFBF1";
  const selectedText = isDark ? "#5eead4" : "#0F766E";
  const restingBg = isDark ? "#1C1917" : "#FFF8F1";
  const restingBorder = isDark ? "#262626" : "#E8E1DA";

  return (
    <View
      className="items-center gap-3 rounded-2xl px-3 py-2.5"
      style={{
        backgroundColor: quiet ? (value ? selectedBg : restingBg) : isDark ? "#0A0A0A" : "#FFF8F1",
        borderColor: quiet ? (value ? selectedText : restingBorder) : "transparent",
        borderWidth: quiet ? 1 : 0,
        flexDirection: isRTL ? "row-reverse" : "row",
        justifyContent: "space-between",
        width: compact ? "48%" : "100%",
      }}
    >
      <Text
        className="text-charcoal dark:text-neutral-300"
        style={{
          color: quiet && value ? selectedText : isDark ? "#d4d4d4" : "#2D2D2D",
          flexShrink: 1,
          fontFamily: quiet && value ? "Manrope_600SemiBold" : "Manrope_500Medium",
          fontSize: 14,
          textAlign: isRTL ? "right" : "left",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {label}
      </Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}
