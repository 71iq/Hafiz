import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { ChevronDown, ChevronUp, Info, Minus, Plus } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DiscardChangesDialog, useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { ReviewSettingInfoSheet } from "@/components/flashcards/ReviewSettingInfoSheet";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Switch } from "@/components/ui/Switch";
import { useDatabase } from "@/lib/database/provider";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { formatDays, formatNumber } from "@/lib/i18n/count";
import { formatStepPreview, formatStepText, type StepTextResult } from "@/lib/fsrs/review-step-text";
import { readDeckReviewSettings, writeDeckReviewSettings } from "@/lib/fsrs/queries";
import {
  applySchedulerDraftPatch,
  isSchedulerDraftChanged,
  schedulerDraftFromSettings,
  schedulerFieldsFromDraft,
  validateSchedulerDraft,
  type SchedulerDraft,
} from "@/lib/fsrs/scheduler-draft";
import {
  ALL_NEW_CARD_SORT_ORDERS,
  ALL_NEW_REVIEW_ORDERS,
  ALL_REVIEW_SORT_ORDERS,
  ALL_WORD_TEST_MODES,
  DECK_DAILY_REVIEW_LIMIT_STEP,
  DECK_MAXIMUM_INTERVAL_STEP,
  DECK_NEW_CARD_LIMIT_STEP,
  DECK_REQUEST_RETENTION_STEP,
  DEFAULT_DECK_DAILY_REVIEW_LIMIT,
  DEFAULT_DECK_LEARNING_STEPS,
  DEFAULT_DECK_RELEARNING_STEPS,
  MAX_DECK_MAXIMUM_INTERVAL,
  MAX_DECK_REQUEST_RETENTION,
  MIN_DECK_MAXIMUM_INTERVAL,
  MIN_DECK_DAILY_REVIEW_LIMIT,
  MIN_DECK_NEW_CARD_LIMIT,
  MIN_DECK_REQUEST_RETENTION,
  type DeckReviewSettings,
  type NewCardSortOrder,
  type NewReviewOrder,
  type ReviewSortOrder,
  type WordTestMode,
} from "@/lib/fsrs/types";
import { useSettings } from "@/lib/settings/context";
import { toArabicNumber } from "@/lib/arabic";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { textStartStyle, inputTextStartStyle } from "@/lib/ui/direction";
export { formatStepText, parseStepText } from "@/lib/fsrs/review-step-text";

type SettingInfo = { title: string; body: string };

function plainDigits(n: number, language: "en" | "ar"): string {
  return language === "ar" ? toArabicNumber(n) : String(n);
}

type Props = {
  visible: boolean;
  deckId: string | null;
  deckTitle: string;
  onClose: () => void;
  onSaved: (notice: string) => void;
};

export function DeckReviewSettingsSheet({ visible, deckId, deckTitle, onClose, onSaved }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const { width } = useWindowDimensions();
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const compact = width >= SIDEBAR_BREAKPOINT;
  const [baseline, setBaseline] = useState<DeckReviewSettings | null>(null);
  const [draft, setDraft] = useState<SchedulerDraft | null>(null);
  const [wordTestModes, setWordTestModes] = useState<WordTestMode[]>([]);
  const [keepOneSide, setKeepOneSide] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeInfo, setActiveInfo] = useState<SettingInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const wordModeLabels: Record<WordTestMode, string> = {
    wordMeaningArabic: s.flashcardsModeWordMeaningArabic,
    wordMeaningTranslation: s.flashcardsModeWordMeaningTranslation,
  };
  const wordModeDescriptions: Record<WordTestMode, string> = {
    wordMeaningArabic: s.deckWordSideArabicDesc,
    wordMeaningTranslation: s.deckWordSideTranslationDesc,
  };

  useEffect(() => {
    if (!visible || !deckId) return;
    let cancelled = false;
    setLoadError(null);
    setSaveError(null);
    setKeepOneSide(false);
    readDeckReviewSettings(db, deckId)
      .then((settings) => {
        if (cancelled) return;
        setBaseline(settings);
        setDraft(schedulerDraftFromSettings(settings, isRTL));
        setWordTestModes(settings.wordTestModes);
      })
      .catch((e) => {
        console.warn("[DeckReviewSettingsSheet] Failed to load settings:", e);
        if (cancelled) return;
        setBaseline(null);
        setDraft(null);
        setLoadError(s.genericActionFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [db, deckId, isRTL, visible, loadAttempt]);

  useEffect(() => {
    if (!visible) setActiveInfo(null);
  }, [visible]);

  const sameModes = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((mode) => b.includes(mode));
  const dirty =
    !!baseline && !!draft && (isSchedulerDraftChanged(draft, baseline) || !sameModes(wordTestModes, baseline.wordTestModes));
  const { guard, dialogProps } = useDiscardGuard(dirty);
  const requestClose = useCallback(() => {
    if (!saving) guard(onClose);
  }, [guard, onClose, saving]);

  const updateDraft = useCallback((patch: Partial<SchedulerDraft>) => {
    setSaveError(null);
    setDraft((prev) => (prev ? applySchedulerDraftPatch(prev, patch) : prev));
  }, []);

  const toggleWordMode = useCallback((value: WordTestMode) => {
    setSaveError(null);
    setWordTestModes((prev) => {
      const next = prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value];
      setKeepOneSide(next.length === 0);
      return next.length > 0 ? next : prev;
    });
  }, []);

  const fields = draft ? schedulerFieldsFromDraft(draft) : null;
  const canSave = !!deckId && !!baseline && !!fields && dirty && !saving;

  const handleSave = async () => {
    if (!deckId || !baseline || !fields || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      await writeDeckReviewSettings(db, deckId, { ...baseline, ...fields, wordTestModes });
      onSaved(interpolate(s.deckSettingsSavedNamed, { deck: deckTitle }));
      onClose();
    } catch (e) {
      console.warn("[DeckReviewSettingsSheet] Failed to save settings:", e);
      setSaveError(s.deckSettingsSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  const wordSidesSection = (
    <SettingsSection title={s.wordFlashcardsTestModes} isRTL={isRTL} variant="quiet">
      <View
        className="gap-3"
        style={{
          direction: "ltr",
          flexDirection: compact ? (isRTL ? "row-reverse" : "row") : "column",
          flexWrap: compact ? "wrap" : "nowrap",
        }}
      >
        {ALL_WORD_TEST_MODES.map((item) => (
          <ReviewSwitchRow
            key={item}
            label={wordModeLabels[item]}
            description={wordModeDescriptions[item]}
            value={wordTestModes.includes(item)}
            onValueChange={() => toggleWordMode(item)}
            compact={compact}
            isDark={isDark}
            isRTL={isRTL}
          />
        ))}
      </View>
      {keepOneSide ? <InlineMessage text={s.deckKeepOneSide} isRTL={isRTL} tone="hint" /> : null}
    </SettingsSection>
  );

  return (
    <>
      <ResponsiveSheet open={visible} onClose={requestClose} maxWidth={680} maxHeight="92%" dir={isRTL ? "rtl" : "ltr"}>
        <OverlayHeader title={deckTitle} subtitle={s.deckReviewSettingsSubtitle} onClose={requestClose} isRTL={isRTL} />

        <OverlayBody contentContainerClassName="px-5 pb-8" contentContainerStyle={{ direction: isRTL ? "rtl" : "ltr" }}>
          {loadError ? (
            <LoadErrorRow message={loadError} onRetry={() => setLoadAttempt((n) => n + 1)} isRTL={isRTL} />
          ) : null}
          {draft ? (
            <SchedulerOptionsPanel
              draft={draft}
              onChange={updateDraft}
              onInfoPress={(title, body) => setActiveInfo({ title, body })}
              afterDailyLimits={wordSidesSection}
              compact={compact}
              isDark={isDark}
              isRTL={isRTL}
            />
          ) : null}
        </OverlayBody>

        <OverlayFooter isRTL={isRTL}>
          <View className="w-full gap-3">
            {saveError ? <InlineMessage text={saveError} isRTL={isRTL} tone="error" /> : null}
            <Button onPress={handleSave} disabled={!canSave} className="w-full">
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>
                  {s.deckReviewSettingsSave}
                </Text>
              )}
            </Button>
          </View>
        </OverlayFooter>
      </ResponsiveSheet>

      <ReviewSettingInfoSheet
        visible={visible}
        info={activeInfo}
        onClose={() => setActiveInfo(null)}
        isPhone={isPhone}
        isRTL={isRTL}
      />
      <DiscardChangesDialog {...dialogProps} />
    </>
  );
}

export function LoadErrorRow({ message, onRetry, isRTL }: { message: string; onRetry: () => void; isRTL: boolean }) {
  const s = useStrings();
  return (
    <View
      className="mb-4 items-center gap-3 rounded-2xl bg-surface-low px-4 py-3 dark:bg-surface-dark-low"
      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row", flexWrap: "wrap" }}
      accessibilityRole="alert"
    >
      <Text
        className="text-red-600 dark:text-red-400"
        style={{ flex: 1, minWidth: 160, fontFamily: "Manrope_500Medium", fontSize: 13, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {message}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        className="min-h-11 justify-center rounded-full px-4"
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
          {s.decksTryAgain}
        </Text>
      </Pressable>
    </View>
  );
}

export function InlineMessage({ text, isRTL, tone }: { text: string; isRTL: boolean; tone: "error" | "hint" }) {
  return (
    <Text
      className={tone === "error" ? "text-red-600 dark:text-red-400" : "text-warm-600 dark:text-neutral-300"}
      accessibilityLiveRegion="polite"
      style={{
        marginTop: tone === "hint" ? 8 : 0,
        fontFamily: "Manrope_500Medium",
        fontSize: 13,
        lineHeight: 19,
        ...textStartStyle(isRTL),
        writingDirection: isRTL ? "rtl" : "ltr",
      }}
    >
      {text}
    </Text>
  );
}

type SchedulerOptionsPanelProps = {
  draft: SchedulerDraft;
  onChange: (patch: Partial<SchedulerDraft>) => void;
  onInfoPress: (title: string, body: string) => void;
  afterDailyLimits?: ReactNode;
  compact: boolean;
  isDark: boolean;
  isRTL: boolean;
};

export function SchedulerOptionsPanel({
  draft,
  onChange,
  onInfoPress,
  afterDailyLimits,
  compact,
  isDark,
  isRTL,
}: SchedulerOptionsPanelProps) {
  const s = useStrings();
  const language = isRTL ? "ar" : "en";
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const validation = useMemo(() => validateSchedulerDraft(draft), [draft]);
  const stepsInvalid = !validation.learningSteps.ok || !validation.relearningSteps.ok;
  const showAdvanced = advancedOpen || stepsInvalid;
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
  const dailyLimit = validation.dailyLimit.ok ? validation.dailyLimit.value : DEFAULT_DECK_DAILY_REVIEW_LIMIT;
  const stepDailyLimit = (delta: number) =>
    onChange({ dailyLimitText: plainDigits(Math.max(MIN_DECK_DAILY_REVIEW_LIMIT, dailyLimit + delta), language) });
  const retentionValue = `${formatNumber(Math.round(draft.requestRetention * 100), language)}%`;
  const ChevronIcon = showAdvanced ? ChevronUp : ChevronDown;

  return (
    <>
      <SettingsSection title={s.flashcardsDailyLimits} isRTL={isRTL}>
        <SettingsRow
          title={s.flashcardsDailyLimit}
          subtitle={s.flashcardsDailyLimitDesc}
          info={s.flashcardsDailyLimitInfo}
          onInfoPress={onInfoPress}
          compact={compact}
          isDark={isDark}
          isRTL={isRTL}
          footer={
            validation.dailyLimit.ok ? null : (
              <InlineMessage
                text={interpolate(s.deckDailyLimitInvalid, { min: formatNumber(MIN_DECK_DAILY_REVIEW_LIMIT, language) })}
                isRTL={isRTL}
                tone="error"
              />
            )
          }
        >
          <ReviewStepper
            value={
              <TextInput
                value={draft.dailyLimitText}
                onChangeText={(text) => onChange({ dailyLimitText: text })}
                accessibilityLabel={s.flashcardsDailyLimit}
                keyboardType="number-pad"
                inputMode="numeric"
                selectTextOnFocus
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_700Bold", fontSize: 14, minWidth: 56, minHeight: 36, textAlign: "center", paddingVertical: 0 }}
              />
            }
            decrementLabel={`${s.flashcardsDailyLimit} −`}
            incrementLabel={`${s.flashcardsDailyLimit} +`}
            onDecrement={() => stepDailyLimit(-DECK_DAILY_REVIEW_LIMIT_STEP)}
            onIncrement={() => stepDailyLimit(DECK_DAILY_REVIEW_LIMIT_STEP)}
            decrementDisabled={validation.dailyLimit.ok && dailyLimit <= MIN_DECK_DAILY_REVIEW_LIMIT}
            incrementDisabled={false}
            isDark={isDark}
            isRTL={isRTL}
          />
        </SettingsRow>
        <SettingsRow
          title={s.flashcardsNewLimit}
          subtitle={s.flashcardsNewLimitDesc}
          info={s.flashcardsNewLimitInfo}
          onInfoPress={onInfoPress}
          compact={compact}
          isDark={isDark}
          isRTL={isRTL}
        >
          <ReviewStepper
            value={formatNumber(draft.newCardsLimit, language)}
            decrementLabel={`${s.flashcardsNewLimit} −`}
            incrementLabel={`${s.flashcardsNewLimit} +`}
            onDecrement={() => onChange({ newCardsLimit: draft.newCardsLimit - DECK_NEW_CARD_LIMIT_STEP })}
            onIncrement={() => onChange({ newCardsLimit: draft.newCardsLimit + DECK_NEW_CARD_LIMIT_STEP })}
            decrementDisabled={draft.newCardsLimit <= MIN_DECK_NEW_CARD_LIMIT}
            incrementDisabled={false}
            isDark={isDark}
            isRTL={isRTL}
          />
        </SettingsRow>
      </SettingsSection>

      {afterDailyLimits}

      <Pressable
        onPress={() => setAdvancedOpen((open) => !open)}
        disabled={stepsInvalid}
        accessibilityRole="button"
        accessibilityState={{ expanded: showAdvanced, disabled: stepsInvalid }}
        className="mb-4 min-h-11 items-center justify-between rounded-2xl bg-surface-low px-4 dark:bg-surface-dark-low"
        style={({ pressed }) => ({ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row", opacity: pressed ? 0.75 : 1 })}
      >
        <Text
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
        >
          {s.deckSettingsAdvanced}
        </Text>
        <ChevronIcon size={18} color={isDark ? "#d4d4d4" : "#6e5a47"} />
      </Pressable>

      {showAdvanced ? (
        <>
          <SettingsSection title={s.flashcardsFsrsSection} isRTL={isRTL}>
            <SettingsRow
              title={s.flashcardsDesiredRetention}
              subtitle={s.flashcardsDesiredRetentionDesc}
              info={s.flashcardsDesiredRetentionInfo}
              onInfoPress={onInfoPress}
              compact={compact}
              isDark={isDark}
              isRTL={isRTL}
            >
              <ReviewStepper
                value={retentionValue}
                decrementLabel={`${s.flashcardsDesiredRetention} −`}
                incrementLabel={`${s.flashcardsDesiredRetention} +`}
                onDecrement={() => onChange({ requestRetention: draft.requestRetention - DECK_REQUEST_RETENTION_STEP })}
                onIncrement={() => onChange({ requestRetention: draft.requestRetention + DECK_REQUEST_RETENTION_STEP })}
                decrementDisabled={draft.requestRetention <= MIN_DECK_REQUEST_RETENTION}
                incrementDisabled={draft.requestRetention >= MAX_DECK_REQUEST_RETENTION}
                isDark={isDark}
                isRTL={isRTL}
              />
            </SettingsRow>
            <SettingsRow
              title={s.flashcardsMaximumInterval}
              subtitle={s.flashcardsMaximumIntervalDesc}
              info={s.flashcardsMaximumIntervalInfo}
              onInfoPress={onInfoPress}
              compact={compact}
              isDark={isDark}
              isRTL={isRTL}
            >
              <ReviewStepper
                value={formatDays(draft.maximumInterval, language)}
                decrementLabel={`${s.flashcardsMaximumInterval} −`}
                incrementLabel={`${s.flashcardsMaximumInterval} +`}
                onDecrement={() => onChange({ maximumInterval: draft.maximumInterval - DECK_MAXIMUM_INTERVAL_STEP })}
                onIncrement={() => onChange({ maximumInterval: draft.maximumInterval + DECK_MAXIMUM_INTERVAL_STEP })}
                decrementDisabled={draft.maximumInterval <= MIN_DECK_MAXIMUM_INTERVAL}
                incrementDisabled={draft.maximumInterval >= MAX_DECK_MAXIMUM_INTERVAL}
                isDark={isDark}
                isRTL={isRTL}
              />
            </SettingsRow>
            <SwitchSettingsRow
              title={s.flashcardsEnableFuzz}
              subtitle={s.flashcardsEnableFuzzDesc}
              info={s.flashcardsEnableFuzzInfo}
              onInfoPress={onInfoPress}
              value={draft.enableFuzz}
              onValueChange={() => onChange({ enableFuzz: !draft.enableFuzz })}
              compact={compact}
              isDark={isDark}
              isRTL={isRTL}
            />
            <SwitchSettingsRow
              title={s.flashcardsEnableShortTerm}
              subtitle={s.flashcardsEnableShortTermDesc}
              info={s.flashcardsEnableShortTermInfo}
              onInfoPress={onInfoPress}
              value={draft.enableShortTerm}
              onValueChange={() => onChange({ enableShortTerm: !draft.enableShortTerm })}
              compact={compact}
              isDark={isDark}
              isRTL={isRTL}
            />
          </SettingsSection>

          <SettingsSection title={s.flashcardsLearningSection} isRTL={isRTL}>
            <StepInputRow
              title={s.flashcardsLearningSteps}
              subtitle={s.flashcardsLearningStepsDesc}
              info={s.flashcardsLearningStepsInfo}
              onInfoPress={onInfoPress}
              value={draft.learningStepsText}
              result={validation.learningSteps}
              onChangeText={(text) => onChange({ learningStepsText: text })}
              placeholder={formatStepText(DEFAULT_DECK_LEARNING_STEPS, isRTL)}
              compact={compact}
              isDark={isDark}
              isRTL={isRTL}
            />
            <StepInputRow
              title={s.flashcardsRelearningSteps}
              subtitle={s.flashcardsRelearningStepsDesc}
              info={s.flashcardsRelearningStepsInfo}
              onInfoPress={onInfoPress}
              value={draft.relearningStepsText}
              result={validation.relearningSteps}
              onChangeText={(text) => onChange({ relearningStepsText: text })}
              placeholder={formatStepText(DEFAULT_DECK_RELEARNING_STEPS, isRTL)}
              compact={compact}
              isDark={isDark}
              isRTL={isRTL}
            />
          </SettingsSection>

          <SettingsSection title={s.flashcardsDisplayOrderSection} isRTL={isRTL} variant="quiet">
            <ChoiceRow
              title={s.flashcardsNewReviewOrder}
              subtitle={s.deckOrderMixedHint}
              info={s.flashcardsNewReviewOrderInfo}
              onInfoPress={onInfoPress}
              options={ALL_NEW_REVIEW_ORDERS.map((value) => ({ value, label: newReviewOrderLabels[value] }))}
              value={draft.newReviewOrder}
              onChange={(value) => onChange({ newReviewOrder: value })}
              isDark={isDark}
              isRTL={isRTL}
            />
            <ChoiceRow
              title={s.flashcardsReviewSortOrder}
              info={s.flashcardsReviewSortOrderInfo}
              onInfoPress={onInfoPress}
              options={ALL_REVIEW_SORT_ORDERS.map((value) => ({ value, label: reviewSortOrderLabels[value] }))}
              value={draft.reviewSortOrder}
              onChange={(value) => onChange({ reviewSortOrder: value })}
              isDark={isDark}
              isRTL={isRTL}
            />
            <ChoiceRow
              title={s.flashcardsNewCardSortOrder}
              info={s.flashcardsNewCardSortOrderInfo}
              onInfoPress={onInfoPress}
              options={ALL_NEW_CARD_SORT_ORDERS.map((value) => ({ value, label: newCardSortOrderLabels[value] }))}
              value={draft.newCardSortOrder}
              onChange={(value) => onChange({ newCardSortOrder: value })}
              isDark={isDark}
              isRTL={isRTL}
            />
          </SettingsSection>
        </>
      ) : null}
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
          ...textStartStyle(isRTL),
          textTransform: "uppercase",
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {title}
      </Text>
      <Card
        elevation={quiet ? "surface" : "low"}
        className={quiet ? "rounded-3xl bg-transparent p-0 dark:bg-transparent" : "p-5"}
      >
        <View className={quiet ? "gap-2.5" : "gap-1"}>{children}</View>
      </Card>
    </View>
  );
}

function SettingsRow({
  title,
  subtitle,
  info,
  onInfoPress,
  children,
  footer,
  compact,
  isDark,
  isRTL,
}: {
  title: string;
  subtitle: string;
  info?: string;
  onInfoPress?: (title: string, body: string) => void;
  children: ReactNode;
  footer?: ReactNode;
  compact: boolean;
  isDark: boolean;
  isRTL: boolean;
}) {
  return (
    <View className="py-2">
      <View
        className="gap-3"
        style={{
          alignItems: compact ? "center" : "stretch",
          direction: "ltr",
          flexDirection: compact ? (isRTL ? "row-reverse" : "row") : "column",
          justifyContent: "space-between",
        }}
      >
        <View className={compact ? "min-w-0 flex-1" : "min-w-0"}>
          <SettingTitle title={title} info={info} onInfoPress={onInfoPress} isDark={isDark} isRTL={isRTL} fontSize={15} />
          <Text
            className="mt-0.5 text-warm-400 dark:text-neutral-500"
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 12,
              lineHeight: 18,
              ...textStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {subtitle}
          </Text>
        </View>
        <View style={{ alignSelf: compact ? "center" : isRTL ? "flex-end" : "flex-start" }}>{children}</View>
      </View>
      {footer}
    </View>
  );
}

function SwitchSettingsRow({
  title,
  subtitle,
  info,
  onInfoPress,
  value,
  onValueChange,
  compact,
  isDark,
  isRTL,
}: {
  title: string;
  subtitle: string;
  info?: string;
  onInfoPress?: (title: string, body: string) => void;
  value: boolean;
  onValueChange: () => void;
  compact: boolean;
  isDark: boolean;
  isRTL: boolean;
}) {
  return (
    <SettingsRow
      title={title}
      subtitle={subtitle}
      info={info}
      onInfoPress={onInfoPress}
      compact={compact}
      isDark={isDark}
      isRTL={isRTL}
    >
      <Switch accessibilityLabel={title} value={value} onValueChange={onValueChange} />
    </SettingsRow>
  );
}

function StepInputRow({
  title,
  subtitle,
  info,
  onInfoPress,
  value,
  result,
  onChangeText,
  placeholder,
  compact,
  isDark,
  isRTL,
}: {
  title: string;
  subtitle: string;
  info?: string;
  onInfoPress?: (title: string, body: string) => void;
  value: string;
  result: StepTextResult;
  onChangeText: (value: string) => void;
  placeholder: string;
  compact: boolean;
  isDark: boolean;
  isRTL: boolean;
}) {
  const s = useStrings();
  const language = isRTL ? "ar" : "en";
  const message = !result.ok
    ? s.deckStepsInvalid
    : result.steps.length === 0
      ? s.deckStepsNone
      : interpolate(s.deckStepsWillUse, { steps: formatStepPreview(result.steps, language) });
  return (
    <SettingsRow
      title={title}
      subtitle={subtitle}
      info={info}
      onInfoPress={onInfoPress}
      compact={compact}
      isDark={isDark}
      isRTL={isRTL}
      footer={<InlineMessage text={message} isRTL={isRTL} tone={result.ok ? "hint" : "error"} />}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={title}
        accessibilityHint={message}
        placeholder={placeholder}
        placeholderTextColor={isDark ? "#737373" : "#a79280"}
        autoCapitalize="none"
        autoCorrect={false}
        className={`rounded-2xl border bg-surface-high px-4 py-2.5 text-charcoal dark:bg-surface-dark-high dark:text-neutral-100 ${
          result.ok ? "border-warm-200 dark:border-neutral-800" : "border-red-600 dark:border-red-400"
        }`}
        style={{
          direction: isRTL ? "rtl" : "ltr",
          fontFamily: "Manrope_600SemiBold",
          fontSize: 14,
          minWidth: compact ? 220 : 240,
          ...inputTextStartStyle(isRTL),
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      />
    </SettingsRow>
  );
}

function ChoiceRow<T extends string>({
  title,
  subtitle,
  info,
  onInfoPress,
  options,
  value,
  onChange,
  isDark,
  isRTL,
}: {
  title: string;
  subtitle?: string;
  info?: string;
  onInfoPress?: (title: string, body: string) => void;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  isDark: boolean;
  isRTL: boolean;
}) {
  const { themeColors } = useSettings();
  const rowBg = themeColors.surfaceLow;
  const rowBorder = isDark ? "rgba(255,255,255,0.06)" : "rgba(45,45,45,0.06)";
  const selectedBg = isDark ? "rgba(45, 212, 191, 0.18)" : "#DFF8F3";
  const selectedText = isDark ? "#5eead4" : "#007D78";
  const idleText = isDark ? "#d4d4d4" : "#5f4e40";

  return (
    <View
      className="gap-3 rounded-3xl px-4 py-3.5"
      style={{
        alignItems: "center",
        backgroundColor: rowBg,
        borderColor: rowBorder,
        borderWidth: 1,
        direction: "ltr",
        flexDirection: isRTL ? "row-reverse" : "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
      }}
    >
      <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 150 }}>
        <SettingTitle title={title} info={info} onInfoPress={onInfoPress} isDark={isDark} isRTL={isRTL} fontSize={14} />
        {subtitle ? (
          <Text
            className="mt-0.5 text-warm-400 dark:text-neutral-500"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View
        className="gap-2"
        accessibilityRole="radiogroup"
        accessibilityLabel={title}
        style={{
          direction: "ltr",
          flexDirection: isRTL ? "row-reverse" : "row",
          flexWrap: "wrap",
          flexShrink: 1,
          justifyContent: isRTL ? "flex-start" : "flex-end",
        }}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              className="rounded-full px-3.5 py-2"
              style={({ pressed }) => ({
                backgroundColor: selected ? selectedBg : "transparent",
                borderColor: selected ? "transparent" : isDark ? "rgba(255,255,255,0.08)" : "rgba(95,78,64,0.12)",
                borderWidth: 1,
                minHeight: 44,
                justifyContent: "center",
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <Text
                style={{
                  color: selected ? selectedText : idleText,
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
  decrementLabel,
  incrementLabel,
  onDecrement,
  onIncrement,
  decrementDisabled,
  incrementDisabled,
  isDark,
  isRTL,
}: {
  value: ReactNode;
  decrementLabel: string;
  incrementLabel: string;
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
      className="self-start items-center rounded-full bg-surface-high p-1 dark:bg-surface-dark-high"
      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      <Pressable
        onPress={onDecrement}
        disabled={decrementDisabled}
        accessibilityRole="button"
        accessibilityLabel={decrementLabel}
        accessibilityState={{ disabled: decrementDisabled }}
        hitSlop={4}
        className="h-9 w-9 items-center justify-center rounded-full"
        style={({ pressed }) => ({
          opacity: decrementDisabled ? 0.35 : pressed ? 0.68 : 1,
          transform: [{ scale: pressed && !decrementDisabled ? 0.96 : 1 }],
        })}
      >
        <Minus size={17} color={iconColor} />
      </Pressable>
      <View className="min-w-16 items-center justify-center px-3">
        {typeof value === "string" ? (
          <Text className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 14 }}>
            {value}
          </Text>
        ) : (
          value
        )}
      </View>
      <Pressable
        onPress={onIncrement}
        disabled={incrementDisabled}
        accessibilityRole="button"
        accessibilityLabel={incrementLabel}
        accessibilityState={{ disabled: incrementDisabled }}
        hitSlop={4}
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
  description,
  value,
  onValueChange,
  compact,
  isDark,
  isRTL,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: () => void;
  compact: boolean;
  isDark: boolean;
  isRTL: boolean;
}) {
  const { themeColors } = useSettings();
  const selectedBg = isDark ? "rgba(45, 212, 191, 0.14)" : "#CCFBF1";
  const selectedText = isDark ? "#5eead4" : "#0F766E";

  return (
    <View
      className="items-center gap-3 rounded-2xl px-3 py-2.5"
      style={{
        backgroundColor: value ? selectedBg : themeColors.surface,
        borderColor: value ? selectedText : themeColors.surfaceHigh,
        borderWidth: 1,
        direction: "ltr",
        flexDirection: isRTL ? "row-reverse" : "row",
        justifyContent: "space-between",
        width: compact ? "48%" : "100%",
      }}
    >
      <View className="min-w-0 flex-1">
        <Text
          style={{
            color: value ? selectedText : isDark ? "#d4d4d4" : "#2D2D2D",
            fontFamily: value ? "Manrope_600SemiBold" : "Manrope_500Medium",
            fontSize: 14,
            ...textStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {label}
        </Text>
        <Text
          className="mt-0.5 text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
        >
          {description}
        </Text>
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onValueChange} />
    </View>
  );
}

function SettingTitle({
  title,
  info,
  onInfoPress,
  isDark,
  isRTL,
  fontSize,
}: {
  title: string;
  info?: string;
  onInfoPress?: (title: string, body: string) => void;
  isDark: boolean;
  isRTL: boolean;
  fontSize: number;
}) {
  const s = useStrings();
  return (
    <View
      className="min-w-0 items-center gap-1.5"
      style={{
        direction: "ltr",
        flexDirection: isRTL ? "row-reverse" : "row",
        alignSelf: isRTL ? "flex-end" : "flex-start",
      }}
    >
      <Text
        className="text-charcoal dark:text-neutral-200"
        style={{
          flexShrink: 1,
          fontFamily: "Manrope_600SemiBold",
          fontSize,
          ...textStartStyle(isRTL),
          writingDirection: isRTL ? "rtl" : "ltr",
        }}
      >
        {title}
      </Text>
      {info && onInfoPress ? (
        <SettingInfoButton
          accessibilityLabel={interpolate(s.deckSettingInfoFor, { setting: title })}
          isDark={isDark}
          onPress={() => onInfoPress(title, info)}
        />
      ) : null}
    </View>
  );
}

function SettingInfoButton({
  accessibilityLabel,
  isDark,
  onPress,
}: {
  accessibilityLabel: string;
  isDark: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={10}
      onPress={onPress}
      className="h-6 w-6 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10"
    >
      <Info size={14} color={isDark ? "#5eead4" : "#0d9488"} />
    </Pressable>
  );
}
