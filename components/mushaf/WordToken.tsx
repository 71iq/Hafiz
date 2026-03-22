import { memo, useCallback, useRef } from "react";
import { Text, Pressable, Platform, View } from "react-native";
import { useWordInteraction } from "@/lib/word/context";

type Props = {
  glyph: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  surah: number;
  ayah: number;
  wordPos: number;
  v2Page: number;
  disabled?: boolean;
};

function WordTokenInner({
  glyph,
  fontFamily,
  fontSize,
  lineHeight,
  surah,
  ayah,
  wordPos,
  v2Page,
  disabled = false,
}: Props) {
  const { tooltipWord, setTooltipWord, openDetail } = useWordInteraction();
  const tokenRef = useRef<View>(null);

  const isSelected =
    tooltipWord !== null &&
    tooltipWord.surah === surah &&
    tooltipWord.ayah === ayah &&
    tooltipWord.wordPos === wordPos;

  const wordRef = { surah, ayah, wordPos, v2Page };

  const handlePress = useCallback(() => {
    if (disabled) return;
    tokenRef.current?.measureInWindow((x, y, width, height) => {
      setTooltipWord(wordRef, { x, y, width, height });
    });
  }, [disabled, surah, ayah, wordPos, v2Page, setTooltipWord]);

  const handleLongPress = useCallback(() => {
    if (disabled) return;
    openDetail(wordRef);
  }, [disabled, surah, ayah, wordPos, v2Page, openDetail]);

  const webProps =
    Platform.OS === "web" && !disabled
      ? {
          onHoverIn: () => {
            tokenRef.current?.measureInWindow((x, y, width, height) => {
              setTooltipWord(wordRef, { x, y, width, height });
            });
          },
        }
      : {};

  return (
    <Pressable
      ref={tokenRef as any}
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={400}
      {...webProps}
    >
      <Text
        className={
          isSelected
            ? "text-primary-accent dark:text-primary-bright"
            : "text-charcoal dark:text-neutral-100"
        }
        style={{
          fontFamily,
          fontSize,
          lineHeight,
          ...(isSelected && {
            backgroundColor: "rgba(13, 148, 136, 0.08)",
            borderRadius: 6,
          }),
        }}
      >
        {glyph}
      </Text>
    </Pressable>
  );
}

export const WordToken = memo(WordTokenInner);
