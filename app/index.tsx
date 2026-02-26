import { useState, useCallback } from "react";
import { View, Text, Pressable } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { getRandomAyah, getSurah, type Ayah, type Surah } from "../src/db/database";

export default function HomeScreen() {
  const db = useSQLiteContext();
  const [ayah, setAyah] = useState<Ayah | null>(null);
  const [surah, setSurah] = useState<Surah | null>(null);

  const loadRandomAyah = useCallback(() => {
    const a = getRandomAyah(db);
    setAyah(a);
    if (a) {
      setSurah(getSurah(db, a.surah));
    }
  }, [db]);

  // Load initial ayah
  if (!ayah) {
    loadRandomAyah();
  }

  return (
    <View className="flex-1 bg-white px-6 pt-16">
      <Text className="text-center text-2xl font-bold text-blue-800 mb-8">
        Hafiz
      </Text>

      {ayah && surah ? (
        <View className="bg-blue-50 rounded-2xl p-6 mb-6">
          <Text className="text-right text-2xl leading-[48px] text-gray-900 mb-4">
            {ayah.text_uthmani}
          </Text>
          <View className="border-t border-blue-200 pt-3">
            <Text className="text-center text-base text-blue-700">
              {surah.name_arabic} ({surah.name_english}) — Ayah {ayah.ayah}
            </Text>
          </View>
        </View>
      ) : (
        <Text className="text-center text-gray-400">Loading...</Text>
      )}

      <Pressable
        onPress={loadRandomAyah}
        className="bg-blue-700 rounded-xl py-4 px-6 items-center active:bg-blue-800"
      >
        <Text className="text-white text-lg font-semibold">Refresh</Text>
      </Pressable>
    </View>
  );
}
