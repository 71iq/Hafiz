import { Modal, View, Text, Pressable, Dimensions } from "react-native";
import type { Ayah } from "../db/database";
import { copyAyahToClipboard } from "../lib/clipboard";

interface AyahContextMenuProps {
  visible: boolean;
  ayah: Ayah | null;
  surahName: string;
  y: number;
  onClose: () => void;
}

export default function AyahContextMenu({
  visible,
  ayah,
  surahName,
  y,
  onClose,
}: AyahContextMenuProps) {
  if (!ayah) return null;

  const screenHeight = Dimensions.get("window").height;
  const menuTop = y > screenHeight - 120 ? y - 60 : y;

  const handleCopy = () => {
    copyAyahToClipboard(ayah, surahName);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose}>
        <View
          style={{ top: menuTop, left: 40, right: 40, position: "absolute" }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
        >
          <Pressable
            onPress={handleCopy}
            className="px-5 py-3.5 active:bg-gray-100 dark:active:bg-gray-700"
          >
            <Text className="text-base text-gray-900 dark:text-gray-100">
              Copy
            </Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
