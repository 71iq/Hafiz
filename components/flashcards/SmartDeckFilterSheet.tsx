import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Check, Minus, Plus } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useDatabase } from "@/lib/database/provider";
import { toArabicNumber } from "@/lib/arabic";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import {
  DEFAULT_ENABLED_MODES,
  DEFAULT_WORD_TEST_MODES,
  DECK_DAILY_REVIEW_LIMIT_STEP,
  DEFAULT_DECK_DAILY_REVIEW_LIMIT,
  MAX_DECK_DAILY_REVIEW_LIMIT,
  MIN_DECK_DAILY_REVIEW_LIMIT,
  type DeckReviewSettings,
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
  const [reviewSettings, setReviewSettings] = useState<DeckReviewSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !deckId) return;
    let cancelled = false;
    Promise.all([
      db.getAllAsync<SurahRow>("SELECT number, name_arabic, name_english, ayah_count FROM surahs ORDER BY number"),
      readSmartDeckFilter(db, deckId),
      readDeckReviewSettings(db, deckId),
    ]).then(([rows, filter, settings]) => {
      if (cancelled) return;
      setSurahs(rows);
      setFilterType(filter.type);
      setSelectedSurahs(new Set(filter.type === "surah" ? filter.surahs : []));
      setSelectedJuz(new Set(filter.type === "juz" ? filter.juzNumbers : []));
      setDailyLimit(settings.dailyReviewLimit);
      setReviewSettings(settings);
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [db, visible, deckId]);

  const toggleSurah = useCallback((n: number) => {
    setSelectedSurahs((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  }, []);

  const toggleJuz = useCallback((n: number) => {
    setSelectedJuz((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  }, []);

  const setNextDailyLimit = useCallback((value: number) => {
    setDailyLimit(Math.max(MIN_DECK_DAILY_REVIEW_LIMIT, Math.min(MAX_DECK_DAILY_REVIEW_LIMIT, value)));
  }, []);

  const handleSave = async () => {
    if (!deckId || saving) return;
    setSaving(true);
    try {
      let filter: BuiltInDeckFilter = { type: "all" };
      if (filterType === "surah") filter = { type: "surah", surahs: [...selectedSurahs] };
      if (filterType === "juz") filter = { type: "juz", juzNumbers: [...selectedJuz] };
      await writeSmartDeckFilter(db, deckId, filter);
      await writeDeckReviewSettings(db, deckId, {
        dailyReviewLimit: dailyLimit,
        testModes: reviewSettings?.testModes ?? DEFAULT_ENABLED_MODES,
        wordTestModes: reviewSettings?.wordTestModes ?? DEFAULT_WORD_TEST_MODES,
      });
      await materializeSmartDeckCards(db, deckId, dailyLimit);
      onSaved();
      onClose();
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
              onPress={() => setFilterType(tab.value)}
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
            {s.deckReviewSettingsTitle}
          </Text>
          <Card elevation="low" className="p-5">
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
              <ReviewLimitStepper
                value={isRTL ? toArabicNumber(dailyLimit) : String(dailyLimit)}
                onDecrement={() => setNextDailyLimit(dailyLimit - DECK_DAILY_REVIEW_LIMIT_STEP)}
                onIncrement={() => setNextDailyLimit(dailyLimit + DECK_DAILY_REVIEW_LIMIT_STEP)}
                decrementDisabled={dailyLimit <= MIN_DECK_DAILY_REVIEW_LIMIT}
                incrementDisabled={dailyLimit >= MAX_DECK_DAILY_REVIEW_LIMIT}
                isDark={isDark}
                isRTL={isRTL}
              />
            </View>
          </Card>
        </View>
      </OverlayBody>

      <OverlayFooter isRTL={isRTL}>
        <Button onPress={handleSave} disabled={saving} className="w-full">
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>
              {s.smartDeckApplyFilter}
            </Text>
          )}
        </Button>
      </OverlayFooter>
    </ResponsiveSheet>
  );
}

function ReviewLimitStepper({
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

function getSmartDeckTitle(deckId: SmartDeckId, s: any): string {
  if (deckId === SMART_DECK_IDS.mutashabihat) return s.smartDeckMutashabihatTitle;
  if (deckId === SMART_DECK_IDS.similarTails) return s.smartDeckSimilarTailsTitle;
  return s.smartDeckQiraatTitle;
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
