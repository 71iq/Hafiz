import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Check } from "lucide-react-native";
import { Input } from "@/components/ui/Input";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { formatNumber } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { matchesSurahQuery } from "@/lib/search/surah-match";

export type SurahChoice = Readonly<{ number: number; name_arabic: string; name_english: string; ayah_count: number }>;

type Props = {
  surahs: readonly SurahChoice[];
  selectedSurahs: ReadonlySet<number>;
  selectedJuz: ReadonlySet<number>;
  onToggleSurah: (surah: number) => void;
  onToggleJuz: (juz: number) => void;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
};

/**
 * The memorized portion (5.1 step 3): whole juz, or single surahs. Juz 30 and 29 come first because
 * most people memorize them first.
 */
export function MemorizedPortionPicker({ surahs, selectedSurahs, selectedJuz, onToggleSurah, onToggleJuz, language, isDark, s }: Props) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const [by, setBy] = useState<"juz" | "surah">("juz");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => (query.trim() ? surahs.filter((surah) => matchesSurahQuery(surah, query)) : surahs), [query, surahs]);
  const juzOrder = useMemo(() => [30, 29, ...Array.from({ length: 28 }, (_, i) => i + 1)], []);
  const accent = isDark ? "#2dd4bf" : "#0d9488";

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
        <MirroredRow dir={dir} className="flex-wrap gap-2">
          {juzOrder.map((juz) => {
            const selected = selectedJuz.has(juz);
            return (
              <Pressable
                key={juz}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={interpolate(s.hifzJuzN, { n: juz })}
                onPress={() => onToggleJuz(juz)}
                className={`min-h-[44px] min-w-[64px] items-center justify-center rounded-2xl px-3 ${selected ? "bg-primary-accent/15 dark:bg-primary-bright/15" : "bg-surface-low dark:bg-surface-dark-low"}`}
              >
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }} className={selected ? "text-primary-accent dark:text-primary-bright" : "text-charcoal dark:text-neutral-200"}>
                  {formatNumber(juz, language)}
                </Text>
              </Pressable>
            );
          })}
        </MirroredRow>
      ) : (
        <View style={{ gap: 8 }}>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={s.onboardingSearchSurahs}
            dir={dir}
            className="min-h-11 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 text-charcoal dark:text-neutral-100"
          />
          {filtered.map((surah) => {
            const selected = selectedSurahs.has(surah.number);
            return (
              <Pressable
                key={surah.number}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={() => onToggleSurah(surah.number)}
                className="min-h-[48px] justify-center rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4"
              >
                <MirroredRow dir={dir} className="items-center justify-between gap-3">
                  <Text dir={dir} style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }} className="flex-1 text-charcoal dark:text-neutral-200">
                    {`${formatNumber(surah.number, language)}. ${language === "ar" ? surah.name_arabic : surah.name_english}`}
                  </Text>
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
      <Text dir={dir} variant="caption" style={{ color: accent }}>
        {selectedJuz.size + selectedSurahs.size === 0
          ? s.hifzMemorizedNone
          : `${interpolate(s.hifzSelectedJuz, { n: formatNumber(selectedJuz.size, language) })} · ${interpolate(s.hifzSelectedSurahs, { n: formatNumber(selectedSurahs.size, language) })}`}
      </Text>
    </View>
  );
}
