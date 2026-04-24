import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { fetchQiraat } from "@/lib/word/queries";
import { useStrings } from "@/lib/i18n/useStrings";

type Props = {
  surah: number;
  ayah: number;
};

function toArabicNumeral(n: number): string {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[parseInt(d, 10)]);
}

export function QiraatTab({ surah, ayah }: Props) {
  const db = useDatabase();
  const s = useStrings();
  const [text, setText] = useState<string | null>(null);
  const [group, setGroup] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchQiraat(db, surah, ayah)
      .then((row) => {
        const t = row?.text?.trim() ?? "";
        setText(t || null);
        let g: string[] = [];
        if (row?.ayah_group) {
          try {
            const parsed = JSON.parse(row.ayah_group);
            if (Array.isArray(parsed)) g = parsed.map(String);
          } catch {
            // ignore
          }
        }
        setGroup(g);
      })
      .finally(() => setLoading(false));
  }, [db, surah, ayah]);

  if (loading) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">{s.loading}</Text>
      </View>
    );
  }

  if (!text) {
    return (
      <View className="py-10 items-center px-4">
        <Text className="text-3xl mb-4">{"📖"}</Text>
        <Text
          className="text-base text-warm-500 dark:text-neutral-400 text-center"
          style={{ writingDirection: "rtl" }}
        >
          {s.noQiraatData}
        </Text>
      </View>
    );
  }

  const coversMultiple = group.length > 1;
  const coversLabel = coversMultiple
    ? `${s.qiraatCoversAyahs}: ${group
        .map((k) => {
          const [gs, ga] = k.split(":").map((x) => parseInt(x, 10));
          if (!Number.isFinite(gs) || !Number.isFinite(ga)) return k;
          return `${toArabicNumeral(gs)}:${toArabicNumeral(ga)}`;
        })
        .join("، ")}`
    : null;

  return (
    <View className="py-4 px-1">
      <Text
        className="text-xs font-medium text-warm-400 dark:text-neutral-500 uppercase tracking-wider mb-3"
        style={{ writingDirection: "rtl", textAlign: "right" }}
      >
        {s.qiraatHeader}
      </Text>

      {coversLabel && (
        <View className="mb-3 px-3 py-2 rounded-full bg-primary-accent/10 dark:bg-primary-bright/10 self-start">
          <Text
            className="text-xs text-primary-accent dark:text-primary-bright"
            style={{ writingDirection: "rtl" }}
          >
            {coversLabel}
          </Text>
        </View>
      )}

      <Text
        className="text-base text-charcoal dark:text-neutral-200 leading-8"
        style={{
          writingDirection: "rtl",
          textAlign: "right",
          fontFamily: "IBMPlexSansArabic, NotoSansArabic, system-ui",
        }}
      >
        {text}
      </Text>

      <Text
        className="text-xs text-warm-400 dark:text-neutral-500 mt-4"
        style={{ writingDirection: "rtl", textAlign: "right" }}
      >
        {s.qiraatSourceAttribution}
      </Text>
    </View>
  );
}
