import { BusyIndicator } from "@/components/ui/BusyIndicator";
import { Text, View } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { FieldMessage } from "@/components/ui/Field";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveModal } from "@/components/ui/ResponsiveOverlay";
import { textStartStyle } from "@/lib/ui/direction";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  /**
   * "warning" (the default) shows the alert icon. "neutral" leaves it out, for a calm confirmation
   * such as leaving a review whose grades are already saved, or a lesson that can be started again.
   */
  tone?: "warning" | "neutral";
  /** "cancel" fills the cancel button instead, when staying is the choice to encourage. */
  emphasis?: "confirm" | "cancel";
  confirmLoading?: boolean;
  confirmDisabled?: boolean;
  error?: string | null;
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
  tone = "warning",
  emphasis = "confirm",
  confirmLoading = false,
  confirmDisabled = false,
  error,
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
          tone === "warning" ? (
            <View className="h-11 w-11 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangle size={20} color={isDark ? "#f87171" : "#dc2626"} />
            </View>
          ) : undefined
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
              ...textStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {message}
          </Text>
          {error ? (
            <FieldMessage
              dir={isRTL == null ? undefined : isRTL ? "rtl" : "ltr"}
              className="mt-3 w-full self-stretch text-red-600 dark:text-red-400"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {error}
            </FieldMessage>
          ) : null}
        </View>
      </OverlayBody>
      <OverlayFooter isRTL={isRTL}>
        <Button
          variant={emphasis === "cancel" ? "default" : "outline"}
          onPress={onCancel}
          disabled={confirmLoading}
          className="flex-1"
        >
          <Text
            className={emphasis === "cancel" ? "text-white" : "text-charcoal dark:text-neutral-200"}
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
          >
            {cancelLabel}
          </Text>
        </Button>
        <Button
          variant={emphasis === "cancel" ? "outline" : destructive ? "destructive" : "default"}
          onPress={onConfirm}
          disabled={confirmLoading || confirmDisabled}
          className="flex-1"
        >
          {confirmLoading ? (
            <BusyIndicator size="small" color={emphasis === "cancel" ? (isDark ? "#e5e5e5" : "#2B2B2B") : "#FFFFFF"} />
          ) : (
            <Text
              className={emphasis === "cancel" ? "text-charcoal dark:text-neutral-200" : "text-white"}
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
            >
              {confirmLabel}
            </Text>
          )}
        </Button>
      </OverlayFooter>
    </ResponsiveModal>
  );
}
