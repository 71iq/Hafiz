import { memo, useEffect, useState, useMemo, useRef, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, Platform } from "react-native";
import { SurahHeader } from "./SurahHeader";
import { WordToken } from "./WordToken";
import { loadQpcFont, qpcFontName, isQpcFontLoaded } from "@/lib/fonts/loader";
import { useSelection } from "@/lib/selection/context";

// Authoritative per-page, per-line word mapping from quran.com
// pageWordsData[pageIndex] = { "lineNumber": "word1 word2 ..." }
// On native: require() (small enough at 400KB). On web: lazy-fetched.
let pageWordsData: Record<string, string>[] | null =
  Platform.OS !== "web"
    ? require("../../assets/data/layout/page-words.json")
    : null;

let pageWordsPromise: Promise<Record<string, string>[]> | null = null;

function getPageWords(): Record<string, string>[] | null {
  if (pageWordsData) return pageWordsData;
  if (!pageWordsPromise) {
    pageWordsPromise = fetch("/data/layout/page-words.json")
      .then((r) => r.json())
      .then((data) => {
        pageWordsData = data;
        return data;
      });
  }
  return null;
}

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
  onOpenAyahDetail?: (surah: number, ayah: number) => void;
  highlightedWord?: { surah: number; ayah: number; wordPos: number } | null;
  paddingTop?: number;
  paddingBottom?: number;
  sidePadding?: number;
  lineWidth?: number;
  lineSlotHeight?: number;
  allowLineWrap?: boolean;
  showLoadingIndicator?: boolean;
};

// Identity for a single visual word on the page
type WordIdentity = {
  surah: number;
  ayah: number;
  wordPos: number;
  isMarker: boolean;
};

type PageGlyph = {
  glyph: string;
  identity: WordIdentity;
};

// QCF2 Basmallah: 4 word glyphs from page 1's font (Surah 1 Ayah 1 = the Basmallah)
const BISMILLAH_QCF2 = "\uFC41 \uFC42 \uFC43 \uFC44";

// Approximate QCF2 font-size to Mushaf-line width ratio, used by PageMushaf
// to cap vertical page typography before a line can overflow the viewport.
export const MUSHAF_LINE_WIDTH_SCALE = 17.5;
const MARKER_DOUBLE_TAP_MS = 260;

/**
 * Build the canonical QCF2 token stream for this page. `page-words.json`
 * is stale on some v2 page boundaries, so this stream is the source of truth.
 */
function buildPageGlyphs(ayahs: AyahData[]): PageGlyph[] {
  const glyphs: PageGlyph[] = [];
  for (const a of ayahs) {
    const tokens = a.textQcf2.split(" ").filter(Boolean);
    if (tokens.length === 0) continue;
    for (let i = 0; i < tokens.length - 1; i++) {
      glyphs.push({
        glyph: tokens[i],
        identity: {
          surah: a.surah,
          ayah: a.ayah,
          wordPos: i + 1,
          isMarker: false,
        },
      });
    }
    glyphs.push({
      glyph: tokens[tokens.length - 1],
      identity: {
        surah: a.surah,
        ayah: a.ayah,
        wordPos: 0,
        isMarker: true,
      },
    });
  }
  return glyphs;
}

function splitGlyphs(text: string | undefined): string[] {
  return text?.split(/\s+/).filter(Boolean) ?? [];
}

function flattenPageWords(lineWords: Record<string, string>): string[] {
  return Object.keys(lineWords)
    .sort((a, b) => Number(a) - Number(b))
    .flatMap((key) => splitGlyphs(lineWords[key]));
}

function glyphsMatchCanonical(pageWordGlyphs: string[], pageGlyphs: PageGlyph[]): boolean {
  return pageWordGlyphs.length === pageGlyphs.length &&
    pageWordGlyphs.every((glyph, index) => glyph === pageGlyphs[index]?.glyph);
}

function MushafPageInner({
  pageNumber,
  ayahs,
  surahMap,
  fontSize,
  lineHeight,
  width,
  lineLayout,
  globalWordOffset,
  onOpenAyahDetail,
  highlightedWord,
  paddingTop = 8,
  paddingBottom = 32,
  sidePadding = 16,
  lineWidth,
  lineSlotHeight,
  allowLineWrap = false,
  showLoadingIndicator = true,
}: Props) {
  const [fontVisible, setFontVisible] = useState(false);
  const [wordsLoaded, setWordsLoaded] = useState(!!pageWordsData);
  const { getHighlightColor } = useSelection();
  const lastMarkerTapRef = useRef<{ key: string; at: number } | null>(null);
  const skipNextMarkerPressRef = useRef<string | null>(null);

  // On web, trigger async load of page-words data
  useEffect(() => {
    if (pageWordsData) { setWordsLoaded(true); return; }
    getPageWords(); // starts the fetch
    pageWordsPromise?.then(() => setWordsLoaded(true));
  }, []);

  useEffect(() => {
    setFontVisible(false);

    const reveal = () => {
      requestAnimationFrame(() => setFontVisible(true));
    };

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

  const pageGlyphs = useMemo(
    () => buildPageGlyphs(ayahs),
    [ayahs],
  );

  const handleMarkerPress = useCallback((surah: number, ayah: number) => {
    if (!onOpenAyahDetail) return;
    const key = `${surah}:${ayah}`;
    if (skipNextMarkerPressRef.current === key) {
      skipNextMarkerPressRef.current = null;
      return;
    }
    if (Platform.OS === "web") {
      onOpenAyahDetail(surah, ayah);
      return;
    }
    const now = Date.now();
    const lastTap = lastMarkerTapRef.current;
    if (lastTap?.key === key && now - lastTap.at <= MARKER_DOUBLE_TAP_MS) {
      lastMarkerTapRef.current = null;
      onOpenAyahDetail(surah, ayah);
      return;
    }
    lastMarkerTapRef.current = { key, at: now };
  }, [onOpenAyahDetail]);

  const handleMarkerLongPress = useCallback((surah: number, ayah: number) => {
    if (!onOpenAyahDetail) return;
    const key = `${surah}:${ayah}`;
    skipNextMarkerPressRef.current = key;
    lastMarkerTapRef.current = null;
    onOpenAyahDetail(surah, ayah);
  }, [onOpenAyahDetail]);

  const hasLineLayout = lineLayout && lineLayout.length > 0;
  const maxContentWidth = Math.max(0, width - sidePadding * 2);
  const contentWidth = Math.max(0, Math.min(lineWidth ?? fontSize * MUSHAF_LINE_WIDTH_SCALE, maxContentWidth));
  const visualLineHeight = lineSlotHeight ?? lineHeight;
  const fontFamily = qpcFontName(pageNumber);

  // Show loading indicator while font is not loaded at all
  if (!isQpcFontLoaded(pageNumber)) {
    return (
      <View style={{ width, minHeight: 200 }} className="items-center justify-center">
        {showLoadingIndicator && <ActivityIndicator size="small" color="#0d9488" />}
      </View>
    );
  }

  let content;
  if (hasLineLayout) {
    const lineWords = (pageWordsData ?? [])[pageNumber - 1] ?? {};
    const pageWordGlyphs = wordsLoaded ? flattenPageWords(lineWords) : [];
    const usePageWords = glyphsMatchCanonical(pageWordGlyphs, pageGlyphs);
    const lastAyahLineNumber = lineLayout!
      .filter((line) => line.line_type === "ayah")
      .at(-1)?.line_number ?? null;

    // 19 pages have a 1-line offset between page-lines and page-words: the
    // "basmallah" slot in page-words actually holds the first ayah line's
    // glyphs (see surah 22 page 332). Detect by checking if any basmallah
    // line has non-empty page-words content; if so, shift ayah lookups by -1.
    let lineKeyOffset = 0;
    for (const l of lineLayout!) {
      if (l.line_type === "basmallah") {
        const k = String(l.line_number);
        if (lineWords[k] && lineWords[k].trim().length > 0) {
          lineKeyOffset = -1;
          break;
        }
      }
    }
    let wordIndex = 0;

    content = lineLayout.map((line) => {
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
        const bismHeight = visualLineHeight * 0.85 + 8;
        return (
          <View
            key={`line-${line.line_number}-bism`}
            className="items-center"
            style={{ height: bismHeight, justifyContent: "center" }}
          >
            <Text
              className="text-charcoal dark:text-neutral-200 text-center"
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

      let lineStartIndex = wordIndex;
      let words: string[];
      if (usePageWords) {
        words = splitGlyphs(lineWords[String(line.line_number + lineKeyOffset)]);
        wordIndex += words.length;
      } else if (
        typeof line.first_word_id === "number" &&
        typeof line.last_word_id === "number" &&
        typeof globalWordOffset === "number"
      ) {
        lineStartIndex = Math.max(0, line.first_word_id - globalWordOffset - 1);
        let lineEndIndex = Math.max(lineStartIndex, line.last_word_id - globalWordOffset);
        if (line.line_number === lastAyahLineNumber && lineEndIndex < pageGlyphs.length) {
          lineEndIndex = pageGlyphs.length;
        }
        words = pageGlyphs.slice(lineStartIndex, lineEndIndex).map((token) => token.glyph);
      } else {
        return null;
      }
      if (words.length === 0) return null;
      const shouldStretchLine = !centered && words.length > 1;
      const lineHeightStyle = allowLineWrap ? visualLineHeight : lineHeight;

      return (
        <View
          key={`line-${line.line_number}`}
          style={{
            direction: "ltr",
            flexDirection: "row-reverse",
            flexWrap: allowLineWrap ? "wrap" : "nowrap",
            justifyContent: shouldStretchLine && !allowLineWrap ? "space-between" : "center",
            width: contentWidth,
            minHeight: lineHeightStyle,
            height: lineHeightStyle,
            gap: shouldStretchLine && !allowLineWrap ? undefined : fontSize * 0.28,
            rowGap: allowLineWrap ? Math.max(2, fontSize * 0.12) : undefined,
            alignItems: "center",
            alignContent: "center",
            paddingHorizontal: 2,
            overflow: "visible",
          }}
        >
          {words.map((w, i) => {
            const identity = pageGlyphs[lineStartIndex + i]?.identity;
            if (identity && !identity.isMarker) {
              const hlColor =
                highlightedWord &&
                highlightedWord.surah === identity.surah &&
                highlightedWord.ayah === identity.ayah &&
                highlightedWord.wordPos === identity.wordPos
                  ? "#0d9488"
                  : getHighlightColor(identity.surah, identity.ayah);
              return (
                <WordToken
                  key={`w-${line.line_number}-${i}`}
                  glyph={w}
                  fontFamily={fontFamily}
                  fontSize={fontSize}
                  lineHeight={lineHeight}
                  surah={identity.surah}
                  ayah={identity.ayah}
                  wordPos={identity.wordPos}
                  v2Page={pageNumber}
                  highlightColor={hlColor}
                />
              );
            }
            // Ayah end marker — opens ayah details modal
            if (identity && identity.isMarker) {
              return (
                <Pressable
                  key={`w-${line.line_number}-${i}`}
                  onPress={() => handleMarkerPress(identity.surah, identity.ayah)}
                  onLongPress={() => handleMarkerLongPress(identity.surah, identity.ayah)}
                  delayLongPress={300}
                  style={({ pressed }) => ({
                    transform: [{ scale: pressed ? 0.95 : 1 }],
                    // @ts-ignore
                    cursor: "pointer",
                  })}
                >
                  <Text
                    className="text-charcoal dark:text-neutral-100"
                    style={{ fontFamily, fontSize, lineHeight, paddingHorizontal: 2 }}
                  >
                    {w}
                  </Text>
                </Pressable>
              );
            }
            // No identity fallback
            return (
              <Text
                key={`w-${line.line_number}-${i}`}
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily, fontSize, lineHeight, paddingHorizontal: 2 }}
              >
                {w}
              </Text>
            );
          })}
        </View>
      );
    });
  } else {
    // Fallback: render ayahs as continuous text (shouldn't happen with layout data)
    content = (
      <Text
        className="text-charcoal dark:text-neutral-100"
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
      paddingHorizontal: sidePadding,
      paddingTop,
      paddingBottom,
      opacity: fontVisible ? 1 : 0,
    }}>
      <View style={{ width: contentWidth }}>
        {content}
      </View>
    </View>
  );
}

export const MushafPage = memo(MushafPageInner);
