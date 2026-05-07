import { Modal, Pressable, Text, View } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  isDark: boolean;
  isRTL?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  visible,
  title,
  message,
  cancelLabel,
  confirmLabel,
  destructive,
  isDark,
  isRTL,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: "rgba(0,0,0,0.42)" }}>
        <Pressable className="absolute inset-0" onPress={onCancel} />
        <Card elevation="bright" className="w-full max-w-sm p-5 rounded-3xl">
          <View className={isRTL ? "items-end" : "items-start"}>
            <View className="mb-4 h-11 w-11 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangle size={20} color={isDark ? "#f87171" : "#dc2626"} />
            </View>
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{
                fontFamily: "Manrope_700Bold",
                fontSize: 18,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {title}
            </Text>
            <Text
              className="mt-2 text-warm-500 dark:text-neutral-400"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 14,
                lineHeight: 22,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {message}
            </Text>
          </View>

          <View className={`mt-6 gap-3 ${isRTL ? "flex-row-reverse" : "flex-row"}`}>
            <Button variant="outline" onPress={onCancel} className="flex-1">
              <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                {cancelLabel}
              </Text>
            </Button>
            <Button variant={destructive ? "destructive" : "default"} onPress={onConfirm} className="flex-1">
              <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
                {confirmLabel}
              </Text>
            </Button>
          </View>
        </Card>
      </View>
    </Modal>
  );
}
