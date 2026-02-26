import { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { setPendingScroll } from "../src/lib/deeplink";

export default function OpenScreen() {
  const { surah, ayah } = useLocalSearchParams<{ surah: string; ayah: string }>();
  const router = useRouter();

  useEffect(() => {
    const surahNum = parseInt(surah || "", 10);
    const ayahNum = parseInt(ayah || "", 10);

    if (surahNum > 0) {
      setPendingScroll(surahNum, ayahNum > 0 ? ayahNum : 1);
    }

    router.replace("/(tabs)/");
  }, [surah, ayah, router]);

  return null;
}
