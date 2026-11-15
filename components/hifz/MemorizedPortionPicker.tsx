import { useMemo, useState } from "react";
import { Keyboard, Pressable, View } from "react-native";
import { Check } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { formatAyahs, formatJuz, formatNumber, formatSurahs } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { matchesSurahQuery, surahTransliteration } from "@/lib/search/surah-match";

export type SurahChoice = Readonly<{ number: number; name_arabic: string; name_english: string; ayah_count: number }>;

type Props = {
  surahs: readonly SurahChoice[];
  selectedSurahs: ReadonlySet<number>;
  selectedJuz: ReadonlySet<number>;
  onToggleSurah: (surah: number) => void;
  /** Selects or clears these surahs together, leaving every other selection as it is. */
  onSetSurahs: (surahs: readonly number[], selected: boolean) => void;
  onToggleJuz: (juz: number) => void;
  /** The local surah query: loading, loaded, or failed with a Retry. */
  loadState: "loading" | "ready" | "error";
  onRetryLoad: () => void;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
};

/** Juz 30 and 29 get their own labelled row because most people memorize them first. */
const MOST_COMMON_JUZ = [30, 29] as const;
const OTHER_JUZ = Array.from({ length: 28 }, (_, i) => i + 1);
/** Four even columns: 1 to 28 fill seven full rows, and the first row keeps the same column width. */
const JUZ_COLUMNS = 4;

/** How many names the summary lists before "+N". */
const SUMMARY_NAMES = 6;

/** The memorized portion (5.1 step 3): whole juz, or single surahs. */
export function MemorizedPortionPicker({
  surahs,
  selectedSurahs,
  selectedJuz,
  onToggleSurah,
  onSetSurahs,
  onToggleJuz,
  loadState,
  onRetryLoad,
  language,
  isDark,
  s,
}: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const [by, setBy] = useState<"juz" | "surah">("juz");
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const filtered = useMemo(() => (searching ? surahs.filter((surah) => matchesSurahQuery(surah, query)) : surahs), [query, searching, surahs]);
  const allResultsSelected = filtered.length > 0 && filtered.every((surah) => selectedSurahs.has(surah.number));
  const surahName = (surah: SurahChoice) =>
    language === "ar" ? surah.name_arabic : (surahTransliteration(surah.number) ?? surah.name_english);
  // The summary names what is chosen, juz first, in the interface's digits and plural forms.
  const selectedNames = [
    ...[...selectedJuz].sort((a, b) => a - b).map((juz) => interpolate(s.hifzJuzN, { n: formatNumber(juz, language) })),
    ...surahs.filter((surah) => selectedSurahs.has(surah.number)).map(surahName),
  ];
  const listSeparator = language === "ar" ? "، " : ", ";
  const namesLine =
    selectedNames.length > SUMMARY_NAMES
      ? `${selectedNames.slice(0, SUMMARY_NAMES).join(listSeparator)}${listSeparator}+${formatNumber(selectedNames.length - SUMMARY_NAMES, language)}`
      : selectedNames.join(listSeparator);
  // Teal text under 14 px uses the darker token in light mode.
  const accentText = isDark ? "#2dd4bf" : "#0f766e";
  const juzChip = (juz: number) => {
    const selected = selectedJuz.has(juz);
    return (
      <Pressable
        key={juz}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={interpolate(s.hifzJuzN, { n: formatNumber(juz, language) })}
        onPress={() => onToggleJuz(juz)}
        style={{ flexBasis: "22%", flexGrow: 1 }}
        className={`min-h-[44px] items-center justify-center rounded-2xl px-2 ${selected ? "bg-primary-accent/15 dark:bg-primary-bright/15" : "bg-surface-low dark:bg-surface-dark-low"}`}
      >
        <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className={selected ? "text-primary-muted dark:text-primary-bright" : "text-charcoal dark:text-neutral-200"}>
          {formatNumber(juz, language)}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={{ gap: 12 }}>
      <ToggleGroup<"juz" | "surah">
        dir={dir}
        value={by}
        onValueChange={setBy}
        items={[
          { value: "juz", label: s.hifzByJuz },
          { value: "surah", label: s.hifzBySurah },
        ]}
      />
      {by === "juz" ? (
        <View style={{ gap: 8 }}>
          <Text dir={dir} variant="label-md" className="text-warm-600 dark:text-neutral-400" style={{ fontSize: 13 }}>
            {s.hifzJuzMostCommon}
          </Text>
          <MirroredRow dir={dir} className="gap-2">
            {MOST_COMMON_JUZ.map(juzChip)}
            {/* Empty slots keep the two chips at the grid's column width. */}
            {Array.from({ length: JUZ_COLUMNS - MOST_COMMON_JUZ.length }, (_, i) => (
              <View key={`slot-${i}`} style={{ flexBasis: "22%", flexGrow: 1 }} />
            ))}
          </MirroredRow>
          <MirroredRow dir={dir} className="mt-2 flex-wrap gap-2">
            {OTHER_JUZ.map(juzChip)}
          </MirroredRow>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={s.setupSurahSearchPlaceholder}
            accessibilityLabel={s.setupSurahSearchPlaceholder}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
            dir={dir}
            className="min-h-11 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 text-charcoal dark:text-neutral-100"
          />
          {loadState === "loading" && surahs.length === 0 ? (
            <Text dir={dir} variant="muted" accessibilityLiveRegion="polite">
              {s.setupSurahsLoading}
            </Text>
          ) : null}
          {loadState === "error" && surahs.length === 0 ? (
            <MirroredRow dir={dir} className="items-center justify-between gap-3 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-2">
              <Text dir={dir} accessibilityRole="alert" className="flex-1 text-red-700 dark:text-red-400" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                {s.setupSurahsLoadFailed}
              </Text>
              <Button variant="outline" size="sm" dir={dir} label={s.setupRetry} onPress={onRetryLoad} className="h-11 border border-warm-300 dark:border-neutral-700" />
            </MirroredRow>
          ) : null}
          {searching && filtered.length > 0 ? (
            // A filtered bulk action changes only the matching surahs; earlier choices stay.
            <MirroredRow dir={dir} className="justify-end">
              <Button
                variant="ghost"
                size="sm"
                dir={dir}
                label={allResultsSelected ? s.setupClearResults : s.setupSelectResults}
                onPress={() => onSetSurahs(filtered.map((surah) => surah.number), !allResultsSelected)}
                className="h-11"
              />
            </MirroredRow>
          ) : null}
          {searching && loadState === "ready" && filtered.length === 0 ? (
            <View className="items-center gap-2 py-4">
              <Text dir={dir} variant="muted" align="center">
                {interpolate(s.setupNoSurahMatches, { query: query.trim() })}
              </Text>
              <Button variant="outline" size="sm" dir={dir} label={s.homeSearchClear} onPress={() => setQuery("")} className="h-11 border border-warm-300 dark:border-neutral-700" />
            </View>
          ) : null}
          {filtered.map((surah) => {
            const selected = selectedSurahs.has(surah.number);
            return (
              <Pressable
                key={surah.number}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={() => onToggleSurah(surah.number)}
                className="min-h-[48px] justify-center rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-2"
              >
                <MirroredRow dir={dir} className="items-center justify-between gap-3">
                  <View className="flex-1">
                    <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="text-charcoal dark:text-neutral-200">
                      {`${formatNumber(surah.number, language)}. ${surahName(surah)}`}
                    </Text>
                    <Text dir={dir} variant="caption" className="text-warm-600 dark:text-neutral-400">
                      {formatAyahs(surah.ayah_count, language)}
                    </Text>
                  </View>
                  <View
                    className={`h-6 w-6 items-center justify-center rounded-full ${selected ? "bg-primary-accent dark:bg-primary-bright" : "border border-warm-300 dark:border-neutral-600"}`}
                  >
                    {selected ? <Check size={14} color={isDark ? "#0a0a0a" : "#ffffff"} /> : null}
                  </View>
                </MirroredRow>
              </Pressable>
            );
          })}
        </View>
      )}
      <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
        <Text dir={dir} variant="caption" style={{ color: accentText }}>
          {selectedJuz.size + selectedSurahs.size === 0
            ? s.hifzMemorizedNone
            : // An Arabic comma in Arabic: beside Arabic-Indic digits a middle dot reads as a zero.
              [
                selectedJuz.size > 0 ? formatJuz(selectedJuz.size, language) : null,
                selectedSurahs.size > 0 ? formatSurahs(selectedSurahs.size, language) : null,
              ]
                .filter(Boolean)
                .join(language === "ar" ? "، " : " · ")}
        </Text>
        {namesLine ? (
          <Text dir={dir} variant="caption" className="text-warm-600 dark:text-neutral-400">
            {namesLine}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
