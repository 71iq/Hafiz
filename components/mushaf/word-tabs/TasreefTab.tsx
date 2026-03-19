import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { fetchWordIrab, fetchWordRoot, type WordIrabRow, type WordRootRow } from "@/lib/word/queries";
import { decodeLabel, getVerbFormName } from "@/lib/word/morphology-labels";
import { useStrings } from "@/lib/i18n/useStrings";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between py-2.5 border-b border-warm-50 dark:border-neutral-800/50">
      <Text className="text-sm text-warm-400 dark:text-neutral-500 w-28">
        {label}
      </Text>
      <Text
        className="text-base text-warm-800 dark:text-neutral-100 flex-1 text-right"
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
    <View className="py-4 px-1">
      {root && <InfoRow label={s.rootLabel} value={root} />}
      {lemma && <InfoRow label={s.lemmaLabel} value={lemma} />}
      {pattern && (
        <InfoRow
          label={s.patternLabel}
          value={getVerbFormName(pattern) ?? pattern}
        />
      )}
    </View>
  );
}
