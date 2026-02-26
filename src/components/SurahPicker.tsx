import { Modal, View, Pressable, FlatList } from "react-native";
import type { Surah } from "../db/database";
import { Button } from "./ui/button";
import { Text } from "./ui/text";

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
      <View className="flex-1 bg-background pt-14">
        <View className="flex-row items-center justify-between px-5 pb-3 border-b border-border">
          <Text className="text-xl font-semibold text-foreground">Surahs</Text>
          <Button variant="ghost" onPress={onClose}>
            <Text className="text-base text-primary">Close</Text>
          </Button>
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
              className="flex-row items-center justify-between px-5 py-3.5 border-b border-border active:bg-accent"
            >
              <View className="flex-row items-center gap-3">
                <Text variant="muted" className="text-sm w-8">{item.number}</Text>
                <View>
                  <Text className="text-base text-foreground">{item.name_english}</Text>
                  <Text variant="muted" className="text-xs">{item.ayah_count} Ayahs</Text>
                </View>
              </View>
              <Text className="text-lg text-foreground">{item.name_arabic}</Text>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}
