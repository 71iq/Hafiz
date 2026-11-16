import { BusyIndicator } from "@/components/ui/BusyIndicator";
import { Text, View } from "react-native";
import { AlertTriangle, Info } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { FieldMessage } from "@/components/ui/Field";
import {
  OverlayBody,
  OverlayFooter,
  OverlayFooterLabel,
  OverlayHeader,
  ResponsiveModal,
} from "@/components/ui/ResponsiveOverlay";
import { useStrings } from "@/lib/i18n/useStrings";
import { textStartStyle } from "@/lib/ui/direction";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  tone?: "warning" | "info" | "neutral";
  emphasis?: "confirm" | "cancel";
  itemName?: string;
  confirmLoading?: boolean;
  pendingLabel?: string;
  retryLabel?: string;
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
  tone: explicitTone,
  emphasis = "confirm",
  itemName,
  confirmLoading = false,
  pendingLabel,
  retryLabel,
  confirmDisabled = false,
  error,
  isDark,
  isRTL,
  onCancel,
  onConfirm,
}: Props) {
  const s = useStrings();
  const tone = explicitTone ?? (destructive ? "warning" : "info");
  const handleClose = confirmLoading ? () => {} : onCancel;
  const dir = isRTL == null ? undefined : isRTL ? "rtl" : "ltr";
  const confirmTextClass = emphasis === "cancel" ? "text-charcoal dark:text-neutral-200" : "text-white";
  const visibleConfirmLabel = error ? (retryLabel ?? s.sharedTryAgain) : confirmLabel;
  return (
    <ResponsiveModal open={visible} onClose={handleClose} maxWidth={420} dir={dir}>
      <OverlayHeader
        title={title}
        isRTL={isRTL}
        onClose={handleClose}
        leading={
          tone === "warning" ? (
            <View className="h-11 w-11 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangle size={20} color={isDark ? "#f87171" : "#dc2626"} />
            </View>
          ) : tone === "info" ? (
            <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
              <Info size={20} color={isDark ? "#5eead4" : "#003638"} />
            </View>
          ) : undefined
        }
      />
      <OverlayBody scrollEnabled={false}>
        <View className={isRTL ? "items-end px-5 py-5" : "items-start px-5 py-5"}>
          {itemName ? (
            <Text
              className="mb-2 w-full self-stretch text-charcoal dark:text-neutral-100"
              style={{
                fontFamily: "Manrope_700Bold",
                fontSize: 15,
                lineHeight: 22,
                ...textStartStyle(isRTL),
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {itemName}
            </Text>
          ) : null}
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
              dir={dir}
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
          className="h-auto min-h-11 flex-1 py-2.5"
        >
          <OverlayFooterLabel
            className={emphasis === "cancel" ? "text-white" : "text-charcoal dark:text-neutral-200"}
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
          >
            {cancelLabel}
          </OverlayFooterLabel>
        </Button>
        <Button
          variant={emphasis === "cancel" ? "outline" : destructive ? "destructive" : "default"}
          onPress={onConfirm}
          disabled={confirmLoading || confirmDisabled}
          accessibilityState={{ busy: confirmLoading, disabled: confirmLoading || confirmDisabled }}
          className="h-auto min-h-11 flex-1 py-2.5"
        >
          {confirmLoading ? (
            <>
              <BusyIndicator
                size="small"
                color={emphasis === "cancel" ? (isDark ? "#e5e5e5" : "#2B2B2B") : "#FFFFFF"}
              />
              <OverlayFooterLabel
                className={confirmTextClass}
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
              >
                {pendingLabel ?? s.sharedWorking}
              </OverlayFooterLabel>
            </>
          ) : (
            <OverlayFooterLabel
              className={confirmTextClass}
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
            >
              {visibleConfirmLabel}
            </OverlayFooterLabel>
          )}
        </Button>
      </OverlayFooter>
    </ResponsiveModal>
  );
}
