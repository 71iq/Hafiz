import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { SurahHeader } from "./SurahHeader";
import { loadQpcFont, qpcFontName, isQpcFontLoaded } from "@/lib/fonts/loader";

// Authoritative per-page, per-line word mapping from quran.com
// pageWordsData[pageIndex] = { "lineNumber": "word1 word2 ..." }
const pageWordsData: Record<string, string>[] = require("../../assets/data/layout/page-words.json");

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

function renderLines(
  pageNumber: number,
  lines: PageLineLayout[],
  surahMap: Map<number, SurahInfo>,
  fontSize: number,
  lineHeight: number,
  contentWidth: number,
  fontFamily: string,
) {
  // Get the authoritative word-to-line mapping for this page
  const lineWords = pageWordsData[pageNumber - 1] ?? {};

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

    // Get the exact words for this line from the authoritative mapping
    const lineText = lineWords[String(line.line_number)];
    if (!lineText) return null;

    const words = lineText.split(/\s+/).filter(Boolean);
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
            key={`w-${line.line_number}-${i}`}
            className="text-warm-900 dark:text-neutral-100"
            style={{
              fontFamily,
              fontSize,
              lineHeight,
            }}
          >
            {w}
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

  const hasLineLayout = lineLayout && lineLayout.length > 0;

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
    content = renderLines(
      pageNumber,
      lineLayout,
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
