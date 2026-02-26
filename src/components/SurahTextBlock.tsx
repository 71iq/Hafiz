import { memo, useState, useCallback } from "react";
import { View, type GestureResponderEvent } from "react-native";
import { Text as RNText } from "react-native";
import { useSettings } from "../context/SettingsContext";
import type { Ayah } from "../db/database";

const ARABIC_INDIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

function toArabicIndic(n: number): string {
  return String(n)
    .split("")
    .map((d) => ARABIC_INDIC_DIGITS[parseInt(d, 10)])
    .join("");
}

interface SurahTextBlockProps {
  ayahs: Ayah[];
  surahName: string;
  onLongPress: (ayah: Ayah, surahName: string, y: number) => void;
}

export default memo(function SurahTextBlock({
  ayahs,
  surahName,
  onLongPress,
}: SurahTextBlockProps) {
  const { fontSize, hideAyahs } = useSettings();
  const [revealedAyahs, setRevealedAyahs] = useState<Set<string>>(new Set());

  const toggleReveal = useCallback(
    (surah: number, ayah: number) => {
      if (!hideAyahs) return;
      const key = `${surah}:${ayah}`;
      setRevealedAyahs((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [hideAyahs]
  );

  return (
    <View className="px-5 pb-4">
      <RNText
        style={{
          fontFamily: "AmiriQuran",
          fontSize,
          lineHeight: fontSize * 2.2,
          writingDirection: "rtl",
          textAlign: "right",
        }}
      >
        {ayahs.map((ayah) => {
          const key = `${ayah.surah}:${ayah.ayah}`;
          const isHidden = hideAyahs && !revealedAyahs.has(key);
          const marker = ` \uFD3F${toArabicIndic(ayah.ayah)}\uFD3E `;

          return (
            <RNText
              key={key}
              onPress={() => toggleReveal(ayah.surah, ayah.ayah)}
              onLongPress={(e: GestureResponderEvent) => {
                onLongPress(ayah, surahName, e.nativeEvent.pageY);
              }}
              style={{
                color: isHidden ? "transparent" : undefined,
              }}
              className="text-foreground"
            >
              {ayah.text_uthmani}
              {marker}
            </RNText>
          );
        })}
      </RNText>
    </View>
  );
});
