import { useEffect, useState } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { fetchWordIrab, fetchWordRoot, type WordIrabRow, type WordRootRow } from "@/lib/word/queries";
import { getVerbFormName } from "@/lib/word/morphology-labels";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { useDelayedLoading } from "./use-delayed-loading";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
  /** Opens the Occurrences tab for this word's root. */
  onRootPress?: () => void;
};

function InfoRow({
  label,
  value,
  isRTL,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  isRTL: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const valueText = (
    <Text
      className={`text-right text-base ${onPress ? "text-primary-muted dark:text-primary-bright underline" : "text-charcoal dark:text-neutral-100"}`}
      style={{ writingDirection: "rtl" }}
    >
      {value}
    </Text>
  );
  return (
    <View
      className="mb-1.5 items-start gap-3 py-2"
      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      <Text
        className={`text-sm text-warm-500 dark:text-neutral-400 ${isRTL ? "w-24 text-right" : "w-28 text-left"}`}
        style={{ writingDirection: isRTL ? "rtl" : "ltr" }}
      >
        {label}
      </Text>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="link"
          accessibilityLabel={accessibilityLabel}
          className="flex-1 items-end justify-center"
          style={{ minHeight: 44, marginVertical: -10, cursor: Platform.OS === "web" ? "pointer" : undefined }}
        >
          {valueText}
        </Pressable>
      ) : (
        <View className="flex-1">{valueText}</View>
      )}
    </View>
  );
}

export function TasreefTab({ surah, ayah, wordPos, onRootPress }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isRTL } = useSettings();
  const [irab, setIrab] = useState<WordIrabRow | null>(null);
  const [rootData, setRootData] = useState<WordRootRow | null>(null);
  const [loading, setLoading] = useState(true);
  const showLoading = useDelayedLoading(loading);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchWordIrab(db, surah, ayah, wordPos),
      fetchWordRoot(db, surah, ayah, wordPos),
    ])
      .then(([i, r]) => {
        if (cancelled) return;
        setIrab(i);
        setRootData(r);
      })
      .catch((error) => console.warn("[TasreefTab] Failed to load morphology:", error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [db, surah, ayah, wordPos]);

  if (loading) {
    return (
      <View className="py-6 items-center">
        {showLoading ? <Text className="text-warm-500 dark:text-neutral-400 text-sm">{s.loading}</Text> : null}
      </View>
    );
  }

  const root = (irab?.root ?? rootData?.root)?.trim() || null;
  const lemma = (irab?.lemma ?? rootData?.lemma)?.trim() || null;
  const pattern = irab?.pattern?.trim() || null;

  const hasVisibleData = !!root || !!lemma || !!pattern;

  if (!hasVisibleData) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-500 dark:text-neutral-400 text-sm">
          {s.noTasreefData}
        </Text>
      </View>
    );
  }

  return (
    <View className="pt-2 pb-1 px-0">
      {root && (
        <InfoRow
          label={s.rootLabel}
          value={root}
          isRTL={isRTL}
          onPress={onRootPress}
          accessibilityLabel={s.wordRootOpenOccurrences?.replace("{{root}}", root)}
        />
      )}
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
