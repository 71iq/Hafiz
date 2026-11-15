import { useEffect, useState } from "react";
import { View, Text, type LayoutChangeEvent } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import {
  fetchWordIrabDaasForAyah,
  type WordIrabDaasRow,
} from "@/lib/word/queries";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { textStartStyle } from "@/lib/ui/direction";
import { useDelayedLoading } from "./use-delayed-loading";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
  onScrollToMatch?: (y: number) => void;
};

export function IrabTab({ surah, ayah, wordPos, onScrollToMatch }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { uiLanguage } = useSettings();
  const [rows, setRows] = useState<WordIrabDaasRow[]>([]);
  const [matchY, setMatchY] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const showLoading = useDelayedLoading(loading);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMatchY(null);
    fetchWordIrabDaasForAyah(db, surah, ayah)
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch((error) => console.warn("[IrabTab] Failed to load i'rab:", error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [db, surah, ayah, wordPos]);

  useEffect(() => {
    if (loading || matchY == null) return;
    const frame = requestAnimationFrame(() => onScrollToMatch?.(Math.max(0, matchY - 12)));
    return () => cancelAnimationFrame(frame);
  }, [loading, matchY, onScrollToMatch]);

  const handleMatchLayout = (event: LayoutChangeEvent) => {
    setMatchY(event.nativeEvent.layout.y);
  };

  // A phrase such as "على الناس" is stored once per word with the same text and analysis; show it once
  // and treat it as the tapped word's entry when any of its words is the one tapped.
  const groupedRows = rows.reduce<{ row: WordIrabDaasRow; wordPositions: number[] }[]>((groups, row) => {
    const previous = groups[groups.length - 1];
    if (previous && previous.row.word === row.word && previous.row.irab === row.irab) {
      previous.wordPositions.push(row.word_pos);
    } else {
      groups.push({ row, wordPositions: [row.word_pos] });
    }
    return groups;
  }, []);

  if (loading) {
    return (
      <View className="py-6 items-center">
        {showLoading ? <Text className="text-warm-500 dark:text-neutral-400 text-sm">{s.loading}</Text> : null}
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View className="py-6 items-center">
        <Text
          className="text-warm-500 dark:text-neutral-400 text-sm"
          style={{ writingDirection: "rtl" }}
        >
          {s.noDaasIrab}
        </Text>
      </View>
    );
  }

  return (
    <View className="py-4 px-1">
      {uiLanguage !== "ar" ? (
        <Text
          className="mb-3 text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 20, ...textStartStyle(false), writingDirection: "ltr" }}
        >
          {s.irabArabicOnly}
        </Text>
      ) : null}
      {groupedRows.map(({ row, wordPositions }) => {
        const isMatch = wordPositions.includes(wordPos);
        return (
          <View
            key={`${row.surah}-${row.ayah}-${row.word_pos}`}
            onLayout={isMatch ? handleMatchLayout : undefined}
            className={`mb-3 p-3 rounded-2xl ${
              isMatch
                ? "border-r-[3px] border-primary-accent bg-primary-accent/10 dark:border-primary-bright dark:bg-primary-bright/10"
                : "bg-surface-high dark:bg-surface-dark-high"
            }`}
            // The accent sits where the Arabic analysis starts reading, on the right in both interfaces.
          >
            {row.word && (
              <Text
                className={`text-xl mb-1.5 font-semibold ${
                  isMatch
                    ? "text-primary-accent dark:text-primary-bright"
                    : "text-charcoal dark:text-neutral-100"
                }`}
                style={{ writingDirection: "rtl", textAlign: "right" }}
              >
                {row.word}
              </Text>
            )}
            {row.irab && (
              <Text
                className="text-base text-charcoal dark:text-neutral-200 leading-7"
                style={{
                  writingDirection: "rtl",
                  textAlign: "right",
                  fontFamily: "IBMPlexSansArabic, NotoSansArabic, system-ui",
                }}
              >
                {row.irab}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
