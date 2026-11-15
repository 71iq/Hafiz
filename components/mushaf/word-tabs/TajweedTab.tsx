import { useEffect, useState } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import {
  fetchWordTajweed,
  fetchTextUthmani,
  fetchTajweedRuleAr,
  fetchTajweedRuleEn,
} from "@/lib/word/queries";
import { mapTajweedToWord } from "@/lib/word/tajweed-mapping";
import { getTajweedRule } from "@/lib/word/tajweed-labels";
import { useDelayedLoading } from "./use-delayed-loading";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

type ResolvedRule = {
  ruleId: string;
  color: string;
  name: string;
  /** The Arabic term, shown under the English name in the English interface. */
  arabicTerm: string | null;
  short: string;
  description: string;
};

type Loaded = { key: string; rules: ResolvedRule[] } | { key: string; failed: true };

export function TajweedTab({ surah, ayah, wordPos }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { uiLanguage, effectiveTheme, isRTL } = useSettings();
  const isArabicMode = uiLanguage === "ar";
  // Web draws the active page palette; native keeps the Classic colours its fallback font uses.
  const tajweedColorTheme = Platform.OS === "web" ? effectiveTheme : "white";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${surah}:${ayah}:${wordPos}:${isArabicMode ? "ar" : "en"}:${tajweedColorTheme}:${attempt}`;
  const current = loaded?.key === key ? loaded : null;
  const showLoading = useDelayedLoading(current === null);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<ResolvedRule[]> => {
      const [annotations, textUthmani] = await Promise.all([
        fetchWordTajweed(db, surah, ayah),
        fetchTextUthmani(db, surah, ayah),
      ]);
      if (!textUthmani || annotations.length === 0) return [];
      const wordRules = mapTajweedToWord(textUthmani, annotations, wordPos);
      const uniqueKeys = [...new Set(wordRules.map((rule) => rule.rule))];
      if (isArabicMode) {
        const fetched = await Promise.all(uniqueKeys.map((k) => fetchTajweedRuleAr(db, k)));
        return uniqueKeys.map((ruleKey, i) => {
          const row = fetched[i];
          const fallback = getTajweedRule(ruleKey, tajweedColorTheme);
          return {
            ruleId: ruleKey,
            color: fallback.color,
            name: row?.name_ar ?? fallback.arabic,
            arabicTerm: null,
            short: row?.short_ar ?? "",
            description: row?.description_ar ?? fallback.description,
          };
        });
      }
      const fetched = await Promise.all(uniqueKeys.map((k) => fetchTajweedRuleEn(db, k)));
      return uniqueKeys.map((ruleKey, i) => {
        const row = fetched[i];
        const fallback = getTajweedRule(ruleKey, tajweedColorTheme);
        return {
          ruleId: ruleKey,
          color: fallback.color,
          name: row?.name ?? fallback.english,
          arabicTerm: row?.name_ar?.trim() || fallback.arabic || null,
          short: row?.short ?? "",
          description: row?.description ?? fallback.description,
        };
      });
    })().then(
      (rules) => {
        if (!cancelled) setLoaded({ key, rules });
      },
      (error) => {
        console.warn("[TajweedTab] Failed to load tajweed:", error);
        if (!cancelled) setLoaded({ key, failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, surah, ayah, wordPos, isArabicMode, tajweedColorTheme, key]);

  if (!current) {
    return (
      <View className="py-6 items-center">
        {showLoading ? <Text className="text-warm-500 dark:text-neutral-400 text-sm">{s.loading}</Text> : null}
      </View>
    );
  }

  if ("failed" in current) {
    return (
      <View className="py-6 items-center gap-3">
        <Text className="text-red-600 dark:text-red-400 text-sm" style={{ writingDirection: isRTL ? "rtl" : "ltr" }}>
          {s.genericActionFailed}
        </Text>
        <Pressable
          onPress={() => setAttempt((value) => value + 1)}
          accessibilityRole="button"
          className="min-h-[44px] justify-center rounded-full bg-surface-low px-4 dark:bg-surface-dark-low"
        >
          <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
            {s.detailRetry}
          </Text>
        </Pressable>
      </View>
    );
  }

  // Missing annotations say only that none are recorded, never that no rule applies.
  if (current.rules.length === 0) {
    return (
      <View className="py-6 items-center">
        <Text
          className="text-warm-500 dark:text-neutral-400 text-sm text-center"
          style={{ writingDirection: isRTL ? "rtl" : "ltr" }}
        >
          {s.noTajweedRules}
        </Text>
      </View>
    );
  }

  return (
    <View className="py-4 px-1">
      {current.rules.map((rule) => (
        <View key={rule.ruleId} className="mb-3 p-3 rounded-2xl bg-surface-high dark:bg-surface-dark-high">
          <View
            className="items-center gap-2 mb-1"
            style={{ direction: "ltr", flexDirection: isArabicMode ? "row-reverse" : "row" }}
          >
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: rule.color }} />
            <Text
              className="text-base font-semibold text-charcoal dark:text-neutral-100"
              style={{ writingDirection: isArabicMode ? "rtl" : "ltr" }}
            >
              {rule.name}
            </Text>
          </View>
          {rule.arabicTerm ? (
            <Text
              className="mb-1 text-sm text-warm-600 dark:text-neutral-300"
              style={{ writingDirection: "rtl", textAlign: "left" }}
            >
              {rule.arabicTerm}
            </Text>
          ) : null}
          {rule.short ? (
            <Text
              className="text-sm text-warm-600 dark:text-neutral-400 leading-6"
              style={{ writingDirection: isArabicMode ? "rtl" : "ltr", textAlign: isArabicMode ? "right" : "left" }}
            >
              {rule.short}
            </Text>
          ) : null}
          {rule.description ? (
            <Text
              className="text-sm text-charcoal dark:text-neutral-200 leading-7 mt-2"
              style={{ writingDirection: isArabicMode ? "rtl" : "ltr", textAlign: isArabicMode ? "right" : "left" }}
            >
              {rule.description}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
