import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Check } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useDatabase } from "@/lib/database/provider";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { SchedulerOptionsPanel, formatStepText, parseStepText } from "@/components/flashcards/DeckReviewSettingsSheet";
import {
  DEFAULT_DECK_ENABLE_FUZZ,
  DEFAULT_DECK_ENABLE_SHORT_TERM,
  DEFAULT_DECK_DAILY_REVIEW_LIMIT,
  DEFAULT_DECK_LEARNING_STEPS,
  DEFAULT_DECK_MAXIMUM_INTERVAL,
  DEFAULT_DECK_NEW_CARD_LIMIT,
  DEFAULT_DECK_RELEARNING_STEPS,
  DEFAULT_DECK_REQUEST_RETENTION,
  DEFAULT_ENABLED_MODES,
  DEFAULT_NEW_CARD_SORT_ORDER,
  DEFAULT_NEW_REVIEW_ORDER,
  DEFAULT_REVIEW_SORT_ORDER,
  DEFAULT_WORD_TEST_MODES,
  MAX_DECK_MAXIMUM_INTERVAL,
  MAX_DECK_DAILY_REVIEW_LIMIT,
  MAX_DECK_NEW_CARD_LIMIT,
  MAX_DECK_REQUEST_RETENTION,
  MIN_DECK_MAXIMUM_INTERVAL,
  MIN_DECK_DAILY_REVIEW_LIMIT,
  MIN_DECK_NEW_CARD_LIMIT,
  MIN_DECK_REQUEST_RETENTION,
  type DeckReviewSettings,
  type NewCardSortOrder,
  type NewReviewOrder,
  type ReviewSortOrder,
} from "@/lib/fsrs/types";
import {
  readDeckReviewSettings,
  writeDeckReviewSettings,
} from "@/lib/fsrs/queries";
import {
  materializeSmartDeckCards,
  readSmartDeckFilter,
  SMART_DECK_IDS,
  type BuiltInDeckFilter,
  type SmartDeckId,
  writeSmartDeckFilter,
} from "@/lib/fsrs/smart-decks";

type Props = {
  visible: boolean;
  deckId: SmartDeckId | null;
  onClose: () => void;
  onSaved: () => void;
};

type FilterType = BuiltInDeckFilter["type"];
type SettingInfo = { title: string; body: string };
type SurahRow = { number: number; name_arabic: string; name_english: string; ayah_count: number };

export function SmartDeckFilterSheet({ visible, deckId, onClose, onSaved }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const { width } = useWindowDimensions();
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const compact = width >= SIDEBAR_BREAKPOINT;
  const surfaceColor = isDark ? "#1C1917" : "#FFF8F1";
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [selectedSurahs, setSelectedSurahs] = useState<Set<number>>(new Set());
  const [selectedJuz, setSelectedJuz] = useState<Set<number>>(new Set());
  const [surahs, setSurahs] = useState<SurahRow[]>([]);
  const [dailyLimit, setDailyLimit] = useState(DEFAULT_DECK_DAILY_REVIEW_LIMIT);
  const [newCardsLimit, setNewCardsLimit] = useState(DEFAULT_DECK_NEW_CARD_LIMIT);
  const [requestRetention, setRequestRetention] = useState(DEFAULT_DECK_REQUEST_RETENTION);
  const [maximumInterval, setMaximumInterval] = useState(DEFAULT_DECK_MAXIMUM_INTERVAL);
  const [enableFuzz, setEnableFuzz] = useState(DEFAULT_DECK_ENABLE_FUZZ);
  const [enableShortTerm, setEnableShortTerm] = useState(DEFAULT_DECK_ENABLE_SHORT_TERM);
  const [learningStepsText, setLearningStepsText] = useState(() => formatStepText(DEFAULT_DECK_LEARNING_STEPS, isRTL));
  const [relearningStepsText, setRelearningStepsText] = useState(() => formatStepText(DEFAULT_DECK_RELEARNING_STEPS, isRTL));
  const [newReviewOrder, setNewReviewOrder] = useState<NewReviewOrder>(DEFAULT_NEW_REVIEW_ORDER);
  const [reviewSortOrder, setReviewSortOrder] = useState<ReviewSortOrder>(DEFAULT_REVIEW_SORT_ORDER);
  const [newCardSortOrder, setNewCardSortOrder] = useState<NewCardSortOrder>(DEFAULT_NEW_CARD_SORT_ORDER);
  const [reviewSettings, setReviewSettings] = useState<DeckReviewSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeInfo, setActiveInfo] = useState<SettingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !deckId) return;
    let cancelled = false;
    Promise.all([
      db.getAllAsync<SurahRow>("SELECT number, name_arabic, name_english, ayah_count FROM surahs ORDER BY number"),
      readSmartDeckFilter(db, deckId),
      readDeckReviewSettings(db, deckId),
    ]).then(([rows, filter, settings]) => {
      if (cancelled) return;
      setError(null);
      setSurahs(rows);
      setFilterType(filter.type);
      setSelectedSurahs(new Set(filter.type === "surah" ? filter.surahs : []));
      setSelectedJuz(new Set(filter.type === "juz" ? filter.juzNumbers : []));
      setDailyLimit(settings.dailyReviewLimit);
      setNewCardsLimit(settings.newCardsLimit);
      setRequestRetention(settings.requestRetention);
      setMaximumInterval(settings.maximumInterval);
      setEnableFuzz(settings.enableFuzz);
      setEnableShortTerm(settings.enableShortTerm);
      setLearningStepsText(formatStepText(settings.learningSteps, isRTL));
      setRelearningStepsText(formatStepText(settings.relearningSteps, isRTL));
      setNewReviewOrder(settings.newReviewOrder);
      setReviewSortOrder(settings.reviewSortOrder);
      setNewCardSortOrder(settings.newCardSortOrder);
      setReviewSettings(settings);
    }).catch((e) => {
      console.warn("[SmartDeckFilterSheet] Failed to load filter:", e);
      if (!cancelled) setError(s.genericActionFailed);
    });
    return () => {
      cancelled = true;
    };
  }, [db, visible, deckId, isRTL]);

  useEffect(() => {
    if (!visible) setActiveInfo(null);
  }, [visible]);

  const openSettingInfo = useCallback((title: string, body: string) => {
    setActiveInfo({ title, body });
  }, []);

  const toggleSurah = useCallback((n: number) => {
    setError(null);
    setSelectedSurahs((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  }, []);

  const toggleJuz = useCallback((n: number) => {
    setError(null);
    setSelectedJuz((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  }, []);

  const setNextDailyLimit = useCallback((value: number) => {
    setError(null);
    setDailyLimit(Math.max(MIN_DECK_DAILY_REVIEW_LIMIT, Math.min(MAX_DECK_DAILY_REVIEW_LIMIT, value)));
  }, []);

  const setNextNewCardsLimit = useCallback((value: number) => {
    setError(null);
    setNewCardsLimit(Math.max(MIN_DECK_NEW_CARD_LIMIT, Math.min(MAX_DECK_NEW_CARD_LIMIT, value)));
  }, []);

  const setNextRetention = useCallback((value: number) => {
    setError(null);
    const clamped = Math.max(MIN_DECK_REQUEST_RETENTION, Math.min(MAX_DECK_REQUEST_RETENTION, value));
    setRequestRetention(Number(clamped.toFixed(2)));
  }, []);

  const setNextMaximumInterval = useCallback((value: number) => {
    setError(null);
    setMaximumInterval(Math.max(MIN_DECK_MAXIMUM_INTERVAL, Math.min(MAX_DECK_MAXIMUM_INTERVAL, value)));
  }, []);

  const canSave = () => {
    if (!deckId) return false;
    if (filterType === "surah") return selectedSurahs.size > 0;
    if (filterType === "juz") return selectedJuz.size > 0;
    return true;
  };

  const handleSave = async () => {
    if (!deckId || saving) return;
    setError(null);
    if (!canSave()) {
      setError(s.deckSelectionRequired);
      return;
    }
    setSaving(true);
    try {
      let filter: BuiltInDeckFilter = { type: "all" };
      if (filterType === "surah") filter = { type: "surah", surahs: [...selectedSurahs] };
      if (filterType === "juz") filter = { type: "juz", juzNumbers: [...selectedJuz] };
      await writeSmartDeckFilter(db, deckId, filter);
      await writeDeckReviewSettings(db, deckId, {
        ...(reviewSettings ?? {}),
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
        testModes: reviewSettings?.testModes ?? DEFAULT_ENABLED_MODES,
        wordTestModes: reviewSettings?.wordTestModes ?? DEFAULT_WORD_TEST_MODES,
      });
      await materializeSmartDeckCards(db, deckId, dailyLimit, newCardsLimit);
      onSaved();
      onClose();
    } catch (e) {
      console.warn("[SmartDeckFilterSheet] Failed to save filter:", e);
      setError(s.deckFilterSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  const title = deckId ? getSmartDeckTitle(deckId, s) : s.smartDeckFilterTitle;
  const tabs: { value: FilterType; label: string }[] = [
    { value: "all", label: s.smartDeckFilterAll },
    { value: "surah", label: s.flashcardsScopeBysurah },
    { value: "juz", label: s.flashcardsScopeByjuz },
  ];

  return (
    <>
      <ResponsiveSheet
        open={visible}
        onClose={onClose}
        maxWidth={760}
        maxHeight={720}
        surfaceColor={surfaceColor}
      >
        <OverlayHeader
          title={title}
          onClose={onClose}
          isRTL={isRTL}
          showHandle={isPhone}
        />

        <View className="mb-4 mt-2">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              gap: 8,
              alignItems: "center",
              paddingHorizontal: 20,
              paddingVertical: 2,
              flexDirection: isRTL ? "row-reverse" : "row",
            }}
            style={{ maxHeight: 52 }}
          >
            {tabs.map((tab) => (
              <Pressable
                key={tab.value}
                onPress={() => {
                  setError(null);
                  setFilterType(tab.value);
                }}
                className={`h-11 rounded-full px-5 items-center justify-center ${
                  filterType === tab.value ? "bg-primary-accent" : "bg-surface-low dark:bg-surface-dark-low"
                }`}
                style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: filterType === tab.value ? "Manrope_600SemiBold" : "Manrope_500Medium",
                    fontSize: 13,
                    color: filterType === tab.value ? "#fff" : (isDark ? "#a3a3a3" : "#6e5a47"),
                  }}
                >
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <OverlayBody contentContainerClassName="px-5 pb-8">
          {filterType === "all" && (
            <Card elevation="low" className="p-5">
              <Text
                className="text-charcoal dark:text-neutral-200"
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  fontSize: 15,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.smartDeckFilterAllDesc}
              </Text>
            </Card>
          )}

          {filterType === "surah" && (
            <View className="gap-2">
              {surahs.map((surah) => (
                <SurahFilterItem
                  key={surah.number}
                  surah={surah}
                  selected={selectedSurahs.has(surah.number)}
                  onToggle={() => toggleSurah(surah.number)}
                  isDark={isDark}
                  isRTL={isRTL}
                  ayahCountLabel={interpolate("{{n}} {{label}}", { n: surah.ayah_count, label: s.ayahs })}
                />
              ))}
            </View>
          )}

          {filterType === "juz" && (
            <View className="flex-row flex-wrap gap-3">
              {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                <NumberChip key={n} number={n} selected={selectedJuz.has(n)} onToggle={() => toggleJuz(n)} isDark={isDark} />
              ))}
            </View>
          )}

          <View className="mt-6">
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
              onInfoPress={openSettingInfo}
              compact={compact}
              isDark={isDark}
              isRTL={isRTL}
            />
          </View>
        </OverlayBody>

        <OverlayFooter isRTL={isRTL}>
          <View className="w-full gap-3">
            {error && (
              <Text
                className="text-red-600 dark:text-red-400"
                style={{ fontFamily: "Manrope_500Medium", fontSize: 13, textAlign: isRTL ? "right" : "left" }}
              >
                {error}
              </Text>
            )}
            <Button onPress={handleSave} disabled={saving || !canSave()} className="w-full">
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>
                  {s.smartDeckApplyFilter}
                </Text>
              )}
            </Button>
          </View>
        </OverlayFooter>
      </ResponsiveSheet>

      <ResponsiveSheet
        open={visible && activeInfo !== null}
        onClose={() => setActiveInfo(null)}
        maxWidth={440}
        maxHeight={isPhone ? "70%" : 360}
        surfaceColor={surfaceColor}
      >
        <OverlayHeader
          title={activeInfo?.title ?? ""}
          onClose={() => setActiveInfo(null)}
          isRTL={isRTL}
          showHandle={isPhone}
        />
        <OverlayBody contentContainerClassName="px-5 py-5">
          <Text
            className="text-charcoal dark:text-neutral-200"
            style={{
              fontFamily: "Manrope_400Regular",
              fontSize: 14,
              lineHeight: 23,
              textAlign: isRTL ? "right" : "left",
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {activeInfo?.body ?? ""}
          </Text>
        </OverlayBody>
      </ResponsiveSheet>
    </>
  );
}

function getSmartDeckTitle(deckId: SmartDeckId, s: any): string {
  if (deckId === SMART_DECK_IDS.mutashabihat) return s.smartDeckMutashabihatTitle;
  if (deckId === SMART_DECK_IDS.similarTails) return s.smartDeckSimilarTailsTitle;
  if (deckId === SMART_DECK_IDS.qiraat) return s.smartDeckQiraatTitle;
  return s.smartDeckReasonsTitle;
}

function SurahFilterItem({
  surah,
  selected,
  onToggle,
  isDark,
  isRTL,
  ayahCountLabel,
}: {
  surah: SurahRow;
  selected: boolean;
  onToggle: () => void;
  isDark: boolean;
  isRTL: boolean;
  ayahCountLabel: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      className={`items-center p-4 rounded-2xl gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"} ${
        selected ? "bg-primary-accent/10 dark:bg-primary-bright/15" : "bg-surface-low dark:bg-surface-dark-low"
      }`}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
    >
      <View
        className={`w-8 h-8 rounded-full items-center justify-center ${
          selected ? "bg-primary-accent" : "bg-surface-high dark:bg-surface-dark-high"
        }`}
      >
        {selected ? (
          <Check size={14} color="#fff" />
        ) : (
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: isDark ? "#737373" : "#b9a085" }}>
            {surah.number}
          </Text>
        )}
      </View>
      <View className="flex-1">
        <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_500Medium", fontSize: 14, textAlign: isRTL ? "right" : "left" }}>
          {surah.name_english}
        </Text>
        <Text className="text-warm-400 dark:text-neutral-500" style={{ fontFamily: "Manrope_400Regular", fontSize: 12, textAlign: isRTL ? "right" : "left" }}>
          {ayahCountLabel}
        </Text>
      </View>
      <Text
        className="text-charcoal dark:text-neutral-300"
        style={{ fontFamily: "Manrope_400Regular", fontSize: 16, writingDirection: "rtl", textAlign: isRTL ? "left" : "right" }}
      >
        {surah.name_arabic}
      </Text>
    </Pressable>
  );
}

function NumberChip({
  number,
  selected,
  onToggle,
  isDark,
}: {
  number: number;
  selected: boolean;
  onToggle: () => void;
  isDark: boolean;
}) {
  return (
    <Pressable
      onPress={onToggle}
      className={`w-14 h-14 rounded-2xl items-center justify-center ${
        selected ? "bg-primary-accent" : "bg-surface-low dark:bg-surface-dark-low"
      }`}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
    >
      <Text
        style={{
          fontFamily: selected ? "Manrope_700Bold" : "Manrope_500Medium",
          fontSize: 16,
          color: selected ? "#fff" : (isDark ? "#a3a3a3" : "#6e5a47"),
        }}
      >
        {number}
      </Text>
    </Pressable>
  );
}
