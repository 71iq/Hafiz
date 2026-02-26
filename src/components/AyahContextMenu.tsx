import { Modal, View, Pressable, Dimensions, Platform, Share } from "react-native";
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
  const menuTop = y > screenHeight - 200 ? y - 160 : y;

  const handleCopy = () => {
    copyAyahToClipboard(ayah, surahName);
    onClose();
  };

  const handleShare = async () => {
    const text = [
      `"${ayah.text_uthmani}"`,
      `[Surah ${surahName} : Ayah ${ayah.ayah}]`,
    ].join("\n");

    onClose();

    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        // User cancelled share or not supported
      }
    } else {
      try {
        await Share.share({ message: text });
      } catch {
        // Cancelled
      }
    }
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
          <MenuItem label="Copy" onPress={handleCopy} />
          <MenuItem label="Share" onPress={handleShare} />
          <MenuItem label="Ask Community" onPress={handleAskCommunity} primary last />
        </View>
      </Pressable>
    </Modal>
  );
}

function MenuItem({ label, onPress, primary, last }: { label: string; onPress: () => void; primary?: boolean; last?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-5 py-3.5 active:bg-accent ${last ? "" : "border-b border-border"}`}
    >
      <Text className={`text-base ${primary ? "text-primary" : "text-popover-foreground"}`}>{label}</Text>
    </Pressable>
  );
}
