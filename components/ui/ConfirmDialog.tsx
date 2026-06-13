import { ActivityIndicator, Text, View } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveModal } from "@/components/ui/ResponsiveOverlay";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  confirmLoading?: boolean;
  confirmDisabled?: boolean;
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
  confirmLoading = false,
  confirmDisabled = false,
  isDark,
  isRTL,
  onCancel,
  onConfirm,
}: Props) {
  const handleClose = confirmLoading ? () => {} : onCancel;
  return (
    <ResponsiveModal
      open={visible}
      onClose={handleClose}
      maxWidth={420}
      dir={isRTL == null ? undefined : isRTL ? "rtl" : "ltr"}
    >
      <OverlayHeader
        title={title}
        isRTL={isRTL}
        onClose={handleClose}
        leading={
          <View className="h-11 w-11 items-center justify-center rounded-full bg-red-500/10">
            <AlertTriangle size={20} color={isDark ? "#f87171" : "#dc2626"} />
          </View>
        }
      />
      <OverlayBody scrollEnabled={false}>
        <View className={isRTL ? "items-end px-5 py-5" : "items-start px-5 py-5"}>
          <Text
            className="text-warm-500 dark:text-neutral-400"
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
      </OverlayBody>
      <OverlayFooter isRTL={isRTL}>
        <Button variant="outline" onPress={onCancel} disabled={confirmLoading} className="flex-1">
          <Text className="text-charcoal dark:text-neutral-200" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
            {cancelLabel}
          </Text>
        </Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          onPress={onConfirm}
          disabled={confirmLoading || confirmDisabled}
          className="flex-1"
        >
          {confirmLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
              {confirmLabel}
            </Text>
          )}
        </Button>
      </OverlayFooter>
    </ResponsiveModal>
  );
}
