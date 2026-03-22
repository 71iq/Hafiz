import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { fetchWordTajweed, fetchTextUthmani, type TajweedRow } from "@/lib/word/queries";
import { mapTajweedToWord } from "@/lib/word/tajweed-mapping";
import { getTajweedRule, type TajweedRuleInfo } from "@/lib/word/tajweed-labels";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

type ResolvedRule = TajweedRuleInfo & { ruleId: string };

export function TajweedTab({ surah, ayah, wordPos }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const [rules, setRules] = useState<ResolvedRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchWordTajweed(db, surah, ayah),
      fetchTextUthmani(db, surah, ayah),
    ])
      .then(([annotations, textUthmani]) => {
        if (!textUthmani || annotations.length === 0) {
          setRules([]);
          return;
        }
        const wordRules = mapTajweedToWord(textUthmani, annotations, wordPos);
        const resolved = wordRules.map((r) => ({
          ruleId: r.rule,
          ...getTajweedRule(r.rule),
        }));
        // Deduplicate by ruleId
        const seen = new Set<string>();
        const unique = resolved.filter((r) => {
          if (seen.has(r.ruleId)) return false;
          seen.add(r.ruleId);
          return true;
        });
        setRules(unique);
      })
      .finally(() => setLoading(false));
  }, [db, surah, ayah, wordPos]);

  if (loading) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">{s.loading}</Text>
      </View>
    );
  }

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
      {rules.map((rule) => (
        <View
          key={rule.ruleId}
          className="mb-4 pb-4"
        >
          <View className="flex-row items-center gap-2 mb-2">
            <View
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: rule.color,
              }}
            />
            <Text className="text-base font-semibold text-charcoal dark:text-neutral-100">
              {rule.english}
            </Text>
          </View>
          <Text
            className="text-lg text-charcoal dark:text-neutral-200 mb-1.5"
            style={{ writingDirection: "rtl", textAlign: "right" }}
          >
            {rule.arabic}
          </Text>
          {rule.description ? (
            <Text className="text-sm text-warm-500 dark:text-neutral-400 leading-5">
              {rule.description}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
