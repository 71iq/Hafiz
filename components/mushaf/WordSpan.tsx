import { Fragment, memo, useCallback, useRef, type ReactNode } from "react";
import { Text, type GestureResponderEvent, type StyleProp, type TextStyle } from "react-native";
import { useWordInteraction } from "@/lib/word/context";
import { useChrome } from "@/lib/ui/chrome";
import { useWordTap } from "./useWordTap";

type Props = {
  glyph: string;
  surah: number;
  ayah: number;
  wordPos: number;
  v2Page: number;
  fontSize: number;
  lineHeight: number;
  highlightColor?: string;
  onPressIn?: (wordPos: number) => void;
};

/**
 * One tappable word nested inside an ayah's single Text. On Android each separate Text is clipped
 * to its own box, which cut page-font word glyphs that draw outside their advance; a nested span
 * shares the ayah's text layout and draws completely. The tooltip anchors to the touch point.
 */
function WordSpanInner({
  glyph,
  surah,
  ayah,
  wordPos,
  v2Page,
  fontSize,
  lineHeight,
  highlightColor,
  onPressIn,
}: Props) {
  const { isTooltipSelected, press, longPress } = useWordTap({ surah, ayah, wordPos, v2Page });

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      const { pageX, pageY } = event.nativeEvent;
      press((done) =>
        done({ x: pageX - fontSize / 2, y: pageY - lineHeight / 2, width: fontSize, height: lineHeight }),
      );
    },
    [press, fontSize, lineHeight],
  );

  const backgroundColor = highlightColor
    ? highlightColor + "20"
    : isTooltipSelected
      ? "rgba(13, 148, 136, 0.08)"
      : undefined;

  return (
    <Text
      onPress={handlePress}
      onPressIn={onPressIn ? () => onPressIn(wordPos) : undefined}
      onLongPress={longPress}
      suppressHighlighting
      className={isTooltipSelected ? "text-primary-accent dark:text-primary-bright" : undefined}
      style={backgroundColor ? { backgroundColor } : undefined}
    >
      {glyph}
    </Text>
  );
}

const WordSpan = memo(WordSpanInner);

type AyahWordTextProps = {
  words: string[];
  marker?: ReactNode;
  surah: number;
  ayah: number;
  v2Page: number;
  fontSize: number;
  lineHeight: number;
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  wordHighlightColor: (wordPos: number) => string | undefined;
};

/**
 * One Text for a whole ayah with nested word spans. Android does not deliver long presses to nested
 * spans, so each span records the word under the finger and the ayah Text opens its detail sheet.
 */
export function AyahWordText({
  words,
  marker,
  surah,
  ayah,
  v2Page,
  fontSize,
  lineHeight,
  className,
  style,
  testID,
  wordHighlightColor,
}: AyahWordTextProps) {
  const { openDetail } = useWordInteraction();
  const { markActivity } = useChrome();
  const pressedWordRef = useRef<number | null>(null);
  const recordWord = useCallback((wordPos: number) => {
    pressedWordRef.current = wordPos;
  }, []);
  const handleLongPress = useCallback(() => {
    const wordPos = pressedWordRef.current;
    pressedWordRef.current = null;
    if (wordPos === null) return;
    markActivity();
    openDetail({ surah, ayah, wordPos, v2Page });
  }, [markActivity, openDetail, surah, ayah, v2Page]);
  // A touch that ends without a long press forgets its word, so a later long press on a gap or
  // the marker never opens a stale word.
  const forgetWord = useCallback(() => {
    pressedWordRef.current = null;
  }, []);

  return (
    <Text testID={testID} className={className} style={style} onLongPress={handleLongPress} onPressOut={forgetWord}>
      {words.map((glyph, i) => {
        const wordPos = i + 1;
        return (
          <Fragment key={`${surah}-${ayah}-w${i}`}>
            <WordSpan
              glyph={glyph}
              surah={surah}
              ayah={ayah}
              wordPos={wordPos}
              v2Page={v2Page}
              fontSize={fontSize}
              lineHeight={lineHeight}
              highlightColor={wordHighlightColor(wordPos)}
              onPressIn={recordWord}
            />{" "}
          </Fragment>
        );
      })}
      {marker}
    </Text>
  );
}
