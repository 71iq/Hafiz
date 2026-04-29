import { memo, useEffect, useState, useMemo, useCallback } from "react";
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
};

// Identity for a single visual word on the page
type WordIdentity = {
  surah: number;
  ayah: number;
  wordPos: number;
  isMarker: boolean;
};

// QCF2 Basmallah: 4 word glyphs from page 1's font (Surah 1 Ayah 1 = the Basmallah)
const BISMILLAH_QCF2 = "\uFC41 \uFC42 \uFC43 \uFC44";

// Content width scales with font size — a standard Mushaf line fills this width
const FONT_WIDTH_SCALE = 19;

/**
 * Build a flat ordered list of word identities from the page's ayahs.
 * Each QCF2 token gets an identity. The last token of each ayah is the end marker.
 */
function buildWordIdentities(ayahs: AyahData[]): WordIdentity[] {
  const identities: WordIdentity[] = [];
  for (const a of ayahs) {
    const tokens = a.textQcf2.split(" ").filter(Boolean);
    if (tokens.length === 0) continue;
    // All tokens except last are real words; last is ayah end marker
    for (let i = 0; i < tokens.length - 1; i++) {
      identities.push({
        surah: a.surah,
        ayah: a.ayah,
        wordPos: i + 1,
        isMarker: false,
      });
    }
    // Last token is the ayah marker
    identities.push({
      surah: a.surah,
      ayah: a.ayah,
      wordPos: 0,
      isMarker: true,
    });
  }
  return identities;
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
}: Props) {
  const [fontVisible, setFontVisible] = useState(false);
  const [wordsLoaded, setWordsLoaded] = useState(!!pageWordsData);
  const { getHighlightColor } = useSelection();

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

  // Build word identities for this page
  const wordIdentities = useMemo(
    () => buildWordIdentities(ayahs),
    [ayahs],
  );

  const hasLineLayout = lineLayout && lineLayout.length > 0;
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
    const lineWords = (pageWordsData ?? [])[pageNumber - 1] ?? {};
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
        const bismHeight = lineHeight * 0.85 + 8;
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

      // Ayah line: get visual words and map to identities
      const lineText = lineWords[String(line.line_number + lineKeyOffset)];
      if (!lineText) return null;

      const words = lineText.split(/\s+/).filter(Boolean);
      if (words.length === 0) return null;

      const lineStartIndex = wordIndex;
      wordIndex += words.length;

      return (
        <View
          key={`line-${line.line_number}`}
          style={{
            direction: "ltr",
            flexDirection: "row-reverse",
            justifyContent: centered ? "center" : "space-between",
            width: contentWidth,
            height: lineHeight,
            gap: centered ? fontSize * 0.3 : undefined,
          }}
        >
          {words.map((w, i) => {
            const identity = wordIdentities[lineStartIndex + i];
            if (identity && !identity.isMarker) {
              const hlColor = getHighlightColor(identity.surah, identity.ayah);
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
                  onPress={() => onOpenAyahDetail?.(identity.surah, identity.ayah)}
                  onLongPress={() => onOpenAyahDetail?.(identity.surah, identity.ayah)}
                  delayLongPress={300}
                  style={({ pressed }) => ({
                    transform: [{ scale: pressed ? 0.95 : 1 }],
                    // @ts-ignore
                    cursor: "pointer",
                  })}
                >
                  <Text
                    className="text-charcoal dark:text-neutral-100"
                    style={{ fontFamily, fontSize, lineHeight }}
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
                style={{ fontFamily, fontSize, lineHeight }}
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

export const MushafPage = memo(MushafPageInner);
