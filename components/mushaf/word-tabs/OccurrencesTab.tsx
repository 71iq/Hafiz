import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, Platform } from "react-native";
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
import { formatOccurrences } from "@/lib/i18n/count";
import { useSettings } from "@/lib/settings/context";
import { formatAyahRef } from "@/lib/arabic";
import { useDelayedLoading } from "./use-delayed-loading";

const OCCURRENCES_PAGE = 50;

type Props = {
  surah: number;
  ayah: number;
  wordPos: number;
};

type Loaded = { key: string; root: string | null; total: number; rows: RootOccurrence[] };
type SurahNames = Map<number, { ar: string; en: string }>;

export function OccurrencesTab({ surah, ayah, wordPos }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { isRTL, uiLanguage } = useSettings();
  const { navigateToAyah } = useWordInteraction();
  const [attempt, setAttempt] = useState(0);
  const wordKey = `${surah}:${ayah}:${wordPos}#${attempt}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [surahNames, setSurahNames] = useState<SurahNames>(new Map());

  useEffect(() => {
    let cancelled = false;
    db.getAllAsync<{ number: number; name_arabic: string; name_english: string }>(
      "SELECT number, name_arabic, name_english FROM surahs"
    )
      .then((rows) => {
        if (!cancelled) setSurahNames(new Map(rows.map((row) => [row.number, { ar: row.name_arabic, en: row.name_english }])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [db]);

  useEffect(() => {
    let cancelled = false;
    setLoadMoreFailed(false);
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
  const showLoading = useDelayedLoading(loading);
  const root = current?.root ?? null;
  const occurrences = current?.rows ?? [];
  const remaining = current ? current.total - current.rows.length : 0;

  const showMore = useCallback(async () => {
    if (!current?.root || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const next = await fetchRootOccurrences(db, current.root, OCCURRENCES_PAGE, current.rows.length);
      setLoaded((prev) =>
        prev === current ? { ...prev, rows: [...prev.rows, ...next] } : prev,
      );
    } catch (error) {
      console.warn("[OccurrencesTab] Failed to load more occurrences:", error);
      setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [current, db, loadingMore]);

  if (loading) {
    return (
      <View className="py-6 items-center">
        {showLoading ? <Text className="text-warm-500 dark:text-neutral-400 text-sm">{s.loading}</Text> : null}
      </View>
    );
  }

  if (!current) {
    return (
      <View className="py-6 items-center gap-3">
        <Text className="text-red-600 dark:text-red-400 text-sm">{s.genericActionFailed}</Text>
        <Button variant="ghost" size="sm" label={s.detailRetry} onPress={() => setAttempt((value) => value + 1)} />
      </View>
    );
  }

  if (!root) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-500 dark:text-neutral-400 text-sm">{s.noRootData}</Text>
      </View>
    );
  }

  return (
    <View className="py-4 px-1">
      <View
        className="items-center justify-between mb-3"
        style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
      >
        <Text
          className="text-xl text-charcoal dark:text-neutral-100 font-semibold"
          style={{ writingDirection: "rtl" }}
        >
          {root}
        </Text>
        <View className="bg-primary-accent/10 dark:bg-primary-bright/10 rounded-full px-3 py-1">
          <Text className="text-primary-muted dark:text-primary-bright text-xs font-semibold">
            {formatOccurrences(current.total, uiLanguage)}
          </Text>
        </View>
      </View>

      <View>
        {occurrences.map((occ) => {
          const isCurrent =
            occ.surah === surah &&
            occ.ayah === ayah &&
            occ.word_pos === wordPos;
          const names = surahNames.get(occ.surah);
          const name = names ? (uiLanguage === "ar" ? names.ar : names.en) : null;
          const reference = formatAyahRef(isRTL, occ.surah, occ.ayah);
          return (
            <Pressable
              key={`${occ.surah}-${occ.ayah}-${occ.word_pos}`}
              onPress={() => navigateToAyah(occ.surah, occ.ayah, occ.word_pos)}
              accessibilityRole="link"
              className={`items-center justify-between gap-3 py-2 mb-1 rounded-xl px-2 ${
                isCurrent ? "bg-primary-accent/10 dark:bg-primary-bright/10" : ""
              }`}
              style={{
                minHeight: 44,
                direction: "ltr",
                flexDirection: isRTL ? "row-reverse" : "row",
                cursor: Platform.OS === "web" ? "pointer" : undefined,
              }}
            >
              <Text
                className="text-sm text-primary-muted dark:text-primary-bright font-medium underline"
                style={{ writingDirection: isRTL ? "rtl" : "ltr", flexShrink: 0 }}
              >
                {name ? `${name} ${reference}` : reference}
              </Text>
              <Text
                className={`text-base text-charcoal dark:text-neutral-100 flex-1 ${isRTL ? "text-left" : "text-right"}`}
                style={{ writingDirection: "rtl" }}
                numberOfLines={1}
              >
                {occ.word_text}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {loadMoreFailed ? (
        <View className="mt-1 items-center gap-1">
          <Text className="text-red-600 dark:text-red-400 text-sm">{s.occurrencesLoadMoreFailed}</Text>
          <Button variant="ghost" size="sm" label={s.detailRetry} onPress={showMore} disabled={loadingMore} />
        </View>
      ) : remaining > 0 ? (
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
