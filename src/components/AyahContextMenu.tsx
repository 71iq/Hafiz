import { Modal, View, Pressable, Dimensions } from "react-native";
import type { Ayah } from "../db/database";
import { copyAyahToClipboard } from "../lib/clipboard";
import { Text } from "./ui/text";

interface AyahContextMenuProps {
  visible: boolean;
  ayah: Ayah | null;
  surahName: string;
  y: number;
  onClose: () => void;
  onAskCommunity?: (ayah: Ayah, surahName: string) => void;
}

export default function AyahContextMenu({
  visible,
  ayah,
  surahName,
  y,
  onClose,
  onAskCommunity,
}: AyahContextMenuProps) {
  if (!ayah) return null;

  const screenHeight = Dimensions.get("window").height;
  const menuTop = y > screenHeight - 160 ? y - 110 : y;

  const handleCopy = () => {
    copyAyahToClipboard(ayah, surahName);
    onClose();
  };

  const handleAskCommunity = () => {
    onClose();
    onAskCommunity?.(ayah, surahName);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose}>
        <View
          style={{ top: menuTop, left: 40, right: 40, position: "absolute" }}
          className="bg-popover rounded-xl shadow-lg border border-border overflow-hidden"
        >
          <Pressable
            onPress={handleCopy}
            className="px-5 py-3.5 active:bg-accent border-b border-border"
          >
            <Text className="text-base text-popover-foreground">Copy</Text>
          </Pressable>
          <Pressable
            onPress={handleAskCommunity}
            className="px-5 py-3.5 active:bg-accent"
          >
            <Text className="text-base text-primary">Ask Community</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
