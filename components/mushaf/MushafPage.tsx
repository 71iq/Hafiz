import { memo, useEffect, useState, useMemo, useRef, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, Platform } from "react-native";
import { SurahHeader } from "./SurahHeader";
import { WordToken } from "./WordToken";
import {
  isQuranPageFontLoaded,
  isSurahNameFontLoaded,
  loadQuranPageFont,
  loadSurahNameFont,
  quranPageFontName,
  quranPageMarkerFontPaletteStyle,
  quranPageFontPaletteStyle,
  surahNameBismillahGlyphs,
  surahNameFontName,
} from "@/lib/fonts/loader";
import { useSelection } from "@/lib/selection/context";
import { useSettings } from "@/lib/settings/context";

export type PageWordsByLine = Record<string, string>;
export type PageWordsData = PageWordsByLine[];

// Authoritative per-page, per-line word mapping from quran.com
// pageWordsData[pageIndex] = { "lineNumber": "word1 word2 ..." }
// On native: require() (small enough at 400KB). On web: lazy-fetched.
let pageWordsData: PageWordsData | null =
  Platform.OS !== "web"
    ? require("../../assets/data/layout/page-words.json")
    : null;

let pageWordsPromise: Promise<PageWordsData> | null = null;

export function loadPageWordsData(): Promise<PageWordsData> {
  if (pageWordsData) return Promise.resolve(pageWordsData);
  if (!pageWordsPromise) {
    pageWordsPromise = fetch("/data/layout/page-words.json")
      .then((r) => r.json())
      .then((data) => {
        pageWordsData = data;
        return data;
      });
  }
  return pageWordsPromise;
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

export type HifzVisibility = {
  enabled: boolean;
  page: number;
  revealedAyahCount: number;
  activeAyahKey: string | null;
  activeVisibleWordCount: number;
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
  usePageWords?: boolean;
  pageWordLineNumbers?: number[];
  onOpenAyahDetail?: (surah: number, ayah: number) => void;
  highlightedAyahKey?: string | null;
  highlightedWord?: { surah: number; ayah: number; wordPos: number } | null;
  paddingTop?: number;
  paddingBottom?: number;
  sidePadding?: number;
  lineWidth?: number;
  lineSlotHeight?: number;
  allowLineWrap?: boolean;
  showLoadingIndicator?: boolean;
  hifzVisibility?: HifzVisibility | null;
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

const BISMILLAH_UTHMANI = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";

const MUSHAF_LINE_WIDTH_SCALE = 19.5;
const MUSHAF_LINE_WIDTH_SCALE_V4_TAJWEED = 21.5;
const MARKER_DOUBLE_TAP_MS = 260;

export function mushafLineWidthScale(fontStyle: string): number {
  return fontStyle === "v4" || fontStyle === "v4-tajweed"
    ? MUSHAF_LINE_WIDTH_SCALE_V4_TAJWEED
    : MUSHAF_LINE_WIDTH_SCALE;
}

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

export function splitGlyphs(text: string | undefined): string[] {
  return text?.split(/\s+/).filter(Boolean) ?? [];
}

export function flattenPageWords(lineWords: PageWordsByLine): string[] {
  return Object.keys(lineWords)
    .sort((a, b) => Number(a) - Number(b))
    .flatMap((key) => splitGlyphs(lineWords[key]));
}

export function pageWordLineNumbers(lineWords: PageWordsByLine): number[] {
  return Object.keys(lineWords)
    .filter((key) => splitGlyphs(lineWords[key]).length > 0)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
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
  usePageWords: pageUsesPageWords,
  pageWordLineNumbers: precomputedPageWordLineNumbers,
  onOpenAyahDetail,
  highlightedAyahKey,
  highlightedWord,
  paddingTop = 8,
  paddingBottom = 32,
  sidePadding = 16,
  lineWidth,
  lineSlotHeight,
  allowLineWrap = false,
  showLoadingIndicator = true,
  hifzVisibility = null,
}: Props) {
  const [fontVisible, setFontVisible] = useState(false);
  const [surahNameFontReady, setSurahNameFontReady] = useState(() => isSurahNameFontLoaded());
  const [wordsLoaded, setWordsLoaded] = useState(!!pageWordsData);
  const { getHighlightColor, getWordHighlightColor, selectAyah } = useSelection();
  const { quranFontStyle, quranMarkerStyle, showAyahMarkers, effectiveTheme } = useSettings();
  const lastMarkerTapRef = useRef<{ key: string; at: number } | null>(null);
  const skipNextMarkerPressRef = useRef<string | null>(null);

  // On web, trigger async load of page-words data
  useEffect(() => {
    if (pageWordsData) { setWordsLoaded(true); return; }
    loadPageWordsData()
      .then(() => setWordsLoaded(true))
      .catch(console.warn);
  }, []);

  useEffect(() => {
    setFontVisible(false);

    const reveal = () => {
      requestAnimationFrame(() => setFontVisible(true));
    };

    const fontsReady = isQuranPageFontLoaded(quranFontStyle, pageNumber);

    if (fontsReady) {
      reveal();
      return;
    }

    loadQuranPageFont(quranFontStyle, pageNumber)
      .then(reveal)
      .catch(console.warn);
  }, [pageNumber, quranFontStyle]);

  const pageGlyphs = useMemo(
    () => buildPageGlyphs(ayahs),
    [ayahs],
  );

  const needsSurahNameFont = useMemo(
    () =>
      lineLayout?.some((line) => line.line_type === "surah_name" || line.line_type === "basmallah") ?? false,
    [lineLayout],
  );

  useEffect(() => {
    if (!needsSurahNameFont) return;
    if (isSurahNameFontLoaded()) {
      setSurahNameFontReady(true);
      return;
    }
    setSurahNameFontReady(false);
    let cancelled = false;
    loadSurahNameFont()
      .then(() => {
        if (!cancelled) requestAnimationFrame(() => setSurahNameFontReady(true));
      })
      .catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [needsSurahNameFont]);

  const ayahIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const token of pageGlyphs) {
      const key = `${token.identity.surah}:${token.identity.ayah}`;
      if (!map.has(key)) map.set(key, map.size);
    }
    return map;
  }, [pageGlyphs]);

  const isHifzWordHidden = useCallback(
    (identity: WordIdentity) => {
      if (!hifzVisibility?.enabled) return false;
      if (hifzVisibility.page !== pageNumber) return true;
      const key = `${identity.surah}:${identity.ayah}`;
      const ayahIndex = ayahIndexByKey.get(key);
      if (ayahIndex === undefined) return false;
      if (ayahIndex < hifzVisibility.revealedAyahCount) return false;
      if (
        key === hifzVisibility.activeAyahKey &&
        identity.wordPos <= hifzVisibility.activeVisibleWordCount
      ) {
        return false;
      }
      return true;
    },
    [ayahIndexByKey, hifzVisibility, pageNumber]
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
    const key = `${surah}:${ayah}`;
    skipNextMarkerPressRef.current = key;
    lastMarkerTapRef.current = null;
    selectAyah(surah, ayah);
  }, [selectAyah]);

  const hasLineLayout = lineLayout && lineLayout.length > 0;
  const maxContentWidth = Math.max(0, width - sidePadding * 2);
  const lineWidthScale = mushafLineWidthScale(quranFontStyle);
  const contentWidth = Math.max(0, Math.min(lineWidth ?? fontSize * lineWidthScale, maxContentWidth));
  const visualLineHeight = lineSlotHeight ?? lineHeight;
  const fontFamily = quranPageFontName(quranFontStyle, pageNumber);
  const fontPaletteStyle = quranPageFontPaletteStyle(quranFontStyle, pageNumber, effectiveTheme);
  const markerFontPaletteStyle = quranPageMarkerFontPaletteStyle(
    quranFontStyle,
    pageNumber,
    effectiveTheme,
    quranMarkerStyle,
  );

  // Show loading indicator while font is not loaded at all
  if (!isQuranPageFontLoaded(quranFontStyle, pageNumber)) {
    return (
      <View style={{ width, minHeight: 200 }} className="items-center justify-center">
        {showLoadingIndicator && <ActivityIndicator size="small" color="#0d9488" />}
      </View>
    );
  }

  let content;
  if (hasLineLayout) {
    const lineWords = (pageWordsData ?? [])[pageNumber - 1] ?? {};
    let usePageWords = false;
    let orderedPageWordLineNumbers: number[] = [];
    if (wordsLoaded) {
      if (pageUsesPageWords && precomputedPageWordLineNumbers) {
        usePageWords = true;
        orderedPageWordLineNumbers = precomputedPageWordLineNumbers;
      } else {
        const pageWordGlyphs = flattenPageWords(lineWords);
        usePageWords = glyphsMatchCanonical(pageWordGlyphs, pageGlyphs);
        if (usePageWords) {
          orderedPageWordLineNumbers = pageWordLineNumbers(lineWords);
        }
      }
    }
    const lastAyahLineNumber = lineLayout!
      .filter((line) => line.line_type === "ayah")
      .at(-1)?.line_number ?? null;

    const renderStructuralLine = (line: PageLineLayout) => {
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
        const bismillahSelectionProps =
          Platform.OS === "web" && line.surah_number
            ? ({
                selectable: true,
                dataSet: {
                  hafizQuranToken: "word",
                  hafizSurah: String(line.surah_number),
                  hafizAyah: "1",
                  hafizWordPos: "-1",
                  hafizLiteralText: BISMILLAH_UTHMANI,
                  hafizQuranHidden: "false",
                },
              } as any)
            : {};
        return (
          <View
            key={`line-${line.line_number}-bism`}
            className="items-center"
            style={{ height: bismHeight, justifyContent: "center" }}
          >
            <Text
              {...bismillahSelectionProps}
              className="text-charcoal dark:text-neutral-200 text-center"
              style={{
                fontFamily: surahNameFontName(),
                fontSize: fontSize * 0.85,
                lineHeight: lineHeight * 0.85,
                opacity: surahNameFontReady ? 1 : 0,
                writingDirection: "rtl",
                ...(Platform.OS === "web" ? ({ userSelect: "text" } as any) : null),
              }}
            >
              {surahNameBismillahGlyphs()}
            </Text>
          </View>
        );
      }

      return null;
    };

    const renderQuranLine = (
      key: string,
      lineNumber: number,
      words: string[],
      lineStartIndex: number,
      centered: boolean,
    ) => {
      if (words.length === 0) return null;
      const shouldStretchLine = !centered && words.length > 1;
      const lineHeightStyle = allowLineWrap ? visualLineHeight : lineHeight;
      const lineGap = pageNumber === 2 && lineNumber === 4 ? fontSize * 0.12 : fontSize * 0.28;

      return (
        <View
          key={key}
          style={{
            direction: "ltr",
            flexDirection: "row-reverse",
            flexWrap: allowLineWrap ? "wrap" : "nowrap",
            justifyContent: shouldStretchLine && !allowLineWrap ? "space-between" : "center",
            width: contentWidth,
            minHeight: lineHeightStyle,
            height: allowLineWrap ? undefined : lineHeightStyle,
            gap: shouldStretchLine && !allowLineWrap ? undefined : lineGap,
            rowGap: allowLineWrap ? Math.max(2, fontSize * 0.12) : undefined,
            alignItems: "center",
            alignContent: "center",
            paddingHorizontal: 0,
            overflow: "visible",
          }}
        >
          {words.map((w, i) => {
            const identity = pageGlyphs[lineStartIndex + i]?.identity;
            if (identity && !identity.isMarker) {
              const isTargetWord =
                highlightedWord &&
                highlightedWord.surah === identity.surah &&
                highlightedWord.ayah === identity.ayah &&
                highlightedWord.wordPos === identity.wordPos;
              const isTargetAyah =
                !highlightedWord &&
                highlightedAyahKey === `${identity.surah}:${identity.ayah}`;
              const hlColor =
                isTargetWord || isTargetAyah
                  ? "#0d9488"
                  : getWordHighlightColor(identity.surah, identity.ayah, identity.wordPos) ??
                    getHighlightColor(identity.surah, identity.ayah);
              return (
                <WordToken
                  key={`w-${lineNumber}-${i}`}
                  glyph={w}
                  fontFamily={fontFamily}
                  fontPalette={fontPaletteStyle?.fontPalette ?? null}
                  fontSize={fontSize}
                  lineHeight={lineHeight}
                  surah={identity.surah}
                  ayah={identity.ayah}
                  wordPos={identity.wordPos}
                  v2Page={pageNumber}
                  highlightColor={hlColor}
                  hidden={isHifzWordHidden(identity)}
                  compactLayout
                />
              );
            }
            // Ayah end marker — opens ayah details modal
            if (identity && identity.isMarker) {
              if (!showAyahMarkers) return null;
              const isTargetAyah =
                !highlightedWord &&
                highlightedAyahKey === `${identity.surah}:${identity.ayah}`;
              return (
                <Pressable
                  key={`w-${lineNumber}-${i}`}
                  onPress={() => handleMarkerPress(identity.surah, identity.ayah)}
                  onLongPress={() => handleMarkerLongPress(identity.surah, identity.ayah)}
                  delayLongPress={300}
                  {...(Platform.OS === "web"
                    ? ({
                        dataSet: {
                          hafizQuranToken: "marker",
                          hafizSurah: String(identity.surah),
                          hafizAyah: String(identity.ayah),
                          hafizWordPos: "0",
                          hafizAyahMarker: "true",
                          hafizQuranHidden: "false",
                        },
                      } as any)
                    : {})}
                  style={({ pressed }) => ({
                    transform: [{ scale: pressed ? 0.95 : 1 }],
                    // @ts-ignore
                    cursor: "pointer",
                    ...(Platform.OS === "web" ? ({ userSelect: "text" } as any) : null),
                  })}
                >
                  <Text
                    selectable={Platform.OS === "web"}
                    className="text-charcoal dark:text-neutral-100"
                    style={{
                      fontFamily,
                      ...markerFontPaletteStyle,
                      fontSize,
                      lineHeight,
                      paddingHorizontal: 0,
                      writingDirection: "rtl",
                      ...(Platform.OS === "web" ? ({ userSelect: "text" } as any) : null),
                      ...(isTargetAyah && {
                        backgroundColor: "rgba(13, 148, 136, 0.125)",
                        borderRadius: 6,
                      }),
                    }}
                  >
                    {w}
                  </Text>
                </Pressable>
              );
            }
            // No identity fallback
            return (
              <Text
                key={`w-${lineNumber}-${i}`}
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily, ...fontPaletteStyle, fontSize, lineHeight, paddingHorizontal: 0 }}
              >
                {w}
              </Text>
            );
          })}
        </View>
      );
    };

    if (usePageWords) {
      const structuralLinesByNumber = new Map<number, PageLineLayout[]>();
      const ayahLineByNumber = new Map<number, PageLineLayout>();
      for (const line of lineLayout!) {
        if (line.line_type === "ayah") {
          ayahLineByNumber.set(line.line_number, line);
          continue;
        }
        const lines = structuralLinesByNumber.get(line.line_number) ?? [];
        lines.push(line);
        structuralLinesByNumber.set(line.line_number, lines);
      }

      let wordIndex = 0;
      const rows = [];
      const orderedLineNumbers = Array.from(new Set([
        ...lineLayout!.map((line) => line.line_number),
        ...orderedPageWordLineNumbers,
      ])).sort((a, b) => a - b);

      for (const lineNumber of orderedLineNumbers) {
        for (const line of structuralLinesByNumber.get(lineNumber) ?? []) {
          rows.push(renderStructuralLine(line));
        }

        const words = splitGlyphs(lineWords[String(lineNumber)]);
        if (words.length === 0) continue;
        const lineStartIndex = wordIndex;
        wordIndex += words.length;
        const centered = ayahLineByNumber.get(lineNumber)?.is_centered === 1;
        rows.push(renderQuranLine(`line-${lineNumber}-quran`, lineNumber, words, lineStartIndex, centered));
      }

      content = rows;
    } else {
      content = lineLayout.map((line) => {
        if (line.line_type !== "ayah") {
          return renderStructuralLine(line);
        }

        if (
          typeof line.first_word_id !== "number" ||
          typeof line.last_word_id !== "number" ||
          typeof globalWordOffset !== "number"
        ) {
          return null;
        }

        const lineStartIndex = Math.max(0, line.first_word_id - globalWordOffset - 1);
        let lineEndIndex = Math.max(lineStartIndex, line.last_word_id - globalWordOffset);
        if (line.line_number === lastAyahLineNumber && lineEndIndex < pageGlyphs.length) {
          lineEndIndex = pageGlyphs.length;
        }
        const words = pageGlyphs.slice(lineStartIndex, lineEndIndex).map((token) => token.glyph);
        return renderQuranLine(
          `line-${line.line_number}`,
          line.line_number,
          words,
          lineStartIndex,
          line.is_centered === 1,
        );
      });
    }
  } else {
    // Fallback: render ayahs as continuous text (shouldn't happen with layout data)
    content = (
      <Text
        className="text-charcoal dark:text-neutral-100"
        style={{
          fontFamily,
          ...fontPaletteStyle,
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
