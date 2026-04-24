import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import {
  fetchWordTajweed,
  fetchTextUthmani,
  fetchTajweedRuleAr,
  fetchTajweedRuleEn,
  type TajweedRow,
} from "@/lib/word/queries";
import { mapTajweedToWord } from "@/lib/word/tajweed-mapping";
import { getTajweedRule } from "@/lib/word/tajweed-labels";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

type ResolvedArRule = {
  ruleId: string;
  color: string;
  nameAr: string;
  shortAr: string;
  descriptionAr: string;
};

type ResolvedEnRule = {
  ruleId: string;
  color: string;
  name: string;
  short: string;
  description: string;
};

export function TajweedTab({ surah, ayah, wordPos }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { uiLanguage } = useSettings();
  const isArabicMode = uiLanguage === "ar";

  const [arRules, setArRules] = useState<ResolvedArRule[]>([]);
  const [enRules, setEnRules] = useState<ResolvedEnRule[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setExpanded({});
    (async () => {
      const [annotations, textUthmani] = await Promise.all([
        fetchWordTajweed(db, surah, ayah),
        fetchTextUthmani(db, surah, ayah),
      ]);
      if (!textUthmani || annotations.length === 0) {
        setArRules([]);
        setEnRules([]);
        setLoading(false);
        return;
      }
      const wordRules = mapTajweedToWord(textUthmani, annotations, wordPos);
      const seen = new Set<string>();
      const uniqueKeys: string[] = [];
      for (const r of wordRules) {
        if (!seen.has(r.rule)) {
          seen.add(r.rule);
          uniqueKeys.push(r.rule);
        }
      }

      if (isArabicMode) {
        const fetched = await Promise.all(
          uniqueKeys.map((k) => fetchTajweedRuleAr(db, k))
        );
        const resolved: ResolvedArRule[] = uniqueKeys.map((key, i) => {
          const row = fetched[i];
          const fallback = getTajweedRule(key);
          return {
            ruleId: key,
            color: fallback.color,
            nameAr: row?.name_ar ?? fallback.arabic,
            shortAr: row?.short_ar ?? "",
            descriptionAr: row?.description_ar ?? fallback.description,
          };
        });
        setArRules(resolved);
        setEnRules([]);
      } else {
        const fetched = await Promise.all(
          uniqueKeys.map((k) => fetchTajweedRuleEn(db, k))
        );
        const resolved: ResolvedEnRule[] = uniqueKeys.map((key, i) => {
          const row = fetched[i];
          const fallback = getTajweedRule(key);
          return {
            ruleId: key,
            color: fallback.color,
            name: row?.name ?? fallback.english,
            short: row?.short ?? "",
            description: row?.description ?? fallback.description,
          };
        });
        setArRules([]);
        setEnRules(resolved);
      }
      setLoading(false);
    })();
  }, [db, surah, ayah, wordPos, isArabicMode]);

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  if (loading) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">{s.loading}</Text>
      </View>
    );
  }

  const rules = isArabicMode ? arRules : enRules;
  if (rules.length === 0) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">
          {s.noTajweedRules}
        </Text>
      </View>
    );
  }

  return (
    <View className="py-4 px-1">
      {isArabicMode
        ? arRules.map((rule) => {
            const isOpen = !!expanded[rule.ruleId];
            return (
              <Pressable
                key={rule.ruleId}
                onPress={() => toggle(rule.ruleId)}
                className="mb-3 p-3 rounded-2xl bg-surface-high dark:bg-surface-dark-high"
              >
                <View
                  className="flex-row items-center gap-2 mb-1"
                  style={{ flexDirection: "row-reverse" }}
                >
                  <View
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: rule.color,
                    }}
                  />
                  <Text
                    className="text-base font-semibold text-charcoal dark:text-neutral-100"
                    style={{ writingDirection: "rtl" }}
                  >
                    {rule.nameAr}
                  </Text>
                </View>
                {rule.shortAr ? (
                  <Text
                    className="text-sm text-warm-500 dark:text-neutral-400 leading-6"
                    style={{ writingDirection: "rtl", textAlign: "right" }}
                  >
                    {rule.shortAr}
                  </Text>
                ) : null}
                {isOpen && rule.descriptionAr ? (
                  <Text
                    className="text-sm text-charcoal dark:text-neutral-200 leading-7 mt-2"
                    style={{ writingDirection: "rtl", textAlign: "right" }}
                  >
                    {rule.descriptionAr}
                  </Text>
                ) : null}
                {!isOpen && rule.descriptionAr ? (
                  <Text
                    className="text-xs text-primary-accent dark:text-primary-bright mt-1.5"
                    style={{ writingDirection: "rtl", textAlign: "right" }}
                  >
                    {s.tapToExpand}
                  </Text>
                ) : null}
              </Pressable>
            );
          })
        : enRules.map((rule) => {
            const isOpen = !!expanded[rule.ruleId];
            return (
              <Pressable
                key={rule.ruleId}
                onPress={() => toggle(rule.ruleId)}
                className="mb-3 p-3 rounded-2xl bg-surface-high dark:bg-surface-dark-high"
              >
                <View className="flex-row items-center gap-2 mb-1">
                  <View
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: rule.color,
                    }}
                  />
                  <Text className="text-base font-semibold text-charcoal dark:text-neutral-100">
                    {rule.name}
                  </Text>
                </View>
                {rule.short ? (
                  <Text className="text-sm text-warm-500 dark:text-neutral-400 leading-5">
                    {rule.short}
                  </Text>
                ) : null}
                {isOpen && rule.description ? (
                  <Text className="text-sm text-charcoal dark:text-neutral-200 leading-6 mt-2">
                    {rule.description}
                  </Text>
                ) : null}
                {!isOpen && rule.description ? (
                  <Text className="text-xs text-primary-accent dark:text-primary-bright mt-1.5">
                    {s.tapToExpand}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
    </View>
  );
}
