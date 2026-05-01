import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import {
  fetchWordIrabDaasForAyah,
  fetchWordText,
  findBestWordMatch,
  type WordIrabDaasRow,
} from "@/lib/word/queries";
import { useStrings } from "@/lib/i18n/useStrings";

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

export function IrabTab({ surah, ayah, wordPos }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const [rows, setRows] = useState<WordIrabDaasRow[]>([]);
  const [matchIdx, setMatchIdx] = useState<number>(-1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchWordIrabDaasForAyah(db, surah, ayah),
      fetchWordText(db, surah, ayah, wordPos),
    ])
      .then(([r, tappedText]) => {
        setRows(r);
        setMatchIdx(findBestWordMatch(r, wordPos, tappedText ?? ""));
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
      {rows.map((row, idx) => {
        const isMatch = matchIdx !== -1 && idx === matchIdx;
        return (
          <View
            key={`${row.surah}-${row.ayah}-${row.word_pos}`}
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
      <Text
        className="text-xs text-warm-400 dark:text-neutral-500 mt-2"
        style={{ writingDirection: "rtl", textAlign: "right" }}
      >
        {s.irabSourceAttribution}
      </Text>
    </View>
  );
}
