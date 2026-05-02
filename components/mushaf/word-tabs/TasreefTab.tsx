import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { fetchWordIrab, fetchWordRoot, type WordIrabRow, type WordRootRow } from "@/lib/word/queries";
import { decodeLabel, getVerbFormName } from "@/lib/word/morphology-labels";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

function InfoRow({ label, value, isRTL }: { label: string; value: string; isRTL: boolean }) {
  return (
    <View className={`${isRTL ? "flex-row-reverse" : "flex-row"} items-start py-2 mb-1.5`}>
      <Text className={`text-sm text-warm-400 dark:text-neutral-500 ${isRTL ? "w-24 text-right" : "w-28"}`}>
        {label}
      </Text>
      <Text
        className={`text-base text-charcoal dark:text-neutral-100 flex-1 text-right ${isRTL ? "pr-3" : ""}`}
        style={{ writingDirection: "rtl" }}
      >
        {value}
      </Text>
    </View>
  );
}

export function TasreefTab({ surah, ayah, wordPos }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isRTL } = useSettings();
  const [irab, setIrab] = useState<WordIrabRow | null>(null);
  const [rootData, setRootData] = useState<WordRootRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchWordIrab(db, surah, ayah, wordPos),
      fetchWordRoot(db, surah, ayah, wordPos),
    ])
      .then(([i, r]) => {
        setIrab(i);
        setRootData(r);
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

  const root = irab?.root ?? rootData?.root;
  const lemma = irab?.lemma ?? rootData?.lemma;
  const pattern = irab?.pattern;

  if (!root && !lemma && !pattern) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">
          {s.noTasreefData}
        </Text>
      </View>
    );
  }

  return (
    <View className="pt-2 pb-1 px-0">
      {root && <InfoRow label={s.rootLabel} value={root} isRTL={isRTL} />}
      {lemma && <InfoRow label={s.lemmaLabel} value={lemma} isRTL={isRTL} />}
      {pattern && (
        <InfoRow
          label={s.patternLabel}
          value={getVerbFormName(pattern) ?? pattern}
          isRTL={isRTL}
        />
      )}
    </View>
  );
}
