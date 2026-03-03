import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import {
  loadQpcFont,
  qpcFontName,
  isQpcFontLoaded,
} from "@/lib/fonts/loader";

type Props = {
  surah: number;
  ayah: number;
  text: string;
  v2Page: number;
  fontSize: number;
  lineHeight: number;
};

export function AyahBlock({
  surah,
  ayah,
  text,
  v2Page,
  fontSize,
  lineHeight,
}: Props) {
  const [fontVisible, setFontVisible] = useState(() =>
    isQpcFontLoaded(v2Page)
  );

  useEffect(() => {
    if (isQpcFontLoaded(v2Page)) {
      setFontVisible(true);
      return;
    }
    let cancelled = false;
    loadQpcFont(v2Page).then(() => {
      if (!cancelled) {
        requestAnimationFrame(() => setFontVisible(true));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [v2Page]);

  return (
    <View className="border-b border-warm-100 dark:border-neutral-800 mx-4">
      {/* Ayah number badge */}
      <View className="flex-row items-center justify-between px-2 pt-3 pb-1">
        <View className="flex-row items-center gap-2">
          <View className="w-10 h-10 rounded-full bg-teal-50 dark:bg-teal-900/40 items-center justify-center border border-teal-200 dark:border-teal-700">
            <Text className="text-teal-700 dark:text-teal-300 text-xs font-semibold">
              {surah}:{ayah}
            </Text>
          </View>
        </View>
      </View>

      {/* Arabic text (QCF2) */}
      <View className="px-2 pb-4 pt-1">
        <Text
          className="text-warm-900 dark:text-neutral-100"
          style={{
            fontSize,
            lineHeight,
            textAlign: "right",
            writingDirection: "rtl",
            fontFamily: qpcFontName(v2Page),
            opacity: fontVisible ? 1 : 0,
          }}
        >
          {text}
        </Text>
      </View>
    </View>
  );
}
