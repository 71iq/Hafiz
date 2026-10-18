import { Text } from "react-native";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";

type Props = {
  visible: boolean;
  info: { title: string; body: string } | null;
  onClose: () => void;
  isPhone: boolean;
  isRTL: boolean;
};

export function ReviewSettingInfoSheet({ visible, info, onClose, isPhone, isRTL }: Props) {
  return (
    <ResponsiveSheet
      open={visible && info !== null}
      onClose={onClose}
      maxWidth={440}
      maxHeight={isPhone ? "70%" : 360}
      dir={isRTL ? "rtl" : "ltr"}
    >
      <OverlayHeader title={info?.title ?? ""} onClose={onClose} isRTL={isRTL} showHandle={isPhone} />
      <OverlayBody contentContainerClassName="px-5 py-5" contentContainerStyle={{ direction: isRTL ? "rtl" : "ltr" }}>
        <Text
          className="text-charcoal dark:text-neutral-200"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 14,
            lineHeight: 23,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {info?.body ?? ""}
        </Text>
      </OverlayBody>
    </ResponsiveSheet>
  );
}
