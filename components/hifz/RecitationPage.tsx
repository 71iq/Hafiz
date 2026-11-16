import { Fragment, useMemo, useRef } from "react";
import { PanResponder, Text, View, type LayoutChangeEvent } from "react-native";
import { quranPageFontName, quranPageFontPaletteStyle, quranPageMarkerFontPaletteStyle } from "@/lib/fonts/loader";
import { useQuranPageFontReady } from "@/lib/fonts/use-quran-page-font";
import type { PageLine, PageToken, RecitationPage as PageData } from "@/lib/hifz/page-data";
import type { SupportLevel } from "@/lib/hifz/grading";
import { useSettings } from "@/lib/settings/context";

const BASMALA = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";
const LINE_WIDTH_SCALE = 19.5;

export type RevealState = Readonly<{
  all: boolean;
  count: number;
  touchedLines: ReadonlySet<number>;
}>;

export const HIDDEN: RevealState = { all: false, count: 0, touchedLines: new Set() };

function tokenKey(token: Pick<PageToken, "surah" | "ayah" | "wordPos" | "glyph">, index: number): string {
  return `${token.surah}:${token.ayah}:${token.wordPos ?? "m"}:${index}`;
}

export function visibleLines(page: PageData, lineNumbers: ReadonlySet<number> | null): PageLine[] {
  return page.lines.filter((line) => lineNumbers === null || lineNumbers.has(line.lineNumber));
}

export function orderedTokens(lines: readonly PageLine[]): PageToken[] {
  return lines.flatMap((line) => line.tokens);
}

type Props = {
  page: PageData;
  level: SupportLevel;
  reveal: RevealState;
  lineNumbers?: ReadonlySet<number> | null;
  cloze?: Readonly<{ surah: number; ayah: number; wordPos: number }> | null;
  surahNames: ReadonlyMap<number, string>;
  marked?: ReadonlySet<string>;
  onWordPress?: (token: PageToken, key: string) => void;
  onTouchLine?: (lineNumber: number) => void;
  isDark: boolean;
  width: number;
  wordLabel: (token: PageToken) => string;
};

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
  const lineLayouts = useRef(new Map<number, { y: number; height: number }>());
  const containerRef = useRef<View>(null);
  const containerTop = useRef(0);
  const fontSize = Math.max(14, Math.min(30, Math.floor((width - 24) / LINE_WIDTH_SCALE)));
  const lineHeight = Math.round(fontSize * 1.9);

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
  const faint = isDark ? "rgba(245,245,245,0.08)" : "rgba(31,27,22,0.07)";
  const markedBackground = isDark ? "rgba(251, 191, 36, 0.28)" : "rgba(217, 119, 6, 0.18)";
  const gapBackground = isDark ? "rgba(45, 212, 191, 0.16)" : "rgba(13, 148, 136, 0.12)";

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
        return (
          <View
            key={`line-${line.lineNumber}`}
            onLayout={(event: LayoutChangeEvent) => {
              lineLayouts.current.set(line.lineNumber, { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height });
            }}
          >
            <Text
              style={{ fontFamily, ...palette, fontSize, lineHeight, textAlign: "center", color: ink, writingDirection: "rtl" }}
            >
              {line.tokens.map((token, offset) => {
                const index = start + offset;
                const key = tokenKey(token, index);
                const shownByPointer = index < reveal.count;
                const isGap =
                  cloze !== null && token.surah === cloze.surah && token.ayah === cloze.ayah && token.wordPos === cloze.wordPos;
                const visible = isGap
                  ? reveal.all
                  : reveal.all || level === 0 || token.isMarker || shownByPointer || (level === 3 && lineTouched);
                const firstLetterOnly = !visible && level === 1;
                const isMarked = marked?.has(key) ?? false;
                const color = visible ? undefined : firstLetterOnly ? undefined : level === 3 ? faint : "transparent";
                const pressable = reveal.all && !token.isMarker && onWordPress;
                return (
                  <Fragment key={key}>
                    {firstLetterOnly ? (
                      <Text style={{ fontFamily: undefined, fontSize: fontSize * 0.9, color: ink }}>
                        {token.firstLetter ?? "ـ"}
                      </Text>
                    ) : (
                      <Text
                        onPress={pressable ? () => onWordPress!(token, key) : undefined}
                        accessibilityRole={pressable ? "button" : undefined}
                        accessibilityLabel={pressable ? wordLabel(token) : undefined}
                        accessibilityState={pressable ? { selected: isMarked } : undefined}
                        style={{
                          ...(token.isMarker ? markerPalette : null),
                          color,
                          backgroundColor: isMarked ? markedBackground : isGap && !visible ? gapBackground : undefined,
                          ...(isGap && !visible ? { borderRadius: 6 } : null),
                        }}
                      >
                        {token.glyph}
                      </Text>
                    )}
                    {offset < line.tokens.length - 1 ? " " : null}
                  </Fragment>
                );
              })}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
