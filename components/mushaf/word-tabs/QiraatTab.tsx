import { useEffect, useState, useMemo } from "react";
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

type QiraatBlock = {
  heading: string | null;
  body: string;
};

/**
 * Split the qira'at text into blocks. Each block typically opens with the
 * Quranic word(s) being discussed followed by ":قرئ" or ":وقرئ" then a
 * numbered list of variant readings. Insert newlines before numbered items
 * so each variant lands on its own line.
 */
function parseQiraatText(raw: string): QiraatBlock[] {
  const text = raw.trim();
  if (!text) return [];
  // Split on "قرئ" / "وقرئ" markers; capture the marker so we can prepend it
  // back to the body for clarity.
  const parts = text.split(/((?:و?قرئ)(?:\s*شاذا)?\s*:)/);
  // parts is like [headingChunk, marker, bodyChunk, headingChunk, marker, bodyChunk, ...]
  const blocks: QiraatBlock[] = [];
  let i = 0;
  // If the first chunk doesn't end with a marker, it might be a leading
  // standalone block — skip past the first heading until we hit a marker.
  if (parts.length === 1) return [{ heading: null, body: formatBody(parts[0]) }];

  while (i < parts.length) {
    const headingRaw = (parts[i] ?? "").trim();
    const marker = (parts[i + 1] ?? "").trim();
    const body = (parts[i + 2] ?? "").trim();
    if (marker) {
      const heading = headingRaw.replace(/[:\.\s]+$/, "").trim() || null;
      blocks.push({ heading, body: formatBody(body) });
      i += 3;
    } else {
      // Trailing chunk with no marker — append to previous body
      if (blocks.length > 0 && headingRaw) {
        blocks[blocks.length - 1].body += "\n" + formatBody(headingRaw);
      } else if (headingRaw) {
        blocks.push({ heading: null, body: formatBody(headingRaw) });
      }
      i += 1;
    }
  }
  return blocks.filter((b) => b.body.trim().length > 0);
}

/** Insert a newline before numbered list items like "1-", "٢-" preceded by a period. */
function formatBody(text: string): string {
  return text.replace(/([.])\s*([\d٠-٩]+\s*-)/g, "$1\n$2");
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

  const blocks = useMemo(() => (text ? parseQiraatText(text) : []), [text]);

  if (loading) {
    return (
      <View className="py-6 items-center">
        <Text className="text-warm-400 dark:text-neutral-500 text-sm">{s.loading}</Text>
      </View>
    );
  }

  if (!text || blocks.length === 0) {
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

      {blocks.map((block, i) => (
        <View key={i} className="mb-4">
          {block.heading && (
            <Text
              className="text-lg text-primary-accent dark:text-primary-bright mb-1.5"
              style={{ writingDirection: "rtl", textAlign: "right", fontWeight: "700" }}
            >
              {block.heading}
            </Text>
          )}
          <Text
            className="text-base text-charcoal dark:text-neutral-200 leading-8"
            style={{ writingDirection: "rtl", textAlign: "right" }}
          >
            {block.body}
          </Text>
        </View>
      ))}

      <Text
        className="text-xs text-warm-400 dark:text-neutral-500 mt-4"
        style={{ writingDirection: "rtl", textAlign: "right" }}
      >
        {s.qiraatSourceAttribution}
      </Text>
    </View>
  );
}
