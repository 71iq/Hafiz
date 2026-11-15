import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { fetchQiraat } from "@/lib/word/queries";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { formatAyahRef } from "@/lib/arabic";
import { parseQiraatText, type QiraatBlock } from "@/lib/qiraat/parse";
import { QiraatBlocks } from "@/components/mushaf/QiraatBlocks";
import { useDelayedLoading } from "./use-delayed-loading";

type Props = {
  surah: number;
  ayah: number;
  /** Shows the source as a heading. Without it the source appears as a footnote at the end. */
  showHeader?: boolean;
};

type Loaded =
  | { key: string; blocks: QiraatBlock[]; group: { surah: number; ayah: number }[] }
  | { key: string; failed: true };

function parseGroup(raw: string | null | undefined): { surah: number; ayah: number }[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const [surah, ayah] = String(item).split(":").map((part) => Number.parseInt(part, 10));
      return Number.isFinite(surah) && Number.isFinite(ayah) ? [{ surah, ayah }] : [];
    });
  } catch {
    return [];
  }
}

/** "Covers ayahs 2:5-2:7" for a run within one surah, otherwise "Covers ayahs: 2:5, 2:9". */
export function formatQiraatCovers(
  group: readonly { surah: number; ayah: number }[],
  isArabic: boolean,
  labels: { list: string; range: string },
): string | null {
  if (group.length < 2) return null;
  const ref = (item: { surah: number; ayah: number }) => formatAyahRef(isArabic, item.surah, item.ayah);
  const consecutive = group.every(
    (item, index) => index === 0 || (item.surah === group[0].surah && item.ayah === group[index - 1].ayah + 1),
  );
  if (consecutive) {
    return interpolate(labels.range, { from: ref(group[0]), to: ref(group[group.length - 1]) });
  }
  return `${labels.list}: ${group.map(ref).join(isArabic ? "، " : ", ")}`;
}

export function QiraatTab({ surah, ayah, showHeader = true }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const { uiLanguage } = useSettings();
  const isArabic = uiLanguage === "ar";
  const [attempt, setAttempt] = useState(0);
  const key = `${surah}:${ayah}#${attempt}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = loaded?.key === key ? loaded : null;
  const showLoading = useDelayedLoading(current === null);

  useEffect(() => {
    let cancelled = false;
    fetchQiraat(db, surah, ayah)
      .then((row) => {
        if (cancelled) return;
        const text = row?.text?.trim() ?? "";
        setLoaded({ key, blocks: text ? parseQiraatText(text) : [], group: parseGroup(row?.ayah_group) });
      })
      .catch((error) => {
        console.warn("[QiraatTab] Failed to load qiraat:", error);
        if (!cancelled) setLoaded({ key, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [db, surah, ayah, key]);

  if (!current) {
    return (
      <View className="py-6 items-center">
        {showLoading ? <Text className="text-warm-500 dark:text-neutral-400 text-sm">{s.loading}</Text> : null}
      </View>
    );
  }

  // A failed read is an error with Retry, never the "no data" message.
  if ("failed" in current) {
    return (
      <View className="py-6 items-center gap-3 px-4">
        <Text
          className="text-base text-red-600 dark:text-red-400 text-center"
          style={{ writingDirection: isArabic ? "rtl" : "ltr" }}
        >
          {s.qiraatLoadFailed}
        </Text>
        <Pressable
          onPress={() => setAttempt((value) => value + 1)}
          accessibilityRole="button"
          className="min-h-[44px] justify-center rounded-full bg-surface px-4 dark:bg-surface-dark"
        >
          <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
            {s.detailRetry}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (current.blocks.length === 0) {
    return (
      <View className="py-10 items-center px-4">
        <Text
          className="text-base text-warm-500 dark:text-neutral-400 text-center"
          style={{ writingDirection: isArabic ? "rtl" : "ltr" }}
        >
          {s.noQiraatData}
        </Text>
      </View>
    );
  }

  const coversLabel = formatQiraatCovers(current.group, isArabic, {
    list: s.qiraatCoversAyahs,
    range: s.qiraatCoversRange,
  });

  return (
    <View className="py-4 px-1">
      {showHeader && (
        <Text
          className="text-xs font-medium text-warm-500 dark:text-neutral-400 uppercase tracking-wider mb-3"
          style={{ writingDirection: "rtl", textAlign: "right" }}
        >
          {s.qiraatHeader}
        </Text>
      )}

      {coversLabel && (
        <View className="mb-3 px-3 py-2 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 self-start">
          <Text
            className="text-xs text-primary-muted dark:text-primary-bright"
            style={{ writingDirection: isArabic ? "rtl" : "ltr" }}
          >
            {coversLabel}
          </Text>
        </View>
      )}

      <QiraatBlocks blocks={current.blocks} />

      {!showHeader && (
        <Text
          className="mt-3 text-warm-500 dark:text-neutral-400"
          style={{ fontSize: 11, writingDirection: isArabic ? "rtl" : "ltr", textAlign: isArabic ? "right" : "left" }}
        >
          {s.qiraatHeader}
        </Text>
      )}
    </View>
  );
}
