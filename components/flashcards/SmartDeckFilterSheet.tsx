import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Check, Search } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DiscardChangesDialog, useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { ReviewSettingInfoSheet } from "@/components/flashcards/ReviewSettingInfoSheet";
import { InlineMessage, LoadErrorRow, SchedulerOptionsPanel } from "@/components/flashcards/DeckReviewSettingsSheet";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useDatabase } from "@/lib/database/provider";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import type { UIStrings } from "@/lib/i18n/strings";
import { formatAyahs, formatNumber } from "@/lib/i18n/count";
import { useSettings } from "@/lib/settings/context";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { matchesSurahQuery, surahTransliteration } from "@/lib/search/surah-match";
import {
  formatAyahSpan,
  juzScopeRanges,
  summarizeScopeRanges,
  validateRangeText,
  type JuzMapRow,
  type RangeText,
  type ScopeRange,
  type ScopeSurah,
} from "@/lib/fsrs/deck-scope";
import {
  applySchedulerDraftPatch,
  isSchedulerDraftChanged,
  schedulerDraftFromSettings,
  schedulerFieldsFromDraft,
  type SchedulerDraft,
} from "@/lib/fsrs/scheduler-draft";
import type { DeckReviewSettings } from "@/lib/fsrs/types";
import { putDeckReviewSettings, readDeckReviewSettings } from "@/lib/fsrs/queries";
import {
  materializeSmartDeckCards,
  putSmartDeckFilter,
  readSmartDeckFilter,
  SMART_DECK_IDS,
  type BuiltInDeckFilter,
  type SmartDeckId,
} from "@/lib/fsrs/smart-decks";
import { textStartStyle, textEndStyle, inputTextStartStyle } from "@/lib/ui/direction";

type Props = {
  visible: boolean;
  deckId: SmartDeckId | null;
  onClose: () => void;
  /** Called after an explicit, committed save with the notice that names the deck. */
  onSaved: (notice: string) => void;
};

type FilterType = BuiltInDeckFilter["type"];
type SettingInfo = { title: string; body: string };
type Language = "en" | "ar";
type Baseline = { deckId: SmartDeckId; filter: BuiltInDeckFilter; settings: DeckReviewSettings };

const JUZ_NUMBERS = Array.from({ length: 30 }, (_, i) => i + 1);

/** The surah name a summary or row title shows: Arabic in Arabic, the transliteration in English. */
function scopeName(surah: ScopeSurah, language: Language): string {
  return language === "ar" ? surah.name_arabic : (surahTransliteration(surah.number) ?? surah.name_english);
}

/** Two filters select the same cards when their sorted numbers and partial ranges match. */
function filterKey(filter: BuiltInDeckFilter): string {
  if (filter.type === "juz") return `juz:${[...filter.juzNumbers].sort((a, b) => a - b).join(",")}`;
  if (filter.type === "surah") {
    const ranges = [...(filter.ranges ?? [])]
      .sort((a, b) => a.surah - b.surah)
      .map((range) => `${range.surah}:${range.ayahStart}-${range.ayahEnd}`);
    return `surah:${[...filter.surahs].sort((a, b) => a - b).join(",")}|${ranges.join(",")}`;
  }
  return "all";
}

export function SmartDeckFilterSheet({ visible, deckId, onClose, onSaved }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const language: Language = isRTL ? "ar" : "en";
  const { width } = useWindowDimensions();
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const compact = width >= SIDEBAR_BREAKPOINT;
  const [loaded, setLoaded] = useState<Baseline | null>(null);
  const baseline = visible && loaded?.deckId === deckId ? loaded : null;
  const [draft, setDraft] = useState<SchedulerDraft | null>(null);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [selectedSurahs, setSelectedSurahs] = useState<Set<number>>(new Set());
  const [selectedJuz, setSelectedJuz] = useState<Set<number>>(new Set());
  const [selectedSurahRanges, setSelectedSurahRanges] = useState<Record<number, RangeText>>({});
  const [surahs, setSurahs] = useState<ScopeSurah[]>([]);
  const [juzMap, setJuzMap] = useState<JuzMapRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [activeInfo, setActiveInfo] = useState<SettingInfo | null>(null);
  const [surahSelectorOpen, setSurahSelectorOpen] = useState(false);
  const [rangeTarget, setRangeTarget] = useState<ScopeSurah | null>(null);
  const [failedDeck, setFailedDeck] = useState<SmartDeckId | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const visit = useRef(0);
  // Format the draft in the current language when it loads. A language change must keep edits.
  const rtl = useRef(isRTL);
  rtl.current = isRTL;

  useEffect(() => {
    const request = ++visit.current;
    setLoaded(null);
    setDraft(null);
    setFailedDeck(null);
    setSaving(false);
    setSaveError(null);
    setActiveInfo(null);
    setSurahSelectorOpen(false);
    setRangeTarget(null);
    if (!visible || !deckId) return;
    Promise.all([
      db.getAllAsync<ScopeSurah>("SELECT number, name_arabic, name_english, ayah_count FROM surahs ORDER BY number"),
      db.getAllAsync<JuzMapRow>("SELECT juz, surah, ayah_start, ayah_end FROM juz_map ORDER BY juz, surah, ayah_start"),
      readSmartDeckFilter(db, deckId),
      readDeckReviewSettings(db, deckId),
    ])
      .then(([rows, juzRows, filter, settings]) => {
        if (visit.current !== request) return;
        setSurahs(rows);
        setJuzMap(juzRows);
        setFilterType(filter.type);
        setSelectedSurahs(new Set(filter.type === "surah" ? filter.surahs : []));
        setSelectedJuz(new Set(filter.type === "juz" ? filter.juzNumbers : []));
        setSelectedSurahRanges(filter.type === "surah" ? initialRangeState(rows, filter.surahs, filter.ranges) : {});
        setDraft(schedulerDraftFromSettings(settings, rtl.current));
        setLoaded({ deckId, filter, settings });
      })
      .catch((e) => {
        if (visit.current !== request) return;
        console.warn("[SmartDeckFilterSheet] Failed to load filter:", e);
        setFailedDeck(deckId);
      });
    return () => {
      visit.current += 1;
    };
  }, [db, visible, deckId, loadAttempt]);

  const surahByNumber = useMemo(() => new Map(surahs.map((row) => [row.number, row])), [surahs]);
  const sortedSelection = useMemo(() => [...selectedSurahs].sort((a, b) => a - b), [selectedSurahs]);

  /** Selected surahs whose typed range is not valid, in Quran order. */
  const invalidSurahs = useMemo(
    () =>
      sortedSelection.filter((number) => {
        const surah = surahByNumber.get(number);
        if (!surah) return true;
        const range = selectedSurahRanges[number] ?? { from: "1", to: String(surah.ayah_count) };
        return !validateRangeText(range, surah.ayah_count).ok;
      }),
    [selectedSurahRanges, sortedSelection, surahByNumber],
  );

  /** The exact ranges a valid surah selection covers. */
  const surahRanges = useMemo<ScopeRange[]>(
    () =>
      sortedSelection.flatMap((number) => {
        const surah = surahByNumber.get(number);
        if (!surah) return [];
        const result = validateRangeText(selectedSurahRanges[number] ?? { from: "1", to: String(surah.ayah_count) }, surah.ayah_count);
        return result.ok ? [{ surah: number, ayahStart: result.ayahStart, ayahEnd: result.ayahEnd }] : [];
      }),
    [selectedSurahRanges, sortedSelection, surahByNumber],
  );

  const scopeFilter = useMemo<BuiltInDeckFilter | null>(() => {
    if (filterType === "all") return { type: "all" };
    if (filterType === "juz") return selectedJuz.size > 0 ? { type: "juz", juzNumbers: [...selectedJuz] } : null;
    if (sortedSelection.length === 0 || invalidSurahs.length > 0) return null;
    const partial = surahRanges.some((range) => {
      const surah = surahByNumber.get(range.surah);
      return !!surah && (range.ayahStart !== 1 || range.ayahEnd !== surah.ayah_count);
    });
    return { type: "surah", surahs: sortedSelection, ...(partial ? { ranges: surahRanges } : {}) };
  }, [filterType, invalidSurahs.length, selectedJuz, sortedSelection, surahByNumber, surahRanges]);

  const firstInvalid = invalidSurahs.length > 0 ? surahByNumber.get(invalidSurahs[0]) ?? null : null;
  const scopeError =
    filterType === "surah"
      ? sortedSelection.length === 0
        ? s.deckScopeSelectSurah
        : firstInvalid
          ? interpolate(s.deckScopeCheckRange, { surah: scopeName(firstInvalid, language) })
          : null
      : filterType === "juz" && selectedJuz.size === 0
        ? s.deckScopeSelectJuz
        : null;

  const fields = draft ? schedulerFieldsFromDraft(draft) : null;
  const dirty =
    !!baseline &&
    !!draft &&
    (!scopeFilter || filterKey(scopeFilter) !== filterKey(baseline.filter) || isSchedulerDraftChanged(draft, baseline.settings));
  const canSave = !!deckId && !!baseline && !!fields && !!scopeFilter && dirty && !saving;
  const { guard, dialogProps } = useDiscardGuard(dirty);
  const requestClose = useCallback(() => {
    if (!saving) guard(onClose);
  }, [guard, onClose, saving]);

  const updateDraft = useCallback((patch: Partial<SchedulerDraft>) => {
    setSaveError(null);
    setDraft((prev) => (prev ? applySchedulerDraftPatch(prev, patch) : prev));
  }, []);

  const setSurahSelected = useCallback(
    (numbers: number[], selected: boolean) => {
      setSaveError(null);
      setSelectedSurahs((prev) => {
        const next = new Set(prev);
        for (const n of numbers) {
          if (selected) next.add(n);
          else next.delete(n);
        }
        return next;
      });
      setSelectedSurahRanges((prev) => {
        const next = { ...prev };
        for (const n of numbers) {
          if (selected) next[n] = next[n] ?? { from: "1", to: String(surahByNumber.get(n)?.ayah_count ?? 1) };
          else delete next[n];
        }
        return next;
      });
    },
    [surahByNumber],
  );

  const updateSurahRange = useCallback(
    (surah: number, field: keyof RangeText, value: string) => {
      setSaveError(null);
      setSelectedSurahRanges((prev) => {
        const current = prev[surah] ?? { from: "1", to: String(surahByNumber.get(surah)?.ayah_count ?? 1) };
        return { ...prev, [surah]: { ...current, [field]: value } };
      });
    },
    [surahByNumber],
  );

  const toggleJuz = useCallback((n: number) => {
    setSaveError(null);
    setSelectedJuz((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }, []);

  const title = deckId ? getSmartDeckTitle(deckId, s) : s.smartDeckFilterTitle;

  const handleSave = async () => {
    if (!deckId || !baseline || !fields || !scopeFilter || saving) return;
    const request = visit.current;
    setSaveError(null);
    setSaving(true);
    try {
      const settings = { ...baseline.settings, ...fields };
      // The scope and the scheduler options commit together or not at all.
      await db.withTransactionAsync(async (tx) => {
        await putSmartDeckFilter(tx, deckId, scopeFilter);
        await putDeckReviewSettings(tx, deckId, settings);
      });
    } catch (e) {
      console.warn("[SmartDeckFilterSheet] Failed to save filter:", e);
      if (visit.current !== request) return;
      setSaveError(s.deckFilterSaveFailed);
      setSaving(false);
      return;
    }
    // The settings are saved. Today's cards are built again when the queue loads, so a failure here
    // must not present the committed save as failed.
    try {
      await materializeSmartDeckCards(db, deckId, fields.dailyReviewLimit, fields.newCardsLimit);
    } catch (e) {
      console.warn("[SmartDeckFilterSheet] Saved settings; preparing today's cards failed:", e);
    }
    if (visit.current !== request) return;
    setSaving(false);
    onSaved(interpolate(s.deckSettingsSavedNamed, { deck: title }));
    onClose();
  };

  const tabs: { value: FilterType; label: string }[] = [
    { value: "all", label: s.deckScopeAll },
    { value: "surah", label: s.deckScopeBySurah },
    { value: "juz", label: s.deckScopeByJuz },
  ];
  const surahSummary = summarizeScopeRanges(surahRanges, surahs, language);
  const juzSummary = summarizeScopeRanges(juzScopeRanges(juzMap, selectedJuz), surahs, language);
  const summaryNames = (summary: typeof surahSummary) =>
    summary.moreCount > 0
      ? `${summary.names}${language === "ar" ? "، " : ", "}${interpolate(s.deckScopeMore, { n: formatNumber(summary.moreCount, language) })}`
      : summary.names;
  const selectedLabel = interpolate(s.deckSurahsSelectedCount, { n: formatNumber(selectedSurahs.size, language) });

  return (
    <>
      <ResponsiveSheet open={visible} onClose={requestClose} maxWidth={760} maxHeight={720} dir={isRTL ? "rtl" : "ltr"}>
        <OverlayHeader title={title} subtitle={s.smartDeckFilterTitle} onClose={requestClose} isRTL={isRTL} />

        <View className="mb-4 mt-2">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityRole="tablist"
            contentContainerStyle={{
              gap: 8,
              alignItems: "center",
              direction: "ltr",
              paddingHorizontal: 20,
              paddingVertical: 2,
              flexDirection: isRTL ? "row-reverse" : "row",
            }}
            style={{ maxHeight: 52 }}
          >
            {tabs.map((tab) => {
              const selected = !!baseline && filterType === tab.value;
              return (
                <Pressable
                  key={tab.value}
                  disabled={!baseline}
                  onPress={() => {
                    setSaveError(null);
                    setFilterType(tab.value);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected, disabled: !baseline }}
                  aria-selected={selected}
                  className={`h-11 rounded-full px-5 items-center justify-center ${baseline ? "" : "opacity-50"} ${
                    selected ? "bg-primary-accent" : "bg-surface-low dark:bg-surface-dark-low"
                  }`}
                  style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: selected ? "Manrope_600SemiBold" : "Manrope_500Medium",
                      fontSize: 13,
                      color: selected ? "#fff" : isDark ? "#a3a3a3" : "#6e5a47",
                    }}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <OverlayBody contentContainerClassName="px-5 pb-8" contentContainerStyle={{ direction: isRTL ? "rtl" : "ltr" }}>
          {deckId && failedDeck === deckId ? (
            <LoadErrorRow message={s.genericActionFailed} onRetry={() => setLoadAttempt((n) => n + 1)} isRTL={isRTL} />
          ) : !baseline ? (
            <ActivityIndicator accessibilityLabel={s.loading} />
          ) : null}

          {baseline && filterType === "all" && (
            <Card elevation="low" className="p-5">
              <Text
                className="text-charcoal dark:text-neutral-200"
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  fontSize: 15,
                  ...textStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.smartDeckFilterAllDesc}
              </Text>
            </Card>
          )}

          {baseline && filterType === "surah" && (
            <ScopeSummaryCard
              heading={selectedSurahs.size > 0 ? surahSummary.size : s.deckNoSurahsSelected}
              names={selectedSurahs.size > 0 ? summaryNames(surahSummary) : null}
              error={scopeError}
              actionLabel={selectedSurahs.size > 0 ? s.deckChangeSurahs : s.flashcardsSelectSurahs}
              isRTL={isRTL}
              onPress={() => setSurahSelectorOpen(true)}
            />
          )}

          {baseline && filterType === "juz" && (
            <View className="gap-3">
              <SelectAllClearRow
                onSelectAll={() => setSelectedJuz(new Set(JUZ_NUMBERS))}
                onClear={() => setSelectedJuz(new Set())}
                isRTL={isRTL}
                s={s}
              />
              <View className="flex-wrap gap-3" style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}>
                {JUZ_NUMBERS.map((n) => (
                  <NumberChip
                    key={n}
                    label={formatNumber(n, language)}
                    accessibilityLabel={interpolate(s.deckScopeJuzLabel, { n: formatNumber(n, language) })}
                    selected={selectedJuz.has(n)}
                    onToggle={() => toggleJuz(n)}
                    isDark={isDark}
                  />
                ))}
              </View>
              {selectedJuz.size > 0 ? (
                <ScopeSummaryCard heading={juzSummary.size} names={summaryNames(juzSummary)} isRTL={isRTL} />
              ) : scopeError ? (
                <InlineMessage text={scopeError} isRTL={isRTL} tone="error" />
              ) : null}
            </View>
          )}

          {baseline && draft ? (
            <View className="mt-6">
              <SchedulerOptionsPanel
                draft={draft}
                onChange={updateDraft}
                onInfoPress={(infoTitle, body) => setActiveInfo({ title: infoTitle, body })}
                compact={compact}
                isDark={isDark}
                isRTL={isRTL}
              />
            </View>
          ) : null}
        </OverlayBody>

        <OverlayFooter isRTL={isRTL}>
          <View className="w-full gap-3">
            {saveError ? <InlineMessage text={saveError} isRTL={isRTL} tone="error" /> : null}
            <Button onPress={handleSave} disabled={!canSave} className="w-full">
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>{s.deckSettingsSave}</Text>
              )}
            </Button>
          </View>
        </OverlayFooter>
      </ResponsiveSheet>

      <SurahSelectorSheet
        visible={!!baseline && surahSelectorOpen}
        surahs={surahs}
        selectedSurahs={selectedSurahs}
        selectedSurahRanges={selectedSurahRanges}
        invalidSurahs={invalidSurahs}
        selectedLabel={selectedLabel}
        isPhone={isPhone}
        isDark={isDark}
        isRTL={isRTL}
        language={language}
        s={s}
        onSetSelected={setSurahSelected}
        onRangePress={setRangeTarget}
        onClose={() => setSurahSelectorOpen(false)}
      />

      <ReviewSettingInfoSheet
        visible={!!baseline}
        info={activeInfo}
        onClose={() => setActiveInfo(null)}
        isPhone={isPhone}
        isRTL={isRTL}
      />

      <SurahRangeEditor
        visible={!!baseline && rangeTarget !== null}
        surah={rangeTarget}
        range={rangeTarget ? (selectedSurahRanges[rangeTarget.number] ?? { from: "1", to: String(rangeTarget.ayah_count) }) : null}
        rangeLabels={{
          from: `${s.flashcardsFrom} ${s.reflectionAyahLabel}`,
          to: `${s.flashcardsTo} ${s.reflectionAyahLabel}`,
        }}
        language={language}
        isDark={isDark}
        isRTL={isRTL}
        s={s}
        onChange={(field, value) => {
          if (rangeTarget) updateSurahRange(rangeTarget.number, field, value);
        }}
        onClose={() => setRangeTarget(null)}
      />
      <DiscardChangesDialog {...dialogProps} />
    </>
  );
}

function ScopeSummaryCard({
  heading,
  names,
  error,
  actionLabel,
  isRTL,
  onPress,
}: {
  heading: string;
  names: string | null;
  error?: string | null;
  actionLabel?: string;
  isRTL: boolean;
  onPress?: () => void;
}) {
  return (
    <Card elevation="low" className="p-4">
      <View className={`items-center gap-4 ${isRTL ? "flex-row-reverse" : "flex-row"}`} style={{ direction: "ltr", flexWrap: "wrap" }}>
        <View className="flex-1 gap-1" style={{ minWidth: 180 }}>
          <Text
            className="text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {heading}
          </Text>
          {names ? (
            <Text
              className="text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 13, lineHeight: 20, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
            >
              {names}
            </Text>
          ) : null}
          {error ? <InlineMessage text={error} isRTL={isRTL} tone="error" /> : null}
        </View>
        {onPress && actionLabel ? (
          <Button onPress={onPress} size="sm" className="shrink-0 px-5">
            <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
              {actionLabel}
            </Text>
          </Button>
        ) : null}
      </View>
    </Card>
  );
}

function SelectAllClearRow({
  onSelectAll,
  onClear,
  isRTL,
  s,
}: {
  onSelectAll: () => void;
  onClear: () => void;
  isRTL: boolean;
  s: UIStrings;
}) {
  const link = (label: string, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-11 justify-center rounded-full px-3"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View className="gap-1" style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}>
      {link(s.deckScopeSelectAll, onSelectAll)}
      {link(s.deckScopeClear, onClear)}
    </View>
  );
}

function SurahSelectorSheet({
  visible,
  surahs,
  selectedSurahs,
  selectedSurahRanges,
  invalidSurahs,
  selectedLabel,
  isPhone,
  isDark,
  isRTL,
  language,
  s,
  onSetSelected,
  onRangePress,
  onClose,
}: {
  visible: boolean;
  surahs: ScopeSurah[];
  selectedSurahs: Set<number>;
  selectedSurahRanges: Record<number, RangeText>;
  invalidSurahs: number[];
  selectedLabel: string;
  isPhone: boolean;
  isDark: boolean;
  isRTL: boolean;
  language: Language;
  s: UIStrings;
  onSetSelected: (surahs: number[], selected: boolean) => void;
  onRangePress: (surah: ScopeSurah) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const scrolledRef = useRef(false);
  const visibleSurahs = useMemo(() => surahs.filter((surah) => matchesSurahQuery(surah, query)), [query, surahs]);
  const firstInvalid = invalidSurahs[0] ?? null;

  useEffect(() => {
    if (!visible) {
      setQuery("");
      scrolledRef.current = false;
    }
  }, [visible]);

  return (
    <ResponsiveSheet open={visible} onClose={onClose} maxWidth={640} maxHeight={isPhone ? "86%" : 680} dir={isRTL ? "rtl" : "ltr"}>
      <OverlayHeader title={s.flashcardsSelectSurahs} subtitle={selectedLabel} onClose={onClose} isRTL={isRTL} />
      <View className="gap-2 px-5 pb-2">
        <View
          className="items-center gap-2 rounded-2xl bg-surface-low px-4 dark:bg-surface-dark-low"
          style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
        >
          <Search size={17} color={isDark ? "#737373" : "#8B8178"} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            accessibilityLabel={s.deckScopeSearchSurahs}
            placeholder={s.deckScopeSearchSurahs}
            placeholderTextColor={isDark ? "#737373" : "#8B8178"}
            autoCorrect={false}
            className="min-h-11 flex-1 py-2 text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 14, ...inputTextStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
          />
        </View>
        <SelectAllClearRow
          onSelectAll={() => onSetSelected(visibleSurahs.map((surah) => surah.number), true)}
          onClear={() => onSetSelected([...selectedSurahs], false)}
          isRTL={isRTL}
          s={s}
        />
      </View>
      <OverlayBody
        scrollRef={scrollRef}
        contentContainerClassName="px-5 py-4"
        contentContainerStyle={{ direction: isRTL ? "rtl" : "ltr", gap: 8 }}
      >
        {visibleSurahs.length === 0 ? (
          <Text
            className="py-6 text-center text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 14, writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {s.deckScopeNoSurahMatch}
          </Text>
        ) : (
          visibleSurahs.map((surah) => (
            <SurahFilterItem
              key={surah.number}
              surah={surah}
              selected={selectedSurahs.has(surah.number)}
              invalid={invalidSurahs.includes(surah.number)}
              onToggle={() => onSetSelected([surah.number], !selectedSurahs.has(surah.number))}
              isDark={isDark}
              isRTL={isRTL}
              language={language}
              s={s}
              range={selectedSurahRanges[surah.number] ?? { from: "1", to: String(surah.ayah_count) }}
              onRangePress={() => onRangePress(surah)}
              // Opening with an invalid range scrolls to its row once, so the highlighted row is in view.
              onLayoutY={
                surah.number === firstInvalid
                  ? (y) => {
                      if (scrolledRef.current) return;
                      scrolledRef.current = true;
                      scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: false });
                    }
                  : undefined
              }
            />
          ))
        )}
      </OverlayBody>
      <OverlayFooter isRTL={isRTL}>
        <Button onPress={onClose} className="w-full">
          <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}>
            {s.deckAyahRangeDone}
          </Text>
        </Button>
      </OverlayFooter>
    </ResponsiveSheet>
  );
}

function getSmartDeckTitle(deckId: SmartDeckId, s: UIStrings): string {
  if (deckId === SMART_DECK_IDS.retention) return s.smartDeckRetentionTitle;
  if (deckId === SMART_DECK_IDS.mutashabihat) return s.smartDeckMutashabihatTitle;
  if (deckId === SMART_DECK_IDS.similarTails) return s.smartDeckSimilarTailsTitle;
  if (deckId === SMART_DECK_IDS.qiraat) return s.smartDeckQiraatTitle;
  return s.smartDeckReasonsTitle;
}

function SurahFilterItem({
  surah,
  selected,
  invalid,
  onToggle,
  isDark,
  isRTL,
  language,
  s,
  range,
  onRangePress,
  onLayoutY,
}: {
  surah: ScopeSurah;
  selected: boolean;
  invalid: boolean;
  onToggle: () => void;
  isDark: boolean;
  isRTL: boolean;
  language: Language;
  s: UIStrings;
  range: RangeText;
  onRangePress: () => void;
  onLayoutY?: (y: number) => void;
}) {
  const parsed = validateRangeText(range, surah.ayah_count);
  const rangeLabel = !parsed.ok
    ? interpolate(s.deckScopeAyahRange, { range: `${range.from}-${range.to}` })
    : parsed.ayahStart === 1 && parsed.ayahEnd === surah.ayah_count
      ? s.deckScopeFullSurah
      : interpolate(s.deckScopeAyahRange, { range: formatAyahSpan(parsed.ayahStart, parsed.ayahEnd, language) });
  // Arabic UI titles the row in Arabic with the transliteration as its hint; English the reverse.
  const title = language === "ar" ? surah.name_arabic : surah.name_english;
  const hint = language === "ar" ? (surahTransliteration(surah.number) ?? surah.name_english) : surah.name_arabic;

  return (
    <View
      onLayout={onLayoutY ? (event) => onLayoutY(event.nativeEvent.layout.y) : undefined}
      className={`min-h-[68px] justify-center rounded-2xl px-4 py-3 ${
        selected ? "bg-primary-accent/10 dark:bg-primary-bright/15" : "bg-surface-low dark:bg-surface-dark-low"
      } ${invalid ? "border-2 border-red-600 dark:border-red-400" : ""}`}
      style={{ direction: "ltr" }}
    >
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${title}, ${formatAyahs(surah.ayah_count, language)}`}
        className={`items-center gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}
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
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: isDark ? "#a3a3a3" : "#8B8178" }}>
              {formatNumber(surah.number, language)}
            </Text>
          )}
        </View>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text
            className="text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_500Medium", fontSize: language === "ar" ? 16 : 14, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
          >
            {title}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 12, ...textStartStyle(isRTL) }}
          >
            {formatAyahs(surah.ayah_count, language)}
          </Text>
        </View>
        <Text
          className="text-charcoal dark:text-neutral-300"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: language === "ar" ? 13 : 16,
            writingDirection: language === "ar" ? "ltr" : "rtl",
            ...textEndStyle(isRTL),
          }}
        >
          {hint}
        </Text>
        {selected && (
          <Pressable
            onPress={(event) => {
              event.stopPropagation?.();
              onRangePress();
            }}
            accessibilityRole="button"
            accessibilityLabel={`${s.deckSpecifyAyahRange}: ${rangeLabel}`}
            className="min-h-11 justify-center rounded-full bg-surface-high px-3 dark:bg-surface-dark-high"
            style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
          >
            <Text
              className={invalid ? "text-red-600 dark:text-red-400" : "text-primary-accent dark:text-primary-bright"}
              numberOfLines={1}
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, textAlign: "center", writingDirection: isRTL ? "rtl" : "ltr" }}
            >
              {rangeLabel}
            </Text>
          </Pressable>
        )}
      </Pressable>
    </View>
  );
}

function SurahRangeEditor({
  visible,
  surah,
  range,
  rangeLabels,
  language,
  isDark,
  isRTL,
  s,
  onChange,
  onClose,
}: {
  visible: boolean;
  surah: ScopeSurah | null;
  range: RangeText | null;
  rangeLabels: { from: string; to: string };
  language: Language;
  isDark: boolean;
  isRTL: boolean;
  s: UIStrings;
  onChange: (field: keyof RangeText, value: string) => void;
  onClose: () => void;
}) {
  const result = surah && range ? validateRangeText(range, surah.ayah_count) : null;
  const count = surah ? formatNumber(surah.ayah_count, language) : "";
  const error =
    result && !result.ok
      ? result.reason === "order"
        ? s.deckScopeRangeOrder
        : interpolate(s.deckScopeRangeOutside, { n: count })
      : null;
  const placeholder = surah ? `${formatNumber(1, language)}-${count}` : "";
  return (
    <ResponsiveSheet open={visible} onClose={onClose} maxWidth={420} maxHeight={380} dir={isRTL ? "rtl" : "ltr"}>
      <OverlayHeader
        title={s.deckSpecifyAyahRange}
        subtitle={surah ? (language === "ar" ? surah.name_arabic : surah.name_english) : undefined}
        onClose={onClose}
        isRTL={isRTL}
      />
      <OverlayBody scrollEnabled={false} contentContainerClassName="px-5 py-5">
        {range ? (
          <View className="gap-2">
            <View className="gap-3" style={{ flexDirection: isRTL ? "row-reverse" : "row" }}>
              <RangeInput
                label={rangeLabels.from}
                value={range.from}
                placeholder={placeholder}
                invalid={!!error}
                onChangeText={(value) => onChange("from", value)}
                isDark={isDark}
                isRTL={isRTL}
              />
              <RangeInput
                label={rangeLabels.to}
                value={range.to}
                placeholder={placeholder}
                invalid={!!error}
                onChangeText={(value) => onChange("to", value)}
                isDark={isDark}
                isRTL={isRTL}
              />
            </View>
            {error ? (
              <InlineMessage text={error} isRTL={isRTL} tone="error" />
            ) : (
              <InlineMessage text={interpolate(s.deckScopeRangeHelper, { n: count })} isRTL={isRTL} tone="hint" />
            )}
          </View>
        ) : null}
      </OverlayBody>
      <OverlayFooter isRTL={isRTL}>
        <Button onPress={onClose} disabled={!!error} className="w-full">
          <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15 }}>
            {s.deckAyahRangeDone}
          </Text>
        </Button>
      </OverlayFooter>
    </ResponsiveSheet>
  );
}

function initialRangeState(rows: ScopeSurah[], surahs: number[], ranges?: ScopeRange[]): Record<number, RangeText> {
  const rangeBySurah = new Map((ranges ?? []).map((range) => [range.surah, range]));
  return Object.fromEntries(
    surahs.map((surahNumber) => {
      const surah = rows.find((row) => row.number === surahNumber);
      const range = rangeBySurah.get(surahNumber);
      return [surahNumber, { from: String(range?.ayahStart ?? 1), to: String(range?.ayahEnd ?? surah?.ayah_count ?? 1) }];
    }),
  );
}

function RangeInput({
  label,
  value,
  placeholder,
  invalid,
  onChangeText,
  isDark,
  isRTL,
}: {
  label: string;
  value: string;
  placeholder: string;
  invalid: boolean;
  onChangeText: (text: string) => void;
  isDark: boolean;
  isRTL: boolean;
}) {
  return (
    <View className="flex-1">
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={placeholder}
        keyboardType="number-pad"
        className={`bg-surface-high dark:bg-surface-dark-high rounded-xl px-4 py-3 text-charcoal dark:text-neutral-200 ${
          invalid ? "border border-red-600 dark:border-red-400" : ""
        }`}
        style={{ fontFamily: "Manrope_500Medium", fontSize: 15, ...inputTextStartStyle(isRTL) }}
        placeholderTextColor={isDark ? "#737373" : "#8B8178"}
      />
    </View>
  );
}

function NumberChip({
  label,
  accessibilityLabel,
  selected,
  onToggle,
  isDark,
}: {
  label: string;
  accessibilityLabel: string;
  selected: boolean;
  onToggle: () => void;
  isDark: boolean;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: selected }}
      className={`w-14 h-14 rounded-2xl items-center justify-center ${
        selected ? "bg-primary-accent" : "bg-surface-low dark:bg-surface-dark-low"
      }`}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
    >
      <Text
        style={{
          fontFamily: selected ? "Manrope_700Bold" : "Manrope_500Medium",
          fontSize: 16,
          color: selected ? "#fff" : isDark ? "#a3a3a3" : "#6e5a47",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
