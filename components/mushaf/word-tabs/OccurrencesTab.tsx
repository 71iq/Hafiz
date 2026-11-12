import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Button } from "@/components/ui/Button";
import { useDatabase } from "@/lib/database/provider";
import { useWordInteraction } from "@/lib/word/context";
import {
  countRootOccurrences,
  fetchWordRoot,
  fetchRootOccurrences,
  type RootOccurrence,
} from "@/lib/word/queries";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { formatAyahRef } from "@/lib/arabic";

// Common roots occur thousands of times, so rows load a page at a time.
const OCCURRENCES_PAGE = 50;

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

type Loaded = { key: string; root: string | null; total: number; rows: RootOccurrence[] };

export function OccurrencesTab({ surah, ayah, wordPos }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isRTL } = useSettings();
  const { navigateToAyah } = useWordInteraction();
  const wordKey = `${surah}:${ayah}:${wordPos}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rootRow = await fetchWordRoot(db, surah, ayah, wordPos);
      const root = rootRow?.root ?? null;
      if (!root) return { root: null, total: 0, rows: [] };
      const [total, rows] = await Promise.all([
        countRootOccurrences(db, root),
        fetchRootOccurrences(db, root, OCCURRENCES_PAGE),
      ]);
      return { root, total, rows };
    })().then(
      (result) => {
        if (!cancelled) setLoaded({ key: wordKey, ...result });
      },
      (error) => {
        console.warn("[OccurrencesTab] Failed to load occurrences:", error);
        if (!cancelled) setFailedKey(wordKey);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, surah, ayah, wordPos, wordKey]);

  const current = loaded?.key === wordKey ? loaded : null;
  const loading = !current && failedKey !== wordKey;
  const root = current?.root ?? null;
  const occurrences = current?.rows ?? [];
  const remaining = current ? current.total - current.rows.length : 0;

  const showMore = useCallback(async () => {
    if (!current?.root || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchRootOccurrences(db, current.root, OCCURRENCES_PAGE, current.rows.length);
      setLoaded((prev) =>
        prev === current ? { ...prev, rows: [...prev.rows, ...next] } : prev,
      );
    } catch (error) {
      console.warn("[OccurrencesTab] Failed to load more occurrences:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [current, db, loadingMore]);

  if (loading) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">{s.loading}</Text>
      </View>
    );
  }

  if (!root) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">
          {current ? s.noRootData : s.genericActionFailed}
        </Text>
      </View>
    );
  }

  return (
    <View className="py-4 px-1">
      {/* Root + count */}
      <View className="flex-row items-center justify-between mb-3">
        <Text
          className="text-xl text-charcoal dark:text-neutral-100 font-semibold"
          style={{ writingDirection: "rtl" }}
        >
          {root}
        </Text>
        <View className="bg-teal-100 dark:bg-teal-900/40 rounded-full px-3 py-1">
          <Text className="text-teal-700 dark:text-teal-300 text-xs font-semibold">
            {interpolate(s.occurrences, { n: current?.total ?? 0 })}
          </Text>
        </View>
      </View>

      {/* Occurrence list. It scrolls with the sheet body: a nested vertical ScrollView does not scroll on Android. */}
      <View>
        {occurrences.map((occ) => {
          const isCurrent =
            occ.surah === surah &&
            occ.ayah === ayah &&
            occ.word_pos === wordPos;
          return (
            <Pressable
              key={`${occ.surah}-${occ.ayah}-${occ.word_pos}`}
              onPress={() => navigateToAyah(occ.surah, occ.ayah, occ.word_pos)}
              className={`flex-row items-center justify-between py-2 mb-2 ${
                isCurrent ? "bg-teal-50 dark:bg-teal-900/20 -mx-1 px-1 rounded" : ""
              }`}
            >
              <Text className="text-sm text-teal-600 dark:text-teal-400 font-medium w-16 underline">
                {formatAyahRef(isRTL, occ.surah, occ.ayah)}
              </Text>
              <Text
                className="text-base text-charcoal dark:text-neutral-100 flex-1 text-right"
                style={{ writingDirection: "rtl" }}
                numberOfLines={1}
              >
                {occ.word_text}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {remaining > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          label={interpolate(s.listShowMore, { count: remaining })}
          onPress={showMore}
          disabled={loadingMore}
          className="mt-1 self-center"
        />
      ) : null}
    </View>
  );
}
