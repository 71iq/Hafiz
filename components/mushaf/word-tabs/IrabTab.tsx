import { useEffect, useState } from "react";
import { View, Text, type LayoutChangeEvent } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import {
  fetchWordIrabDaasForAyah,
  type WordIrabDaasRow,
} from "@/lib/word/queries";
import { useStrings } from "@/lib/i18n/useStrings";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
  onScrollToMatch?: (y: number) => void;
};

export function IrabTab({ surah, ayah, wordPos, onScrollToMatch }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const [rows, setRows] = useState<WordIrabDaasRow[]>([]);
  const [matchY, setMatchY] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setMatchY(null);
    fetchWordIrabDaasForAyah(db, surah, ayah)
      .then(setRows)
      .finally(() => setLoading(false));
  }, [db, surah, ayah, wordPos]);

  useEffect(() => {
    if (loading || matchY == null) return;
    const frame = requestAnimationFrame(() => onScrollToMatch?.(Math.max(0, matchY - 12)));
    return () => cancelAnimationFrame(frame);
  }, [loading, matchY, onScrollToMatch]);

  const handleMatchLayout = (event: LayoutChangeEvent) => {
    setMatchY(event.nativeEvent.layout.y);
  };

  if (loading) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">{s.loading}</Text>
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View className="py-6 items-center">
        <Text
          className="text-warm-400 dark:text-neutral-500 text-sm"
          style={{ writingDirection: "rtl" }}
        >
          {s.noDaasIrab}
        </Text>
      </View>
    );
  }

  return (
    <View className="py-4 px-1">
      {rows.map((row) => {
        const isMatch = row.word_pos === wordPos;
        return (
          <View
            key={`${row.surah}-${row.ayah}-${row.word_pos}`}
            onLayout={isMatch ? handleMatchLayout : undefined}
            className={`mb-3 p-3 rounded-2xl ${
              isMatch
                ? "bg-primary-accent/10 dark:bg-primary-bright/10"
                : "bg-surface-high dark:bg-surface-dark-high"
            }`}
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
