import { View, Text } from "react-native";

type Props = {
  surah: number;
  ayah: number;
  text: string;
  fontSize: number;
  lineHeight: number;
};

function toArabicNumber(num: number): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return String(num).replace(/\d/g, (d) => arabicDigits[parseInt(d, 10)]);
}

export function AyahBlock({ surah, ayah, text, fontSize, lineHeight }: Props) {
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

      {/* Arabic text */}
      <View className="px-2 pb-4 pt-1">
        <Text
          className="text-warm-900 dark:text-neutral-100"
          style={{
            fontFamily: "UthmanicHafs",
            fontSize,
            lineHeight,
            textAlign: "right",
            writingDirection: "rtl",
          }}
        >
          {text}
          {"  "}
          <Text
            className="text-teal-600 dark:text-teal-400"
            style={{
              fontFamily: "UthmanicHafs",
              fontSize: fontSize * 0.75,
            }}
          >
            ﴿{toArabicNumber(ayah)}﴾
          </Text>
        </Text>
      </View>
    </View>
  );
}
