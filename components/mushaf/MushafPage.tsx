import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { SurahHeader } from "./SurahHeader";
import { loadQpcFont, qpcFontName, isQpcFontLoaded } from "@/lib/fonts/loader";
import { toArabicNumber } from "@/lib/arabic";

type AyahData = {
  surah: number;
  ayah: number;
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
};

type Props = {
  pageNumber: number;
  ayahs: AyahData[];
  surahMap: Map<number, SurahInfo>;
  fontSize: number;
  lineHeight: number;
  width: number;
  lineLayout?: PageLineLayout[];
  globalWordOffset?: number;
};

// QCF2 Basmallah: 4 word glyphs from page 1's font (Surah 1 Ayah 1 = the Basmallah)
const BISMILLAH_QCF2 = "\uFC41 \uFC42 \uFC43 \uFC44";

// Content width scales with font size — a standard Mushaf line fills this width
const FONT_WIDTH_SCALE = 19;

function buildWordItems(ayahs: AyahData[]): WordItem[] {
  const items: WordItem[] = [];
  for (const a of ayahs) {
    const words = a.textQcf2.split(/\s+/).filter(Boolean);
    for (const w of words) {
      items.push({ type: "word", text: w, surah: a.surah, ayah: a.ayah });
    }
  }
  return items;
}

/**
 * Pre-compute per-line word slices by proportional distribution.
 * page_lines word IDs are QCF2 glyph positions. Distribute wordItems
 * proportionally across lines based on the QCF2 word count per line.
 *
 * Distribution is done per-section (groups of consecutive ayah lines separated
 * by surah_name/basmallah lines). Each section's exact word/glyph count is
 * determined from wordItem surah metadata to respect surah boundaries exactly.
 */
function buildLineWords(
  lines: PageLineLayout[],
  wordItems: WordItem[],
  offset: number
): Map<number, WordItem[]> {
  // Group consecutive ayah lines into sections separated by non-ayah lines.
  // Track which surah starts each new section (from surah_name lines).
  type AyahLine = { lineNum: number; uthCount: number };
  type Section = { lines: AyahLine[]; newSurah: number | null };
  const sections: Section[] = [];
  let currentLines: AyahLine[] = [];
  let pendingSurah: number | null = null;

  for (const line of lines) {
    if (line.line_type === "surah_name" && line.surah_number != null) {
      // Flush current section before the header, carrying forward any pending surah
      if (currentLines.length > 0) {
        sections.push({ lines: currentLines, newSurah: pendingSurah });
        currentLines = [];
      }
      pendingSurah = line.surah_number;
    } else if (line.line_type === "ayah" && line.first_word_id != null && line.last_word_id != null) {
      currentLines.push({
        lineNum: line.line_number,
        uthCount: line.last_word_id - line.first_word_id + 1,
      });
    }
    // basmallah lines are skipped (no word IDs)
  }
  if (currentLines.length > 0) {
    sections.push({ lines: currentLines, newSurah: pendingSurah });
  }

  // Determine exact QCF2 glyph boundaries per section using wordItem surah metadata.
  const result = new Map<number, WordItem[]>();

  if (sections.length <= 1) {
    // Single section: distribute all glyphs across all lines
    const allLines = sections[0]?.lines ?? [];
    distributeWithinSection(allLines, wordItems, 0, wordItems.length, result);
    return result;
  }

  // Multiple sections: find the exact split point in wordItems where
  // the new surah starts (using surah metadata on each word item).
  const sectionRanges: { start: number; end: number }[] = [];
  let wiCursor = 0;

  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];
    if (s === sections.length - 1) {
      // Last section gets all remaining glyphs
      sectionRanges.push({ start: wiCursor, end: wordItems.length });
    } else {
      // Find where the NEXT section's surah starts in wordItems
      const nextSection = sections[s + 1];
      if (nextSection.newSurah != null) {
        // Find first wordItem at or after wiCursor with this surah number
        let splitAt = wordItems.length;
        for (let w = wiCursor; w < wordItems.length; w++) {
          if (wordItems[w].surah >= nextSection.newSurah) {
            splitAt = w;
            break;
          }
        }
        sectionRanges.push({ start: wiCursor, end: splitAt });
        wiCursor = splitAt;
      } else {
        // No surah info — fall back to proportional split
        const sectionUth = section.lines.reduce((sum, l) => sum + l.uthCount, 0);
        const totalUthRemaining = sections.slice(s).reduce(
          (sum, sec) => sum + sec.lines.reduce((ls, l) => ls + l.uthCount, 0), 0
        );
        const remaining = wordItems.length - wiCursor;
        const count = Math.round((sectionUth / totalUthRemaining) * remaining);
        sectionRanges.push({ start: wiCursor, end: wiCursor + count });
        wiCursor += count;
      }
    }
  }

  // Distribute within each section
  for (let s = 0; s < sections.length; s++) {
    const { start, end } = sectionRanges[s];
    distributeWithinSection(sections[s].lines, wordItems, start, end, result);
  }

  return result;
}

/** Distribute wordItems[start..end) proportionally across the given ayah lines */
function distributeWithinSection(
  lines: { lineNum: number; uthCount: number }[],
  wordItems: WordItem[],
  start: number,
  end: number,
  result: Map<number, WordItem[]>,
) {
  const sectionQcf = end - start;
  const sectionUth = lines.reduce((sum, l) => sum + l.uthCount, 0);
  let cursor = 0;
  let cumulativeUth = 0;

  for (let i = 0; i < lines.length; i++) {
    const { lineNum, uthCount } = lines[i];
    if (i === lines.length - 1) {
      result.set(lineNum, wordItems.slice(start + cursor, end));
    } else {
      cumulativeUth += uthCount;
      const target = Math.round((cumulativeUth / sectionUth) * sectionQcf);
      const count = target - cursor;
      result.set(lineNum, wordItems.slice(start + cursor, start + cursor + count));
      cursor += count;
    }
  }
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
) {
  const lineWordsMap = buildLineWords(lines, wordItems, globalWordOffset);

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
      const bismHeight = lineHeight * 0.85 + 8;
      return (
        <View
          key={`line-${line.line_number}-bism`}
          className="items-center"
          style={{ height: bismHeight, justifyContent: "center" }}
        >
          <Text
            className="text-warm-800 dark:text-neutral-200 text-center"
            style={{
              fontFamily: qpcFontName(1),
              fontSize: fontSize * 0.85,
              lineHeight: lineHeight * 0.85,
            }}
          >
            {BISMILLAH_QCF2}
          </Text>
        </View>
      );
    }

    const words = lineWordsMap.get(line.line_number) ?? [];
    if (words.length === 0) return null;

    return (
      <View
        key={`line-${line.line_number}`}
        style={{
          flexDirection: "row-reverse",
          justifyContent: centered ? "center" : "space-between",
          width: contentWidth,
          height: lineHeight,
          gap: centered ? fontSize * 0.3 : undefined,
        }}
      >
        {words.map((w, i) => (
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
        ))}
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
  lineLayout,
  globalWordOffset,
}: Props) {
  // fontVisible: false while font is loading. Text renders at opacity:0 so the
  // browser can lay out glyphs, then we reveal after one animation frame.
  const [fontVisible, setFontVisible] = useState(false);

  useEffect(() => {
    setFontVisible(false);

    const reveal = () => {
      requestAnimationFrame(() => setFontVisible(true));
    };

    // Load page font + page 1 font (for Basmallah glyphs) in parallel
    const fontsReady =
      isQpcFontLoaded(pageNumber) && isQpcFontLoaded(1);

    if (fontsReady) {
      reveal();
      return;
    }

    Promise.all([loadQpcFont(pageNumber), loadQpcFont(1)])
      .then(reveal)
      .catch(console.warn);
  }, [pageNumber]);

  const hasLineLayout = lineLayout && lineLayout.length > 0 && globalWordOffset != null;

  // Content width grows with font size, capped at screen width
  const contentWidth = Math.min(fontSize * FONT_WIDTH_SCALE, width - 32);

  const fontFamily = qpcFontName(pageNumber);

  // Show loading indicator while font is not loaded at all
  if (!isQpcFontLoaded(pageNumber)) {
    return (
      <View style={{ width, minHeight: 200 }} className="items-center justify-center">
        <ActivityIndicator size="small" color="#0d9488" />
      </View>
    );
  }

  let content;
  if (hasLineLayout) {
    const wordItems = buildWordItems(ayahs);
    content = renderLines(
      lineLayout,
      wordItems,
      globalWordOffset,
      surahMap,
      fontSize,
      lineHeight,
      contentWidth,
      fontFamily,
    );
  } else {
    // Fallback: render ayahs as continuous text (shouldn't happen with layout data)
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
            {a.textQcf2}
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
