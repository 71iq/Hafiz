import { Modal, View, Text, Pressable, FlatList } from "react-native";
import type { Surah } from "../db/database";

interface SurahPickerProps {
  visible: boolean;
  surahs: Surah[];
  onSelect: (surahNumber: number) => void;
  onClose: () => void;
}

export default function SurahPicker({
  visible,
  surahs,
  onSelect,
  onClose,
}: SurahPickerProps) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-white dark:bg-gray-950 pt-14">
        <View className="flex-row items-center justify-between px-5 pb-3 border-b border-gray-200 dark:border-gray-800">
          <Text className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Surahs
          </Text>
          <Pressable onPress={onClose} className="px-3 py-1">
            <Text className="text-base text-blue-600 dark:text-blue-400">
              Close
            </Text>
          </Pressable>
        </View>
        <FlatList
          data={surahs}
          keyExtractor={(item) => String(item.number)}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onSelect(item.number);
                onClose();
              }}
              className="flex-row items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 active:bg-gray-50 dark:active:bg-gray-900"
            >
              <View className="flex-row items-center gap-3">
                <Text className="text-sm text-gray-400 dark:text-gray-500 w-8">
                  {item.number}
                </Text>
                <View>
                  <Text className="text-base text-gray-900 dark:text-gray-100">
                    {item.name_english}
                  </Text>
                  <Text className="text-xs text-gray-500 dark:text-gray-400">
                    {item.ayah_count} Ayahs
                  </Text>
                </View>
              </View>
              <Text className="text-lg text-gray-900 dark:text-gray-100">
                {item.name_arabic}
              </Text>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}
