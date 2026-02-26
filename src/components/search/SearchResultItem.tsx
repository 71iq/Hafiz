import { memo, useCallback } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useSettings } from "../../context/SettingsContext";
import { setPendingScroll } from "../../lib/deeplink";
import { Text } from "../ui/text";

interface SearchResultItemProps {
  surah: number;
  ayah: number;
  textUthmani: string;
  surahName?: string;
  highlight?: string;
}

export default memo(function SearchResultItem({
  surah,
  ayah,
  textUthmani,
  surahName,
  highlight,
}: SearchResultItemProps) {
  const { fontSize } = useSettings();
  const router = useRouter();

  const handlePress = useCallback(() => {
    setPendingScroll(surah, ayah);
    router.navigate("/(tabs)/");
  }, [surah, ayah, router]);

  return (
    <Pressable
      onPress={handlePress}
      className="px-4 py-3 border-b border-border active:bg-accent"
    >
      <View className="flex-row-reverse justify-between items-center mb-1">
        <Text className="text-xs text-primary font-medium">
          {surahName ? `${surahName} ` : ""}
          {surah}:{ayah}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: "AmiriQuran",
          fontSize: fontSize * 0.85,
          lineHeight: fontSize * 1.7,
          writingDirection: "rtl",
          textAlign: "right",
        }}
        className="text-foreground"
      >
        {textUthmani}
      </Text>
      {highlight ? (
        <Text
          style={{ writingDirection: "rtl", textAlign: "right" }}
          variant="muted"
          className="text-sm mt-1"
        >
          {highlight}
        </Text>
      ) : null}
    </Pressable>
  );
});
