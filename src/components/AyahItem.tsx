import { memo, useState, useCallback } from "react";
import { Pressable, type GestureResponderEvent } from "react-native";
import { useSettings } from "../context/SettingsContext";
import type { Ayah } from "../db/database";
import { Text } from "./ui/text";

const ARABIC_INDIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

function toArabicIndic(n: number): string {
  return String(n)
    .split("")
    .map((d) => ARABIC_INDIC_DIGITS[parseInt(d, 10)])
    .join("");
}

interface AyahItemProps {
  ayah: Ayah;
  surahName: string;
  onLongPress: (ayah: Ayah, surahName: string, y: number) => void;
}

export default memo(function AyahItem({
  ayah,
  surahName,
  onLongPress,
}: AyahItemProps) {
  const { fontSize, hideAyahs } = useSettings();
  const [revealed, setRevealed] = useState(false);

  const isHidden = hideAyahs && !revealed;

  const handlePress = useCallback(() => {
    if (hideAyahs) setRevealed((prev) => !prev);
  }, [hideAyahs]);

  const handleLongPress = useCallback(
    (e: GestureResponderEvent) => {
      const y = e.nativeEvent.pageY;
      onLongPress(ayah, surahName, y);
    },
    [ayah, surahName, onLongPress]
  );

  const marker = ` \uFD3F${toArabicIndic(ayah.ayah)}\uFD3E`;

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      className={`px-5 py-3 ${isHidden ? "bg-amber-100 dark:bg-amber-950" : ""}`}
    >
      <Text
        style={{
          fontFamily: "AmiriQuran",
          fontSize,
          lineHeight: fontSize * 2,
          writingDirection: "rtl",
          textAlign: "right",
          color: isHidden ? "transparent" : undefined,
        }}
        className={`text-foreground ${isHidden ? "select-none" : ""}`}
      >
        {ayah.text_uthmani}
        {marker}
      </Text>
    </Pressable>
  );
});
