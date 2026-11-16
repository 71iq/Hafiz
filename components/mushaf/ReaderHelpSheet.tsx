import { Platform, Text, View } from "react-native";
import { OverlayBody, OverlayHeader, ResponsiveOverlay } from "@/components/ui/ResponsiveOverlay";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { textStartStyle } from "@/lib/ui/direction";

export function ReaderHelpSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useStrings();
  const { isRTL } = useSettings();
  const shortcuts: [string, string][] = [
    ["PageDown / Space", s.readerHelpNextPage],
    ["PageUp / Shift+Space", s.readerHelpPreviousPage],
    ["← →", s.readerHelpArrows],
    ["Ctrl/⌘+K, /", s.readerHelpSearch],
    ["?", s.readerHelpShortcuts],
    ["Esc", s.readerHelpEscape],
    ["Shift+F10", s.readerHelpContextMenu],
  ];
  const gestures: [string, string][] = [
    [s.readerHelpMarkerTap, s.readerHelpMarkerTapBody],
    [s.readerHelpMarkerLongPress, s.readerHelpMarkerLongPressBody],
    [s.readerHelpWordTap, Platform.OS === "web" ? s.readerHelpWordTapWebBody : s.readerHelpWordTapNativeBody],
    [s.readerHelpWordLongPress, s.readerHelpWordLongPressBody],
  ];
  const writingDirection = isRTL ? "rtl" : "ltr";

  const row = (key: string, term: string, body: string, ltrTerm = false) => (
    <View
      key={key}
      className="min-h-[44px] items-center gap-3 py-2"
      style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
    >
      <Text
        className="text-charcoal dark:text-neutral-100"
        style={{
          width: 132,
          fontFamily: "Manrope_700Bold",
          fontSize: 13,
          ...textStartStyle(isRTL),
          writingDirection: ltrTerm ? "ltr" : writingDirection,
        }}
      >
        {term}
      </Text>
      <Text
        className="min-w-0 flex-1 text-warm-600 dark:text-neutral-300"
        style={{
          fontFamily: "Manrope_400Regular",
          fontSize: 13,
          lineHeight: 19,
          ...textStartStyle(isRTL),
          writingDirection,
        }}
      >
        {body}
      </Text>
    </View>
  );

  const heading = (label: string) => (
    <Text
      accessibilityRole="header"
      className="mb-1 mt-3 text-warm-500 dark:text-neutral-400"
      style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, ...textStartStyle(isRTL), writingDirection }}
    >
      {label}
    </Text>
  );

  return (
    <ResponsiveOverlay
      open={visible}
      onClose={onClose}
      phonePresentation="sheet"
      desktopPresentation="dialog"
      maxWidth={520}
    >
      <OverlayHeader title={s.readerHelpTitle} onClose={onClose} isRTL={isRTL} />
      <OverlayBody contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        {heading(s.readerHelpGestures)}
        {gestures.map(([term, body], index) => row(`gesture-${index}`, term, body))}
        {Platform.OS === "web" ? (
          <>
            {heading(s.readerHelpKeyboard)}
            {shortcuts.map(([term, body], index) => row(`key-${index}`, term, body, true))}
          </>
        ) : null}
      </OverlayBody>
    </ResponsiveOverlay>
  );
}
