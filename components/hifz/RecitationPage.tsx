import { Fragment, useMemo, useRef } from "react";
import { PanResponder, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { quranPageFontName, quranPageFontPaletteStyle, quranPageMarkerFontPaletteStyle } from "@/lib/fonts/loader";
import { useQuranPageFontReady } from "@/lib/fonts/use-quran-page-font";
import type { PageLine, PageToken, RecitationPage as PageData } from "@/lib/hifz/page-data";
import type { SupportLevel } from "@/lib/hifz/grading";
import { useSettings } from "@/lib/settings/context";

const BASMALA = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";
/** Page-font glyphs fill a line at about this many font sizes (the reader's MUSHAF_LINE_WIDTH_SCALE). */
const LINE_WIDTH_SCALE = 19.5;
/**
 * The ink of a hidden word. Android's renderer reads a color of 0, fully transparent black, as no
 * color at all, so a "transparent" word inherits the line's ink and shows. One step of alpha is still
 * a color there and draws nothing visible.
 */
const HIDDEN_INK = "rgba(0, 0, 0, 0.004)";
/**
 * The space between two words while words can be tapped. Android maps a tap to the nearest character
 * boundary, then to the shortest text span touching it. A word is a single glyph, as short as a plain
 * space, so on a word's edge the space's span could win and the tap was lost: about half of every word
 * ignored taps. Word joiners have no width and do not move a line break; before the space they make
 * every gap longer than any word, so a tap anywhere on a word reaches that word.
 */
const TAP_GAP = Platform.OS === "android" ? "\u2060\u2060\u2060 " : " ";
const SCREEN_READER_ONLY = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  opacity: 0,
  userSelect: "none",
} as const;

export type RevealState = Readonly<{
  /** Every word shows: the self-check after Done, or full-text practice. */
  all: boolean;
  /** Words shown in reading order from the start of the page (Peek, Show me, Next line). */
  count: number;
  /** L3: lines the finger has passed over. */
  touchedLines: ReadonlySet<number>;
}>;

export const HIDDEN: RevealState = { all: false, count: 0, touchedLines: new Set() };

function tokenKey(token: Pick<PageToken, "surah" | "ayah" | "wordPos" | "glyph">, index: number): string {
  return `${token.surah}:${token.ayah}:${token.wordPos ?? "m"}:${index}`;
}

function ayahKey(token: Pick<PageToken, "surah" | "ayah">): string {
  return `${token.surah}:${token.ayah}`;
}

/** Ayah lines in reading order, limited to the given line numbers (a half page). */
export function visibleLines(page: PageData, lineNumbers: ReadonlySet<number> | null): PageLine[] {
  return page.lines.filter((line) => lineNumbers === null || lineNumbers.has(line.lineNumber));
}

/** The reading-order tokens of the shown lines, markers included. */
export function orderedTokens(lines: readonly PageLine[]): PageToken[] {
  return lines.flatMap((line) => line.tokens);
}

type Props = {
  page: PageData;
  level: SupportLevel;
  reveal: RevealState;
  /** Line numbers to show, for a half page; null shows the whole page. */
  lineNumbers?: ReadonlySet<number> | null;
  /** ERR-06 "Fill the gap": this one word stays hidden until the check, whatever the level. */
  cloze?: Readonly<{ surah: number; ayah: number; wordPos: number }> | null;
  surahNames: ReadonlyMap<number, string>;
  /** Marked mistakes by token key, shown highlighted during the self-check. */
  marked?: ReadonlySet<string>;
  onWordPress?: (token: PageToken, key: string) => void;
  onTouchLine?: (lineNumber: number) => void;
  isDark: boolean;
  width: number;
  wordLabel: (token: PageToken) => string;
};

/**
 * One mushaf page for recitation (4.5.1), drawn from the canonical page-font glyphs with the
 * reader's line breaks, so the page looks like the one the user memorized. Hidden words keep their
 * place (drawn in HIDDEN_INK) and ayah markers stay visible. L1 draws each word's first letter, which
 * is rendered from the canonical text and never stored (ETH-12).
 */
export function RecitationPage({
  page,
  level,
  reveal,
  lineNumbers = null,
  cloze = null,
  surahNames,
  marked,
  onWordPress,
  onTouchLine,
  isDark,
  width,
  wordLabel,
}: Props) {
  const { quranRenderFontStyle, effectiveTheme, quranMarkerStyle } = useSettings();
  const ready = useQuranPageFontReady(quranRenderFontStyle, page.page);
  const lines = useMemo(() => visibleLines(page, lineNumbers), [page, lineNumbers]);
  const selectedTokenCounts = useMemo(() => {
    if (lineNumbers === null) return null;
    const counts = new Map<string, number>();
    for (const line of lines) {
      for (const token of line.tokens) {
        const key = ayahKey(token);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [lineNumbers, lines]);
  const lineLayouts = useRef(new Map<number, { y: number; height: number }>());
  const containerRef = useRef<View>(null);
  const containerTop = useRef(0);
  const fontSize = Math.max(14, Math.min(30, Math.floor((width - 24) / LINE_WIDTH_SCALE)));
  const lineHeight = Math.round(fontSize * 1.9);

  // L3: a sideways swipe reveals the lines under the finger; vertical moves still scroll the page.
  const panResponder = useMemo(() => {
    const touchAt = (screenY: number) => {
      if (!onTouchLine) return;
      const y = screenY - containerTop.current;
      for (const [lineNumber, box] of lineLayouts.current) {
        if (y >= box.y && y <= box.y + box.height) onTouchLine(lineNumber);
      }
    };
    const active = level === 3 && !reveal.all;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) => active && Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 4,
      // The page scrolls, so measure where it is now before mapping the finger to a line.
      onPanResponderGrant: (_event, gesture) => {
        const y0 = gesture.y0;
        containerRef.current?.measureInWindow((_x, top) => {
          containerTop.current = top;
          touchAt(y0);
        });
      },
      onPanResponderMove: (_event, gesture) => touchAt(gesture.moveY),
    });
  }, [level, reveal.all, onTouchLine]);

  if (!ready) return <View style={{ minHeight: lineHeight * 15 }} />;

  const fontFamily = quranPageFontName(quranRenderFontStyle, page.page);
  const palette = quranPageFontPaletteStyle(quranRenderFontStyle, page.page, effectiveTheme);
  const markerPalette = quranPageMarkerFontPaletteStyle(quranRenderFontStyle, page.page, effectiveTheme, quranMarkerStyle);
  const ink = isDark ? "#f5f5f5" : "#1f1b16";
  const faintOpacity = isDark ? 0.08 : 0.07;
  const faint = isDark ? `rgba(245,245,245,${faintOpacity})` : `rgba(31,27,22,${faintOpacity})`;
  const markedBackground = isDark ? "rgba(251, 191, 36, 0.28)" : "rgba(217, 119, 6, 0.18)";
  const gapBackground = isDark ? "rgba(45, 212, 191, 0.16)" : "rgba(13, 148, 136, 0.12)";

  const web = Platform.OS === "web";
  const markWord = reveal.all ? onWordPress : undefined;
  let tokenIndex = 0;
  return (
    <View
      ref={containerRef}
      {...panResponder.panHandlers}
      onLayout={() => {
        containerRef.current?.measureInWindow((_x, y) => {
          containerTop.current = y;
        });
      }}
      style={{ width, alignSelf: "center", paddingHorizontal: 12, direction: "rtl" }}
    >
      {lines.map((line) => {
        if (line.kind === "surah_name") {
          return (
            <Text
              key={`surah-${line.lineNumber}`}
              style={{ textAlign: "center", fontSize: fontSize * 0.75, lineHeight, color: ink, writingDirection: "rtl" }}
            >
              {line.surahNumber ? `سورة ${surahNames.get(line.surahNumber) ?? ""}` : ""}
            </Text>
          );
        }
        if (line.kind === "basmallah") {
          return (
            <Text key={`basmala-${line.lineNumber}`} style={{ textAlign: "center", fontSize: fontSize * 0.8, lineHeight, color: ink, writingDirection: "rtl" }}>
              {BASMALA}
            </Text>
          );
        }
        const lineTouched = reveal.touchedLines.has(line.lineNumber);
        const start = tokenIndex;
        tokenIndex += line.tokens.length;
        const words = line.tokens.map((token, offset) => {
          const index = start + offset;
          const key = tokenKey(token, index);
          const isGap = cloze !== null && token.surah === cloze.surah && token.ayah === cloze.ayah && token.wordPos === cloze.wordPos;
          const visible =
            reveal.all || (!isGap && (level === 0 || token.isMarker || index < reveal.count || (level === 3 && lineTouched)));
          const firstLetterOnly = !visible && !isGap && level === 1;
          const unaligned = token.unalignedAyah;
          const wholeAyahVisible =
            unaligned !== undefined &&
            (reveal.all || (level === 0 && (cloze === null || ayahKey(cloze) !== ayahKey(token)))) &&
            (selectedTokenCounts === null || selectedTokenCounts.get(ayahKey(token)) === unaligned.tokenCount);
          const spoken = visible
            ? token.text ?? (wholeAyahVisible ? unaligned.text : undefined)
            : firstLetterOnly ? token.firstLetter : undefined;
          const isMarked = marked?.has(key) ?? false;
          const onPress = markWord && !token.isMarker ? () => markWord(token, key) : undefined;
          const label = onPress ? [spoken, wordLabel(token)].filter(Boolean).join(", ") : undefined;
          return { token, key, isGap, visible, firstLetterOnly, spoken, isMarked, onPress, label };
        });
        const spokenLine = markWord ? "" : words.map((word) => word.spoken).filter(Boolean).join(" ");
        return (
          <View
            key={`line-${line.lineNumber}`}
            onLayout={(event: LayoutChangeEvent) => {
              lineLayouts.current.set(line.lineNumber, { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height });
            }}
          >
            <Text
              // Native flattens inline text into one view. Web can keep the inline buttons exposed.
              aria-hidden={!web || !markWord}
              selectable={false}
              style={{ fontFamily, ...palette, fontSize, lineHeight, textAlign: "center", color: ink, writingDirection: "rtl" }}
            >
              {words.map(({ token, key, isGap, visible, firstLetterOnly, isMarked, onPress, label }, offset) => (
                <Fragment key={key}>
                  {firstLetterOnly ? (
                    <Text style={{ fontFamily: undefined, fontSize: fontSize * 0.9, color: ink }}>
                      {token.firstLetter ?? "ـ"}
                    </Text>
                  ) : (
                    <Text
                      onPress={onPress}
                      role={web && onPress ? "button" : undefined}
                      accessibilityLabel={web ? label : undefined}
                      aria-pressed={web && onPress ? isMarked : undefined}
                      aria-hidden={web && markWord && !onPress ? true : undefined}
                      style={{
                        ...(token.isMarker ? markerPalette : null),
                        color: web || visible ? undefined : level === 3 && !isGap ? faint : HIDDEN_INK,
                        // The gap keeps its place and shows as a soft box, so the reciter knows where it is.
                        backgroundColor: isMarked ? markedBackground : isGap && !visible ? gapBackground : undefined,
                        ...(isGap && !visible ? { borderRadius: 6 } : null),
                      }}
                    >
                      {web && (onPress || !visible) ? (
                        // Color fonts can paint independently of the text color.
                        <Text aria-hidden style={visible ? undefined : { opacity: level === 3 && !isGap ? faintOpacity : 0 }}>
                          {token.glyph}
                        </Text>
                      ) : token.glyph}
                    </Text>
                  )}
                  {offset < words.length - 1 ? (markWord ? TAP_GAP : " ") : null}
                </Fragment>
              ))}
            </Text>
            {spokenLine ? (
              web ? (
                <Text style={SCREEN_READER_ONLY} {...{ lang: "ar" }}>
                  {spokenLine}
                </Text>
              ) : (
                <View accessible accessibilityLabel={spokenLine} accessibilityLanguage="ar" pointerEvents="none" style={StyleSheet.absoluteFill} />
              )
            ) : null}
            {!web && markWord ? (
              // Inline text handles glyph taps. Native views supply screen-reader activation.
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { flexDirection: "row" }]}>
                {words.map(({ key, onPress, label, isMarked }) =>
                  onPress ? (
                    <Pressable
                      key={key}
                      onPress={onPress}
                      onAccessibilityTap={onPress}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      accessibilityState={{ selected: isMarked }}
                      style={{ flex: 1 }}
                    />
                  ) : (
                    <View key={key} style={{ flex: 1 }} />
                  ),
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
