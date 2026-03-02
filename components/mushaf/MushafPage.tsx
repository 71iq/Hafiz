import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { SurahHeader } from "./SurahHeader";
import type { QuranFont } from "@/lib/settings/context";
import { loadQpcFont, qpcFontName, isQpcFontLoaded } from "@/lib/fonts/loader";
import { toArabicNumber } from "@/lib/arabic";

type AyahData = {
  surah: number;
  ayah: number;
  text: string;
  textQcf2: string;
};

type SurahInfo = {
  number: number;
  name_arabic: string;
  name_english: string;
  ayah_count: number;
  revelation_type: string;
};

export type PageLineLayout = {
  line_number: number;
  line_type: string; // "surah_name" | "basmallah" | "ayah"
  is_centered: number;
  first_word_id: number | null;
  last_word_id: number | null;
  surah_number: number | null;
};

type WordItem = {
  type: "word";
  text: string;
  surah: number;
  ayah: number;
} | {
  type: "marker";
  ayah: number;
  surah: number;
};

type Props = {
  pageNumber: number;
  ayahs: AyahData[];
  surahMap: Map<number, SurahInfo>;
  fontSize: number;
  lineHeight: number;
  width: number;
  quranFont: QuranFont;
  lineLayout?: PageLineLayout[];
  globalWordOffset?: number;
};

const BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ";

// Content width scales with font size — a standard Mushaf line fills this width
const FONT_WIDTH_SCALE = 19;

function buildWordItems(ayahs: AyahData[], useQcf2: boolean): WordItem[] {
  const items: WordItem[] = [];
  for (const a of ayahs) {
    const src = useQcf2 ? a.textQcf2 : a.text;
    const words = src.split(/\s+/).filter(Boolean);
    for (const w of words) {
      items.push({ type: "word", text: w, surah: a.surah, ayah: a.ayah });
    }
    // QCF2 text already includes end-of-ayah markers as the last word glyph
    if (!useQcf2) {
      items.push({ type: "marker", ayah: a.ayah, surah: a.surah });
    }
  }
  return items;
}

function getLineWords(
  line: PageLineLayout,
  wordItems: WordItem[],
  offset: number
): WordItem[] {
  if (line.first_word_id == null || line.last_word_id == null) return [];
  const start = line.first_word_id - offset - 1;
  const end = line.last_word_id - offset;
  return wordItems.slice(Math.max(0, start), end);
}

/**
 * Pre-compute per-line word slices for QCF2 font.
 * page_lines word IDs match UthmanicHafs word counts, but QCF2 has more glyphs.
 * Distribute QCF2 glyphs proportionally across lines based on the UthmanicHafs
 * word count per line, so every glyph gets rendered.
 */
function buildQcf2LineWords(
  lines: PageLineLayout[],
  wordItems: WordItem[],
  offset: number
): Map<number, WordItem[]> {
  // Compute expected UthmanicHafs word count per ayah line
  const ayahLines: { lineNum: number; uthCount: number }[] = [];
  let totalUth = 0;
  for (const line of lines) {
    if (line.line_type === "ayah" && line.first_word_id != null && line.last_word_id != null) {
      const count = line.last_word_id - line.first_word_id + 1;
      ayahLines.push({ lineNum: line.line_number, uthCount: count });
      totalUth += count;
    }
  }

  const totalQcf = wordItems.length;
  const result = new Map<number, WordItem[]>();
  let cursor = 0;
  let cumulativeUth = 0;

  for (let i = 0; i < ayahLines.length; i++) {
    const { lineNum, uthCount } = ayahLines[i];
    if (i === ayahLines.length - 1) {
      // Last line gets all remaining glyphs
      result.set(lineNum, wordItems.slice(cursor));
    } else {
      // Cumulative rounding: eliminates accumulated per-line rounding error
      cumulativeUth += uthCount;
      const cumulativeTarget = Math.round((cumulativeUth / totalUth) * totalQcf);
      const qcfCount = cumulativeTarget - cursor;
      result.set(lineNum, wordItems.slice(cursor, cursor + qcfCount));
      cursor += qcfCount;
    }
  }

  return result;
}

function renderLines(
  lines: PageLineLayout[],
  wordItems: WordItem[],
  globalWordOffset: number,
  surahMap: Map<number, SurahInfo>,
  fontSize: number,
  lineHeight: number,
  contentWidth: number,
  fontFamily: string,
  useQcf2: boolean,
) {
  // For QCF2, pre-compute proportional line assignments
  const qcf2LineWords = useQcf2
    ? buildQcf2LineWords(lines, wordItems, globalWordOffset)
    : null;

  return lines.map((line) => {
    const centered = line.is_centered === 1;

    if (line.line_type === "surah_name") {
      const surah = line.surah_number ? surahMap.get(line.surah_number) : null;
      if (surah) {
        return (
          <SurahHeader
            key={`line-${line.line_number}-header`}
            surahNumber={surah.number}
            nameArabic={surah.name_arabic}
            nameEnglish={surah.name_english}
            ayahCount={surah.ayah_count}
            revelationType={surah.revelation_type}
            hideBismillah
            compact
          />
        );
      }
      return null;
    }

    if (line.line_type === "basmallah") {
      const bismHeight = lineHeight * 0.8 + 8; // matches getItemLayout
      return (
        <View
          key={`line-${line.line_number}-bism`}
          className="items-center"
          style={{ height: bismHeight, justifyContent: "center" }}
        >
          <Text
            className="text-warm-800 dark:text-neutral-200 text-center"
            style={{
              fontFamily,
              fontSize: fontSize * 0.75,
              lineHeight: lineHeight * 0.8,
            }}
          >
            {BISMILLAH}
          </Text>
        </View>
      );
    }

    const words = qcf2LineWords
      ? (qcf2LineWords.get(line.line_number) ?? [])
      : getLineWords(line, wordItems, globalWordOffset);
    if (words.length === 0) return null;

    return (
      <View
        key={`line-${line.line_number}`}
        style={{
          flexDirection: "row-reverse",
          justifyContent: centered ? "center" : "space-between",
          width: contentWidth,
          height: lineHeight,
          overflow: "hidden",
          gap: centered ? fontSize * 0.3 : undefined,
        }}
      >
        {words.map((w, i) => {
          if (w.type === "marker") {
            return (
              <Text
                key={`m-${w.surah}-${w.ayah}-${i}`}
                className="text-teal-600 dark:text-teal-400"
                style={{
                  fontFamily,
                  fontSize: fontSize * 0.82,
                  lineHeight,
                }}
              >
                {"\uFD3F"}{toArabicNumber(w.ayah)}{"\uFD3E"}
              </Text>
            );
          }
          return (
            <Text
              key={`w-${w.surah}-${w.ayah}-${i}`}
              className="text-warm-900 dark:text-neutral-100"
              style={{
                fontFamily,
                fontSize,
                lineHeight,
              }}
            >
              {w.text}
            </Text>
          );
        })}
      </View>
    );
  });
}

export function MushafPage({
  pageNumber,
  ayahs,
  surahMap,
  fontSize,
  lineHeight,
  width,
  quranFont,
  lineLayout,
  globalWordOffset,
}: Props) {
  const useQcf2 = quranFont === "qpc_v2";

  // fontVisible: false while font is loading. Text renders at opacity:0 so the
  // browser can lay out glyphs, then we reveal after one animation frame.
  const [fontVisible, setFontVisible] = useState(!useQcf2);

  useEffect(() => {
    if (!useQcf2) {
      setFontVisible(true);
      return;
    }
    setFontVisible(false);

    const reveal = () => {
      // Text is rendered with opacity:0. Give the browser one frame to lay out
      // the text with the QCF2 font before revealing.
      requestAnimationFrame(() => setFontVisible(true));
    };

    if (isQpcFontLoaded(pageNumber)) {
      reveal();
      return;
    }

    loadQpcFont(pageNumber)
      .then(reveal)
      .catch(console.warn);
  }, [pageNumber, useQcf2]);

  const hasLineLayout = lineLayout && lineLayout.length > 0 && globalWordOffset != null;

  // Content width grows with font size, capped at screen width
  const contentWidth = Math.min(fontSize * FONT_WIDTH_SCALE, width - 32);

  const fontFamily = useQcf2 ? qpcFontName(pageNumber) : "UthmanicHafs";

  // Show loading indicator while font is not loaded at all
  if (useQcf2 && !isQpcFontLoaded(pageNumber)) {
    return (
      <View style={{ width, minHeight: 200 }} className="items-center justify-center">
        <ActivityIndicator size="small" color="#0d9488" />
      </View>
    );
  }

  let content;
  if (hasLineLayout) {
    const wordItems = buildWordItems(ayahs, useQcf2);
    content = renderLines(
      lineLayout,
      wordItems,
      globalWordOffset,
      surahMap,
      fontSize,
      lineHeight,
      contentWidth,
      fontFamily,
      useQcf2,
    );
  } else {
    // Fallback: render ayahs as continuous justified text (shouldn't happen with layout data)
    content = (
      <Text
        className="text-warm-900 dark:text-neutral-100"
        style={{
          fontFamily,
          fontSize,
          lineHeight,
          textAlign: "justify",
          writingDirection: "rtl",
        }}
      >
        {ayahs.map((a, i) => (
          <Text key={`${a.surah}-${a.ayah}`}>
            {useQcf2 ? a.textQcf2 : a.text}
            {"  "}
            {!useQcf2 && (
              <Text
                className="text-teal-600 dark:text-teal-400"
                style={{ fontFamily, fontSize: fontSize * 0.75 }}
              >
                ﴿{toArabicNumber(a.ayah)}﴾
              </Text>
            )}
            {i < ayahs.length - 1 ? " " : ""}
          </Text>
        ))}
      </Text>
    );
  }

  return (
    <View style={{
      alignItems: "center",
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 32,
      opacity: fontVisible ? 1 : 0,
    }}>
      <View style={{ width: contentWidth }}>
        {content}
      </View>
    </View>
  );
}
