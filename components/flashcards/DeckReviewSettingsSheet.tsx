import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from "react-native";
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
  ALL_TEST_MODES,
  ALL_WORD_TEST_MODES,
  DECK_DAILY_REVIEW_LIMIT_STEP,
  DEFAULT_DECK_DAILY_REVIEW_LIMIT,
  DEFAULT_ENABLED_MODES,
  DEFAULT_WORD_TEST_MODES,
  MAX_DECK_DAILY_REVIEW_LIMIT,
  MIN_DECK_DAILY_REVIEW_LIMIT,
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
        testModes,
        wordTestModes,
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const limitValue = isRTL ? toArabicNumber(dailyLimit) : String(dailyLimit);

  return (
    <ResponsiveSheet
      open={visible}
      onClose={onClose}
      maxWidth={680}
      maxHeight={680}
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

        <Card elevation="low" className="mb-6 p-5">
          <View
            className="items-center justify-between gap-4"
            style={{ flexDirection: compact ? (isRTL ? "row-reverse" : "row") : "column" }}
          >
            <View className="flex-1">
              <Text
                className="text-charcoal dark:text-neutral-200"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, textAlign: isRTL ? "right" : "left" }}
              >
                {s.flashcardsDailyLimit}
              </Text>
              <Text
                className="mt-0.5 text-warm-400 dark:text-neutral-500"
                style={{ fontFamily: "Manrope_400Regular", fontSize: 12, textAlign: isRTL ? "right" : "left" }}
              >
                {s.flashcardsDailyLimitDesc}
              </Text>
            </View>
            <ReviewStepper
              value={limitValue}
              onDecrement={() => setNextDailyLimit(dailyLimit - DECK_DAILY_REVIEW_LIMIT_STEP)}
              onIncrement={() => setNextDailyLimit(dailyLimit + DECK_DAILY_REVIEW_LIMIT_STEP)}
              decrementDisabled={dailyLimit <= MIN_DECK_DAILY_REVIEW_LIMIT}
              incrementDisabled={dailyLimit >= MAX_DECK_DAILY_REVIEW_LIMIT}
              isDark={isDark}
              isRTL={isRTL}
            />
          </View>
        </Card>

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
          {mode === "word" ? s.wordFlashcardsTestModes : s.flashcardsTestModes}
        </Text>
        <Card elevation="low" className="p-5">
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
                />
              ))
            )}
          </View>
        </Card>
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
}: {
  label: string;
  value: boolean;
  onValueChange: () => void;
  compact: boolean;
  isDark: boolean;
  isRTL: boolean;
}) {
  return (
    <View
      className="items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 dark:bg-surface-dark"
      style={{
        flexDirection: isRTL ? "row-reverse" : "row",
        width: compact ? "48%" : "100%",
      }}
    >
      <Text
        className="text-charcoal dark:text-neutral-300"
        style={{
          color: isDark ? "#d4d4d4" : "#2D2D2D",
          flexShrink: 1,
          fontFamily: "Manrope_500Medium",
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
