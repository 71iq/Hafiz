import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useDatabase } from "@/lib/database/provider";
import { formatNumber } from "@/lib/i18n/count";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { fetchUthmaniRange } from "@/lib/selection/queries";
import { textStartStyle } from "@/lib/ui/direction";

const AYAH_LINE_HEIGHT = 32;

type AyahRange = { surah: number; ayahStart: number; ayahEnd: number };
type AyahEditorContext = { reference: string | null; text: string | null };

/** Localized reference such as "Al-Baqarah 255" or "البقرة ٢٥٥", with a range when it spans ayahs. */
export function formatAyahEditorReference(
  names: { arabic: string; english: string },
  range: AyahRange,
  language: "en" | "ar",
): string {
  const name = language === "ar" ? names.arabic : names.english;
  const start = formatNumber(range.ayahStart, language);
  const ayahs = range.ayahEnd !== range.ayahStart ? `${start}-${formatNumber(range.ayahEnd, language)}` : start;
  // The numeric token stays an LTR isolate inside RTL text.
  return `${name} ⁦${ayahs}⁩`;
}

/**
 * Loads the reference and Unicode text (text_uthmani, never glyph data) for an editor's ayahs.
 * A result for an older target is ignored.
 */
export function useAyahEditorContext({ surah, ayahStart, ayahEnd }: AyahRange, enabled = true): AyahEditorContext {
  const db = useDatabase();
  const { uiLanguage } = useSettings();
  const key = `${surah}:${ayahStart}:${ayahEnd}:${uiLanguage}`;
  const [loaded, setLoaded] = useState<{ key: string; value: AyahEditorContext } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    (async () => {
      const [names, text] = await Promise.all([
        db.getFirstAsync<{ name_arabic: string; name_english: string }>(
          "SELECT name_arabic, name_english FROM surahs WHERE number = ?",
          [surah],
        ),
        fetchUthmaniRange(db, surah, ayahStart, ayahEnd),
      ]);
      if (!current) return;
      setLoaded({
        key,
        value: {
          reference: names
            ? formatAyahEditorReference(
                { arabic: names.name_arabic, english: names.name_english },
                { surah, ayahStart, ayahEnd },
                uiLanguage,
              )
            : null,
          text: text.trim() || null,
        },
      });
    })().catch((error) => console.warn("[AyahEditorPreview] Failed to load ayah:", error));
    return () => {
      current = false;
    };
  }, [ayahEnd, ayahStart, db, enabled, key, surah, uiLanguage]);

  return loaded?.key === key ? loaded.value : { reference: null, text: null };
}

/** The ayah being written about, collapsed to two lines with Show more / Show less. */
export function AyahTextPreview({ text }: { text: string }) {
  const s = useStrings();
  const { isRTL } = useSettings();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [measuredText, setMeasuredText] = useState<string | null>(null);
  // A new ayah starts collapsed again.
  if (measuredText !== text) {
    setMeasuredText(text);
    setExpanded(false);
    setOverflows(false);
  }

  const textStyle = {
    fontSize: 18,
    lineHeight: AYAH_LINE_HEIGHT,
    textAlign: "right",
    writingDirection: "rtl",
  } as const;

  return (
    <View>
      {/* An unclamped hidden copy measures whether the text needs more than two lines. */}
      <Text
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        onLayout={(event) => setOverflows(event.nativeEvent.layout.height > AYAH_LINE_HEIGHT * 2 + 2)}
        style={[textStyle, { position: "absolute", left: 0, right: 0, opacity: 0 }]}
      >
        {text}
      </Text>
      <Text numberOfLines={expanded ? undefined : 2} className="text-charcoal dark:text-neutral-100" style={textStyle}>
        {text}
      </Text>
      {overflows || expanded ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          hitSlop={8}
          className="min-h-11 justify-center"
          style={{ alignSelf: isRTL ? "flex-end" : "flex-start" }}
        >
          <Text
            className="text-primary-accent dark:text-primary-bright"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, ...textStartStyle(isRTL) }}
          >
            {expanded ? s.sharedShowLess : s.sharedShowMore}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
